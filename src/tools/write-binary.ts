import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
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

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

const WriteBinaryInputSchema = z.strictObject({
  path: RequiredPath.describe('Absolute path of the file to write'),
  data_base64: z
    .string()
    .min(1, { message: 'data_base64 is empty' })
    .refine((v) => v.length <= getMaxTextFileSize(), {
      message: 'data_base64 exceeds the maximum file size (FS_MAX_FILE_SIZE)',
    })
    .refine((v) => v.length % 4 === 0 && BASE64.test(v), {
      message: 'data_base64 is not standard base64 (A-Z a-z 0-9 + /, padded with =)',
    })
    .describe('File bytes as standard base64'),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/u, { message: 'sha256 must be 64 lowercase hex characters' })
    .optional()
    .describe('Expected SHA-256 of the decoded bytes; the write is refused if it differs'),
  overwrite: z
    .boolean()
    .default(false)
    .describe('Replace an existing file; without it an existing file is an error'),
});

interface WriteBinaryOutput {
  path: string;
  size: number;
  sha256: string;
  mimeType: string;
  replaced: boolean;
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

export const WRITE_BINARY = defineTool<typeof WriteBinaryInputSchema, WriteBinaryOutput>({
  name: 'write_binary',
  title: 'Write Binary File',
  description:
    'Write one binary file (audio, image, PDF, ...) from base64. Refuses an existing file unless ' +
    'overwrite is true; pass sha256 to have the decoded bytes checked before anything is written. ' +
    'Use create for text.',
  input: WriteBinaryInputSchema,
  readOnlyHint: false,
  accessPaths: (args) => [args.path],
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
    if (current && !args.overwrite) {
      throw new FsError(
        ErrorCode.INVALID_INPUT,
        'file already exists; pass overwrite: true to replace it',
        args.path,
      );
    }

    await mkdir(dirname(validPath), { recursive: true });
    // Same commit discipline as upstream writeFile: temp file, then rename.
    const tempPath = `${validPath}.${randomUUID().replace(/-/g, '').slice(0, 12)}.tmp`;
    try {
      ctx.signal.throwIfAborted();
      await writeFile(tempPath, bytes, { flag: 'wx', signal: ctx.signal });
      ctx.signal.throwIfAborted();
      await rename(tempPath, validPath);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }

    const output: WriteBinaryOutput = {
      path: validPath,
      size: bytes.length,
      sha256,
      mimeType: detectMimeType(validPath, bytes.subarray(0, 4096)).mimeType,
      replaced: current,
    };
    return {
      structured: output,
      text: `${current ? 'Replaced' : 'Created'} ${validPath} (${String(bytes.length)} bytes, sha256 ${sha256})`,
    };
  },
});
