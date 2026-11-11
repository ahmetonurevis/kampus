import {
  changeTaskExtraTimeRequest,
  grantTaskExtraTimeRequest,
  listTaskExtraTimesRequest,
  removeTaskExtraTimeRequest,
  TASK_EXTRA_TIME_INVALIDATES,
  TASK_EXTRA_TIME_MESSAGES,
  taskExtraTimesKey,
  type ChangeTaskExtraTimeInput,
  type GrantTaskExtraTimeInput,
  type RemoveTaskExtraTimeInput,
} from './task-extra-times.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * Bireysel ek süre kancaları (DOM-BEC-043, OG-248): atamanın kursiyer listesi (güncel ek süre,
 * sürüm, gerekçeli geçmiş) ve verme, değiştirme, kaldırma komutları. Yetki ve kural sunucudadır
 * (yönetici ve atayan öğretmen; yalnız süreli görevde, pencere açıkken); burada çağrı, `If-Match`
 * (okunan sürüm yoksa istek atılmaz), önbellek tazeleme ve Türkçe hata metni vardır. Liste yalnız
 * personeldir; öğrenci ve veli 403 alır, bu yüzden çağıran `enabled` ile kapatır.
 */

export function useTaskExtraTimes(assignmentId: string, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: taskExtraTimesKey(assignmentId),
    request: (client, signal) => listTaskExtraTimesRequest(client, assignmentId, signal),
    enabled: assignmentId !== '' && (options.enabled ?? true),
  })
}

/** Ortak ayar: yollu `issues` alana gider, çakışma tek toast (çift tıklamada yersiz 409 yok). */
const base = {
  invalidates: TASK_EXTRA_TIME_INVALIDATES,
  messages: TASK_EXTRA_TIME_MESSAGES,
  exclusive: true,
} as const

export function useGrantTaskExtraTime() {
  return useApiCommand({
    ...base,
    request: (client, input: GrantTaskExtraTimeInput, headers) =>
      grantTaskExtraTimeRequest(client, input, headers),
  })
}

export function useChangeTaskExtraTime() {
  return useApiCommand({
    ...base,
    request: (client, input: ChangeTaskExtraTimeInput, headers) =>
      changeTaskExtraTimeRequest(client, input, headers),
    version: (input) => input.version,
  })
}

export function useRemoveTaskExtraTime() {
  return useApiCommand({
    ...base,
    request: (client, input: RemoveTaskExtraTimeInput, headers) =>
      removeTaskExtraTimeRequest(client, input, headers),
    version: (input) => input.version,
  })
}
