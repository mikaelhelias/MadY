/**
 * Durable store — makes the user's style library (custom presets, saved
 * templates, default-preset profile) survive things that wipe `localStorage`.
 *
 * `localStorage` is fast but fragile: "clear site data" erases it, and the
 * packaged (`file://`) app is a *different origin* from the dev
 * (`http://localhost`) app, so each starts blank. So that the user never loses
 * their presets, the durable keys are mirrored to a JSON file in `userData`
 * (`main/userLibrary.ts`), and on launch reconcile the file with localStorage.
 *
 * Reads/writes stay synchronous against localStorage (so the preset modules keep
 * their simple API); every write also schedules a debounced async mirror to the
 * file. {@link hydrateUserLibrary} runs once at startup, before the modules first
 * read, to restore any keys localStorage is missing.
 *
 * Key-agnostic: the file stores each key's raw JSON string, so preset/template/
 * profile schemas + migrations stay entirely inside their own modules.
 */

/** The localStorage keys that hold the user's portable creative work. */
export const DURABLE_KEYS = [
  "mady.userPresets.v1", // custom style presets
  "mady.templates.v1", // saved templates ("My templates") — converted into presets once at startup
  "mady.figureTemplates.v1", // saved multi-panel figure arrangements
  "mady.profile.presetName", // the chosen MadY default
  "mady.profile.perKind", // per-graph-type default presets
  "mady.profile.params", // global common style defaults
  "mady.profile.app", // application preferences (default type/conf/theme/autosave)
  "mady.profile.analysisDefaults", // per-method remembered analysis options
] as const;

interface UserLibraryShape {
  v: 1;
  savedAt: number;
  data: Record<string, string>;
}

const ls = (): Storage | undefined => globalThis.localStorage;
const bridge = (): typeof window.mady | undefined =>
  typeof window !== "undefined" ? window.mady : undefined;

// ---- synchronous localStorage access + debounced file mirror ----------------

export function dGet(key: string): string | null {
  try {
    return ls()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function dSet(key: string, value: string): void {
  try {
    ls()?.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — the file mirror is the fallback */
  }
  scheduleMirror();
}

export function dRemove(key: string): void {
  try {
    ls()?.removeItem(key);
  } catch {
    /* ignore */
  }
  scheduleMirror();
}

/** Snapshot the durable keys currently in localStorage into a library bundle. */
function snapshot(savedAt: number): UserLibraryShape {
  const data: Record<string, string> = {};
  for (const k of DURABLE_KEYS) {
    const v = dGet(k);
    if (v != null) data[k] = v;
  }
  return { v: 1, savedAt, data };
}

let mirrorTimer: ReturnType<typeof setTimeout> | null = null;
/** Coalesce bursts of writes (e.g. saving a preset touches two keys) into one file write. */
function scheduleMirror(): void {
  const g = bridge();
  if (!g?.userLibWrite) return; // not in Electron (browser preview / tests)
  if (mirrorTimer) clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null;
    // localStorage stays the source of truth, so a failed mirror isn't user-facing — but a
    // failure can arrive two ways (the {ok:false} result and the catch), and swallowing both
    // would make a persistently-failing backup invisible. Warn to the console so it's diagnosable.
    void g
      .userLibWrite(snapshot(Date.now()))
      .then((res) => {
        if (!res?.ok) console.warn("[style-library] backup mirror to userData failed — presets remain in localStorage only");
      })
      .catch((err) => console.warn("[style-library] backup mirror to userData threw:", err));
  }, 400);
}

/** Merge an incoming key value into the existing one: array keys union by id
 *  (incoming wins on clash, nothing is deleted); scalar keys keep the existing
 *  value unless it's absent. Used by Import so it never destroys current work. */
function mergeValue(existingRaw: string | null, incomingRaw: string): string {
  try {
    const inc = JSON.parse(incomingRaw) as unknown;
    if (Array.isArray(inc)) {
      const ex = existingRaw ? (JSON.parse(existingRaw) as unknown) : [];
      const exArr = Array.isArray(ex) ? ex : [];
      const byId = new Map<string, unknown>();
      // Items without an id (saved templates: `{name, kind, style}`) are kept and
      // appended — an id-keyed union alone would drop them from both sides, so an Import would
      // wipe every saved template while the panel reported "merged in".
      const idless: unknown[] = [];
      const keyOf = (it: unknown): string | null =>
        it && typeof it === "object" && typeof (it as { id?: unknown }).id === "string"
          ? (it as { id: string }).id
          : null;
      for (const it of exArr) { const id = keyOf(it); if (id) byId.set(id, it); else idless.push(it); }
      for (const it of inc) { const id = keyOf(it); if (id) byId.set(id, it); else idless.push(it); }
      return JSON.stringify([...byId.values(), ...idless]);
    }
    return existingRaw ?? incomingRaw; // scalar (default preset): don't hijack
  } catch {
    return existingRaw ?? incomingRaw;
  }
}

// ---- startup reconciliation + Export / Import -------------------------------

/**
 * Reconcile the userData file with localStorage. Call once, awaited, before the
 * preset/template/profile modules first read. For each durable key missing in
 * localStorage but present in the file → restore it (recovers a wipe / a fresh
 * origin). Then mirror the union back to the file so localStorage-only data
 * (e.g. data written before the file existed) is backed up. No-op outside Electron.
 */
export async function hydrateUserLibrary(): Promise<void> {
  const g = bridge();
  if (!g?.userLibRead || !g.userLibWrite) return;
  let file: UserLibraryShape | null = null;
  try {
    file = (await g.userLibRead()) as UserLibraryShape | null;
  } catch {
    return; // can't read the slot → leave localStorage untouched
  }
  let restored = false;
  if (file?.data) {
    for (const k of DURABLE_KEYS) {
      const cur = dGet(k);
      const fromFile = file.data[k];
      if ((cur == null || cur === "") && typeof fromFile === "string") {
        try { ls()?.setItem(k, fromFile); restored = true; } catch { /* ignore */ }
      }
    }
  }
  /**
   * Back up the current (possibly just-restored) union to the file.
   *
   * Never write an empty snapshot over a file that had content. This mirror exists so that
   * clearing browser storage cannot lose someone's presets; writing `{}` over it at startup is
   * the precise failure it was built to prevent, and it is silent.
   */
  const next = snapshot(Date.now());
  const hadContent = !!file?.data && Object.keys(file.data).length > 0;
  const writingNothing = Object.keys(next.data ?? {}).length === 0;
  if (!(hadContent && writingNothing)) {
    try {
      await g.userLibWrite(next);
    } catch {
      /* best-effort */
    }
  }
  return void restored;
}

export type ExportResult = { ok: true; path: string } | { ok: false; canceled?: boolean; error?: string };
export type ImportResult = { ok: true; added: number } | { ok: false; canceled?: boolean; error?: string };

/** Export the current style library to a user-chosen portable `.json`. */
export async function exportUserLibrary(): Promise<ExportResult> {
  const g = bridge();
  if (!g?.userLibExport) return { ok: false, error: "Export needs the desktop app." };
  return g.userLibExport(snapshot(Date.now()));
}

/**
 * Pick + import a previously exported library, merging it into localStorage
 * (union by id — never deletes existing presets) and mirroring the result.
 * Returns the number of distinct keys touched. The caller refreshes its UI.
 */
export async function importUserLibrary(): Promise<ImportResult> {
  const g = bridge();
  if (!g?.userLibImport) return { ok: false, error: "Import needs the desktop app." };
  const res = await g.userLibImport();
  if (!res.ok) return res;
  let added = 0;
  const data = (res.lib as UserLibraryShape).data ?? {};
  for (const k of DURABLE_KEYS) {
    const incoming = data[k];
    if (typeof incoming !== "string") continue;
    const merged = mergeValue(dGet(k), incoming);
    try { ls()?.setItem(k, merged); added++; } catch { /* ignore */ }
  }
  scheduleMirror();
  return { ok: true, added };
}
