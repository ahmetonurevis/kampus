import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ApiClient, Principal } from './api.ts'
import { expect, test } from './fixtures.ts'
import type { Tenant } from './tenant.ts'

/**
 * Konuşma görevi e2e ortak kurulumu (IST-051, IST-052): tarayıcı sahte mikrofonla koşar
 * (Chromium `--use-fake-device-for-media-stream`); sahte mikrofon 440 Hz sinüs çalar, böylece
 * sunucunun sessizlik reddi (`recording_empty`) tetiklenmez. e2e API'sinde iş kuyruğu kapalıdır:
 * dönüşüm süreç içinde, arka planda çalışır ve istemci dosya durumunu yoklayarak bekler. Dönüşüm
 * `ffmpeg`/`ffprobe` ister; ikisi PATH'te yoksa yerelde senaryolar atlanır, CI'da (`CI`) atlamak
 * yerine açık hatayla başarısız olunur: konuşma akışı sessizce koşmaz hâle gelmesin.
 */

export const SPEAKING_PURPOSE = 'speaking_recording'

const hasFfmpeg = (() => {
  try {
    for (const tool of ['ffmpeg', 'ffprobe'])
      execFileSync(tool, ['-version'], { stdio: 'ignore', timeout: 10_000 })
    return true
  } catch {
    return false
  }
})()

/** 48 kHz, 16 bit, tek kanallı `seconds` saniyelik 440 Hz sinüs (WAV). */
function sineWav(seconds: number): Buffer {
  const rate = 48_000
  const samples = rate * seconds
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i += 1)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12_000), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/**
 * Spec dosyasının sahte mikrofonunu ve ffmpeg denetimini kurar; dosyanın üst düzeyinde bir kez
 * çağrılır. Yol işçi sürecine ve spec'e özgüdür; dosya yalnız senaryolar koşarken yazılır ve
 * sonunda silinir (Chromium sahte mikrofonu bu dosyayı tarayıcı ilk açılınca okur; `beforeAll`
 * onu önceler).
 */
export function useFakeMicrophone(name: string) {
  const wavPath = join(tmpdir(), `kampus-e2e-${name}-${process.pid}.wav`)
  test.use({
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${wavPath}`,
      ],
    },
  })
  test.skip(
    !hasFfmpeg && !process.env.CI,
    'ffmpeg/ffprobe PATH üzerinde yok: ses dönüşümü denenemez',
  )
  test.beforeAll(() => {
    if (hasFfmpeg) writeFileSync(wavPath, sineWav(4))
  })
  test.afterAll(() => {
    rmSync(wavPath, { force: true })
  })
  test.beforeEach(() => {
    if (!hasFfmpeg && process.env.CI)
      throw new Error('CI ortamında ffmpeg/ffprobe kurulu olmalı (checks.yml e2e-react işi).')
  })
}

/** Yönetici ses kaydı rıza metnini yayımlar, veli `s1` için rıza verir (DOM-BEC-050). */
export async function grantSpeakingConsent(
  tenant: Tenant,
  admin: ApiClient,
  api: (principal: Principal | null) => Promise<ApiClient>,
) {
  const notice = await admin.post(
    '/api/v1/privacy-notices',
    {
      kind: 'consent_text',
      purpose: SPEAKING_PURPOSE,
      title: 'Ses kaydı rızası',
      body: 'Çocuğumun konuşma görevi ses kaydının değerlendirme amacıyla alınmasını onaylıyorum.',
      requiresReconsent: false,
    },
    { 'idempotency-key': randomUUID() },
  )
  expect(notice.status, JSON.stringify(notice.body)).toBe(201)
  const veli = await api(tenant.user('veli'))
  const text = await veli.get(`/api/v1/consent-texts/${SPEAKING_PURPOSE}`)
  const textId = (text.body as { data: { text: { id: string } } }).data.text.id
  const given = await veli.post(
    '/api/v1/consents',
    { purpose: SPEAKING_PURPOSE, studentId: 's1', textId, channel: 'web' },
    { 'idempotency-key': randomUUID() },
  )
  expect(given.status, JSON.stringify(given.body)).toBe(201)
}
