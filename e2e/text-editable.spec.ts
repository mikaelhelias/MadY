import { expect, test } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";

/**
 * A clicked text must open a panel that can edit it.
 *
 * The rule: a side panel must open a tab where the clicked text can be edited, on every graph
 * type. `text-draggable.sweep.test.tsx` proves every text can be moved; this proves the second half.
 *
 * How it measures — each clause avoids a way a naive version misreports:
 *  1. **A real mouse click at the text's centre**, not a dispatched event. If a text is covered
 *     by an overlay, or has `pointer-events: none` and no sibling hit target, a user cannot reach
 *     it — and a dispatched event would hide exactly that. Whatever the click lands on is what
 *     the user gets; the question is only whether the panel it opens can edit the text.
 *  2. **The figure is the oracle.** Set a size control, then re-read the rendered font-size of
 *     the very text that was clicked. A panel that merely contains a "Size" row proves nothing —
 *     the row may belong to the marker, the figure, or another element entirely.
 *  3. **Every "Size" row in the open panel is tried**, up to a handful. Which row owns a given
 *     text differs per kind, and a hand-written label map would rot silently.
 *  4. **The card is reopened before every probe, and the text is re-measured then.**
 *     Each probe changes a font size, which re-lays out the whole figure, so coordinates measured
 *     up front would be stale for every later click and would report working texts (e.g. the
 *     graph title) as uneditable. A coordinate measured before a re-layout belongs to a figure
 *     that no longer exists.
 *  5. **A harness alarm per kind**: some text on a chart is always editable. If not one text on a
 *     kind can be edited, suspect the probe — reported as a broken harness, never as an app defect.
 *
 * Tick labels count. They are edited through the axis tick font, which is what clicking one
 * should open, so they are probed like anything else.
 */

/** One text run we probe: the first of each distinct visual role in the figure. */
interface Probe {
  text: string;
  role: string;
  /** Which occurrence of this (role, text) pair — some figures repeat a label verbatim. */
  nth: number;
}

interface Located extends Probe {
  index: number;
  size: number;
  x: number;
  y: number;
}

interface Row {
  kind: string;
  role: string;
  text: string;
  verdict: "editable" | "not editable";
  tab: string;
  sizeRows: number;
}

const MAX_TEXTS_PER_KIND = 9;
/**
 * High enough to reach the last row. The radar panel offers seven "size" rows, and the last
 * (the legend's) is the one that owns the legend label; a lower limit would never try it and
 * would report the label as dead.
 */
const MAX_SIZE_ROWS_TRIED = 14;

/**
 * Texts that cannot be resized from the panel they open. **Empty, and it must stay that way.**
 *
 * An entry here is a known defect deliberately left in place, and it must carry the reason.
 */
const OPEN_TEXTS: string[] = [];

/** In-page: describe every text run, with the role signature the probe dedupes on. */
const SCAN = `(() => {
  const svg = document.querySelector("svg.gfx-figure");
  if (!svg) return [];
  const out = [];
  const counts = {};
  [...svg.querySelectorAll("text")].forEach((t, index) => {
    const text = (t.textContent ?? "").trim();
    if (!text) return;
    // Not the hover tooltip. It is a readout that exists only while the pointer sits on a
    // mark — and since this test moves the mouse across the plot to click things, it would
    // catch its own hover and report "a text that cannot be edited" for a block no panel
    // should style. It is named in the DOM so this can say what it skips.
    if (t.closest(".gfx-tooltip")) return;
    const cs = getComputedStyle(t);
    const size = Math.round(parseFloat(cs.fontSize) || 0);
    if (!size) return;
    const box = t.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    const role = [
      t.getAttribute("class") ?? "",
      t.parentElement?.getAttribute("class") ?? "",
      size, cs.fontWeight,
      /rotate/.test(t.getAttribute("transform") ?? "") ? "rot" : "",
      t.getAttribute("text-anchor") ?? "",
    ].join("|");
    const key = role + "\\u0000" + text;
    const nth = counts[key] = (counts[key] ?? -1) + 1;
    out.push({ index, text, role, nth, size, x: box.x + box.width / 2, y: box.y + box.height / 2 });
  });
  return out;
})()`;

/**
 * Sharded, with a fresh app per probe. Reopening a card from the gallery adds a graph to the
 * project every time, so a single-project run would accumulate hundreds of graphs, slow the page
 * until clicks time out, and can drop the browser connection. Reloading the app before each probe
 * keeps the project at the demo's size; eight shards keep each test well under its limit.
 */
const SHARDS = 8;

test.describe("every text opens a panel that can edit it", () => {
  for (let shard = 0; shard < SHARDS; shard++) test(`all graph types — cards ${shard + 1}/${SHARDS}`, async ({ page }) => {
    test.setTimeout(30 * 60_000);
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    const allCards = await app.openGallery();
    expect(allCards.length, "no gallery cards — the harness cannot see any chart kinds").toBeGreaterThan(20);
    const cards = allCards.filter((_, i) => i % SHARDS === shard);

    const rows: Row[] = [];
    const broken: string[] = [];

    /** A freshly loaded app, then the card — a clean figure and a clean project. */
    const freshCard = async (card: string): Promise<Located[]> => {
      await app.open();
      await app.openGallery();
      await app.openGalleryCard(card);
      return page.evaluate(SCAN) as Promise<Located[]>;
    };

    for (const card of cards) {
      const first = await freshCard(card);
      const seen = new Set<string>();
      const probes: Probe[] = [];
      for (const t of first) {
        if (seen.has(t.role) || probes.length >= MAX_TEXTS_PER_KIND) continue;
        seen.add(t.role);
        probes.push({ text: t.text, role: t.role, nth: t.nth });
      }

      for (const probe of probes) {
        const all = await freshCard(card); // rule 4 — measure after the reset, never before
        /**
         * The role signature is not stable across a rebuild on every kind. A Voronoi treemap
         * and a force-directed network settle differently each time they are built, so the same
         * label comes back at a different size or anchor — and matching on the full signature
         * alone would report those labels as defects ("not redrawn"). Fall back to the text
         * itself: it is the same label, wherever the layout put it this time.
         */
        const target =
          all.find((t) => t.role === probe.role && t.text === probe.text && t.nth === probe.nth) ??
          all.find((t) => t.text === probe.text && t.nth === probe.nth) ??
          all.find((t) => t.text === probe.text);
        if (!target) {
          rows.push({ kind: card, role: probe.role, text: probe.text.slice(0, 24), verdict: "not editable", tab: "not redrawn", sizeRows: 0 });
          continue;
        }

        await page.mouse.click(target.x, target.y);
        await app.settle();

        const tab = await page.evaluate(() => {
          const active = document.querySelector(".inspcat.on, [role='tab'][aria-selected='true']");
          return (active?.textContent ?? "?").trim();
        });

        // Try each "Size" row the open panel offers, until the clicked text's own size moves.
        const result = await page.evaluate(
          async ([idx, content, limit]) => {
            /**
             * Any row whose label mentions size — not just the ones labelled exactly "Size".
             * The network node label, the radar rings and annotations have controls called
             * "Label size", "Font size", "Value size"; matching "Size" alone would report them
             * as uneditable.
             */
            const sizeRows = () =>
              [...document.querySelectorAll<HTMLElement>("label.frow, div.frow")].filter((r) =>
                /size/i.test((r.querySelector(":scope > span")?.textContent ?? "").trim()),
              );
            /**
             * The clicked text, by index — verified by its content, since a re-render can add or
             * drop a text run and shift everything after it.
             *
             * And its count. A treemap draws the same value in several cells; when a bigger font
             * no longer fits, that cell's label is dropped and the index fallback would match a
             * twin in another cell — same content, unchanged size — so a control that visibly
             * re-laid the whole chart would read as dead. Disappearing is reaching the drawing,
             * so compare (size, how many) together.
             */
            const stateOf = (): string => {
              const texts = [...(document.querySelector("svg.gfx-figure")?.querySelectorAll("text") ?? [])];
              const same = texts.filter((t) => (t.textContent ?? "").trim() === String(content));
              const at = texts[Number(idx)];
              const el = at && (at.textContent ?? "").trim() === String(content) ? at : same[0];
              const px = el ? Math.round(parseFloat(getComputedStyle(el).fontSize) || 0) : -1;
              return `${px}x${same.length}`;
            };
            const before = stateOf();
            /** Two values, far apart. One perturbation can land on the size the text already
             *  has — a treemap's labels inherit the 20px tick size, so "set it to 20" would be a
             *  no-op that reads as a dead control. */
            const wants = ["33", "9"];
            const rows = sizeRows();
            /*
             * …and the ribbon's size box. One click on a title opens its inline editor, and the
             * ribbon's Text picker jumps to that text — its "Font size" box is where the size is set,
             * not a panel row. Looking at the panel alone would report every graph's title as
             * "not editable".
             */
            const inputs = [
              ...rows.map((r) => r.querySelector<HTMLInputElement>('input[type="number"], input[type="range"]')),
              document.querySelector<HTMLInputElement>('.graphribbon input[aria-label="Font size"]'),
            ];
            for (let i = 0; i < Math.min(inputs.length, Number(limit) + 1); i++) {
              const input = inputs[i];
              if (!input) continue;
              for (const want of wants) {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
                setter.call(input, want);
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
                input.dispatchEvent(new Event("blur", { bubbles: true }));
                await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
                if (stateOf() !== before) return { moved: true, sizeRows: rows.length };
              }
            }
            return { moved: false, sizeRows: rows.length };
          },
          [target.index, probe.text, MAX_SIZE_ROWS_TRIED] as const,
        );

        rows.push({
          kind: card,
          role: probe.role,
          text: probe.text.slice(0, 24),
          verdict: result.moved ? "editable" : "not editable",
          tab,
          sizeRows: result.sizeRows,
        });
      }

      // rule 5 — if not one text on this kind could be edited, suspect the probe, not the app
      const mine = rows.filter((r) => r.kind === card);
      if (mine.length > 0 && mine.every((r) => r.verdict === "not editable")) broken.push(card);
    }

    const dead = rows.filter((r) => r.verdict === "not editable" && r.tab !== "not redrawn");
    /** Probed, but the label did not come back when its card was reopened (a Voronoi treemap
     *  settles differently each build). Said out loud rather than counted either way — a check
     *  that silently drops what it could not measure reads as coverage it does not have. */
    const unmeasured = rows.filter((r) => r.tab === "not redrawn");
    if (unmeasured.length) console.log(`not re-found after a rebuild (unmeasured): ${unmeasured.map((u) => `${u.kind}/${u.text}`).join(", ")}`);

    expect(broken, `the check itself is broken — not one text on these kinds could be edited:\n  ${broken.join("\n  ")}`).toEqual([]);
    expect(
      [...new Set(dead.map((d) => `${d.kind} | ${d.text}`))].sort(),
      "texts whose panel cannot change their size (the known exceptions are listed above)",
    ).toEqual(OPEN_TEXTS);
  });
});
