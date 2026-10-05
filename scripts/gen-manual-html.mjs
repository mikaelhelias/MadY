/**
 * The standalone manual — `MadY-Manual.html`, one self-contained searchable file.
 *
 * Run from the repo root:  node scripts/gen-manual-html.mjs
 * Prerequisite: a build.    cd apps/desktop && npx electron-vite build
 *
 * It serialises the program's own manual rather than re-rendering it. The generator boots the
 * built renderer headlessly — the same preview server and Playwright the screenshot pipeline
 * already uses — opens Help ▸ Documentation, which renders every chapter into one DOM, and walks
 * that DOM. So there is one source and one truth: the file cannot say something the program's own
 * manual does not, and every default-deny gate that protects the in-app manual protects this one
 * too. A second renderer would be a second thing to keep true, and it is the one that would rot.
 *
 * What it adds around the content: a cover, a sticky contents list, a search box, the call-out
 * boxes flattened onto each picture, every image inlined as base64 (so the file works with no
 * folder beside it, on any machine, forever), and a print stylesheet. The one exception is the
 * videos: too big to inline, they are copied to `docs/manual/videos/` and the page plays them from
 * there (see `videoHtml`).
 *
 * It refuses to write a broken file. No chapters, a chapter with no body, a picture whose data
 * is missing, or a call-out with no legend entry all fail the run rather than shipping a manual
 * that looks complete and is not.
 */
import { spawn } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { playwrightFfmpeg } from "./guide-video-recorder.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "apps/desktop/src/renderer/src/assets/guide");
const OUT = join(ROOT, "docs/manual/MadY-Manual.html");
const PORT = 8862;
const BASE = `http://localhost:${PORT}/`;

const die = (msg) => {
  console.error(`gen-manual-html: ${msg}`);
  process.exit(1);
};

if (!existsSync(join(ROOT, "apps/desktop/out/renderer/index.html")))
  die("no build — run `cd apps/desktop && npx electron-vite build` first");

// ── serve the built bundle ourselves, so the run needs nothing else running ──
const server = spawn(process.execPath, ["tools/preview-server.mjs", "apps/desktop/out/renderer", String(PORT)], {
  cwd: ROOT,
  stdio: "ignore",
});
const stop = () => {
  try {
    server.kill();
  } catch {
    /* already gone */
  }
};
process.on("exit", stop);

for (let i = 0; ; i++) {
  try {
    const r = await fetch(BASE);
    if (r.ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 60) die("the preview server never came up");
  await new Promise((r) => setTimeout(r, 100));
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
await page.goto(BASE, { timeout: 30000 });
await page.waitForSelector(".nav", { timeout: 30000 });
await page.locator(".menubar .menu", { hasText: /^Help$/ }).click();
await page.locator(".dropdown .dropitem", { hasText: /Documentation/ }).first().click();
await page.waitForSelector(".guide-sec", { timeout: 20000 });
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));

/**
 * Walk the rendered manual into plain data.
 *
 * Note: read the DOM, not the source. A block kind added to `guide.ts` and rendered by the pane
 * arrives here without this script being told about it — which is the whole reason for driving
 * the app instead of re-implementing the renderer.
 */
const doc = await page.evaluate(() => {
  const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const version = document.querySelector(".appver, .about-cite")?.textContent ?? "";
  const chapters = [];
  for (const sec of document.querySelectorAll("section.guide-sec")) {
    const id = sec.id.replace(/^guide-/, "");
    const title = clean(sec.querySelector("h3.guide-h")?.textContent);
    const group = clean(sec.querySelector(".guide-kicker")?.textContent);
    const summary = clean(sec.querySelector(".guide-sum")?.textContent);
    const body = [];
    const walk = (root) => {
      for (const el of root.children) {
        const cls = el.className && typeof el.className === "string" ? el.className : "";
        if (el.tagName === "P" && cls.includes("guide-goal")) body.push({ t: "goal", text: clean(el.textContent).replace(/^Goal:\s*/, "") });
        else if (el.tagName === "H4" && cls.includes("guide-sub")) body.push({ t: "h", text: clean(el.textContent) });
        else if (el.tagName === "P" && cls.includes("guide-note")) body.push({ t: "note", text: clean(el.textContent) });
        else if (el.tagName === "P" && cls.includes("guide-p")) body.push({ t: "p", text: clean(el.textContent) });
        else if (el.tagName === "UL" && cls.includes("guide-ul")) body.push({ t: "ul", items: [...el.children].map((li) => clean(li.textContent)) });
        else if (el.tagName === "OL" && cls.includes("guide-steps"))
          body.push({
            t: "steps",
            items: [...el.children].map((li) => {
              const fig = li.querySelector("figure.guide-shot");
              const step = { text: clean([...li.childNodes].filter((n) => n.nodeType === 3 || !n.querySelector?.("figure")).map((n) => n.textContent).join(" ")) };
              if (fig) {
                step.text = clean(li.textContent.replace(fig.textContent ?? "", ""));
                step.fig = readFigure(fig);
              }
              return step;
            }),
          });
        else if (el.tagName === "FIGURE" && cls.includes("guide-shot")) body.push({ t: "fig", ...readFigure(el) });
        else if (el.tagName === "FIGURE" && cls.includes("guide-video")) {
          const v = el.querySelector("video");
          body.push({ t: "video", file: v?.getAttribute("data-video") ?? "", alt: v?.getAttribute("aria-label") ?? "", caption: clean(el.querySelector("figcaption")?.textContent) });
        }
        else if (el.tagName === "TABLE" || el.querySelector?.(":scope > table")) {
          for (const tbl of el.tagName === "TABLE" ? [el] : el.querySelectorAll(":scope > table")) body.push(readTable(tbl));
        } else if (el.tagName === "H4" || el.tagName === "H5") {
          // A derived table's heading carries a count badge ("In a dialog 199"). It is useful in
          // the app, and in a contents list it reads as part of the name — so it is dropped here.
          const badge = clean(el.querySelector(".guide-indexn")?.textContent);
          let text = clean(el.textContent);
          if (badge && text.endsWith(badge)) text = clean(text.slice(0, -badge.length));
          // A heading with a count badge is a derived index table — every route in the program,
          // or every analysis method. It stays in the document as an appendix, but it is kept
          // out of the search: it contains every word, so it would win every query outright
          // ("tick every 25" would land on a long route table instead of on the section that
          // says what to type). You do not search an index; you search the text and the index is the text.
          body.push({ t: "h", text, noindex: Boolean(badge) });
        }
        else if (el.children.length) walk(el);
      }
    };
    function readFigure(fig) {
      const img = fig.querySelector("img");
      const cap = fig.querySelector("figcaption");
      const legend = [...fig.querySelectorAll(".guide-marklegend-i")].map((x) => clean(x.textContent));
      const capText = clean(cap?.firstChild?.textContent ?? cap?.textContent);
      return {
        file: img?.getAttribute("data-shot") ?? "",
        src: img?.getAttribute("src") ?? "",
        alt: img?.getAttribute("alt") ?? "",
        caption: capText,
        legend,
      };
    }
    function readTable(tbl) {
      const head = [...tbl.querySelectorAll("thead th")].map((h) => clean(h.textContent));
      const rows = [];
      for (const tr of tbl.querySelectorAll("tbody tr")) {
        const th = tr.querySelector("th[colspan]");
        if (th) rows.push({ group: clean(th.textContent) });
        else rows.push({ cells: [...tr.children].map((c) => clean(c.textContent)) });
      }
      const caption = clean(tbl.querySelector("caption")?.textContent);
      return { t: "table", head, rows, caption };
    }
    walk(sec);
    chapters.push({ id, title, group, summary, body });
  }
  return { version, chapters };
});

await browser.close();
stop();

if (doc.chapters.length < 20) die(`only ${doc.chapters.length} chapters came back — the walker is broken`);
for (const c of doc.chapters) if (c.body.length === 0) die(`chapter "${c.id}" came back with no body`);

// ── inline every picture ──────────────────────────────────────────────────────────────────────
// The bundled URL is `/assets/<name>-<hash>.png`; the source file keeps its own name. Match on
// the stem so a rebuild's new hash cannot break this.
const names = new Map();
for (const f of require("fs").readdirSync(ASSETS)) if (f.endsWith(".png")) names.set(f.replace(/\.png$/, ""), f);
const marksOf = (file) => {
  const p = join(ASSETS, `${file}.marks.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};
/**
 * The picture's own file, read from `data-shot` on the <img>.
 *
 * Not from the `src`. Vite hashes a bundled asset's name and inlines a small one as a `data:`
 * URI, from which no name can be recovered at all — and the name is what the measured call-outs
 * are keyed by. The renderer stamps the real file name on the element for exactly this.
 */
function resolveImage(fig) {
  const file = fig.file;
  if (!file) die(`a picture in the manual carries no data-shot name (alt: "${fig.alt.slice(0, 60)}")`);
  if (!names.has(file.replace(/\.png$/, ""))) die(`the manual shows "${file}" and there is no such PNG in assets/guide`);
  return { file, data: readFileSync(join(ASSETS, file)).toString("base64"), marks: marksOf(file) };
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A figure: the picture, its measured call-out boxes drawn over it as an SVG, and its legend. */
function figureHtml(fig) {
  const { file, data, marks } = resolveImage(fig);
  if (!data) die(`picture ${file} came back empty`);
  let overlay = "";
  if (marks && marks.marks.length) {
    const boxes = marks.marks
      .map(
        (m) =>
          `<rect class="halo" x="${m.x - 2}" y="${m.y - 2}" width="${m.w + 4}" height="${m.h + 4}" rx="6"/>` +
          `<rect class="box" x="${m.x - 2}" y="${m.y - 2}" width="${m.w + 4}" height="${m.h + 4}" rx="6"/>`,
      )
      .join("");
    const pins = marks.marks
      .map((m) => `<span class="pin" style="left:${((m.x / marks.w) * 100).toFixed(3)}%;top:${((m.y / marks.h) * 100).toFixed(3)}%">${m.n}</span>`)
      .join("");
    overlay =
      `<svg class="marks" viewBox="0 0 ${marks.w} ${marks.h}" preserveAspectRatio="none" aria-hidden="true">${boxes}</svg>${pins}`;
    if (marks.marks.length !== fig.legend.length)
      die(`${file}: ${marks.marks.length} call-outs but ${fig.legend.length} legend entries`);
  }
  const style = marks ? ` style="max-width:min(100%,${marks.w}px);aspect-ratio:${marks.w}/${marks.h}"` : "";
  const legend = fig.legend.length
    ? `<span class="legend">${fig.legend.map((l) => `<span>${esc(l)}</span>`).join("")}</span>`
    : "";
  return (
    `<figure><span class="frame"${style}><img src="data:image/png;base64,${data}" alt="${esc(fig.alt)}">${overlay}</span>` +
    `<figcaption>${esc(fig.caption)}${legend}</figcaption></figure>`
  );
}

/**
 * A video: the .webm is copied beside the manual (`docs/manual/videos/`), not inlined — the
 * videos as base64 would add tens of megabytes to the file. A still from each is inlined as its poster, so the
 * page reads right even where the videos folder was not copied along; the line under it says
 * where the file is and that it also plays inside MadY.
 */
const VIDEO_DIR = join(dirname(OUT), "videos");
async function videoHtml(b) {
  if (!b.file) die(`a video in the manual carries no data-video name (alt: "${b.alt.slice(0, 60)}")`);
  const src = join(ASSETS, b.file);
  if (!existsSync(src)) die(`the manual shows "${b.file}" and there is no such video in assets/guide`);
  mkdirSync(VIDEO_DIR, { recursive: true });
  copyFileSync(src, join(VIDEO_DIR, b.file));
  const poster = join(VIDEO_DIR, `${b.file}.poster.png`);
  // 4 s in: past the title card, on the program itself.
  await new Promise((resolve, reject) => {
    const ff = spawn(playwrightFfmpeg(), ["-hide_banner", "-loglevel", "error", "-y", "-ss", "4", "-i", src, "-frames:v", "1", "-vf", "scale=960:-2", "-c:v", "png", poster], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    ff.stderr.on("data", (d) => (err += d));
    ff.on("close", (code) => (code === 0 ? resolve(null) : reject(new Error(`poster for ${b.file}: ${err.trim()}`))));
  });
  const data = readFileSync(poster).toString("base64");
  return (
    `<figure class="video"><video controls preload="metadata" src="videos/${esc(b.file)}" poster="data:image/png;base64,${data}" aria-label="${esc(b.alt)}"></video>` +
    `<figcaption>${esc(b.caption)}<span class="where">Video file: <code>videos/${esc(b.file)}</code>, beside this manual. It also plays inside MadY: Help ▸ Documentation ▸ Videos.</span></figcaption></figure>`
  );
}

function blockHtml(b, ctx) {
  switch (b.t) {
    case "goal":
      return `<p class="goal"><b>Goal:</b> ${esc(b.text)}</p>`;
    case "h": {
      const id = `${ctx.id}-${slug(b.text)}`;
      ctx.subs.push({ id, title: b.text });
      return `<h2 id="${id}"${b.noindex ? " data-noindex" : ""}>${esc(b.text)}</h2>`;
    }
    case "p":
      return `<p>${esc(b.text)}</p>`;
    case "note":
      return `<div class="note">${esc(b.text)}</div>`;
    case "ul":
      return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
    case "steps":
      return `<ol>${b.items.map((s) => `<li>${esc(s.text)}${s.fig ? figureHtml(s.fig) : ""}</li>`).join("")}</ol>`;
    case "fig":
      return figureHtml(b);
    case "video":
      return ctx.videos.get(b.file) ?? die(`video ${b.file} was not prepared`);
    case "table": {
      const head = b.head.length ? `<thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>` : "";
      const rows = b.rows
        .map((r) =>
          r.group
            ? `<tr class="grp"><th colspan="${Math.max(1, b.head.length)}">${esc(r.group)}</th></tr>`
            : `<tr>${r.cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`,
        )
        .join("");
      const cap = b.caption ? `<caption>${esc(b.caption)}</caption>` : "";
      return `<div class="tablewrap"><table>${cap}${head}<tbody>${rows}</tbody></table></div>`;
    }
    default:
      die(`no HTML for a "${b.t}" block — teach the generator about it`);
      return "";
  }
}

// The videos are prepared first (copy + poster, which is asynchronous) so `blockHtml` stays a
// plain synchronous switch like every other block.
const videos = new Map();
for (const c of doc.chapters) for (const b of c.body) if (b.t === "video") videos.set(b.file, await videoHtml(b));

const toc = [];
const main = [];
let n = 0;
let group = "";
for (const c of doc.chapters) {
  n += 1;
  const ctx = { id: c.id, subs: [], videos };
  const body = c.body.map((b) => blockHtml(b, ctx)).join("\n");
  if (c.group && c.group !== group) {
    group = c.group;
    toc.push(`<div class="tocgroup">${esc(group)}</div>`);
  }
  toc.push(`<a href="#${c.id}">${n}. ${esc(c.title)}</a>`);
  for (const s of ctx.subs) toc.push(`<a class="l2" href="#${s.id}">${esc(s.title)}</a>`);
  main.push(
    `<h1 id="${c.id}">${n}. ${esc(c.title)}</h1>` +
      (c.summary ? `<p class="summary">${esc(c.summary)}</p>` : "") +
      body,
  );
}

const figures = main.join("").match(/<figure>/g)?.length ?? 0;
const words = main.join(" ").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

const CSS = readFileSync(join(ROOT, "scripts/manual-html.css"), "utf8");
const JS = readFileSync(join(ROOT, "scripts/manual-html.js"), "utf8");
const version = (doc.version.match(/\d+\.\d+\.\d+\w*/) ?? ["(dev)"])[0];

const html =
  `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
  `<title>MadY user manual ${esc(version)}</title>` +
  `<meta name="viewport" content="width=device-width, initial-scale=1">` +
  `<style>${CSS}</style></head><body>` +
  `<div class="cover"><div class="t">MadY</div><div class="s">Scientific graphing &amp; statistics</div>` +
  `<div class="v">User manual &middot; Version ${esc(version)} &middot; <b>Mikael Elias</b></div></div>` +
  `<div class="wrap"><nav><input id="q" type="search" placeholder="Search the manual… (Ctrl+K)" autocomplete="off">` +
  `<div id="hits" style="display:none"></div><div id="toc">${toc.join("")}</div></nav>` +
  `<main>${main.join("\n")}` +
  `<div class="colophon"><hr><b>About this manual.</b> Every screenshot was taken automatically from the ` +
  `running program, and the numbered boxes were measured on it — so a picture here cannot show a control ` +
  `MadY does not have. Generated by <code>scripts/gen-manual-html.mjs</code> from the program's own ` +
  `documentation.</div></main></div>` +
  `<script>${JS}</script></body></html>`;

require("fs").mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, "utf8");
const mb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(1);
console.log(`docs/manual/MadY-Manual.html — ${doc.chapters.length} chapters · ${toc.filter((t) => t.includes('class="l2"')).length} sections · ${figures} figures · ~${words} words · ${mb} MB`);
