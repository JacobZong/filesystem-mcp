"""End-to-end check of a candidate image against the real Xberg converter.

Usage: python3 .nas/integration.py <candidate_image> <fixtures_dir> [xberg_image]
Runs both containers the way the NAS does (read-only root, cap_drop ALL,
uid 1000, converter on an internal network), then exercises the three
document tools and the read-only guarantee over MCP/HTTP. Exit 1 on failure.
"""
import base64
import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

image, fixtures = sys.argv[1], os.path.abspath(sys.argv[2])
xberg = sys.argv[3] if len(sys.argv) > 3 else "ghcr.io/xberg-io/xberg:core"
key = secrets.token_hex(16)
port = 3999
net = f"nasit-{secrets.token_hex(3)}"
write_dir = tempfile.mkdtemp(prefix="nasit-write-")
os.chmod(write_dir, 0o777)
failures = []


def sh(*args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True)


def check(name, ok, detail=""):
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name)


class Mcp:
    def __init__(self):
        self.sid = None
        self.n = 0

    def call(self, method, params=None, notify=False):
        msg = {"jsonrpc": "2.0", "method": method, **({"params": params} if params is not None else {})}
        if not notify:
            self.n += 1
            msg["id"] = self.n
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                   "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18"}
        if self.sid:
            headers["Mcp-Session-Id"] = self.sid
        req = urllib.request.Request(f"http://127.0.0.1:{port}/mcp", json.dumps(msg).encode(), headers)
        with urllib.request.urlopen(req, timeout=180) as r:
            self.sid = r.headers.get("Mcp-Session-Id") or self.sid
            body = r.read().decode()
        if notify or not body.strip():
            return {}
        if "data:" in body[:10] or body.startswith("event:"):
            body = [l[5:] for l in body.splitlines() if l.startswith("data:")][-1]
        return json.loads(body)

    def tool(self, name, args):
        res = self.call("tools/call", {"name": name, "arguments": args}).get("result", {})
        text = "\n".join(b.get("text", "") for b in res.get("content", []) if b.get("type") == "text")
        images = [b for b in res.get("content", []) if b.get("type") == "image"]
        return res, text, images


try:
    sh("docker", "network", "create", "--internal", net)
    sh("docker", "run", "-d", "--name", f"{net}-conv", "--network", net, "--network-alias", "converter",
       "--read-only", "--tmpfs", "/tmp:size=512m,mode=1777", "--tmpfs", "/app/.xberg:size=256m,uid=1000,gid=1000",
       "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", xberg)
    sh("docker", "run", "-d", "--name", f"{net}-fs", "--init", "--user", "1000:1000", "-p", f"127.0.0.1:{port}:3000",
       "-e", "FS_PORT=3000", "-e", "FS_HTTP_HOST=0.0.0.0", "-e", "FS_ALLOW_UNRESTRICTED_HOSTS=true",
       "-e", f"FS_API_KEY={key}", "-e", "FS_ROOT_BOUNDARY=/data", "-e", "FS_CONVERTER_URL=http://converter:8000",
       "-v", f"{fixtures}:/data/read/fixtures:ro", "-v", f"{write_dir}:/data/write",
       "--read-only", "--tmpfs", "/tmp:size=512m,mode=1777", "--cap-drop", "ALL",
       "--security-opt", "no-new-privileges:true", image, "/data/read", "/data/write")
    sh("docker", "network", "connect", net, f"{net}-fs")

    deadline = time.time() + 90
    while True:
        try:
            urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/mcp", b"{}", method="POST"), timeout=5)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                break
        except OSError:
            pass
        if time.time() > deadline:
            raise SystemExit("candidate did not start: " + sh("docker", "logs", f"{net}-fs", check=False).stderr[-2000:])
        time.sleep(2)

    s = Mcp()
    init = s.call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                 "clientInfo": {"name": "nas-integration", "version": "1"}})
    s.call("notifications/initialized", notify=True)
    check("initialize", "result" in init, init.get("result", {}).get("serverInfo", {}).get("version", ""))
    names = {t["name"] for t in s.call("tools/list").get("result", {}).get("tools", [])}
    check("document tools are registered", {"read_document", "read_pdf_pages", "read_video_frames", "write_binary"} <= names,
          ", ".join(sorted(names & {"read_document", "read_pdf_pages", "read_video_frames", "write_binary"})))

    for attempt in range(30):  # the converter may still be starting
        res, text, _ = s.tool("read_document", {"path": "/data/read/fixtures/sample.epub"})
        if not res.get("isError") or "unreachable" not in text:
            break
        time.sleep(2)
    check("read_document EPUB via converter", not res.get("isError") and "NAS integration chapter" in text, text[:100])

    res, text, imgs = s.tool("read_pdf_pages", {"path": "/data/read/fixtures/sample.pdf", "pages": "1-2", "dpi": 72})
    pngs = [i for i in imgs if base64.b64decode(i["data"])[1:4] == b"PNG"]
    check("read_pdf_pages renders 2 PNG pages", not res.get("isError") and len(pngs) == 2, text.splitlines()[0][:100] if text else "")

    res, text, imgs = s.tool("read_video_frames", {"path": "/data/read/fixtures/sample.mp4", "frames": 2, "width": 320})
    check("read_video_frames returns 2 JPEG frames", not res.get("isError") and len(imgs) == 2, text.splitlines()[0][:100] if text else "")

    res, text, _ = s.tool("read", {"path": "/data/read/fixtures/sample.epub"})
    check("read routes EPUB to the converter", not res.get("isError") and "NAS integration chapter" in text
          and "read_document" in text, text.splitlines()[0][:100] if text else "")

    res, text, _ = s.tool("locate", {"query": "sample"})
    check("locate finds the fixtures by name", not res.get("isError") and "sample.epub" in text and "sample.pdf" in text,
          text.splitlines()[0][:100] if text else "")

    res, text, _ = s.tool("create", {"files": [{"path": "/data/read/fixtures/must-fail.txt", "content": "x"}]})
    check("write under /data/read is blocked", bool(res.get("isError")), "blocked" if res.get("isError") else "WRITE SUCCEEDED")

    res, text, _ = s.tool("create", {"files": [{"path": "/data/write/probe.txt", "content": "ok"}]})
    check("write under /data/write works", not res.get("isError"), text[:80])

    # Fork: write_binary (binary upload for the learning audio) and read returning audio.
    import hashlib
    audio = open(os.path.join(fixtures, "sample.mp3"), "rb").read()
    digest = hashlib.sha256(audio).hexdigest()
    b64 = base64.b64encode(audio).decode()
    res, text, _ = s.tool("write_binary", {"path": "/data/write/learning/sample.mp3", "data_base64": b64,
                                           "sha256": digest})
    landed = os.path.join(write_dir, "learning", "sample.mp3")
    same = os.path.exists(landed) and open(landed, "rb").read() == audio
    check("write_binary stores the exact MP3 bytes", not res.get("isError") and same and digest in text, text[:120])

    res, text, _ = s.tool("write_binary", {"path": "/data/write/learning/sample.mp3", "data_base64": b64})
    check("write_binary refuses an existing file without overwrite", bool(res.get("isError")), text[:80])

    res, text, _ = s.tool("write_binary", {"path": "/data/read/fixtures/must-fail.mp3", "data_base64": b64})
    check("write_binary under /data/read is blocked", bool(res.get("isError")), "blocked" if res.get("isError") else "WRITE SUCCEEDED")

    # No per-file limit: 20 MB (above the 10 MiB per-call bound) in appended chunks, then moved into place.
    big = os.urandom(20 * 1024 * 1024)
    whole = hashlib.sha256(big).hexdigest()
    step, ok = 6 * 1024 * 1024, True
    for off in range(0, len(big), step):
        chunk = big[off:off + step]
        args = {"path": "/data/write/big/video.bin.part", "data_base64": base64.b64encode(chunk).decode(),
                "sha256": hashlib.sha256(chunk).hexdigest(), "append": True}
        if off + step >= len(big):
            args["file_sha256"] = whole
        res, text, _ = s.tool("write_binary", args)
        ok = ok and not res.get("isError")
    res, text, _ = s.tool("move", {"moves": [{"source": "/data/write/big/video.bin.part", "destination": "/data/write/big/video.bin"}]})
    landed = os.path.join(write_dir, "big", "video.bin")
    same = os.path.exists(landed) and hashlib.sha256(open(landed, "rb").read()).hexdigest() == whole
    check("write_binary uploads a 20 MB file in chunks (no per-file limit)", ok and not res.get("isError") and same,
          "verified" if same else text[:120])

    res = s.call("tools/call", {"name": "read", "arguments": {"path": "/data/write/learning/sample.mp3"}}).get("result", {})
    blocks = [b for b in res.get("content", []) if b.get("type") == "audio"]
    check("read returns the MP3 as an audio block", len(blocks) == 1 and base64.b64decode(blocks[0].get("data", "")) == audio,
          ", ".join(b.get("type", "") for b in res.get("content", [])))
finally:
    for name in (f"{net}-fs", f"{net}-conv"):
        sh("docker", "rm", "-f", name, check=False)
    sh("docker", "network", "rm", net, check=False)

print(f"{'FAILED: ' + ', '.join(failures) if failures else 'ALL PASSED'}")
sys.exit(1 if failures else 0)
