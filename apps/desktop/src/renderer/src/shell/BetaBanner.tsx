/**
 * The beta-version caution — one definition, shown everywhere a user meets the software's
 * claims about itself: the top of the Documentation tab, the About tab, and the foot of
 * the Welcome page.
 *
 * Note: a separate module so the wording exists once. It cannot live in `GuidePane`
 * (About would have to import it, and `GuidePane` already imports `AboutCard` from
 * `AboutPane` — a cycle), and a hand-copied second version would be wrong the first time
 * anyone edited one of them.
 *
 * It is not dismissible, deliberately: a warning you can turn off is a warning that stops
 * being read on the second day, and the risk here (publishing a wrong statistic) does not
 * decrease with familiarity. The same caution is repeated under every analysis result
 * (`.anbeta` in `panes.tsx`) and as the About card's `Status` row; `guide.test.ts` and
 * `AboutPane.test.tsx` pin the wording. Keep them all saying the same thing.
 */
export function BetaBanner() {
  return (
    <aside className="beta-banner" role="note" aria-label="Beta version software warning">
      <span className="beta-banner-tag">Beta version</span>
      <p className="beta-banner-text">
        MadY is unfinished software under active development. <strong>Assess every analysis
        critically — results may contain inaccuracies.</strong> Check anything you intend to
        publish, submit or act on against an established statistics package before you rely on it.
      </p>
    </aside>
  );
}
