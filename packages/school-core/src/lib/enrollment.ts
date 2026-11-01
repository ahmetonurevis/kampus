import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { ADULT_AGE, ageOn, isCalendarDay } from './age.ts'
import { applyEnrollment, daySchema, requiredText, type MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import { renewalQuote, workflowSchemas } from './school-workflows.ts'
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

/**
 * Velinin öğrenciye yakınlığı (DOM-KAY-012). Yasal vasi `legal_guardian`'dır; ödeyici değeri
 * `'guardian'` (sözleşme `payer`) ve gövdedeki `guardian` nesnesiyle karışmasın diye ayrı addır.
 */
export const GUARDIAN_RELATIONSHIPS = ['mother', 'father', 'legal_guardian', 'other'] as const
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
  /** Formun hesapladığı tarife; yayımdaki sürüm değiştiyse kayıt yazılmaz. */
  tariffId: requiredText,
  installmentCount: z.number().int().min(1).max(12),
  firstDueDate: daySchema,
  /** Dil okulunda paket saati (DOM-FIN-006); okulda verilmez. */
  lessonHours: z.number().int().min(1).max(2_000).optional(),
  discounts: z.array(z.enum(FEE_DISCOUNT_KINDS, 'İndirim türü geçersiz.')).max(10).default([]),
  /** Velinin talep ettiği ek hizmetler; öğrenim ücretine gömülmez (DOM-FIN-003). */
  extras: z.array(z.enum(FEE_ITEM_KINDS, 'Ek hizmet geçersiz.')).max(10).default([]),
  identity: identitySchema,
  /**
   * Okulda her yaşta, kursta 18 yaş altında zorunlu; 18 yaş ve üstü kursiyerde `null`, kursiyer
   * kendisi ödeyicidir (DOM-KAY-012).
   */
  guardian: guardianSchema.nullable(),
  /**
   * Öğrencinin kendi iletişimi (isteğe bağlı, DOM-KAY-012). Veli zorunluyken adayın iletişimi
   * velinindir; öğrencinin telefonu ve e-postası istenirse ayrıca buradan alınır.
   */
  studentContact: z
    .strictObject({
      // kvkk: K
      phone: phoneSchema.optional(),
      // kvkk: K
      email: z.email('Geçerli bir e-posta adresi girin.').toLowerCase().optional(),
    })
    .optional(),
  /** Başka kampüsün sınıfı bilinçli seçildi; verilmezse sınıf adayın kampüsünde olmalıdır. */
  allowOtherCampus: z.boolean().optional(),
})
export type EnrollProspectInput = z.input<typeof enrollProspectSchema>

export interface EnrollmentTariff {
  id: string
  versionNumber: number
  items: readonly FeeItem[]
  discounts: readonly FeeDiscount[]
}

/**
 * Kurs türü mü (DOM-KAY-012): okul (`school`, ortaokul ve lise) dışındaki her tür kurstur. Bugün
 * `language_school`; ileride üniversiteye hazırlık, KPSS akademisi gibi kurslar aynı kuralı alır.
 */
export const isCourse = (institutionType: InstitutionType) => institutionType !== 'school'

/**
 * Kesin kayıtta veli zorunlu mu (DOM-KAY-012): okulda her yaşta (18 yaşını doldurmuş öğrencide de);
 * kursta yalnız 18 yaş altında. Zorunluyken adayın iletişimi velinindir, öğrenciye yazılmaz
 * (DOM-KAY-003); ödeyici velidir.
 */
export function guardianRequired(
  institutionType: InstitutionType,
  birthDate: string,
  now: string | number | Date,
): boolean {
  return !isCourse(institutionType) || ageOn(birthDate, now) < ADULT_AGE
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
      "Toplam indirim ilan ücretinin %50'sini aşamaz.",
      {
        path: ['discounts'],
      },
    )
  if (total >= grossCents)
    throw new DomainError('discount_exceeds_gross', 'İndirim öğrenim ücretini karşılayamaz.', {
      path: ['discounts'],
    })
  if (new Set(request.extras).size !== request.extras.length)
    throw new DomainError('extra_duplicate', 'Aynı ek hizmet iki kez seçilemez.', {
      path: ['extras'],
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

type ParentLike = {
  id: string
  name: string
  studentIds: readonly string[]
  phone?: string
  email?: string
  relationship?: string
}
type ProspectLike = { studentId?: string | null; phone?: string; minor?: boolean }

/** Yetişkin kursiyerin kendi kaydı için açılan veli satırının yakınlığı (DOM-KAY-012). */
export const SELF_RELATIONSHIP = 'self'

/**
 * Veli satırı gerçekte bir veli değil mi (DOM-KAY-012, DOM-KAY-013): yetişkin kursiyerin kendisi
 * (`relationship: 'self'`) ya da bu alan eklenmeden önce açılmış yer tutucu (telefonsuz, e-postasız,
 * bütün adayları `minor === false`). Böyle satır 18 yaş altı kardeşe veli olarak verilmez.
 */
export function isNotGuardian(
  parent: ParentLike,
  prospects: readonly ProspectLike[] = [],
): boolean {
  if (parent.relationship === SELF_RELATIONSHIP) return true
  if (parent.phone || parent.email) return false
  const linked = prospects.filter(
    (prospect) => prospect.studentId && parent.studentIds.includes(prospect.studentId),
  )
  return linked.length > 0 && linked.every((prospect) => prospect.minor === false)
}

/**
 * Telefonu eşleşen veliler; ön büroya önerilir, otomatik birleştirilmez (DOM-KAY-013). Eşleşme
 * velinin, öğrencisinin ya da öğrencisine dönüşmüş adayın telefonudur: 18 yaş altı öğrencinin
 * telefonu boş kaldığından (DOM-KAY-003) kardeşin aday kaydındaki aile telefonu da aranır.
 * Yetişkin kursiyerin kendi satırı ve eski yer tutucu önerilmez (`isNotGuardian`).
 */
export function findParentMatches(
  state: {
    parents: readonly ParentLike[]
    students: readonly { id: string; phone?: string }[]
    prospects?: readonly ProspectLike[]
  },
  phone: string,
): { parentId: string; name: string; studentCount: number }[] {
  if (phone === '') return []
  const prospects = state.prospects ?? []
  const enrolled = new Set(
    prospects.flatMap((prospect) =>
      prospect.phone === phone && prospect.studentId ? [prospect.studentId] : [],
    ),
  )
  return state.parents
    .filter(
      (parent) =>
        !isNotGuardian(parent, prospects) &&
        (parent.phone === phone ||
          parent.studentIds.some(
            (id) =>
              enrolled.has(id) ||
              state.students.find((student) => student.id === id)?.phone === phone,
          )),
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
  if (data.tariffId !== context.tariff.id)
    throw new DomainError(
      'tariff_changed',
      'Ücret tarifesi değişti. Ödeme planını yeniden kontrol edin.',
      { kind: 'conflict' },
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
  // Okulda veli her yaşta zorunludur; kursta 18 yaş ve üstü kursiyer kendi ödeyicisidir. 18 yaş
  // doğum tarihinden, Europe/Istanbul gününe göre hesaplanır (`lib/age.ts`) (DOM-KAY-012).
  const adult = !guardianRequired(context.institutionType, data.identity.birthDate, now)
  const prospect = state.prospects.find((item) => item.id === prospectId)
  // Kurs adayında ön büronun seçtiği yaş grubu (`minor`) doğum tarihiyle uyuşmalıdır; uyuşmazsa
  // yanlış doğum tarihiyle veli kuralı atlanmış olur (DOM-KAY-003, DOM-KAY-012). Okulda yaş grubu
  // seçilmez; doğum tarihi 18 yaşı gösterse de veli zorunluluğu kalkmaz.
  if (
    isCourse(context.institutionType) &&
    prospect?.minor !== undefined &&
    prospect.minor === adult
  )
    throw new DomainError(
      'birth_date_minor_mismatch',
      'Doğum tarihi adayın 18 yaş durumuyla uyuşmuyor; doğum tarihini kontrol edin.',
      { path: ['identity', 'birthDate'] },
    )
  // Okulda ve kursta 18 yaş altında sözleşmeyi ve ödemeyi veli üstlenir; yetişkin kursiyer kendisi
  // ödeyicidir. Okulda `guardian_not_applicable` dönmez.
  if (data.guardian === null && !adult)
    throw new DomainError('guardian_required', 'Veli bilgisi zorunludur.', { path: ['guardian'] })
  if (data.guardian !== null && adult)
    throw new DomainError(
      'guardian_not_applicable',
      '18 yaş ve üstü kursiyer sözleşmenin tarafı ve ödeyicisidir; veli bilgisi alınmaz.',
      { path: ['guardian'] },
    )
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
  // Yetişkin kursiyerin kendi satırı ya da eski yer tutucu kardeşe veli olamaz (DOM-KAY-013).
  if (existing && isNotGuardian(existing, state.prospects))
    throw new DomainError(
      'parent_not_guardian',
      'Seçilen kayıt bir veli değil (yetişkin kursiyerin kendi kaydı); veliyi yeni veli olarak girin.',
      { path: ['guardian'] },
    )
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
      guardianContact: !adult,
      ...(data.studentContact === undefined ? {} : { studentContact: data.studentContact }),
      ...(data.allowOtherCampus === undefined ? {} : { allowOtherCampus: data.allowOtherCampus }),
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

export const OTHER_CAMPUS_CONFIRM_LABEL = 'Başka kampüsün sınıfını bilerek seçiyorum'
export const OTHER_CAMPUS_CONFIRM_MESSAGE =
  'Seçilen sınıf adayın kampüsünde değil; devam etmek için onay kutusunu işaretleyin.'

export const GUARDIAN_RELATIONSHIP_LABELS: Readonly<Record<GuardianRelationship, string>> = {
  mother: 'Anne',
  father: 'Baba',
  legal_guardian: 'Vasi',
  other: 'Diğer',
}

/** Kayıt formunun veli ve ödeyici seçimi: yeni veli, mevcut veliye bağlama, kursiyerin kendisi. */
export const GUARDIAN_MODES = ['new', 'existing', 'self'] as const
export type GuardianMode = (typeof GUARDIAN_MODES)[number]

/** Formda veli zorunluyken "kendisi" seçilirse ve sunucunun 422 `guardian_required` iletisi. */
export const GUARDIAN_REQUIRED_FORM_MESSAGE =
  'Veli bilgisi zorunludur; yeni veli girin ya da mevcut veliye bağlayın.'
/** Formda yetişkin kursiyere veli seçilirse ve sunucunun 422 `guardian_not_applicable` iletisi. */
export const GUARDIAN_NOT_APPLICABLE_FORM_MESSAGE =
  '18 yaş ve üstü kursiyer kendi ödeyicisidir; veli yerine "Kursiyerin kendisi"ni seçin.'

/**
 * Formda sunulan veli seçimleri (DOM-KAY-012, `guardianRequired` ile aynı kural): veli
 * zorunluyken yeni ya da mevcut veli; kursta 18 yaş ve üstünde yalnız kursiyerin kendisi. Doğum
 * tarihi henüz geçerli değilse veli zorunlu sayılır (okulda her yaşta zorunludur).
 */
export function allowedGuardianModes(
  institutionType: InstitutionType,
  birthDate: string,
  now: string | number | Date = new Date(),
): readonly GuardianMode[] {
  return !isCalendarDay(birthDate) || guardianRequired(institutionType, birthDate, now)
    ? ['new', 'existing']
    : ['self']
}

/** Kesin kayıt formu (web): adımlar arası metin değerleri; gönderimde API gövdesine çevrilir. */
export function enrollmentFormSchema(
  institutionType: InstitutionType,
  /** Yaşın hesaplandığı an (test için); verilmezse doğrulama anı. */
  now?: string | number | Date,
) {
  return z
    .object({
      prospectId: z.string().min(1, 'Aday seçin.'),
      classId: z.string().min(1, 'Sınıf seçin.'),
      identityKind: z.enum(['tc', 'foreign']),
      identityNumber: z.string().trim(),
      birthDate: daySchema,
      guardianMode: z.enum(GUARDIAN_MODES),
      guardianName: z.string().trim().max(80),
      guardianPhone: z.string().trim(),
      relationship: z.enum(GUARDIAN_RELATIONSHIPS),
      existingParentId: z.string(),
      /** Yetişkin kursiyerin kendi iletişimi (isteğe bağlı); gövdede `studentContact`. */
      studentPhone: z.string().trim(),
      studentEmail: z.string().trim(),
      lessonHours: z.string().trim(),
      discounts: z.array(z.enum(FEE_DISCOUNT_KINDS)),
      extras: z.array(z.enum(FEE_ITEM_KINDS)),
      installmentCount: z.string().regex(/^([1-9]|1[0-2])$/, 'Taksit sayısını seçin.'),
      firstDueDate: daySchema,
      /** "Tüm kampüslerin sınıflarını göster" listeleme seçimi; tek başına onay sayılmaz. */
      allCampuses: z.boolean(),
      /**
       * "Başka kampüsün sınıfını bilerek seçiyorum" onayı; gövdeye `allowOtherCampus` olarak
       * yalnız bu işaretliyken gider (yoksa 422 `class_campus_mismatch`).
       */
      confirmOtherCampus: z.boolean(),
    })
    .superRefine((value, context) => {
      const issue = (path: string, message: string) =>
        context.addIssue({ code: 'custom', path: [path], message })
      if (value.identityKind === 'tc' && !isValidTurkishId(value.identityNumber))
        issue('identityNumber', 'Geçerli bir T.C. kimlik numarası girin.')
      if (value.identityKind === 'foreign' && !/^.{5,20}$/.test(value.identityNumber))
        issue('identityNumber', 'Kimlik numarasını girin (5–20 karakter).')
      // Sunucuyla aynı veli kuralı (DOM-KAY-012): okulda her yaşta, kursta 18 yaş altında veli
      // zorunlu; kursta 18 yaş ve üstünde veli alınmaz. Yanlış seçim son adımda 422 olmaz.
      const allowed = allowedGuardianModes(institutionType, value.birthDate, now ?? new Date())
      const required = !allowed.includes('self')
      if (required && value.guardianMode === 'self')
        issue('guardianMode', GUARDIAN_REQUIRED_FORM_MESSAGE)
      if (!required && value.guardianMode !== 'self')
        issue('guardianMode', GUARDIAN_NOT_APPLICABLE_FORM_MESSAGE)
      if (required && value.guardianMode === 'new') {
        if (value.guardianName.length < 2) issue('guardianName', 'Veli adını girin.')
        if (!/^0\d{10}$/.test(value.guardianPhone))
          issue('guardianPhone', 'Telefonu 05XXXXXXXXX biçiminde girin.')
      }
      if (required && value.guardianMode === 'existing' && value.existingParentId === '')
        issue('existingParentId', 'Veli seçin.')
      if (value.guardianMode === 'self') {
        if (value.studentPhone !== '' && !/^0\d{10}$/.test(value.studentPhone))
          issue('studentPhone', 'Telefonu 05XXXXXXXXX biçiminde girin.')
        if (value.studentEmail !== '' && !z.email().safeParse(value.studentEmail).success)
          issue('studentEmail', 'Geçerli bir e-posta adresi girin.')
      }
      if (
        institutionType === 'language_school' &&
        !(Number.isInteger(Number(value.lessonHours)) && Number(value.lessonHours) >= 1)
      )
        issue('lessonHours', 'Paket ders saatini girin.')
    })
}
export type EnrollmentFormValues = z.output<ReturnType<typeof enrollmentFormSchema>>

/** Adımın doğrulanacak alanları; son adım bütün formu doğrular. */
export const ENROLLMENT_STEP_FIELDS: readonly (readonly (keyof EnrollmentFormValues)[])[] = [
  ['prospectId', 'classId', 'allCampuses', 'confirmOtherCampus'],
  [
    'identityKind',
    'identityNumber',
    'birthDate',
    'guardianMode',
    'guardianName',
    'guardianPhone',
    'relationship',
    'existingParentId',
    'studentPhone',
    'studentEmail',
  ],
  ['lessonHours', 'discounts', 'extras', 'installmentCount', 'firstDueDate'],
]

export function enrollmentFormToBody(
  values: EnrollmentFormValues,
  tariffId: string,
): EnrollProspectInput {
  const lessonHours = values.lessonHours === '' ? null : Number(values.lessonHours)
  // Kursiyerin kendi iletişimi yalnız "kendisi" seçiliyken ve doldurulduysa gider; boşsa sunucu
  // adayın iletişimini yazar (DOM-KAY-012).
  const studentContact =
    values.guardianMode === 'self'
      ? {
          ...(values.studentPhone === '' ? {} : { phone: values.studentPhone }),
          ...(values.studentEmail === '' ? {} : { email: values.studentEmail }),
        }
      : {}
  return {
    classId: values.classId,
    tariffId,
    installmentCount: Number(values.installmentCount),
    firstDueDate: values.firstDueDate,
    ...(lessonHours === null ? {} : { lessonHours }),
    discounts: values.discounts,
    extras: values.extras,
    ...(values.confirmOtherCampus ? { allowOtherCampus: true } : {}),
    identity: {
      kind: values.identityKind,
      number: values.identityNumber,
      birthDate: values.birthDate,
    },
    guardian:
      values.guardianMode === 'self'
        ? null
        : values.guardianMode === 'existing'
          ? { existingParentId: values.existingParentId }
          : {
              name: values.guardianName,
              phone: values.guardianPhone,
              relationship: values.relationship,
            },
    ...(Object.keys(studentContact).length > 0 ? { studentContact } : {}),
  }
}

/** Form önizlemesi: sunucuyla aynı fiyat kuralı. Reddi hata fırlatmaz, mesaj döner. */
export function previewEnrollment(
  tariff: EnrollmentTariff,
  values: Pick<EnrollmentFormValues, 'lessonHours' | 'discounts' | 'extras'>,
  options: { institutionType: InstitutionType; level: string },
): { ok: true; price: EnrollmentPrice } | { ok: false; message: string } {
  try {
    const hours = Number(values.lessonHours)
    return {
      ok: true,
      price: priceEnrollment(tariff, {
        level: options.level,
        institutionType: options.institutionType,
        lessonHours:
          options.institutionType === 'language_school' && hours >= 1 ? hours : undefined,
        discounts: values.discounts ?? [],
        extras: values.extras ?? [],
        // Yönetici onayı sunucuda denetlenir; önizleme ön büroya aynı kuralla konuşur.
        canApproveCapException: false,
      }),
    }
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message }
    throw error
  }
}

/**
 * Yenilemenin tarife denetimi (API; DOM-FIN-002, -021, DOM-KAY-020): hedef yılın yayımlanmış
 * tarifesi olmadan sözleşme açılmaz, öğrenim ücreti ilanı aşamaz, indirim tavanı %50'dir (burs
 * tavana dahil değildir). Dil okulunda tutar saat paketiyle değiştiği için üst sınır denetlenmez.
 * Artış tavanı (DOM-FIN-005) ÜFE/TÜFE verisi gerektirdiği için burada yoktur. Mezuniyet borç açmaz.
 */
export function assertRenewalWithinTariff(
  state: Pick<State, 'classes'>,
  input: unknown,
  tariff: Pick<EnrollmentTariff, 'items'> | null,
  institutionType: InstitutionType,
): void {
  const data = workflowSchemas.renewal.safeParse(input)
  // Biçim hatasını iş akışının kendi doğrulaması raporlar.
  if (!data.success || data.data.mode === 'graduate') return
  if (tariff === null)
    throw new DomainError(
      'tariff_not_published',
      'Bu eğitim yılı için yayımlanmış ücret tarifesi yok.',
    )
  const { gross, discountAmount } = renewalQuote(input)
  const target = state.classes.find((item) => item.id === data.data.targetClassId)
  const level = institutionType === 'language_school' ? target?.level : String(target?.grade ?? '')
  const tuition = itemFor(tariff.items, 'tuition', level ?? '')
  if (!tuition)
    throw new DomainError('tariff_tuition_missing', 'Tarifede bu düzey için öğrenim ücreti yok.')
  if (institutionType === 'language_school') return
  if (gross > tuition.amountCents)
    throw new DomainError('renewal_above_tariff', 'Eğitim bedeli ilan edilen ücreti aşamaz.', {
      path: ['total'],
    })
  if (discountAmount * BASIS > tuition.amountCents * DISCOUNT_CAP_BASIS_POINTS)
    throw new DomainError(
      'discount_cap_exceeded',
      "Toplam indirim ilan ücretinin %50'sini aşamaz.",
      {
        path: ['discount'],
      },
    )
}
