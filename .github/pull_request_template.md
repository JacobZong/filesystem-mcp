## Summary

<!--
One sentence naming the behavior a user gets. Name no file, function or count.
Give the PR title the same shape. Add one line for each unrelated change on the
branch.

Leave code out of the prose: identifiers, string literals, flags and numbers
from the code. The reviewer has the diff.
-->

## Why

<!-- The problem before this change, or what it unblocks, in one to three lines. -->

## Shape of the change

<!--
Add a visual for each structural change the file list hides: a new call path,
a moved module boundary, a new tool or resource, a new message between a host
and the server. Use only names that exist in the diff, and only the ones the
point needs.

A `diff` fence of the before shape usually fits best. Keep unchanged lines as
context so order and ownership stay visible:

```diff
 readFile
   readFileWithStats
-    openReadableFileHandle
+    openVerified
```

Use a `mermaid` sequence diagram for messages between parts. GitHub renders
both fences.

Delete this section when nothing moved: a one-file fix, a rename, a dependency
bump.
-->

## Related issue

<!-- Link the issue. Use `Closes #...` only when this PR completes it. Write None otherwise. -->

## Validation

- [ ] `npm run check` passes.
- [ ] Relevant regression tests added or updated, where applicable.

<!--
Tick a box only for a command you ran. Below the list, give each command you
ran and its result, such as the test counts. If you ran nothing, leave the
boxes empty and write one line saying so. Name any check you skipped and why.

Do not include secrets or sensitive filesystem contents in logs.
-->

## Compatibility and documentation

<!--
What a client can now see differently, the stdio, HTTP or platform impact, a
change to the contract snapshot, and documentation updates. Write None when
nothing applies.
-->

## Review focus

<!--
Where a reviewer should look first, and what could break. Name each risk the
new behavior brings, not the test that covers it. Leave out conventions
AGENTS.md already requires.
-->
