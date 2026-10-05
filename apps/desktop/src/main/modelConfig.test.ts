/**
 * `model.json` — the saved choice behind the model bar: where the runtime and weights live,
 * which model, and (rarely) which loopback URL.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { composeModelStatus, defaultModelRoot, llmEnabled, modelConfigPath, readModelConfig, resolveModelSettings, writeModelConfig } from "./modelConfig";
import { GiB } from "@mady/core";

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "mady-modelcfg-"));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

describe("model.json — read and write", () => {
  it("is absent on first run: read returns null, not a throw", async () => {
    expect(await readModelConfig(userData)).toBeNull();
  });

  it("round-trips root + model + url, written atomically beside recents.json", async () => {
    const cfg = { root: "D:\\big\\mady-model", model: "gemma4:12b", url: "http://127.0.0.1:11434" };
    await writeModelConfig(userData, cfg);
    expect(modelConfigPath(userData)).toBe(join(userData, "model.json"));
    expect(await readModelConfig(userData)).toEqual(cfg);
    // Human-readable on disk — the user may want to see where 9 GB went.
    expect(await readFile(modelConfigPath(userData), "utf8")).toContain("gemma4:12b");
  });

  it("a corrupt or foreign file reads as null — never as a half-config", async () => {
    await writeFile(modelConfigPath(userData), "{not json");
    expect(await readModelConfig(userData)).toBeNull();
    await writeFile(modelConfigPath(userData), JSON.stringify({ root: 42, model: [] }));
    expect(await readModelConfig(userData)).toBeNull();
  });

  it("model may be null (runtime set up, no weights yet) and url may be absent", async () => {
    await writeModelConfig(userData, { root: "C:\\x", model: null });
    expect(await readModelConfig(userData)).toEqual({ root: "C:\\x", model: null });
  });

  it("refuses to save a non-loopback url — the rule holds at the point of persistence too", async () => {
    await expect(writeModelConfig(userData, { root: "C:\\x", model: "m", url: "http://models.example.com" })).rejects.toThrow(/loopback|this machine/i);
    expect(await readModelConfig(userData)).toBeNull();
  });
});

describe("resolveModelSettings — env wins, then the file, then defaults (the MADY_ENGINE_EXE precedent)", () => {
  const file = { root: "D:\\m", model: "gemma4:e2b", url: "http://127.0.0.1:11434" };

  it("with nothing set: the default root under userData, no model, the default url, source 'default'", () => {
    const r = resolveModelSettings({}, null, userData);
    expect(r).toEqual({ root: defaultModelRoot(userData), model: null, url: "http://127.0.0.1:11434", source: "default" });
    expect(defaultModelRoot(userData)).toBe(join(userData, "model"));
  });

  it("the file supplies root, model and url when the env is silent", () => {
    expect(resolveModelSettings({}, file, userData)).toEqual({ ...file, source: "file" });
  });

  it("MADY_MODEL_NAME / MADY_MODEL_URL override the file, and say so", () => {
    const r = resolveModelSettings({ MADY_MODEL_NAME: "gemma4:12b", MADY_MODEL_URL: "http://localhost:11500" }, file, userData);
    expect(r).toEqual({ root: "D:\\m", model: "gemma4:12b", url: "http://localhost:11500", source: "env" });
  });

  it("an env override of just the name keeps the file's url and root", () => {
    const r = resolveModelSettings({ MADY_MODEL_NAME: "gemma4:12b" }, file, userData);
    expect(r).toEqual({ root: "D:\\m", model: "gemma4:12b", url: file.url, source: "env" });
  });

  it("a blank env var is 'not set', not an empty model name", () => {
    expect(resolveModelSettings({ MADY_MODEL_NAME: "   " }, file, userData).model).toBe("gemma4:e2b");
  });

  it("a non-loopback url from either source is refused with the reason", () => {
    expect(() => resolveModelSettings({ MADY_MODEL_URL: "http://10.0.0.5:11434" }, null, userData)).toThrow(/loopback|this machine/i);
    expect(() => resolveModelSettings({}, { ...file, url: "https://api.example.com" }, userData)).toThrow(/loopback|this machine/i);
  });

  it("a trailing slash on the url is dropped so callers can append paths", () => {
    expect(resolveModelSettings({ MADY_MODEL_URL: "http://127.0.0.1:11434/" }, null, userData).url).toBe("http://127.0.0.1:11434");
  });
});

describe("composeModelStatus — what the bar and the button key off", () => {
  const settings = { root: "D:\\m", model: "gemma4:12b", url: "http://127.0.0.1:11434", source: "file" as const };
  const base = { settings, runtimeInstalled: true, running: "ours" as const, serverModels: ["gemma4:12b", "gemma3:12b"], totalMemBytes: 32 * GiB };

  it("ready ⇔ a server answers and the configured model is among its models", () => {
    expect(composeModelStatus(base).ready).toBe(true);
    expect(composeModelStatus({ ...base, serverModels: ["gemma3:12b"] }).ready).toBe(false);
    expect(composeModelStatus({ ...base, serverModels: null }).ready).toBe(false);
    expect(composeModelStatus({ ...base, settings: { ...settings, model: null } }).ready).toBe(false);
  });

  it("a bare tag matches the server's ':latest' spelling and vice versa", () => {
    expect(composeModelStatus({ ...base, settings: { ...settings, model: "gemma4" }, serverModels: ["gemma4:latest"] }).ready).toBe(true);
    expect(composeModelStatus({ ...base, settings: { ...settings, model: "gemma4:latest" }, serverModels: ["gemma4"] }).ready).toBe(true);
  });

  it("carries the automatic pick for this machine, so the dialog can name it and say why", () => {
    const s = composeModelStatus(base);
    expect(s.pick.ok && s.pick.model.tag).toBe("gemma4:12b");
    const small = composeModelStatus({ ...base, totalMemBytes: 8 * GiB });
    expect(small.pick.ok).toBe(false);
  });

  it("names the phase the button label follows: none / runtime-only / server-only / ready", () => {
    expect(composeModelStatus(base).phase).toBe("ready");
    expect(composeModelStatus({ ...base, serverModels: ["gemma3:12b"] }).phase).toBe("server-only");
    expect(composeModelStatus({ ...base, running: "down", serverModels: null }).phase).toBe("runtime-only");
    expect(composeModelStatus({ ...base, running: "down", serverModels: null, runtimeInstalled: false }).phase).toBe("none");
    // The user's own Ollama with the model already on it: ready without anything of ours installed.
    expect(composeModelStatus({ ...base, running: "external", runtimeInstalled: false }).phase).toBe("ready");
  });

  it("passes the settings and the catalogue through untouched — the dialog draws from one object", () => {
    const s = composeModelStatus(base);
    expect(s.settings).toEqual(settings);
    expect(s.catalogue.map((m) => m.tag)).toContain("gemma4:e2b");
    expect(s.serverModels).toEqual(base.serverModels);
  });
});

describe("llmEnabled — off by default everywhere; only MADY_LLM=1 turns it on", () => {
  it("is off with nothing set — plain `npm run dev` and the installed program alike", () => {
    expect(llmEnabled({})).toBe(false);
    expect(llmEnabled({ NODE_ENV: "development" })).toBe(false);
  });

  it("MADY_LLM=1 turns it on; anything else does not", () => {
    expect(llmEnabled({ MADY_LLM: "1" })).toBe(true);
    expect(llmEnabled({ MADY_LLM: "0" })).toBe(false);
    expect(llmEnabled({ MADY_LLM: "yes" })).toBe(false);
    expect(llmEnabled({ MADY_LLM: "" })).toBe(false);
  });
});
