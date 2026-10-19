// @vitest-environment jsdom
/**
 * The manual's videos — the contract between `guide.ts`'s "video" blocks, the .webm files in
 * `../assets/guide/` and the list `scripts/gen-guide-videos.mjs` films (`guide-videos.spec.mjs`).
 *
 * Default-deny in every direction, for the reasons the pictures are (`guide-shots.test.ts`): a
 * block naming a file that is not bundled renders as nothing; a bundled file no block shows is
 * ~10 MB of installer for nothing; and a video the recorder does not make is one nobody can
 * re-film after the next UI change.
 *
 * Plus the recorder's own arithmetic (`guide-video-timing.mjs`), which decides what frame a
 * viewer sees at each moment — a mistake there shows a click's result before the click.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE, type GuideBlock } from "./guide";
import { GUIDE_VIDEOS, GuidePane } from "./GuidePane";
import { VIDEOS as SPEC } from "../../../../../../scripts/guide-videos.spec.mjs";
import { beatMs, frameSchedule, lineWaitMs, msToNextBeat, planNarration, withHolds } from "../../../../../../scripts/guide-video-timing.mjs";
import { PRONOUNCE, kokoroLang, lineKey, narrationMixArgs, narratorChoice, parseLoudness, piperArgs, pronounced, soundtrackMuxArgs, wavSeconds } from "../../../../../../scripts/guide-video-voice.mjs";
import { makeDirector } from "../../../../../../scripts/guide-video-director.mjs";

type Video = Extract<GuideBlock, { kind: "video" }>;
/** The manual's presentation video, made from the presentation's own cut rather than filmed by the recorder. */
const PRESENTATION = "video-mady-presentation.webm";
const BLOCKS: Video[] = GUIDE.flatMap((s) => s.blocks.filter((b): b is Video => b.kind === "video"));

afterEach(cleanup);

describe("manual videos", () => {
  it("has the five videos — this suite must not be vacuously green", () => {
    expect(BLOCKS.length).toBe(5);
  });

  it("every video block names a bundled .webm", () => {
    for (const b of BLOCKS) {
      expect(GUIDE_VIDEOS[b.file], `"${b.file}" is in the manual but not bundled — run scripts/gen-guide-videos.mjs`).toBeTruthy();
    }
  });

  it("every bundled .webm is shown by a video block", () => {
    const shown = new Set(BLOCKS.map((b) => b.file));
    for (const file of Object.keys(GUIDE_VIDEOS)) {
      expect(shown.has(file), `assets/guide/${file} ships but no manual block shows it`).toBe(true);
    }
  });

  it("the recorder films exactly the videos the manual shows, besides the presentation", () => {
    // The presentation is cut from its own recordings by the presentation script, not filmed here.
    expect(new Set([...SPEC.map((v) => v.file), PRESENTATION])).toEqual(new Set(BLOCKS.map((b) => b.file)));
    expect(new Set(SPEC.map((v) => v.file)).size, "two spec entries film the same file").toBe(SPEC.length);
  });

  it("every video carries a real alt text and caption, and they are not the same words", () => {
    for (const b of BLOCKS) {
      expect(b.alt.trim().length, `${b.file}: alt text too short to describe a video`).toBeGreaterThan(80);
      expect(b.caption.trim().length, `${b.file}: caption too short to say anything`).toBeGreaterThan(40);
      expect(b.alt.trim(), `${b.file}: alt and caption are the same string`).not.toBe(b.caption.trim());
    }
  });

  it("the Documentation page draws one player per video block, named by its file", () => {
    const { container } = render(<GuidePane version="1" />);
    const players = [...container.querySelectorAll<HTMLVideoElement>("video[data-video]")];
    expect(players.map((v) => v.getAttribute("data-video")).sort()).toEqual(BLOCKS.map((b) => b.file).sort());
    for (const v of players) {
      expect(v.hasAttribute("controls"), `${v.dataset.video}: a video with no controls cannot be played`).toBe(true);
      expect(v.getAttribute("src"), `${v.dataset.video}: no source`).toBeTruthy();
      expect(v.getAttribute("aria-label")?.length ?? 0, `${v.dataset.video}: no accessible description`).toBeGreaterThan(80);
    }
  });
});

describe("frameSchedule — which captured frame each moment of the video shows", () => {
  it("shows the last frame that had arrived by each moment", () => {
    // Slots at 0, 0.1, 0.2 s: 0.05 is the newest by 0.1, and 0.2 counts at exactly 0.2.
    expect(frameSchedule([0, 0.05, 0.2], 0, 0.3, 10)).toEqual([0, 1, 2]);
  });

  it("holds a frame while nothing repaints", () => {
    expect(frameSchedule([0, 0.35], 0, 0.5, 10)).toEqual([0, 0, 0, 0, 1]);
  });

  it("never shows a frame before it was captured — a click's result never precedes the click", () => {
    const stamps = [0, 0.013, 0.021, 0.09, 0.091, 0.34, 0.5, 0.52, 0.93];
    const fps = 30;
    const out = frameSchedule(stamps, 0, 1, fps);
    out.forEach((i, k) => expect(stamps[i]!, `slot ${k}`).toBeLessThanOrEqual(k / fps + 1e-12));
  });

  it("stands the first frame in for the moments before it arrived", () => {
    expect(frameSchedule([0.25], 0, 0.3, 10)).toEqual([0, 0, 0]);
  });

  it("makes one frame per 1/fps of the recording", () => {
    expect(frameSchedule([10], 10, 12.5, 30)).toHaveLength(75);
  });

  it("refuses a recording with no frames or no length, rather than writing an empty video", () => {
    expect(() => frameSchedule([], 0, 1, 30)).toThrow(/no frames/);
    expect(() => frameSchedule([0], 5, 5, 30)).toThrow(/no length/);
  });
});

describe("planNarration — where the spoken lines go and where the picture waits for them", () => {
  it("changes nothing when every line fits its step", () => {
    const p = planNarration([{ cut: 0, at: 0, dur: 2 }, { cut: 5, at: 5.2, dur: 3 }], 10, { breath: 0.3, lead: 0.1 });
    expect(p.holds).toEqual([]);
    expect(p.starts).toEqual([0, 5.2]);
    expect(p.length).toBe(10);
  });

  it("holds the picture just before the next step by exactly the shortfall, and shifts what follows", () => {
    // Step 1 has 4 s; its line needs 5 + 0.3 s, so the picture waits 1.3 s just before the cut at 4.
    const p = planNarration([{ cut: 0, at: 0, dur: 5 }, { cut: 4, at: 4.2, dur: 1 }], 8, { breath: 0.3, lead: 0.1 });
    expect(p.holds).toHaveLength(1);
    expect(p.holds[0]!.at).toBeCloseTo(3.9, 9);
    expect(p.holds[0]!.extra).toBeCloseTo(1.3, 9);
    expect(p.starts[1]).toBeCloseTo(5.5, 9);
    expect(p.length).toBeCloseTo(9.3, 9);
  });

  it("a silent change (a caption cleared, a card faded) still ends the room of the line before it", () => {
    const p = planNarration([{ cut: 0, at: 0, dur: 3 }, { cut: 2, at: 2 }], 6, { breath: 0, lead: 0 });
    expect(p.holds.map((h) => [h.at, h.extra])).toEqual([[2, 1]]);
    expect(p.starts).toEqual([0, null]);
  });

  it("the last line's room runs to the end of the video", () => {
    const p = planNarration([{ cut: 0, at: 1, dur: 4 }], 3, { breath: 0, lead: 0.1 });
    expect(p.holds.map((h) => [h.at, h.extra])).toEqual([[2.9, 2]]);
    expect(p.length).toBe(5);
  });

  it("never lets two lines overlap, whatever the step lengths", () => {
    const durs = [2.5, 0.4, 3.1, 0.2, 2.2, 1];
    const cues = [0, 1.2, 1.9, 4, 4.3, 9].map((cut, i) => ({ cut, at: cut + 0.2, dur: durs[i]! }));
    const p = planNarration(cues, 11, { breath: 0.3, lead: 0.1 });
    for (let i = 0; i + 1 < cues.length; i++) {
      expect(p.starts[i]! + cues[i]!.dur + 0.3, `line ${i} runs into line ${i + 1}`).toBeLessThanOrEqual(p.starts[i + 1]! + 1e-9);
    }
  });

  it("a headline is a cue like a caption: its line is spoken as it lands; clearing it is not a step", async () => {
    const page = { evaluate: async () => null };
    const d = makeDirector(page as never);
    let now = 3;
    d.startClock(() => now);
    await d.headline("*Over 50* graph types", "every one editable", "Over fifty graph types.");
    now = 5;
    await d.headline(null);
    now = 6;
    await d.headline("Click *anything*.");
    expect(d.cues).toEqual([
      { cut: 3, at: 3, say: "Over fifty graph types." },
      { cut: 6, at: 6, say: undefined },
    ]);
  });

  it("lineWaitMs: the wait left for a line and its breath to end, none once it has", () => {
    expect(lineWaitMs(1, { at: 0.5, len: 2 }, 0.35)).toBeCloseTo(1850, 6);
    expect(lineWaitMs(3, { at: 0.5, len: 2 }, 0.35)).toBe(0);
    expect(lineWaitMs(1, null)).toBe(0);
  });

  it("in a beat-cut video, the beat after a spoken line waits for it to end, then lands on the beat", async () => {
    vi.useFakeTimers();
    try {
      const page = { evaluate: async () => null };
      const d = makeDirector(page as never, { bpm: 120, lineLength: async () => 3 });
      const start = Date.now();
      d.startClock(() => (Date.now() - start) / 1000);
      await d.headline("Hi", "", "A line three seconds long.");
      let doneAt = -1;
      void d.beat(2).then(() => (doneAt = Date.now() - start));
      await vi.advanceTimersByTimeAsync(3300);
      expect(doneAt).toBe(-1); // the line and its breath (3.35 s) are not over
      await vi.advanceTimersByTimeAsync(1000);
      expect(doneAt).toBe(4000); // then the next two-beat mark, not 3.35 s
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses cues out of order, rather than placing a line against the wrong step", () => {
    expect(() => planNarration([{ cut: 3, at: 3, dur: 1 }, { cut: 1, at: 1, dur: 1 }], 5)).toThrow(/order/);
  });
});

describe("withHolds — the picture waiting for a line", () => {
  it("repeats the frame on screen at the hold for the extra time, and leaves every other frame alone", () => {
    // 10 frames a second; a 0.3 s hold at 0.2 s repeats frame slot 2 three more times.
    expect(withHolds([0, 1, 2, 3, 4], [{ at: 0.2, extra: 0.3 }], 10)).toEqual([0, 1, 2, 2, 2, 2, 3, 4]);
  });

  it("a hold at the very end repeats the last frame", () => {
    expect(withHolds([0, 1, 2], [{ at: 5, extra: 0.2 }], 10)).toEqual([0, 1, 2, 2, 2]);
  });

  it("no holds, no change", () => {
    expect(withHolds([4, 5, 6], [], 30)).toEqual([4, 5, 6]);
  });
});

describe("the narration's sound", () => {
  /** A minimal PCM .wav header in front of `n` sample frames. */
  const wav = (rate: number, channels: number, bits: number, n: number) => {
    const data = n * channels * (bits / 8);
    const b = Buffer.alloc(44 + data);
    b.write("RIFF", 0, "ascii");
    b.writeUInt32LE(36 + data, 4);
    b.write("WAVEfmt ", 8, "ascii");
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(channels, 22);
    b.writeUInt32LE(rate, 24);
    b.writeUInt32LE(rate * channels * (bits / 8), 28);
    b.writeUInt16LE(channels * (bits / 8), 32);
    b.writeUInt16LE(bits, 34);
    b.write("data", 36, "ascii");
    b.writeUInt32LE(data, 40);
    return b;
  };

  it("reads a spoken line's length from its .wav", () => {
    expect(wavSeconds(wav(22050, 1, 16, 44100))).toBe(2);
    expect(wavSeconds(wav(48000, 2, 16, 12000))).toBe(0.25);
  });

  it("Piper speaks at the voice's own pace unless a faster or slower one is asked for", () => {
    const piper = { exe: "piper.exe", voice: "v.onnx" };
    expect(piperArgs(piper, "o.wav")).toEqual(["--model", "v.onnx", "--output_file", "o.wav"]);
    // Piper's length scale is the inverse of the pace: 1.25 times as fast = 0.8 of the length
    expect(piperArgs(piper, "o.wav", { pace: 1.25 }).slice(-2)).toEqual(["--length_scale", "0.8"]);
    expect(() => piperArgs(piper, "o.wav", { pace: 0 })).toThrow(/pace/);
  });

  it("the narrator is Kokoro's af_heart unless another is asked for", () => {
    expect(narratorChoice(undefined)).toEqual({ kind: "kokoro", voice: "af_heart", lang: "en-us" });
    expect(narratorChoice("kokoro:bf_emma")).toEqual({ kind: "kokoro", voice: "bf_emma", lang: "en-gb" });
    expect(narratorChoice("piper")).toEqual({ kind: "piper" });
    expect(() => narratorChoice("kokoro")).toThrow(/MADY_VOICE/);
  });

  it("a Kokoro voice's name says its language; a name that is not an English voice is refused", () => {
    expect(kokoroLang("af_heart")).toBe("en-us");
    expect(kokoroLang("bm_george")).toBe("en-gb");
    for (const bad of ["jf_alpha", "af", "heart", "zf_xiaobei"]) expect(() => kokoroLang(bad)).toThrow(/English Kokoro voice/);
  });

  it("a spoken line's file is named by its voice and its words: another voice never reuses it", () => {
    expect(lineKey("kokoro:af_heart", "One click.")).toBe(lineKey("kokoro:af_heart", "One click."));
    expect(lineKey("kokoro:af_heart", "One click.")).not.toBe(lineKey("piper:en_GB-cori-high.onnx", "One click."));
    expect(lineKey("kokoro:af_heart", "One click.")).not.toBe(lineKey("kokoro:af_heart", "Two clicks."));
  });

  it("a soundtrack is laid under the picture as it is, set to its loudness in one gain from what was measured", () => {
    const m = { input_i: "-20.3", input_tp: "-4.0", input_lra: "6.1", input_thresh: "-30.5", target_offset: "0.2" };
    const args = soundtrackMuxArgs("v.webm", "s.wav", "out.webm", m, -16);
    expect(args.slice(args.indexOf("-c:v"), args.indexOf("-c:v") + 2)).toEqual(["-c:v", "copy"]);
    const af = args[args.indexOf("-af") + 1]!;
    expect(af).toContain("I=-16");
    expect(af).toContain("measured_I=-20.3");
    expect(af).toContain("measured_TP=-4.0");
    expect(af).toContain("linear=true");
    expect(args.at(-1)).toBe("out.webm");
  });

  it("reads the loudness from among ffmpeg's other lines, and says so when there is none", () => {
    const printed = '[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-20.31",\n\t"input_tp" : "-3.98"\n}\n[out#0/null] video:0KiB audio:57000KiB';
    expect(parseLoudness(printed)).toEqual({ input_i: "-20.31", input_tp: "-3.98" });
    expect(() => parseLoudness("ffmpeg: no such file")).toThrow(/no loudness/);
  });

  it("a word the engine misreads is given its sounds; the rest of the line is spoken as written", () => {
    expect(pronounced("Forty-nine analyses. Say what you want to know.")).toEqual([
      { text: "Forty-nine " },
      { ipa: "ənˈæləsiːz" },
      { text: ". Say what you want to know." },
    ]);
    expect(pronounced("Analyses corresponding best to your data come first.")[0]).toEqual({ ipa: "ənˈæləsiːz" });
    expect(pronounced("Every part, editable.")).toEqual([{ text: "Every part, " }, { ipa: "ˈɛdɪtəbəl" }, { text: "." }]);
    expect(pronounced("Use it on any graph, with one click.")[0]).toEqual({ ipa: "jˈuːz ɪt" });
    expect(pronounced("Export the whole figure.")[0]).toEqual({ ipa: "ɛkspˈɔːɹt" });
  });

  it("only whole words are replaced, and a line without any is left as one piece", () => {
    expect(pronounced("That's an analysis. Next: style presets.")).toEqual([{ text: "That's an analysis. Next: style presets." }]);
    expect(pronounced("Every test says when to use them.")).toEqual([{ text: "Every test says when to use them." }]);
    expect(pronounced("The exporter and the analysesque")).toEqual([{ text: "The exporter and the analysesque" }]);
    expect(PRONOUNCE.every(([w, ipa]) => w === w.toLowerCase() && ipa.length > 0)).toBe(true);
  });

  it("refuses a file that is not a .wav, rather than timing the video against nothing", () => {
    expect(() => wavSeconds(Buffer.from("not a wav file at all, just some text here"))).toThrow(/wav/);
  });

  it("each line enters the mix at its own time and the picture is copied, not re-encoded", () => {
    const args = narrationMixArgs("v.webm", [{ wav: "a.wav", start: 0 }, { wav: "b.wav", start: 4.25 }], "out.webm");
    const fc = args[args.indexOf("-filter_complex") + 1]!;
    expect(fc).toContain("[1:a]adelay=0|0");
    expect(fc).toContain("[2:a]adelay=4250|4250");
    expect(fc).toContain("amix=inputs=2");
    expect(args.slice(args.indexOf("-c:v"), args.indexOf("-c:v") + 2)).toEqual(["-c:v", "copy"]);
    expect(args.at(-1)).toBe("out.webm");
  });
});

describe("the overview video's beat", () => {
  it("beat i is i × 60 000 / bpm milliseconds in", () => {
    expect(beatMs(120, 0)).toBe(0);
    expect(beatMs(120, 3)).toBe(1500);
    expect(beatMs(90, 2)).toBeCloseTo(1333.333, 2);
  });

  it("waits to the next beat, and not at all when already on one", () => {
    expect(msToNextBeat(0, 120)).toBe(0);
    expect(msToNextBeat(500, 120)).toBe(0);
    expect(msToNextBeat(100, 120)).toBe(400);
    expect(msToNextBeat(499, 120)).toBe(1);
  });

  it("cuts on every n-th beat when asked", () => {
    expect(msToNextBeat(600, 120, 2)).toBe(400);
    expect(msToNextBeat(1000, 120, 2)).toBe(0);
    expect(msToNextBeat(1001, 120, 4)).toBe(999);
  });
});
