import { z } from 'zod'

import { CEFR_LEVELS, enumKeys, type CefrLevel, type Skill } from '../content/taxonomy.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import type { CoordinatorScope } from './coordinator-duties.ts'
import { DomainError } from './errors.ts'

/**
 * Dil okulunda kur (program) tanımı (IST-076; docs/domain/dil-okulu.md DOM-DIL-001, -002, -005…008).
 *
 * - Kur, kurumun öğretim programıdır: dil, tek CEFR seviyesi, isteğe bağlı beceri odağı, toplam ve
 *   haftalık ders saati (45 dk), oturum uzunluğu, en az (açılış) ve en çok mevcut, belgeli olup
 *   olmadığı ve seviyeli kursta sonraki (üst) kur. Tarih, öğretmen, derslik ve fiyat kurda yoktur:
 *   tarihli açılış gruptur (OG-029, DOM-DIL-008), fiyat paket satışındadır (DOM-DIL-050, ON-058).
 * - Durum `draft` → `active` → `archived`; arşiv son durumdur. Etkin kurun dili, seviyesi, saatleri,
 *   oturum uzunluğu ve belge türü değişmez (yeni kur tanımlanır).
 * - e-Özel eşlemesi (DOM-DIL-006): program kodu, onay durumu ve "e-Özel'e işlendi" izi (kim, ne
 *   zaman). Platform e-Özel'e yazmaz; kurum elle işler ve işaretler.
 * - Süre (hafta) saklanmaz: toplam saat ÷ haftalık saat, yukarı yuvarlanır (`courseDurationWeeks`).
 * - Yalnız `language_school` kurumunda bulunur; okulda her işlem 404 `module_unavailable_for_type`.
 *
 * Fonksiyonlar saftır, girdileri değiştirmez; kimlik üretimi, yükleme ve yazma servistedir.
 */

z.config(z.locales.tr())

export const COURSE_STATUSES = ['draft', 'active', 'archived'] as const
export type CourseStatus = (typeof COURSE_STATUSES)[number]

export const COURSE_STATUS_LABELS = {
  draft: 'Taslak',
  active: 'Etkin',
  archived: 'Arşiv',
} as const satisfies Record<CourseStatus, string>

/**
 * Kurun öğretim dili (ISO 639-1). Liste sabittir; kurum değer ekleyemez (seviye ölçeği gibi,
 * DOM-DIL-001). CEFR ölçeği dilden bağımsızdır.
 */
export const COURSE_LANGUAGES = {
  en: 'İngilizce',
  de: 'Almanca',
  fr: 'Fransızca',
  es: 'İspanyolca',
  it: 'İtalyanca',
  ru: 'Rusça',
  ar: 'Arapça',
  zh: 'Çince',
  ja: 'Japonca',
  ko: 'Korece',
  tr: 'Türkçe (yabancılara)',
} as const
export type CourseLanguage = keyof typeof COURSE_LANGUAGES

/** Beceri odağı yalnız dört temel beceriden seçilir (DOM-BEC-001); boş liste genel kurdur. */
export const COURSE_SKILL_FOCUS = [
  'reading',
  'listening',
  'writing',
  'speaking',
] as const satisfies readonly Skill[]
export type CourseSkillFocus = (typeof COURSE_SKILL_FOCUS)[number]

/** Oturum uzunluğu dakika: tek ders saati ya da 90 dakikalık blok (ÖÖKY md. 10/6, DOM-DIL-002). */
export const COURSE_SESSION_MINUTES = [45, 90] as const
export type CourseSessionMinutes = (typeof COURSE_SESSION_MINUTES)[number]
/** Bir ders saati 45 dakikadır (DOM-DIL-002). */
export const LESSON_HOUR_MINUTES = 45

/** Grup mevcudu tavanı (DOM-DIL-040); kurun en çok mevcudu bunu aşamaz. */
export const COURSE_GROUP_CAPACITY_MAX = 18
/** İşletme sınırları: toplam saat C2 birikimli GLH üst değerinin üstünde kalmaz (DOM-DIL-002). */
export const COURSE_TOTAL_HOURS_MAX = 1200
export const COURSE_WEEKLY_HOURS_MAX = 40
export const COURSE_NAME_MAX = 120
export const COURSE_DESCRIPTION_MAX = 1000

/** e-Özel kurs programı onay durumu (DOM-DIL-006). */
export const COURSE_EOZEL_APPROVALS = ['not_submitted', 'pending', 'approved', 'rejected'] as const
export type CourseEOzelApproval = (typeof COURSE_EOZEL_APPROVALS)[number]
export const COURSE_EOZEL_APPROVAL_LABELS = {
  not_submitted: "e-Özel'e işlenmedi",
  pending: 'Onay bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
} as const satisfies Record<CourseEOzelApproval, string>
/** e-Özel kaydında işaretlenebilen durumlar; `not_submitted` yalnız sıfırlamayla oluşur. */
export const COURSE_EOZEL_MARKS = ['pending', 'approved', 'rejected'] as const
export const COURSE_PROGRAM_CODE_MAX = 50
const PROGRAM_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9./_-]*$/

export type CourseEOzel = {
  programCode: string | null
  approval: CourseEOzelApproval
  /** Kurumun e-Özel kaydını son işaretlediği an (ISO UTC); işlenmemişse `null`. */
  recordedAt: string | null
  /** İşaretleyen kullanıcı. */
  // kvkk: K
  recordedByUserId: string | null
}

export type Course = {
  id: string
  name: string
  language: CourseLanguage
  level: CefrLevel
  skillFocus: readonly CourseSkillFocus[]
  description: string | null
  /** Toplam ders saati (45 dk). */
  totalHours: number
  weeklyHours: number
  sessionMinutes: CourseSessionMinutes
  /** Asgari açılış sayısı (DOM-DIL-042). */
  minLearners: number
  /** En çok mevcut (≤ 18, DOM-DIL-040). */
  maxLearners: number
  /** Belgeli kurs: bitirene MEBBİS Kurs Bitirme Belgesi düzenlenir (DOM-DIL-080). */
  certified: boolean
  /** Seviyeli kursta geçen kursiyerin devam ettiği kur (DOM-DIL-007). */
  nextCourseId: string | null
  status: CourseStatus
  activatedAt: string | null
  archivedAt: string | null
  eOzel: CourseEOzel
}

const name = z
  .string()
  .trim()
  .min(1, 'Kur adını yazın.')
  .max(COURSE_NAME_MAX, `Kur adı en çok ${COURSE_NAME_MAX} karakter.`)
const language = z.enum(enumKeys(COURSE_LANGUAGES), { error: 'Bir dil seçin.' })
const level = z.enum(enumKeys(CEFR_LEVELS), { error: 'Bir CEFR seviyesi seçin.' })
const skillFocus = z
  .array(z.enum(COURSE_SKILL_FOCUS, { error: 'Beceri odağı dört temel beceriden seçilir.' }))
  .max(COURSE_SKILL_FOCUS.length)
  .refine((list) => new Set(list).size === list.length, 'Bir beceri iki kez seçilemez.')
const description = z
  .string()
  .trim()
  .max(COURSE_DESCRIPTION_MAX, `Açıklama en çok ${COURSE_DESCRIPTION_MAX} karakter.`)
  .nullable()
const hours = (field: string, max: number) =>
  z
    .number({ error: `${field} sayı olmalı.` })
    .int(`${field} tam sayı olmalı.`)
    .min(1, `${field} en az 1 olmalı.`)
    .max(max, `${field} en çok ${max} olabilir.`)
const totalHours = hours('Toplam ders saati', COURSE_TOTAL_HOURS_MAX)
const weeklyHours = hours('Haftalık ders saati', COURSE_WEEKLY_HOURS_MAX)
const sessionMinutes = z.literal(COURSE_SESSION_MINUTES, {
  error: 'Oturum 45 ya da 90 dakika olur.',
})
const learners = (field: string) =>
  z
    .number({ error: `${field} sayı olmalı.` })
    .int(`${field} tam sayı olmalı.`)
    .min(1, `${field} en az 1 olmalı.`)
    .max(COURSE_GROUP_CAPACITY_MAX, `${field} en çok ${COURSE_GROUP_CAPACITY_MAX} olabilir.`)
const minLearners = learners('En az mevcut')
const maxLearners = learners('En çok mevcut')
const courseRef = z.uuid('Geçerli bir kur seçin.')

export const createCourseSchema = z.strictObject({
  name,
  /** Verilmezse `en`. */
  language: language.optional(),
  level,
  skillFocus: skillFocus.optional(),
  description: description.optional(),
  totalHours,
  weeklyHours,
  /** Verilmezse 45. */
  sessionMinutes: sessionMinutes.optional(),
  minLearners,
  maxLearners,
  /** Verilmezse `false` (belgesiz). */
  certified: z.boolean().optional(),
  nextCourseId: courseRef.nullable().optional(),
})
export type CreateCourseInput = z.infer<typeof createCourseSchema>

const atLeastOne = (value: Record<string, unknown>) =>
  Object.values(value).some((item) => item !== undefined)

export const updateCourseSchema = z
  .strictObject({
    name: name.optional(),
    language: language.optional(),
    level: level.optional(),
    skillFocus: skillFocus.optional(),
    description: description.optional(),
    totalHours: totalHours.optional(),
    weeklyHours: weeklyHours.optional(),
    sessionMinutes: sessionMinutes.optional(),
    minLearners: minLearners.optional(),
    maxLearners: maxLearners.optional(),
    certified: z.boolean().optional(),
    nextCourseId: courseRef.nullable().optional(),
  })
  .refine(atLeastOne, 'Değiştirilecek bir alan gönderin.')
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>

export const courseEOzelSchema = z.strictObject({
  programCode: z
    .string()
    .trim()
    .min(1, 'e-Özel program kodunu yazın.')
    .max(COURSE_PROGRAM_CODE_MAX, `Program kodu en çok ${COURSE_PROGRAM_CODE_MAX} karakter.`)
    .regex(PROGRAM_CODE_PATTERN, 'Program kodu harf, rakam ve . / _ - içerir.'),
  approval: z.enum(COURSE_EOZEL_MARKS, { error: 'e-Özel onay durumunu seçin.' }),
})
export type CourseEOzelInput = z.infer<typeof courseEOzelSchema>

/**
 * Etkin kurda değişmeyen alanlar (DOM-DIL-005): dil, seviye, saatler, oturum ve belge türü kurun
 * kimliğidir; gruplar, devam ve kur geçme hesabı bunlara dayanır. Aynı alanlar e-Özel kurs planına
 * eşlenir (DOM-DIL-006): taslakta değişirlerse e-Özel izi sıfırlanır.
 */
export const COURSE_PROGRAM_FIELDS = [
  'language',
  'level',
  'totalHours',
  'weeklyHours',
  'sessionMinutes',
  'certified',
] as const satisfies readonly (keyof Course)[]

const NO_EOZEL: CourseEOzel = {
  programCode: null,
  approval: 'not_submitted',
  recordedAt: null,
  recordedByUserId: null,
}

/**
 * Ad tekilliği anahtarı (DOM-DIL-005): NFC, baş/son boşluksuz, Türkçe küçük harf. Veritabanı aynı
 * anahtarı `courses.name_key` kolonunda saklar (eğitim yılı dönem adıyla aynı yöntem).
 */
export const courseNameKey = (value: string) =>
  value.normalize('NFC').trim().toLocaleLowerCase('tr-TR')

/** Program kodu tekilliği büyük/küçük harfe duyarsızdır (`courses.e_ozel_program_key`). */
export const courseProgramKey = (value: string) => value.trim().toUpperCase()

/** Kurun süresi (hafta): toplam saat ÷ haftalık saat, yukarı yuvarlanır; saklanmaz. */
export const courseDurationWeeks = (course: Pick<Course, 'totalHours' | 'weeklyHours'>) =>
  Math.ceil(course.totalHours / course.weeklyHours)

/** Seviye sırası; `Pre-A1` 0 … `C2` 9 (DOM-DIL-001). */
export const levelRank = (value: CefrLevel) => CEFR_LEVELS[value].rank

/** Kurlar seviye sırasına, sonra ada göre (kararlı). */
export function orderedCourses<T extends Pick<Course, 'level' | 'name' | 'id'>>(
  courses: readonly T[],
): T[] {
  return [...courses].sort(
    (a, b) =>
      levelRank(a.level) - levelRank(b.level) ||
      a.name.localeCompare(b.name, 'tr') ||
      a.id.localeCompare(b.id),
  )
}

/** Kur yalnız dil okulunda bulunur (DOM-DIL-005); okulda yok sayılır (404, DOM-YTK-012). */
export function assertLanguageSchoolCourses(institutionType: InstitutionType): void {
  if (institutionType !== 'language_school')
    throw new DomainError(
      'module_unavailable_for_type',
      'Kur tanımı yalnız dil okulunda kullanılır.',
      { kind: 'not_found' },
    )
}

/** Kuru yöneten: rol ve (öğretmende) akademik koordinatör kapsamı (DOM-YTK-027). */
export type CourseManager = { role: Role; coordination: CoordinatorScope }

/**
 * Kuru yönetme yetkisi (DOM-DIL-005): yönetici her kuru; öğretmen yalnız akademik koordinatörü
 * olduğu seviyelerin kurlarını yönetir. Seviye değişiminde eski ve yeni seviye birlikte aranır.
 * Ön büro, öğrenci ve veli yönetmez (rol reddi API'de daha önce gelir).
 */
export function assertCourseManager(manager: CourseManager, levels: readonly CefrLevel[]): void {
  if (manager.role === 'yonetici') return
  const covered = manager.coordination.cefrLevels
  if (manager.role === 'ogretmen' && levels.every((item) => covered.includes(item))) return
  throw new DomainError(
    'course_coordinator_required',
    'Bu seviyenin kurlarını yalnız yönetici ya da seviyenin akademik koordinatörü yönetir.',
    { kind: 'forbidden' },
  )
}

function requireCourse(courses: readonly Course[], courseId: string): Course {
  const course = courses.find((item) => item.id === courseId)
  if (!course) throw new DomainError('course_not_found', 'Kur bulunamadı.', { kind: 'not_found' })
  return course
}

function assertNotArchived(course: Course) {
  if (course.status === 'archived')
    throw new DomainError('course_archived', 'Arşivlenmiş kur değiştirilemez.', {
      kind: 'conflict',
    })
}

/**
 * Alanlar arası kurallar (DOM-DIL-002, -005, -040, -042): toplam saat haftalık saatten az olamaz;
 * 90 dakikalık blokta haftalık ve toplam saat çifttir (oturum iki ders saatidir); en az mevcut en
 * çok mevcudu aşamaz.
 */
function assertConsistent(course: Course) {
  if (course.totalHours < course.weeklyHours)
    throw new DomainError(
      'course_hours_invalid',
      'Toplam ders saati haftalık ders saatinden az olamaz.',
      { path: ['totalHours'] },
    )
  const perSession = course.sessionMinutes / LESSON_HOUR_MINUTES
  if (course.weeklyHours % perSession !== 0 || course.totalHours % perSession !== 0)
    throw new DomainError(
      'course_session_mismatch',
      '90 dakikalık oturumda haftalık ve toplam ders saati çift sayı olmalı.',
      { path: ['weeklyHours'] },
    )
  if (course.minLearners > course.maxLearners)
    throw new DomainError(
      'course_learners_invalid',
      'En az mevcut en çok mevcuttan büyük olamaz.',
      { path: ['minLearners'] },
    )
}

/** Ad kurumun arşivlenmemiş kurlarında tekildir (DOM-DIL-005). */
function assertUniqueName(courses: readonly Course[], course: Course) {
  const key = courseNameKey(course.name)
  if (
    courses.some(
      (other) =>
        other.id !== course.id && other.status !== 'archived' && courseNameKey(other.name) === key,
    )
  )
    throw new DomainError('course_name_exists', 'Bu adla tanımlı bir kur var.', {
      kind: 'conflict',
      path: ['name'],
    })
}

/**
 * Bağın iki ucu (DOM-DIL-007): sonraki kur aynı dildedir, seviyesi öncekinden düşük değildir.
 * `edited` hangi ucun formda değiştiğini söyler; hata yolu ve metni o uca göre yazılır.
 */
function assertLinkCompatible(previous: Course, next: Course, edited: 'previous' | 'next') {
  const onPrevious = edited === 'previous'
  if (next.language !== previous.language)
    throw new DomainError(
      'course_next_language',
      onPrevious
        ? 'Sonraki kur aynı dilde olmalı.'
        : 'Bu kuru sonraki kur gösteren kurlarla aynı dilde olmalı.',
      { path: [onPrevious ? 'nextCourseId' : 'language'] },
    )
  if (levelRank(next.level) < levelRank(previous.level))
    throw new DomainError(
      'course_next_level',
      onPrevious
        ? 'Sonraki kurun seviyesi bu kurun seviyesinden düşük olamaz.'
        : 'Seviye, bu kuru sonraki kur gösteren kurun seviyesinden düşük olamaz.',
      { path: [onPrevious ? 'nextCourseId' : 'level'] },
    )
}

/**
 * Bu kuru sonraki kur gösteren arşivlenmemiş kurlar (DOM-DIL-007): kurun dili ya da seviyesi
 * değişince bağ onların tarafından da denetlenir; yoksa B1 → B2 bağındaki B2, A1'e çekilebilirdi.
 */
function assertPreviousCourses(courses: readonly Course[], course: Course) {
  for (const previous of courses)
    if (
      previous.id !== course.id &&
      previous.status !== 'archived' &&
      previous.nextCourseId === course.id
    )
      assertLinkCompatible(previous, course, 'next')
}

/**
 * Sonraki kur bağı (DOM-DIL-007): bağlanan kur kurumda vardır ve arşivde değildir, kurun kendisi
 * değildir, aynı dildedir, seviyesi bu kurunkinden düşük değildir (aynı seviyede `B1.1 → B1.2`
 * olur) ve zincir döngü kurmaz.
 */
function assertNextCourse(courses: readonly Course[], course: Course) {
  if (course.nextCourseId === null) return
  const path = ['nextCourseId']
  if (course.nextCourseId === course.id)
    throw new DomainError('course_next_invalid', 'Kur kendisinin sonraki kuru olamaz.', { path })
  const next = courses.find((item) => item.id === course.nextCourseId)
  if (!next || next.status === 'archived')
    throw new DomainError('course_next_not_found', 'Sonraki kur bulunamadı.', { path })
  assertLinkCompatible(course, next, 'previous')
  const byId = new Map(courses.map((item) => [item.id, item]))
  byId.set(course.id, course)
  const seen = new Set<string>([course.id])
  for (let cursor = byId.get(course.nextCourseId); cursor;) {
    if (seen.has(cursor.id))
      throw new DomainError('course_next_cycle', 'Kur zinciri kendine dönemez.', { path })
    seen.add(cursor.id)
    cursor = cursor.nextCourseId === null ? undefined : byId.get(cursor.nextCourseId)
  }
}

function assertCourse(courses: readonly Course[], course: Course) {
  assertConsistent(course)
  assertUniqueName(courses, course)
  assertNextCourse(courses, course)
}

/**
 * Yeni kur (DOM-DIL-005): taslak açılır, e-Özel izi boştur. Yalnız dil okulunda; yönetici ya da
 * seviyenin akademik koordinatörü. Ad tekil (409 `course_name_exists`), alanlar arası kurallar 422.
 */
export function planCourseCreation(input: {
  institutionType: InstitutionType
  manager: CourseManager
  courses: readonly Course[]
  input: unknown
  courseId: string
}): Course {
  assertLanguageSchoolCourses(input.institutionType)
  const data = createCourseSchema.parse(input.input)
  assertCourseManager(input.manager, [data.level])
  const course: Course = {
    id: input.courseId,
    name: data.name,
    language: data.language ?? 'en',
    level: data.level,
    skillFocus: data.skillFocus ?? [],
    description: data.description || null,
    totalHours: data.totalHours,
    weeklyHours: data.weeklyHours,
    sessionMinutes: data.sessionMinutes ?? LESSON_HOUR_MINUTES,
    minLearners: data.minLearners,
    maxLearners: data.maxLearners,
    certified: data.certified ?? false,
    nextCourseId: data.nextCourseId ?? null,
    status: 'draft',
    activatedAt: null,
    archivedAt: null,
    eOzel: NO_EOZEL,
  }
  assertCourse(input.courses, course)
  return course
}

const sameValue = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((item, index) => item === b[index])
    : a === b

/**
 * Kuru değiştirir (DOM-DIL-005…007). Arşivli kur 409 `course_archived`. Etkin kurun program
 * alanları (`COURSE_PROGRAM_FIELDS`) değişmez: 422 `course_active_locked`. Taslakta program alanı
 * değişirse e-Özel izi sıfırlanır (`not_submitted`; program kodu kalır): kayıt yeniden işlenmeli
 * (DOM-DIL-006). En çok mevcut kapanmamış grupların kapasitesinin altına inmez (422
 * `course_max_below_group_capacity`, DOM-DIL-008); `openGroups` `lib/language-groups.ts`
 * `groupsBlockingCourseArchive`'dır. Yanıt yeni kur ve gerçekten değişen alan adlarıdır (denetim).
 */
export function planCourseUpdate(input: {
  institutionType: InstitutionType
  manager: CourseManager
  courses: readonly Course[]
  courseId: string
  input: unknown
  openGroups?: readonly { courseId: string; name: string; capacity: number }[]
}): { course: Course; fields: string[] } {
  assertLanguageSchoolCourses(input.institutionType)
  const data = updateCourseSchema.parse(input.input)
  const current = requireCourse(input.courses, input.courseId)
  assertCourseManager(input.manager, [current.level, data.level ?? current.level])
  assertNotArchived(current)
  const next: Course = {
    ...current,
    name: data.name ?? current.name,
    language: data.language ?? current.language,
    level: data.level ?? current.level,
    skillFocus: data.skillFocus ?? current.skillFocus,
    description: data.description === undefined ? current.description : data.description || null,
    totalHours: data.totalHours ?? current.totalHours,
    weeklyHours: data.weeklyHours ?? current.weeklyHours,
    sessionMinutes: data.sessionMinutes ?? current.sessionMinutes,
    minLearners: data.minLearners ?? current.minLearners,
    maxLearners: data.maxLearners ?? current.maxLearners,
    certified: data.certified ?? current.certified,
    nextCourseId: data.nextCourseId === undefined ? current.nextCourseId : data.nextCourseId,
  }
  const fields = (Object.keys(data) as (keyof UpdateCourseInput)[]).filter(
    (field) => data[field] !== undefined && !sameValue(next[field], current[field]),
  )
  const programChanged = fields.filter((field) =>
    (COURSE_PROGRAM_FIELDS as readonly string[]).includes(field),
  )
  if (current.status === 'active' && programChanged.length > 0)
    throw new DomainError(
      'course_active_locked',
      'Etkin kurun dili, seviyesi, saatleri, oturumu ve belge türü değişmez; yeni kur tanımlayın.',
      { path: [programChanged[0] ?? 'level'] },
    )
  assertCourse(input.courses, next)
  const crowded = (input.openGroups ?? []).find(
    (group) => group.courseId === current.id && group.capacity > next.maxLearners,
  )
  if (fields.includes('maxLearners') && crowded)
    throw new DomainError(
      'course_max_below_group_capacity',
      `En çok mevcut "${crowded.name}" grubunun kapasitesinden (${crowded.capacity}) az olamaz; önce grubun kapasitesini düşürün.`,
      { path: ['maxLearners'] },
    )
  if (fields.includes('language') || fields.includes('level'))
    assertPreviousCourses(input.courses, next)
  const resetEOzel = programChanged.length > 0 && current.eOzel.approval !== 'not_submitted'
  return {
    course: resetEOzel
      ? { ...next, eOzel: { ...NO_EOZEL, programCode: next.eOzel.programCode } }
      : next,
    fields: resetEOzel ? [...fields, 'eOzel'] : fields,
  }
}

/**
 * Taslak kuru etkinleştirir (DOM-DIL-005, -006). Yalnız taslak (409 `course_not_draft`). Belgeli kur
 * e-Özel'de onaylanmadan etkinleşmez (422 `course_program_not_approved`).
 */
export function planCourseActivation(input: {
  institutionType: InstitutionType
  manager: CourseManager
  courses: readonly Course[]
  courseId: string
  now: string
}): Course {
  assertLanguageSchoolCourses(input.institutionType)
  const course = requireCourse(input.courses, input.courseId)
  assertCourseManager(input.manager, [course.level])
  if (course.status !== 'draft')
    throw new DomainError('course_not_draft', 'Yalnız taslak kur etkinleştirilir.', {
      kind: 'conflict',
    })
  if (course.certified && course.eOzel.approval !== 'approved')
    throw new DomainError(
      'course_program_not_approved',
      "Belgeli kur, programı e-Özel'de onaylanmadan etkinleştirilemez.",
      { path: ['eOzel', 'approval'] },
    )
  return { ...course, status: 'active', activatedAt: input.now }
}

/**
 * Kuru arşivler (DOM-DIL-005, -007, -008): taslak ya da etkin kur arşive alınır, arşiv geri
 * alınmaz. Arşivlenmemiş başka bir kurun sonraki kuruysa arşivlenmez (422 `course_has_dependents`);
 * önce o bağ kaldırılır. Planlanan, açık ya da devam eden grubu varsa arşivlenmez (422
 * `course_has_open_groups`); `openGroups` `lib/language-groups.ts` `groupsBlockingCourseArchive`'dır.
 */
export function planCourseArchive(input: {
  institutionType: InstitutionType
  manager: CourseManager
  courses: readonly Course[]
  courseId: string
  now: string
  openGroups?: readonly { courseId: string; name: string }[]
}): Course {
  assertLanguageSchoolCourses(input.institutionType)
  const course = requireCourse(input.courses, input.courseId)
  assertCourseManager(input.manager, [course.level])
  assertNotArchived(course)
  const dependent = input.courses.find(
    (other) => other.status !== 'archived' && other.nextCourseId === course.id,
  )
  if (dependent)
    throw new DomainError(
      'course_has_dependents',
      `Bu kur "${dependent.name}" kurunun sonraki kuru; önce o bağı kaldırın.`,
      { path: ['courseId'] },
    )
  const group = (input.openGroups ?? []).find((item) => item.courseId === course.id)
  if (group)
    throw new DomainError(
      'course_has_open_groups',
      `Bu kurun kapanmamış grubu var ("${group.name}"); önce grubu tamamlayın ya da iptal edin.`,
      { path: ['courseId'] },
    )
  return { ...course, status: 'archived', archivedAt: input.now }
}

/**
 * e-Özel kaydını işaretler (DOM-DIL-006): program kodu ve onay durumu (`pending`, `approved`,
 * `rejected`) yazılır, iz işaretleyen ve anla tutulur. Arşivli kur 409 `course_archived`; program
 * kodu kurumun arşivlenmemiş kurlarında tekildir (409 `course_program_code_exists`). Etkin belgeli
 * kurun e-Özel kaydı değişmez (422 `course_active_locked`): onaysız etkin belgeli kur oluşmaz.
 * Yetki yalnız yöneticidedir (rol API'de).
 */
export function planCourseEOzelRecord(input: {
  institutionType: InstitutionType
  courses: readonly Course[]
  courseId: string
  input: unknown
  actorUserId: string
  now: string
}): Course {
  assertLanguageSchoolCourses(input.institutionType)
  const data = courseEOzelSchema.parse(input.input)
  const course = requireCourse(input.courses, input.courseId)
  assertNotArchived(course)
  if (course.status === 'active' && course.certified)
    throw new DomainError(
      'course_active_locked',
      'Etkin belgeli kurun e-Özel kaydı değişmez; yeni kur tanımlayın.',
      { path: ['approval'] },
    )
  const key = courseProgramKey(data.programCode)
  if (
    input.courses.some(
      (other) =>
        other.id !== course.id &&
        other.status !== 'archived' &&
        other.eOzel.programCode !== null &&
        courseProgramKey(other.eOzel.programCode) === key,
    )
  )
    throw new DomainError('course_program_code_exists', 'Bu e-Özel program kodu başka kurda.', {
      kind: 'conflict',
      path: ['programCode'],
    })
  return {
    ...course,
    eOzel: {
      programCode: data.programCode,
      approval: data.approval,
      recordedAt: input.now,
      recordedByUserId: input.actorUserId,
    },
  }
}

const isLearner = (role: Role) => role === 'ogrenci' || role === 'veli'

/** Kur rolün okuyabildiği kurlardan mı (DOM-DIL-005): öğrenci ve veli yalnız etkin kurları görür. */
export const courseVisibleTo = (course: Pick<Course, 'status'>, role: Role) =>
  !isLearner(role) || course.status === 'active'

/**
 * Okuma görünümü (DOM-DIL-005). Personel (yönetici, ön büro, öğretmen) bütün alanları görür.
 * Öğrenci ve veli yalnız etkin kurun katalog alanlarını görür: en az mevcut, durum, e-Özel
 * kaydı ve işlem anları dönmez; sonraki kur yalnız etkinse görünür. Süre hesaplanır.
 */
export function courseView(course: Course, role: Role, courses: readonly Course[] = []) {
  const base = {
    id: course.id,
    name: course.name,
    language: course.language,
    level: course.level,
    skillFocus: [...course.skillFocus],
    description: course.description,
    totalHours: course.totalHours,
    weeklyHours: course.weeklyHours,
    sessionMinutes: course.sessionMinutes,
    durationWeeks: courseDurationWeeks(course),
    maxLearners: course.maxLearners,
    certified: course.certified,
  }
  if (isLearner(role)) {
    const next = courses.find((item) => item.id === course.nextCourseId)
    return { ...base, nextCourseId: next?.status === 'active' ? next.id : null }
  }
  return {
    ...base,
    nextCourseId: course.nextCourseId,
    minLearners: course.minLearners,
    status: course.status,
    activatedAt: course.activatedAt,
    archivedAt: course.archivedAt,
    eOzel: { ...course.eOzel },
  }
}
