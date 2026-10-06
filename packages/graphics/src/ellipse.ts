/**
 * Covariance (confidence/data) ellipse for a 2-D point cloud — the "uncertainty
 * ellipse" of PCA/PCoA/ordination plots. Pure geometry; computed in PIXEL space
 * (so non-uniform x/y axis scaling can't distort it) and fed straight to the
 * renderer. The ellipse is the level-set of the bivariate-normal fit at a chosen
 * confidence: semi-axes = nSigma · √eigenvalue of the 2×2 covariance, rotated to
 * its principal axis. With y pointing DOWN (screen space) the returned `angle`
 * is the clockwise SVG rotation in degrees.
 */

export interface Ellipse {
  cx: number;
  cy: number;
  /** Semi-axis lengths (rx = major, along `angle`). */
  rx: number;
  ry: number;
  /** Rotation of the major axis, degrees (SVG/clockwise in screen space). */
  angle: number;
}

/**
 * The √χ²₂ scale factor for a confidence level — how many "sigma" the ellipse
 * spans. χ²₂ has CDF 1 − e^(−x/2), so its p-quantile is −2·ln(1−p); the radius
 * scale is its square root. p=0.95 → 2.4477 (the standard 95% ellipse).
 */
export function chiSquareScale(level: number): number {
  const p = Math.min(0.999999, Math.max(0.000001, level));
  return Math.sqrt(-2 * Math.log(1 - p));
}

/**
 * Covariance ellipse of the points at `nSigma` scale (e.g. `chiSquareScale(0.95)`
 * for a 95% data ellipse, or that ÷ √n for the mean's confidence ellipse). Needs
 * ≥3 points; returns null otherwise (and for degenerate/collinear clouds where an
 * ellipse is meaningless). Uses the sample covariance (n−1 denominator).
 */
export function covarianceEllipse(pts: ReadonlyArray<{ x: number; y: number }>, nSigma: number): Ellipse | null {
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= n - 1;
  syy /= n - 1;
  sxy /= n - 1;
  // Eigenvalues of [[sxx, sxy], [sxy, syy]].
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr / 2) * (tr / 2) - det));
  const l1 = tr / 2 + disc; // major
  const l2 = tr / 2 - disc; // minor
  if (!(l1 > 0)) return null; // no spread at all
  // Principal-axis rotation (the major eigenvector direction).
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return {
    cx: mx,
    cy: my,
    rx: nSigma * Math.sqrt(Math.max(0, l1)),
    ry: nSigma * Math.sqrt(Math.max(0, l2)),
    angle: (angle * 180) / Math.PI,
  };
}
