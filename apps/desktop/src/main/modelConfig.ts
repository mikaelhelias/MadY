/**
 * `model.json` — the saved choice behind the model bar.
 *
 * Three fields: `root` (the folder the user chose for the runtime and the weights — gigabytes,
 * so it is theirs to place), `model` (the Ollama tag, or null when the runtime is set up but no
 * weights are yet), and optionally `url` (a loopback server other than the default port, from
 * the Advanced door).
 *
 * Lives beside `recents.json` in userData, written atomically. Read once at boot and again
 * after the set-up dialog saves. The environment still wins over the file — `MADY_MODEL_NAME`
 * and `MADY_MODEL_URL`, the same precedent `MADY_ENGINE_EXE` set — so a developer can point a
 * checkout at any local server without touching their saved choice.
 *
 * The loopback rule holds here too, at the point of persistence: a non-loopback url is
 * refused on write and on resolve, so a hand-edited file cannot smuggle one in.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isLoopbackUrl,
  NonLoopbackModelHost,
  DEFAULT_MODEL_URL,
  MODEL_CATALOGUE,
  pickModelForMemory,
  type ModelChoice,
  type ModelPick,
} from "@mady/core";
import { atomicWrite } from "./atomicWrite";

export interface ModelConfig {
  root: string;
  model: string | null;
  url?: string;
}

export const modelConfigPath = (userData: string): string => join(userData, "model.json");

/** Where everything lands when the user has not chosen: `<userData>/model`. */
export const defaultModelRoot = (userData: string): string => join(userData, "model");

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The saved config, or null when there is none or it is unreadable — never a half-config. */
export async function readModelConfig(userData: string): Promise<ModelConfig | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(modelConfigPath(userData), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (typeof parsed.root !== "string" || !parsed.root.trim()) return null;
  if (parsed.model !== null && typeof parsed.model !== "string") return null;
  if (parsed.url !== undefined && typeof parsed.url !== "string") return null;
  const cfg: ModelConfig = { root: parsed.root, model: parsed.model };
  if (typeof parsed.url === "string") cfg.url = parsed.url;
  return cfg;
}

export async function writeModelConfig(userData: string, cfg: ModelConfig): Promise<void> {
  if (cfg.url !== undefined && !isLoopbackUrl(cfg.url)) throw new NonLoopbackModelHost(cfg.url);
  await atomicWrite(modelConfigPath(userData), JSON.stringify(cfg, null, 2));
}

export interface ResolvedModelSettings {
  root: string;
  model: string | null;
  url: string;
  /** Where the winning `model`/`url` came from. */
  source: "env" | "file" | "default";
}

const trimmed = (v: string | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined);

/** env → file → defaults. Throws on a non-loopback url from either source. */
export function resolveModelSettings(
  env: Record<string, string | undefined>,
  file: ModelConfig | null,
  userData: string,
): ResolvedModelSettings {
  const envModel = trimmed(env.MADY_MODEL_NAME);
  const envUrl = trimmed(env.MADY_MODEL_URL);
  const url = (envUrl ?? file?.url ?? DEFAULT_MODEL_URL).replace(/\/+$/, "");
  if (!isLoopbackUrl(url)) throw new NonLoopbackModelHost(url);
  const fromEnv = envModel !== undefined || envUrl !== undefined;
  return {
    root: file?.root ?? defaultModelRoot(userData),
    model: envModel ?? file?.model ?? null,
    url,
    source: fromEnv ? "env" : file ? "file" : "default",
  };
}

// ---------------------------------------------------------------------------------------------
// The status the bar and the button key off
// ---------------------------------------------------------------------------------------------

/**
 * `none`          nothing of ours on disk, nothing answering — the button says "Set up a model…"
 * `runtime-only`  our Ollama is on disk but not answering (or no weights yet) — "Install a model…"
 * `server-only`   a server answers but does not hold the configured model — "Install a model…"
 * `ready`         a server answers and holds the model — the bar shows; the button is the chip
 */
export type ModelPhase = "none" | "runtime-only" | "server-only" | "ready";

export interface ModelStatus {
  settings: ResolvedModelSettings;
  runtimeInstalled: boolean;
  running: "external" | "ours" | "down";
  /** What the server holds, or null when it does not answer. */
  serverModels: string[] | null;
  ready: boolean;
  phase: ModelPhase;
  /** The automatic choice for this machine, or the stated refusal. */
  pick: ModelPick;
  catalogue: readonly ModelChoice[];
}

/** `gemma4` and `gemma4:latest` are the same model to Ollama; compare them as such. */
const canonicalTag = (t: string): string => (t.includes(":") ? t : `${t}:latest`);

/** Pure: everything observed → one object the dialog and the bar draw from. */
export function composeModelStatus(input: {
  settings: ResolvedModelSettings;
  runtimeInstalled: boolean;
  running: "external" | "ours" | "down";
  serverModels: string[] | null;
  totalMemBytes: number;
}): ModelStatus {
  const { settings, runtimeInstalled, running, serverModels } = input;
  const answering = serverModels !== null;
  const has = settings.model !== null && answering && serverModels.map(canonicalTag).includes(canonicalTag(settings.model));
  const phase: ModelPhase = has ? "ready" : answering ? "server-only" : runtimeInstalled ? "runtime-only" : "none";
  return {
    settings,
    runtimeInstalled,
    running,
    serverModels,
    ready: has,
    phase,
    pick: pickModelForMemory(input.totalMemBytes),
    catalogue: MODEL_CATALOGUE,
  };
}

// ---------------------------------------------------------------------------------------------
// The language-model switch
// ---------------------------------------------------------------------------------------------

/**
 * The language model — its button, its bar, its downloads — exists only in a run started with
 * `MADY_LLM=1` (`npm run dev:llm`). Everything else — the installed program and the
 * everyday `npm run dev` alike — has none of it: no button, no bar, `runtime:install` refuses, no
 * runtime at boot. The default development run is the version without the LLM.
 * Packaged or not makes no difference; the variable is the only switch, the same shape as the
 * other opt-in env vars (MADY_ENGINE_EXE, MADY_LIVE_AGENT_PORT).
 */
export function llmEnabled(env: Record<string, string | undefined>): boolean {
  return env.MADY_LLM === "1";
}
