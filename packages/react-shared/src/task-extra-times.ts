import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components } from '@kampus/api-client/schema.d.ts'
import {
  EXTRA_TIME_REASONS,
  type ExtraTime,
  type ExtraTimeGrantInput,
} from '@kampus/school-core/skills/extra-time.ts'
import { isClosed, type Deadline } from '@kampus/school-core/skills/scoring.ts'

import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { TASK_ATTEMPTS_KEY } from './use-task-attempts.ts'
import { TASK_ASSIGNMENTS_KEY } from './use-task-assignments.ts'

/**
 * Bireysel ek süre uçlarının (`/api/v1/task-assignments/:id/extra-times`; DOM-BEC-043, OG-248) saf
 * yardımcıları: sorgu anahtarı, istek kurucular, Türkçe hata metinleri, tazelenecek sorgular ve
 * bölümün görünürlük kararı. Kanca `use-task-extra-times.ts`'tedir; burası React olmadan sınanır.
 * Gerekçe kategorisi yalnız personel yanıtındadır; öğrenci ve veli yanıtlarında hiç yoktur.
 */

export type TaskExtraTimeList = components['schemas']['TaskExtraTimeList']
export type TaskExtraTimeLearner = components['schemas']['TaskExtraTimeLearner']
export type TaskExtraTimeHistoryEntry = components['schemas']['TaskExtraTimeHistoryEntry']

export function taskExtraTimesKey(assignmentId: string) {
  return [TASK_ASSIGNMENTS_KEY, 'extra-times', assignmentId] as const
}

/**
 * Ek süre yazması atamanın liste ve ayrıntısını değil, kursiyerin deneme görünümünü
 * (`extraMinutes`, `endsAt`, `remainingMs`) ve kendi listesini değiştirir.
 */
export const TASK_EXTRA_TIME_INVALIDATES = [[TASK_ASSIGNMENTS_KEY], [TASK_ATTEMPTS_KEY]] as const

export const TASK_EXTRA_TIME_MESSAGES = {
  version_conflict:
    'Bu kursiyerin ek süresi siz bakarken değişti. Güncel hâli yüklendi; yeniden deneyin.',
  extra_time_exists: 'Bu kursiyerin ek süresi zaten var; değiştirmeyi kullanın.',
  extra_time_untimed: 'Ek süre yalnız süreli görevde tanımlanır.',
  extra_time_too_long: 'Ek süre görevin süresini aşamaz.',
  extra_time_below_elapsed:
    'Kursiyerin süren denemesinde geçen süre bu ek süreyi aştı; daha uzun bir süre girin.',
  submission_closed: 'Teslim penceresi kapandığı için ek süre değiştirilemez.',
  forbidden: 'Bu görevde ek süre tanımlama yetkiniz bulunmuyor.',
  not_found: 'Görev ya da kursiyer bulunamadı. Liste güncellendi.',
} as const satisfies CommandMessages

/** Bölümün durumu: süresiz görevde ve teslim penceresi kapanınca ek süre tanımlanmaz. */
export type ExtraTimeAvailability = 'open' | 'untimed' | 'closed'

export function extraTimeAvailability(
  task: { timeLimitMinutes: number | null; deadline: Deadline },
  now: Date | string | number,
): ExtraTimeAvailability {
  if (task.timeLimitMinutes === null) return 'untimed'
  return isClosed(task.deadline, new Date(now)) ? 'closed' : 'open'
}

/** Gerekçe kategorisinin Türkçe etiketi (yalnız personel görür). */
export const extraTimeReasonLabel = (reason: keyof typeof EXTRA_TIME_REASONS | null): string =>
  reason === null ? 'Kaldırıldı' : EXTRA_TIME_REASONS[reason].label

export const extraTimeMinutesLabel = (minutes: number): string => `${minutes} dk`

/** Ek süresi olmayan kursiyerler ("Ek süre ver" seçeneği). */
export const learnersWithoutExtraTime = (list: Pick<TaskExtraTimeList, 'learners'>) =>
  list.learners.filter((learner) => learner.current === null)

export const learnerExtraTimeName = (learner: Pick<TaskExtraTimeLearner, 'learnerName'>) =>
  learner.learnerName ?? 'Kursiyer'

export function listTaskExtraTimesRequest(
  client: KampusClient,
  assignmentId: string,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/task-assignments/{assignmentId}/extra-times', {
    params: { path: { assignmentId } },
    ...(signal === undefined ? {} : { signal }),
  })
}

export interface GrantTaskExtraTimeInput {
  assignmentId: string
  body: ExtraTimeGrantInput
}

export function grantTaskExtraTimeRequest(
  client: KampusClient,
  { assignmentId, body }: GrantTaskExtraTimeInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/task-assignments/{assignmentId}/extra-times', {
    params: {
      path: { assignmentId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
    body,
  })
}

/** Değiştirme ve kaldırma; `version` kursiyerin okunan ek süre sürümüdür (`If-Match`). */
export interface ChangeTaskExtraTimeInput {
  assignmentId: string
  learnerId: string
  version: number
  body: ExtraTime
}

export function changeTaskExtraTimeRequest(
  client: KampusClient,
  { assignmentId, learnerId, body }: ChangeTaskExtraTimeInput,
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/task-assignments/{assignmentId}/extra-times/{learnerId}', {
    params: {
      path: { assignmentId, learnerId },
      header: {
        'idempotency-key': headers['idempotency-key'],
        'if-match': requireIfMatch(headers),
      },
    },
    body,
  })
}

export type RemoveTaskExtraTimeInput = Omit<ChangeTaskExtraTimeInput, 'body'>

export function removeTaskExtraTimeRequest(
  client: KampusClient,
  { assignmentId, learnerId }: RemoveTaskExtraTimeInput,
  headers: CommandHeaders,
) {
  return client.DELETE('/api/v1/task-assignments/{assignmentId}/extra-times/{learnerId}', {
    params: {
      path: { assignmentId, learnerId },
      header: {
        'idempotency-key': headers['idempotency-key'],
        'if-match': requireIfMatch(headers),
      },
    },
  })
}
