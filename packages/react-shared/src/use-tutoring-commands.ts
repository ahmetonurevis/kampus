import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import type { CommandHeaders, CommandMessages } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'

type AttendanceBody =
  operations['recordTutorAttendance']['requestBody']['content']['application/json']

/** Etüt yoklama durumları (core `runAssessment('attendance')` ile aynı üç değer). */
export type TutorAttendanceMark = AttendanceBody['marks'][string]

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

export const TUTORING_MESSAGES = {
  version_conflict: 'Etüt kaydı değişti. Liste güncellendi; kontrol edip yeniden deneyin.',
} as const satisfies CommandMessages

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
