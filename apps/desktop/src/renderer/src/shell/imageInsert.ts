// Image insertion — pick an image file from disk, embed it as a self-contained
// data URI (so the `.mady` document needs no external asset), and place it in a
// sensible fractional plot-space box that preserves the image's natural aspect ratio.

/** The result of a successful image pick: the bytes as a data URI + natural pixel size. */
export interface PickedImage {
  href: string;
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Open the OS file picker for an image and resolve with its bytes as a data URI
 * plus natural pixel dimensions. Resolves `null` if the user picks nothing or the
 * read fails. A cancelled dialog fires no reliable event, so the promise simply
 * never resolves in that case (benign — no side effect). Renderer-only (uses the
 * DOM `<input type=file>` + FileReader; works inside Electron without any IPC).
 */
export function pickImageDataUrl(): Promise<PickedImage | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/*";
    input.style.display = "none";
    let settled = false;
    const done = (v: PickedImage | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };
    input.onchange = (): void => {
      const file = input.files?.[0];
      if (!file) return done(null);
      const reader = new FileReader();
      reader.onerror = (): void => done(null);
      reader.onload = (): void => {
        const href = String(reader.result ?? "");
        if (!href) return done(null);
        // Load into an <img> to read the natural size (for an aspect-correct box).
        const img = new Image();
        img.onload = (): void => done({ href, naturalWidth: img.naturalWidth || 1, naturalHeight: img.naturalHeight || 1 });
        // A decode failure still inserts (square-ish); the user can resize freely.
        img.onerror = (): void => done({ href, naturalWidth: 1, naturalHeight: 1 });
        img.src = href;
      };
      reader.readAsDataURL(file);
    };
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * A default fractional plot-space box for a newly-inserted image, chosen so the
 * image reads at roughly its natural aspect ratio on a typical plot. Fractional w
 * is relative to the plot width and h to the plot height, which usually differ, so
 * we correct by the plot's pixel aspect (`plotAspect` = plotWidthPx / plotHeightPx):
 * to avoid distortion, pixelW/pixelH must equal the image ratio, giving
 * `h = w · plotAspect / imageRatio`. The box is clamped to a sane on-plot size
 * (aspect preserved during clamping) and centred; the user resizes afterwards.
 */
export function imageInsertBox(
  naturalW: number,
  naturalH: number,
  plotAspect = 1.3,
): { x: number; y: number; w: number; h: number } {
  const ratio = naturalW > 0 && naturalH > 0 ? naturalW / naturalH : 1;
  let w = 0.35;
  let h = (w * plotAspect) / ratio;
  // Clamp height into [minH, maxH], scaling width to keep the aspect ratio.
  const maxH = 0.7;
  const minH = 0.06;
  if (h > maxH) {
    w *= maxH / h;
    h = maxH;
  } else if (h < minH) {
    w = Math.min(0.9, w * (minH / h));
    h = minH;
  }
  const x = Math.max(0.02, Math.min(0.98 - w, 0.5 - w / 2));
  const y = Math.max(0.02, Math.min(0.98 - h, 0.5 - h / 2));
  return { x, y, w, h };
}
