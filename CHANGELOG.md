# Changelog

The notable changes in each MadY release. Downloads are on the [Releases](../../releases) page.

## 0.6.3 — 2026-10-19

- Treemap: a region heading is sized as it is drawn, in capitals, so it stays inside the figure in
  every system font.
- Parallel coordinates: long variable names are spread over as many lines as they need (up to four),
  so no two names on one line print over each other.

## 0.6.2 — 2026-10-18

New
- Bubble charts can put names along X, with the bubbles that share a name side by side; a
  "Bubbles by category" card in the chart gallery.
- Every legend block (size key, colour bar, zone key, number-at-risk table, …) has a heading you
  can edit, its own size, a font, and can be dragged.
- Treemap: one cell per row on any sheet, with label and value columns. 3-D scatter: choose the X,
  Y and Z columns. Heatmap bubbles can be sized from 0.
- Goodness of fit against an Expected column. Melting temperature shows ΔTm under each Tm.

Statistics
- A 4PL reports Bottom as the lower plateau and Top as the upper, on a falling curve too.
- Two-group results (t tests, equivalence, permutation, Bayes factor) name the groups by their
  columns and say which way the difference runs.
- Factorial ANOVA counts degrees of freedom from what the data can estimate; the Friedman choice
  reaches the engine; fitted curves over X spanning decades are smooth on a log axis.
- Renaming a column marks the analyses that read it out of date.
- Significance markers: two-group t tests get theirs, brackets from an analysis land on a bar chart
  of a Column sheet, and group names ending in brackets get theirs too.

Graphs
- Data cut by a hand-set axis range is cut at the axis; a hidden series no longer sizes the axes;
  histogram bins stay in number order; thinned number labels step evenly; a pinned minimum of 0
  keeps an automatic axis linear.
- Numbers and labels no longer print over each other on crowded bars, paired dots, pies, matrices,
  timeline tracks and alluvial diagrams. The fit-parameter block moves off the data, and clear of
  reference lines when a corner allows.
- Pies give every slice its own colour and print "<1%" for a sliver; treemap cells past the palette
  take a tint instead of repeating a colour.
- A chart says when it leaves out a name, a column or a label, instead of dropping it silently.

Editing
- A reference line added from the Design menu opens with the cursor in its value.
- The in-place edit box grows with the typed text.
- Numbers written with a Unicode minus or with comma groups are read as numbers.
- Agent tools: edits that cannot land are refused in words, and a graph made through them is saved
  current.

## 0.6.1 — 2026-10-06

- The citation on the About card and in the manual gives the DOI,
  https://doi.org/10.5281/zenodo.23178166.
- Cox regression: a fit that has not reached its maximum is refused, even when the fitting library
  gives no warning.
- Labels: a crowded label keeps clear of other labels, and treemap headings keep off the edge.
- The statistics engine no longer includes SciPy's example-data downloader.
- macOS (Apple Silicon), experimental: a build of 0.6.0 is on the 0.6.0 release, with Cut / Copy /
  Paste in the menu bar and projects opened by a double-click in Finder.

## 0.6.0 — 2026-10-05

First public release (beta).

- **15 datasheet formats**: eight general formats (XY, Column, Grouped, Contingency, Survival,
  Parts of whole, Multiple variables, Nested), a PCA / ordination format and six drawing formats
  (set membership, subject timeline, meta-analysis, network edge list, GWAS results, genomic
  alterations).
- **Over 50 graph types**, every part of each one editable, from XY, bar, box, violin and survival
  plots to forest, volcano, Manhattan, heatmap, network, chord, Venn / UpSet and 3-D scatter.
- **49 analysis methods** (about 150 configured variants): t tests and the ANOVA family,
  contingency tests, correlation and regression, nonlinear curve fitting with global fits and model
  comparison, survival, ROC, method comparison, PCA, clustering, ordinations, meta-analysis and
  more. Each result leads with the answer, offers a graph and drafts a Methods paragraph.
- **Reactive document**: graphs redraw when their data changes, and analyses are marked out of
  date until re-run; every change can be undone.
- **Import** from text, JSON, Excel and other workbooks, and `.pzfx` data tables; **export** to PNG,
  JPEG, TIFF (CMYK), SVG, PDF and interactive HTML at journal print widths.
- **Figure assembler** for multi-panel figures with lettering, alignment and shared axes.
- Crash recovery: unsaved work of your own is offered back after a crash; the demo project is not.
- Windows installer and portable version; runs entirely offline.
