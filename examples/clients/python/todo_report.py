"""todo_report: the TODO, FIXME, HACK and XXX comments in a workspace, as a
Markdown report grouped by tag. filesystem-mcp does the searching, so
.gitignored files, secret files, and anything outside the workspace are never
read.

usage: python todo_report.py [dir] [--out FILE] [--url URL] [--legacy]
"""

import argparse
import asyncio
import ntpath
import os
import posixpath
import re
import sys
from collections import defaultdict

from mcp import Client, StdioServerParameters, types
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client

TAGS = ["FIXME", "HACK", "XXX", "TODO"]  # report order: most urgent first
# The server runs regexes with RE2: no lookarounds or backreferences.
SEARCH = r"\b(" + "|".join(TAGS) + r")\b"
# search_text returns one row per line, and a line can hold several markers.
# A later tag starts a new note only when written as a marker (TAG: or
# TAG(owner)), so prose such as "drop this HACK" stays in the note. An owner
# stops at any parenthesis, or a long "TODO(TODO(..." line would be rescanned
# to its end at every tag.
LATER = r"(?:(?://|#|/\*|<!--|--|;)\s*)?\b(?:" + "|".join(TAGS) + r")\b(?:\([^()]*\)|:)"
# TAG, an optional (owner), an optional colon, then the note: up to the next
# marker and its comment opener (Python's re can look ahead), or the line's end.
MARKER = re.compile(SEARCH + r"(?:\(([^()]*)\))?:?\s*(.*?)(?=" + LATER + r"|$)")


def transport(args: argparse.Namespace):
    """A running server over HTTP, or one started over stdio."""
    if args.url:
        key = os.environ.get("FS_API_KEY")
        headers = {"Authorization": f"Bearer {key}"} if key else None
        return streamable_http_client(args.url, http_client=create_mcp_http_client(headers=headers))
    bin_path = os.environ.get("FS_MCP_BIN")
    # Read-only unless the report is written into the workspace.
    server_args = ([] if args.out else ["--read-only"]) + [args.dir]
    params = StdioServerParameters(
        command="node" if bin_path else "npx",
        args=[bin_path, *server_args]
        if bin_path
        else ["-y", "@j0hanz/filesystem-mcp", *server_args],
        cwd=args.dir,  # relative paths in tool calls resolve against the server's cwd
    )
    return stdio_client(params, errlog=open(os.devnull, "w"))  # keep its banner out of the report


async def confirm(_context, params: types.ElicitRequestParams) -> types.ElicitResult:
    """The server asks before --out replaces an existing file. Its forms have one
    field: a boolean, an enum, or an array of enum values. Answered on stdin;
    closed stdin declines."""
    fields = list(getattr(params, "requested_schema", {}).get("properties", {}).items())
    if len(fields) != 1:
        return types.ElicitResult(action="decline")
    key, field = fields[0]
    options = field.get("enum") or field.get("items", {}).get("enum") or []
    print(f"? {params.message}", file=sys.stderr)
    for n, option in enumerate(options, 1):
        print(f"  {n}) {option}", file=sys.stderr)
    print(
        "y/N: " if field.get("type") == "boolean" else "number: ",
        end="",
        file=sys.stderr,
        flush=True,
    )
    # With fd 0 closed at startup there is no sys.stdin at all.
    answer = (await asyncio.to_thread(sys.stdin.readline)).strip() if sys.stdin else ""
    if field.get("type") == "boolean":
        accepted = answer.lower() == "y"
        return (
            types.ElicitResult(action="accept", content={key: True})
            if accepted
            else types.ElicitResult(action="decline")
        )
    picked = [
        options[int(n) - 1]
        for n in answer.split(",")
        if n.strip().isdigit() and 0 < int(n) <= len(options)
    ]
    if not picked:
        return types.ElicitResult(action="decline")
    return types.ElicitResult(
        action="accept", content={key: picked if field.get("type") == "array" else picked[0]}
    )


def text(result: types.CallToolResult) -> str:
    return "\n".join(block.text for block in result.content if isinstance(block, types.TextContent))


async def find_markers(client: Client, path: str) -> tuple[list[dict], dict, str | None]:
    """Every match, following nextCursor. search_text keeps its data in _meta
    (result.meta here); its text content is the grep-style view for people."""
    args = {
        "path": path,
        "searchPattern": SEARCH,
        "isRegex": True,
        "caseSensitive": True,
        "maxResults": 1000,
    }
    matches: list[dict] = []
    first: dict = {}
    while True:
        result = await client.call_tool("search_text", args)
        if result.is_error:
            return [], {}, text(result)
        meta = result.meta or {}
        first = first or meta
        matches += meta.get("matches", [])
        if not meta.get("nextCursor"):
            return matches, first, None
        args = {**args, "cursor": meta["nextCursor"]}  # same arguments plus the cursor


def os_path(path: str):
    """os.path for a server path; over HTTP the server may run on another OS."""
    return posixpath if path.startswith("/") else ntpath


async def only_root(client: Client) -> tuple[str | None, str | None]:
    """The server's root, or an error when it has none or several."""
    result = await client.call_tool("list_roots", {})
    if result.is_error:
        return None, text(result)
    # list_roots keeps its data in structuredContent; none is [] plus a hint.
    roots = (result.structured_content or {}).get("roots") or []
    if len(roots) == 1:
        return roots[0], None
    if not roots:
        return None, "the server has no roots, so pass an absolute dir"
    return None, f"the server has {len(roots)} roots, so pass an absolute dir: {', '.join(roots)}"


def render(where: str, matches: list[dict], meta: dict) -> str:
    by_tag: dict[str, list[str]] = defaultdict(list)
    for match in matches:
        for found in MARKER.finditer(match["content"]):
            tag, owner, note = found.groups()
            note = note.split("*/")[0].split("-->")[0].strip()  # a block comment ends here
            entry = f"- `{match['file']}:{match['line']}` {note}" + (f" ({owner})" if owner else "")
            by_tag[tag].append(entry.rstrip())
    files = len({m["file"] for m in matches})
    counts = ", ".join(f"{len(by_tag[t])} {t}" for t in TAGS if by_tag[t]) or "nothing"
    lines = ["# TODO report", "", f"{where}: {counts} in {files} file{'s' * (files != 1)}."]
    if meta.get("stoppedReason"):  # maxResults or timeout: the totals are a floor
        lines.append("\n> The search stopped early; narrow the folder for a complete report.")
    for tag in TAGS:
        if by_tag[tag]:
            lines += ["", f"## {tag} ({len(by_tag[tag])})", "", *by_tag[tag]]
    return "\n".join(lines) + "\n"


async def main() -> str | None:
    """Returns an error message, or None. Exiting inside `async with Client`
    would surface as an exception group from the SDK's task groups."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "dir",
        nargs="?",
        help="folder to report on (default: ., or the server's only root with --url)",
    )
    parser.add_argument("--out", help="write the report to this file (relative to dir)")
    parser.add_argument("--url", help="a running server's /mcp URL; FS_API_KEY is the bearer token")
    parser.add_argument("--legacy", action="store_true", help="speak the 2025 protocol")
    args = parser.parse_args()
    if not args.url:
        args.dir = os.path.abspath(args.dir or ".")

    # mode="auto" (the Python SDK's default) negotiates 2026-07-28 and falls
    # back to the 2025 handshake for older servers; "legacy" skips the probe.
    mode = "legacy" if args.legacy else "auto"
    async with Client(transport(args), mode=mode, elicitation_callback=confirm) as client:
        # The server resolves a relative path against its cwd while that is in
        # a root, which a client over HTTP cannot know, so the script anchors
        # dir (and with it --out) to the root.
        if args.url and not (args.dir and os_path(args.dir).isabs(args.dir)):
            root, error = await only_root(client)
            if root is None:
                return error
            osp = os_path(root)
            args.dir = osp.normpath(osp.join(root, args.dir or "."))  # abspath, on the server
        matches, meta, error = await find_markers(client, args.dir)
        if error:
            return error
        osp = os_path(args.dir)
        # An absolute --out replaces dir. Normalized, because the server refuses
        # a path that still contains "..".
        out = args.out and osp.normpath(osp.join(args.dir, args.out))
        if out:  # a previous report is not a source of TODOs
            # Match paths are relative to meta["root"], or absolute, which
            # join keeps as it is.
            base = meta.get("root", args.dir)
            matches = [m for m in matches if osp.normpath(osp.join(base, m["file"])) != out]
        report = render(args.dir, matches, meta)
        if not out:
            sys.stdout.write(report)
            return None
        result = await client.call_tool("create", {"files": [{"path": out, "content": report}]})
        data = result.structured_content or {}  # create uses structuredContent
        failures = data.get("failures", [])
        if result.is_error or failures:
            return failures[0]["error"]["message"] if failures else text(result)
        # Answering "skip" is a success with the path in skipped, yet nothing was
        # written, so exit 1 as a decline does.
        if data.get("skipped"):
            return f"kept the existing {out}; nothing written"
        print(f"wrote {out}", file=sys.stderr)
        return None


if __name__ == "__main__":
    error = asyncio.run(main())
    if error:
        sys.exit(f"todo_report: {error}")
