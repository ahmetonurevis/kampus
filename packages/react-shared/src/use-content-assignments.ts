import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'

import type { CommandHeaders, CommandMessages } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import {
  TASK_ASSIGNMENT_INVALIDATES,
  TASK_ASSIGNMENT_MESSAGES,
  TASK_ASSIGNMENTS_KEY,
} from './use-task-assignments.ts'

/**
 * İçerikten toplu atama ve içeriğe bağlı sonuç özeti kancaları (OG-089; IST-034, DOM-BEC-049,
 * DOM-BEC-036). Toplu atama `POST /task-assignments/batches` ile tek istekte, her hedef grubu kendi
 * son tarihiyle ayrı atama açar; bir öğe reddedilirse hiçbiri açılmaz ve hata `items.<sıra>.…`
 * yoluyla döner. Özet `GET /resources/:resourceId/assignment-results` atamalar önbelleğinin altında
 * tutulur: atama yazmaları (`TASK_ASSIGNMENT_INVALIDATES`) özeti de tazeler.
 */

export type TaskAssignmentBatchBody = NonNullable<
  operations['createTaskAssignmentBatch']['requestBody']
>['content']['application/json']
export type ContentAssignmentResults = components['schemas']['ContentAssignmentResults']
export type ContentResultTally = components['schemas']['ContentResultTally']

/** Toplu atamanın metinleri: tek atamanınkiler ve aynı işlemdeki çakışma. */
export const TASK_ASSIGNMENT_BATCH_MESSAGES = {
  ...TASK_ASSIGNMENT_MESSAGES,
  assignment_overlap:
    'Seçilen hedeflerdeki bazı öğrenciler bu içeriği açık bir atamada zaten alıyor; hedefleri değiştirin.',
  assignment_duplicate: 'Bu içerik aynı son tarihle bu hedefe zaten atanmış.',
} as const satisfies CommandMessages

/** Oluşturma `If-Match` kabul etmez; `Idempotency-Key` zorunludur. */
export function createTaskAssignmentBatchRequest(
  client: KampusClient,
  body: TaskAssignmentBatchBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/task-assignments/batches', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

export const createTaskAssignmentBatchCommand = {
  request: createTaskAssignmentBatchRequest,
  invalidates: TASK_ASSIGNMENT_INVALIDATES,
  messages: TASK_ASSIGNMENT_BATCH_MESSAGES,
  exclusive: true,
} as const

/** İçeriği birden çok hedefe ayrı son tarihle atar (201; `data` gövde sırasıyla atamalar). */
export function useCreateTaskAssignmentBatch() {
  return useApiCommand(createTaskAssignmentBatchCommand)
}

/** Bütün içeriklerin özetlerinin ortak öneki; puanlama ve teslim komutları bunu tazeler. */
export const CONTENT_RESULTS_PREFIX = [TASK_ASSIGNMENTS_KEY, 'content-results'] as const

/** Özetin sorgu anahtarı; atamalar anahtarının altındadır. */
export const contentResultsKey = (resourceId: string) =>
  [...CONTENT_RESULTS_PREFIX, resourceId] as const

export function fetchContentAssignmentResults(
  client: KampusClient,
  resourceId: string,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/resources/{resourceId}/assignment-results', {
    params: { path: { resourceId } },
    ...(signal ? { signal } : {}),
  })
}

/** İçeriğe bağlı sonuç özeti (yalnız personel); `enabled` yanlışken istek atılmaz. */
export function useContentAssignmentResults(resourceId: string, enabled = true) {
  return useApiQuery({
    key: contentResultsKey(resourceId),
    request: (client, signal) => fetchContentAssignmentResults(client, resourceId, signal),
    enabled: enabled && resourceId !== '',
  })
}
