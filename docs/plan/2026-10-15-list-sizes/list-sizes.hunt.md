## Hunt 2026-10-15 - uncommitted changes in the working tree (3 files, 5008 lines to read)

Verdict: No findings.

### Confirmed
None.

### Suspected
None.

### Questions
None.

### Dismissed
- [`__tests__/tools.test.ts:379`](../../../__tests__/tools.test.ts#L379) - SECRET tell (`const token = '<redacted>'`). tell: test fixture sentinel string (`example-sentinel-9f3c1e`) verifying sensitive-file filtering, not a real credential.
- [`__tests__/tools.test.ts:4187`](../../../__tests__/tools.test.ts#L4187) - MARKER tell (`oldText: 'AAA', newText: 'XXX'`). tell: test fixture strings for concurrent/aliased edit verification, not a left-over TODO/XXX marker.
- [`__tests__/tools.test.ts:4194`](../../../__tests__/tools.test.ts#L4194) - MARKER tell (`after.includes('XXX')`). tell: assertion matching the test fixture replacement text from line 4187.
- [`src/core/fmt.ts:62`](../../../src/core/fmt.ts#L62) - `formatByteSize` boundary rounding at `1023.95 KiB` (`1048525` bytes) producing `1024 KiB`. tell: `value >= 10` uses `Math.round(value)` by design per the plan specification; unit promotion occurs at `value >= 1024`, which is consistent and bounded across `SIZE_UNITS`.

### Coverage
- Read fully: `src/tools/list.ts`, `src/core/fmt.ts`, `__tests__/tools.test.ts`
- Blast radius pulled in: `src/core/fs.ts`, `src/core/cursor.ts`, `src/instructions.ts`, `src/tools/index.ts`
- Not audited, and why: `__tests__/contract.test.ts.snapshot`, `docs/client-guide.md`, `docs/plan/2026-10-15-list-sizes/*` (non-code / generated snapshot / docs skipped by brief, inspected during plan verification)
- Taken on trust: Node.js `fs.stat` and `zod` schema parsing
