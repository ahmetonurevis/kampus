import { execFile } from 'node:child_process'

import { MIME, type FilePurpose } from '@kampus/school-core/content/taxonomy.ts'

/**
 * Ses dönüştürücü (ADR 0003 karar 10; OG-262). `ffmpeg`/`ffprobe` sistem ikilileri ayrı süreç
 * olarak `execFile` ile, argüman dizisiyle çağrılır; kabuk kullanılmaz. Ses yalnız kendi
 * altyapımızda işlenir, dış servis yoktur (karar 9, DOM-BEC-051).
 *
 * Hata sınıfları: içerik çözülemez, ses akışı yok ya da süre ölçülemezse `MediaContentError`
 * (kalıcı: dosya reddedilir); ikili yok, süre aşımı ya da iptal `MediaToolError` (geçici: iş yeniden
 * denenir). Süreç çıktısı (stderr) yalnız sessizlik ölçümü için okunur, loglanmaz.
 */

/** Dönüşümden geçen amaçlar ve hedef bit hızı: konuşma ~64 kbps, dinleme ~96 kbps. */
export const AUDIO_TRANSCODE_PROFILES = {
  speaking_recording: { bitrateKbps: 64 },
  listening_audio: { bitrateKbps: 96 },
} as const satisfies Partial<Record<FilePurpose, { bitrateKbps: number }>>
export type TranscodedPurpose = keyof typeof AUDIO_TRANSCODE_PROFILES

export function needsTranscode(purpose: FilePurpose): purpose is TranscodedPurpose {
  return Object.hasOwn(AUDIO_TRANSCODE_PROFILES, purpose)
}

/** Çıktının kanonik türü: AAC-LC, M4A kabı (core `MIME.m4a`). */
export const TRANSCODED_CONTENT_TYPE = MIME.m4a
export const TRANSCODED_SAMPLE_RATE = 48_000

/** Tek ffmpeg/ffprobe sürecinin süre sınırı; aşılınca süreç öldürülür (geçici hata). */
export const MEDIA_PROCESS_TIMEOUT_MS = 120_000

/** Sessizlik eşiği ve en kısa sessiz aralık (`silencedetect`). */
export const SILENCE_NOISE_DB = -50
export const SILENCE_MIN_SECONDS = 0.5
/** Sessiz sayılmayan ses bundan kısaysa kayıt tamamen sessizdir. */
export const AUDIBLE_MIN_MS = 250

const STDERR_LIMIT_BYTES = 4 * 1024 * 1024

export const MEDIA_CONTENT_CODES = [
  'media_undecodable',
  'media_no_audio',
  'media_empty',
  'media_silent',
  'media_too_large',
  'media_too_long',
  'media_object_missing',
] as const
export type MediaContentCode = (typeof MEDIA_CONTENT_CODES)[number]

/** İçerik çözülemiyor ya da kurala uymuyor: dosya reddedilir, yeniden denenmez. */
export class MediaContentError extends Error {
  readonly code: MediaContentCode
  constructor(code: MediaContentCode, options?: ErrorOptions) {
    super(`media content rejected: ${code}`, options)
    this.name = 'MediaContentError'
    this.code = code
  }
}

export type MediaToolCode = 'media_tool_unavailable' | 'media_timeout' | 'media_aborted'

/** Araç ya da ortam hatası (ikili yok, süre aşımı, iptal): geçicidir, iş yeniden denenir. */
export class MediaToolError extends Error {
  readonly code: MediaToolCode
  constructor(code: MediaToolCode, options?: ErrorOptions) {
    super(`media tool failed: ${code}`, options)
    this.name = 'MediaToolError'
    this.code = code
  }
}

export interface TranscodeInput {
  inputPath: string
  outputPath: string
  /** Yüklemede içerikten tespit edilen tür; ffmpeg'in giriş biçimini sabitler. */
  contentType: string
  bitrateKbps: number
  signal?: AbortSignal
}

export interface TranscodeResult {
  /** Çıktının ölçülen süresi (ms). */
  durationMs: number
  /** Duyulabilir ses `AUDIBLE_MIN_MS`'den kısa (tamamen sessiz kayıt). */
  silent: boolean
}

/** Bağımlılık olarak verilir: testler sahte dönüştürücü kullanır. */
export interface AudioTranscoder {
  transcode(input: TranscodeInput): Promise<TranscodeResult>
}

/**
 * Yüklemede kabul edilen ses türlerinin ffmpeg giriş biçimi. Biçim sabitlenir: ffmpeg içerikten
 * başka bir biçim (ör. çalma listesi) sezip dış kaynak açmaya çalışmaz; ayrıca yalnız `file`
 * protokolüne izin verilir.
 */
const INPUT_FORMATS: Readonly<Record<string, string>> = {
  [MIME.mp3]: 'mp3',
  [MIME.m4a]: 'mov',
  [MIME.m4aAlt]: 'mov',
  [MIME.wav]: 'wav',
  [MIME.webmAudio]: 'matroska',
}

function inputArgs(input: Pick<TranscodeInput, 'inputPath' | 'contentType'>): string[] {
  const format = INPUT_FORMATS[input.contentType]
  return [
    '-protocol_whitelist',
    'file',
    ...(format === undefined ? [] : ['-f', format]),
    '-i',
    `file:${input.inputPath}`,
  ]
}

/** `silencedetect` çıktısından toplam sessiz süre (ms); kapanmayan sessizlik sona kadar sürer. */
export function silentMs(stderr: string, durationMs: number): number {
  let total = 0
  let openStart: number | null = null
  for (const line of stderr.split('\n')) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line)
    if (start?.[1] !== undefined) {
      openStart = Math.max(0, Number(start[1]) * 1000)
      continue
    }
    const end = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/.exec(line)
    if (end?.[2] !== undefined) {
      total += Number(end[2]) * 1000
      openStart = null
    }
  }
  if (openStart !== null) total += Math.max(0, durationMs - openStart)
  return total
}

interface ProcessExit {
  stdout: string
  stderr: string
}

/** Süreç sıfırdan farklı kodla bitti: girdi çözülemedi (çağıran içerik hatasına çevirir). */
class ProcessExitError extends Error {
  constructor(options?: ErrorOptions) {
    super('media process exited with an error', options)
    this.name = 'ProcessExitError'
  }
}

function runProcess(
  binary: string,
  args: string[],
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<ProcessExit> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        timeout: options.timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: STDERR_LIMIT_BYTES,
        windowsHide: true,
        encoding: 'utf8',
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr })
          return
        }
        if (error.name === 'AbortError') {
          reject(new MediaToolError('media_aborted', { cause: error }))
          return
        }
        const code: unknown = Reflect.get(error, 'code')
        if (code === 'ENOENT' || code === 'EACCES') {
          reject(new MediaToolError('media_tool_unavailable', { cause: error }))
          return
        }
        if (error.killed === true) {
          reject(new MediaToolError('media_timeout', { cause: error }))
          return
        }
        reject(new ProcessExitError({ cause: error }))
      },
    )
  })
}

export interface FfmpegOptions {
  ffmpegPath: string
  ffprobePath: string
  timeoutMs?: number
}

/**
 * Gerçek dönüştürücü: önce `ffprobe` ile girdide ses akışı aranır, sonra `ffmpeg` AAC-LC, M4A,
 * mono, 48 kHz'e çevirir (meta veri ve bölümler atılır, `+faststart`) ve aynı geçişte
 * `silencedetect` sessiz aralıkları bildirir; süre çıktıdan `ffprobe` ile ölçülür.
 */
export function createFfmpegTranscoder(options: FfmpegOptions): AudioTranscoder {
  const timeoutMs = options.timeoutMs ?? MEDIA_PROCESS_TIMEOUT_MS
  const run = (binary: string, args: string[], signal?: AbortSignal) =>
    runProcess(binary, args, { timeoutMs, ...(signal ? { signal } : {}) })
  const asContentError = async <T>(work: Promise<T>, code: MediaContentCode): Promise<T> => {
    try {
      return await work
    } catch (error) {
      if (error instanceof ProcessExitError) throw new MediaContentError(code, { cause: error })
      throw error
    }
  }
  return {
    async transcode(input) {
      const probe = await asContentError(
        run(
          options.ffprobePath,
          [
            '-v',
            'error',
            ...inputArgs(input),
            '-select_streams',
            'a',
            '-show_entries',
            'stream=index',
            '-of',
            'csv=p=0',
          ],
          input.signal,
        ),
        'media_undecodable',
      )
      if (probe.stdout.trim() === '') throw new MediaContentError('media_no_audio')
      const converted = await asContentError(
        run(
          options.ffmpegPath,
          [
            '-nostdin',
            '-hide_banner',
            '-nostats',
            '-v',
            'info',
            ...inputArgs(input),
            '-map',
            '0:a:0',
            '-vn',
            '-sn',
            '-dn',
            '-map_metadata',
            '-1',
            '-map_chapters',
            '-1',
            '-af',
            `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_SECONDS}`,
            '-ac',
            '1',
            '-ar',
            String(TRANSCODED_SAMPLE_RATE),
            '-c:a',
            'aac',
            '-profile:a',
            'aac_low',
            '-b:a',
            `${input.bitrateKbps}k`,
            '-threads',
            '1',
            '-movflags',
            '+faststart',
            '-f',
            'mp4',
            '-y',
            `file:${input.outputPath}`,
          ],
          input.signal,
        ),
        'media_undecodable',
      )
      const measured = await asContentError(
        run(
          options.ffprobePath,
          [
            '-v',
            'error',
            '-protocol_whitelist',
            'file',
            '-show_entries',
            'format=duration',
            '-of',
            'csv=p=0',
            `file:${input.outputPath}`,
          ],
          input.signal,
        ),
        'media_undecodable',
      )
      const seconds = Number(measured.stdout.trim())
      if (!Number.isFinite(seconds) || seconds < 0) throw new MediaContentError('media_undecodable')
      const durationMs = Math.round(seconds * 1000)
      const audibleMs = durationMs - silentMs(converted.stderr, durationMs)
      return { durationMs, silent: audibleMs < AUDIBLE_MIN_MS }
    },
  }
}
