import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { requireAuthorized } from './authorize.ts'
import type { Participant } from './communication.ts'
import { DomainError } from './errors.ts'

/**
 * Ders videosu izleme ilerlemesi (`videoProgress`, modül `learning`; IST-041,
 * docs/domain/kaynak-platformu.md DOM-KYN-005). Saf işlem; önce bütün kurallar denetlenir, sonra
 * State değişir. Yetki `lib/authorize.ts` tablosundadır (`video.progress`).
 *
 * - Öğrenci yalnız kendi ilerlemesini ve yalnız kendi düzeyindeki (okuma kapsamındaki) bir
 *   videoyu yazar; başka düzeyin videosu olmayan videoyla aynı 404'tür.
 * - Yüzde istemcinin gönderdiği konum ve süreden hesaplanır, 0–100'e sıkıştırılır. Saklanan
 *   ilerleme geri gitmez (izlenen en yüksek değer); son konum ayrıdır ve her istekte değişir,
 *   böylece oynatıcı kaldığı yerden devam eder.
 * - Konum süreyi aşamaz (sürenin sonuna sıkıştırılır). Aynı istek tekrarlanınca kayıt değişmez.
 *
 * Şema API gövde şemasıdır.
 */

z.config(z.locales.tr())

/** En uzun kabul edilen video/konum: 24 saat (saniye). */
export const VIDEO_PROGRESS_MAX_SECONDS = 86_400

export const recordVideoProgressSchema = z.strictObject({
  /** Oynatıcının son konumu (saniye). */
  positionSeconds: z
    .number('Konumu sayı olarak girin.')
    .min(0, 'Konum eksi olamaz.')
    .max(VIDEO_PROGRESS_MAX_SECONDS, 'Konum 24 saati aşamaz.'),
  /** Oynatıcının bildirdiği video süresi (saniye). */
  durationSeconds: z
    .number('Süreyi sayı olarak girin.')
    // Tam saniyeye yuvarlanır (`Math.round`); 1'in altı 0'a düşer, kayıt ve yanıt şeması en az 1 ister.
    .min(1, 'Süre en az 1 saniye olmalı.')
    .max(VIDEO_PROGRESS_MAX_SECONDS, 'Süre 24 saati aşamaz.'),
})
export type RecordVideoProgressInput = z.input<typeof recordVideoProgressSchema>

/** İlerleme işleminin eklediği alanlar; örnek veri ve eski kayıtlar taşımaz. */
export type VideoProgressFields = {
  /** Son konum (tam saniye); yoksa oynatıcı yüzdeden türetir. */
  positionSeconds?: number
  /** Son bildirilen video süresi (tam saniye). */
  durationSeconds?: number
}

export type VideoProgressRecord = State['videoProgress'][number] & VideoProgressFields

/** Konum ve süreden izlenen yüzde: yuvarlanır, 0–100'e sıkıştırılır. */
export function videoProgressPercent(positionSeconds: number, durationSeconds: number): number {
  if (!(durationSeconds > 0) || !Number.isFinite(positionSeconds)) return 0
  return Math.min(100, Math.max(0, Math.round((positionSeconds / durationSeconds) * 100)))
}

function linkedStudentId(state: State, by: Participant): string | undefined {
  if (by.role !== 'ogrenci') return undefined
  const ids = new Set(
    by.links.filter((link) => link.kind === 'student').map((link) => link.recordId),
  )
  const found = state.students.filter((s) => ids.has(s.id))
  return found.length === 1 ? found[0]?.id : undefined
}

export type VideoProgressOutcome = {
  record: VideoProgressRecord
  /** Kayıt bu istekle açıldı mı. */
  created: boolean
}

/**
 * İlerlemeyi yazar (DOM-KYN-005): ilk istek kaydı açar, sonrakiler günceller. Yüzde yalnız
 * yükselir, konum ve süre son istektekidir. Modül kapalıysa 403 `module_disabled`; bağlantısız
 * öğrenci 403 `student_scope_denied`; kapsam dışı ve olmayan video 404 `video_not_found`; pasif
 * öğrenci 422 `student_inactive`.
 */
export function recordVideoProgress(
  state: State,
  by: Participant,
  videoId: string,
  input: unknown,
  options: { institutionType?: InstitutionType } = {},
): VideoProgressOutcome {
  const data = recordVideoProgressSchema.parse(input)
  const studentId = linkedStudentId(state, by)
  const video = state.videos.find((item) => item.id === videoId)
  requireAuthorized(by, 'video.progress', { studentId, video }, state, options)
  const student = state.students.find((s) => s.id === studentId)
  if (!video || !student)
    throw new DomainError('video_not_found', 'Video bulunamadı.', { kind: 'not_found' })
  if (student.isActive === false)
    throw new DomainError('student_inactive', 'Kaydı pasif olan öğrenci izleme kaydı yazamaz.')
  const duration = Math.round(data.durationSeconds)
  const position = Math.min(Math.round(data.positionSeconds), duration)
  const percent = videoProgressPercent(position, duration)
  const existing: VideoProgressRecord | undefined = state.videoProgress.find(
    (item) => item.studentId === student.id && item.videoId === video.id,
  )
  if (existing) {
    // Aynı değerler yeniden yazılmaz: işlem idempotenttir (kayıt sürümü artmaz).
    existing.progress = Math.max(existing.progress, percent)
    existing.positionSeconds = position
    existing.durationSeconds = duration
    return { record: existing, created: false }
  }
  const record: VideoProgressRecord = {
    studentId: student.id,
    videoId: video.id,
    progress: percent,
    positionSeconds: position,
    durationSeconds: duration,
  }
  state.videoProgress.push(record)
  return { record, created: true }
}
