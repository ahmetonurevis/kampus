import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { applyEnrollment, daySchema, requiredText, type MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import {
  FEE_DISCOUNT_KINDS,
  FEE_ITEM_KINDS,
  type FeeDiscount,
  type FeeDiscountKind,
  type FeeItem,
  type FeeItemKind,
} from './fee-tariffs.ts'

/**
 * Tarifeye bağlı kesin kayıt (docs/domain/finans.md DOM-FIN-002, -003, -010, -011, -020…-022;
 * kayit-ve-crm.md DOM-KAY-011…013; ADR 0006 karar 9). Tutar girdi değildir, yayımlanmış tarifeden
 * hesaplanır. Yetkiyi kendisi denetlemez; API önce `requireAuthorized` çalıştırır.
 */

/** Toplam indirim tavanı (DOM-FIN-021): %50, on binde birlik. */
export const DISCOUNT_CAP_BASIS_POINTS = 5_000
const BASIS = 10_000
const ADULT_AGE = 18

export const GUARDIAN_RELATIONSHIPS = ['mother', 'father', 'guardian', 'other'] as const
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number]

const phoneSchema = z.string().regex(/^0\d{10}$/, 'Telefonu 05XXXXXXXXX biçiminde girin.')

/** T.C. kimlik numarası: 11 hane, ilk hane sıfır değil, son iki hane denetim hanesidir. */
export function isValidTurkishId(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false
  const digits = [...value].map(Number)
  const at = (index: number) => digits[index] ?? 0
  const odd = at(0) + at(2) + at(4) + at(6) + at(8)
  const even = at(1) + at(3) + at(5) + at(7)
  const tenth = (((odd * 7 - even) % 10) + 10) % 10
  const eleventh = digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10
  return tenth === at(9) && eleventh === at(10)
}

const identitySchema = z
  .strictObject({
    kind: z.enum(['tc', 'foreign'], 'Kimlik türünü seçin.'),
    // kvkk: Ç
    number: z.string().trim().min(5).max(20),
    // kvkk: Ç
    birthDate: daySchema,
  })
  .superRefine((value, context) => {
    if (value.kind === 'tc' && !isValidTurkishId(value.number))
      context.addIssue({
        code: 'custom',
        path: ['number'],
        message: 'Geçerli bir T.C. kimlik numarası girin.',
      })
  })

const guardianSchema = z.union([
  z.strictObject({ existingParentId: requiredText }),
  z.strictObject({
    // kvkk: K
    name: requiredText.max(80),
    // kvkk: K
    phone: phoneSchema,
    relationship: z.enum(GUARDIAN_RELATIONSHIPS, 'Yakınlık derecesini seçin.'),
  }),
])

export const enrollProspectSchema = z.strictObject({
  classId: requiredText,
  installmentCount: z.number().int().min(1).max(12),
  firstDueDate: daySchema,
  /** Dil okulunda paket saati (DOM-FIN-006); okulda verilmez. */
  lessonHours: z.number().int().min(1).max(2_000).optional(),
  discounts: z.array(z.enum(FEE_DISCOUNT_KINDS, 'İndirim türü geçersiz.')).max(10).default([]),
  /** Velinin talep ettiği ek hizmetler; öğrenim ücretine gömülmez (DOM-FIN-003). */
  extras: z.array(z.enum(FEE_ITEM_KINDS, 'Ek hizmet geçersiz.')).max(10).default([]),
  identity: identitySchema,
  /** 18 yaş üstü kursiyerde boş olabilir; kursiyer kendisi ödeyicidir (DOM-KAY-012). */
  guardian: guardianSchema.nullable(),
})
export type EnrollProspectInput = z.input<typeof enrollProspectSchema>

export interface EnrollmentTariff {
  id: string
  versionNumber: number
  items: readonly FeeItem[]
  discounts: readonly FeeDiscount[]
}

export interface DiscountLine {
  kind: FeeDiscountKind
  amountCents: number
}
export interface ExtraLine {
  kind: FeeItemKind
  amountCents: number
}
export interface EnrollmentPrice {
  grossCents: number
  discounts: DiscountLine[]
  netCents: number
  extras: ExtraLine[]
}

function itemFor(items: readonly FeeItem[], kind: FeeItemKind, level: string): FeeItem | undefined {
  return (
    items.find((item) => item.kind === kind && item.level === level) ??
    items.find((item) => item.kind === kind && item.level === null)
  )
}

/**
 * Brüt, indirim kalemleri, net ve ek hizmetler. İndirim ilan ücreti üzerinden hesaplanır,
 * zincirlenmez (DOM-FIN-020). Personel çocuğu tavanın tek istisnasıdır ve yönetici onayı ister
 * (DOM-FIN-021).
 */
export function priceEnrollment(
  tariff: EnrollmentTariff,
  request: {
    level: string
    institutionType: InstitutionType
    lessonHours?: number | undefined
    discounts: readonly FeeDiscountKind[]
    extras: readonly FeeItemKind[]
    canApproveCapException: boolean
  },
): EnrollmentPrice {
  const tuition = itemFor(tariff.items, 'tuition', request.level)
  if (!tuition)
    throw new DomainError('tariff_tuition_missing', 'Tarifede bu düzey için öğrenim ücreti yok.')
  let grossCents = tuition.amountCents
  if (request.institutionType === 'language_school') {
    if (request.lessonHours === undefined)
      throw new DomainError('lesson_hours_required', 'Paket ders saatini girin.', {
        path: ['lessonHours'],
      })
    grossCents = tuition.amountCents * request.lessonHours
  } else if (request.lessonHours !== undefined) {
    throw new DomainError('lesson_hours_not_applicable', 'Okulda ders saati girilmez.', {
      path: ['lessonHours'],
    })
  }
  if (new Set(request.discounts).size !== request.discounts.length)
    throw new DomainError('discount_duplicate', 'Aynı indirim iki kez seçilemez.', {
      path: ['discounts'],
    })
  const discounts = request.discounts.map((kind): DiscountLine => {
    const rule = tariff.discounts.find((item) => item.kind === kind)
    if (!rule)
      throw new DomainError('discount_not_in_tariff', 'Bu indirim tarifede ilan edilmemiş.', {
        path: ['discounts'],
      })
    const amountCents =
      rule.amountCents ?? Math.floor((grossCents * (rule.percentBasisPoints ?? 0)) / BASIS)
    return { kind, amountCents }
  })
  const exempt = request.discounts.includes('staff_child')
  if (exempt && !request.canApproveCapException)
    throw new DomainError(
      'discount_approval_required',
      'Personel çocuğu indirimini yalnız yönetici onaylar.',
      { path: ['discounts'] },
    )
  const total = discounts.reduce((sum, line) => sum + line.amountCents, 0)
  if (!exempt && total * BASIS > grossCents * DISCOUNT_CAP_BASIS_POINTS)
    throw new DomainError(
      'discount_cap_exceeded',
      'Toplam indirim ilan ücretinin %50sini aşamaz.',
      {
        path: ['discounts'],
      },
    )
  if (total >= grossCents)
    throw new DomainError('discount_exceeds_gross', 'İndirim öğrenim ücretini karşılayamaz.', {
      path: ['discounts'],
    })
  const extras = request.extras.map((kind): ExtraLine => {
    const item = kind === 'tuition' ? undefined : itemFor(tariff.items, kind, request.level)
    if (!item)
      throw new DomainError('extra_not_in_tariff', 'Bu ek hizmet tarifede ilan edilmemiş.', {
        path: ['extras'],
      })
    return { kind, amountCents: item.amountCents }
  })
  return { grossCents, discounts, netCents: grossCents - total, extras }
}

function ageOn(birthDate: string, day: string): number {
  const years = Number(day.slice(0, 4)) - Number(birthDate.slice(0, 4))
  return day.slice(5) >= birthDate.slice(5) ? years : years - 1
}

/** Telefonu eşleşen veliler; ön büroya önerilir, otomatik birleştirilmez (DOM-KAY-013). */
export function findParentMatches(
  state: Pick<State, 'parents' | 'students'>,
  phone: string,
): { parentId: string; name: string; studentCount: number }[] {
  if (phone === '') return []
  return state.parents
    .filter(
      (parent) =>
        parent.phone === phone ||
        parent.studentIds.some(
          (id) => state.students.find((student) => student.id === id)?.phone === phone,
        ),
    )
    .map((parent) => ({
      parentId: parent.id,
      name: parent.name,
      studentCount: parent.studentIds.length,
    }))
}

export interface EnrollmentContext {
  institutionType: InstitutionType
  tariff: EnrollmentTariff | null
  academicYear: number
  /** Bu kimliğin arşivlenmemiş satırının öğrencisi; yoksa `null`. */
  identityHolderId: string | null
  approvedByUserId: string
  canApproveCapException: boolean
  today: string
}

/**
 * Tarifeden fiyatlar, kimlik ve veli kurallarını denetler, kaydı yazar. Reddedilen istekte State
 * değişmez: bütün denetimler `applyEnrollment`'tan öncedir, o da kendi denetimlerini yazmadan yapar.
 */
export function enrollProspectWithTariff(
  state: State,
  prospectId: string,
  input: unknown,
  makeId: MakeId,
  now: string,
  context: EnrollmentContext,
) {
  const data = enrollProspectSchema.parse(input)
  if (context.tariff === null)
    throw new DomainError(
      'tariff_not_published',
      'Bu eğitim yılı için yayımlanmış ücret tarifesi yok.',
    )
  // Aktif öğrenci ikinci kayıt alamaz; pasif veya silinmiş kaydın kimliği yeniden kullanılır.
  if (state.students.find((student) => student.id === context.identityHolderId)?.isActive)
    throw new DomainError(
      'student_identity_duplicate',
      'Bu kimlik numarasıyla aktif bir kayıt var.',
      { kind: 'conflict', path: ['identity', 'number'] },
    )
  if (data.identity.birthDate >= context.today)
    throw new DomainError('birth_date_invalid', 'Doğum tarihi geçmiş bir gün olmalıdır.', {
      path: ['identity', 'birthDate'],
    })
  const adult =
    context.institutionType === 'language_school' &&
    ageOn(data.identity.birthDate, context.today) >= ADULT_AGE
  if (data.guardian === null && !adult)
    throw new DomainError('guardian_required', 'Veli bilgisi zorunludur.', { path: ['guardian'] })
  const existingParentId =
    data.guardian !== null && 'existingParentId' in data.guardian
      ? data.guardian.existingParentId
      : null
  const existing =
    existingParentId === null
      ? undefined
      : state.parents.find((parent) => parent.id === existingParentId)
  if (existingParentId !== null && !existing)
    throw new DomainError('parent_not_found', 'Veli bulunamadı.', {
      kind: 'not_found',
      path: ['guardian'],
    })
  if (data.discounts.includes('sibling')) {
    const hasSibling = existing?.studentIds.some(
      (id) => state.students.find((student) => student.id === id)?.isActive === true,
    )
    if (!hasSibling)
      throw new DomainError(
        'sibling_discount_ineligible',
        'Kardeş indirimi için aynı veliye bağlı aktif bir öğrenci gerekir.',
        { path: ['discounts'] },
      )
  }
  const cls = state.classes.find((item) => item.id === data.classId && item.isActive)
  const price = priceEnrollment(context.tariff, {
    // Okulda düzey sınıf derecesi, dil okulunda sınıfın CEFR düzeyidir (`level`).
    level: !cls
      ? ''
      : context.institutionType === 'language_school'
        ? (cls.level ?? '')
        : String(cls.grade),
    institutionType: context.institutionType,
    lessonHours: data.lessonHours,
    discounts: data.discounts,
    extras: data.extras,
    canApproveCapException: context.canApproveCapException,
  })
  const result = applyEnrollment(
    state,
    {
      prospectId,
      classId: data.classId,
      totalCents: price.netCents,
      count: data.installmentCount,
      startDate: data.firstDueDate,
      contractTitle:
        context.institutionType === 'language_school'
          ? 'Dil kursu eğitim sözleşmesi'
          : 'Özel okul eğitim sözleşmesi',
      academicYear: context.academicYear,
      extras: price.extras,
      guardian:
        data.guardian === null
          ? { kind: 'self' }
          : existing
            ? { kind: 'existing', parentId: existing.id }
            : 'name' in data.guardian
              ? {
                  kind: 'new',
                  name: data.guardian.name,
                  phone: data.guardian.phone,
                  relationship: data.guardian.relationship,
                }
              : { kind: 'self' },
      terms: {
        tariffId: context.tariff.id,
        tariffVersion: context.tariff.versionNumber,
        grossCents: price.grossCents,
        netCents: price.netCents,
        discounts: price.discounts,
        extras: price.extras,
        approvedByUserId: context.approvedByUserId,
        payer: data.guardian === null ? 'student' : 'guardian',
      },
    },
    makeId,
    now,
  )
  return {
    ...result,
    identity: data.identity,
    academicYear: context.academicYear,
    /** Arşivlenecek eski kimlik satırının öğrencisi. */
    supersededStudentId: context.identityHolderId,
  }
}
