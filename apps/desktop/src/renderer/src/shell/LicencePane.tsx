// The GPL text is inlined at build time from the very file that ships with the app.
//
// Note: deliberately not read at runtime. Every runtime route to it has a way to fail on a
// user's machine: `shell.openExternal` points the OS browser at a dev-server URL,
// `shell.openPath` depends on an OS text-editor association, and `fetch("./COPYING.txt")`
// works in dev but is blocked from a `file://` page once packaged. A `?raw` import has no
// runtime step at all — the text is in the bundle, so the page cannot fail to show it,
// offline, in dev and packaged alike.
//
// It is the same file `license-shipped.test.ts` pins byte-for-byte against `LICENSE` at the
// repo root, so this can never drift from the licence the project actually grants.
import licenceText from "../../public/COPYING.txt?raw";

/**
 * The Licence page — the complete GNU GPL v3, in the program.
 *
 * GPL-3 §5(d) asks an interactive program to display "Appropriate Legal Notices", which §0
 * defines to include telling the user how to view a copy of the licence. That is this page
 * rather than a link out to something that may or may not open: the program itself shows the
 * licence, with no network, no file association and no second app.
 */
export function LicencePane() {
  return (
    <div className="licpane">
      <header className="guide-head">
        <h2 className="h">GNU General Public License, version 3</h2>
        <p className="note">
          The full licence MadY is distributed under. Your own figures, data and results are not
          covered by it — see Help ▸ About MadY.
        </p>
      </header>
      {/* `pre` because the licence is laid out in fixed-width columns; reflowing it would
          change the document. Horizontal scrolling is kept inside this box so the page
          itself never scrolls sideways. */}
      <pre className="lictext">{licenceText}</pre>
    </div>
  );
}
