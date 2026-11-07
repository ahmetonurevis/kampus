import { z } from 'zod'

import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import { isCalendarDay } from './age.ts'
import { DomainError } from './errors.ts'
import { dateLabel, dayKey } from './format.ts'

/**
 * Eğitim yılı ve dönem modeli (IST-011; docs/domain/yetki-ve-kapsam.md DOM-YTK-063…067).
 *
 * - Eğitim yılı kurum içinde başlangıç yılıyla tanımlanır (`startYear`, 2026 → 2026–2027); bu
 *   sayı mevcut `academicYear` temsiliyle aynıdır (tarife, sözleşme, kurum ayarı). Varsayılan
 *   aralık 1 Eylül – 31 Ağustos'tur, kurum değiştirebilir.
 * - Durum `planned` → `active` → `closed`; kurumda tek etkin yıl bulunur. Kapanan yıl değişmez.
 * - Dönemler yılın içinde kalır ve örtüşmez; sıra başlangıç gününden hesaplanır, saklanmaz. Okulda
 *   yıl dönemsiz etkinleştirilemez; dil okulunda dönem isteğe bağlıdır (kurlar ayrı modeldir).
 *
 * Günler `YYYY-MM-DD` takvim günüdür; "bugün" `now`'ın Europe/Istanbul günüdür. Fonksiyonlar
 * saftır, girdileri değiştirmez; kimlik üretimi (`makeTermId`) ve yazma servistedir.
 */

z.config(z.locales.tr())

export const ACADEMIC_YEAR_STATUSES = ['planned', 'active', 'closed'] as const
export type AcademicYearStatus = (typeof ACADEMIC_YEAR_STATUSES)[number]

export const ACADEMIC_YEAR_STATUS_LABELS = {
  planned: 'Planlandı',
  active: 'Etkin',
  closed: 'Kapandı',
} as const satisfies Record<AcademicYearStatus, string>

/** Başlangıç yılı sınırları; kurum ayarındaki `academic_year` denetimiyle aynı. */
export const ACADEMIC_YEAR_MIN = 2000
export const ACADEMIC_YEAR_MAX = 2100
/** Bir yıldaki en çok dönem sayısı (dil okulunda kısa modüller dahil). */
export const MAX_TERMS_PER_YEAR = 12
/**
 * Yıl başlangıç gününden en çok bu kadar gün önce etkinleştirilir (DOM-YTK-065). Etkinleştirme
 * önceki yılı geri alınamaz biçimde kapatır; çok erken geçiş içinde bulunulan yılın kurum ayarını,
 * tarifesini ve rıza süresini kaydırırdı.
 */
export const ACADEMIC_YEAR_EARLY_ACTIVATION_DAYS = 60

export type AcademicTerm = {
  id: string
  name: string
  startDate: string
  endDate: string
}

export type AcademicYear = {
  startYear: number
  startDate: string
  endDate: string
  status: AcademicYearStatus
  /** Etkinleştirme anı (ISO UTC); planlı yılda `null`. */
  activatedAt: string | null
  /** Kapanış anı (ISO UTC); yalnız kapalı yılda dolu. */
  closedAt: string | null
  /** Arşivlenmemiş dönemler; sıra önemsizdir, `orderedTerms` başlangıç gününe göre dizer. */
  terms: readonly AcademicTerm[]
}

const day = (field: string) =>
  z.string().trim().refine(isCalendarDay, `${field} geçerli bir gün olmalı (YYYY-AA-GG).`)

const startYearSchema = z
  .number()
  .int('Başlangıç yılı tam sayı olmalı.')
  .min(ACADEMIC_YEAR_MIN, `Başlangıç yılı en az ${ACADEMIC_YEAR_MIN} olmalı.`)
  .max(ACADEMIC_YEAR_MAX, `Başlangıç yılı en çok ${ACADEMIC_YEAR_MAX} olmalı.`)

export const academicTermInputSchema = z.strictObject({
  name: z.string().trim().min(1, 'Dönem adını yazın.').max(100, 'Dönem adı en çok 100 karakter.'),
  startDate: day('Başlangıç günü'),
  endDate: day('Bitiş günü'),
})
export type AcademicTermInput = z.infer<typeof academicTermInputSchema>

export const createAcademicYearSchema = z.strictObject({
  startYear: startYearSchema,
  /** Verilmezse 1 Eylül `startYear`. */
  startDate: day('Başlangıç günü').optional(),
  /** Verilmezse 31 Ağustos `startYear + 1`. */
  endDate: day('Bitiş günü').optional(),
  terms: z
    .array(academicTermInputSchema)
    .max(MAX_TERMS_PER_YEAR, `Bir yılda en çok ${MAX_TERMS_PER_YEAR} dönem olur.`)
    .optional(),
})
export type CreateAcademicYearInput = z.infer<typeof createAcademicYearSchema>

const atLeastOne = (value: Record<string, unknown>) =>
  Object.values(value).some((item) => item !== undefined)

export const updateAcademicYearSchema = z
  .strictObject({
    startDate: day('Başlangıç günü').optional(),
    endDate: day('Bitiş günü').optional(),
  })
  .refine(atLeastOne, 'Değiştirilecek bir alan gönderin.')
export type UpdateAcademicYearInput = z.infer<typeof updateAcademicYearSchema>

export const updateAcademicTermSchema = z
  .strictObject({
    name: academicTermInputSchema.shape.name.optional(),
    startDate: day('Başlangıç günü').optional(),
    endDate: day('Bitiş günü').optional(),
  })
  .refine(atLeastOne, 'Değiştirilecek bir alan gönderin.')
export type UpdateAcademicTermInput = z.infer<typeof updateAcademicTermSchema>

/** Gösterim adı: 2026 → "2026–2027". Hesaplanır, saklanmaz. */
export const academicYearName = (startYear: number) => `${startYear}–${startYear + 1}`

/** Varsayılan aralık: 1 Eylül – ertesi yılın 31 Ağustos'u (DOM-YTK-063). */
export function defaultAcademicYearDates(startYear: number) {
  return { startDate: `${startYear}-09-01`, endDate: `${startYear + 1}-08-31` }
}

/**
 * Bir yıl sonrası; ayın son gününü aşmaz (29 Şubat → 28 Şubat). PostgreSQL `date + interval
 * '1 year'` ile aynı sonuç: tablo denetimi `academic_years_dates_check` aynı sınırı kullanır.
 */
export function addOneYear(value: string): string {
  const year = Number(value.slice(0, 4)) + 1
  const month = Number(value.slice(5, 7))
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const dayOfMonth = Math.min(Number(value.slice(8, 10)), lastDay)
  return `${year}-${value.slice(5, 7)}-${String(dayOfMonth).padStart(2, '0')}`
}

const overlaps = (a: { startDate: string; endDate: string }, b: typeof a) =>
  a.startDate <= b.endDate && b.startDate <= a.endDate

const contains = (range: { startDate: string; endDate: string }, value: string) =>
  range.startDate <= value && value <= range.endDate

/**
 * Dönem adının tekillik anahtarı (DOM-YTK-064): NFC, baş/son boşluksuz, Türkçe küçük harf ("I" →
 * "ı", "İ" → "i"). Veritabanı aynı anahtarı `academic_terms.name_key` kolonunda saklar ve tekil
 * indeksi onun üzerine kurar; `lower()` yerel ayara bağlı olduğundan iki taraf ayrışırdı.
 */
export const academicTermNameKey = (name: string) =>
  name.normalize('NFC').trim().toLocaleLowerCase('tr-TR')

const sameName = (a: string, b: string) => academicTermNameKey(a) === academicTermNameKey(b)

/** Takvim gününe (`YYYY-MM-DD`) gün ekler ya da çıkarır. */
export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Dönemler başlangıç gününe göre; aynı günde ada göre (kararlı sıra). */
export function orderedTerms(terms: readonly AcademicTerm[]): AcademicTerm[] {
  return [...terms].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name, 'tr'),
  )
}

/** Dönemin yıl içindeki sırası (1'den); dönem yılda yoksa `null`. */
export function termSequence(year: Pick<AcademicYear, 'terms'>, termId: string): number | null {
  const index = orderedTerms(year.terms).findIndex((term) => term.id === termId)
  return index === -1 ? null : index + 1
}

/**
 * Yıl aralığı kuralı (DOM-YTK-063): başlangıç günü başlangıç yılındadır, bitiş başlangıçtan
 * sonradır ve bir yılı geçmez (`end < start + 1 yıl`). Aynı kurumun yılları örtüşmez.
 */
function assertYearRange(
  startYear: number,
  range: { startDate: string; endDate: string },
  others: readonly AcademicYear[],
) {
  if (Number(range.startDate.slice(0, 4)) !== startYear)
    throw new DomainError(
      'academic_year_start_mismatch',
      `Başlangıç günü ${startYear} yılı içinde olmalı.`,
      { path: ['startDate'] },
    )
  if (range.endDate <= range.startDate)
    throw new DomainError(
      'academic_year_dates_invalid',
      'Bitiş günü başlangıç gününden sonra olmalı.',
      { path: ['endDate'] },
    )
  if (range.endDate >= addOneYear(range.startDate))
    throw new DomainError('academic_year_too_long', 'Eğitim yılı bir yıldan uzun olamaz.', {
      path: ['endDate'],
    })
  const clash = others.find((other) => other.startYear !== startYear && overlaps(other, range))
  if (clash)
    throw new DomainError(
      'academic_year_overlap',
      `Tarihler ${academicYearName(clash.startYear)} eğitim yılıyla çakışıyor.`,
      { path: ['startDate'] },
    )
}

/**
 * Dönem kuralı (DOM-YTK-064): bitiş başlangıçtan önce olamaz, dönem yılın içinde kalır, aynı
 * yılın dönemleriyle örtüşmez ve adı yılda tekildir. `path` hatanın alan önekidir.
 */
function assertTerms(
  range: { startDate: string; endDate: string },
  terms: readonly AcademicTerm[],
  path: (index: number) => string[] = () => [],
) {
  if (terms.length > MAX_TERMS_PER_YEAR)
    throw new DomainError(
      'academic_term_limit',
      `Bir yılda en çok ${MAX_TERMS_PER_YEAR} dönem olur.`,
      { path: ['terms'] },
    )
  terms.forEach((term, index) => {
    if (term.endDate < term.startDate)
      throw new DomainError(
        'academic_term_dates_invalid',
        'Dönemin bitiş günü başlangıç gününden önce olamaz.',
        { path: [...path(index), 'endDate'] },
      )
    if (!contains(range, term.startDate) || !contains(range, term.endDate))
      throw new DomainError(
        'academic_term_outside_year',
        'Dönem eğitim yılının başlangıç ve bitiş günleri arasında olmalı.',
        { path: [...path(index), 'startDate'] },
      )
    const earlier = terms.slice(0, index)
    if (earlier.some((other) => overlaps(other, term)))
      throw new DomainError('academic_term_overlap', 'Dönemler birbiriyle çakışamaz.', {
        path: [...path(index), 'startDate'],
      })
    if (earlier.some((other) => sameName(other.name, term.name)))
      throw new DomainError('academic_term_name_exists', 'Bu yılda aynı adlı bir dönem var.', {
        kind: 'conflict',
        path: [...path(index), 'name'],
      })
  })
}

function assertOpen(year: AcademicYear) {
  if (year.status === 'closed')
    throw new DomainError('academic_year_closed', 'Kapanmış eğitim yılı değiştirilemez.', {
      kind: 'conflict',
    })
}

function requireYear(years: readonly AcademicYear[], startYear: number): AcademicYear {
  const year = years.find((item) => item.startYear === startYear)
  if (!year)
    throw new DomainError('academic_year_not_found', 'Eğitim yılı bulunamadı.', {
      kind: 'not_found',
    })
  return year
}

function requireTerm(year: AcademicYear, termId: string): AcademicTerm {
  const term = year.terms.find((item) => item.id === termId)
  if (!term)
    throw new DomainError('academic_term_not_found', 'Dönem bulunamadı.', { kind: 'not_found' })
  return term
}

/**
 * Yeni eğitim yılı (DOM-YTK-063, -064). Yıl `planned` açılır; tarih verilmezse varsayılan aralık.
 * Aynı başlangıç yılı ikinci kez açılmaz (409 `academic_year_exists`). İlk dönemler isteğe bağlı
 * aynı işlemde eklenir.
 */
export function planAcademicYearCreation(input: {
  years: readonly AcademicYear[]
  input: unknown
  makeTermId: () => string
}): AcademicYear {
  const data = createAcademicYearSchema.parse(input.input)
  if (input.years.some((year) => year.startYear === data.startYear))
    throw new DomainError(
      'academic_year_exists',
      `${academicYearName(data.startYear)} eğitim yılı zaten tanımlı.`,
      { kind: 'conflict', path: ['startYear'] },
    )
  const defaults = defaultAcademicYearDates(data.startYear)
  const range = {
    startDate: data.startDate ?? defaults.startDate,
    endDate: data.endDate ?? defaults.endDate,
  }
  assertYearRange(data.startYear, range, input.years)
  const terms = (data.terms ?? []).map((term) => ({ id: input.makeTermId(), ...term }))
  assertTerms(range, terms, (index) => ['terms', String(index)])
  return {
    startYear: data.startYear,
    ...range,
    status: 'planned',
    activatedAt: null,
    closedAt: null,
    terms,
  }
}

/**
 * Yılın tarihlerini değiştirir (DOM-YTK-063). Kapanmış yıl değişmez; var olan dönemler yeni aralığın
 * içinde kalmalıdır.
 */
export function planAcademicYearUpdate(input: {
  years: readonly AcademicYear[]
  startYear: number
  input: unknown
}): AcademicYear {
  const data = updateAcademicYearSchema.parse(input.input)
  const year = requireYear(input.years, input.startYear)
  assertOpen(year)
  const range = {
    startDate: data.startDate ?? year.startDate,
    endDate: data.endDate ?? year.endDate,
  }
  assertYearRange(year.startYear, range, input.years)
  assertTerms(range, orderedTerms(year.terms))
  return { ...year, ...range }
}

/** Yıla dönem ekler (DOM-YTK-064); kapanmış yıla eklenmez. */
export function planTermCreation(input: {
  years: readonly AcademicYear[]
  startYear: number
  input: unknown
  termId: string
}): { year: AcademicYear; term: AcademicTerm } {
  const data = academicTermInputSchema.parse(input.input)
  const year = requireYear(input.years, input.startYear)
  assertOpen(year)
  const term = { id: input.termId, ...data }
  // Yeni dönem son sırada denetlenir: hata yolu yeni dönemin alanlarını gösterir.
  const terms = [...orderedTerms(year.terms), term]
  assertTerms(year, terms, (index) => (index === terms.length - 1 ? [] : ['terms']))
  return { year: { ...year, terms }, term }
}

/** Dönemin adını ya da tarihlerini değiştirir (DOM-YTK-064); kapanmış yılda değişmez. */
export function planTermUpdate(input: {
  years: readonly AcademicYear[]
  startYear: number
  termId: string
  input: unknown
}): { year: AcademicYear; term: AcademicTerm } {
  const data = updateAcademicTermSchema.parse(input.input)
  const year = requireYear(input.years, input.startYear)
  assertOpen(year)
  const current = requireTerm(year, input.termId)
  const term: AcademicTerm = {
    id: current.id,
    name: data.name ?? current.name,
    startDate: data.startDate ?? current.startDate,
    endDate: data.endDate ?? current.endDate,
  }
  const others = orderedTerms(year.terms.filter((item) => item.id !== term.id))
  const terms = [...others, term]
  assertTerms(year, terms, (index) => (index === terms.length - 1 ? [] : ['terms']))
  return { year: { ...year, terms }, term }
}

/**
 * Dönemi kaldırır (arşiv; DOM-YTK-064). Kapanmış yılda kaldırılmaz. Okulda etkin yılın son dönemi
 * kaldırılamaz: etkin okul yılı dönemsiz kalmaz (DOM-YTK-065).
 */
export function planTermRemoval(input: {
  years: readonly AcademicYear[]
  startYear: number
  termId: string
  institutionType: InstitutionType
}): { year: AcademicYear; term: AcademicTerm } {
  const year = requireYear(input.years, input.startYear)
  assertOpen(year)
  const term = requireTerm(year, input.termId)
  const terms = year.terms.filter((item) => item.id !== term.id)
  if (year.status === 'active' && input.institutionType === 'school' && terms.length === 0)
    throw new DomainError(
      'academic_terms_required',
      'Etkin okul yılının en az bir dönemi olmalı.',
      { path: ['termId'] },
    )
  return { year: { ...year, terms }, term }
}

/** Kurumun etkin yılı; yoksa `null` (DOM-YTK-065: en çok bir tane). */
export function activeAcademicYear(years: readonly AcademicYear[]): AcademicYear | null {
  return years.find((year) => year.status === 'active') ?? null
}

/** Yılın en erken etkinleştirilebileceği gün: başlangıçtan 60 gün önce (DOM-YTK-065). */
export const earliestActivationDate = (year: Pick<AcademicYear, 'startDate'>) =>
  addDays(year.startDate, -ACADEMIC_YEAR_EARLY_ACTIVATION_DAYS)

/**
 * Yılı etkinleştirir (DOM-YTK-065). Kurumda tek etkin yıl bulunur: başka etkin yıl varsa aynı
 * işlemde kapanır (yıl geçişi). Yıl başlangıç gününden en çok 60 gün önce etkinleştirilir
 * (Europe/Istanbul günü); daha yeni bir yıl etkinken eski yıl etkinleştirilmez; bitmiş yıl
 * etkinleştirilmez; okulda dönemsiz yıl etkinleştirilmez. Dil okulunda dönem isteğe bağlıdır.
 */
export function planAcademicYearActivation(input: {
  years: readonly AcademicYear[]
  startYear: number
  institutionType: InstitutionType
  now: string
}): { activated: AcademicYear; closed: AcademicYear | null } {
  const year = requireYear(input.years, input.startYear)
  if (year.status === 'active')
    throw new DomainError('academic_year_already_active', 'Bu eğitim yılı zaten etkin.', {
      kind: 'conflict',
    })
  assertOpen(year)
  const today = dayKey(input.now)
  if (today > year.endDate)
    throw new DomainError('academic_year_ended', 'Bitmiş eğitim yılı etkinleştirilemez.')
  const earliest = earliestActivationDate(year)
  if (today < earliest)
    throw new DomainError(
      'academic_year_activation_too_early',
      `Eğitim yılı başlangıç gününden en çok ${ACADEMIC_YEAR_EARLY_ACTIVATION_DAYS} gün önce etkinleştirilebilir; en erken ${dateLabel(`${earliest}T12:00:00.000Z`, { year: 'numeric', month: 'long' })}.`,
    )
  if (input.institutionType === 'school' && year.terms.length === 0)
    throw new DomainError(
      'academic_terms_required',
      'Okulda eğitim yılı dönemleri tanımlanmadan etkinleştirilemez.',
      { path: ['terms'] },
    )
  const previous = activeAcademicYear(input.years)
  if (previous && previous.startYear > year.startYear)
    throw new DomainError(
      'academic_year_activation_order',
      `${academicYearName(previous.startYear)} etkinken önceki bir yıl etkinleştirilemez.`,
    )
  return {
    activated: { ...year, status: 'active', activatedAt: input.now, closedAt: null },
    closed: previous ? { ...previous, status: 'closed', closedAt: input.now } : null,
  }
}

/**
 * Etkin yılı kapatır (DOM-YTK-066). Yalnız etkin yıl ve yalnız son günü gelmişse kapanır; yıl
 * ortasında geçiş yeni yılın etkinleştirilmesiyle yapılır. Kapanan yıl değişmez, yeniden açılmaz.
 */
export function planAcademicYearClosure(input: {
  years: readonly AcademicYear[]
  startYear: number
  now: string
}): AcademicYear {
  const year = requireYear(input.years, input.startYear)
  assertOpen(year)
  if (year.status !== 'active')
    throw new DomainError('academic_year_not_active', 'Yalnız etkin eğitim yılı kapatılabilir.')
  if (dayKey(input.now) < year.endDate)
    throw new DomainError(
      'academic_year_not_ended',
      'Eğitim yılı son gününden önce kapatılamaz; yeni yılı etkinleştirmek bu yılı kapatır.',
    )
  return { ...year, status: 'closed', closedAt: input.now }
}

/** Günün düştüğü dönem; yılda yoksa (tatil, yıl dışı) `null`. */
export function termOn(year: Pick<AcademicYear, 'terms'>, value: string): AcademicTerm | null {
  return year.terms.find((term) => contains(term, value)) ?? null
}

/**
 * Bir günün (`YYYY-MM-DD`) düştüğü eğitim yılı ve dönem (DOM-YTK-067). Yıllar örtüşmediğinden en
 * çok bir yıl bulunur; dönem arası tatilde `term` boştur.
 */
export function locateDay(
  years: readonly AcademicYear[],
  value: string,
): { year: AcademicYear | null; term: AcademicTerm | null } {
  const year = years.find((item) => contains(item, value)) ?? null
  return { year, term: year ? termOn(year, value) : null }
}

/**
 * Bugünün eğitim yılı ve dönemi (DOM-YTK-067): `now`'ın Europe/Istanbul günü etkin yılın içindeyse
 * etkin yıl; değilse günü içeren yıl (ör. henüz etkinleştirilmemiş yeni yıl); o da yoksa etkin yıl
 * (dönemsiz). Dönem yalnız gün yılın bir dönemine düşüyorsa doludur.
 */
export function currentAcademicPeriod(
  years: readonly AcademicYear[],
  now: string,
): { date: string; year: AcademicYear | null; term: AcademicTerm | null } {
  const date = dayKey(now)
  const active = activeAcademicYear(years)
  if (active && contains(active, date)) return { date, year: active, term: termOn(active, date) }
  const located = locateDay(years, date)
  if (located.year) return { date, ...located }
  return { date, year: active, term: null }
}

/**
 * Rapor süzgecinin gün aralığı (IST-011 kabul ölçütü): dönem verilirse dönemin, verilmezse yılın
 * başlangıç ve bitiş günü (ikisi dahil). Yıl ya da dönem yoksa 404.
 */
export function periodRange(input: {
  years: readonly AcademicYear[]
  startYear: number
  termId?: string | undefined
}): { startDate: string; endDate: string } {
  const year = requireYear(input.years, input.startYear)
  const range = input.termId === undefined ? year : requireTerm(year, input.termId)
  return { startDate: range.startDate, endDate: range.endDate }
}

/** Gün (`YYYY-MM-DD`) ya da an (ISO) aralığın içinde mi; an Europe/Istanbul gününe çevrilir. */
export function isWithinPeriod(
  range: { startDate: string; endDate: string },
  value: string,
): boolean {
  return contains(range, isCalendarDay(value) ? value : dayKey(value))
}

/** Okuma görünümünde dönem: ad, sıra ve tarihler. */
export type AcademicTermView = {
  id?: string
  name: string
  sequence: number
  startDate: string
  endDate: string
}

/**
 * Okuma görünümü (DOM-YTK-067): beş rol okur. Öğrenci ve veli yalnız ad, tarih ve etkinlik
 * bilgisini görür; durum, işlem zamanları ve dönem kimliği personele döner.
 */
export function academicYearView(year: AcademicYear, role: Role) {
  const staff = role !== 'ogrenci' && role !== 'veli'
  const terms: AcademicTermView[] = orderedTerms(year.terms).map((term, index) => ({
    ...(staff ? { id: term.id } : {}),
    name: term.name,
    sequence: index + 1,
    startDate: term.startDate,
    endDate: term.endDate,
  }))
  return {
    startYear: year.startYear,
    name: academicYearName(year.startYear),
    startDate: year.startDate,
    endDate: year.endDate,
    isActive: year.status === 'active',
    ...(staff
      ? { status: year.status, activatedAt: year.activatedAt, closedAt: year.closedAt }
      : {}),
    terms,
  }
}
