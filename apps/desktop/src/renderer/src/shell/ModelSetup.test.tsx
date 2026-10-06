// @vitest-environment jsdom
/**
 * The set-up: one press, one informed stop (what · how big · where), then download → verify →
 * unpack → start → pull → test → save with no further question.
 *
 * The bridge is faked so the dialog's decisions are tested without Electron, Ollama or the
 * internet: which rows show, when Continue is allowed, what is called in what order, and how
 * each failure is worded.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GiB, formatBytes, MODEL_CATALOGUE } from "@mady/core";
import { ModelButton, ModelSetupDialog, RUNTIME_DOWNLOAD_PAGE, SETUP_BUTTON_LABEL, type SetupBridge } from "./ModelSetup";
import type { ModelStatusResponse, RuntimeStatusResponse } from "../../../preload";

afterEach(cleanup);

const b12 = MODEL_CATALOGUE.find((m) => m.tag === "gemma4:12b")!;
const ASSET = { name: "ollama-windows-amd64.zip", bytes: 1_469_175_900, unpackedBytes: 1_953_507_607, blurb: "The program that runs the language model on this computer." };

function status(over: Partial<ModelStatusResponse> = {}): ModelStatusResponse {
  return {
    settings: { root: "C:\\Users\\user\\AppData\\Roaming\\MadY\\model", model: null, url: "http://127.0.0.1:11434", source: "default" },
    runtimeInstalled: false,
    running: "down",
    serverModels: null,
    ready: false,
    phase: "none",
    pick: { ok: true, model: { ...b12 }, reason: "32.0 GiB of memory fits the Gemma 4 12B" },
    catalogue: MODEL_CATALOGUE.map((m) => ({ ...m })),
    ...over,
  };
}
function runtime(over: Partial<RuntimeStatusResponse> = {}): RuntimeStatusResponse {
  return { root: "C:\\Users\\user\\AppData\\Roaming\\MadY\\model", version: "v0.33.3", installed: false, running: "down", asset: ASSET, ...over };
}

/** A fake bridge where every step succeeds unless told otherwise. */
function fakeBridge(over: Partial<SetupBridge> & { statusValue?: ModelStatusResponse; runtimeValue?: RuntimeStatusResponse; free?: number | null } = {}) {
  const { statusValue = status(), runtimeValue = runtime(), free = 200 * GiB, ...rest } = over;
  const bridge: SetupBridge = {
    modelStatus: vi.fn(async () => statusValue),
    runtimeStatus: vi.fn(async () => runtimeValue),
    pickFolder: vi.fn(async () => null),
    freeSpace: vi.fn(async () => free),
    installRuntime: vi.fn(async (_root, onProgress) => {
      onProgress({ step: "download", received: 1, total: 2 });
      onProgress({ step: "start" });
      return { ok: true as const, exe: "x", external: false };
    }),
    pullModel: vi.fn(async (_m, onProgress) => {
      onProgress({ status: "pulling", completed: 1, total: 2 });
      return { ok: true as const, bytes: b12.expectedBytes };
    }),
    testModel: vi.fn(async () => ({ ok: true as const, ms: 900 })),
    configureModel: vi.fn(async () => ({ ok: true as const })),
    openExternal: vi.fn(),
    ...rest,
  };
  return bridge;
}

function open(bridge: SetupBridge) {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const u = render(<ModelSetupDialog bridge={bridge} onClose={onClose} onChanged={onChanged} />);
  const text = () => u.container.textContent ?? "";
  const button = (re: RegExp) => [...u.container.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""));
  return { ...u, onClose, onChanged, text, button };
}

describe("ModelButton — always pressable; its label follows the phase", () => {
  it("before set-up it reads the set-up label; when ready it is the model's chip", () => {
    const onClick = vi.fn();
    const a = render(<ModelButton status={status()} onClick={onClick} />);
    const btn = a.container.querySelector("button")!;
    expect(btn.textContent).toContain(SETUP_BUTTON_LABEL);
    expect(SETUP_BUTTON_LABEL).toBe("Activate, install & configure LLM");
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
    cleanup();
    const r = render(<ModelButton status={status({ phase: "ready", ready: true, settings: { ...status().settings, model: "gemma4:12b" } })} onClick={onClick} />);
    expect(r.container.querySelector("button")!.textContent).toContain("gemma4:12b");
    cleanup();
    // No status yet (the bridge has not answered): still the set-up label, still pressable.
    const n = render(<ModelButton status={null} onClick={onClick} />);
    expect(n.container.querySelector("button")!.textContent).toContain(SETUP_BUTTON_LABEL);
    expect(n.container.querySelector("button")!.disabled).toBe(false);
  });
});

describe("the one screen — what, how big, where", () => {
  it("a fresh machine: the Ollama row with its blurb and exact size, the picked model with its expected size, the folder with free space, one Continue naming both sizes", async () => {
    const bridge = fakeBridge();
    const u = open(bridge);
    await waitFor(() => expect(u.text()).toContain("Ollama"));
    expect(u.text()).toContain(ASSET.blurb);
    expect(u.text()).toContain(formatBytes(ASSET.bytes));
    expect(u.text()).toContain("Gemma 4 12B");
    expect(u.text()).toContain(b12.blurb);
    expect(u.text()).toContain(`~${formatBytes(b12.expectedBytes)}`);
    expect(u.text()).toContain("MadY\\model");
    expect(u.text()).toContain(`${formatBytes(200 * GiB)} free`);
    // Why this size was chosen is said, not hidden.
    expect(u.text()).toContain("32.0 GiB of memory");
    const go = u.button(/^Download/);
    expect(go).toBeDefined();
    expect(go!.disabled).toBe(false);
    expect(go!.textContent).toContain(formatBytes(ASSET.bytes));
    expect(go!.textContent).toContain(formatBytes(b12.expectedBytes));
  });

  it("the free space includes the unpack: needed = archive + unpacked + model; short → Continue disabled with the reason", async () => {
    const needed = ASSET.bytes + ASSET.unpackedBytes + b12.expectedBytes;
    const bridge = fakeBridge({ free: needed - 1 });
    const u = open(bridge);
    await waitFor(() => expect(u.button(/^Download/)).toBeDefined());
    expect(u.button(/^Download/)!.disabled).toBe(true);
    expect(u.text()).toMatch(/not enough free space/i);
    expect(u.text()).toContain(formatBytes(needed));
  });

  it("Change… asks for a folder; the folder and its free space update", async () => {
    const bridge = fakeBridge({ pickFolder: vi.fn(async () => "D:\\big\\llm") as SetupBridge["pickFolder"] });
    const u = open(bridge);
    await waitFor(() => expect(u.button(/Change/)).toBeDefined());
    fireEvent.click(u.button(/Change/)!);
    await waitFor(() => expect(u.text()).toContain("D:\\big\\llm"));
    expect(bridge.freeSpace).toHaveBeenLastCalledWith("D:\\big\\llm");
  });

  it("when memory fits nothing, the refusal is shown with its reason and Continue waits for a manual choice", async () => {
    const bridge = fakeBridge({ statusValue: status({ pick: { ok: false, reason: "this computer has 8.0 GiB of memory; the lightest Gemma 4 needs about 9.7 GiB" } }) });
    const u = open(bridge);
    await waitFor(() => expect(u.text()).toContain("8.0 GiB of memory"));
    expect(u.button(/^Download/)!.disabled).toBe(true);
    // The user may still choose one, knowingly.
    const select = u.container.querySelector<HTMLSelectElement>("select.setup-model");
    expect(select).not.toBeNull();
    fireEvent.change(select!, { target: { value: "gemma4:e2b" } });
    await waitFor(() => expect(u.button(/^Download/)!.disabled).toBe(false));
  });
});

describe("Continue — everything after the one click, in order, with no further question", () => {
  it("fresh machine: installRuntime(root) → pullModel(tag) → testModel → configureModel({root, model}) → onChanged → Ready", async () => {
    const bridge = fakeBridge();
    const u = open(bridge);
    await waitFor(() => expect(u.button(/^Download/)).toBeDefined());
    fireEvent.click(u.button(/^Download/)!);
    await waitFor(() => expect(u.text()).toMatch(/ready/i));
    expect(bridge.installRuntime).toHaveBeenCalledOnce();
    expect((bridge.installRuntime as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(status().settings.root);
    expect(bridge.pullModel).toHaveBeenCalledOnce();
    expect((bridge.pullModel as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("gemma4:12b");
    expect(bridge.testModel).toHaveBeenCalledOnce();
    expect(bridge.configureModel).toHaveBeenCalledWith({ root: status().settings.root, model: "gemma4:12b" });
    expect(u.onChanged).toHaveBeenCalled();
    // The steps run in the order the set-up screen lists them (`planSteps`).
    const order = [bridge.installRuntime, bridge.pullModel, bridge.testModel, bridge.configureModel].map((f) => (f as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The steps were shown as they ran.
    expect(u.text()).toMatch(/download/i);
    expect(u.text()).toMatch(/test/i);
  });

  it("the user's own Ollama already holding the model: no Ollama row, no folder, no download — test, save, done", async () => {
    const bridge = fakeBridge({
      statusValue: status({ running: "external", serverModels: ["gemma4:12b"], phase: "server-only" }),
      runtimeValue: runtime({ running: "external" }),
    });
    const u = open(bridge);
    await waitFor(() => expect(u.button(/^Activate/)).toBeDefined());
    expect(u.text()).not.toContain(ASSET.blurb);
    expect(u.button(/Change/)).toBeUndefined();
    expect(u.text()).toMatch(/your Ollama/i);
    fireEvent.click(u.button(/^Activate/)!);
    await waitFor(() => expect(u.text()).toMatch(/ready/i));
    expect(bridge.installRuntime).not.toHaveBeenCalled();
    expect(bridge.pullModel).not.toHaveBeenCalled();
    expect(bridge.testModel).toHaveBeenCalledOnce();
    expect(bridge.configureModel).toHaveBeenCalledOnce();
  });

  it("the user's own Ollama WITHOUT the model: pull through it, still no runtime download", async () => {
    const bridge = fakeBridge({
      statusValue: status({ running: "external", serverModels: ["gemma3:12b"], phase: "server-only" }),
      runtimeValue: runtime({ running: "external" }),
    });
    const u = open(bridge);
    await waitFor(() => expect(u.button(/^Download/)).toBeDefined());
    fireEvent.click(u.button(/^Download/)!);
    await waitFor(() => expect(u.text()).toMatch(/ready/i));
    expect(bridge.installRuntime).not.toHaveBeenCalled();
    expect(bridge.pullModel).toHaveBeenCalledOnce();
  });

  it("a failure names its step and its reason, offers Retry (from that step), Advanced, and the runtime's own download page", async () => {
    const installRuntime = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, step: "verify", error: "the downloaded ollama-windows-amd64.zip does not match its published checksum" })
      .mockResolvedValueOnce({ ok: true, exe: "x", external: false });
    const bridge = fakeBridge({ installRuntime: installRuntime as unknown as SetupBridge["installRuntime"] });
    const u = open(bridge);
    await waitFor(() => expect(u.button(/^Download/)).toBeDefined());
    fireEvent.click(u.button(/^Download/)!);
    await waitFor(() => expect(u.text()).toContain("published checksum"));
    expect(u.text()).toMatch(/verify/i);
    expect(bridge.pullModel).not.toHaveBeenCalled();
    fireEvent.click(u.button(/download page/i)!);
    expect(bridge.openExternal).toHaveBeenCalledWith(RUNTIME_DOWNLOAD_PAGE);
    fireEvent.click(u.button(/Retry/)!);
    await waitFor(() => expect(u.text()).toMatch(/ready/i));
    expect(installRuntime).toHaveBeenCalledTimes(2);
    expect(bridge.pullModel).toHaveBeenCalledOnce();
  });

  it("a test that fails does not save: the config is only written after the model answered", async () => {
    const bridge = fakeBridge({ testModel: vi.fn(async () => ({ ok: false as const, error: "timed out after 30 s" })) });
    const u = open(bridge);
    await waitFor(() => expect(u.button(/^Download/)).toBeDefined());
    fireEvent.click(u.button(/^Download/)!);
    await waitFor(() => expect(u.text()).toContain("timed out after 30 s"));
    expect(bridge.configureModel).not.toHaveBeenCalled();
    expect(u.onChanged).not.toHaveBeenCalled();
  });
});

describe("Advanced — another server on THIS machine", () => {
  it("url + model → Save is disabled until Test passes; Test failure is shown; then Save writes root, model AND url", async () => {
    const testModel = vi.fn().mockResolvedValueOnce({ ok: false, error: "ECONNREFUSED" }).mockResolvedValueOnce({ ok: true, ms: 40 });
    const bridge = fakeBridge({ testModel: testModel as unknown as SetupBridge["testModel"] });
    const u = open(bridge);
    await waitFor(() => expect(u.button(/Advanced/)).toBeDefined());
    fireEvent.click(u.button(/Advanced/)!);
    const url = u.container.querySelector<HTMLInputElement>("input.setup-url")!;
    const model = u.container.querySelector<HTMLInputElement>("input.setup-tag")!;
    fireEvent.change(url, { target: { value: "http://127.0.0.1:11500" } });
    fireEvent.change(model, { target: { value: "gemma3:12b" } });
    expect(u.button(/^Save/)!.disabled).toBe(true);
    fireEvent.click(u.button(/^Test/)!);
    await waitFor(() => expect(u.text()).toContain("ECONNREFUSED"));
    expect(u.button(/^Save/)!.disabled).toBe(true);
    fireEvent.click(u.button(/^Test/)!);
    await waitFor(() => expect(u.text()).toMatch(/answered/i));
    expect(testModel).toHaveBeenLastCalledWith({ url: "http://127.0.0.1:11500", model: "gemma3:12b" });
    expect(u.button(/^Save/)!.disabled).toBe(false);
    fireEvent.click(u.button(/^Save/)!);
    await waitFor(() => expect(bridge.configureModel).toHaveBeenCalledWith({ root: status().settings.root, model: "gemma3:12b", url: "http://127.0.0.1:11500" }));
    expect(u.onChanged).toHaveBeenCalled();
  });

  it("says up front that a hosted service is not an option — the model must run on this machine", async () => {
    const u = open(fakeBridge());
    await waitFor(() => expect(u.button(/Advanced/)).toBeDefined());
    fireEvent.click(u.button(/Advanced/)!);
    expect(u.text()).toMatch(/this machine/i);
    expect(u.text()).toMatch(/hosted|remote|OpenAI|Anthropic|Gemini/i);
  });
});

describe("opened from the chip, when READY", () => {
  it("shows the current model, and Turn off writes model:null and reports the change", async () => {
    const bridge = fakeBridge({ statusValue: status({ phase: "ready", ready: true, running: "ours", runtimeInstalled: true, serverModels: ["gemma4:12b"], settings: { ...status().settings, model: "gemma4:12b", source: "file" } }) });
    const u = open(bridge);
    await waitFor(() => expect(u.button(/Turn off/)).toBeDefined());
    expect(u.text()).toContain("gemma4:12b");
    fireEvent.click(u.button(/Turn off/)!);
    await waitFor(() => expect(bridge.configureModel).toHaveBeenCalledWith({ root: status().settings.root, model: null }));
    expect(u.onChanged).toHaveBeenCalled();
  });
});

describe("no bridge at all (a browser preview)", () => {
  it("says plainly that this build cannot set up a model, with nothing to press but Close", async () => {
    const onClose = vi.fn();
    const u = render(<ModelSetupDialog bridge={null} onClose={onClose} onChanged={vi.fn()} />);
    expect(u.container.textContent).toMatch(/cannot reach|not available in this build/i);
    // The "?" to the manual is always there; besides it, only Close.
    const buttons = [...u.container.querySelectorAll("button")].filter((b) => !(b.getAttribute("aria-label") ?? "").startsWith("Help:"));
    expect(buttons.length).toBe(1);
    fireEvent.click(buttons[0]!);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("a parent re-render must not reset the screen", () => {
  it("after Ready, a NEW bridge object with the same functions leaves the Ready screen in place (the app re-renders on every status refresh)", async () => {
    const bridge = fakeBridge();
    const onClose = vi.fn();
    const onChanged = vi.fn();
    const u = render(<ModelSetupDialog bridge={bridge} onClose={onClose} onChanged={onChanged} />);
    const button = (re: RegExp) => [...u.container.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""));
    await waitFor(() => expect(button(/^Download/)).toBeDefined());
    fireEvent.click(button(/^Download/)!);
    await waitFor(() => expect(u.container.textContent).toMatch(/Ready\./));
    // The parent refreshed its status (phase now "ready") and re-rendered with a fresh bridge object.
    (bridge.modelStatus as ReturnType<typeof vi.fn>).mockResolvedValue(status({ phase: "ready", ready: true, settings: { ...status().settings, model: "gemma4:12b" } }));
    u.rerender(<ModelSetupDialog bridge={{ ...bridge }} onClose={onClose} onChanged={onChanged} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(u.container.textContent).toMatch(/Ready\./);
    expect(u.container.textContent).not.toMatch(/is in use/);
  });
});
