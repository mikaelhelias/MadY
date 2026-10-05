/**
 * The ids the manual's index gives to Inspector headings — and nothing else.
 *
 * Its own module because of a cycle. `guideIndex.ts` reads `INSPECTOR_SECTIONS`,
 * `AXIS_GROUPS` and `INSPECTOR_TABS` out of `Inspector.tsx`, so the Inspector cannot import
 * from `guideIndex.ts` to find out what id its own "?" button should point at. Both import
 * from here instead, which imports nothing.
 *
 * One derivation, used both by the index that makes these entries and by the button that links
 * to them. Re-deriving the slug at the button would be a second copy of a rule the app already
 * has two versions of: `inspectorSectionSlug` (Inspector.tsx) keeps a trailing dash, because
 * that slug is also the collapsed-state storage key — "Breaks (cuts)" is `breaks-cuts-` — while
 * the index strips it. A "?" built on the wrong one would open the manual at nothing.
 */
export const headingSlug = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");

/** The index id of an Inspector section, from its title. */
export const inspectorEntryId = (title: string): string => `insp:${headingSlug(title)}`;
/** The index id of one of the Axis tab's groups, from its title. */
export const axisEntryId = (title: string): string => `axis:${headingSlug(title)}`;
/** The index id of an Inspector rail tab, from the tab's own id. */
export const inspectorTabEntryId = (tabId: string): string => `insptab:${tabId}`;
