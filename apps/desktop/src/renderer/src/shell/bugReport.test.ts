// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  assembleReport,
  buildEmailBody,
  buildMailtoUrl,
  BUG_REPORT_EMAIL,
  buildManifest,
  clearCapturedErrors,
  clearEngineCalls,
  clearInteractions,
  describeTarget,
  installErrorCapture,
  installInteractionCapture,
  pushCapturedError,
  pushInteraction,
  noteDocVersion,
  recentEngineCalls,
  recentErrors,
  recentInteractions,
  recordEngineCall,
  redactPaths,
  DEFAULT_INCLUDE,
  type AssembleInput,
  type IncludeFlags,
} from "./bugReport";

afterEach(() => {
  clearCapturedErrors();
  clearInteractions();
  clearEngineCalls();
});

// The ring buffer is the part with real logic; the window `error` / `unhandledrejection`
// / `console.error` wiring is thin glue that just calls `pushCapturedError`, and jsdom
// does not deliver window `error` events to `addEventListener` the way a real browser
// does — so DOM-event delivery is left to the running app, and the storage is tested here.
describe("error capture ring", () => {
  it("stores errors newest-last, timestamped, and caps the buffer at 50", () => {
    for (let i = 0; i < 80; i++) pushCapturedError("boundary", `e${i}`);
    const got = recentErrors();
    expect(got.length).toBe(50);
    expect(got.at(-1)!.message).toBe("e79"); // newest kept
    expect(got[0]!.message).toBe("e30"); // oldest 30 dropped
    expect(got[0]!.source).toBe("boundary");
    expect(got[0]!.when).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("installErrorCapture is idempotent and never throws", () => {
    expect(() => {
      installErrorCapture();
      installErrorCapture();
    }).not.toThrow();
  });
});

describe("mailto delivery", () => {
  it("addresses the MadY inbox and puts the summary in the subject", () => {
    const url = buildMailtoUrl(baseInput());
    expect(url.startsWith(`mailto:${BUG_REPORT_EMAIL}?`)).toBe(true);
    expect(decodeURIComponent(url)).toContain("subject=MadY bug: Methods draft is wrong");
  });

  it("the body carries the description + versions, path-redacted", () => {
    const body = buildEmailBody(baseInput());
    expect(body).toContain("The CI sentence makes no sense");
    expect(body).toContain("MadY 0.4.1");
    expect(body).not.toContain("Alex Example"); // the error message's path is scrubbed
    expect(body).toContain("<user>");
  });

  it("honours consent — a withheld environment stays out of the email", () => {
    const body = buildEmailBody(baseInput({ include: { ...DEFAULT_INCLUDE, environment: false } }));
    expect(body).not.toContain("MadY 0.4.1");
    expect(body).not.toContain("OS:");
  });

  it("caps an over-long body so the mailto URL stays under the client limit", () => {
    const body = buildEmailBody(baseInput({ form: { title: "t", description: "x".repeat(5000), category: "other" } }));
    expect(body.length).toBeLessThanOrEqual(1400 + 60);
    expect(body).toContain("truncated");
  });

  it("tells the user to attach the .zip for the pieces mailto can't carry", () => {
    expect(buildEmailBody(baseInput())).toContain("Save report (.zip)");
  });
});

describe("redactPaths", () => {
  it("scrubs the username from Windows and POSIX home paths", () => {
    expect(redactPaths("at C:\\Users\\Alex Example\\app\\x.ts:3")).toBe("at C:\\Users\\<user>\\app\\x.ts:3");
    expect(redactPaths("/Users/alex/dev/a.ts and /home/alex/b")).toBe("/Users/<user>/dev/a.ts and /home/<user>/b");
  });
  it("leaves ordinary text untouched", () => {
    expect(redactPaths("no paths here")).toBe("no paths here");
  });
});

const CTX = {
  app: { name: "MadY", version: "0.4.1", electron: "42", chromium: "140", node: "22" },
  engine: { engine: "mady-dev-engine", contractVersion: 1, libraries: { numpy: "2.4.2", scipy: "1.17.1" } },
  os: { platform: "win32", release: "10.0.26200", arch: "x64", totalMemMB: 32000, cpus: 12 },
  logTail: "line saved to C:\\Users\\Alex Example\\autosave\n[sidecar] engine ready",
};

const baseInput = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  form: { title: "Methods draft is wrong", description: "The CI sentence makes no sense", category: "wrong-result" },
  ctx: CTX,
  errors: [{ when: "2026-07-23T08:00:00.000Z", source: "console", message: "engine at C:\\Users\\Alex Example\\x failed" }],
  build: "abc1234+",
  edition: "Standard",
  whenISO: "2026-07-23T08:26:16.789Z",
  ...over,
});

describe("assembleReport", () => {
  it("names the archive from the timestamp and emits the standard file set", () => {
    const r = assembleReport(baseInput());
    expect(r.stem).toBe("mady-bug-20260723-082616");
    expect(r.files.map((f) => f.name)).toEqual(["report.md", "manifest.json", "app-log-tail.txt", "console-errors.log"]);
  });

  it("redacts usernames from the log tail and captured errors", () => {
    const r = assembleReport(baseInput());
    const byName = Object.fromEntries(r.files.map((f) => [f.name, f.content]));
    expect(byName["app-log-tail.txt"]).not.toContain("Alex Example");
    expect(byName["app-log-tail.txt"]).toContain("C:\\Users\\<user>\\autosave");
    expect(byName["console-errors.log"]).not.toContain("Alex Example");
  });

  it("attaches the document only when one is provided (opt-in)", () => {
    expect(assembleReport(baseInput()).files.some((f) => f.name === "document.mady")).toBe(false);
    const withDoc = assembleReport(baseInput({ document: { name: "Assay", json: '{"tables":[]}' } }));
    const doc = withDoc.files.find((f) => f.name === "document.mady");
    expect(doc?.content).toBe('{"tables":[]}');
    expect(withDoc.reportMarkdown).toContain("document.mady");
  });

  it("manifest carries the triage fields (no free-form log)", () => {
    const m = buildManifest(baseInput({ document: { name: "Assay", json: "{}" } }));
    expect(m).toMatchObject({
      // schema 2 carries the per-piece consent list (`included`).
      schema: 2, category: "wrong-result", build: "abc1234+", edition: "Standard",
      errorCount: 1, documentAttached: true,
    });
    expect(m.engine?.libraries).toEqual({ numpy: "2.4.2", scipy: "1.17.1" });
    expect(JSON.stringify(m)).not.toContain("autosave"); // the log tail is not in the manifest
  });

  // report.md carries the captured errors too ("## Recent errors"), and it is the text the
  // review pane shows and the text "Copy report" puts on the clipboard — i.e. the copy most
  // likely to be pasted somewhere public. Its errors are scrubbed exactly like the identical
  // content in console-errors.log.
  it("redacts usernames from the errors inside report.md, not just the attachment", () => {
    const md = assembleReport(baseInput()).reportMarkdown;
    expect(md).toContain("## Recent errors (1)");
    expect(md).not.toContain("Alex Example");
    expect(md).toContain("C:\\Users\\<user>\\x failed");
  });

  it("the report names the engine libraries and the build", () => {
    const md = assembleReport(baseInput()).reportMarkdown;
    expect(md).toContain("build `abc1234+`");
    expect(md).toContain("numpy 2.4.2, scipy 1.17.1");
    expect(md).toContain("Wrong result / output");
  });
});

// ─── The interaction trail — evidence for the bug that throws nothing ────────
describe("interaction trail", () => {
  it("records clicks and drags with the doc version, capped at 80", () => {
    noteDocVersion(7);
    for (let i = 0; i < 100; i++) pushInteraction({ kind: "click", target: `button.t${i}` });
    const got = recentInteractions();
    expect(got.length).toBe(80);
    expect(got.at(-1)!.target).toBe("button.t99");
    expect(got[0]!.v).toBe(7);
  });

  it("a real >4px press-move-release is recorded as a drag; a still press is a click", () => {
    installInteractionCapture();
    const el = document.createElement("button");
    el.setAttribute("data-mady-series", "s1");
    document.body.appendChild(el);
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 50, clientY: 10 }));
    const drag = recentInteractions().find((i) => i.kind === "drag");
    expect(drag, "a 40px pointer travel was not recorded as a drag").toBeTruthy();
    expect(drag!.travel).toBe(40);
    expect(drag!.target).toContain("data-mady-series=s1");
    clearInteractions();
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 11, clientY: 10 }));
    expect(recentInteractions().some((i) => i.kind === "drag"), "a 1px press was recorded as a drag").toBe(false);
    el.remove();
  });

  it("describeTarget carries hooks and a snippet of text, never the full content", () => {
    const el = document.createElement("td");
    el.className = "dgcell dgnum extra classes beyond three";
    el.textContent = "a very long confidential cell value that must not ride out in full 123456789";
    const d = describeTarget(el);
    expect(d).toContain("td");
    expect(d).toContain("…");
    expect(d).not.toContain("123456789"); // the tail of the text stayed home
    expect(d.length).toBeLessThanOrEqual(160);
  });
});

// ─── The engine-call ring — the byte-exact replay for wrong-result reports ───
describe("engine-call ring", () => {
  it("caps at 8 calls and truncates an oversize request, saying so", () => {
    for (let i = 0; i < 12; i++) {
      recordEngineCall({ method: `m${i}`, ok: true, ms: 5, request: "x".repeat(150_000), response: "{}" });
    }
    const got = recentEngineCalls();
    expect(got.length).toBe(8);
    expect(got.at(-1)!.method).toBe("m11");
    expect(got[0]!.request.length).toBeLessThan(150_000);
    expect(got[0]!.request).toContain("truncated, 150000 chars total");
  });
});

// ─── Per-piece consent — every flag adds exactly its file, and the report says so ───
describe("per-piece consent", () => {
  const ALL_ON: IncludeFlags = {
    environment: true, logTail: true, errors: true, state: true, interactions: true,
    engineCalls: true, analysis: true, screenshot: true, document: true,
  };
  const ALL_OFF: IncludeFlags = {
    environment: false, logTail: false, errors: false, state: false, interactions: false,
    engineCalls: false, analysis: false, screenshot: false, document: false,
  };
  const richInput = (include: IncludeFlags): AssembleInput =>
    baseInput({
      include,
      state: { activeTab: "plot", plotKind: "heatmap", plotName: "Gene expression heatmap", zoom: 1 },
      interactions: [{ when: "2026-08-14T10:00:00.000Z", kind: "drag", target: "text “GeneA” at C:\\Users\\Alex Example\\x", travel: 40, v: 3 }],
      engineCalls: [{ when: "2026-08-14T10:00:01.000Z", method: "ttest", ok: true, ms: 12, request: '{"columns":[1,2]}', response: '{"p":0.03}' }],
      analysis: { name: "Welch on Sample", method: "ttest", params: '{"variant":"welch"}', result: '{"p":0.03}', data: { Dose: [1, 2], Response: [3, 4] } },
      screenshotAttached: true,
      document: { name: "Assay", json: '{"tables":[]}' },
    });

  it("everything on emits every file; everything off emits only report.md + manifest.json", () => {
    const on = assembleReport(richInput(ALL_ON)).files.map((f) => f.name);
    expect(on).toEqual([
      "report.md", "manifest.json", "app-log-tail.txt", "console-errors.log",
      "interactions.log", "engine-calls.json", "analysis.json", "document.mady",
    ]);
    const off = assembleReport(richInput(ALL_OFF)).files.map((f) => f.name);
    expect(off, "a withheld piece still rode along").toEqual(["report.md", "manifest.json"]);
  });

  it("the disclosure section names every piece, ticked or withheld", () => {
    const md = assembleReport(richInput({ ...ALL_ON, document: false, engineCalls: false })).reportMarkdown;
    expect(md).toContain("## What this report contains");
    expect(md).toContain("- [x] App, OS & stats-engine versions");
    expect(md).toContain("- [ ] The whole document — includes all data — withheld");
    expect(md).toContain("- [ ] Statistics engine calls — includes analysis input data — withheld");
    expect(md).toContain("- [x] Recent clicks & drags");
  });

  it("withholding the environment nulls it in the manifest too — not just the prose", () => {
    const m = buildManifest(richInput({ ...ALL_ON, environment: false }));
    expect(m.app).toBeNull();
    expect(m.os).toBeNull();
    expect(m.engine).toBeNull();
    expect(m.included.environment).toBe(false);
  });

  it("the interaction trail is path-redacted, in the file and in report.md", () => {
    const r = assembleReport(richInput(ALL_ON));
    const trail = r.files.find((f) => f.name === "interactions.log")!.content;
    expect(trail).not.toContain("Alex Example");
    expect(r.reportMarkdown).not.toContain("Alex Example");
  });

  it("DEFAULT_INCLUDE ships the context and withholds everything that carries data", () => {
    expect(DEFAULT_INCLUDE).toEqual({
      environment: true, logTail: true, errors: true, state: true, interactions: true,
      engineCalls: false, analysis: false, screenshot: false, document: false,
    });
  });
});
