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
import type { BadgeTone } from '@/lib/badge-tone.ts'
import type { CoreRecord, CoreRow } from '@/hooks/use-core-collection.ts'
import type { FilterField } from '@/lib/list-query.ts'

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
  return (STAGE_TONES as Record<string, BadgeTone>)[stage] ?? 'gray'
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

export type ProspectRow = {
  id: string
  name: string
  phone: string
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
