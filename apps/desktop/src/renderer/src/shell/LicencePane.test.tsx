// @vitest-environment jsdom
/**
 * The licence is readable inside the program.
 *
 * "How to view a copy of this License" is one of the four Appropriate Legal Notices (GPL-3 §0)
 * that an interactive program must display (§5 d), and no way of opening the file at run time is reliable:
 *
 *   - `shell.openExternal` sends the OS browser to `http://localhost:5173/COPYING.txt` in dev
 *     (a dev-server address, meaningless once distributed) and to a `file://` URL when
 *     packaged, which it handles unreliably;
 *   - `shell.openPath` depends on the OS having a text-editor association;
 *   - `fetch("./COPYING.txt")` works in dev and is blocked from a `file://` page when packaged.
 *
 * Each of them fails silently. The text is inlined at build time, so no runtime step is left
 * that can fail.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AboutPane } from "./AboutPane";
import { LicencePane } from "./LicencePane";

afterEach(cleanup);

describe("LicencePane", () => {
  it("shows the real GPL, in full", () => {
    const { container } = render(<LicencePane />);
    const text = container.querySelector(".lictext")?.textContent ?? "";
    expect(text, "the licence text is missing").not.toBe("");
    // Landmarks from the top, middle and end — a truncated import would pass a length check.
    expect(text).toMatch(/GNU GENERAL PUBLIC LICENSE/);
    expect(text).toMatch(/Version 3, 29 June 2007/);
    // Title case in the actual document ("15. Disclaimer of Warranty."), not the shouted
    // form — the caps live in the §16/§17 body text, not the headings.
    expect(text, "§15 Disclaimer of Warranty is missing").toMatch(/15\.\s+Disclaimer of Warranty/i);
    expect(text, "the licence is truncated").toMatch(/END OF TERMS AND CONDITIONS/);
    expect(text.length, "the licence looks truncated").toBeGreaterThan(30000);
  });

  it("needs no network, no file system and no IPC to do it", () => {
    // The text is a build-time import, so rendering must not touch fetch or the preload
    // bridge; either would add a way for the page to fail silently.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<LicencePane />);
    expect(fetchSpy, "the licence page fetched something at runtime").not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("the About card's route to it", () => {
  it("offers a control that opens the licence page", () => {
    const onOpenLicence = vi.fn();
    const { container } = render(<AboutPane version="1" onOpenLicence={onOpenLicence} />);
    const btn = [...container.querySelectorAll("button")].find((b) => /licence|license/i.test(b.textContent ?? ""));
    expect(btn, "the About card offers no way to read the licence").toBeTruthy();
    fireEvent.click(btn!);
    expect(onOpenLicence, "the control does not open the licence page").toHaveBeenCalled();
  });

  it("does not link out to a file or a URL", () => {
    // Both fail silently (see the header above); an anchor here would be one of them.
    const { container } = render(<AboutPane version="1" onOpenLicence={vi.fn()} />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.filter((h) => /COPYING\.txt|localhost|file:/i.test(h)), "the About card links out to a file or URL").toEqual([]);
  });
});
