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


# Over HTTP the paths in the report come from the server, which spells a
# Windows drive letter in lower case.
fold = str.lower if os.name == "nt" else str


def section(report: str, tag: str) -> str:
    """The entries under one tag's heading."""
    return report.split(f"\n## {tag} (")[1].split("\n## ")[0]


def serve(cwd: str, *roots: str) -> tuple[subprocess.Popen, str]:
    """An HTTP server with the API key, and its URL."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = subprocess.Popen(
        ["node", SERVER, "--port", str(port), *roots],
        cwd=cwd,
        env={**os.environ, "FS_API_KEY": KEY},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return server, f"http://127.0.0.1:{port}"


ws = tempfile.mkdtemp(prefix="todo-report-")
write(
    f"{ws}/src/a.ts",
    "const a = 1; // TODO: rename a\n/* FIXME handle errors */\nconst todoList = [];\n",
)
write(f"{ws}/src/b.py", "# HACK(me): temporary\nx = 1  # TODO: c  # FIXME: d\n")
# Later markers on a line count; a tag in prose ("this HACK") does not.
write(
    f"{ws}/src/c.ts",
    "// FIXME: a  TODO: b\n// TODO: remove this HACK once upstream ships\n"
    "/* XXX: one */ bar(); // TODO: two\n",
)
write(f"{ws}/big.txt", "".join(f"TODO item {n}\n" for n in range(1200)))  # more than one page
write(f"{ws}/node_modules/dep/index.js", "// TODO in a dependency\n")  # ignored by default
write(f"{ws}/.env", "TODO=secret\n")  # a secret file: never read

for era in ([], ["--legacy"]):
    code, out, err = run(ws, *era)
    assert code == 0, err
    assert f"{ws}: 3 FIXME, 1 HACK, 1 XXX, 1205 TODO in 4 files." in out, out
    assert "## TODO (1205)" in out, out  # both pages of big.txt, plus src/
    fixme, xxx, todo = section(out, "FIXME"), section(out, "XXX"), section(out, "TODO")
    assert "`src/a.ts:2` handle errors\n" in fixme, out
    assert "`src/b.py:1` temporary (me)\n" in section(out, "HACK"), out
    assert "`src/b.py:2` d\n" in fixme and "`src/b.py:2` c\n" in todo, out
    assert "`src/c.ts:1` a\n" in fixme and "`src/c.ts:1` b\n" in todo, out
    assert "`src/c.ts:2` remove this HACK once upstream ships\n" in todo, out
    assert "`src/c.ts:3` one\n" in xxx and "`src/c.ts:3` two\n" in todo, out
    assert "dependency" not in out and ".env" not in out and "todoList" not in out, out

# --out writes into the workspace; replacing it is the server's question.
code, _, err = run(ws, "--out", "TODO.md")
assert code == 0, err
assert open(f"{ws}/TODO.md").read().startswith("# TODO report")
write(f"{ws}/TODO.md", "old\n")
code, _, err = run(ws, "--out", "TODO.md")  # closed stdin declines
assert code == 1 and "declined" in err, err
assert open(f"{ws}/TODO.md").read() == "old\n"
code, _, err = run(ws, "--out", "TODO.md", stdin="2\n")  # skip: no error, but nothing written
assert code == 1 and "kept the existing" in err and "wrote" not in err, err
assert open(f"{ws}/TODO.md").read() == "old\n"
code, _, err = run(ws, "--out", "TODO.md", stdin="1\n")
assert code == 0 and "Overwrite it?" in err, err
report = open(f"{ws}/TODO.md").read()
assert report.startswith("# TODO report") and "## TODO (1205)" in report, report[
    :200
]  # not counting itself
os.remove(f"{ws}/TODO.md")

# HTTP, with and without the API key, and with one, two, and no roots. The
# servers run outside their roots, so a relative path must not resolve against
# their cwd.
elsewhere = tempfile.mkdtemp(prefix="todo-report-cwd-")
other = tempfile.mkdtemp(prefix="todo-report-other-")
servers = [serve(elsewhere, ws), serve(elsewhere, ws, other), serve(elsewhere)]
try:
    for _, url in servers:
        for _ in range(100):
            try:
                urllib.request.urlopen(f"{url}/healthz", timeout=1)
                break
            except OSError:
                time.sleep(0.1)
    one, two, none = (f"{url}/mcp" for _, url in servers)
    auth = {"FS_API_KEY": KEY}
    code, out, _ = run("--url", one, env={"FS_API_KEY": ""})
    assert code != 0, out
    code, out, err = run("--url", one, env=auth)
    assert code == 0 and "## TODO (1205)" in out, err
    # Relative paths are the root's: --out lands in it, and dir is inside it.
    code, _, err = run("--url", one, "--out", "TODO.md", env=auth)
    assert code == 0 and open(f"{ws}/TODO.md").read().startswith("# TODO report"), err
    code, _, err = run("--url", one, "--out", "TODO.md", stdin="1\n", env=auth)
    assert code == 0 and "## TODO (1205)" in open(f"{ws}/TODO.md").read(), err  # not itself
    os.remove(f"{ws}/TODO.md")
    src = os.path.join(ws, "src")
    code, out, err = run("--url", one, "src", env=auth)
    assert code == 0 and fold(f"{src}: 3 FIXME, 1 HACK, 1 XXX, 5 TODO in 3 files.") in fold(out), (
        err
    )
    # A report on a subfolder names files from the root, so each reads back as given.
    assert "`src/a.ts:2` handle errors\n" in section(out, "FIXME"), out
    assert not os.listdir(elsewhere), os.listdir(elsewhere)
    # With two roots or none there is no default, so dir must be absolute.
    for url, says in (
        (two, f"2 roots, so pass an absolute dir: {ws}, {other}"),
        (none, "no roots, so pass an absolute dir"),
    ):
        code, _, err = run("--url", url, env=auth)
        assert code == 1 and fold(says) in fold(err) and "Traceback" not in err, err
    code, out, err = run("--url", two, src, env=auth)
    assert code == 0 and f"{src}: 3 FIXME, 1 HACK, 1 XXX, 5 TODO in 3 files." in out, err
finally:
    for server, _ in servers:
        server.terminate()

print("check: ok")
