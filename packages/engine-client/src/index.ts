import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { CONTRACT_VERSION, assertAnalysisResult, parseEngineMessage } from "@mady/contracts";
import type { EngineMessage, ErrorCode, HelloMessage, HostMessage } from "@mady/contracts";

const MAX_FRAME_BYTES = 64 * 1024 * 1024;
export class EngineError extends Error {
  constructor(readonly code: ErrorCode, message: string) { super(message); this.name = "EngineError"; }
}
export interface EngineOptions {
  command: string;
  args: string[];
  startTimeoutMs?: number;
  onLog?: (message: string) => void;
}
interface Pending { method: string; resolve: (result: Record<string, unknown>) => void; reject: (error: EngineError) => void }
interface Run {
  child: ChildProcessWithoutNullStreams | null;
  buffer: Buffer;
  ready: boolean;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: EngineError) => void;
  timer?: ReturnType<typeof setTimeout>;
}
function frame(message: HostMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message));
  if (body.length > MAX_FRAME_BYTES) throw new EngineError("bad_request", "Engine request exceeds the frame size limit.");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

/** One child owns each startup attempt. Obsolete child events cannot affect its successor. */
export class EngineTransport {
  private run: Run | null = null;
  private stopping = false;
  private seq = 0;
  private hello: HelloMessage | null = null;
  private pending = new Map<string, Pending>();
  constructor(private readonly options: EngineOptions) {}
  info(): HelloMessage | null { return this.hello; }

  async request(method: string, data?: Record<string, unknown>, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.stopping) throw new EngineError("engine_crash", "Engine is stopping.");
    const run = this.ensureStarted();
    await run.promise;
    if (this.run !== run || !run.child || this.stopping) throw new EngineError("engine_crash", "Engine is no longer running.");
    const id = `req_${++this.seq}`;
    const message = frame({ type: "request", id, method, ...(data !== undefined ? { data } : {}), ...(params !== undefined ? { params } : {}) });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      try {
        run.child!.stdin.write(message, error => { if (error) this.fail(run, new EngineError("engine_crash", error.message)); });
      } catch (error) { this.fail(run, new EngineError("engine_crash", String(error))); }
    });
  }
  cancel(id: string): void {
    const run = this.run;
    if (!run?.ready || !run.child) return;
    try { run.child.stdin.write(frame({ type: "cancel", id })); }
    catch (error) { this.fail(run, new EngineError("engine_crash", String(error))); }
  }
  async stop(): Promise<void> {
    this.stopping = true;
    const run = this.run;
    if (!run) return;
    const child = run.child;
    const exited = child ? new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 2000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    }) : Promise.resolve();
    this.fail(run, new EngineError("engine_crash", "Engine stopped."));
    await exited;
  }
  private fail(run: Run, error: EngineError, kill = true): void {
    if (this.run !== run) return;
    this.run = null;
    this.hello = null;
    if (run.timer) clearTimeout(run.timer);
    run.reject(error);
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
    if (kill) run.child?.kill();
    this.options.onLog?.(error.message);
  }
  private ensureStarted(): Run {
    if (this.run) return this.run;
    let resolve!: () => void;
    let reject!: (error: EngineError) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const run: Run = { child: null, buffer: Buffer.alloc(0), ready: false, promise, resolve, reject };
    this.run = run;
    run.timer = setTimeout(() => this.fail(run, new EngineError("timeout", "Engine did not signal ready in time.")), this.options.startTimeoutMs ?? 10000);
    try {
      const child = spawn(this.options.command, this.options.args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      run.child = child;
      child.stdout.on("data", (chunk: Buffer) => this.receive(run, chunk));
      child.stderr.on("data", (chunk: Buffer) => { if (this.run === run) this.options.onLog?.(`[engine stderr] ${chunk.toString("utf8").trim()}`); });
      child.stdin.on("error", error => this.fail(run, new EngineError("engine_crash", error.message)));
      child.on("error", error => this.fail(run, new EngineError("engine_crash", error.message)));
      child.on("exit", (code, signal) => this.fail(run, new EngineError("engine_crash", `Stats engine exited (code=${code}, signal=${signal}).`), false));
    } catch (error) { this.fail(run, new EngineError("engine_crash", `Failed to spawn engine: ${String(error)}`)); }
    return run;
  }
  private receive(run: Run, chunk: Buffer): void {
    if (this.run !== run) return;
    try {
      run.buffer = run.buffer.length ? Buffer.concat([run.buffer, chunk]) : chunk;
      while (this.run === run && run.buffer.length >= 4) {
        const size = run.buffer.readUInt32BE(0);
        if (size > MAX_FRAME_BYTES) throw new Error("Engine frame exceeds the size limit.");
        if (run.buffer.length < size + 4) break;
        const body = run.buffer.subarray(4, size + 4);
        run.buffer = run.buffer.subarray(size + 4);
        this.handle(run, parseEngineMessage(JSON.parse(body.toString("utf8"))));
      }
    } catch (error) { this.fail(run, new EngineError("engine_internal", `Invalid engine response: ${String(error)}`)); }
  }
  private handle(run: Run, message: EngineMessage): void {
    if (message.type === "hello") {
      if (run.ready || message.contractVersion !== CONTRACT_VERSION) throw new Error(`Unsupported engine handshake (contract ${message.contractVersion}; expected ${CONTRACT_VERSION}).`);
      run.ready = true;
      this.hello = message;
      if (run.timer) clearTimeout(run.timer);
      run.resolve();
      this.options.onLog?.(`engine ready: ${message.engine} ${message.version} (contract v${message.contractVersion})`);
      return;
    }
    if (!run.ready) throw new Error("Engine responded before its handshake.");
    const pending = this.pending.get(message.id);
    if (!pending) return;
    if (message.type === "result") {
      if (pending.method === "ping") {
        if (message.results.pong !== true) throw new Error("Invalid ping response.");
      } else assertAnalysisResult(message.results, pending.method);
      this.pending.delete(message.id);
      pending.resolve(message.results);
    } else {
      this.pending.delete(message.id);
      pending.reject(new EngineError(message.code, message.message));
    }
  }
}
