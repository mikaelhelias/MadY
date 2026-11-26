// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BugReportDialog } from "./BugReportDialog";
import { clearCapturedErrors, clearEngineCalls, pushCapturedError, recordEngineCall } from "./bugReport";

afterEach(() => { cleanup(); clearCapturedErrors(); clearEngineCalls(); });

/**
 * "Copy report" is the delivery route for a user who has no way to send a `.zip` —
 * it needs no server, no account and no network code. These drive the real dialog because
 * the value of the feature is entirely in what reaches the clipboard: a unit test of
 * `assembleReport` cannot see a button wired to the wrong text, or to nothing at all.
 */
const CTX = {
  app: { name: "MadY", version: "0.4.1", electron: "42", chromium: "140", node: "22" },
  engine: { engine: "mady-dev-engine", contractVersion: 1, libraries: { numpy: "2.4.2" } },
  os: { platform: "win32", release: "10.0.26200", arch: "x64", totalMemMB: 32000, cpus: 12 },
  logTail: "saved to C:\\Users\\Alex Example\\autosave",
};

function stubBridge() {
  const copyTextToClipboard = vi.fn();
  (window as unknown as { mady: unknown }).mady = {
    bugReportContext: vi.fn().mockResolvedValue(CTX),
    bugReportSave: vi.fn().mockResolvedValue({ ok: true, path: "C:\\tmp\\r.zip" }),
    copyTextToClipboard,
  };
  return copyTextToClipboard;
}

describe("BugReportDialog — Copy report", () => {
  it("copies the report to the clipboard and confirms it", async () => {
    const copy = stubBridge();
    render(<BugReportDialog onClose={vi.fn()} />);
    const btn = await screen.findByRole("button", { name: "Copy report" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));

    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "Slope is wrong" } });
    fireEvent.click(btn);

    expect(copy).toHaveBeenCalledTimes(1);
    const text = copy.mock.calls[0]![0] as string;
    expect(text).toContain("# MadY bug report");
    expect(text).toContain("Slope is wrong");
    expect(text).toContain("MadY 0.4.1");
    // Not the placeholder the review pane shows — a real timestamp, as on save.
    expect(text).not.toContain("(set when you save)");
    expect(await screen.findByText(/Report copied/)).toBeTruthy();
  });

  it("copies the same username-redacted text the review pane shows", async () => {
    const copy = stubBridge();
    pushCapturedError("console", "boom at C:\\Users\\Alex Example\\app\\x.ts:3");
    render(<BugReportDialog onClose={vi.fn()} />);
    const btn = await screen.findByRole("button", { name: "Copy report" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);

    const text = copy.mock.calls[0]![0] as string;
    expect(text).toContain("boom at C:\\Users\\<user>\\app\\x.ts:3");
    expect(text).not.toContain("Alex Example");
  });

  it("the confirmation clears once the report it described has changed", async () => {
    stubBridge();
    render(<BugReportDialog onClose={vi.fn()} />);
    const btn = await screen.findByRole("button", { name: "Copy report" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    expect(await screen.findByText(/Report copied/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "different bug" } });
    await waitFor(() => expect(screen.queryByText(/Report copied/)).toBeNull());
  });

  it("never uploads: copying touches only the clipboard, not the save channel", async () => {
    const copy = stubBridge();
    const bridge = (window as unknown as { mady: Record<string, ReturnType<typeof vi.fn>> }).mady;
    render(<BugReportDialog onClose={vi.fn()} />);
    const btn = await screen.findByRole("button", { name: "Copy report" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);

    expect(copy).toHaveBeenCalledTimes(1);
    expect(bridge.bugReportSave).not.toHaveBeenCalled();
  });

  // Note: asserting only that the clipboard text lacks the document's contents would be a test
  // that cannot fail: `buildReportMarkdown` never interpolates `document.json`, just its name,
  // so the data could not appear there however the copy path were wired. The falsifiable
  // invariant is that copying does not serialize the document at all — so spy on the getter.
  it("does not even serialize the attached document when copying", async () => {
    const copy = stubBridge();
    const getDocumentJson = vi.fn(() => '{"secret":"patient data"}');
    render(<BugReportDialog onClose={vi.fn()} documentName="Assay" getDocumentJson={getDocumentJson} />);
    const btn = await screen.findByRole("button", { name: "Copy report" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("checkbox", { name: /whole document/i })); // opt the document IN
    fireEvent.click(btn);

    expect(getDocumentJson).not.toHaveBeenCalled();
    const text = copy.mock.calls.at(-1)![0] as string;
    expect(text).not.toContain("patient data");
    expect(text).toContain("document.mady"); // it is still named as a zip attachment
  });
});

/**
 * Per-piece consent. Every piece of information a report would carry is shown, and the user
 * can include or leave out each piece. Driven through the real dialog because the promise is
 * about what reaches the save payload, not what the pure assembler would produce in isolation.
 */
describe("BugReportDialog — per-piece consent", () => {
  const save = async (): Promise<void> => {
    const btn = await screen.findByRole("button", { name: /Save report/ });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(screen.queryByText(/Saved to/)).toBeTruthy());
  };
  const savedNames = (): string[] => {
    const bridge = (window as unknown as { mady: Record<string, ReturnType<typeof vi.fn>> }).mady;
    const files = bridge.bugReportSave!.mock.calls.at(-1)![0] as { name: string }[];
    return files.map((f) => f.name);
  };

  it("zero effort works: open → Save with nothing typed and nothing touched", async () => {
    // Filling in text and ticking boxes is optional: a user may simply press Save and do
    // nothing more. The defaults alone make a complete report, and no required field may
    // block this path.
    stubBridge();
    render(<BugReportDialog onClose={vi.fn()} />);
    await save();
    const names = savedNames();
    for (const name of ["report.md", "manifest.json", "app-log-tail.txt", "console-errors.log", "interactions.log"]) {
      expect(names, "the untouched defaults did not produce a full report").toContain(name);
    }
    const bridge = (window as unknown as { mady: Record<string, ReturnType<typeof vi.fn>> }).mady;
    const files = bridge.bugReportSave!.mock.calls.at(-1)![0] as { name: string; content: string }[];
    const md = files.find((f) => f.name === "report.md")!.content;
    expect(md).toContain("(no description provided)"); // empty text is stated, never rejected
  });

  it("every piece has its own labelled tickbox; the data-bearing ones start unticked", async () => {
    stubBridge();
    render(<BugReportDialog onClose={vi.fn()} documentName="Assay" getDocumentJson={() => "{}"} />);
    await screen.findByRole("button", { name: "Copy report" });
    const on = ["App, OS & stats-engine versions", "What was on screen", "Captured errors", "Recent clicks & drags", "Application log"];
    const off = ["Statistics engine calls", "whole document"];
    for (const name of on) {
      expect((screen.getByRole("checkbox", { name: new RegExp(name, "i") }) as HTMLInputElement).checked, `${name} should start ticked`).toBe(true);
    }
    for (const name of off) {
      expect((screen.getByRole("checkbox", { name: new RegExp(name, "i") }) as HTMLInputElement).checked, `${name} carries data and must start unticked`).toBe(false);
    }
  });

  it("unticking a piece keeps its file out of the save payload; ticking adds it", async () => {
    stubBridge();
    // The engine-calls tickbox is rightly disabled while the ring is empty — record one
    // real-shaped call so the opt-in is live.
    recordEngineCall({ method: "ttest", ok: true, ms: 9, request: '{"columns":[1,2]}', response: '{"p":0.03}' });
    render(<BugReportDialog onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "Copy report" });
    fireEvent.click(screen.getByRole("checkbox", { name: /Captured errors/i })); // off
    fireEvent.click(screen.getByRole("checkbox", { name: /Statistics engine calls/i })); // on
    await save();
    const names = savedNames();
    expect(names, "the withheld errors file rode along anyway").not.toContain("console-errors.log");
    expect(names, "the opted-in engine calls did not ride").toContain("engine-calls.json");
    expect(names).toContain("interactions.log"); // default-on piece still there
  });

  it("the analysis attachment serializes only on save and only when ticked", async () => {
    stubBridge();
    const getAnalysis = vi.fn(() => ({ name: "Welch on Sample", method: "ttest", params: "{}", result: "{}", data: { Dose: [1] } }));
    const copyBtnFirst = render(
      <BugReportDialog onClose={vi.fn()} analysisName="Welch on Sample" getAnalysis={getAnalysis} />,
    );
    const copyBtn = await screen.findByRole("button", { name: "Copy report" });
    await waitFor(() => expect((copyBtn as HTMLButtonElement).disabled).toBe(false));
    const box = screen.getByRole("checkbox", { name: /Welch on Sample/i }) as HTMLInputElement;
    expect(box.checked, "an analysis carries data and must start unticked").toBe(false);
    fireEvent.click(box);
    fireEvent.click(copyBtn);
    expect(getAnalysis, "copying serialized the analysis — copy is text-only").not.toHaveBeenCalled();
    await save();
    expect(getAnalysis).toHaveBeenCalledTimes(1);
    expect(savedNames()).toContain("analysis.json");
    copyBtnFirst.unmount();
  });

  it("a screenshot is offered only when the bridge can take one, and rides as a binary entry", async () => {
    stubBridge();
    const bridge = (window as unknown as { mady: Record<string, unknown> }).mady;
    (bridge as Record<string, unknown>).bugReportScreenshot = vi.fn().mockResolvedValue({ ok: true, base64: "aGVsbG8=" });
    render(<BugReportDialog onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "Copy report" });
    fireEvent.click(screen.getByRole("checkbox", { name: /screenshot/i }));
    await save();
    const files = (bridge as { bugReportSave: ReturnType<typeof vi.fn> }).bugReportSave.mock.calls.at(-1)![0] as { name: string; base64?: boolean }[];
    const shot = files.find((f) => f.name === "screenshot.png");
    expect(shot, "the ticked screenshot did not ride").toBeTruthy();
    expect(shot!.base64, "the screenshot must be flagged binary or the zip corrupts it").toBe(true);
  });

  it("no screenshot row at all when the bridge cannot capture one", async () => {
    stubBridge();
    render(<BugReportDialog onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "Copy report" });
    expect(screen.queryByRole("checkbox", { name: /screenshot/i }), "a screenshot tickbox with nothing behind it").toBeNull();
  });
});
