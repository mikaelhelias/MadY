/**
 * The model catalogue — the Gemma 4 variants MadY offers, the sizes the set-up dialog states,
 * and the rule that picks one for this computer without asking.
 *
 * Shared by the main process (status, the automatic pick) and the renderer (the dialog), so a
 * tag or a number cannot be spelt two ways. Ollama's registry knows `gemma4:e4b`; a pull of a
 * hyphenated spelling such as `gemma-4-e4b` fails.
 *
 * ## Where the numbers come from (registry.ollama.ai manifests)
 *
 * `expectedBytes` is the sum of the manifest's layers — what `ollama pull` will fetch — and
 * `parameters` / `quant` are from each manifest's config blob. All three are Q4_K_M. Note the
 * 12B is smaller on disk than the E4B (7.04 vs 8.95 GiB): the "e" variants carry per-layer
 * embeddings that the plain 12B does not. These are expected sizes for the dialog's "~"; the
 * server's own figure, once it is running, is what the pull confirms against.
 *
 * ## The pick
 *
 * Prefer the measured model — `gemma4:12b`, the one with the fewest wrong answers on the
 * command corpus (`commandCorpus.ts`) — whenever it fits. Fall back to the smallest file
 * when only that fits. Never auto-pick the E4B: it is the largest download and unmeasured;
 * it stays available through the dialog's "change" link. Refuse with a clear reason when nothing fits,
 * naming the machine's memory and the smallest need, rather than picking a model that will
 * not load.
 *
 * "Fits" = the file plus `headroomBytes` for the OS, the app and the working memory (the KV
 * cache for a 262k-context model is not small). The headroom is a stated constant, not a
 * hidden allowance.
 */

export const GiB = 1024 ** 3;

export interface ModelChoice {
  /** Ollama's tag, exactly as `ollama pull` wants it. */
  tag: string;
  /** Short label for the dialog. */
  label: string;
  /** Parameter count as the registry states it. */
  parameters: string;
  quant: "Q4_K_M";
  /** Expected download (sum of manifest layers), for the "~" before the server states it. */
  expectedBytes: number;
  /** Memory needed beyond the file itself to run: OS + app + working memory. */
  headroomBytes: number;
  /** One sentence, plain words, for the dialog. */
  blurb: string;
  /** True for the one variant whose command accuracy was measured. */
  measured: boolean;
}

const HEADROOM = 3 * GiB;

export const MODEL_CATALOGUE: readonly ModelChoice[] = [
  {
    tag: "gemma4:e2b",
    label: "Gemma 4 E2B",
    parameters: "5.1B",
    quant: "Q4_K_M",
    expectedBytes: 7_162_405_413,
    headroomBytes: HEADROOM,
    blurb: "The lightest Gemma 4: the same job, a little less accurate at picking the right command, and the fastest to answer.",
    measured: false,
  },
  {
    tag: "gemma4:e4b",
    label: "Gemma 4 E4B",
    parameters: "8.0B",
    quant: "Q4_K_M",
    expectedBytes: 9_608_350_245,
    headroomBytes: HEADROOM,
    blurb: "The middle Gemma 4 and the largest download of the three; its accuracy on MadY's commands has not been measured.",
    measured: false,
  },
  {
    tag: "gemma4:12b",
    label: "Gemma 4 12B",
    parameters: "11.9B",
    quant: "Q4_K_M",
    expectedBytes: 7_556_507_848,
    headroomBytes: HEADROOM,
    blurb: "The recommended Gemma 4 for turning your sentence into MadY commands.",
    measured: true,
  },
];

/** The one variant with a measured wrong-rate. */
export const MEASURED_MODEL = "gemma4:12b";

export function modelByTag(tag: string): ModelChoice | undefined {
  return MODEL_CATALOGUE.find((m) => m.tag === tag);
}

const gib = (b: number): string => `${(b / GiB).toFixed(1)} GiB`;

export type ModelPick =
  | { ok: true; model: ModelChoice; reason: string }
  | { ok: false; reason: string };

/**
 * Pick for `totalMemBytes` of installed memory. See the header for the rule.
 */
export function pickModelForMemory(totalMemBytes: number): ModelPick {
  const fits = (m: ModelChoice): boolean => totalMemBytes >= m.expectedBytes + m.headroomBytes;
  const measured = modelByTag(MEASURED_MODEL)!;
  if (fits(measured)) {
    return {
      ok: true,
      model: measured,
      reason: `${gib(totalMemBytes)} of memory fits the ${measured.label}, the one measured on MadY's commands`,
    };
  }
  // Only what fits, smallest file first — never the unmeasured E4B by default (it is the largest anyway).
  const fallback = MODEL_CATALOGUE.filter((m) => !m.measured && fits(m)).sort((a, b) => a.expectedBytes - b.expectedBytes)[0];
  if (fallback) {
    return {
      ok: true,
      model: fallback,
      reason: `${gib(totalMemBytes)} of memory is too little for the ${measured.label}; the ${fallback.label} fits`,
    };
  }
  const smallest = [...MODEL_CATALOGUE].sort((a, b) => a.expectedBytes - b.expectedBytes)[0]!;
  return {
    ok: false,
    reason:
      `this computer has ${gib(totalMemBytes)} of memory; the lightest Gemma 4 needs about ` +
      `${gib(smallest.expectedBytes + smallest.headroomBytes)} (${gib(smallest.expectedBytes)} of model plus room to run)`,
  };
}
