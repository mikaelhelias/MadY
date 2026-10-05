"""Standalone protocol round-trip check for the FROZEN engine.

Launches a target engine as a child process and exercises the framed-JSON-over-
stdio protocol end-to-end WITHOUT Electron: handshake (hello), a dependency-free
ping, and one real numpy/scipy path (describe) plus a statsmodels path
(regression) to prove the heavy libraries are actually bundled and importable.

Usage:
    py -3 roundtrip_test.py dist/mady-engine/mady-engine.exe   # frozen
    py -3 roundtrip_test.py --source                                # dev engine.py

Exit code 0 = all checks passed.
"""

import json
import struct
import subprocess
import sys


def write_frame(stream, message):
    body = json.dumps(message).encode("utf-8")
    stream.write(struct.pack(">I", len(body)))
    stream.write(body)
    stream.flush()


def read_frame(stream):
    header = stream.read(4)
    if len(header) < 4:
        raise SystemExit("engine closed the pipe before sending a full frame")
    (length,) = struct.unpack(">I", header)
    body = b""
    while len(body) < length:
        chunk = stream.read(length - len(body))
        if not chunk:
            raise SystemExit("engine closed the pipe mid-frame")
        body += chunk
    return json.loads(body.decode("utf-8"))


def main():
    args = sys.argv[1:]
    if args and args[0] == "--source":
        cmd = [sys.executable, "engine.py"]
    elif args:
        cmd = [args[0]]
    else:
        raise SystemExit("usage: roundtrip_test.py <engine.exe> | --source")

    print(f"launching: {' '.join(cmd)}")
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    try:
        # 1) handshake
        hello = read_frame(proc.stdout)
        assert hello.get("type") == "hello", hello
        assert hello.get("contractVersion") == 1, hello
        print(f"  hello: {hello['engine']} {hello['version']} contract v{hello['contractVersion']}")

        # 2) ping (dependency-free transport check)
        write_frame(proc.stdin, {"type": "request", "id": "1", "method": "ping",
                                 "data": {"echo": "hi"}})
        res = read_frame(proc.stdout)
        assert res.get("type") == "result" and res["results"]["pong"] is True, res
        assert res["results"]["echo"] == "hi", res
        print("  ping: ok")

        # 3) describe (numpy + scipy)
        write_frame(proc.stdin, {"type": "request", "id": "2", "method": "describe",
                                 "data": {"values": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}})
        res = read_frame(proc.stdout)
        assert res.get("type") == "result", res
        print(f"  describe: ok (numpy+scipy bundled) -> {len(res['results'])} fields")

        # 4) regression (statsmodels)
        write_frame(proc.stdin, {"type": "request", "id": "3", "method": "regression",
                                 "data": {"x": [1, 2, 3, 4, 5], "y": [2.1, 3.9, 6.2, 7.8, 10.1]}})
        res = read_frame(proc.stdout)
        assert res.get("type") == "result", res
        print("  regression: ok (statsmodels bundled)")

        print("All checks passed")
        return 0
    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
