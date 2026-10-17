import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, lstat, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import * as z from 'zod/v4';

import { ErrorCode, FsError } from '../core/errors.ts';
import { detectMimeType } from '../core/mime.ts';
import { RequiredPath } from '../core/schema.ts';
import { getMaxTextFileSize } from '../core/util.ts';
import { defineTool } from './define.ts';

// Fork-only tool (home NAS, 2026-10-11): `create` writes text verbatim, so
// binary files (audio for the learning flow) could not reach the NAS through
// MCP. This tool is self-contained — it touches no upstream module beyond the
// shared path guard and helpers — so upstream releases merge without conflict.
//
// No per-file size limit: one call carries at most FS_MAX_FILE_SIZE of base64,
// so larger files go up in chunks with `append: true` (the first chunk creates
// the file), and the last chunk passes `file_sha256` so the server checks the
// whole file. Upload to "<name>.part" and `move` it into place afterwards.

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

const WriteBinaryInputSchema = z.strictObject({
  path: RequiredPath.describe('Absolute path of the file to write'),
  data_base64: z
    .string()
    .min(1, { message: 'data_base64 is empty' })
    .refine((v) => v.length <= getMaxTextFileSize(), {
      message:
        'data_base64 exceeds one call (FS_MAX_FILE_SIZE); send the file in chunks with append: true',
    })
    .refine((v) => v.length % 4 === 0 && BASE64.test(v), {
      message: 'data_base64 is not standard base64 (A-Z a-z 0-9 + /, padded with =)',
    })
    .describe('Bytes as standard base64 (the whole file, or one chunk with append)'),
  sha256: z
    .string()
    .regex(SHA256, { message: 'sha256 must be 64 lowercase hex characters' })
    .optional()
    .describe('Expected SHA-256 of these decoded bytes; nothing is written if it differs'),
  overwrite: z
    .boolean()
    .default(false)
    .describe('Replace an existing file; without it an existing file is an error'),
  append: z
    .boolean()
    .default(false)
    .describe(
      'Append these bytes to the file (created if missing) — for files larger than one call',
    ),
  file_sha256: z
    .string()
    .regex(SHA256, { message: 'file_sha256 must be 64 lowercase hex characters' })
    .optional()
    .describe('Expected SHA-256 of the whole file after this write; checked on disk'),
});

interface WriteBinaryOutput {
  path: string;
  size: number;
  sha256: string;
  fileSize: number;
  mimeType: string;
  replaced: boolean;
  appended: boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function hashFile(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export const WRITE_BINARY = defineTool<typeof WriteBinaryInputSchema, WriteBinaryOutput>({
  name: 'write_binary',
  title: 'Write Binary File',
  description:
    'Write a binary file (audio, image, video, archive, ...) from base64. Refuses an existing file ' +
    'unless overwrite is true. No size limit: send big files in chunks with append: true and pass ' +
    'file_sha256 on the last chunk. Use create for text.',
  input: WriteBinaryInputSchema,
  readOnlyHint: false,
  mapPaths: (args, fn) => ({ ...args, path: fn(args.path) }),
  run: async (args, ctx) => {
    const bytes = Buffer.from(args.data_base64, 'base64');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (args.sha256 !== undefined && args.sha256 !== sha256) {
      throw new FsError(
        ErrorCode.INVALID_INPUT,
        `decoded bytes have sha256 ${sha256}, expected ${args.sha256}; nothing was written`,
        args.path,
      );
    }

    // The guard resolves links and refuses any real target outside the roots,
    // the same rule upstream writes follow.
    const validPath = await ctx.fs.pathGuard.validatePathForWrite(args.path);
    const current = await exists(validPath);
    if (current && !args.overwrite && !args.append) {
      throw new FsError(
        ErrorCode.INVALID_INPUT,
        'file already exists; pass overwrite: true to replace it (or append: true to add a chunk)',
        args.path,
      );
    }

    await mkdir(dirname(validPath), { recursive: true });
    ctx.signal.throwIfAborted();
    if (args.append) {
      await appendFile(validPath, bytes);
    } else {
      // Same commit discipline as upstream writeFile: temp file, then rename.
      const tempPath = `${validPath}.${randomUUID().replace(/-/g, '').slice(0, 12)}.tmp`;
      try {
        await writeFile(tempPath, bytes, { flag: 'wx', signal: ctx.signal });
        ctx.signal.throwIfAborted();
        await rename(tempPath, validPath);
      } catch (error) {
        await unlink(tempPath).catch(() => undefined);
        throw error;
      }
    }

    const fileSize = (await stat(validPath)).size;
    let verified = '';
    if (args.file_sha256 !== undefined) {
      const onDisk = await hashFile(validPath, ctx.signal);
      if (onDisk !== args.file_sha256) {
        throw new FsError(
          ErrorCode.INVALID_INPUT,
          `the file on disk now has sha256 ${onDisk} (${String(fileSize)} bytes), expected ${args.file_sha256}`,
          args.path,
        );
      }
      verified = `file sha256 ${onDisk} verified`;
    }

    const output: WriteBinaryOutput = {
      path: validPath,
      size: bytes.length,
      sha256,
      fileSize,
      mimeType: detectMimeType(validPath, bytes.subarray(0, 4096)).mimeType,
      replaced: current && !args.append,
      appended: args.append,
    };
    const text = args.append
      ? `Appended ${String(bytes.length)} bytes to ${validPath} (chunk sha256 ${sha256}; file now ${String(fileSize)} bytes${verified ? `, ${verified}` : ''})`
      : `${current ? 'Replaced' : 'Created'} ${validPath} (${String(bytes.length)} bytes, sha256 ${sha256})${verified ? ` [${verified}]` : ''}`;
    return { structured: output, text };
  },
});
