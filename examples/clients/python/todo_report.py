"""todo_report: the TODO, FIXME, HACK and XXX comments in a workspace, as a
Markdown report grouped by tag. filesystem-mcp does the searching, so
.gitignored files, secret files, and anything outside the workspace are never
read.

usage: python todo_report.py [dir] [--out FILE] [--url URL] [--legacy]
"""

import argparse
import asyncio
import os
import re
import sys
from collections import defaultdict

from mcp import Client, StdioServerParameters, types
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client

TAGS = ["FIXME", "HACK", "XXX", "TODO"]  # report order: most urgent first
# The server runs regexes with RE2: no lookarounds or backreferences.
SEARCH = r"\b(" + "|".join(TAGS) + r")\b"
# TAG, an optional (owner), an optional colon, then the note.
MARKER = re.compile(r"\b(" + "|".join(TAGS) + r")\b(?:\(([^)]*)\))?:?\s*(.*)")


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
    answer = (await asyncio.to_thread(sys.stdin.readline)).strip()
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


async def find_markers(client: Client, path: str | None) -> tuple[list[dict], dict, str | None]:
    """Every match, following nextCursor. search_text keeps its data in _meta
    (result.meta here); its text content is the grep-style view for people."""
    args = {"searchPattern": SEARCH, "isRegex": True, "caseSensitive": True, "maxResults": 1000}
    if path:
        args["path"] = path
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


def render(where: str, matches: list[dict], meta: dict) -> str:
    by_tag: dict[str, list[str]] = defaultdict(list)
    for match in matches:
        found = MARKER.search(match["content"])
        if found:
            tag, owner, note = found.groups()
            note = note.strip().removesuffix("*/").removesuffix("-->").strip()
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
        "dir", nargs="?", help="folder to report on (default: . or the server's root)"
    )
    parser.add_argument("--out", help="write the report to this file inside the workspace")
    parser.add_argument("--url", help="a running server's /mcp URL; FS_API_KEY is the bearer token")
    parser.add_argument("--legacy", action="store_true", help="speak the 2025 protocol")
    args = parser.parse_args()
    if not args.url:
        args.dir = os.path.abspath(args.dir or ".")

    # mode="auto" (the Python SDK's default) negotiates 2026-07-28 and falls
    # back to the 2025 handshake for older servers; "legacy" skips the probe.
    mode = "legacy" if args.legacy else "auto"
    async with Client(transport(args), mode=mode, elicitation_callback=confirm) as client:
        matches, meta, error = await find_markers(client, args.dir)
        if error:
            return error
        out = args.out and (
            args.out if os.path.isabs(args.out) else os.path.join(args.dir or "", args.out)
        )
        if out and args.dir:  # a previous report is not a source of TODOs
            own = os.path.relpath(out, args.dir).replace(os.sep, "/")
            matches = [m for m in matches if m["file"] != own]
        report = render(args.dir or "workspace", matches, meta)
        if not out:
            sys.stdout.write(report)
            return None
        result = await client.call_tool("create", {"files": [{"path": out, "content": report}]})
        failures = (result.structured_content or {}).get(
            "failures", []
        )  # create uses structuredContent
        if result.is_error or failures:
            return failures[0]["error"]["message"] if failures else text(result)
        print(f"wrote {out}", file=sys.stderr)
        return None


if __name__ == "__main__":
    error = asyncio.run(main())
    if error:
        sys.exit(f"todo_report: {error}")
