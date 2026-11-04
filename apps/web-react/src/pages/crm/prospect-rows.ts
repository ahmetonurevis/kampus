// Aday/CRM ekranlarının saf hesapları: satırlar, aşama rozeti, süzgeç seçenekleri ve Tanışma
// Görüşmeleri olayları. Kural core'dadır (`lib/prospects.ts`, DOM-KAY-005, -030…034); burada
// yalnız arayüzün hangi seçeneği göstereceği türetilir. Karar yine sunucudadır.
import { dateLabel, dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import {
  nextProspectStages,
  OPEN_PROSPECT_STAGES,
  PROSPECT_SOURCES,
  PROSPECT_STAGES,
  prospectStageLabel,
  type ProspectStage,
} from '@kampus/school-core/lib/prospects.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import type {
  CollectionCounts,
  CollectionFilters,
  CollectionQuery,
} from '@kampus/react-shared/collections.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import type { CoreRecord, CoreRow } from '@/hooks/use-core-collection.ts'
import type { FilterField, FilterValue } from '@/lib/list-query.ts'
import { addDays, isDayKey, weekDays, weekStart } from '../academic/academic-rows.ts'

type Prospect = CoreRecord<'prospects'>
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

/**
 * Adayın telefon ve e-postası kimin (DOM-KAY-003): 18 yaş altı adayda velinindir, yetişkinde adayın
 * kendisinindir. Kaydında `minor` olmayan eski aday 18 yaş altı sayılır (DOM-KAY-009).
 */
export type ContactOwner = 'guardian' | 'self'
export const prospectContactOwner = (prospect: { minor?: boolean | undefined }): ContactOwner =>
  prospect.minor === false ? 'self' : 'guardian'

/** İletişim alanı etiketleri: sahibi velise "Veli telefonu", adayın kendisiyse "Telefon". */
export const CONTACT_LABELS = {
  guardian: { phone: 'Veli telefonu', email: 'Veli e-postası' },
  self: { phone: 'Telefon', email: 'E-posta' },
} as const satisfies Record<ContactOwner, { phone: string; email: string }>

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

export const dateTimeLabel = (value: string) =>
  dateLabel(value, { weekday: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

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

/** "13:00 – 13:45" (Europe/Istanbul). */
export const slotLabel = (startsAt: string, minutes: number) =>
  `${timeLabel(startsAt)} – ${timeLabel(new Date(Date.parse(startsAt) + minutes * 60_000))}`

/**
 * Detay sayfasında seçilebilen aşamalar (DOM-KAY-030): yalnız geçerli hedefler. `Görüşme
 * planlandı` planlamayla, `Kayıt oldu` kesin kayıtla girildiği için sunulmaz.
 */
export function stageTargets(stage: string | undefined): ProspectStage[] {
  return nextProspectStages(stage).filter(
    (target) => target !== 'Görüşme planlandı' && target !== 'Kayıt oldu',
  )
}

/** Aday açık aşamada mı (not, görüşme ve deneme dersi yalnız açık adaya, DOM-KAY-032). */
export const isOpenStage = (stage: string | undefined) =>
  (OPEN_PROSPECT_STAGES as readonly (string | undefined)[]).includes(stage)

// --- Tanışma Görüşmeleri ------------------------------------------------------------------

export type MeetingKind = 'meeting' | 'trial'
export const MEETING_KIND_LABELS = {
  meeting: 'Tanışma görüşmesi',
  trial: 'Deneme dersi',
} as const satisfies Record<MeetingKind, string>

export type MeetingEvent = {
  id: string
  prospectId: string
  name: string
  kind: MeetingKind
  kindLabel: string
  startsAt: string
  /** Europe/Istanbul günü (`YYYY-MM-DD`); tarih süzgeci bunu karşılaştırır. */
  day: string
  whenLabel: string
  timeRange: string
  branch: string
  place: string
  stage: string
  stageLabel: string
  upcoming: boolean
}

/**
 * Adaylardan planlanmış görüşme ve deneme dersleri. Görüşme `trialAt` (görüşme anı) ve `meeting`
 * alanından, deneme dersi `trialLesson`'dan gelir (DOM-KAY-033, -034). Kapalı (`Kayıt oldu`,
 * `Vazgeçti`) adayın olayı listelenmez. Yaklaşanlar önce ve yakından uzağa, geçmişler sonra ve
 * yeniden eskiye sıralanır.
 */
export function meetingEvents(
  prospects: readonly Prospect[],
  type: InstitutionType,
  context: {
    now: number
    branches: ReadonlyMap<string, string>
    classes: ReadonlyMap<string, string>
  },
): MeetingEvent[] {
  const events: MeetingEvent[] = []
  for (const prospect of prospects) {
    if (!isOpenStage(prospect.stage)) continue
    const base = {
      prospectId: prospect.id,
      name: prospect.name,
      branch: context.branches.get(prospect.branchId) ?? '—',
      stage: prospect.stage ?? '',
      stageLabel: prospectStageLabel(prospect.stage, type),
    }
    const add = (kind: MeetingKind, startsAt: string, minutes: number, place: string) =>
      events.push({
        ...base,
        id: `${prospect.id}:${kind}`,
        kind,
        kindLabel: MEETING_KIND_LABELS[kind],
        startsAt,
        day: dayKey(startsAt),
        whenLabel: dateLabel(startsAt, { weekday: 'long', year: 'numeric' }),
        timeRange: slotLabel(startsAt, minutes),
        place,
        upcoming: Date.parse(startsAt) >= context.now,
      })
    if (prospect.trialAt)
      add(
        'meeting',
        prospect.trialAt,
        prospect.meeting?.duration ?? 30,
        prospect.meeting?.room ?? '—',
      )
    const trial = prospect.trialLesson
    if (trial) add('trial', trial.date, trial.duration, context.classes.get(trial.classId) ?? '—')
  }
  return events.sort((a, b) => {
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1
    const order = Date.parse(a.startsAt) - Date.parse(b.startsAt)
    return a.upcoming ? order : -order
  })
}

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
] as const
export type MeetingView = (typeof MEETING_VIEWS)[number]['value']

/** Adresteki görünüm (`?gorunum=`); bilinmeyen değer listedir. */
export const meetingView = (value: string | null): MeetingView =>
  value === 'hafta' ? 'hafta' : 'liste'

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
