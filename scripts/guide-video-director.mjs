/**
 * The on-screen annotation for the manual's videos: a visible pointer, a ring round what is about
 * to be pressed, a caption bar, and title cards.
 *
 * Drawn on top of the page, never inside the program. It is one `<div>` appended to `<body>`
 * with `pointer-events: none`, so every click still lands on the real control underneath and the
 * program under it is exactly the one that ships. Nothing here is a test hook in the app.
 *
 * Headless Chromium draws no mouse pointer, so the pointer here is drawn and moved to each target
 * before the real click is sent there — a viewer sees where the press happens, then what it did.
 */
import { resolveTarget } from "./guide-shots-driver.mjs";
import { lineWaitMs, msToNextBeat } from "./guide-video-timing.mjs";

const OVERLAY_CSS = `
#mv-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font-family: "Segoe UI", system-ui, sans-serif; }
#mv-cursor { position: absolute; left: 0; top: 0; width: 28px; height: 28px; transform: translate(-100px, -100px);
  transition-property: transform; transition-timing-function: cubic-bezier(.45,.05,.25,1); filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
#mv-ripple { position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
  border: 3px solid #f59e0b; opacity: 0; transform: scale(.3); }
#mv-ripple.go { animation: mv-ripple .55s ease-out forwards; }
@keyframes mv-ripple { 0% { opacity: .95; transform: scale(.3); } 100% { opacity: 0; transform: scale(1.6); } }
#mv-ring { position: absolute; border: 3px solid #f59e0b; border-radius: 8px; box-shadow: 0 0 0 4px rgba(245,158,11,.25), 0 0 18px rgba(245,158,11,.55);
  opacity: 0; transition: opacity .25s; }
#mv-ring.on { opacity: 1; }
#mv-cap { position: absolute; left: 50%; bottom: 34px; transform: translate(-50%, 16px); max-width: 1180px; min-width: 420px;
  background: rgba(17,24,39,.92); color: #fff; border-radius: 14px; padding: 16px 26px 17px; box-shadow: 0 10px 30px rgba(0,0,0,.35);
  opacity: 0; transition: opacity .3s, transform .3s; display: flex; gap: 18px; align-items: center; }
#mv-cap.on { opacity: 1; transform: translate(-50%, 0); }
#mv-cap .n { flex: none; width: 38px; height: 38px; border-radius: 50%; background: #f59e0b; color: #111827; font-weight: 700; font-size: 20px;
  display: flex; align-items: center; justify-content: center; }
#mv-cap .n:empty { display: none; }
#mv-cap .t { font-size: 25px; font-weight: 600; line-height: 1.25; }
#mv-cap .s { font-size: 18px; opacity: .82; margin-top: 3px; line-height: 1.3; }
#mv-cap .s:empty { display: none; }
#mv-key { position: absolute; right: 34px; top: 84px; background: rgba(17,24,39,.9); color: #fff; font: 600 22px "Segoe UI", system-ui;
  padding: 9px 16px; border-radius: 10px; opacity: 0; transition: opacity .2s; }
#mv-key.on { opacity: 1; }
#mv-card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at 50% 40%, #1e3a5f 0%, #0b1220 70%); color: #fff; opacity: 0; transition: opacity .45s; }
#mv-card.on { opacity: 1; }
#mv-card .k { font-size: 22px; letter-spacing: .28em; text-transform: uppercase; color: #f59e0b; font-weight: 700; margin-bottom: 18px; }
#mv-card .h { font-size: 72px; font-weight: 700; letter-spacing: -.01em; text-align: center; max-width: 1500px; line-height: 1.08; }
#mv-card .p { font-size: 28px; opacity: .8; margin-top: 22px; text-align: center; max-width: 1300px; line-height: 1.35; }
#mv-card .p:empty, #mv-card .k:empty { display: none; }
#mv-card .logo { width: 250px; height: 250px; margin-bottom: 34px; filter: drop-shadow(0 18px 44px rgba(0,0,0,.55)); display: none; }
#mv-card .logo.on { display: block; animation: mv-logo .7s cubic-bezier(.2,.9,.3,1.3) both; }
@keyframes mv-logo { 0% { opacity: 0; transform: scale(.6) rotate(-8deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
#mv-head { position: absolute; left: 50%; top: 45%; transform: translate(-50%, -50%) scale(.9); opacity: 0; text-align: center;
  padding: 70px 170px; white-space: nowrap; transition: opacity .25s ease-out, transform .42s cubic-bezier(.2,.9,.3,1.25);
  background: radial-gradient(ellipse at center, rgba(9,8,28,.92) 0%, rgba(9,8,28,.84) 45%, rgba(9,8,28,.5) 60%, rgba(9,8,28,0) 74%); }
#mv-head.on { opacity: 1; transform: translate(-50%, -50%) scale(1); }
#mv-head .h { font-size: 104px; font-weight: 800; letter-spacing: -.025em; line-height: 1.02; color: #fff; text-shadow: 0 6px 34px rgba(0,0,0,.45); }
#mv-head .h em { font-style: normal; background: linear-gradient(90deg, #35d0ff 0%, #a855f7 55%, #ff8a3d 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
#mv-head .s { font-size: 36px; font-weight: 600; color: #fff; margin-top: 18px; letter-spacing: .005em; text-shadow: 0 2px 14px rgba(0,0,0,.8); }
#mv-head .s:empty { display: none; }
#mv-flash { position: absolute; inset: 0; background: #fff; opacity: 0; }
#mv-flash.go { animation: mv-flash .22s ease-out; }
@keyframes mv-flash { 0% { opacity: .5; } 100% { opacity: 0; } }
`;

const CURSOR_SVG =
  '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M3 2 L3 19 L7.6 14.8 L10.6 21.6 L13.6 20.3 L10.7 13.6 L17 13.6 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ bpm?: number, glide?: number, lineLength?: (text: string) => Promise<number> }} [opts]
 *   a tempo turns on `beat()`, for a video cut to a beat; `glide` scales how long the pointer takes
 *   to travel (0.5 = twice as fast); `lineLength` speaks a line and gives its length — with it, the
 *   first beat after a spoken line waits for the line to end
 */
export function makeDirector(page, { bpm, glide = 1, lineLength } = {}) {
  let pointer = { x: 960, y: 540 };
  let t0 = Date.now();
  /** Seconds into the recording — replaced by the recorder's own clock in `startClock`. */
  let clock = () => (Date.now() - t0) / 1000;
  /** Every caption, title-card and headline change, in order: when it was made, when its line
   *  (if any) starts. The narration is planned from these after filming. */
  const cues = [];
  let captionOn = false;
  /** The last spoken line, until a beat has waited for it: when it starts and (a promise of) how long it is. */
  let speaking = null;
  const listen = (cue) => {
    if (cue.say && lineLength) speaking = { at: cue.at, len: lineLength(cue.say) };
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** (Re-)draw the layer. A page load wipes it, so this runs after every `boot()`. */
  async function install() {
    await page.evaluate(
      ([css, svg, p]) => {
        document.getElementById("mv-layer")?.remove();
        const style = document.createElement("style");
        style.id = "mv-style";
        style.textContent = css;
        document.getElementById("mv-style")?.remove();
        document.head.appendChild(style);
        const layer = document.createElement("div");
        layer.id = "mv-layer";
        layer.innerHTML =
          `<div id="mv-ring"></div><div id="mv-ripple"></div><div id="mv-key"></div>` +
          `<div id="mv-cap"><div class="n"></div><div><div class="t"></div><div class="s"></div></div></div>` +
          `<div id="mv-card"><img class="logo" alt=""><div class="k"></div><div class="h"></div><div class="p"></div></div>` +
          `<div id="mv-head"><div class="h"></div><div class="s"></div></div><div id="mv-flash"></div>` +
          `<div id="mv-cursor">${svg}</div>`;
        document.body.appendChild(layer);
        document.getElementById("mv-cursor").style.transform = `translate(${p.x}px, ${p.y}px)`;
      },
      [OVERLAY_CSS, CURSOR_SVG, pointer],
    );
  }

  /** Glide the pointer to (x, y). Speed grows with distance so short hops do not crawl. */
  async function moveTo(x, y, ms) {
    const d = Math.hypot(x - pointer.x, y - pointer.y);
    const dur = ms ?? Math.round(Math.min(900, 280 + d * 0.55) * glide);
    await page.evaluate(
      ([x, y, dur]) => {
        const c = document.getElementById("mv-cursor");
        c.style.transitionDuration = `${dur}ms`;
        c.style.transform = `translate(${x}px, ${y}px)`;
      },
      [x, y, dur],
    );
    pointer = { x, y };
    // The real mouse follows, so a hover state (a tooltip, a highlighted row) shows as it would.
    await page.mouse.move(x, y, { steps: 6 });
    await wait(dur + 40);
  }

  /** A target → its viewport box. Accepts a Playwright locator or any `resolveTarget` form. */
  async function boxOf(target) {
    if (target && typeof target === "object" && typeof target.boundingBox === "function") {
      // 8 s, not Playwright's 30: a missing target is a broken script, and it should say so fast.
      await target.first().scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      const b = await target.first().boundingBox({ timeout: 8000 });
      return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
    }
    return resolveTarget(page, target);
  }

  async function ring(box, on = true) {
    await page.evaluate(
      ([b, on]) => {
        const r = document.getElementById("mv-ring");
        if (b) Object.assign(r.style, { left: `${b.x - 5}px`, top: `${b.y - 5}px`, width: `${b.w + 10}px`, height: `${b.h + 10}px` });
        r.classList.toggle("on", on);
      },
      [box, on],
    );
  }

  /**
   * Point at a target, ring it, press it. A target that resolves to nothing fails the run —
   * a video of the pointer clicking empty space would teach the wrong thing.
   *
   * @param {*} target
   * @param {{ button?: "left"|"right", double?: boolean, hold?: number, at?: { x: number, y: number }, act?: () => Promise<void> }} [o]
   *   `at` presses at that fraction of the box (default its centre); `act` replaces the press
   *   with your own (for controls that must be driven another way), still after the pointer.
   */
  async function click(target, o = {}) {
    const b = await boxOf(target);
    if (!b) throw new Error(`director.click: nothing on screen for ${JSON.stringify(String(target?.toString?.() ?? target))}`);
    const fx = o.at?.x ?? 0.5;
    const fy = o.at?.y ?? 0.5;
    const x = Math.round(b.x + b.w * fx);
    const y = Math.round(b.y + b.h * fy);
    await ring(b, true);
    await moveTo(x, y);
    await wait(o.hold ?? 180);
    await page.evaluate(([x, y]) => {
      const r = document.getElementById("mv-ripple");
      r.style.left = `${x}px`;
      r.style.top = `${y}px`;
      r.classList.remove("go");
      void r.offsetWidth;
      r.classList.add("go");
    }, [x, y]);
    if (o.act) await o.act();
    else if (o.double) await page.mouse.dblclick(x, y);
    else await page.mouse.click(x, y, { button: o.button ?? "left" });
    await wait(120);
    await ring(null, false);
    await settle();
  }

  /** Ring a target for `ms` without pressing it. */
  async function show(target, ms = 1400, { point = true } = {}) {
    const b = await boxOf(target);
    if (!b) throw new Error(`director.show: nothing on screen for ${String(target)}`);
    await ring(b, true);
    if (point) await moveTo(Math.round(b.x + b.w / 2), Math.round(b.y + b.h / 2));
    await wait(ms);
    await ring(null, false);
  }

  /**
   * The caption bar. `n` is the step number (omit for none); `sub` a second, smaller line; `say`
   * the narrator's line for this step, spoken once the caption is in.
   */
  async function caption(title, sub = "", n = "", say = undefined) {
    // A caption already showing fades out first (220 ms below); the line waits for the new one.
    const t = clock();
    cues.push({ cut: t, at: t + (captionOn ? 0.22 : 0), say });
    listen(cues[cues.length - 1]);
    captionOn = !!title;
    await page.evaluate(
      ([t, s, n]) => {
        const c = document.getElementById("mv-cap");
        const apply = () => {
          c.querySelector(".t").textContent = t;
          c.querySelector(".s").textContent = s;
          c.querySelector(".n").textContent = n;
          c.classList.toggle("on", !!t);
        };
        if (c.classList.contains("on")) {
          c.classList.remove("on");
          setTimeout(apply, 220);
        } else apply();
      },
      [title, sub, String(n)],
    );
    await wait(360);
  }

  /** A full-window title card. `null` title fades it away. `logo` (an image URL) shows the program's
   *  own mark above the title, popping in. `say` is the narrator's line for the card. */
  async function card(title, sub = "", kicker = "", { logo, say } = {}) {
    const t = clock();
    cues.push({ cut: t, at: t, say });
    listen(cues[cues.length - 1]);
    await page.evaluate(
      ([t, s, k, logo]) => {
        const c = document.getElementById("mv-card");
        // The pointer has nothing to point at on a title card.
        document.getElementById("mv-cursor").style.opacity = t == null ? "1" : "0";
        if (t == null) return c.classList.remove("on");
        c.querySelector(".h").textContent = t;
        c.querySelector(".p").textContent = s;
        c.querySelector(".k").textContent = k;
        const img = c.querySelector(".logo");
        if (logo) img.src = logo;
        img.classList.toggle("on", Boolean(logo));
        c.classList.add("on");
      },
      [title, sub, kicker, logo ?? null],
    );
    await wait(480);
  }

  /** A keyboard-shortcut chip, top right, while `keys` are pressed. */
  async function press(label, keys) {
    await page.evaluate((l) => {
      const k = document.getElementById("mv-key");
      k.textContent = l;
      k.classList.add("on");
    }, label);
    await wait(350);
    await page.keyboard.press(keys);
    await wait(650);
    await page.evaluate(() => document.getElementById("mv-key").classList.remove("on"));
    await settle();
  }

  /** Type visibly, a character at a time. */
  async function type(text, perChar = 55) {
    await page.keyboard.type(text, { delay: perChar });
    await settle();
  }

  /**
   * A headline — large text at the centre of the screen over a soft dark glow, for a title
   * card. `*word*` is drawn in the brand gradient. `null` fades it away. The program stays visible
   * round it, so the action behind carries on while the words land. `say` is the narrator's line
   * for it, spoken as it lands.
   */
  async function headline(title, sub = "", say = undefined) {
    if (title != null) {
      const t = clock();
      cues.push({ cut: t, at: t, say });
      listen(cues[cues.length - 1]);
    }
    await page.evaluate(
      ([t, s]) => {
        const el = document.getElementById("mv-head");
        // The pointer would sit on the words; it comes back when they go.
        document.getElementById("mv-cursor").style.opacity = t == null ? "1" : "0";
        if (t == null) return el.classList.remove("on");
        const esc = (x) => x.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
        el.querySelector(".h").innerHTML = esc(t).replace(/\*([^*]+)\*/g, "<em>$1</em>");
        el.querySelector(".s").textContent = s;
        el.classList.remove("on");
        void el.offsetWidth;
        el.classList.add("on");
      },
      [title, sub],
    );
  }

  /** A quick white flash — a cut marker. */
  async function flash() {
    await page.evaluate(() => {
      const f = document.getElementById("mv-flash");
      f.classList.remove("go");
      void f.offsetWidth;
      f.classList.add("go");
    });
  }

  /** Scroll the element matching `selector` by `dy` px, smoothly over `ms`. */
  async function scroll(selector, dy, ms = 700) {
    await page.evaluate(
      ([sel, dy, ms]) =>
        new Promise((resolve) => {
          const el = document.querySelector(sel);
          if (!el) throw new Error(`director.scroll: no ${sel}`);
          const from = el.scrollTop;
          const t0 = performance.now();
          const step = (now) => {
            const k = Math.min(1, (now - t0) / ms);
            const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
            el.scrollTop = from + dy * ease;
            if (k < 1) requestAnimationFrame(step);
            else resolve(null);
          };
          requestAnimationFrame(step);
        }),
      [selector, dy, ms],
    );
  }

  /**
   * The program's own loading screen, as it opens on a desktop: `splash.html` from the bundle,
   * at its real 720 × 480 shape, scaled up and centred on a dark screen. The desktop app writes
   * the version line in after the page loads (the page runs no script), and so does this.
   */
  async function splash(versionLine, scale = 1.9) {
    await page.evaluate(
      ([v, scale]) =>
        new Promise((resolve) => {
          const wrap = document.createElement("div");
          wrap.id = "mv-splash";
          Object.assign(wrap.style, {
            position: "absolute", inset: "0", background: "radial-gradient(ellipse at 50% 45%, #1b1640 0%, #05040f 75%)",
            display: "flex", alignItems: "center", justifyContent: "center", opacity: "0", transition: "opacity .7s",
          });
          const f = document.createElement("iframe");
          f.src = "/splash.html";
          Object.assign(f.style, {
            width: "720px", height: "480px", border: "0", transform: `scale(${scale})`, borderRadius: "3px",
            boxShadow: "0 30px 90px rgba(0,0,0,.6)",
          });
          f.onload = () => {
            const el = f.contentDocument?.getElementById("version");
            if (el) el.textContent = v;
            wrap.style.opacity = "1";
            resolve(null);
          };
          wrap.appendChild(f);
          document.getElementById("mv-layer").appendChild(wrap);
          document.getElementById("mv-cursor").style.opacity = "0";
        }),
      [versionLine, scale],
    );
    await wait(750);
  }

  const settle = () =>
    page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));

  /** Wait for the next beat (every `every` beats) — after the last spoken line has ended, if one
   *  is still being said. Needs a tempo. */
  async function beat(every = 1) {
    if (!bpm) throw new Error("director.beat: this video was made without a tempo");
    if (speaking) {
      const line = { at: speaking.at, len: await speaking.len };
      speaking = null;
      await wait(lineWaitMs(clock(), line));
    }
    await wait(msToNextBeat(Date.now() - t0, bpm, every));
  }

  return {
    page, install, moveTo, click, show, caption, card, headline, press, type, flash, beat, settle, wait, boxOf, scroll, splash,
    cues,
    /** Restart the clocks — call when recording starts, with the recording's own clock
     *  (seconds since it started) so the cues are in the video's time. */
    startClock: (now) => {
      t0 = Date.now();
      if (now) clock = now;
      cues.length = 0;
    },
  };
}
