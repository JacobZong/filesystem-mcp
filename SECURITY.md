# Security policy

Filesystem MCP gives AI assistants access to files, so security reports come
before other work.

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/j0hanz/filesystem-mcp/security/advisories/new).
Do not open a public issue, and do not include real secrets or private file
contents in the report.

A useful report includes:

- the version (`filesystem-mcp --version`), operating system, and Node.js
  version;
- how the server was started (flags and environment variables, with secrets
  removed), or the output of `--print-config`;
- the tool calls or requests that reproduce the problem;
- what happened, and what you expected.

You will get a reply as soon as possible. Once a fix ships, the maintainer
publishes the advisory and credits you, unless you prefer otherwise.

## Supported versions

Only the latest release receives security fixes. Update with
`npx -y @j0hanz/filesystem-mcp@latest` or by pulling
`ghcr.io/j0hanz/filesystem-mcp:latest`.

## What counts as a vulnerability

The server promises that, with its default settings:

- no tool reads, writes, lists, or searches a path outside the allowed
  folders, including through symlinks, `..`, or Windows path tricks;
- no tool reads or writes a file on the built-in secret-file list, or one
  blocked with `--deny`;
- `--read-only` leaves no tool that changes files;
- deleting a non-empty folder or opening a new folder never happens without
  the user's confirmation, and `create` and `move` only write over an
  existing file after a confirmation (`create` and copies also accept an
  explicit `overwrite: true`; in-place edits with `edit`, `patch`, and
  `replace_text` do not ask, by design);
- over HTTP, the API key, Host, and Origin checks cannot be bypassed;
- no input can crash or hang the server.

A way to break any of these is a vulnerability. Things the operator chose,
such as `--allow-sensitive`, `--allow`, `FS_ALLOW_UNRESTRICTED_HOSTS`, or
allowing a folder that holds secrets, are not.

See the [Security section of the README](README.md#security) and the
[configuration reference](docs/configuration.md) for how these protections
work.
