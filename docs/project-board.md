# Project board

How the **Filesystem MCP** GitHub Project is set up and used. Contributors do
not need this page: open an issue or a pull request, and a maintainer handles
the board. Hosted setup is tracked in
[issue #57](https://github.com/j0hanz/filesystem-mcp/issues/57).

The project uses issues as work items and linked PRs as implementation. Do not
add both an issue and its PR as separate cards. Repository templates do not
create the hosted Project; a maintainer must complete the setup below before
the board is available.

## Maintainer setup

1. Create a GitHub Project named **Filesystem MCP** under the repository owner's
   account and link it from the repository's **Projects** tab. Check for an
   existing project first to avoid duplicates.
2. Configure the **Status** field with these five values:

   | Status      | Meaning                               |
   | ----------- | ------------------------------------- |
   | Backlog     | New reports and ideas awaiting triage |
   | Ready       | Accepted, clear scope, ready to start |
   | In progress | Someone is actively working on it     |
   | In review   | Implementation is ready for review    |
   | Done        | Accepted work completed               |

3. Add a single-select **Priority** field: **High**, **Normal**, **Low**.
   Assign priority during triage; use Normal unless urgency or impact warrants
   otherwise.
4. Create a **Board** view grouped by Status. Show only title, assignee, and
   priority on cards. Create a **Triage** table filtered to `status:Backlog`.
   Scope both views to this repository's issues and exclude `duplicate`,
   `invalid`, and `wontfix` labels.
5. Where available, enable the built-in auto-add workflow for
   `repo:j0hanz/filesystem-mcp is:issue is:open -label:duplicate -label:invalid -label:wontfix`.
   Set newly added items to Backlog with the item-added workflow. If auto-add is
   unavailable for the account, add eligible issues manually during triage.
6. Enable the issue-closed workflow to move completed issues to Done. If the
   workflow also handles issues closed as not planned, remove those items from
   the project rather than treating them as completed work. Keep review
   transitions manual.
7. Add only genuinely unfinished issues after checking linked PRs and existing
   plans. Do not bulk-import completed plans or unrelated promotional issues.

Use **bug**, **enhancement**, **maintenance**, and **documentation** to describe
work, plus **blocked** when needed. Keep existing housekeeping labels for
duplicates and rejected reports; do not create labels that duplicate Status.

## Daily workflow

- Triage Backlog: confirm relevance, check for duplicates, assign priority, and
  clarify scope and acceptance criteria before moving an issue to Ready.
- Assign an owner when work starts. Aim for one or two In progress items per
  person.
- For blocked work, add **blocked**, link the dependency, and explain what is
  needed to proceed. Keep its current status; remove the label when unblocked.
- Link the implementation PR to the issue and move the issue to In review when
  ready. A PR that completes the issue should use a closing keyword.
- Move accepted, completed work to Done. Close duplicates or rejected requests
  with the appropriate reason and label, and remove them from the project.
- Keep detailed design and investigation in existing planning documents, linked
  from issues. Use the board as the active task tracker, not a second copy of
  historical plan status tables.
