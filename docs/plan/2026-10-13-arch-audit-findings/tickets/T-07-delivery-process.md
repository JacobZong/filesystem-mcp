---
kind: frontier-ticket
id: T-07
title: Which delivery process does each batch follow?
map: M-01
status: open
type: grilling
priority: 100
blocked_by: ["T-05"]
claimed:
---

## Question

For each batch of findings 2-15 that T-05 settles, which process
applies?

- Direct edit: a test pin first where behaviour changes, `refactor`
  otherwise, then `bug-hunt` and `qc`.
- Planned: `write-plan`, then `plan-hunt`, then `run-plan`.

The finding 1 security PR's process is a separate ticket.
