import { isUnreadableCollectionError } from '@kampus/react-shared/collections.ts'
import { useCollectionsAll } from '@kampus/react-shared/use-collection.ts'
import type { CollectionName } from '@kampus/school-core/modules/collection-modules.ts'
import type { Session } from '@/auth/auth-port.ts'
import {
  buildWorkflowState,
  versionMap,
  workflowSources,
  type WorkflowModuleKey,
} from './workflow-state.ts'

/**
 * Modülün sunumu için koleksiyonları kapsamlı okur ve core `State` kurar.
 *
 * TODO(api-workflow-rows): satırlar birden çok koleksiyondan türetildiği için (etkinlikte veli
 * onayı, menüde "Bugün", kulüpte "Kayıtlı") koleksiyonlar bütünüyle okunur ve sayfalama
 * istemcidedir; sunucu tarafı sunum/sayfa ucu gelince bu kanca kalkar.
 *
 * TODO(perf): program yönetiminde yöneticide ~1440 ders kaydı bütünüyle okunur (sayfa sayfa
 * istek, istemci sayfalaması); sunucu sayfalı/tarih aralıklı uç gelince tarih penceresiyle okunur.
 *
 * Yardımcı koleksiyon okunamazsa (403/404: ön büro atamaları okuyamaz) boş sayılır; ana
 * koleksiyonun hatası sayfada gösterilir.
 */
export function useWorkflowState(module: WorkflowModuleKey, session: Session) {
  const sources = workflowSources(module, session.role)
  const results = useCollectionsAll(sources.map(({ collection }) => ({ collection })))

  const failed = results.find(
    (result, index) =>
      result.error && (sources[index]?.primary || !isUnreadableCollectionError(result.error)),
  )
  const pending = results.some((result) => result.isPending && !result.error)
  const fetching = results.some((result) => result.isFetching)

  // State her çizimde kurulur (dizi birleştirme, ucuz); satır hesabı sayfadadır. Sayfa yalnız
  // sorgu sonucu veya liste durumu değişince çizilir, form kendi bileşenindedir.
  const records: Partial<Record<CollectionName, unknown[]>> = {}
  const all: { id: string; version: number }[] = []
  sources.forEach(({ collection }, index) => {
    const rows = results[index]?.data ?? []
    records[collection] = rows.map((row) => row.record)
    for (const row of rows) all.push(row)
  })
  const state = buildWorkflowState(records, {
    modules: session.modules,
    academicYear: session.institution.academicYear,
  })
  const versions = versionMap(all)

  return {
    state,
    versions,
    pending,
    fetching,
    error: failed?.error ?? null,
    retry: () => {
      for (const result of results) if (result.error) void result.refetch()
    },
  }
}
