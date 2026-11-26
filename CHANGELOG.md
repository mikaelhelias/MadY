# Changelog

The notable changes in each MadY release. Downloads are on the [Releases](../../releases) page.

## 0.6.5 — 2026-11-26

New
- Bar charts and histograms draw on a log Y axis: the bars rise from the bottom of the axis, and a bar of 0
  or less is left out and named in a warning. Stacked and 100 % bars keep a linear axis and say why.
- Box and violin graphs: a group's data points can sit beside its box instead of over it (Data tab,
  Points position), and Show data points turns the dots on or off for one group.
- One data point of a box or violin can be styled on its own (shape, size, fill, outline colour, opacity),
  for example one hollow dot: click the dot and untick Apply to whole series.
- A box or violin group entered as mean ± error can draw each dot with its own error line (Error per dot ▸
  Each row is a mean ± error).
- Axis panel, Custom ticks: Only these ticks draws only the ticks added there and drops the automatic
  ones, with their minor ticks and gridlines.
- Series panel: Show in legend leaves one series out of the legend while it is still drawn.
- A curve fit of several series opens one tab with their results side by side, one column per series in
  its colour; Re-run all, Copy, CSV and Excel work on the whole run.
- With several fits on a graph, each shows its key value (the EC50 / IC50, or the model's headline value:
  a peak's centre, a half-life, a midpoint, a Tm) beside its own curve and in its colour, with the lines
  ticked in Fit parameters under it. Labels with no room beside their curves go into one list in a
  corner, named by series.
- On a time axis, fitted times print as times: days and dates on a date axis, h:mm:ss on an elapsed-time
  axis.
- The Fitted curve panel names each curve of a several-series fit by its series.

Fixes
- A fit on dates is computed from the first date; before, curves on dates could miss their points and
  give wrong half-lives.
- A fitted curve of a series on Y2 or Y3 is drawn on that axis.
- The concentration forms of dose-response draw their EC50 / IC50 crosshair.
- A column of names is no longer fitted as a series, and no longer shifts the fit colours.
- A graph made after fitting several series shows every fit.
- On a bubble chart, Analyze starts from the column the chart draws; a fit of the bubble-size column is
  not drawn (the graph says so) and is not offered in the Fitted curve panel.
- Fit labels and key values keep clear of error bars and bubbles.
- Opened on a graph, the Analyze dialog starts from the series selected there, or the series the graph
  shows, instead of the datasheet's first series; its tick boxes sit next to their names again.
- A slow start no longer closes MadY before its window opens.
- Dragging a bar's edge is one Undo step; before, one short drag took several.
- On a log Y axis the smallest bar has a height (a histogram bin of 2 no longer looks empty), and a bar
  below the axis start is not drawn as a line along the axis.
- A histogram with proportional-width bins no longer prints overlapping labels on every bin edge.
- Leaving one of two series out of the legend keeps the other's row.
- Show data points and Points position set every group when Apply to whole graph is ticked; a click on a
  box's body opens the group's panel, not a one-dot panel.
- Figures: Print, Export and Copy as picture act on the open figure, not the graph behind it; panels made
  bigger than the standard card no longer overlap their neighbours by default; two-line tick labels line
  up; the figure legend keys bars as bars.

## 0.6.4 — 2026-11-02

New
- Each fitted curve can be styled on its own (colour, thickness, dashes, opacity, bands), and several
  analyses of the same data can draw their curves on one graph. Alt+click picks the curve under the
  pointer; a graph made after a fit already carries it.
- "Key stats as a label" is drawn as a line under the graph title instead of over the data.
- One bar per row on a Column sheet, used by the Waterfall and Pareto graphs.
- Dendrogram: a Standardise option (on for new dendrograms) so a column in large units does not decide
  the tree.
- Datasheets can be renamed in the navigator, like graphs.
- Swimmer and funnel plots draw a colour bar when they are coloured by a column of numbers.
- Every remaining text on a graph can be dragged, and names rename in place.
- "New graph of this data" for survival, ROC, the ordination graphs and the PCA graphs is made as soon
  as the analysis it opened has run.

Statistics
- The chi-square transform is the chi-square distance transform; regression weights by predicted
  value and by SD do what their names say; NMDS no longer collapses every case to one point.
- PERMANOVA refuses a dissimilarity matrix that is all zeros; multifactor ANOVA says when a factor is
  fixed by the others instead of showing a bare 0.
- Analyses are named by what they are: multifactor ANOVA, the mixed model, and distances by their
  name instead of an internal id.
- In the Analyze dialog, methods that take several columns start with every column ticked, X-and-Y
  methods no longer start on the same column twice, and "Selected pairs of means" waits for a pair
  before Run.

Graphs and editing
- One action is one Undo step; undoing a data edit leaves analyses and graphs current, and undoing a
  sheet change restores every sheet setting.
- Presets: a preset's section for a graph type holds that type's whole look, replaces axis fonts and
  colours set by hand, and no longer leaves the previous preset's legend, marker, tick or grid look
  behind.
- Axes: minor ticks and scale bars draw on lollipop and paired dot plots; Decimals works under the Auto
  format; Reversed works on Manhattan and QQ axes; a funnel plot's standard-error axis can be turned
  the right way up; scales a graph cannot draw are refused out loud.
- Typed legend numbers on bubble graphs show as typed; Bland-Altman line captions and 3-D axis names
  keep clear of the frame and the numbers; a box's median line takes the paper colour when it would
  vanish against its fill; a graph with transparent paper exports without a background.
- The Inspector offers only the rows a graph's drawing reads, and a crashed tab no longer replaces the
  error of every other tab.

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
