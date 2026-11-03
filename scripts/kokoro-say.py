"""Speak lines with Kokoro, an offline text-to-speech model, for the manual's videos.

Started by `guide-video-voice.mjs`; not part of MadY. It loads the model once, then reads one
request per line on stdin, as JSON: {"text": ..., "parts": [{"text": ...} | {"ipa": ...}],
"out": ".wav path", "voice": "af_heart", "lang": "en-us", "speed": 1.0}. When a part gives its
sounds (`ipa`), the rest of the line is spelt out in sounds too and the line is spoken from the
sounds. For each request it writes the .wav (24 kHz, mono, 16-bit) and prints one line of JSON:
{"out": ..., "seconds": ...}, or {"error": ...}.

Argument: the folder holding kokoro-v1.0.onnx, voices-v1.0.bin and the Python packages in `py/`
(kokoro-onnx and what it needs), as `pip install --target <folder>/py kokoro-onnx` puts them.
"""

import json
import os
import sys
import wave

HOME = sys.argv[1]
sys.path.insert(0, os.path.join(HOME, "py"))

import numpy as np  # noqa: E402
import onnxruntime as rt  # noqa: E402
from kokoro_onnx import Kokoro  # noqa: E402

# Four threads at most, so making the videos leaves the computer usable for other work.
opts = rt.SessionOptions()
opts.intra_op_num_threads = 4
opts.inter_op_num_threads = 1
session = rt.InferenceSession(os.path.join(HOME, "kokoro-v1.0.onnx"), sess_options=opts, providers=["CPUExecutionProvider"])
model = Kokoro.from_session(session, os.path.join(HOME, "voices-v1.0.bin"))
# The first line spoken takes seconds longer than the rest while the model warms up; spend that on
# a throwaway word now, so "ready" means every line after it is quick.
model.create("Ready.", voice="af_heart", speed=1.0, lang="en-us")
print(json.dumps({"ready": True}), flush=True)

for line in sys.stdin:
    if not line.strip():
        continue
    try:
        req = json.loads(line)
        parts = req.get("parts") or [{"text": req["text"]}]
        if any("ipa" in p for p in parts):
            said = " ".join(p["ipa"] if "ipa" in p else model.tokenizer.phonemize(p["text"], req["lang"]) for p in parts)
            samples, rate = model.create(said, voice=req["voice"], speed=req.get("speed", 1.0), lang=req["lang"], is_phonemes=True)
        else:
            samples, rate = model.create(req["text"], voice=req["voice"], speed=req.get("speed", 1.0), lang=req["lang"])
        pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
        with wave.open(req["out"], "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(pcm.tobytes())
        print(json.dumps({"out": req["out"], "seconds": len(samples) / rate}), flush=True)
    except Exception as e:  # one bad line is reported, and the next still gets spoken
        print(json.dumps({"error": str(e)}), flush=True)
