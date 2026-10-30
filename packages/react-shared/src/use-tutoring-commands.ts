import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'
import { ASSESSMENT_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { collectionKeyPrefix } from './collections.ts'
import type { CommandHeaders, CommandMessages } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'

type PlanBody = operations['createTutorSessions']['requestBody']['content']['application/json']
type AttendanceBody =
  operations['recordTutorAttendance']['requestBody']['content']['application/json']

/** Etüt yoklama durumları (core `runAssessment('attendance')` ile aynı üç değer). */
export type TutorAttendanceMark = AttendanceBody['marks'][string]

/** Plan onayı: önizlemede gösterilen planın JSON metni `expectedPlan`'dır. */
export type CreateTutorSessionsInput = PlanBody

export interface CancelTutorSessionInput {
  sessionId: string
  reason: string
  /** Etüt kaydının okunan sürümü (`If-Match`); yoksa başlık gönderilmez. */
  version?: number | null
}

export interface RecordTutorAttendanceInput {
  sessionId: string
  /** Öğrenci kimliği → durum; etüdün bütün öğrencileri ve yalnız onlar. */
  marks: Readonly<Record<string, TutorAttendanceMark>>
  version?: number | null
}

/** Önizlemedeki plan sunucunun yeniden hesapladığı plandan farklı (409 `tutoring_plan_stale`). */
export const TUTORING_PLAN_STALE_CODE = 'tutoring_plan_stale'

export const TUTORING_MESSAGES = {
  version_conflict: 'Etüt kaydı değişti. Liste güncellendi; kontrol edip yeniden deneyin.',
  [TUTORING_PLAN_STALE_CODE]:
    'Etüt planı değişmiş. Güncel plan yeniden hesaplandı; farkı kontrol edip yeniden onaylayın.',
} as const satisfies CommandMessages

/** `POST /tutor-sessions` isteği; ayrı verilir ki sahte istemciyle sınanabilsin. */
export function createTutorSessionsRequest(
  client: KampusClient,
  input: CreateTutorSessionsInput,
  headers: CommandHeaders,
) {
  // Bu uçta `If-Match` yoktur (konu kayıt yok); yalnız `Idempotency-Key` gönderilir.
  return client.POST('/api/v1/tutor-sessions', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body: input,
  })
}

export function cancelTutorSessionRequest(
  client: KampusClient,
  { sessionId, reason }: CancelTutorSessionInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/tutor-sessions/{sessionId}/cancel', {
    params: { path: { sessionId }, header: headers },
    body: { reason },
  })
}

export function recordTutorAttendanceRequest(
  client: KampusClient,
  { sessionId, marks }: RecordTutorAttendanceInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/tutor-sessions/{sessionId}/attendance', {
    params: { path: { sessionId }, header: headers },
    body: { marks: { ...marks } },
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}

/**
 * Etüt planını onaylar. Sunucu planı güncel veriyle yeniden hesaplar; `expectedPlan` farklıysa
 * 409 `tutoring_plan_stale` döner ve planın okuduğu koleksiyonlar tazelenir (ekran yeni planı
 * hesaplayıp farkı gösterir). Çift tıklama tek istek atar.
 */
export function useCreateTutorSessions(options: CommandOptions = {}) {
  return useApiCommand({
    request: createTutorSessionsRequest,
    invalidates: ASSESSMENT_COMMANDS.plan.collections.map((name) => collectionKeyPrefix(name)),
    messages: TUTORING_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Etüdü gerekçeyle iptal eder (`POST /tutor-sessions/:sessionId/cancel`); geçmiş korunur. */
export function useCancelTutorSession(options: CommandOptions = {}) {
  return useApiCommand({
    request: cancelTutorSessionRequest,
    version: (input: CancelTutorSessionInput) => input.version,
    invalidates: [collectionKeyPrefix('tutorSessions')],
    messages: TUTORING_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Etüt yoklamasını alır veya günceller; etüt tamamlanır (`POST …/attendance`). */
export function useRecordTutorAttendance(options: CommandOptions = {}) {
  return useApiCommand({
    request: recordTutorAttendanceRequest,
    version: (input: RecordTutorAttendanceInput) => input.version,
    invalidates: [collectionKeyPrefix('tutorSessions')],
    messages: TUTORING_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}
