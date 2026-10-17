import type { ContentBlock } from '@modelcontextprotocol/server';

import { basename } from 'node:path';

import * as z from 'zod/v4';

import { ErrorCode, FsError } from '../core/errors.ts';
import { runBinary } from '../core/exec.ts';
import { RequiredPath } from '../core/schema.ts';
import { MIB } from '../core/util.ts';
import type { ToolDef } from './define.ts';
import { defineTool } from './define.ts';

const MAX_FRAMES = 12;
const MAX_TOTAL_IMAGE_BYTES = 8 * MIB;
const FRAME_TIMEOUT_MS = 60_000;
const MAX_SUBTITLE_CHARS = 8000;

const ReadVideoFramesInputSchema = z
  .strictObject({
    path: RequiredPath.describe('Video file inside an allowed workspace root.'),
    frames: z
      .int()
      .min(1, { message: 'Min: 1' })
      .max(MAX_FRAMES, { message: `Max: ${String(MAX_FRAMES)}` })
      .default(6)
      .describe(
        `Evenly spaced frames to return as JPEG images (default 6, max ${String(MAX_FRAMES)})`,
      ),
    start: z.number().min(0).optional().describe('Window start in seconds (default 0)'),
    end: z.number().positive().optional().describe('Window end in seconds (default: end of video)'),
    width: z
      .int()
      .min(320, { message: 'Min: 320' })
      .max(1920, { message: 'Max: 1920' })
      .default(1280)
      .describe('Frame width in pixels (default 1280)'),
  })
  .refine((v) => v.start === undefined || v.end === undefined || v.end > v.start, {
    message: 'end must be greater than start',
  });

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  tags?: { language?: string };
}

interface ReadVideoFramesOutput {
  path: string;
  durationSeconds: number;
  frames: { seconds: number; bytes: number }[];
  subtitleStreams: number;
}

function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${hh > 0 ? `${String(hh)}:` : ''}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

const readVideoFramesDef: ToolDef<typeof ReadVideoFramesInputSchema, ReadVideoFramesOutput> = {
  name: 'read_video_frames',
  title: 'Read Video Frames',
  description:
    'Look at a video: returns evenly spaced keyframes as JPEG images, duration and stream info, ' +
    'and the first embedded subtitle track as text when present. Audio is not transcribed.',
  input: ReadVideoFramesInputSchema,
  readOnlyHint: true,
  timeoutMs: FRAME_TIMEOUT_MS * 4,
  defaultErrorCode: ErrorCode.NOT_FILE,
  progress: (args) => ({ label: 'Read video', subject: basename(args.path) }),
  mapPaths: (args, fn) => ({ ...args, path: fn(args.path) }),
  run: async (args, ctx) => {
    const { stats, validPath } = await ctx.fs.stat(args.path, { signal: ctx.signal });
    if (!stats.isFile()) throw new FsError(ErrorCode.NOT_FILE, 'Not a file.', args.path);
    const opts = { signal: ctx.signal, timeoutMs: FRAME_TIMEOUT_MS };

    const probeRaw = await runBinary(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,codec_name,width,height:stream_tags=language',
        '-of',
        'json',
        validPath,
      ],
      opts,
    ).catch(() => {
      throw new FsError(ErrorCode.INVALID_INPUT, 'Not a readable video file.', args.path);
    });
    const probe = JSON.parse(probeRaw.toString('utf8')) as {
      format?: { duration?: string };
      streams?: ProbeStream[];
    };
    const streams = probe.streams ?? [];
    const video = streams.find((s) => s.codec_type === 'video');
    const duration = Number.parseFloat(probe.format?.duration ?? '');
    if (!video || !Number.isFinite(duration) || duration <= 0) {
      throw new FsError(
        ErrorCode.INVALID_INPUT,
        'No video stream with a known duration.',
        args.path,
      );
    }

    const start = Math.min(args.start ?? 0, duration);
    const end = Math.min(args.end ?? duration, duration);
    if (end <= start) {
      throw new FsError(
        ErrorCode.INVALID_INPUT,
        `Window is outside the video (duration ${formatTime(duration)}).`,
        args.path,
      );
    }
    const span = end - start;
    const images: ContentBlock[] = [];
    const frames: { seconds: number; bytes: number }[] = [];
    let totalBytes = 0;
    for (let i = 0; i < args.frames; i += 1) {
      ctx.onProgress({ current: i, total: args.frames });
      const at = Math.round((start + ((i + 0.5) * span) / args.frames) * 100) / 100;
      const jpg = await runBinary(
        'ffmpeg',
        [
          '-loglevel',
          'error',
          '-ss',
          String(at),
          '-i',
          validPath,
          '-frames:v',
          '1',
          '-vf',
          `scale=${String(args.width)}:-2`,
          '-q:v',
          '4',
          '-f',
          'image2pipe',
          '-c:v',
          'mjpeg',
          'pipe:1',
        ],
        { ...opts, maxOutputBytes: MAX_TOTAL_IMAGE_BYTES },
      );
      if (jpg.length === 0) continue;
      if (frames.length > 0 && totalBytes + jpg.length > MAX_TOTAL_IMAGE_BYTES) break;
      totalBytes += jpg.length;
      frames.push({ seconds: at, bytes: jpg.length });
      images.push({ type: 'image', data: jpg.toString('base64'), mimeType: 'image/jpeg' });
    }
    if (frames.length === 0)
      throw new FsError(ErrorCode.IO_ERROR, 'No frame could be decoded.', args.path);

    const subtitleStreams = streams.filter((s) => s.codec_type === 'subtitle');
    let subtitles = '';
    if (subtitleStreams.length > 0) {
      try {
        const srt = await runBinary(
          'ffmpeg',
          ['-loglevel', 'error', '-i', validPath, '-map', '0:s:0', '-f', 'srt', 'pipe:1'],
          opts,
        );
        subtitles = srt.toString('utf8').trim();
      } catch {
        subtitles = '(subtitle track present but could not be extracted as text)';
      }
    }

    const audio = streams.find((s) => s.codec_type === 'audio');
    const lines = [
      `${basename(args.path)}: duration ${formatTime(duration)}, video ${video.codec_name ?? '?'} ${String(video.width ?? '?')}x${String(video.height ?? '?')}` +
        `${audio ? `, audio ${audio.codec_name ?? '?'}` : ''}, ${String(subtitleStreams.length)} subtitle track(s).`,
      `Frames (in order) at: ${frames.map((f) => formatTime(f.seconds)).join(', ')}`,
    ];
    if (frames.length < args.frames)
      lines.push(
        `// truncated: image budget (${String(MAX_TOTAL_IMAGE_BYTES / MIB)} MiB) reached; lower width or frames.`,
      );
    if (subtitles) {
      lines.push(
        '--- subtitles (track 1) ---',
        subtitles.length > MAX_SUBTITLE_CHARS
          ? `${subtitles.slice(0, MAX_SUBTITLE_CHARS)}\n// [subtitles clipped]`
          : subtitles,
      );
    }
    return {
      structured: {
        path: args.path,
        durationSeconds: duration,
        frames,
        subtitleStreams: subtitleStreams.length,
      },
      text: lines.join('\n'),
      resources: images,
    };
  },
};

export const READ_VIDEO_FRAMES = defineTool(readVideoFramesDef);
/** The tool body, reused by `read` when it routes a binary file here. */
export const runReadVideoFrames: ToolDef<
  typeof ReadVideoFramesInputSchema,
  ReadVideoFramesOutput
>['run'] = readVideoFramesDef.run;
export { ReadVideoFramesInputSchema };
