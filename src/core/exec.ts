import { spawn } from 'node:child_process';

import { ErrorCode, FsError } from './errors.ts';
import { MIB } from './util.ts';

interface RunOptions {
  readonly signal: AbortSignal;
  /** Bytes written to the child's stdin; stdin is closed immediately when absent. */
  readonly input?: Buffer;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

/**
 * Runs a helper binary (poppler, djvulibre, ffmpeg, antiword, …) without a
 * shell and returns its stdout. A missing binary, a non-zero exit, a timeout
 * and an oversized output all become actionable FsErrors; an abort rethrows
 * the caller's signal reason.
 */
export async function runBinary(
  bin: string,
  args: readonly string[],
  { signal, input, timeoutMs = 60_000, maxOutputBytes = 64 * MIB }: RunOptions,
): Promise<Buffer> {
  signal.throwIfAborted();
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      signal,
      timeout: timeoutMs,
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let failed: FsError | undefined;

    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxOutputBytes) {
        failed ??= new FsError(
          ErrorCode.TOO_LARGE,
          `${bin} output exceeded ${String(Math.round(maxOutputBytes / MIB))} MiB.`,
        );
        child.kill('SIGKILL');
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString('utf8');
    });
    // EPIPE when the child exits before reading all of stdin is not the error to report.
    child.stdin.on('error', () => undefined);
    if (input) child.stdin.end(input);
    else child.stdin.end();

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (signal.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
        return;
      }
      reject(
        error.code === 'ENOENT'
          ? new FsError(ErrorCode.IO_ERROR, `${bin} is not installed on the server.`)
          : new FsError(ErrorCode.IO_ERROR, `${bin} failed to start: ${error.message}`),
      );
    });
    child.on('close', (code, sig) => {
      if (signal.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
        return;
      }
      if (failed) {
        reject(failed);
        return;
      }
      if (code === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      const reason =
        sig === 'SIGTERM'
          ? `timed out after ${String(timeoutMs)} ms`
          : `exit ${String(code ?? sig)}`;
      reject(
        new FsError(
          ErrorCode.IO_ERROR,
          `${bin} failed (${reason}): ${stderr.trim().slice(0, 500)}`,
        ),
      );
    });
  });
}
