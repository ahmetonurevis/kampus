// Kur formu ve e-Özel kaydı formunun saf yardımcıları (IST-076; DOM-DIL-005, -006): varsayılan
// değerler, değişen alanlardan PATCH gövdesi ve sunucu hatasının form alanına eşlenmesi.
import type { z } from 'zod'
import type { ApiError } from '@kampus/api-client/errors.ts'
import {
  COURSE_PROGRAM_FIELDS,
  createCourseSchema,
  type CreateCourseInput,
} from '@kampus/school-core/lib/courses.ts'
import {
  courseErrorField,
  type Course,
  type CourseEOzelBody,
  type UpdateCourseBody,
} from '@kampus/react-shared/courses.ts'
import { courseStatusOf } from './course-rows.ts'

/** Formdaki alanlar; sıra ekrandaki sıradır. Beceri odağı, açıklama ve sonraki kur bu formda yok. */
export const COURSE_FORM_FIELDS = [
  'name',
  'language',
  'level',
  'totalHours',
  'weeklyHours',
  'sessionMinutes',
  'minLearners',
  'maxLearners',
  'certified',
] as const
export type CourseFormField = (typeof COURSE_FORM_FIELDS)[number]

/**
 * Form şeması: core `createCourseSchema`'nın formdaki alanları, varsayılanlı olanlar zorunlu
 * (formda her alanın değeri vardır). Mesajlar core'dan gelir; sunucu aynı kuralı yeniden uygular.
 */
export const courseFormSchema = createCourseSchema
  .pick({
    name: true,
    language: true,
    level: true,
    totalHours: true,
    weeklyHours: true,
    sessionMinutes: true,
    minLearners: true,
    maxLearners: true,
    certified: true,
  })
  .required()
export type CourseFormValues = z.input<typeof courseFormSchema>
export type CourseFormOutput = z.output<typeof courseFormSchema>

/** Yeni kur: İngilizce A1, 45 dk oturum, belgesiz; sayılar kurumun sık kullandığı değerler. */
export const NEW_COURSE_VALUES: CourseFormValues = {
  name: '',
  language: 'en',
  level: 'A1',
  totalHours: 120,
  weeklyHours: 6,
  sessionMinutes: 45,
  minLearners: 4,
  maxLearners: 12,
  certified: false,
}

export function courseDefaults(course?: Course): CourseFormValues {
  if (!course) return { ...NEW_COURSE_VALUES }
  return {
    name: course.name,
    language: course.language,
    level: course.level,
    totalHours: course.totalHours,
    weeklyHours: course.weeklyHours,
    sessionMinutes: course.sessionMinutes,
    minLearners: course.minLearners ?? 1,
    maxLearners: course.maxLearners,
    certified: course.certified,
  }
}

/**
 * Etkin kurun program alanları (dil, seviye, saatler, oturum, belge) değişmez (DOM-DIL-005); formda
 * salt okur metindir, gövdeye girmez.
 */
export function isProgramLocked(course: Course | undefined): boolean {
  return course !== undefined && courseStatusOf(course) === 'active'
}

const PROGRAM_FIELDS: ReadonlySet<string> = new Set(COURSE_PROGRAM_FIELDS)

/** Düzenlenebilir alanlar: etkin kurda program alanları düşer. */
export function editableCourseFields(course: Course | undefined): readonly CourseFormField[] {
  return isProgramLocked(course)
    ? COURSE_FORM_FIELDS.filter((field) => !PROGRAM_FIELDS.has(field))
    : COURSE_FORM_FIELDS
}

/** Oluşturma gövdesi: formun bütün alanları (ad kırpılmış hâliyle şemadan gelir). */
export function createCourseBody(parsed: CourseFormOutput): CreateCourseInput {
  return { ...parsed }
}

/**
 * PATCH gövdesi: yalnız değişen ve düzenlenebilen alanlar. Boş nesne "değişiklik yok" demektir;
 * istek atılmaz (sunucu boş gövdeyi 400 ile reddeder).
 */
export function coursePatch(course: Course, parsed: CourseFormOutput): UpdateCourseBody {
  const before = courseDefaults(course)
  const after = createCourseBody(parsed)
  const body: Record<string, unknown> = {}
  for (const field of editableCourseFields(course))
    if (after[field] !== before[field]) body[field] = after[field]
  return body as UpdateCourseBody
}

const FORM_FIELDS: ReadonlySet<string> = new Set(COURSE_FORM_FIELDS)

/**
 * Hatanın form alanı: kod ya da yol formda olan bir alana bağlanıyorsa o alan, değilse
 * `undefined` (toast). Sonraki kur ve program kodu bu formda yoktur; onların hatası toast olur.
 */
export function courseFormErrorField(error: ApiError): CourseFormField | undefined {
  const field = courseErrorField(error)
  return field !== undefined && FORM_FIELDS.has(field) ? (field as CourseFormField) : undefined
}

export type EOzelFormValues = { programCode: string; approval: CourseEOzelBody['approval'] }

/** e-Özel formu: kayıtlı kod ve durum; hiç işlenmemişse "Onay bekliyor" önerilir. */
export function eOzelDefaults(course: Course): EOzelFormValues {
  const approval = course.eOzel?.approval ?? 'not_submitted'
  return {
    programCode: course.eOzel?.programCode ?? '',
    approval: approval === 'not_submitted' ? 'pending' : approval,
  }
}

/** e-Özel formunda yalnız program kodu sunucu hatası alır. */
export function eOzelErrorField(error: ApiError): 'programCode' | undefined {
  return courseErrorField(error) === 'programCode' ? 'programCode' : undefined
}

/** Belgeli kur e-Özel onayı olmadan etkinleşmez (DOM-DIL-006); düğme açıklaması için. */
export function activationBlocked(course: Course): string | null {
  if (!course.certified) return null
  return course.eOzel?.approval === 'approved'
    ? null
    : "Belgeli kur, e-Özel'de onaylanmadan etkinleştirilemez."
}
