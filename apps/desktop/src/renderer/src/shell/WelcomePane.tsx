/**
 * The Welcome page — what the app opens on. The demo project is in the Navigator
 * (folded shut); launch shows the program's own identity plus five tiles — start a
 * project, start a datasheet and its graph, browse the chart gallery, read the manual, or
 * take a guided tour.
 *
 * Same artwork as the splash and the About card (`renderer/public/splash.jpg`,
 * copied verbatim into the build), so the program looks like one thing everywhere
 * it introduces itself.
 */
import { BookOpen, Compass, FolderPlus, LayoutGrid, LineChart } from "lucide-react";
import { BetaBanner } from "./BetaBanner";

export function WelcomePane({
  version,
  onOpenGallery,
  onOpenGuide,
  onStartNewGraph,
  onNewProject,
  onOpenTours,
}: {
  version?: string | undefined;
  /** Open the Guided tours tab (the list of tours lives there, not on this page). */
  onOpenTours: () => void;
  /** Open the Chart gallery tab. */
  onOpenGallery: () => void;
  /** Open the Documentation (manual) tab. */
  onOpenGuide: () => void;
  /** Open the "New datasheet / graph" creator (datasheet + its graph). */
  onStartNewGraph: () => void;
  /** Create a new, empty project folder in the tree. */
  onNewProject: () => void;
}) {
  return (
    <div className="welcomepane">
      <section className="welcome-hero" aria-label="About MadY">
        <img className="welcome-art" src="./splash.jpg" alt="" aria-hidden="true" />
        <div className="welcome-hero-body">
          {/* Note: the name stays alone in its own node. Folding the pronunciation into the
              <h1> would make the accessible name "MadY /ˈmædi/ (MAD-ee)" — a screen reader
              would then read the phonetics aloud as if they were part of the name. The
              pronunciation is a sibling, and `lang="en"` marks the IPA so a
              reader doesn't try to pronounce the symbols. */}
          <h1 className="welcome-name">MadY</h1>
          <p className="welcome-say" lang="en">
            /ˈmædi/ (“MAD-ee”)
          </p>
          {/* Motto then tagline, and they do different jobs: the motto says why the program
              exists, the tagline says what it is. Keep them apart — collapsed into one line
              they read as a single overlong strapline that does neither. */}
          <p className="welcome-motto">Graphing, without the mad.</p>
          <p className="welcome-tag">Scientific graphing and statistics — local, offline, yours.</p>
          <p className="welcome-version">{version ?? "development build"}</p>
        </div>
      </section>
      {/* Two ways to begin, deliberately distinct: a project is the empty folder you file
          work into; a dataset/graph is the thing you actually start typing numbers into.
          One tile for both would carry a name that is wrong for one of them. */}
      <div className="welcome-actions">
        <button type="button" className="welcome-action" onClick={onNewProject}>
          <FolderPlus className="welcome-action-icon" size={22} aria-hidden="true" />
          <span className="welcome-action-title">Start a new project</span>
          <span className="welcome-action-sub">An empty project folder to file your work into</span>
        </button>
        <button type="button" className="welcome-action" onClick={onStartNewGraph}>
          <LineChart className="welcome-action-icon" size={22} aria-hidden="true" />
          <span className="welcome-action-title">New datasheet / graph</span>
          <span className="welcome-action-sub">Pick a datasheet shape and the graph it supports</span>
        </button>
        <button type="button" className="welcome-action" onClick={onOpenGallery}>
          <LayoutGrid className="welcome-action-icon" size={22} aria-hidden="true" />
          <span className="welcome-action-title">Chart gallery</span>
          <span className="welcome-action-sub">Browse every graph type MadY can build</span>
        </button>
        <button type="button" className="welcome-action" onClick={onOpenGuide}>
          <BookOpen className="welcome-action-icon" size={22} aria-hidden="true" />
          <span className="welcome-action-title">Documentation</span>
          <span className="welcome-action-sub">Read the manual</span>
        </button>
        {/* The tours are a tile like the others. The list of tours is its own tab, which
            keeps this page short. */}
        <button type="button" className="welcome-action" onClick={onOpenTours}>
          <Compass className="welcome-action-icon" size={22} aria-hidden="true" />
          <span className="welcome-action-title">Guided tours</span>
          <span className="welcome-action-sub">Learn by doing, one lit control at a time</span>
        </button>
      </div>
      {/* Last thing on the page, not the first: the tiles are what someone came here to
          use, but nobody should reach their first analysis without having met this. */}
      <div className="welcome-caution">
        <BetaBanner />
      </div>
    </div>
  );
}
