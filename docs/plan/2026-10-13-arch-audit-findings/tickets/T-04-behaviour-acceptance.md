---
kind: frontier-ticket
id: T-04
title: Are the visible behavior changes acceptable?
map: M-01
status: closed
type: grilling
priority: 100
blocked_by: ["T-02"]
claimed:
---

## Question

Which of these visible changes does the user accept, and in what form?
Facts are in T-02's resolution.

- 3: `resourceUri: undefined` kept as a key in edit and patch results.
  Nothing breaks; JSON drops the key.
- 8: `edit`'s custom `oldText required` message: keep it through a helper
  parameter, or take the shared wording.
- 10: stdio passes `cacheScope: 'public'` always (modern stdio clients
  with `FS_API_KEY` set see `private` become `public`), or stdio keeps
  deriving it from the key (no visible change).
- 12: completion stops listing the children of sensitive-named
  directories, and one debug log goes. The guard call is wrapped so a
  refusal returns false.
- 13: ADR-002 corrected in place, or by an amendment line.
- 15: a missing seeded root spelled through a symlinked boundary goes
  from refused to granted. The empty-boundary early return stays, and a
  pin test lands first.

## Resolution

Confirmed with the user, 2026-10-13 ("all recommended"):

- 3: accepted. edit and patch results carry `resourceUri: undefined` as a
  key, as `create` already does.
- 8: edit takes the shared wording. Empty and whitespace-only `oldText`
  both read "oldText cannot be empty or whitespace-only";
  `nonBlankString(label)` takes no message option.
- 10: stdio always reports `cacheScope: 'public'`. The HTTP host derives
  `private` or `public` from its API key, and `createServer` no longer
  receives the key.
- 12: accepted. Completion stops listing the children of sensitive-named
  directories and drops one debug log. The guard call is wrapped so a
  refusal returns false and root suggestions stay.
- 13: ADR-002 gets an "Amended 2026-10-13" line replacing "six test
  files" with the grep command, following ADR-001's amendment style.
- 15: accepted. A missing seeded root spelled through a symlinked
  boundary is granted. The empty-boundary early return stays, and a
  pin test lands before the move.
