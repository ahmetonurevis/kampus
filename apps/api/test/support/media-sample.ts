import { copyFile } from 'node:fs/promises'

import type {
  AudioTranscoder,
  TranscodeInput,
  TranscodeResult,
} from '../../src/services/audio-transcoder.ts'
import type {
  MediaTranscodeScheduler,
  TranscodeJobData,
} from '../../src/services/media-transcode.ts'

/**
 * Ses dönüşümü testlerinin sahte bağımlılıkları (OG-262). Gerçek ffmpeg yalnız
 * `media-ffmpeg.test.ts`'te koşar.
 */

/** Girdiyi çıktıya kopyalar ve verilen sonucu döndürür; `result` hata ise onu fırlatır. */
export class FakeTranscoder implements AudioTranscoder {
  result: TranscodeResult | Error = { durationMs: 30_000, silent: false }
  readonly calls: TranscodeInput[] = []

  async transcode(input: TranscodeInput): Promise<TranscodeResult> {
    this.calls.push(input)
    if (this.result instanceof Error) throw this.result
    await copyFile(input.inputPath, input.outputPath)
    return this.result
  }
}

/**
 * Kuyruk açıkmış gibi davranan sahte: işi kaydeder, çalıştırmaz. Test uygulamasının varsayılanıdır;
 * yüklenen ses `processing` kalır, test işi `transcodeAudioFile` ile kendisi çalıştırır.
 */
export class RecordingScheduler implements MediaTranscodeScheduler {
  readonly queued: TranscodeJobData[] = []

  async enqueue(_tx: unknown, data: TranscodeJobData): Promise<void> {
    this.queued.push(data)
  }

  async afterCommit(): Promise<void> {}
}
