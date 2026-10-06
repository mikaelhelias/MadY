/**
 * The Guided tours tab — the list of tours, one row each with a Start button. Opened from the
 * Welcome page's "Guided tours" tile (a tile like the others, the list in its own
 * tab, not on the Welcome page, where it would crowd the page). The same list is in the manual's Guided
 * tours chapter; both read `TOURS`, so neither can name a tour the program does not have.
 */
import { Compass } from "lucide-react";
import { toursByTheme, type TourId, type TourLevel } from "./tour";

const LEVEL_WORD: Record<TourLevel, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

export function ToursPane({ onStartTour }: { onStartTour: (id: TourId) => void }) {
  return (
    <div className="tourspane">
      <div className="tours-head">
        <Compass className="welcome-action-icon" size={22} aria-hidden="true" />
        <div>
          <h2 className="tours-title">Guided tours</h2>
          <p className="tours-sub">
            Learn by doing. The window dims, the next control lights up, and each step completes when you have done
            it. Nothing is locked while a tour runs: every other control still works, Next moves on (doing the step
            for you if you have not), and ✕ leaves the tour where it is. Ctrl+Z undoes any change a tour led you to make.
          </p>
        </div>
      </div>
      {/* Grouped by theme (the manual's own groups), beginner → advanced inside each, a level badge
          on every row: tours are grouped by theme and by complexity. */}
      {toursByTheme().map((g) => (
        <section key={g.theme} className="tours-theme" aria-label={g.theme}>
          <h3 className="tours-theme-h">{g.theme}</h3>
          <ul className="tours-list">
            {g.tours.map((t) => (
              <li key={t.id} className="tours-row" data-level={t.level}>
                <span className={`tours-level tours-level-${t.level}`}>{LEVEL_WORD[t.level]}</span>
                <div className="tours-text">
                  <span className="tours-name">{t.title}</span>
                  <span className="tours-summary">{t.summary}</span>
                  <span className="tours-steps">{t.steps.length} steps</span>
                </div>
                <button type="button" className="btn tours-start" data-tour-id={t.id} onClick={() => onStartTour(t.id)}>
                  Start
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="tours-foot note">
        The styling tours work on whatever graph is in front — open one first, or let the tour's first step take you to
        the demo project's Dose-response. Compare groups wants a Column datasheet (one column per group); the demo's
        Replicate readouts is one. Every tour is also under Help ▸ Guided tours.
      </p>
    </div>
  );
}
