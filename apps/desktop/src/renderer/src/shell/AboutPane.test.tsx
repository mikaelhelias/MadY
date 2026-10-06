// @vitest-environment jsdom
/**
 * The About tab — what this copy of the program says about itself.
 *
 * Every fact here is one a user goes looking for when something is wrong (which version am
 * I on?) or when they are deciding whether they may pass the program on (what licence?), so
 * an out-of-date or missing one is worse than an unpolished card.
 *
 * Note: these are the four GPL §0 checks for the legal display; they live with the card, so the
 * guard moves wherever the About card does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AboutPane, buildYear, citation } from "./AboutPane";

afterEach(cleanup);

describe("AboutPane — the About card", () => {
  it("shows the running version, the author and the licence", () => {
    const { container } = render(<AboutPane version="0.0.0+2026-08-04" />);
    const about = container.querySelector(".about")!;
    expect(about, "no About card on the About tab").toBeTruthy();
    const text = about.textContent ?? "";
    expect(text).toContain("MadY");
    expect(text, "the version the user is running must be visible").toContain("0.0.0+2026-08-04");
    expect(text).toContain("Mikael Elias");
    expect(text).toMatch(/GNU General Public License/i);
  });

  /**
   * "How do I say this?" is asked the moment someone has to tell a colleague what they used,
   * and the About card is where they go looking. IPA is matched by its exact glyphs — the
   * stress mark (U+02C8) and the ash (U+00E6) — because flattening them to ASCII would leave
   * the sentence readable and destroy the only precise part of it without any test noticing.
   */
  it("says how the name is pronounced, in both notations", () => {
    const { container } = render(<AboutPane version="1" />);
    const text = container.querySelector(".about")!.textContent ?? "";
    expect(text, "no IPA on the About card").toContain("/ˈmædi/");
    expect(text, "no plain respelling — IPA alone assumes the reader knows it").toContain("MAD-ee");
    expect(
      container.querySelector(".about-name")!.textContent,
      "the phonetics are folded into the heading — a screen reader reads them as part of the name",
    ).toBe("MadY");
  });

  it("carries all four things GPL-3 §0 requires of an Appropriate Legal Notices display", () => {
    // This card is that display, and §5(d) only forces a modified version to keep showing it
    // while it still qualifies. Drop any one of these and the protection quietly lapses —
    // which is exactly the kind of thing nobody notices until it matters.
    const { container } = render(<AboutPane version="1" />);
    const text = container.querySelector(".about")!.textContent ?? "";
    expect(text, "1. a copyright notice").toMatch(/©\s*2026\s+Mikael Elias/);
    // The substance is required, the capitals are not: §0 asks the display to say there is
    // no warranty, not to say it in capitals. The conspicuous all-caps form lives in the
    // licence itself (§15–17), which is where "conspicuous" is a legal requirement.
    expect(text, "2. that there is no warranty").toMatch(/no warranty of any kind/i);
    expect(text, "3. that the user may redistribute under the GPL").toMatch(/share and modify it under the GNU General Public License/i);
    // 4. how to view the licence — offline, since the program never phones home.
    // Note: the licence opens through a control that shows the in-app Licence page (an
    // out-of-app route can fail silently). §0 requires a working way to read the licence from
    // here; asserted by behaviour rather than by tag, so a change of mechanism cannot quietly
    // drop it.
    const open = vi.fn();
    cleanup();
    const { container: c2 } = render(<AboutPane version="1" onOpenLicence={open} />);
    const read = [...c2.querySelectorAll("button")].find((b) => /licence|license/i.test(b.textContent ?? ""));
    expect(read, "4. no way to read the licence itself").toBeTruthy();
    fireEvent.click(read!);
    expect(open, "4. the way to read the licence does nothing").toHaveBeenCalled();
  });

  it("shows the startup artwork — the same image the program opens with", () => {
    const { container } = render(<AboutPane version="1" />);
    const img = container.querySelector<HTMLImageElement>(".about-art")!;
    expect(img, "no artwork on the About card").toBeTruthy();
    expect(img.getAttribute("src")).toMatch(/splash\.jpg$/);
    // Decorative: it repeats the name beside it, so a screen reader must skip it rather
    // than announce a filename.
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("aria-hidden")).toBe("true");
  });

  it("says there is no update channel rather than offering a dead link", () => {
    // A "Check for updates" link that 404s is worse than none. Until a real destination
    // exists the card must say so — and say the program does not phone home, which is the
    // actual promise this project makes.
    const { container } = render(<AboutPane version="1" />);
    const updates = container.querySelector(".about-facts")!.textContent ?? "";
    expect(updates).toMatch(/updates/i);
    expect(updates).toMatch(/no update channel/i);
    // The card carries no anchors at all: the licence opens an in-app page, and there is no
    // update channel. Any <a> appearing here is either a licence link that leaves the app or an
    // update URL — both worth failing on until deliberately allowed.
    const links = [...container.querySelectorAll<HTMLAnchorElement>(".about a")].map((a) => a.getAttribute("href"));
    expect(links, "a link was rendered with nowhere to point").toEqual([]);
  });

  it("says the user's figures are theirs — the question a free licence provokes", () => {
    // A scientist's first worry about "GPL" is whether it reaches their published figure.
    // It does not (output is not a derivative work), and the card has to say so, because
    // silence on the point leaves that worry standing.
    const { container } = render(<AboutPane version="1" />);
    const text = container.querySelector(".about")!.textContent ?? "";
    expect(text).toMatch(/your figures/i);
    expect(text).toMatch(/licence covers MadY, never what you make with it/i);
  });

  it("says the build is a beta version, beside the version", () => {
    const { container } = render(<AboutPane version="1" />);
    expect(
      container.querySelector(".about-facts")!.textContent,
      "the About card does not say the build is a beta version",
    ).toMatch(/beta version/i);
  });

  it("offers a citation built from the running version, with the archive's DOI", () => {
    const { container } = render(<AboutPane version="v2.1.0 · abc1234+ · 08-05 00:19" />);
    const cite = container.querySelector(".about-cite")!.textContent ?? "";
    expect(cite).toContain("Elias, M.");
    expect(cite).toContain("MadY");
    // The release, not the build stamp — a citation naming a commit hash helps nobody.
    expect(cite).toContain("version 2.1.0");
    expect(cite).not.toMatch(/abc1234|00:19/);
    // The concept DOI: it resolves to the archive of every version, so it stays right for each release.
    expect(cite).toContain("https://doi.org/10.5281/zenodo.23178166");
  });

  it("still renders without a version — a dev build says so instead of showing a blank", () => {
    const { container } = render(<AboutPane />);
    expect(container.querySelector(".about-facts")!.textContent).toMatch(/development build/i);
  });

  it("holds the card and nothing else — no manual, no contents list", () => {
    // About and Documentation are separate menu items answering separate questions; the
    // manual appearing here would make them one answer to two questions.
    const { container } = render(<AboutPane version="1" />);
    expect(container.querySelector(".about"), "no card").toBeTruthy();
    expect(container.querySelector(".guide-sec"), "the manual leaked onto the About tab").toBeNull();
    expect(container.querySelector(".guide-toc"), "the contents list leaked onto the About tab").toBeNull();
    expect(container.querySelector(".guide-search"), "the manual's search box leaked onto the About tab").toBeNull();
  });

  it("is the card and the beta-version caution and nothing else — no added prose", () => {
    // An About box states what the program is; the Help menu does the signposting (e.g. to the
    // Documentation and bug-report items).
    //
    // Note: the beta-version caution is the one exception, subtracted below so this stays a real
    // guard: any other prose outside the card still fails here.
    const { container } = render(<AboutPane version="1" />);
    const pane = container.querySelector(".aboutpane")?.textContent ?? "";
    const outside = pane
      .replace(container.querySelector(".about")?.textContent ?? "", "")
      .replace(container.querySelector(".beta-banner")?.textContent ?? "", "");
    expect(outside.trim(), `the About tab has prose outside the card: "${outside.trim()}"`).toBe("");
  });

  it("carries the beta-version caution, above the card", () => {
    // Same placement rule as the Docs tab: the thing to read before trusting a number cannot
    // sit below the version, licence and citation where a scrolling reader meets it fourth.
    const { container } = render(<AboutPane version="1" />);
    const banner = container.querySelector(".beta-banner");
    expect(banner, "no beta-version caution on the About tab").toBeTruthy();
    expect(banner!.textContent, "it must name the state of the software").toMatch(/beta version/i);
    const card = container.querySelector(".about")!;
    expect(
      banner!.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the caution must come before the About card",
    ).toBeTruthy();
  });
});

describe("citation()", () => {
  it("is the one source both the card and the manual print from", () => {
    // The manual's licence section renders `{ kind: "cite" }` through this same function, so
    // the strings cannot drift. Pinned here because the two live in different components,
    // where nothing else would notice them disagreeing.
    expect(citation("v3.2.1 · deadbee · 08-05 12:00", 2026)).toBe("Elias, M. (2026). MadY (version 3.2.1). https://doi.org/10.5281/zenodo.23178166");
    expect(citation(undefined, 2026)).toBe("Elias, M. (2026). MadY (version development build). https://doi.org/10.5281/zenodo.23178166");
  });

  it("gives the year the program was built", () => {
    vi.stubGlobal("__MADY_BUILD_YEAR__", 2031);
    try {
      expect(buildYear()).toBe(2031);
      expect(citation("v1.0.0 · abc1234 · 01-02 10:00")).toBe("Elias, M. (2031). MadY (version 1.0.0). https://doi.org/10.5281/zenodo.23178166");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to the current year when run from source without a build", () => {
    expect(buildYear()).toBe(new Date().getFullYear());
  });
});
