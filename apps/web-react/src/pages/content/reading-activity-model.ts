// Okuma etkinliği formunun saf modeli (OG-984; IST-042, DOM-BEC-006, DOM-KYN-013): quiz ve
// alıştırma setinin bağlı içerik seçicisi (okuma parçası, sorular), soru listesi işlemleri ve
// bağlı içerik hatalarının alan eşlemesi. Kural core `resourceContentSchema` ve
// `publicationIssues`'tadır; burada yalnız sunum ve liste işlemi vardır.
import {
  isLinkedIssueCode,
  isStaffItem,
  LINKED_CONTENT_MESSAGES,
  type PublicationIssueView,
  type ResourceListQuery,
  type StaffResourceListItem,
  type LearnerResourceListItem,
} from '@kampus/react-shared/resource-model.ts'
import { SUBSKILLS } from '@kampus/school-core/content/taxonomy.ts'

/** Core `itemList` sınırı: quiz/alıştırma seti en çok 200 soru taşır. */
export const ITEMS_MAX = 200
export const ITEM_POINTS = { min: 1, max: 100 } as const
export const PICKER_PAGE_SIZE = 10

/**
 * Bağlı içerik seçicisinin türleri. Seçici türden bağımsızdır: ileride dinleme kaydı gibi başka
 * bağlı kayıtlar aynı bileşenle seçilir (`LINKED_KINDS`'e satır eklenir).
 */
export const LINKED_KINDS = {
  reading_passage: {
    title: 'Okuma parçası seç',
    searchLabel: 'Okuma parçası ara',
    listLabel: 'Okuma parçaları',
    empty: 'Aramaya uyan okuma parçası yok.',
  },
  question: {
    title: 'Soru ekle',
    searchLabel: 'Soru ara',
    listLabel: 'Sorular',
    empty: 'Aramaya uyan soru yok.',
  },
} as const
export type LinkedKind = keyof typeof LINKED_KINDS

/** Seçilen bağlı içeriğin gösterim özeti; gövdeye yalnız `versionId` gider. */
export type LinkedSummary = {
  versionId: string
  resourceId: string
  title: string
  /** "A2 · 7. sınıf" gibi kısa künye; yoksa boş. */
  meta: string
  /** Sorunun alt becerisi (DOM-BEC-006); parçada ve etiketsiz soruda `null`. */
  subskill: string | null
}

export type PickerRow = LinkedSummary & {
  /** Seçilemezse nedeni (yayımlanmamış içerik, listede zaten var). */
  disabledReason: string | null
}

type Item = StaffResourceListItem | LearnerResourceListItem

export function linkedMeta(tags: StaffResourceListItem['version']['tags']): string {
  const parts: string[] = []
  if (tags.cefrLevel) parts.push(tags.cefrLevel)
  if (tags.gradeLevels.length > 0) parts.push(`${tags.gradeLevels.join(', ')}. sınıf`)
  return parts.join(' · ')
}

export const subskillLabel = (subskill: string | null | undefined): string | null =>
  subskill && Object.hasOwn(SUBSKILLS, subskill)
    ? SUBSKILLS[subskill as keyof typeof SUBSKILLS].label
    : null

/**
 * Liste satırından seçilebilir sürüm: kaynağın güncel yayındaki sürümü (`currentVersionId`). Baş
 * sürüm açık bir taslak olsa da etkinlik yayındaki sürüme bağlanır (DOM-BEC-006: parçanın yeni
 * sürümü etkinliği değiştirmez). Hiç yayımlanmamış kaynak seçilemez.
 */
export function pickerRow(item: StaffResourceListItem, selected: ReadonlySet<string>): PickerRow {
  const versionId = item.currentVersionId ?? ''
  return {
    versionId,
    resourceId: item.id,
    title: item.version.title,
    meta: linkedMeta(item.version.tags),
    subskill: subskillLabel(item.version.tags.subskill),
    disabledReason:
      item.currentVersionId === null
        ? 'Yayında değil'
        : selected.has(item.currentVersionId)
          ? 'Zaten seçili'
          : null,
  }
}

export const pickerRows = (items: readonly Item[], selected: ReadonlySet<string>): PickerRow[] =>
  items.filter(isStaffItem).map((item) => pickerRow(item, selected))

/**
 * Seçicinin liste sorgusu: tür sabit, başlığa göre sıralı, kısa sayfa. Kısa arama (<2) gönderilmez;
 * dil okulunda CEFR, okulda sınıf düzeyi süzgeci kullanılır.
 */
export function pickerQuery(input: {
  kind: LinkedKind
  q: string
  cefrLevel: string
  gradeLevel: string
  page: number
}): ResourceListQuery {
  const q = input.q.trim()
  const grade = Number(input.gradeLevel)
  return {
    page: input.page,
    pageSize: PICKER_PAGE_SIZE,
    contentType: input.kind,
    sort: 'title',
    ...(q.length >= 2 ? { q } : {}),
    ...(input.cefrLevel !== ''
      ? { cefrLevel: input.cefrLevel as ResourceListQuery['cefrLevel'] }
      : {}),
    ...(Number.isInteger(grade) && grade > 0 ? { gradeLevel: grade } : {}),
  }
}

/**
 * Düzenlemede kayıtlı kimliklerin özetleri: liste satırının hem yayındaki hem baş sürümü eşlenir.
 * Listede bulunmayan (eski sürüme bağlı) kimlik eşlenmez; ekran genel bir adla gösterir.
 */
export function summariesFrom(items: readonly Item[]): Map<string, LinkedSummary> {
  const map = new Map<string, LinkedSummary>()
  for (const item of items.filter(isStaffItem)) {
    const summary = {
      resourceId: item.id,
      title: item.version.title,
      meta: linkedMeta(item.version.tags),
      subskill: subskillLabel(item.version.tags.subskill),
    }
    if (item.currentVersionId)
      map.set(item.currentVersionId, { ...summary, versionId: item.currentVersionId })
    if (!map.has(item.version.id))
      map.set(item.version.id, { ...summary, versionId: item.version.id })
  }
  return map
}

export type SetItem = { questionVersionId: string; points: number }

/**
 * Seçilen soruları listenin sonuna ekler: listede olan atlanır, sınırı aşan eklenmez. `added`
 * gerçekten eklenen sayıdır (bildirim için).
 */
export function appendItems(
  items: readonly SetItem[],
  versionIds: readonly string[],
): { items: SetItem[]; added: number; overflow: number } {
  const present = new Set(items.map((item) => item.questionVersionId))
  const fresh = [...new Set(versionIds)].filter((id) => id !== '' && !present.has(id))
  const room = Math.max(0, ITEMS_MAX - items.length)
  const accepted = fresh.slice(0, room)
  return {
    items: [...items, ...accepted.map((questionVersionId) => ({ questionVersionId, points: 1 }))],
    added: accepted.length,
    overflow: fresh.length - accepted.length,
  }
}

/** Sıra değiştirme düğmesinin hedefi; sınır dışıysa `null` (düğme kapalı). */
export function moveTarget(index: number, delta: -1 | 1, count: number): number | null {
  const target = index + delta
  return target < 0 || target >= count ? null : target
}

/** Soru satırının puan alanı kimliği; etiket, hata ve odak aynı kimliği kullanır. */
export const itemPointsId = (index: number) => `icerik-soru-puan-${index}`

/** Kod → Türkçe alan iletisi: bağlı içerik kodu ortak iletiyi, diğerleri sunucunun iletisini alır. */
export function linkedFieldMessage(code: string, message: string): string {
  return isLinkedIssueCode(code) ? LINKED_CONTENT_MESSAGES[code] : message
}

export type LinkedHints = {
  /** Kayıtlı parça sürümünün sorunu (kimliğiyle; parça değişince uyarı kalkar). */
  passage: { versionId: string; message: string } | null
  /** Soru sürümü → ileti; sıra değişse de uyarı aynı soruda kalır. */
  items: ReadonlyMap<string, string>
}

/**
 * Sunucunun yayım sorunlarından (`publicationIssues`) bağlı içerik uyarıları: parça alanına ve
 * soru satırına yazılır. Sorunlar kayıtlı sürümündür (`saved`: kayıtlı parça ve soru sırası); yol
 * sırası kayıtlı sürüme göre kimliğe çevrilir, formda çıkarılan ya da değiştirilen içeriğin uyarısı
 * kendiliğinden kalkar.
 */
export function linkedHints(
  issues: readonly PublicationIssueView[],
  saved: { passageVersionId: string | null; itemIds: readonly string[] },
): LinkedHints {
  let passage: LinkedHints['passage'] = null
  const items = new Map<string, string>()
  for (const issue of issues) {
    if (!isLinkedIssueCode(issue.code) || issue.path[0] !== 'content') continue
    const message = LINKED_CONTENT_MESSAGES[issue.code]
    if (issue.path[1] === 'passageVersionId' && saved.passageVersionId !== null)
      passage ??= { versionId: saved.passageVersionId, message }
    else if (issue.path[1] === 'items') {
      const id = saved.itemIds[Number(issue.path[2])]
      if (id !== undefined && !items.has(id)) items.set(id, message)
    }
  }
  return { passage, items }
}
