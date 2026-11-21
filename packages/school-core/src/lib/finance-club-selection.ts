import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { assertActiveStudent, type StudentCheck } from './finance-transport.ts'

/**
 * Kulüp tercihi ve kontenjanlı dağıtım (docs/domain/finans.md DOM-FIN-150; ON-169; IST-099).
 *
 * - **Tercih dönemi (K-505):** kurum, eğitim yılı (başlangıç yılı) ve isteğe bağlı dönem (1, 2),
 *   açılış ve kapanış günü (Europe/Istanbul takvim günü, ikisi dahil), katılan kulüpler, öğrenci
 *   başına en çok tercih sayısı ve atanacak kulüp sayısı (varsayılan 1), isteğe bağlı sınıf
 *   düzeyi süzgeci. Kura çekildikten sonra dönem değişmez; tercih girilmişse yalnız ad ve tarihler
 *   değişir.
 * - **Tercih (K-505):** öğrenci kendisi, veli kendi çocuğu, yönetici ve ön büro herkes adına sıralı
 *   tercih girer; yalnız dönem açıkken (kapanınca kimse değiştiremez). Boş liste tercihi geri
 *   çeker.
 * - **Dağıtım (K-506):** tohumlu kurayla rastgele sıra, sonra tercih sırasına göre seri diktatörlük;
 *   birden çok kulüp atanacaksa turlar yılan sırasıyla döner (çift turda sıra tersine). Kontenjan
 *   aşılmaz, zaten üye olan öğrenci aynı kulübe yeniden atanmaz. Tohum dönemde saklanır, sonuç
 *   aynı girdiyle yeniden üretilir.
 * - **Onay ve yedek (K-507):** önizleme özeti onayda eşleşmezse 409; onay üyelikleri tek işlemde
 *   yazar, ikinci onay yoktur. Yerleşemeyenler kulüp başına sıralı yedek listesindedir; yer
 *   açılınca ilk uygun yedek önerilir, otomatik eklenmez.
 *
 * Üyelik modeli `lib/finance-clubs.ts`'tedir (DOM-FIN-142, K-483); burası ikinci üyelik tanımlamaz.
 * Fonksiyonlar saftır, girdileri değiştirmez.
 */

/** Dönem yönetimi, adına tercih, kura ve onay: yönetici ve ön büro (kulüp yönetimiyle aynı). */
export const CLUB_SELECTION_MANAGE_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]
/** Tercih girişi: yöneticiler herkes adına, veli kendi çocuğu, öğrenci kendisi. */
export const CLUB_SELECTION_ENTRY_ROLES = [
  'yonetici',
  'onburo',
  'veli',
  'ogrenci',
] as const satisfies readonly Role[]
export type ClubSelectionEntryRole = (typeof CLUB_SELECTION_ENTRY_ROLES)[number]
export const isClubSelectionEntryRole = (role: string): role is ClubSelectionEntryRole =>
  (CLUB_SELECTION_ENTRY_ROLES as readonly string[]).includes(role)
/** Kendi (çocuğunun) tercih dönemlerini okuyan roller; kapsam sunucuda daralır. */
export const CLUB_SELECTION_FAMILY_ROLES = ['veli', 'ogrenci'] as const satisfies readonly Role[]

export const CLUB_SELECTION_NAME_MAX = 120
export const CLUB_SELECTION_CLUBS_MAX = 40
export const CLUB_SELECTION_CHOICES_MAX = 10
export const CLUB_SELECTION_SEATS_MAX = 5
export const CLUB_SELECTION_GRADE_MIN = 1
export const CLUB_SELECTION_GRADE_MAX = 12
export const CLUB_SELECTION_YEAR_MIN = 2000
export const CLUB_SELECTION_YEAR_MAX = 2100
export const CLUB_SELECTION_TERMS = [1, 2] as const

export const CLUB_SELECTION_PHASES = ['upcoming', 'open', 'closed', 'drawn', 'confirmed'] as const
export type ClubSelectionPhase = (typeof CLUB_SELECTION_PHASES)[number]
export const CLUB_SELECTION_PHASE_LABELS = {
  upcoming: 'Açılmadı',
  open: 'Tercihe açık',
  closed: 'Kapandı',
  drawn: 'Kura çekildi',
  confirmed: 'Onaylandı',
} as const satisfies Record<ClubSelectionPhase, string>

export const CLUB_SELECTION_OUTCOMES = ['assigned', 'waitlisted'] as const
export type ClubSelectionOutcome = (typeof CLUB_SELECTION_OUTCOMES)[number]

// --- Şemalar -------------------------------------------------------------------------------------

const nameSchema = z
  .string('Dönem adını girin.')
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(
    CLUB_SELECTION_NAME_MAX,
    `En çok ${String(CLUB_SELECTION_NAME_MAX)} karakter girebilirsiniz.`,
  )
  .describe('Dönem adı (2–120)')
const yearSchema = z
  .number('Eğitim yılını seçin.')
  .int('Eğitim yılını seçin.')
  .min(CLUB_SELECTION_YEAR_MIN, 'Eğitim yılını seçin.')
  .max(CLUB_SELECTION_YEAR_MAX, 'Eğitim yılını seçin.')
  .describe('Eğitim yılının başlangıç yılı (2026 → 2026–2027)')
const termSchema = z
  .union([z.literal(1), z.literal(2)], 'Dönemi seçin.')
  .nullable()
  .describe('Eğitim dönemi (1 ya da 2); `null` bütün yıl')
const clubIdsSchema = z
  .array(z.uuid('Kulüp geçersiz.'), 'Kulüpleri seçin.')
  .min(1, 'En az bir kulüp seçin.')
  .max(CLUB_SELECTION_CLUBS_MAX, `En çok ${String(CLUB_SELECTION_CLUBS_MAX)} kulüp seçebilirsiniz.`)
  .refine((ids) => new Set(ids).size === ids.length, 'Aynı kulüp iki kez seçilmiş.')
  .describe('Döneme katılan kulüpler (1–40, tekil)')
const maxChoicesSchema = z
  .number('Tercih sayısını girin.')
  .int('Tercih sayısı tam sayı olmalı.')
  .min(1, 'Tercih sayısı en az 1 olmalı.')
  .max(
    CLUB_SELECTION_CHOICES_MAX,
    `Tercih sayısı en çok ${String(CLUB_SELECTION_CHOICES_MAX)} olabilir.`,
  )
  .describe('Öğrenci başına en çok tercih (1–10); kulüp sayısını aşamaz')
const seatsSchema = z
  .number('Atanacak kulüp sayısını girin.')
  .int('Atanacak kulüp sayısı tam sayı olmalı.')
  .min(1, 'Atanacak kulüp sayısı en az 1 olmalı.')
  .max(
    CLUB_SELECTION_SEATS_MAX,
    `Atanacak kulüp sayısı en çok ${String(CLUB_SELECTION_SEATS_MAX)} olabilir.`,
  )
  .describe('Öğrenci başına atanacak kulüp (1–5); tercih sayısını aşamaz')
const gradeLevelsSchema = z
  .array(
    z
      .number('Sınıf düzeyi geçersiz.')
      .int('Sınıf düzeyi geçersiz.')
      .min(CLUB_SELECTION_GRADE_MIN, 'Sınıf düzeyi geçersiz.')
      .max(CLUB_SELECTION_GRADE_MAX, 'Sınıf düzeyi geçersiz.'),
    'Sınıf düzeylerini seçin.',
  )
  .max(CLUB_SELECTION_GRADE_MAX)
  .refine((grades) => new Set(grades).size === grades.length, 'Aynı düzey iki kez seçilmiş.')
  .describe('Hedef sınıf düzeyleri (1–12); boşsa bütün öğrenciler')

function checkPeriodShape(
  value: {
    openDate?: string | undefined
    closeDate?: string | undefined
    clubIds?: readonly string[] | undefined
    maxChoices?: number | undefined
    seatsPerStudent?: number | undefined
  },
  context: z.RefinementCtx,
) {
  if (value.openDate !== undefined && value.closeDate !== undefined)
    if (value.closeDate < value.openDate)
      context.addIssue({
        code: 'custom',
        path: ['closeDate'],
        message: 'Kapanış günü açılıştan önce olamaz.',
      })
  if (value.clubIds !== undefined && value.maxChoices !== undefined)
    if (value.maxChoices > value.clubIds.length)
      context.addIssue({
        code: 'custom',
        path: ['maxChoices'],
        message: 'Tercih sayısı kulüp sayısını aşamaz.',
      })
  if (value.maxChoices !== undefined && value.seatsPerStudent !== undefined)
    if (value.seatsPerStudent > value.maxChoices)
      context.addIssue({
        code: 'custom',
        path: ['seatsPerStudent'],
        message: 'Atanacak kulüp sayısı tercih sayısını aşamaz.',
      })
}

export const clubSelectionPeriodCreateSchema = z
  .strictObject({
    name: nameSchema,
    academicYear: yearSchema,
    term: termSchema.default(null),
    openDate: daySchema.describe('Açılış günü (YYYY-MM-DD, Europe/Istanbul; dahil)'),
    closeDate: daySchema.describe('Kapanış günü (YYYY-MM-DD; dahil); bugünden önce olamaz'),
    clubIds: clubIdsSchema,
    maxChoices: maxChoicesSchema,
    seatsPerStudent: seatsSchema.default(1),
    gradeLevels: gradeLevelsSchema.default([]),
  })
  .superRefine(checkPeriodShape)
export type ClubSelectionPeriodCreateInput = z.input<typeof clubSelectionPeriodCreateSchema>
export type ClubSelectionPeriodFields = z.output<typeof clubSelectionPeriodCreateSchema>

export const clubSelectionPeriodUpdateSchema = z
  .strictObject({
    name: nameSchema.optional(),
    academicYear: yearSchema.optional(),
    term: termSchema.optional(),
    openDate: daySchema.optional().describe('Açılış günü'),
    closeDate: daySchema.optional().describe('Kapanış günü'),
    clubIds: clubIdsSchema.optional(),
    maxChoices: maxChoicesSchema.optional(),
    seatsPerStudent: seatsSchema.optional(),
    gradeLevels: gradeLevelsSchema.optional(),
  })
  .superRefine((value, context) => {
    if (Object.values(value).every((field) => field === undefined))
      context.addIssue({ code: 'custom', path: [], message: 'En az bir alanı değiştirin.' })
  })
export type ClubSelectionPeriodUpdateFields = z.output<typeof clubSelectionPeriodUpdateSchema>

export const clubSelectionPreferenceSchema = z.strictObject({
  studentId: z
    .string('Öğrenciyi seçin.')
    .trim()
    .min(1, 'Öğrenciyi seçin.')
    .max(100)
    .describe('Öğrencinin kaydı (veli yalnız kendi çocuğu, öğrenci yalnız kendisi)'),
  choices: z
    .array(z.uuid('Kulüp geçersiz.'), 'Tercihleri girin.')
    .max(
      CLUB_SELECTION_CHOICES_MAX,
      `En çok ${String(CLUB_SELECTION_CHOICES_MAX)} tercih girebilirsiniz.`,
    )
    .refine((ids) => new Set(ids).size === ids.length, 'Aynı kulüp iki kez seçilmiş.')
    .describe('Sıralı tercihler (ilk en çok istenen); boş liste tercihi geri çeker'),
})
export type ClubSelectionPreferenceFields = z.output<typeof clubSelectionPreferenceSchema>

export const clubSelectionConfirmSchema = z.strictObject({
  digest: z
    .string('Önizlemeyi yenileyin.')
    .regex(/^[0-9a-f]{14}$/, 'Önizlemeyi yenileyin.')
    .describe('Önizlemenin özeti; sonuç o andan beri değiştiyse 409'),
})

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'rule', path })
const conflict = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'conflict', path })

export interface StoredPeriodFields {
  name: string
  academicYear: number
  term: 1 | 2 | null
  openDate: string
  closeDate: string
  clubIds: readonly string[]
  maxChoices: number
  seatsPerStudent: number
  gradeLevels: readonly number[]
}

export interface PeriodState {
  openDate: string
  closeDate: string
  drawn: boolean
  confirmed: boolean
}

/** Dönemin aşaması; "bugün" Europe/Istanbul takvim günüdür. */
export function clubSelectionPhase(period: PeriodState, today: string): ClubSelectionPhase {
  if (period.confirmed) return 'confirmed'
  if (period.drawn) return 'drawn'
  if (today < period.openDate) return 'upcoming'
  if (today <= period.closeDate) return 'open'
  return 'closed'
}

/** Sınıf düzeyi süzgeci: boş liste herkesi alır; düzeyi bilinmeyen öğrenci süzgece takılır. */
export function gradeEligible(gradeLevels: readonly number[], grade: number | undefined): boolean {
  if (gradeLevels.length === 0) return true
  return grade !== undefined && gradeLevels.includes(grade)
}

function assertClubsFound(missingClubIds: readonly string[]) {
  if (missingClubIds.length > 0)
    throw ruleError('club_selection_club_not_found', 'Seçilen kulüplerden biri bulunamadı.', [
      'clubIds',
    ])
}

const sorted = (values: readonly (string | number)[]) =>
  [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(',')

/** Yeni dönem (K-505): kulüpler kurumun arşivlenmemiş kulüpleri; kapanış bugünden önce olamaz. */
export function planClubSelectionPeriod(
  input: ClubSelectionPeriodFields,
  checks: { today: string; missingClubIds: readonly string[] },
): void {
  assertClubsFound(checks.missingClubIds)
  if (input.closeDate < checks.today)
    throw ruleError('club_selection_closes_past', 'Kapanış günü bugünden önce olamaz.', [
      'closeDate',
    ])
}

/**
 * Dönem düzenleme (K-505): kura çekildiyse dönem değişmez (422); tercih girilmişse yalnız ad ve
 * tarihler değişir. Tarih değişirse kapanış bugünden önce olamaz. Değişen alan adları döner;
 * değişiklik yoksa 422.
 */
export function planClubSelectionPeriodUpdate(
  current: StoredPeriodFields & PeriodState,
  input: ClubSelectionPeriodUpdateFields,
  checks: { today: string; hasPreferences: boolean; missingClubIds: readonly string[] },
): { next: StoredPeriodFields; changed: (keyof StoredPeriodFields)[] } {
  if (current.drawn || current.confirmed)
    throw ruleError('club_selection_locked', 'Kura çekilen dönem değiştirilemez.')
  const next: StoredPeriodFields = {
    name: input.name ?? current.name,
    academicYear: input.academicYear ?? current.academicYear,
    term: input.term === undefined ? current.term : input.term,
    openDate: input.openDate ?? current.openDate,
    closeDate: input.closeDate ?? current.closeDate,
    clubIds: input.clubIds ?? current.clubIds,
    maxChoices: input.maxChoices ?? current.maxChoices,
    seatsPerStudent: input.seatsPerStudent ?? current.seatsPerStudent,
    gradeLevels: input.gradeLevels ?? current.gradeLevels,
  }
  const same = (key: keyof StoredPeriodFields) => {
    const a = next[key]
    const b = current[key]
    return Array.isArray(a) && Array.isArray(b) ? sorted(a) === sorted(b) : a === b
  }
  const changed = (Object.keys(next) as (keyof StoredPeriodFields)[]).filter((key) => !same(key))
  if (changed.length === 0) throw ruleError('club_selection_unchanged', 'Dönemde değişiklik yok.')
  const structural = changed.filter(
    (key) => !['name', 'openDate', 'closeDate'].includes(key as string),
  )
  if (structural.length > 0 && checks.hasPreferences)
    throw ruleError(
      'club_selection_has_preferences',
      'Tercih girilmiş dönemde yalnız ad ve tarihler değişebilir.',
      [structural[0] as string],
    )
  if (changed.includes('clubIds')) assertClubsFound(checks.missingClubIds)
  if (next.closeDate < next.openDate)
    throw ruleError('club_selection_date_order', 'Kapanış günü açılıştan önce olamaz.', [
      'closeDate',
    ])
  if (
    (changed.includes('closeDate') || changed.includes('openDate')) &&
    next.closeDate < checks.today
  )
    throw ruleError('club_selection_closes_past', 'Kapanış günü bugünden önce olamaz.', [
      'closeDate',
    ])
  if (next.maxChoices > next.clubIds.length)
    throw ruleError('club_selection_choices_over_clubs', 'Tercih sayısı kulüp sayısını aşamaz.', [
      'maxChoices',
    ])
  if (next.seatsPerStudent > next.maxChoices)
    throw ruleError(
      'club_selection_seats_over_choices',
      'Atanacak kulüp sayısı tercih sayısını aşamaz.',
      ['seatsPerStudent'],
    )
  return { next, changed }
}

const PHASE_ENTRY_ERRORS: Record<Exclude<ClubSelectionPhase, 'open'>, string> = {
  upcoming: 'Tercih dönemi henüz açılmadı.',
  closed: 'Tercih dönemi kapandı; tercihler değiştirilemez.',
  drawn: 'Kura çekildi; tercihler değiştirilemez.',
  confirmed: 'Dağıtım onaylandı; tercihler değiştirilemez.',
}

/**
 * Tercih girişi (K-505): yalnız dönem açıkken; öğrenci kurumun etkin öğrencisi ve hedef sınıf
 * düzeyinde; tercih sayısı dönemin üst sınırını aşmaz; her tercih dönemin kulübüdür. Boş liste
 * mevcut tercihi geri çeker (tercih yoksa 422). Dönen değer yazılacak işlemdir.
 */
export function planClubSelectionPreference(
  period: PeriodState & {
    clubIds: readonly string[]
    maxChoices: number
    gradeLevels: readonly number[]
  },
  input: ClubSelectionPreferenceFields,
  checks: {
    today: string
    student: StudentCheck
    grade: number | undefined
    hasPreference: boolean
  },
): 'replace' | 'withdraw' {
  const phase = clubSelectionPhase(period, checks.today)
  if (phase !== 'open') throw ruleError('club_selection_not_open', PHASE_ENTRY_ERRORS[phase])
  assertActiveStudent(checks.student, 'club_selection')
  if (!gradeEligible(period.gradeLevels, checks.grade))
    throw ruleError(
      'club_selection_grade_excluded',
      'Öğrencinin sınıf düzeyi bu tercih dönemine dahil değil.',
      ['studentId'],
    )
  if (input.choices.length === 0) {
    if (!checks.hasPreference)
      throw ruleError('club_selection_no_preference', 'Geri çekilecek tercih yok.', ['choices'])
    return 'withdraw'
  }
  if (input.choices.length > period.maxChoices)
    throw ruleError(
      'club_selection_too_many_choices',
      `En çok ${String(period.maxChoices)} tercih girebilirsiniz.`,
      ['choices'],
    )
  const offered = new Set(period.clubIds)
  input.choices.forEach((clubId, index) => {
    if (!offered.has(clubId))
      throw ruleError(
        'club_selection_club_not_in_period',
        'Seçilen kulüp bu tercih dönemine dahil değil.',
        ['choices', String(index)],
      )
  })
  return 'replace'
}

/** Kura (K-506): yalnız kapanmış ve henüz kurası çekilmemiş, tercihi olan dönemde; bir kez. */
export function planClubSelectionDraw(
  period: PeriodState,
  checks: { today: string; preferenceCount: number },
): void {
  const phase = clubSelectionPhase(period, checks.today)
  if (phase === 'confirmed')
    throw conflict('club_selection_already_confirmed', 'Dağıtım zaten onaylandı.')
  if (phase === 'drawn') throw conflict('club_selection_already_drawn', 'Kura zaten çekildi.')
  if (phase !== 'closed')
    throw ruleError('club_selection_still_open', 'Kura tercih dönemi kapandıktan sonra çekilir.')
  if (checks.preferenceCount === 0)
    throw ruleError('club_selection_no_preferences', 'Dönemde tercih yok; kura çekilemez.')
}

/**
 * Onay (K-507): kurası çekilmiş, onaylanmamış dönemde; gönderilen özet güncel önizlemenin
 * özetiyle aynı olmalı (arada üyelik ya da kontenjan değiştiyse 409). İkinci onay 409.
 */
export function planClubSelectionConfirm(
  period: PeriodState,
  checks: { today: string; digest: string; currentDigest: string },
): void {
  const phase = clubSelectionPhase(period, checks.today)
  if (phase === 'confirmed')
    throw conflict('club_selection_already_confirmed', 'Dağıtım zaten onaylandı.')
  if (phase !== 'drawn')
    throw ruleError('club_selection_not_drawn', 'Önce kura çekin ve önizlemeyi inceleyin.')
  if (checks.digest !== checks.currentDigest)
    throw conflict(
      'club_selection_preview_stale',
      'Önizlemeden sonra kulüp üyelikleri ya da kontenjanlar değişti; önizlemeyi yenileyin.',
      ['digest'],
    )
}

// --- Dağıtım -------------------------------------------------------------------------------------

/**
 * Tohumdan 32 bit başlangıç durumu (xmur3 karması). Aynı tohum aynı diziyi verir; dağıtım
 * yeniden üretilebilir.
 */
function seedState(seed: string): number {
  let hash = 1779033703 ^ seed.length
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353)
    hash = (hash << 13) | (hash >>> 19)
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507)
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909)
  return (hash ^ (hash >>> 16)) >>> 0
}

/** Tohumlu sözde rastgele sayı üreteci (mulberry32); `[0, 1)`. */
export function seededRandom(seed: string): () => number {
  let state = seedState(seed)
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Kura sırası: öğrenci kimlikleri kod birimine göre sıralanır (girdi sırası sonucu etkilemez),
 * sonra tohumla Fisher–Yates karıştırılır.
 */
export function lotteryOrder(studentIds: readonly string[], seed: string): string[] {
  const order = [...new Set(studentIds)].sort(byCodeUnit)
  const random = seededRandom(seed)
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const current = order[index] as string
    order[index] = order[swap] as string
    order[swap] = current
  }
  return order
}

export interface AllocationClub {
  id: string
  capacity: number
  /** Kulübün şu anki etkin üyeleri. */
  memberStudentIds: readonly string[]
}

export interface AllocationPreference {
  studentId: string
  /** Sıralı kulüp kimlikleri; ilk en çok istenen. */
  choices: readonly string[]
}

export interface AllocationInput {
  seed: string
  seatsPerStudent: number
  clubs: readonly AllocationClub[]
  preferences: readonly AllocationPreference[]
}

export interface AllocationAssignment {
  studentId: string
  clubId: string
  /** Öğrencinin tercih sırası (1 ilk tercih). */
  rank: number
  /** Atamanın yapıldığı tur (1…). */
  round: number
}

export interface AllocationWaitlistEntry {
  clubId: string
  studentId: string
  rank: number
  /** Kulübün yedek listesindeki sıra (1…). */
  position: number
}

export interface AllocationStudent {
  studentId: string
  lotteryPosition: number
  /** Atanabilecek en çok kulüp: atanacak sayı ile üye olmadığı tercihlerin küçüğü. */
  wanted: number
  assigned: number
}

export interface AllocationClubSummary {
  clubId: string
  capacity: number
  members: number
  seatsBefore: number
  assigned: number
  seatsAfter: number
  waitlisted: number
}

export interface Allocation {
  order: string[]
  assignments: AllocationAssignment[]
  waitlist: AllocationWaitlistEntry[]
  students: AllocationStudent[]
  clubs: AllocationClubSummary[]
}

/**
 * Kontenjanlı dağıtım (K-506): rastgele sıralı seri diktatörlük. Kura sırasındaki her öğrenci
 * sırası gelince boş yeri olan en yüksek tercihine yerleşir; atanacak kulüp sayısı birden
 * fazlaysa turlar yılan sırasıyla döner (çift turda kura sırası tersine), böylece ilk sıradaki
 * öğrenci bütün yerleri önce almaz. Kontenjan (kapasite − etkin üye) aşılmaz; öğrencinin zaten üye
 * olduğu kulüp atlanır. Dönemin kulübü olmayan tercih yok sayılır. Yerleşemeyen (atanan sayısı
 * istenenden az) öğrenci, almadığı her tercihinin yedek listesine girer; liste tercih sırası, sonra
 * kura sırasıyla dizilir. Saf ve deterministiktir: aynı girdi ve tohum aynı sonucu verir.
 */
export function allocateClubSeats(input: AllocationInput): Allocation {
  const clubs = new Map(input.clubs.map((club) => [club.id, club]))
  const seats = new Map(
    input.clubs.map((club) => [
      club.id,
      Math.max(0, club.capacity - new Set(club.memberStudentIds).size),
    ]),
  )
  const seatsBefore = new Map(seats)
  const memberOf = new Map<string, Set<string>>()
  for (const club of input.clubs)
    for (const studentId of club.memberStudentIds) {
      const own = memberOf.get(studentId) ?? new Set<string>()
      own.add(club.id)
      memberOf.set(studentId, own)
    }
  const choicesOf = new Map<string, string[]>()
  for (const preference of input.preferences) {
    const seen = new Set<string>()
    choicesOf.set(
      preference.studentId,
      preference.choices.filter((clubId) => {
        if (!clubs.has(clubId) || seen.has(clubId)) return false
        seen.add(clubId)
        return true
      }),
    )
  }
  const order = lotteryOrder([...choicesOf.keys()], input.seed)
  const position = new Map(order.map((studentId, index) => [studentId, index + 1]))
  const assigned = new Map<string, Set<string>>(order.map((studentId) => [studentId, new Set()]))
  const open = (studentId: string) =>
    (choicesOf.get(studentId) ?? []).filter((clubId) => !memberOf.get(studentId)?.has(clubId))
  const wanted = new Map(
    order.map((studentId) => [studentId, Math.min(input.seatsPerStudent, open(studentId).length)]),
  )
  const assignments: AllocationAssignment[] = []
  for (let round = 1; round <= input.seatsPerStudent; round += 1) {
    const turn = round % 2 === 1 ? order : [...order].reverse()
    for (const studentId of turn) {
      const own = assigned.get(studentId) as Set<string>
      if (own.size >= (wanted.get(studentId) ?? 0)) continue
      const choices = choicesOf.get(studentId) ?? []
      const pick = choices.findIndex(
        (clubId) =>
          !own.has(clubId) && !memberOf.get(studentId)?.has(clubId) && (seats.get(clubId) ?? 0) > 0,
      )
      if (pick === -1) continue
      const clubId = choices[pick] as string
      own.add(clubId)
      seats.set(clubId, (seats.get(clubId) ?? 0) - 1)
      assignments.push({ studentId, clubId, rank: pick + 1, round })
    }
  }
  const pending: Omit<AllocationWaitlistEntry, 'position'>[] = []
  for (const studentId of order) {
    const own = assigned.get(studentId) as Set<string>
    if (own.size >= (wanted.get(studentId) ?? 0)) continue
    ;(choicesOf.get(studentId) ?? []).forEach((clubId, index) => {
      if (own.has(clubId) || memberOf.get(studentId)?.has(clubId)) return
      pending.push({ clubId, studentId, rank: index + 1 })
    })
  }
  const waitlist: AllocationWaitlistEntry[] = []
  for (const club of input.clubs) {
    const entries = pending
      .filter((entry) => entry.clubId === club.id)
      .sort(
        (a, b) =>
          a.rank - b.rank || (position.get(a.studentId) ?? 0) - (position.get(b.studentId) ?? 0),
      )
    entries.forEach((entry, index) => waitlist.push({ ...entry, position: index + 1 }))
  }
  return {
    order,
    assignments,
    waitlist,
    students: order.map((studentId) => ({
      studentId,
      lotteryPosition: position.get(studentId) ?? 0,
      wanted: wanted.get(studentId) ?? 0,
      assigned: assigned.get(studentId)?.size ?? 0,
    })),
    clubs: input.clubs.map((club) => {
      const given = assignments.filter((row) => row.clubId === club.id).length
      return {
        clubId: club.id,
        capacity: club.capacity,
        members: new Set(club.memberStudentIds).size,
        seatsBefore: seatsBefore.get(club.id) ?? 0,
        assigned: given,
        seatsAfter: seats.get(club.id) ?? 0,
        waitlisted: waitlist.filter((row) => row.clubId === club.id).length,
      }
    }),
  }
}

/**
 * Önizleme özeti (K-507): atama ve yedek listesinin 56 bit karması (14 onaltılık hane). Onayda
 * yeniden hesaplanır; arada üyelik ya da kontenjan değiştiyse özet tutmaz. Güvenlik amaçlı değildir.
 */
export function allocationDigest(allocation: Pick<Allocation, 'assignments' | 'waitlist'>): string {
  const text = JSON.stringify([
    allocation.assignments.map((row) => [row.studentId, row.clubId, row.rank, row.round]),
    allocation.waitlist.map((row) => [row.clubId, row.studentId, row.rank, row.position]),
  ])
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return value.toString(16).padStart(14, '0')
}

// --- Yedek listesi -------------------------------------------------------------------------------

export type WaitlistStatus = 'waiting' | 'joined' | 'inactive'

export const WAITLIST_STATUS_LABELS = {
  waiting: 'Bekliyor',
  joined: 'Üye oldu',
  inactive: 'Kaydı etkin değil',
} as const satisfies Record<WaitlistStatus, string>

/**
 * Onaylı dönemin bir kulübündeki yedek listesi (K-507): her satırın güncel durumu (kulübe sonradan
 * eklendiyse üye oldu, kaydı etkin değilse atlanır) ve kulüpte boş yer varsa önerilecek ilk
 * bekleyen öğrenci. Öneri yalnız bilgidir; üyelik yönetici tarafından ayrıca eklenir.
 */
export function waitlistView(
  entries: readonly { studentId: string; position: number }[],
  checks: {
    memberStudentIds: ReadonlySet<string>
    activeStudentIds: ReadonlySet<string>
    freeSeats: number
  },
): {
  rows: { studentId: string; position: number; status: WaitlistStatus }[]
  suggestedStudentId: string | null
} {
  const rows = [...entries]
    .sort((a, b) => a.position - b.position)
    .map((entry) => ({
      ...entry,
      status: (checks.memberStudentIds.has(entry.studentId)
        ? 'joined'
        : checks.activeStudentIds.has(entry.studentId)
          ? 'waiting'
          : 'inactive') as WaitlistStatus,
    }))
  const first = rows.find((row) => row.status === 'waiting')
  return {
    rows,
    suggestedStudentId: checks.freeSeats > 0 && first !== undefined ? first.studentId : null,
  }
}

/** `2026–2027 · 1. dönem` ya da `2026–2027`. */
export function clubSelectionTermLabel(academicYear: number, term: number | null): string {
  const year = `${String(academicYear)}–${String(academicYear + 1)}`
  return term === null ? year : `${year} · ${String(term)}. dönem`
}
