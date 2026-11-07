// Ayarlar → Eğitim yılı sekmesinin saf mantığı (IST-011; DOM-YTK-063…066): API yılı → satır,
// durum rozeti, etkinleştirme/kapatma ön bilgisi, form şemaları ve adres (`?yil=`) çözümü.
// Kural kararı sunucudadır (core `lib/academic-years.ts` aynı kuralları çalıştırır); burası yalnız
// kullanıcıya geçersiz işlemi göstermemek ve sonucu açıklamak içindir. Günler `YYYY-MM-DD`
// takvim günüdür; gösterim Europe/Istanbul (öğlen UTC'ye sabitlenip biçimlenir, gün kaymaz).
import { z } from 'zod'
import type { AcademicTerm, AcademicYear } from '@kampus/react-shared/academic-years.ts'
import {
  ACADEMIC_YEAR_EARLY_ACTIVATION_DAYS,
  ACADEMIC_YEAR_STATUS_LABELS,
  academicTermInputSchema,
  createAcademicYearSchema,
  defaultAcademicYearDates,
  earliestActivationDate,
  MAX_TERMS_PER_YEAR,
  updateAcademicYearSchema,
  type AcademicYearStatus,
} from '@kampus/school-core/lib/academic-years.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

export type InstitutionKind = 'school' | 'language_school'

const noon = (day: string) => `${day}T12:00:00.000Z`

/** "1 Eyl 2027"; boş ya da geçersiz gün "—". */
export function dayLabel(day: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? dateLabel(noon(day), { year: 'numeric' }) : '—'
}

/** "1 Eylül 2027 Çarşamba"; tarih alanının altındaki Europe/Istanbul gösterimi. Geçersizse `undefined`. */
export function dayHint(day: string | undefined): string | undefined {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined
  const label = dateLabel(noon(day), { year: 'numeric', month: 'long', weekday: 'long' })
  return label === '—' ? undefined : label
}

export const rangeLabel = (startDate: string, endDate: string) =>
  `${dayLabel(startDate)} – ${dayLabel(endDate)}`

const STATUS_TONES = {
  planned: 'amber',
  active: 'green',
  closed: 'gray',
} as const satisfies Record<AcademicYearStatus, BadgeTone>

export type TermRow = {
  id: string
  sequence: number
  name: string
  startDate: string
  endDate: string
  rangeLabel: string
}

export type YearRow = {
  startYear: number
  name: string
  startDate: string
  endDate: string
  rangeLabel: string
  status: AcademicYearStatus
  statusLabel: string
  tone: BadgeTone
  isActive: boolean
  /** `If-Match` sürümü; personel yanıtında her zaman dolu. */
  version: number | null
  terms: TermRow[]
  /** Planlı ve etkin yıl değişir; kapanmış yıl değişmez (409 `academic_year_closed`). */
  canEdit: boolean
  canActivate: boolean
  canClose: boolean
}

/** Dönem satırı; kimlik personele döner, kimliksiz dönem (öğrenci yanıtı) listelenmez. */
export function termRow(term: AcademicTerm): TermRow | null {
  if (!term.id) return null
  return {
    id: term.id,
    sequence: term.sequence,
    name: term.name,
    startDate: term.startDate,
    endDate: term.endDate,
    rangeLabel: rangeLabel(term.startDate, term.endDate),
  }
}

export function yearRow(year: AcademicYear): YearRow {
  const status: AcademicYearStatus = year.status ?? (year.isActive ? 'active' : 'planned')
  return {
    startYear: year.startYear,
    name: year.name,
    startDate: year.startDate,
    endDate: year.endDate,
    rangeLabel: rangeLabel(year.startDate, year.endDate),
    status,
    statusLabel: ACADEMIC_YEAR_STATUS_LABELS[status],
    tone: STATUS_TONES[status],
    isActive: status === 'active',
    version: year.rowVersion ?? null,
    terms: year.terms.flatMap((term) => termRow(term) ?? []),
    canEdit: status !== 'closed',
    canActivate: status === 'planned',
    canClose: status === 'active',
  }
}

/** Bugünün (Europe/Istanbul) günü. */
export const todayKey = (now: Date = new Date()) => dayKey(now.toISOString())

export type ActivationPlan = {
  /** Etkinleştirilecek yıl. */
  target: YearRow
  /** Aynı işlemde kapanacak etkin yıl (geri alınamaz); yoksa `null`. */
  closing: YearRow | null
  /** Bugün, başlangıçtan 60 gün öncesinden erken (DOM-YTK-065); yine de karar sunucudadır. */
  tooEarly: boolean
  /** En erken etkinleştirme günü (`YYYY-MM-DD`). */
  earliestDay: string
  /** Okulda dönemsiz yıl etkinleştirilemez; sunucu aynı kararı verir (422 `academic_terms_required`). */
  needsTerms: boolean
}

/** Etkinleştirme onayının ön bilgisi; yıl listede yoksa `null`. */
export function activationPlan(
  rows: readonly YearRow[],
  startYear: number,
  institutionType: InstitutionKind,
  today: string,
): ActivationPlan | null {
  const target = rows.find((row) => row.startYear === startYear)
  if (!target) return null
  const earliestDay = earliestActivationDate({ startDate: target.startDate })
  return {
    target,
    closing: rows.find((row) => row.isActive && row.startYear !== startYear) ?? null,
    tooEarly: today < earliestDay,
    earliestDay,
    needsTerms: institutionType === 'school' && target.terms.length === 0,
  }
}

export const ACTIVATION_IRREVERSIBLE =
  'Bu işlem geri alınamaz: kapanan yıl yeniden açılamaz ve değiştirilemez.'

export function activationDescription(plan: ActivationPlan): string {
  return plan.closing
    ? `${plan.closing.name} eğitim yılı kapanacak. ${ACTIVATION_IRREVERSIBLE}`
    : 'Bu yıl kurumun etkin yılı olur. Etkinleştirdikten sonra etkinliği geri alınamaz.'
}

export function earlyActivationNotice(plan: ActivationPlan): string {
  return `${plan.target.name} en erken ${dayHint(plan.earliestDay) ?? dayLabel(plan.earliestDay)} günü etkinleştirilebilir (başlangıç gününden en çok ${ACADEMIC_YEAR_EARLY_ACTIVATION_DAYS} gün önce).`
}

export const ACTIVATION_NEEDS_TERMS_NOTICE =
  'Okulda eğitim yılı dönemleri tanımlanmadan etkinleştirilemez. Önce dönem ekleyin.'

/**
 * Kapatma yalnız yılın son gününden itibaren yapılır (DOM-YTK-066); öncesinde neden gösterilir.
 * Yıl ortasında geçiş yeni yılı etkinleştirmekle olur.
 */
export function closeBlockedReason(row: YearRow, today: string): string | null {
  return today < row.endDate
    ? `${row.name} yılı ${dayLabel(row.endDate)} gününden önce kapatılamaz; yeni yılı etkinleştirmek bu yılı kapatır.`
    : null
}

export function closeDescription(row: YearRow): string {
  return `${row.name} eğitim yılı kapanır; tarihleri ve dönemleri artık değiştirilemez ve yeniden açılamaz. Yeni yıl etkinleştirilene kadar kurumun etkin yılı olmaz. Bu işlem geri alınamaz.`
}

export const TERM_LIMIT_NOTICE = `Bir yılda en çok ${MAX_TERMS_PER_YEAR} dönem olur.`

// --- Formlar -----------------------------------------------------------------------------

/** Yıl oluşturma: dönemler yıl açıldıktan sonra tabloda eklenir; kurallar core şemasındadır. */
export const yearCreateSchema = createAcademicYearSchema.omit({ terms: true }).extend({
  // Boş alan NaN gelir: teknik "expected number" yerine Türkçe mesaj; sınırlar core şemasında.
  startYear: z
    .number({ error: 'Başlangıç yılını yazın (ör. 2027).' })
    .pipe(createAcademicYearSchema.shape.startYear),
})
export type YearCreateValues = z.input<typeof yearCreateSchema>
export type YearCreateOutput = z.output<typeof yearCreateSchema>

export const yearUpdateSchema = updateAcademicYearSchema
export type YearUpdateValues = z.input<typeof yearUpdateSchema>
export type YearUpdateOutput = z.output<typeof yearUpdateSchema>

export const termSchema = academicTermInputSchema
export type TermFormValues = z.input<typeof termSchema>
export type TermFormOutput = z.output<typeof termSchema>

/** Yeni yıl: ilk açık yılı izleyen başlangıç yılı, 1 Eylül – 31 Ağustos. */
export function createDefaults(rows: readonly YearRow[], today: string): YearCreateValues {
  const next = Math.max(Number(today.slice(0, 4)), ...rows.map((row) => row.startYear + 1))
  return { startYear: next, ...defaultAcademicYearDates(next) }
}

export function updateDefaults(row: YearRow): YearUpdateValues {
  return { startDate: row.startDate, endDate: row.endDate }
}

export function termDefaults(row: YearRow, term?: TermRow): TermFormValues {
  return {
    name: term?.name ?? '',
    startDate: term?.startDate ?? row.startDate,
    endDate: term?.endDate ?? row.endDate,
  }
}

/** Sunucu hata kodu → form alanı (kod alanın altında görünür; kalanlar toast olur). */
export const YEAR_ERROR_FIELDS = {
  academic_year_exists: 'startYear',
  academic_year_start_mismatch: 'startDate',
  academic_year_dates_invalid: 'endDate',
  academic_year_too_long: 'endDate',
  academic_year_overlap: 'startDate',
  academic_term_outside_year: 'startDate',
} as const

export const TERM_ERROR_FIELDS = {
  academic_term_outside_year: 'startDate',
  academic_term_overlap: 'startDate',
  academic_term_dates_invalid: 'endDate',
  academic_term_name_exists: 'name',
} as const

// --- Sağ panel adresi (`?yil=`) ---------------------------------------------------

export const PANEL_PARAM = 'yil'
/** Yeni kayıt değeri: `yeni` (yıl) ya da `2027:donem` (yıla dönem). */
export const NEW_YEAR = 'yeni'

export type PanelTarget =
  | { kind: 'year-new' }
  | { kind: 'year-edit'; startYear: number }
  | { kind: 'term-new'; startYear: number }
  | { kind: 'term-edit'; startYear: number; termId: string }

export const yearPanelValue = (startYear: number) => String(startYear)
export const termNewPanelValue = (startYear: number) => `${startYear}:donem`
export const termEditPanelValue = (startYear: number, termId: string) =>
  `${startYear}:donem:${termId}`

/** Adres değeri → panel hedefi; tanınmayan değer `null` (panel kapalı kalır). */
export function parsePanelTarget(value: string): PanelTarget | null {
  if (value === NEW_YEAR) return { kind: 'year-new' }
  const [year, kind, termId, ...rest] = value.split(':')
  if (!year || !/^\d{4}$/.test(year) || rest.length > 0) return null
  const startYear = Number(year)
  if (kind === undefined) return { kind: 'year-edit', startYear }
  if (kind !== 'donem') return null
  if (termId === undefined) return { kind: 'term-new', startYear }
  return termId ? { kind: 'term-edit', startYear, termId } : null
}
