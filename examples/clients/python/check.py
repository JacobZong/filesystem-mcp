"""Keyless end-to-end check: the real script against the built server, over
stdio in both protocol eras and over HTTP. Run `npm run build` at the
repository root first, and `pip install -r requirements.txt` here."""

import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.abspath(
    os.environ.get("FS_MCP_BIN") or os.path.join(HERE, "../../../dist/index.js")
)
KEY = "py-check-key-0123456789"


def run(*args: str, stdin: str = "", env: dict | None = None) -> tuple[int, str, str]:
    proc = subprocess.run(
        [sys.executable, os.path.join(HERE, "todo_report.py"), *args],
        input=stdin,
        capture_output=True,
        text=True,
        timeout=120,
        env={**os.environ, "FS_MCP_BIN": SERVER, **(env or {})},
    )
    return proc.returncode, proc.stdout, proc.stderr


def write(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)


ws = tempfile.mkdtemp(prefix="todo-report-")
write(
    f"{ws}/src/a.ts",
    "const a = 1; // TODO: rename a\n/* FIXME handle errors */\nconst todoList = [];\n",
)
write(f"{ws}/src/b.py", "# HACK(me): temporary\n")
write(f"{ws}/big.txt", "".join(f"TODO item {n}\n" for n in range(1200)))  # more than one page
write(f"{ws}/node_modules/dep/index.js", "// TODO in a dependency\n")  # ignored by default
write(f"{ws}/.env", "TODO=secret\n")  # a secret file: never read

for era in ([], ["--legacy"]):
    code, out, err = run(ws, *era)
    assert code == 0, err
    assert "## FIXME (1)" in out and "`src/a.ts:2` handle errors" in out, out
    assert "`src/b.py:1` temporary (me)" in out, out
    assert "## TODO (1201)" in out, out  # both pages of big.txt, plus src/a.ts
    assert "dependency" not in out and ".env" not in out and "todoList" not in out, out

# --out writes into the workspace; replacing it is the server's question.
code, _, err = run(ws, "--out", "TODO.md")
assert code == 0, err
assert open(f"{ws}/TODO.md").read().startswith("# TODO report")
write(f"{ws}/TODO.md", "old\n")
code, _, err = run(ws, "--out", "TODO.md")  # closed stdin declines
assert code == 1 and "declined" in err, err
assert open(f"{ws}/TODO.md").read() == "old\n"
code, _, err = run(ws, "--out", "TODO.md", stdin="1\n")
assert code == 0 and "Overwrite it?" in err, err
report = open(f"{ws}/TODO.md").read()
assert report.startswith("# TODO report") and "## TODO (1201)" in report, report[
    :200
]  # not counting itself
os.remove(f"{ws}/TODO.md")

# HTTP, with and without the API key.
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
server = subprocess.Popen(
    ["node", SERVER, "--port", str(port), ws],
    env={**os.environ, "FS_API_KEY": KEY},
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
try:
    for _ in range(100):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    url = f"http://127.0.0.1:{port}/mcp"
    code, out, _ = run("--url", url, env={"FS_API_KEY": ""})
    assert code != 0, out
    code, out, err = run("--url", url, env={"FS_API_KEY": KEY})
    assert code == 0 and "## TODO (1201)" in out, err
finally:
    server.terminate()

print("check: ok")
