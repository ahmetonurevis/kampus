import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'

import {
  createFfmpegTranscoder,
  MediaContentError,
  MediaToolError,
  outputLimitSeconds,
  silentMs,
} from '../src/services/audio-transcoder.ts'

/**
 * Gerçek `ffmpeg`/`ffprobe` ile dönüşüm (OG-262; ADR 0003 karar 10). Örnekler test sırasında
 * ffmpeg'in kendisiyle üretilir (repoda ikili dosya yok). İkili yoksa (CI) takım atlanır; sahte
 * dönüştürücüyle akış `media-transcode.test.ts`'tedir.
 */

const FFMPEG = 'ffmpeg'
const FFPROBE = 'ffprobe'
const available = [FFMPEG, FFPROBE].every(
  (binary) => spawnSync(binary, ['-version'], { stdio: 'ignore' }).status === 0,
)

describe('ses dönüştürücü: araç hataları ve sessizlik ölçümü', () => {
  test('ikili bulunamazsa geçici hata media_tool_unavailable', async () => {
    const transcoder = createFfmpegTranscoder({
      ffmpegPath: '/yok/ffmpeg',
      ffprobePath: '/yok/ffprobe',
    })
    await assert.rejects(
      transcoder.transcode({
        inputPath: '/yok/girdi',
        outputPath: '/yok/cikti.m4a',
        contentType: 'audio/wav',
        bitrateKbps: 64,
        maxOutputSeconds: 601,
      }),
      (error: unknown) =>
        error instanceof MediaToolError && error.code === 'media_tool_unavailable',
    )
  })

  test('silencedetect çıktısı: kapanan aralıklar toplanır, kapanmayan sona kadar sayılır', () => {
    const stderr = [
      '[silencedetect @ 0x1] silence_start: 0',
      '[silencedetect @ 0x1] silence_end: 1.5 | silence_duration: 1.5',
      '[silencedetect @ 0x1] silence_start: 3.25',
    ].join('\n')
    assert.equal(silentMs(stderr, 4000), 1500 + 750)
    assert.equal(silentMs('', 4000), 0)
  })
})

describe('ses dönüştürücü: gerçek ffmpeg', { skip: !available && 'ffmpeg yok' }, () => {
  let dir: string
  const transcoder = createFfmpegTranscoder({ ffmpegPath: FFMPEG, ffprobePath: FFPROBE })

  /** ffmpeg'in `lavfi` kaynağından WAV örneği üretir. */
  function generate(name: string, source: string): string {
    const path = join(dir, name)
    execFileSync(
      FFMPEG,
      ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', source, '-ac', '2', '-ar', '44100', path],
      { stdio: 'ignore' },
    )
    return path
  }

  function probe(path: string) {
    const output = execFileSync(
      FFPROBE,
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_name,profile,channels,sample_rate:format=format_name',
        '-of',
        'json',
        path,
      ],
      { encoding: 'utf8' },
    )
    return JSON.parse(output) as {
      streams: { codec_name: string; profile: string; channels: number; sample_rate: string }[]
      format: { format_name: string }
    }
  }

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kampus-ffmpeg-'))
  })
  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('OG-262: kısa sinüs AAC-LC, M4A, mono, 48 kHz olur; süre ölçülür, sessiz değildir', async () => {
    const input = generate('sinus.wav', 'sine=frequency=440:duration=2')
    const outputPath = join(dir, 'sinus.m4a')
    const result = await transcoder.transcode({
      inputPath: input,
      outputPath,
      contentType: 'audio/wav',
      bitrateKbps: 64,
      maxOutputSeconds: 601,
    })
    assert.equal(result.silent, false)
    assert.ok(Math.abs(result.durationMs - 2000) < 100, String(result.durationMs))
    const info = probe(outputPath)
    assert.equal(info.streams.length, 1)
    assert.equal(info.streams[0]?.codec_name, 'aac')
    assert.equal(info.streams[0]?.profile, 'LC')
    assert.equal(info.streams[0]?.channels, 1)
    assert.equal(info.streams[0]?.sample_rate, '48000')
    assert.match(info.format.format_name, /mp4|m4a/)
  })

  test('OG-262: tarayıcı kaydı biçimi (WebM/Opus) çözülür ve M4A olur', async (t) => {
    const input = join(dir, 'tarayici.webm')
    const made = spawnSync(
      FFMPEG,
      [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=330:duration=1.5:sample_rate=48000',
        '-c:a',
        'libopus',
        input,
      ],
      { stdio: 'ignore' },
    )
    if (made.status !== 0) {
      t.skip('ffmpeg libopus kodlayıcısı yok')
      return
    }
    const outputPath = join(dir, 'tarayici.m4a')
    const result = await transcoder.transcode({
      inputPath: input,
      outputPath,
      contentType: 'audio/webm',
      bitrateKbps: 64,
      maxOutputSeconds: 601,
    })
    assert.equal(result.silent, false)
    assert.ok(Math.abs(result.durationMs - 1500) < 150, String(result.durationMs))
    assert.equal(probe(outputPath).streams[0]?.codec_name, 'aac')
  })

  test('OG-262: tamamen sessiz kayıt silent olarak bildirilir', async () => {
    const input = generate('sessiz.wav', 'anullsrc=channel_layout=stereo:sample_rate=44100:d=2')
    const result = await transcoder.transcode({
      inputPath: input,
      outputPath: join(dir, 'sessiz.m4a'),
      contentType: 'audio/wav',
      bitrateKbps: 64,
      maxOutputSeconds: 601,
    })
    assert.equal(result.silent, true)
    assert.ok(result.durationMs > 1500)
  })

  test('OG-262: bozuk içerik kalıcı içerik hatasıdır', async () => {
    const input = join(dir, 'bozuk.wav')
    await writeFile(
      input,
      Buffer.concat([Buffer.from('RIFF\u0010\u0000\u0000\u0000WAVEfmt '), Buffer.alloc(64, 7)]),
    )
    await assert.rejects(
      transcoder.transcode({
        inputPath: input,
        outputPath: join(dir, 'bozuk.m4a'),
        contentType: 'audio/wav',
        bitrateKbps: 64,
        maxOutputSeconds: 601,
      }),
      (error: unknown) => error instanceof MediaContentError,
    )
  })

  test('OG-262: iptal sinyali süreci öldürür; süre aşımı geçici hatadır', async () => {
    const input = generate('uzun.wav', 'sine=frequency=220:duration=30')
    const controller = new AbortController()
    const running = transcoder.transcode({
      inputPath: input,
      outputPath: join(dir, 'uzun.m4a'),
      contentType: 'audio/wav',
      bitrateKbps: 64,
      maxOutputSeconds: 601,
      signal: controller.signal,
    })
    controller.abort()
    await assert.rejects(
      running,
      (error: unknown) => error instanceof MediaToolError && error.code === 'media_aborted',
    )
    const hurried = createFfmpegTranscoder({
      ffmpegPath: FFMPEG,
      ffprobePath: FFPROBE,
      timeoutMs: 1,
    })
    await assert.rejects(
      hurried.transcode({
        inputPath: input,
        outputPath: join(dir, 'uzun-2.m4a'),
        contentType: 'audio/wav',
        bitrateKbps: 64,
        maxOutputSeconds: 601,
      }),
      (error: unknown) => error instanceof MediaToolError && error.code === 'media_timeout',
    )
  })

  test('OG-262: çıktı amaç sınırı + 1 saniyede kesilir (-t); ölçülen süre sınırı aştığından kayıt reddedilir', async () => {
    const input = generate('sinir.wav', 'sine=frequency=440:duration=4')
    const result = await transcoder.transcode({
      inputPath: input,
      outputPath: join(dir, 'sinir.m4a'),
      contentType: 'audio/wav',
      bitrateKbps: 64,
      maxOutputSeconds: 2,
    })
    assert.ok(Math.abs(result.durationMs - 2000) < 100, String(result.durationMs))
    assert.equal(outputLimitSeconds('speaking_recording'), 10 * 60 + 1)
    assert.equal(outputLimitSeconds('listening_audio'), 15 * 60 + 1)
  })
})
