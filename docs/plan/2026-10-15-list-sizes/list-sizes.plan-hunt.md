Status: dead steps

# Plan hunt: `list` gains opt-in sizes, sort-by-size, and a totals line (#99)

Hunted [`list-sizes.plan.md`](list-sizes.plan.md) at `8fffa76e`, 2026-10-15.

## Confirmed

- **Step 2 + STOP + Current state (Surface budget bullet), unbounded/dead-end**: the two new input properties cannot pass `TOOL-SURFACE-002` under any string shortening, and the plan forbids the one fix that works. Measured at `8fffa76e` by the refuter (reproducing the test's own method, `JSON.stringify(tools).length` via `createTestClientPair`): full 18 909 / 19 000 chars, read-only 9 047 / 9 150, so headroom 91 and 103. The plan's primary strings add +310 chars (19 219 full / 9 357 read-only, both over); its pre-authorized fallback strings add +228 (19 137 / 9 275, both over); the two properties with empty descriptions alone cost +151 (67 for `includeSizes`, 84 for `sortBy`), already over the read-only headroom. The plan's STOP says "report rather than widening the budget" ([`tools.test.ts:3916-3917`](../../../__tests__/tools.test.ts#L3916-L3917) holds the constants; no step touches them), so a cold executor dead-ends. The Current state bullet "headroom is a few hundred chars" is stale (2026-10-02 baseline; the repo has since grown to 18 909/9 047). Evidence: refuter's independent measurement and simulation against the rendered shapes the snapshot pins (`defaultFalseBoolean` per [`contract.test.ts.snapshot:312-316`](../../../__tests__/contract.test.ts.snapshot#L312-L316), enum per `:750-758`).
- **Step 1 Verify, command that mispredicts its expected output**: "→ **5 fail, 0 pass**" is not what the runner prints. Observed at HEAD: the exact command with a matching-nothing pattern prints `tests 44 / pass 44 / fail 0`, exit 0, so every test file counts as one passing unit even when none of its tests match. A Node v24.15.0 simulation of step 1's post-state (five failing `(#99)` tests in one describe, one untouched file) prints `tests 6 / suites 1 / pass 1 / fail 5`, exit 1; scaled to the repo, step 1's summary will read `pass 43`, `fail 5`, exit 1. Only `fail 5` and the exit code hold; "0 pass" never appears, and a cold executor confirming the stated expectation before moving on can misjudge the gate.

## Suspected

none

## Coverage

- Steps 1-4 each checked against every tell; every cited path resolved (`git ls-files`/direct reads) and every cited `file:line` opened this session: all `src/tools/list.ts` cites, `schema.ts:135-137`, `fmt.ts:54-56`/`106-140`, `find-files.ts:34-38`, `read.ts:224-231`, `fs.ts:197-204`, `errors.ts:203`, `path.ts:305-317`, `define.ts:202-213`/`485-491`, `tools.test.ts:378-414`/`2124-2154`/`2185`/`2273-2360`/`3273-3360`/`3915-3927`, `contract.test.ts:8-13`, snapshot `:286-334`/`:936-984`, `client-guide.md:239-241`/`:313`.
- Commands run once: the Drift check's paths verified to exist; `npm test -- --test-name-pattern="#99"` run (baseline and never-matching pattern, plus a scratch failing-test probe for counter semantics); `npm test -- --test-name-pattern="#56"` run (counter semantics); `package.json` scripts verified (`test`, `check`, `check:static`); no `FS_*` env vars set.
- Not run: `node --test --test-update-snapshots __tests__/contract.test.ts` — it rewrites a tracked file; its runnability is established by the flag's documentation in [`contract.test.ts:10-12`](../../../__tests__/contract.test.ts#L10-L12) and AGENTS.md, and it is gated in plan step 3.
- Five candidates dispatched to five blind refuters (general-purpose), all returned valid verdicts; no in-thread fallback. Killed: the `pageTrailer({ /* unchanged */ })` placeholder (trailer args pinned by `TC-FUNC-063c`/`TC-FUNC-075` inside step 2's Verify pattern and the full-suite Done gate), the invalid-cursor expectation in test 5 ([`store.ts:336-340`](../../../src/core/store.ts#L336-L340) throws on key mismatch, `/Invalid cursor/` pinned by the green test at `tools.test.ts:3273-3344`), and the `formatByteSize` arithmetic (all five asserted strings reproduced byte-for-byte in node).

## Re-hunt, 2026-10-15 (after revision)

Status: clean

Both Confirmed findings were revised into the plan, then re-hunted.

- **Revisions**: step 2 now raises `BUDGET_CHARS` 19 000 → 19 600 and `BUDGET_CHARS_READ_ONLY` 9 150 → 9 550 with a recorded-reason comment line (the ~2%-above-measurement convention), the STOP no longer forbids the raise, and the stale Current-state headroom claim was replaced with the measured 18 909 / 9 047 and the +310 / +151 arithmetic. Step 1's Verify was rewritten around the observed runner counts, and test 3 is labeled a characterization pin.
- **Pass 2 refuters (2 dispatched, 2 valid verdicts)**: the revised budget step was **killed** (live measurement reproduced the plan's numbers digit-for-digit: 18 909/9 047 at HEAD, +310 → 19 219/9 357 post-change; raised ceilings sit 1.98%/2.06% above measurement; comment style matches the 2026-10-06 entry at `tools.test.ts:3912-3914`; the 13-tool assert is untouched). The revised step-1 Verify was **confirmed**, but for a reason the original finding missed: test 3 is green from birth, so step 1's real summary is `fail 4`, `pass 44`, exit 1, not `fail 5`. Evidence: a spliced scratch copy of `8fffa76e` with the five tests added after `TC-FUNC-075b` printed `tests 48 / suites 1 / pass 44 / fail 4`, exit 1, with `list default output carries no sizes and no totals line (#99)` passing.
- **Revision 2**: step 1's Verify and the Commands row now predict exit 1 with `fail 4` and `pass 44`, and test 3's spec says it is a characterization pin, green at step 1 on purpose.
- **Pass 3 refuter (1 dispatched, 1 valid verdict)**: the re-revised step-1 gate was **killed** by full empirical reproduction on a scratch copy: exit 1, `tests 48 / suites 1 / pass 44 / fail 4`, the four red tests named with the exact schema-rejection text (`Unrecognized key: "includeSizes"`), test 3 passing in 21 ms, and the pass count decomposing exactly (43 untouched file units + green test 3).
- No Confirmed finding outstanding. The plan routes to run-plan.