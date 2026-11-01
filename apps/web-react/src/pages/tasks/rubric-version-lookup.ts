import type {
  RubricDetail,
  RubricListItem,
  RubricVersion,
} from '@kampus/react-shared/use-rubrics.ts'

/** Rubrik listesinin bir sayfası ve sayfalama bilgisi (`GET /rubrics` yanıtının gerekli kısmı). */
export interface RubricListPage {
  data: readonly RubricListItem[]
  meta: { page: number; pageSize: number; total: number }
}

export interface RubricLookupSource {
  listPage: (page: number) => Promise<RubricListPage>
  detail: (rubricId: string) => Promise<Pick<RubricDetail, 'versions'>>
}

export const RUBRIC_LOOKUP_PAGE_SIZE = 100

/**
 * Arama yalnız atamanın sürüm kimliği biliniyorken yapılır: atama yüklenmedi ya da görev otomatik
 * puanlıysa (`null`) hiçbir rubrik isteği atılmaz, "yayımlanmamış rubrik" gibi sahte eşleşme olmaz.
 */
export const shouldLookUpRubric = (versionId: string | null, institutionId: string | null) =>
  versionId !== null && institutionId !== null

/**
 * Atamanın sabitlediği rubrik sürümünü bulur. Atama yanıtı yalnız sürüm kimliği taşır (rubrik
 * kimliği yok); bu yüzden listede baş ya da yayındaki sürümü eşleşen rubrik önce denenir, sonra
 * kalan rubrikler SIRAYLA taranır ve sürüm bulunur bulunmaz durulur. Eşzamanlı istek yoktur
 * (en çok bir ayrıntı çağrısı uçuşta); sayfalar bitene kadar devam edilir, böylece ilk 100'ün
 * dışındaki rubrikler de bulunur.
 * TODO(W22b-api-rubrik-kimligi): Atama yanıtına `rubricId` ya da `GET /rubric-versions/:id` gelince
 * tek çağrı yeter (API değişikliği; openQuestions).
 */
export async function findRubricVersion(
  versionId: string,
  source: RubricLookupSource,
): Promise<RubricVersion | null> {
  for (let page = 1; ; page += 1) {
    const result = await source.listPage(page)
    const matches = (item: RubricListItem) =>
      item.head.id === versionId || item.publishedVersionId === versionId
    const ordered = [...result.data.filter(matches), ...result.data.filter((i) => !matches(i))]
    for (const item of ordered) {
      const detail = await source.detail(item.rubric.id)
      const found = detail.versions.find((version) => version.id === versionId)
      if (found) return found
    }
    if (result.data.length === 0 || result.meta.page * result.meta.pageSize >= result.meta.total) {
      return null
    }
  }
}
