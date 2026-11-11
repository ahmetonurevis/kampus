// Aday/CRM ekranlarının saf hesapları: satırlar, aşama rozeti, süzgeç seçenekleri ve Tanışma
// Görüşmeleri olayları. Kural core'dadır (`lib/prospects.ts`, DOM-KAY-005, -030…034); burada
// yalnız arayüzün hangi seçeneği göstereceği türetilir. Karar yine sunucudadır.
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  OPEN_PROSPECT_STAGES,
  PROSPECT_SOURCES,
  PROSPECT_STAGES,
  prospectStageLabel,
  type ProspectStage,
} from '@kampus/school-core/lib/prospects.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import {
  dateTimeLabel,
  MEETING_KIND_LABELS,
  prospectContactOwner,
  type ContactOwner,
  type MeetingEvent,
} from '@kampus/react-shared/prospect-model.ts'
import type {
  CollectionCounts,
  CollectionFilters,
  CollectionQuery,
} from '@kampus/react-shared/collections.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import type { CoreRow } from '@/hooks/use-core-collection.ts'
import type { FilterField, FilterValue } from '@/lib/list-query.ts'
import { addDays, isDayKey, weekDays, weekStart } from '../academic/academic-rows.ts'

// Web ile mobilde ortak saf hesaplar (`@kampus/react-shared/prospect-model.ts`); web içe aktarımları
// bu dosyadan sürer.
export {
  CONTACT_LABELS,
  dateTimeLabel,
  isOpenStage,
  lostReasonLabel,
  MEETING_KIND_LABELS,
  meetingEvents,
  prospectContactOwner,
  slotLabel,
  stageTargets,
  type ContactOwner,
  type MeetingEvent,
  type MeetingKind,
} from '@kampus/react-shared/prospect-model.ts'

type Lookups = { branches: ReadonlyMap<string, string> }

/** Aşama rozeti tonu: `Kayıt oldu` yeşil, `Vazgeçti` kırmızı, `Teklif verildi` sarı. */
export const STAGE_TONES = {
  'Yeni aday': 'purple',
  'İletişime geçildi': 'purple',
  'Görüşme planlandı': 'purple',
  'Teklif verildi': 'amber',
  'Kayıt oldu': 'green',
  Vazgeçti: 'red',
} as const satisfies Record<ProspectStage, BadgeTone>

export function stageTone(stage: string): BadgeTone {
  const known = PROSPECT_STAGES.find((item) => item === stage)
  return known ? STAGE_TONES[known] : 'gray'
}

/** Aşama süzgeci: sabit seçenekler, dil okulunda görüşme aşaması seviye tespiti/deneme dersidir. */
export function stageFilter(type: InstitutionType): FilterField {
  return {
    key: 'stage',
    label: 'Aşama',
    options: PROSPECT_STAGES.map((stage) => ({
      value: stage,
      label: prospectStageLabel(stage, type),
    })),
  }
}

export const SOURCE_FILTER: FilterField = {
  key: 'source',
  label: 'Kaynak',
  options: PROSPECT_SOURCES.map((source) => ({ value: source, label: source })),
}

/** Kayıt tarihi aralığı (Vue "Kayıt tarihi" süzgeci); sunucuda `dateField=createdAt` ile süzülür. */
export const CREATED_FILTER: FilterField = { key: 'createdAt', label: 'Kayıt tarihi', type: 'date' }

/** Aday listesinde gün aralığıyla süzülebilen tarih alanları (API `DATE_FIELDS.prospects`). */
export type ProspectDateField = 'createdAt' | 'trialAt' | 'trialLesson.date'

/**
 * Liste sorgusuna bir tarih alanının gün aralığını ekler (`dateField`, `dateFrom`/`dateTo`;
 * Europe/Istanbul günü, uçlar dahil). Alan sunucunun izin listesindedir (`ProspectDateField`).
 * Tek uç açık aralıktır; biçimsiz uç ve bitişi başlangıçtan önce
 * olan aralık gönderilmez (hata süzgeç alanının altında görünür, sunucu 400 vermez).
 */
export function withDayRange<Q extends Pick<CollectionQuery, 'filters'>>(
  query: Q,
  value: FilterValue,
  field: ProspectDateField,
): Q {
  if (typeof value !== 'object' || value === null) return query
  const from = isDayKey(value.min) ? value.min : ''
  const to = isDayKey(value.max) ? value.max : ''
  if (!from && !to) return query
  if (from && to && to < from) return query
  const range: CollectionFilters = {
    dateField: field,
    ...(from ? { dateFrom: from } : {}),
    ...(to ? { dateTo: to } : {}),
  }
  return { ...query, filters: { ...query.filters, ...range } }
}

/** Kayıt tarihi aralığı (Vue "Kayıt tarihi" süzgeci): `withDayRange` alanı `createdAt`. */
export const withCreatedRange = <Q extends Pick<CollectionQuery, 'filters'>>(
  query: Q,
  value: FilterValue,
): Q => withDayRange(query, value, 'createdAt')

export const ALL_STAGES = 'all'

export type StageTab = { value: string; label: string; count?: number }

/**
 * Aşama sekmeleri (Vue `LineTabs` "Aday aşaması"): "Tüm adaylar" ve her aşama, sayısıyla. Sayılar
 * kurum genelidir (`counts?groupBy=stage`, öteki süzgeçlerden bağımsız; Vue'daki gibi); sayım
 * gelmeden sayı rozeti çizilmez. Kayıtta olmayan aşama sıfır sayılır.
 */
export function stageTabs(counts: CollectionCounts | undefined, type: InstitutionType): StageTab[] {
  const countOf = (stage: string) =>
    counts?.groups.find((group) => group.value === stage)?.count ?? 0
  return [
    { value: ALL_STAGES, label: 'Tüm adaylar', ...(counts ? { count: counts.total } : {}) },
    ...PROSPECT_STAGES.map((stage) => ({
      value: stage,
      label: prospectStageLabel(stage, type),
      ...(counts ? { count: countOf(stage) } : {}),
    })),
  ]
}

export type ProspectRow = {
  id: string
  name: string
  phone: string
  /** Telefonun sahibi: 18 yaş altında veli (DOM-KAY-003). */
  phoneOwner: ContactOwner
  interest: string
  branch: string
  source: string
  stage: string
  stageLabel: string
  createdAt: string
  createdLabel: string
  meetingLabel: string
}

export function prospectRow(
  item: CoreRow<'prospects'>,
  type: InstitutionType,
  lookups: Lookups,
): ProspectRow {
  const { record } = item
  return {
    id: record.id,
    name: record.name,
    phone: record.phone,
    phoneOwner: prospectContactOwner(record),
    interest: record.interest,
    branch: item.joined?.branchName ?? lookups.branches.get(record.branchId) ?? '—',
    source: record.source ?? '',
    stage: record.stage ?? '',
    stageLabel: prospectStageLabel(record.stage, type),
    createdAt: record.createdAt,
    createdLabel: dateLabel(record.createdAt, { year: 'numeric' }),
    meetingLabel: record.trialAt ? dateTimeLabel(record.trialAt) : '—',
  }
}

/** CSV satırı: tablonun gösterdiği alanlar. */
export const prospectCsvRow = (row: ProspectRow) => ({
  name: row.name,
  phone: row.phone,
  interest: row.interest,
  branch: row.branch,
  source: row.source,
  stage: row.stageLabel,
  createdLabel: row.createdLabel,
})

// --- Tanışma Görüşmeleri ------------------------------------------------------------------

export const MEETING_KIND_FILTER: FilterField = {
  key: 'kindLabel',
  label: 'Tür',
  options: Object.values(MEETING_KIND_LABELS).map((label) => ({ value: label, label })),
}
export const MEETING_DAY_FILTER: FilterField = {
  key: 'day',
  label: 'Görüşme günü',
  type: 'date',
}

export const MEETING_VIEWS = [
  { value: 'liste', label: 'Liste' },
  { value: 'hafta', label: 'Haftalık takvim' },
  { value: 'nobet', label: 'Sezon nöbeti' },
] as const
export type MeetingView = (typeof MEETING_VIEWS)[number]['value']

/** Adresteki görünüm (`?gorunum=`); bilinmeyen değer listedir. `nobet` kayıt sezonu nöbetidir (DOM-KAY-037). */
export const meetingView = (value: string | null): MeetingView =>
  MEETING_VIEWS.find((view) => view.value === value)?.value ?? 'liste'

/** Adresteki hafta (`?hafta=`) ya da bugünün haftası; her gün kendi haftasının pazartesisine iner. */
export const meetingWeekStart = (value: string | null, today: string): string =>
  weekStart(isDayKey(value) ? value : today)

export type MeetingDay = {
  day: string
  /** Gün adıyla gün başlığı (Europe/Istanbul). */
  label: string
  today: boolean
  events: MeetingEvent[]
}

/**
 * Haftalık takvim (Vue `WeekCalendar`): pazartesiden pazara yedi gün, her gün o günün
 * (Europe/Istanbul) görüşme ve deneme dersleri saat sırasıyla. Olaylar `meetingEvents`'ten gelir;
 * kapalı adayın olayı orada zaten düşmüştür.
 */
export function meetingWeek(
  events: readonly MeetingEvent[],
  start: string,
  today: string,
): MeetingDay[] {
  return weekDays(start).map((day) => ({
    day,
    label: dateLabel(`${day}T12:00:00.000Z`, { weekday: 'long' }),
    today: day === today,
    events: events
      .filter((event) => event.day === day)
      .toSorted((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
  }))
}

/** Hafta başlığı: "19 Eki – 25 Eki 2026". */
export const meetingWeekTitle = (start: string) =>
  `${dateLabel(`${start}T12:00:00.000Z`)} – ${dateLabel(`${addDays(start, 6)}T12:00:00.000Z`, { year: 'numeric' })}`

/**
 * Haftalık görüşme takviminin sunucu sorguları (ON-111): açık adaylardan tanışma görüşmesi
 * (`trialAt`) ve dil okulunda deneme dersi (`trialLesson.date`) haftanın günlerine düşenler. Sunucu
 * bir sorguda tek tarih alanı süzer; iki sorgunun adayları `mergeProspectPages` ile birleşir.
 */
export function meetingWeekQueries(
  start: string,
  type: InstitutionType,
): { field: ProspectDateField; query: { filters: CollectionFilters } }[] {
  const fields: ProspectDateField[] =
    type === 'language_school' ? ['trialAt', 'trialLesson.date'] : ['trialAt']
  return fields.map((field) => ({
    field,
    query: {
      filters: {
        stage: [...OPEN_PROSPECT_STAGES],
        dateField: field,
        dateFrom: start,
        dateTo: addDays(start, 6),
      },
    },
  }))
}

/** Aynı aday iki sorguda da gelirse (görüşmesi ve deneme dersi aynı hafta) bir kez sayılır. */
export function mergeProspectPages<T extends { id: string }>(
  pages: readonly (readonly T[] | undefined)[],
): T[] {
  const seen = new Map<string, T>()
  for (const page of pages) for (const item of page ?? []) seen.set(item.id, item)
  return [...seen.values()]
}
