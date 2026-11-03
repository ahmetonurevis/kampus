// Okuma ve dinleme etkinliği formunun saf modeli (OG-984, OG-052; IST-042, IST-045, DOM-BEC-005,
// DOM-BEC-006, DOM-KYN-013): quiz ve alıştırma setinin bağlı içerik seçicisi (okuma parçası, dinleme
// kaydı, sorular), soru listesi işlemleri ve bağlı içerik hatalarının alan eşlemesi. Kural core `resourceContentSchema` ve
// `publicationIssues`'tadır; burada yalnız sunum ve liste işlemi vardır.
import {
  isLinkedIssueCode,
  isStaffItem,
  LINKED_CONTENT_MESSAGES,
  type PublicationIssueView,
  type ResourceListQuery,
  type StaffResourceListItem,
  type StaffResourceVersion,
  type LearnerResourceListItem,
} from '@kampus/react-shared/resource-model.ts'
import { SUBSKILLS } from '@kampus/school-core/content/taxonomy.ts'

/** Core `itemList` sınırı: quiz/alıştırma seti en çok 200 soru taşır. */
export const ITEMS_MAX = 200
export const ITEM_POINTS = { min: 1, max: 100 } as const
export const PICKER_PAGE_SIZE = 10

/**
 * Bağlı içerik seçicisinin türleri (anahtar içerik türüdür). Seçici türden bağımsızdır: yeni bağlı
 * kayıt türü `LINKED_KINDS`'e satır eklenerek aynı bileşenle seçilir. `primarySkill` verilirse liste
 * o birincil beceriyle süzülür (dinleme kaydı: dinleme becerili ses, DOM-BEC-005).
 */
export const LINKED_KINDS = {
  reading_passage: {
    title: 'Okuma parçası seç',
    searchLabel: 'Okuma parçası ara',
    listLabel: 'Okuma parçaları',
    empty: 'Aramaya uyan okuma parçası yok.',
  },
  audio: {
    title: 'Dinleme kaydı seç',
    searchLabel: 'Dinleme kaydı ara',
    listLabel: 'Dinleme kayıtları',
    empty: 'Aramaya uyan dinleme kaydı yok.',
    primarySkill: 'listening',
  },
  question: {
    title: 'Soru ekle',
    searchLabel: 'Soru ara',
    listLabel: 'Sorular',
    empty: 'Aramaya uyan soru yok.',
  },
} as const
export type LinkedKind = keyof typeof LINKED_KINDS

const kindSkill = (kind: LinkedKind): 'listening' | null => {
  const entry = LINKED_KINDS[kind]
  return 'primarySkill' in entry ? entry.primarySkill : null
}

/** Seçilen bağlı içeriğin gösterim özeti; gövdeye yalnız `versionId` gider. */
export type LinkedSummary = {
  versionId: string
  resourceId: string
  title: string
  /** "A2 · 7. sınıf" gibi kısa künye; yoksa boş. */
  meta: string
  /** Sorunun alt becerisi (DOM-BEC-006); parçada, etiketsiz soruda ve bilinmeyince `null`. */
  subskill: string | null
  /**
   * Künye ve alt beceri bağlanan sürümü anlatmıyorsa nedeni: liste satırı kaynağın baş sürümünü
   * taşır; baş sürüm yeni bir taslaksa bağlanan yayındaki sürümün etiketleri yanıtta yoktur.
   */
  note: string | null
}

/** Baş sürüm yayındaki sürümden yeniyken künyenin yerine gösterilen not (DOM-BEC-006). */
export const PUBLISHED_VERSION_NOTE =
  'Yeni sürümü hazırlanıyor; yayındaki sürüm bağlanır, etiketleri burada gösterilmez.'

/** Kayıtlı bağın özeti bulunamadığında tarafsız metin: sürüm eski olabilir ya da listede yok. */
export const LINKED_DETAIL_UNKNOWN = {
  reading_passage: 'Bağlı parçanın ayrıntısı yüklenemedi.',
  audio: 'Bağlı dinleme kaydının ayrıntısı yüklenemedi.',
  question: 'Sorunun ayrıntısı yüklenemedi.',
} as const satisfies Record<LinkedKind, string>
export const LINKED_DETAIL_LOADING = 'Ayrıntı yükleniyor…'

/**
 * Seçicide zaten seçili olanlar: sürüm kimlikleri ve (soru listesinde) kaynak kimlikleri. Aynı
 * sorunun başka sürümü listedeyse güncel sürümü ikinci kez eklenemez; parça ise değiştirilir,
 * yalnız aynı sürüm kapalıdır.
 */
export type PickerSelection = {
  versionIds: ReadonlySet<string>
  resourceIds: ReadonlySet<string>
}

export type PickerRow = LinkedSummary & {
  /** Seçilemezse nedeni (yayımlanmamış içerik, listede zaten var). */
  disabledReason: string | null
}

type Item = StaffResourceListItem | LearnerResourceListItem

/**
 * Satırın yayındaki sürümünün gösterim alanları. Liste satırı baş sürümü taşır; baş sürüm yayındaki
 * sürümse etiketler doğrudan okunur, değilse (yeni taslak) künye ve alt beceri gösterilmez, not
 * düşülür. Başlık kaynağı tanıtmak için baş sürümden kalır.
 */
function publishedView(
  item: StaffResourceListItem,
): Pick<LinkedSummary, 'meta' | 'subskill' | 'note'> {
  const differs = item.currentVersionId !== null && item.currentVersionId !== item.version.id
  return differs ? { meta: '', subskill: null, note: PUBLISHED_VERSION_NOTE } : headView(item)
}

function headView(item: StaffResourceListItem): Pick<LinkedSummary, 'meta' | 'subskill' | 'note'> {
  return {
    meta: linkedMeta(item.version.tags),
    subskill: subskillLabel(item.version.tags.subskill),
    note: null,
  }
}

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
export function pickerRow(item: StaffResourceListItem, selected: PickerSelection): PickerRow {
  const versionId = item.currentVersionId ?? ''
  return {
    versionId,
    resourceId: item.id,
    title: item.version.title,
    ...publishedView(item),
    disabledReason:
      item.currentVersionId === null
        ? 'Yayında değil'
        : selected.versionIds.has(item.currentVersionId) || selected.resourceIds.has(item.id)
          ? 'Zaten seçili'
          : null,
  }
}

export const pickerRows = (items: readonly Item[], selected: PickerSelection): PickerRow[] =>
  items.filter(isStaffItem).map((item) => pickerRow(item, selected))

/**
 * Seçicinin liste sorgusu: tür sabit, başlığa göre sıralı, kısa sayfa. Kısa arama (<2) gönderilmez;
 * dil okulunda CEFR, okulda sınıf düzeyi süzgeci kullanılır. Dinleme kaydında birincil beceri
 * dinlemedir (DOM-BEC-005); dökümü listede görünmez, seçilen kaydın sürümünden okunur.
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
  const primarySkill = kindSkill(input.kind)
  return {
    page: input.page,
    pageSize: PICKER_PAGE_SIZE,
    contentType: input.kind,
    sort: 'title',
    ...(primarySkill ? { primarySkill } : {}),
    ...(q.length >= 2 ? { q } : {}),
    ...(input.cefrLevel !== ''
      ? { cefrLevel: input.cefrLevel as ResourceListQuery['cefrLevel'] }
      : {}),
    ...(Number.isInteger(grade) && grade > 0 ? { gradeLevel: grade } : {}),
  }
}

/**
 * Düzenlemede kayıtlı kimliklerin özetleri: liste satırının hem yayındaki hem baş sürümü eşlenir;
 * yayındaki sürümün etiketleri baş sürüm aynıysa okunur (`publishedView`). Listede bulunmayan
 * kimlik (eski sürüm ya da ilk sayfanın dışında kalan kaynak) eşlenmez; ekran tarafsız metin
 * gösterir (`LINKED_DETAIL_UNKNOWN`).
 */
export function summariesFrom(items: readonly Item[]): Map<string, LinkedSummary> {
  const map = new Map<string, LinkedSummary>()
  for (const item of items.filter(isStaffItem)) {
    const base = { resourceId: item.id, title: item.version.title }
    if (item.currentVersionId)
      map.set(item.currentVersionId, {
        ...base,
        ...publishedView(item),
        versionId: item.currentVersionId,
      })
    if (!map.has(item.version.id))
      map.set(item.version.id, { ...base, ...headView(item), versionId: item.version.id })
  }
  return map
}

/**
 * Soru listesinin seçici seçimi: listedeki sürümler ve özeti bilinen soruların kaynakları. Özeti
 * bilinmeyen (eski sürüm, listede yok) sorunun kaynağı da bilinmez; o kaynak seçicide açık kalır.
 */
export function questionSelection(
  itemIds: readonly string[],
  summaryOf: (versionId: string) => LinkedSummary | undefined,
): PickerSelection {
  const resourceIds = new Set<string>()
  for (const id of itemIds) {
    const resourceId = summaryOf(id)?.resourceId
    if (resourceId) resourceIds.add(resourceId)
  }
  return { versionIds: new Set(itemIds), resourceIds }
}

/** Sınırı aşan soru seçiminin Türkçe uyarısı (DOM-KYN-013: en çok 200 soru); taşma yoksa `null`. */
export function overflowMessage(overflow: number): string | null {
  return overflow > 0
    ? `${overflow} soru eklenmedi: bir sette en çok ${ITEMS_MAX} soru olabilir.`
    : null
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

type SavedHint = { versionId: string; message: string }

export type LinkedHints = {
  /** Kayıtlı parça sürümünün sorunu (kimliğiyle; parça değişince uyarı kalkar). */
  passage: SavedHint | null
  /** Kayıtlı dinleme kaydı sürümünün sorunu (IST-045; kayıt değişince uyarı kalkar). */
  listening: SavedHint | null
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
  saved: {
    passageVersionId: string | null
    listeningVersionId?: string | null
    itemIds: readonly string[]
  },
): LinkedHints {
  let passage: LinkedHints['passage'] = null
  let listening: LinkedHints['listening'] = null
  const listeningVersionId = saved.listeningVersionId ?? null
  const items = new Map<string, string>()
  for (const issue of issues) {
    if (!isLinkedIssueCode(issue.code) || issue.path[0] !== 'content') continue
    const message = LINKED_CONTENT_MESSAGES[issue.code]
    if (issue.path[1] === 'passageVersionId' && saved.passageVersionId !== null)
      passage ??= { versionId: saved.passageVersionId, message }
    else if (issue.path[1] === 'listeningVersionId' && listeningVersionId !== null)
      listening ??= { versionId: listeningVersionId, message }
    else if (issue.path[1] === 'items') {
      const id = saved.itemIds[Number(issue.path[2])]
      if (id !== undefined && !items.has(id)) items.set(id, message)
    }
  }
  return { passage, listening, items }
}

/** Seçili dinleme kaydının künyesi: bağlanan sürümden okunur (başlık, CEFR, döküm var/yok). */
export type RecordingFacts = {
  title: string
  /** "A2 · 9. sınıf" gibi künye; yoksa boş. */
  meta: string
  /** Sürümün dökümü var mı; ses sürümü değilse ya da içerik kaldırıldıysa `null`. */
  hasTranscript: boolean | null
}

/**
 * Bağlanan ses sürümünün künyesi (IST-045, DOM-BEC-005). Döküm koşulu sunucuyla aynıdır
 * (`hasTranscript`: ses içeriğinde `transcript` dolu); yalnız altyazı döküm sayılmaz.
 */
export function recordingFacts(version: StaffResourceVersion): RecordingFacts {
  const content = version.content
  return {
    title: version.title,
    meta: linkedMeta(version.tags),
    hasTranscript:
      content !== null && content.type === 'audio'
        ? typeof content.transcript === 'string' && content.transcript !== ''
        : null,
  }
}

export const TRANSCRIPT_LABEL = { yes: 'Döküm var', no: 'Döküm yok' } as const

/** Künye satırı: CEFR/sınıf ve döküm durumu ("A2 · Döküm var"). */
export function recordingLine(facts: RecordingFacts): string {
  const transcript =
    facts.hasTranscript === null
      ? null
      : facts.hasTranscript
        ? TRANSCRIPT_LABEL.yes
        : TRANSCRIPT_LABEL.no
  return [facts.meta, transcript].filter(Boolean).join(' · ') || 'Etiket yok'
}

/**
 * Seçili kaydın formda görünen hatası (DOM-BEC-005: transkript olmadan görev yayımlanmaz): dökümsüz
 * kayıt seçilince sunucuyla aynı Türkçe ileti hemen alanın altına yazılır. Taslak yine kaydedilir;
 * onaya gönderimi sunucu aynı kodla (`listening_transcript_required`) reddeder.
 */
export const recordingIssue = (facts: RecordingFacts | null): string | null =>
  facts?.hasTranscript === false ? LINKED_CONTENT_MESSAGES.listening_transcript_required : null
