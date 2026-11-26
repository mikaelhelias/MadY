/**
 * The About tab — what this copy of the program says about itself, and nothing else.
 *
 * Separate from `GuidePane` (Help ▸ About MadY, beside Documentation and Report a bug), so a
 * reader who wants the version does not have to open the whole manual, and a reader who
 * wants the manual does not meet a 500px card first. Two questions, two menu items.
 *
 * Note: **this card is the program's Appropriate Legal Notices in the sense of GPL-3 §0**, which
 * is why the licence rows say four specific things rather than just "GPL": a copyright notice,
 * that there is no warranty, that the user may redistribute under the GPL, and how to read the
 * licence itself. §5(d) then obliges any modified version to keep displaying them — a fork
 * cannot quietly drop the credit. Drop any of the four and the display stops qualifying, so
 * `AboutPane.test.tsx` pins all four individually, and shortening the card breaks that display.
 */

import { BetaBanner } from "./BetaBanner";

/**
 * The address of the update channel, or undefined when none is configured.
 *
 * A constant rather than a hardcoded href: an update link that 404s is worse than none, so
 * without a real destination the card says there is no channel instead of promising one.
 * Setting it makes the link appear; nothing else needs to change.
 */
const UPDATE_URL: string | undefined = undefined;

/**
 * The recommended citation, built from the version actually running.
 *
 * The DOI is the archive's concept DOI, which resolves to every version, so it stays right for each
 * release; `CITATION.cff` gives the same one. The year is the year the program was built.
 *
 * The version is stamped `v0.0.0 · <commit> · <date>`; a citation wants the release, not the
 * build, so take the leading version only.
 *
 * No "[Computer software]" descriptor, so the line stays short; a journal that wants the APA
 * descriptor adds it.
 *
 * Note: exported because the manual's licence section prints the same line from this same call
 * (`{ kind: "cite" }` in `guide.ts`). A second hand-typed copy would be wrong the first time
 * the version changed.
 */
export function citation(version?: string | undefined, year: number = buildYear()): string {
  const v = (version ?? "").split("·")[0]?.trim().replace(/^v/, "") || "development build";
  return `Elias, M. (${year}). MadY (version ${v}). https://doi.org/10.5281/zenodo.23178166`;
}

/** The year this copy of MadY was built; the current year when run from source without a build. */
export function buildYear(): number {
  return typeof __MADY_BUILD_YEAR__ === "number" ? __MADY_BUILD_YEAR__ : new Date().getFullYear();
}

/**
 * The card itself: the startup artwork, the version actually running, who wrote it, the
 * licence, and the update slot.
 *
 * Same image as the splash (`renderer/public/splash.jpg`, copied verbatim into the build), so
 * what the program opens with and what it says about itself cannot drift apart.
 */
export function AboutCard({
  version,
  onOpenLicence,
}: {
  version?: string | undefined;
  /** Open the in-app Licence page. */
  onOpenLicence?: (() => void) | undefined;
}) {
  return (
    <section className="about" aria-label="About MadY">
      <img className="about-art" src="./splash.jpg" alt="" aria-hidden="true" />
      <div className="about-body">
        {/* The name alone in its own node — see WelcomePane: folding the phonetics into the
            heading would make a screen reader announce them as part of the name. */}
        <h2 className="about-name">MadY</h2>
        {/* Under the name, quiet and italic — not a row in the facts list. A "Pronounced"
            label sets it beside the version and the licence as though it mattered as much,
            which is pedantic; it answers a question you ask once and never again. */}
        <p className="about-say" lang="en">
          /ˈmædi/ (“MAD-ee”)
        </p>
        {/* The motto lives here, on the card — not in the Docs page header. The card is
            rendered on both the About tab and at the head of the Docs tab, so one copy
            reaches both; a second copy under "MadY documentation" would print it twice on the
            same page, the second ~900px down where nobody sees it. Same reasoning
            as the card itself: one AboutCard, rendered twice, cannot drift. */}
        <p className="about-motto">Graphing, without the mad.</p>
        <p className="about-tag">Scientific graphing and statistics — local, offline, yours.</p>
        <dl className="about-facts">
          <dt>Version</dt>
          <dd>{version ?? "development build"}</dd>
          {/* Beside the version, because "which version am I on?" and "how much should I
              trust it?" are the same question asked twice. */}
          <dt>Status</dt>
          <dd>Beta version — under active development; expect defects, and check every result.</dd>
          <dt>By</dt>
          <dd>Mikael Elias</dd>
          <dt>Copyright</dt>
          <dd>© 2026 Mikael Elias</dd>
          <dt>Licence</dt>
          <dd>
            GNU General Public License v3.0 or later —{" "}
            {/* Opens the licence in the program. An `href` to the shipped LICENSE.txt with
                target="_blank" would route through Electron's window-open handler and out to
                the OS — a dev-server URL in development, an unreliable file:// one when
                packaged — and open nothing. §0 asks the display to tell the user how to read
                the licence, so the program shows it. */}
            <button type="button" className="linkbtn" onClick={onOpenLicence}>
              read the full licence
            </button>
          </dd>
          <dt>Your figures</dt>
          <dd>Yours entirely — the licence covers MadY, never what you make with it.</dd>
          <dt>How to cite</dt>
          <dd>
            <code className="about-cite">{citation(version)}</code>
          </dd>
          <dt>Updates</dt>
          <dd>
            {UPDATE_URL ? (
              <a href={UPDATE_URL} target="_blank" rel="noreferrer noopener">Check for updates</a>
            ) : (
              <span className="about-muted">No update channel configured — this copy does not phone home.</span>
            )}
          </dd>
        </dl>
        {/* Says the four things GPL-3 §0 needs, in a register a scientist can read.
            The all-capitals form belongs in the licence (§15–17, where "conspicuous" is a legal
            requirement), not in a summary card — but the statement itself has to stay, or
            this stops being an Appropriate Legal Notices display and §5(d) loses its grip. */}
        <p className="about-legal">
          Free software, offered with no warranty of any kind — you are welcome to run, study, share and
          modify it under the GNU General Public License, version 3 or later.
        </p>
      </div>
    </section>
  );
}

/**
 * The pane behind the About tab: the beta-version caution, then the card.
 *
 * Note: nothing else. No line pointing at the Documentation and bug-report items: an About
 * box states what the program is — the Help menu is three rows away and does its own
 * signposting.
 *
 * Note: the banner goes on the pane, never inside `AboutCard`: the Docs tab renders that same
 * card under its own copy of the banner, so putting it in the card would print the warning
 * twice there. Same placement rule as the Docs tab — the caution comes before the card,
 * because it is the one thing to read before trusting a number, not a footnote to the
 * version and licence.
 */
export function AboutPane({
  version,
  onOpenLicence,
}: {
  version?: string | undefined;
  onOpenLicence?: (() => void) | undefined;
}) {
  return (
    <div className="aboutpane">
      <BetaBanner />
      <AboutCard version={version} onOpenLicence={onOpenLicence} />
    </div>
  );
}
