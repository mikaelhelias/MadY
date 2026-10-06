# Changelog

The notable changes in each MadY release. Downloads are on the [Releases](../../releases) page.

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
