import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
import { SidecarSupervisor } from "./sidecar";
import { EngineClient } from "../../../../packages/mcp-server/src/engineClient";

class Child extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { write: vi.fn() });
  kill = vi.fn(() => true);
  send(message: unknown) {
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    this.stdout.emit("data", Buffer.concat([header, body]));
  }
}
const hello = { type: "hello", engine: "test", version: "1", contractVersion: 1 };
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
describe("shared framed transport", () => {
  it("decodes split frames and matches concurrent replies by id", async () => {
    const c = new Child(); mocks.spawn.mockReturnValue(c);
    const client = new EngineClient({ command: "fake", args: [] });
    const first = client.request("ping");
    const second = client.request("ping");
    const body = Buffer.from(JSON.stringify(hello));
    const header = Buffer.alloc(4); header.writeUInt32BE(body.length);
    c.stdout.emit("data", header.subarray(0, 2));
    expect(c.stdin.write).not.toHaveBeenCalled();
    c.stdout.emit("data", Buffer.concat([header.subarray(2), body]));
    await Promise.resolve();
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(client.info()).toEqual(hello);
    c.send({ type: "result", id: "req_2", ok: true, results: { pong: true, order: 2 } });
    c.send({ type: "result", id: "req_1", ok: true, results: { pong: true, order: 1 } });
    expect(await first).toEqual({ pong: true, order: 1 });
    expect(await second).toEqual({ pong: true, order: 2 });
    const stopped = client.stop(); c.emit("exit", 0, null); await stopped;
    expect(client.info()).toBeNull();
  });
  it("rejects pending work when stdin fails", async () => {
    const c = new Child(); mocks.spawn.mockReturnValue(c);
    const client = new EngineClient({ command: "fake", args: [] });
    const pending = client.request("ping").catch(e => e);
    c.send(hello); await Promise.resolve();
    c.stdin.emit("error", new Error("broken pipe"));
    expect(await pending).toMatchObject({ code: "engine_crash", message: "broken pipe" });
    expect(c.kill).toHaveBeenCalledOnce();
  });
  it.each([Buffer.from([4, 0, 0, 1]), Buffer.from([0, 0, 0, 1, 123])])("rejects oversized or invalid JSON frames", async bytes => {
    const c = new Child(); mocks.spawn.mockReturnValue(c);
    const client = new EngineClient({ command: "fake", args: [] });
    const pending = client.request("ping").catch(e => e);
    c.stdout.emit("data", bytes);
    expect(await pending).toMatchObject({ code: "engine_internal" });
    expect(c.kill).toHaveBeenCalledOnce();
  });
  it("keeps the engine available after a typed numerical error", async () => {
    const c = new Child(); mocks.spawn.mockReturnValue(c);
    const client = new EngineClient({ command: "fake", args: [] });
    const pending = client.request("describe").catch(e => e);
    c.send(hello); await Promise.resolve();
    c.send({ type: "error", id: "req_1", ok: false, code: "numerical", message: "Need more data" });
    expect(await pending).toMatchObject({ code: "numerical" });
    expect(c.kill).not.toHaveBeenCalled();
    client.cancel("req_1");
    const frame = c.stdin.write.mock.calls.at(-1)![0] as Buffer;
    expect(JSON.parse(frame.subarray(4).toString())).toEqual({ type: "cancel", id: "req_1" });
    const stopped = client.stop(); c.emit("exit", 0, null); await stopped;
    await expect(client.request("ping")).rejects.toMatchObject({ code: "engine_crash" });
  });
});
for (const [name, make] of [
  ["desktop", () => new SidecarSupervisor({ command: "fake", args: [] })],
  ["MCP", () => new EngineClient({ command: "fake", args: [] })],
] as const) describe(name, () => {
  it("kills timed-out startup and ignores its late events during a replacement request", async () => {
    vi.useFakeTimers();
    const children: Child[] = [];
    mocks.spawn.mockImplementation(() => { const c = new Child(); children.push(c); return c; });
    const client = make();
    const first = client.request("ping").catch(e => e);
    await vi.advanceTimersByTimeAsync(10001);
    expect((await first).code).toBe("timeout");
    expect(children[0]!.kill).toHaveBeenCalledOnce();
    const second = client.request("ping");
    children[0]!.send({ ...hello, contractVersion: 999 });
    children[0]!.emit("exit", 1, null);
    children[1]!.send(hello);
    await vi.advanceTimersByTimeAsync(0);
    children[1]!.send({ type: "result", id: "req_1", ok: true, results: { pong: true } });
    expect(await second).toEqual({ pong: true });
    const stopped = client.stop();
    children[1]!.emit("exit", 0, null);
    await stopped;
    expect(children[1]!.kill).toHaveBeenCalledOnce();
  });
  it("rejects incompatible protocol before writing a request", async () => {
    vi.useFakeTimers();
    const c = new Child(); mocks.spawn.mockReturnValue(c);
    const client = make();
    const pending = client.request("describe").catch(e => e);
    c.send({ ...hello, contractVersion: 999 });
    await vi.advanceTimersByTimeAsync(0);
    expect(await Promise.race([pending, Promise.resolve("pending")])).toMatchObject({ code: "engine_internal" });
    expect(c.stdin.write).not.toHaveBeenCalled();
    expect(c.kill).toHaveBeenCalledOnce();
    await client.stop();
  });
  it("rejects malformed success output", async () => {
    vi.useFakeTimers();
    const c = new Child(); mocks.spawn.mockReturnValue(c);
    const client = make();
    const pending = client.request("describe").catch(e => e);
    c.send(hello); await vi.advanceTimersByTimeAsync(0);
    c.send({ type: "result", id: "req_1", ok: true, results: { garbage: true } });
    expect(await pending).toMatchObject({ code: "engine_internal" });
    const stopped = client.stop(); c.emit("exit", 0, null); await stopped;
  });
  it("settles startup immediately when stopped", async () => {
    vi.useFakeTimers();
    const c = new Child(); mocks.spawn.mockReturnValue(c);
    const client = make();
    const pending = client.request("ping").catch(e => e);
    const stopped = client.stop(); c.emit("exit", 0, null); await stopped;
    await vi.advanceTimersByTimeAsync(0);
    expect(await Promise.race([pending, Promise.resolve("pending")])).toMatchObject({ code: "engine_crash" });
  });
});
