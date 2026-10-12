import type { InputRequiredResult } from '@modelcontextprotocol/server';
import { isInputRequiredResult } from '@modelcontextprotocol/server';

import { basename } from 'node:path';

import * as z from 'zod/v4';

import { processInParallel } from '../core/concurrency.ts';
import {
  ErrorCode,
  FsError,
  isFsError,
  isNodeError,
  isNotFoundErrno,
  Problem,
} from '../core/errors.ts';
import { joinRoster, pathLabel } from '../core/fmt.ts';
import type { FileType, GuardedFileSystem } from '../core/fs.ts';
import {
  confirmKey,
  describeRefusal,
  pendingRoundTrip,
  type PendingState,
  readAcceptedChoice,
} from '../core/input-required.ts';
import { resolveEntryType } from '../core/path-utils.ts';
import { defaultFalseBoolean, RequiredPath } from '../core/schema.ts';
import { PARALLEL_CONCURRENCY } from '../core/util.ts';
import { type BatchResult, isTotalFailure, type PerPathResult, summarize } from './batch.ts';
import type { ToolCtx } from './define.ts';
import { defineTool } from './define.ts';

const DeleteInputSchema = z.strictObject({
  paths: z
    .array(RequiredPath)
    .min(1)
    .max(1000)
    .describe('Paths to delete (max 1000); accepts files, directories, or symlinks'),
  recursive: defaultFalseBoolean(
    'Delete directory contents recursively (required for non-empty directories)',
  ),
  ignoreIfNotExists: defaultFalseBoolean(
    'Silently succeed if a path does not exist instead of returning an error',
  ),
});

type DeleteInput = z.infer<typeof DeleteInputSchema>;
type DeleteOutput = BatchResult<{ deleted: boolean }>;
type DeletePerPathResult = PerPathResult<{ deleted: boolean }>;

// Internal types for error handling
interface DeleteFailure {
  path: string;
  error: Problem;
}

const ERR_NOT_EMPTY = new Error('Directory not empty. Set recursive: true.');

function toDeleteFailure(path: string, error: unknown): DeleteFailure {
  // A missing path reached here as the raw errno text ("ENOENT: no such file or
  // directory, lstat 'c:\...'"), while `stat` reported the same condition as
  // "Path not found". One condition, one message — and the syscall name stays
  // off the wire.
  if (isNotFoundErrno(error)) {
    return {
      path,
      error: Problem.fromUnknown(
        new FsError(ErrorCode.NOT_FOUND, 'Path not found', path),
        ErrorCode.NOT_FOUND,
        path,
      ),
    };
  }
  if (
    isNodeError(error) &&
    (error.code === 'ENOTEMPTY' || error.code === 'EISDIR' || error.code === 'EEXIST')
  ) {
    return {
      path,
      error: Problem.fromUnknown(ERR_NOT_EMPTY, ErrorCode.INVALID_INPUT, path),
    };
  }
  return { path, error: Problem.fromUnknown(error, ErrorCode.UNKNOWN, path) };
}

type LstatResult = Awaited<ReturnType<GuardedFileSystem['lstat']>>;

/** A path's pre-checked plan: validated, statted, and flagged if it needs confirmation. */
interface DeletePlan {
  inputPath: string;
  validPath: string;
  itemType: FileType;
  firstStats: LstatResult;
  /** Recursive + non-empty directory: needs a round-trip confirmation. */
  pending: boolean;
}

type PlanResult =
  | { status: 'fail'; failure: DeleteFailure }
  | { status: 'noop'; deleted: string }
  | { status: 'plan'; plan: DeletePlan };

/**
 * Phase 1 (no mutation): validate, stat, and decide whether a path needs a
 * confirmation before anything is deleted. A pending path is a recursive
 * non-empty directory; everything else is ready to delete directly.
 */
async function planPath(
  inputPath: string,
  args: Pick<DeleteInput, 'recursive' | 'ignoreIfNotExists'>,
  fs: Pick<GuardedFileSystem, 'pathGuard' | 'lstat' | 'hasChildrenUnchecked'>,
): Promise<PlanResult> {
  let validPath: string;
  try {
    validPath = await fs.pathGuard.validatePathForDelete(inputPath);
  } catch (error) {
    if (
      args.ignoreIfNotExists &&
      ((isFsError(error) && error.code === ErrorCode.NOT_FOUND) || isNotFoundErrno(error))
    ) {
      return { status: 'noop', deleted: inputPath };
    }
    return { status: 'fail', failure: toDeleteFailure(inputPath, error) };
  }

  if (fs.pathGuard.isAllowedRoot(validPath)) {
    return {
      status: 'fail',
      // Keyed by the REQUESTED path, like every other failure here: handleDelete
      // orders results by input path, and a resolved key would not be found for
      // a relative request.
      failure: {
        path: inputPath,
        error: Problem.accessDenied('Deleting a workspace root directory is not allowed', {
          path: validPath,
        }),
      },
    };
  }

  let firstStats: LstatResult;
  try {
    firstStats = await fs.lstat(validPath);
  } catch (error) {
    if (isNotFoundErrno(error) && args.ignoreIfNotExists) {
      return { status: 'noop', deleted: inputPath };
    }
    return { status: 'fail', failure: toDeleteFailure(inputPath, error) };
  }

  const itemType = resolveEntryType(firstStats.stats);
  let hasChildren = false;
  if (args.recursive && itemType === 'directory') {
    try {
      hasChildren = await fs.hasChildrenUnchecked(validPath);
    } catch (error) {
      return { status: 'fail', failure: toDeleteFailure(inputPath, error) };
    }
  }
  const pending = hasChildren;
  return { status: 'plan', plan: { inputPath, validPath, itemType, firstStats, pending } };
}

/**
 * True when a confirmed path is gone from disk. Asked of the confirmed path
 * itself rather than matched against the request: a vanished entry validates
 * to its lexical path, which can differ from the realpath round 1 minted
 * (symlinked parents, Windows 8.3 short names).
 */
async function isGone(path: string, fs: Pick<GuardedFileSystem, 'lstat'>): Promise<boolean> {
  try {
    await fs.lstat(path);
    return false;
  } catch (error) {
    return (isFsError(error) && error.code === ErrorCode.NOT_FOUND) || isNotFoundErrno(error);
  }
}

function typeChangedFailure(path: string, from: FileType, to: FileType): DeleteFailure {
  return {
    path,
    error: Problem.invalidInput(
      `Delete failed: item type changed from ${from} to ${to} during confirmation.`,
      { path },
    ),
  };
}

async function performDeletion(
  validPath: string,
  args: Pick<DeleteInput, 'recursive' | 'ignoreIfNotExists'>,
  isDirectory: boolean,
  fsOps: Pick<GuardedFileSystem, 'rm' | 'rmdir'>,
): Promise<void> {
  if (isDirectory && !args.recursive) {
    await fsOps.rmdir(validPath);
  } else {
    await fsOps.rm(validPath, {
      recursive: args.recursive,
      force: args.ignoreIfNotExists,
    });
  }
}

/**
 * Phase 2 (mutation): TOCTOU re-stat against the plan's first stat, then
 * delete. A type or identity change across the confirmation gap fails closed
 * rather than deleting a replacement object the user never confirmed.
 */
async function finalizeDeletion(
  plan: DeletePlan,
  args: Pick<DeleteInput, 'recursive' | 'ignoreIfNotExists'>,
  ctx: Pick<ToolCtx, 'fs' | 'log'>,
): Promise<{ deleted: string } | { failure: DeleteFailure }> {
  let currentStats: LstatResult;
  try {
    currentStats = await ctx.fs.lstat(plan.validPath);
  } catch (error) {
    if (isNotFoundErrno(error) && args.ignoreIfNotExists) {
      return { deleted: plan.validPath };
    }
    return { failure: toDeleteFailure(plan.inputPath, error) };
  }

  const currentItemType = resolveEntryType(currentStats.stats);
  // Identity comparison, not just the coarse category: a swap during the
  // confirmation gap (delete original, create a same-named replacement) keeps
  // the type but changes dev/ino/birthtimeMs. birthtimeMs is the primary
  // cross-platform signal — dev/ino can read 0 on some non-POSIX drivers — so
  // combine all three rather than trusting dev/ino alone.
  const identityChanged =
    plan.firstStats.stats.dev !== currentStats.stats.dev ||
    plan.firstStats.stats.ino !== currentStats.stats.ino ||
    plan.firstStats.stats.birthtimeMs !== currentStats.stats.birthtimeMs;
  if (plan.itemType !== 'other' && (currentItemType !== plan.itemType || identityChanged)) {
    return { failure: typeChangedFailure(plan.validPath, plan.itemType, currentItemType) };
  }

  try {
    await performDeletion(plan.validPath, args, currentStats.stats.isDirectory(), ctx.fs);
  } catch (error) {
    return { failure: toDeleteFailure(plan.inputPath, error) };
  }

  ctx.log('info', `rm: ${plan.inputPath}`, 'delete');
  return { deleted: plan.validPath };
}

/**
 * Execute one planned path on the retry round. A pending path deletes only on
 * an accepted `confirm: true`; decline, cancel, or a missing key report
 * `CANCELLED` for that path (R3 proceed, R4/R5 cancelled). A non-pending path
 * deletes directly (R14: non-pending items proceed alongside accepted ones).
 * `roundPaths` is the list the verified state binds; the confirmation keys
 * index it.
 */
async function executePlan(
  plan: DeletePlan,
  args: Pick<DeleteInput, 'recursive' | 'ignoreIfNotExists'>,
  ctx: Pick<ToolCtx, 'fs' | 'inputResponses' | 'droppedInputResponseKeys' | 'log'>,
  roundPaths: readonly string[],
): Promise<{ deleted: string } | { failure: DeleteFailure } | { skipped: true; path: string }> {
  if (plan.pending) {
    const key = confirmKey(roundPaths.indexOf(plan.validPath));
    const choice = readAcceptedChoice(ctx.inputResponses, key);
    if (choice === 'skip') {
      return { skipped: true as const, path: plan.validPath };
    }
    if (choice !== 'delete') {
      return {
        failure: {
          path: plan.validPath,
          error: Problem.cancelled(
            `Delete cancelled: confirmation was ${describeRefusal(ctx, key)}`,
            { path: plan.validPath },
          ),
        },
      };
    }
  }
  return finalizeDeletion(plan, args, ctx);
}

async function handleDelete(
  args: DeleteInput,
  ctx: ToolCtx,
): Promise<DeleteOutput | InputRequiredResult> {
  // Duplicate paths collapse: results are keyed by path, so a repeated entry
  // would emit two rows for one deletion and inflate `summary.total`.
  const paths = [...new Set(args.paths)];

  // Phase 1 (no mutation): plan every path.
  const planned = await processInParallel(
    paths,
    (inputPath) => planPath(inputPath, args, ctx.fs),
    PARALLEL_CONCURRENCY,
    ctx.signal,
  );

  const out = new Array<DeletePerPathResult | undefined>(paths.length).fill(undefined);
  const plans: { plan: DeletePlan; index: number }[] = [];
  // On a retry of this op, the verified state binds the directories the user
  // was asked about.
  const state = ctx.requestState?.<PendingState>();
  const confirmed = state?.op === 'delete' ? new Set(state.paths) : undefined;
  // Confirmed paths this retry reports without deleting them.
  const settled = new Set<string>();
  for (const { index, value: r } of planned.results) {
    if (r.status === 'fail') out[index] = { path: r.failure.path, error: r.failure.error };
    else if (r.status === 'noop') out[index] = { path: r.deleted, value: { deleted: true } };
    else if (confirmed?.has(r.plan.validPath) && r.plan.itemType !== 'directory') {
      // The answer was for a directory. Whatever replaced it while the prompt
      // was open was never confirmed: report it, never delete it.
      const failure = typeChangedFailure(r.plan.validPath, 'directory', r.plan.itemType);
      out[index] = { path: failure.path, error: failure.error };
      settled.add(r.plan.validPath);
    } else {
      // A confirmed path that is still a directory stays pending, even one
      // emptied while its prompt was open, so the verified retry honors skip.
      r.plan.pending ||= confirmed?.has(r.plan.validPath) ?? false;
      plans.push({ plan: r.plan, index });
    }
  }
  for (const { index, error } of planned.errors) {
    out[index] = {
      path: paths[index] ?? '(unknown)',
      error: { code: ErrorCode.UNKNOWN, message: error.message },
    };
  }

  // Pending set: recursive + non-empty directories, plus every confirmed path
  // that is still a directory.
  const pending = new Set(plans.filter((p) => p.plan.pending).map((p) => p.plan.validPath));
  // A confirmed path no plan covers and that is gone from disk was removed
  // while the prompt was open; its request entry already carries the normal
  // planning result (NOT_FOUND, or a no-op with ignoreIfNotExists).
  const unmatched = [...(confirmed ?? [])].filter((p) => !pending.has(p) && !settled.has(p));
  const gone = await processInParallel(
    unmatched,
    async (p) => ((await isGone(p, ctx.fs)) ? p : undefined),
    PARALLEL_CONCURRENCY,
    ctx.signal,
  );
  for (const { value } of gone.results) if (value !== undefined) settled.add(value);

  // `buildInputRequired` seals exactly this sorted list into the requestState;
  // on round 1 it is the pending set. A retry adds the confirmed paths it
  // settled, so it matches the bound list unless a directory needs an answer
  // it never got or a confirmed path still exists but matches no request
  // entry — the codec only proves the state was not tampered, not that it
  // matches the current request (R9). Once matched, the confirmation keys
  // index this list.
  const roundPaths = [...new Set([...pending, ...settled])].sort();

  if (roundPaths.length > 0 || confirmed !== undefined) {
    // Round 1 returns input_required (atomic — R14: nothing deleted yet, not
    // even the non-pending items in the same call); a retry whose verified
    // state does not bind this list throws (R9) via `pendingRoundTrip`, even
    // one with nothing left pending.
    const round = await pendingRoundTrip(ctx, {
      op: 'delete',
      pending: roundPaths,
      buildInputs: (ps) =>
        ps.map((p, i) => ({
          key: confirmKey(i),
          message: `Permanently delete "${p}" and all its contents? This cannot be undone.`,
          choices: ['delete', 'skip'],
        })),
    });
    if (round !== undefined) return round;
  }

  // Phase 2 (mutation): execute deletions for every planned path.
  const executed = await processInParallel(
    plans,
    ({ plan }) => executePlan(plan, args, ctx, roundPaths),
    PARALLEL_CONCURRENCY,
    ctx.signal,
  );

  for (const { index, value: r } of executed.results) {
    const slot = plans[index]?.index;
    if (slot === undefined) continue;
    if ('skipped' in r) {
      out[slot] = { path: r.path, value: { deleted: false } };
    } else if ('failure' in r) {
      out[slot] = { path: r.failure.path, error: r.failure.error };
    } else {
      out[slot] = { path: r.deleted, value: { deleted: true } };
    }
  }
  for (const { index, error } of executed.errors) {
    const slot = plans[index]?.index;
    if (slot === undefined) continue;
    out[slot] = {
      path: paths[slot] ?? '(unknown)',
      error: { code: ErrorCode.UNKNOWN, message: error.message },
    };
  }

  // Emit in the caller's input order so `results[i]` lines up with `paths[i]`
  // the way read/stat guarantee.
  const results: DeletePerPathResult[] = paths.map((requested, i) => {
    const entry = out[i];
    return (
      entry ?? {
        path: requested,
        error: { code: ErrorCode.UNKNOWN, message: 'Unknown delete failure' },
      }
    );
  });

  return { results, summary: summarize(results) };
}

export const DELETE = defineTool<typeof DeleteInputSchema, DeleteOutput>({
  name: 'delete',
  title: 'Delete File',
  description:
    'Permanently delete files, directories, or symlinks, like rm or rm -r. Paths are exact; globs are not expanded.',
  input: DeleteInputSchema,
  readOnlyHint: false,
  progress: (args) => ({
    label: 'Delete',
    subject:
      args.paths.length === 1
        ? basename(args.paths[0] ?? '')
        : `${String(args.paths.length)} paths`,
  }),
  accessPaths: (args) => [...args.paths],
  run: async (args, ctx) => {
    const structured = await handleDelete(args, ctx);
    // input_required is a return value, not a completed call: surface it
    // verbatim so the executor short-circuits before building a CallToolResult.
    if (isInputRequiredResult(structured)) return structured;
    // Name every path and its outcome. The old text said "deleted 2 paths"
    // without saying which two, so a partial failure was unreadable without
    // parsing the structured half.
    const { failed, total } = structured.summary;
    const isError = isTotalFailure(structured.summary);
    // A lone failure carries its reason in the text. "delete: . FAILED (0/1 ok)"
    // made the model re-read structuredContent to learn it was ACCESS_DENIED;
    // with one path there is no ambiguity about which message applies.
    if (total === 1 && failed === 1) {
      const only = structured.results[0];
      return {
        structured,
        text: `delete: ${only?.path ?? ''} FAILED — ${only && 'error' in only ? only.error.message : 'unknown error'}`,
        isError,
      };
    }
    const tokens = structured.results.map((r) => {
      const label = pathLabel(r.path);
      if ('error' in r) return `${label} FAILED`;
      return r.value.deleted ? label : `${label} SKIPPED`;
    });
    const ratio = failed > 0 ? ` (${String(total - failed)}/${String(total)} ok)` : '';
    return { structured, text: `delete: ${joinRoster(tokens)}${ratio}`, isError };
  },
});
