import type {
  LearningOutcomeListQuery,
  LearningOutcomeRow,
} from '@kampus/react-shared/use-learning-outcomes.ts'
import { outcomeKey, type OutcomeRef } from '@kampus/school-core/content/outcomes.ts'
import { OUTCOME_SOURCES } from '@kampus/school-core/content/taxonomy.ts'
import { subjects } from '@kampus/school-core/data/curriculum.ts'

/**
 * Kazanım seçicisinin saf modeli (OG-067; DOM-KYN-011): içerik ve soru formunda kazanım serbest
 * metin girilmez, katalogdan (`GET /learning-outcomes`) seçilir. Arşivli kod yeni seçimde listeye
 * gelmez (sunucu süzer); içerikte zaten bulunan arşivli kod `codes` sorgusuyla çözülür ve etiketle
 * gösterilir.
 */

/** Bir içeriğe bağlanabilecek en çok kazanım (core `resourceTagsSchema` sınırı). */
export const OUTCOMES_MAX = 20
export const OUTCOME_PICKER_PAGE_SIZE = 20

export const OUTCOME_COPY = {
  title: 'Kazanım seç',
  searchLabel: 'Kazanım ara',
  listLabel: 'Katalogdaki kazanımlar',
  empty: 'Bu süzgeçlerle katalogda kazanım yok.',
  alreadySelected: 'Zaten seçili',
  full: `En fazla ${OUTCOMES_MAX} kazanım bağlanabilir.`,
  archived: 'Arşivli',
  archivedNote: 'Arşivlenmiş kazanım: bu içerikte korunur, yeniden seçilemez.',
  missing: 'Katalogda bulunamadı',
  missingNote: 'Katalog öncesi girilmiş kod: bu içerikte korunur, silinirse yeniden seçilemez.',
  lookupError: 'Kazanım bilgisi yüklenemedi',
  lookupErrorNote: 'Kod bu içerikte korunur; adı ve arşiv durumu için yeniden deneyin.',
} as const

const SUBJECT_NAMES = new Map(subjects.map((subject) => [subject.id, subject.name]))

export const sourceLabel = (source: OutcomeRef['outcomeSource']) => OUTCOME_SOURCES[source].label

/** Satır künyesi: ders, sınıf düzeyi, kaynak (ör. "Matematik · 7. sınıf · Öğretim programı"). */
export function outcomeMeta(row: Pick<LearningOutcomeRow, 'subjectId' | 'gradeLevel' | 'source'>) {
  return [
    SUBJECT_NAMES.get(row.subjectId) ?? row.subjectId,
    `${String(row.gradeLevel)}. sınıf`,
    sourceLabel(row.source),
  ].join(' · ')
}

/** Seçici sorgusu: boş süzgeç gönderilmez; arama, ders ve düzey değişince sayfa başa döner. */
export function outcomePickerQuery(input: {
  q: string
  subject: string
  level: string
  page: number
}): LearningOutcomeListQuery {
  const q = input.q.trim()
  const level = Number(input.level)
  return {
    page: input.page,
    pageSize: OUTCOME_PICKER_PAGE_SIZE,
    ...(q === '' ? {} : { q }),
    ...(input.subject === '' ? {} : { subject: input.subject }),
    ...(input.level !== '' && Number.isInteger(level) ? { level } : {}),
  }
}

/** Formun ders ve ilk sınıf düzeyi seçicinin varsayılan süzgecidir (boşsa "Tümü"). */
export function outcomePickerDefaults(tags: {
  subjectId?: string | null | undefined
  gradeLevels?: readonly number[] | null | undefined
}) {
  const level = tags.gradeLevels?.[0]
  return { subject: tags.subjectId ?? '', level: level === undefined ? '' : String(level) }
}

export type OutcomePickerRow = {
  key: string
  ref: OutcomeRef
  code: string
  name: string
  meta: string
  /** Seçilemezse gerekçe ("Zaten seçili"); seçilebilirse `null`. */
  disabledReason: string | null
}

export const refOf = (row: Pick<LearningOutcomeRow, 'source' | 'code'>): OutcomeRef => ({
  outcomeSource: row.source,
  outcomeId: row.code,
})

export function outcomePickerRows(
  rows: readonly LearningOutcomeRow[],
  selected: readonly OutcomeRef[],
): OutcomePickerRow[] {
  const taken = new Set(selected.map(outcomeKey))
  return rows.map((row) => {
    const ref = refOf(row)
    const key = outcomeKey(ref)
    return {
      key,
      ref,
      code: row.code,
      name: row.name,
      meta: outcomeMeta(row),
      disabledReason: taken.has(key) ? OUTCOME_COPY.alreadySelected : null,
    }
  })
}

/** Seçilenler eklenince kaç yer kalır (en az 0). */
export const outcomeCapacity = (selected: readonly OutcomeRef[]) =>
  Math.max(0, OUTCOMES_MAX - selected.length)

/** Seçilenleri ekler: yinelenen düşer, sınırın üstü eklenmez. */
export function appendOutcomes(
  selected: readonly OutcomeRef[],
  picked: readonly OutcomeRef[],
): OutcomeRef[] {
  const taken = new Set(selected.map(outcomeKey))
  const fresh = picked.filter((ref) => {
    const key = outcomeKey(ref)
    if (taken.has(key)) return false
    taken.add(key)
    return true
  })
  return fresh.slice(0, outcomeCapacity(selected))
}

/**
 * İçerikteki kazanımların adını ve arşiv durumunu çözen sorgu; seçim yoksa `null`. Kodlar
 * içerikteki gibi birebir gider (sunucu da birebir arar; virgül ya da küçük harf içeren eski kod
 * bozulmaz) ve tekrarlı parametre olarak yazılır (`codes=A&codes=B`).
 */
export function selectedOutcomesQuery(
  selected: readonly OutcomeRef[],
): LearningOutcomeListQuery | null {
  const codes = [...new Set(selected.map((ref) => ref.outcomeId).filter((code) => code !== ''))]
  if (codes.length === 0) return null
  return { codes: codes.sort(), page: 1, pageSize: 100 }
}

export type SelectedOutcomeView = {
  code: string
  /** Katalog adı; çözülmediyse `null`. */
  name: string | null
  source: string
  state: 'active' | 'archived' | 'missing' | 'loading' | 'error'
}

/**
 * Seçili kazanımın görünümü: katalog yanıtı (`codes`) geldiyse ad ve arşiv durumu; yanıt yoksa
 * "loading" (sorgu hatasında "error"), katalogda yoksa "missing" (katalog öncesi serbest kod). Eşleme
 * kaynak + birebir koddur, sunucunun kaynak yazımı denetimiyle aynı.
 */
export function selectedOutcomeViews(
  selected: readonly OutcomeRef[],
  catalog: readonly LearningOutcomeRow[] | undefined,
  failed = false,
): SelectedOutcomeView[] {
  const byKey = new Map((catalog ?? []).map((row) => [outcomeKey(refOf(row)), row]))
  return selected.map((ref) => {
    const row = byKey.get(outcomeKey(ref))
    return {
      code: ref.outcomeId,
      name: row?.name ?? null,
      source: sourceLabel(ref.outcomeSource),
      state:
        row !== undefined
          ? row.archivedAt === null
            ? 'active'
            : 'archived'
          : catalog === undefined
            ? failed
              ? 'error'
              : 'loading'
            : 'missing',
    }
  })
}
