import { z } from 'zod'

import type { State } from '../data/seed.ts'
import { daySchema, requiredText, type MakeId, type Session } from './domain.ts'
import {
  itemFor,
  priceEnrollment,
  requireSiblingDiscountEligible,
  type DiscountLine,
  type EnrollmentTariff,
  type ExtraLine,
} from './enrollment.ts'
import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'
import { FEE_DISCOUNT_KINDS, FEE_ITEM_KINDS } from './fee-tariffs.ts'
import {
  requireAwardableProgram,
  scholarshipAmount,
  type ScholarshipProgram,
} from './finance-scholarships.ts'
import { installmentAmounts } from './payments.ts'
import {
  assertWithinCeiling,
  renewalCeiling,
  type PriceIndexEntry,
  type RenewalCeiling,
} from './renewal-ceiling.ts'
import { mayRun, renewalPreconditions, type Renewal } from './school-workflows.ts'

/**
 * Tarifeye bağlı kayıt yenileme planı (docs/domain/finans.md DOM-FIN-002, -003, -005, -010, -012,
 * -020…-023, -025; kayit-ve-crm.md DOM-KAY-020, -021; IST-100). Yenileme yeni yılın sözleşmesini ve
 * taksitlerini yazar; öğrencinin sınıfı değişmez, sınıf geçişi ayrı işlemdir (`renewal-activate`).
 * Öğrenim ücreti yayımlı tarifeden ve artış tavanından çıkar; indirim tarifedeki türlerden, burs
 * yalnız bildirilmiş programdan gelir. Yetki ve kapsam core `mayRun` + `renewalPreconditions`.
 */

const MAX_MONEY_CENTS = 100_000_000
const yearSchema = z.number('Eğitim yılını seçin.').int().min(2000).max(2100)

const renewalFields = {
  studentId: requiredText,
  targetClassId: requiredText,
  academicYear: yearSchema,
  /** Verilmezse ilan ve tavanın küçüğüdür; verilirse ikisini de aşamaz (DOM-FIN-002, -005). */
  tuitionCents: z
    .number()
    .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
    .positive('Tutar sıfırdan büyük olmalıdır.')
    .max(MAX_MONEY_CENTS, 'Tutar en fazla 1.000.000 ₺ olabilir.')
    .optional(),
  installmentCount: z.number().int().min(1).max(12),
  discounts: z.array(z.enum(FEE_DISCOUNT_KINDS, 'İndirim türü geçersiz.')).max(10).default([]),
  /** Velinin talep ettiği ek hizmetler; öğrenim ücretine gömülmez (DOM-FIN-003). */
  extras: z.array(z.enum(FEE_ITEM_KINDS, 'Ek hizmet geçersiz.')).max(10).default([]),
  /** Bu yılın burs programı (DOM-FIN-025); yalnız yönetici. */
  scholarshipProgramId: z.uuid('Burs programı geçersiz.').optional(),
}

export const renewalQuoteSchema = z.strictObject(renewalFields)
export type RenewalQuoteInput = z.input<typeof renewalQuoteSchema>

export const renewalPlanSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('renew'),
    ...renewalFields,
    /** Önizlemenin hesapladığı tarife; yayımdaki sürüm değiştiyse plan yazılmaz. */
    tariffId: requiredText,
    firstDueDate: daySchema,
    /**
     * Önceki yıldan öğrenim ücreti borcu olan öğrencinin yenilemesi için yöneticinin açık onayı
     * (DOM-KAY-025); borç yokken etkisizdir.
     */
    debtApproved: z.boolean().optional(),
  }),
  z.strictObject({
    mode: z.literal('graduate'),
    studentId: requiredText,
    academicYear: yearSchema,
  }),
])
export type RenewalPlanInput = z.input<typeof renewalPlanSchema>

export interface RenewalContext {
  tariff: EnrollmentTariff | null
  /** Önceki yılın yayımlı tarifesi; sözleşmesi olmayan öğrencide tavanın bazıdır (DOM-FIN-005). */
  previousTariff: Pick<EnrollmentTariff, 'items'> | null
  priceIndexes: readonly PriceIndexEntry[]
  scholarshipProgram?: ScholarshipProgram | null
  scholarshipAwardedCount?: number
  /** Öğrencinin yenileme yılında arşivlenmemiş burs ataması var mı; servis yükler (DOM-FIN-025). */
  scholarshipStudentAwarded?: boolean
  /**
   * Önceki eğitim yıllarından ödenmemiş öğrenim ücreti (kuruş; DOM-KAY-025). Ödeme dağılımları
   * State dışında olduğu için servis `outstandingTuitionCents` ile hesaplar; verilmezse 0.
   */
  outstandingTuitionCents?: number
}

export interface RenewalPrice {
  tariffId: string
  tariffVersion: number
  /** Hedef düzeyin ilan edilen öğrenim ücreti. */
  announcedCents: number
  ceiling: RenewalCeiling
  /** Uygulanabilecek en yüksek ücret: ilan ve tavanın küçüğü. */
  maxTuitionCents: number
  /** Sözleşmenin indirimsiz öğrenim ücreti. */
  tuitionCents: number
  discounts: DiscountLine[]
  discountCents: number
  scholarship: { programId: string; amountCents: number } | null
  /** İndirim ve burstan sonra kalan öğrenim ücreti. */
  netCents: number
  extras: ExtraLine[]
  installments: number[]
  /** Önceki yıllardan ödenmemiş öğrenim ücreti; sıfırdan büyükse plan yönetici onayı ister. */
  outstandingTuitionCents: number
}

function requireRenewalRole(session: Session): void {
  if (!mayRun(session, 'renewal'))
    throw new DomainError('permission_denied', 'Bu işlem için rolünüzün yetkisi yok.', {
      kind: 'forbidden',
    })
}

/** Plan ve önizlemenin ortak fiyatı; State değişmez. */
function priceRenewal(
  state: State,
  session: Session,
  data: z.output<typeof renewalQuoteSchema>,
  context: RenewalContext,
) {
  const { student, oldClass, target } = renewalPreconditions(state, session, {
    studentId: data.studentId,
    targetClassId: data.targetClassId,
    year: data.academicYear,
    mode: 'renew',
  })
  // Hedef sınıf `renew` kipinde her zaman doludur; tip için daraltılır.
  if (target === null) throw new DomainError('record_not_found', 'İlgili kayıt bulunamadı.')
  if (context.tariff === null)
    throw new DomainError(
      'tariff_not_published',
      'Bu eğitim yılı için yayımlanmış ücret tarifesi yok.',
    )
  const level = String(target.grade)
  const canApprove = session.role === 'yonetici'
  const price = priceEnrollment(context.tariff, {
    level,
    institutionType: 'school',
    discounts: data.discounts,
    extras: data.extras,
    canApproveCapException: canApprove,
  })
  const previous = context.previousTariff
    ? itemFor(context.previousTariff.items, 'tuition', level)
    : undefined
  const ceiling = renewalCeiling(state, {
    studentId: student.id,
    targetGrade: target.grade,
    year: data.academicYear,
    previousAnnouncedCents: previous
      ? (previous.announcedAmountCents ?? previous.amountCents)
      : null,
    priceIndexes: context.priceIndexes,
  })
  const announcedCents = price.grossCents
  const maxTuitionCents =
    ceiling.status === 'applied' ? Math.min(announcedCents, ceiling.ceilingCents) : announcedCents
  const tuitionCents = data.tuitionCents ?? maxTuitionCents
  if (tuitionCents > announcedCents)
    throw new DomainError('renewal_above_tariff', 'Eğitim bedeli ilan edilen ücreti aşamaz.', {
      path: ['tuitionCents'],
    })
  assertWithinCeiling(tuitionCents, ceiling, ['tuitionCents'])
  // Kardeş indirimi kesin kayıttakiyle aynı koşula ve sıraya bağlıdır (DOM-FIN-022).
  if (data.discounts.includes('sibling'))
    requireSiblingDiscountEligible(state, {
      studentId: student.id,
      siblingIds: state.students
        .filter((item) => Boolean(student.parentId) && item.parentId === student.parentId)
        .map((item) => item.id),
      tuitionCents: announcedCents,
    })
  // İndirim ilan ücretinden hesaplanır (DOM-FIN-020); tavanla düşen ücreti karşılayamaz.
  const discountCents = price.discounts.reduce((sum, line) => sum + line.amountCents, 0)
  if (discountCents >= tuitionCents)
    throw new DomainError('discount_exceeds_gross', 'İndirim öğrenim ücretini karşılayamaz.', {
      path: ['discounts'],
    })
  const afterDiscounts = tuitionCents - discountCents
  // Burs yalnız bu yılın bildirilmiş programından atanır, indirimlerden kalanı aşamaz (DOM-FIN-025).
  const program =
    data.scholarshipProgramId === undefined
      ? null
      : requireAwardableProgram(context.scholarshipProgram ?? null, {
          academicYear: data.academicYear,
          awardedCount: context.scholarshipAwardedCount ?? 0,
          canApprove,
          studentAwarded: context.scholarshipStudentAwarded ?? false,
        })
  const scholarshipCents =
    program === null ? 0 : scholarshipAmount(program, announcedCents, afterDiscounts)
  if (program !== null && scholarshipCents === 0)
    throw new DomainError(
      'scholarship_nothing_to_cover',
      'İndirimlerden sonra burs uygulanacak tutar kalmıyor.',
      { path: ['scholarshipProgramId'] },
    )
  const netCents = afterDiscounts - scholarshipCents
  const result: RenewalPrice = {
    tariffId: context.tariff.id,
    tariffVersion: context.tariff.versionNumber,
    announcedCents,
    ceiling,
    maxTuitionCents,
    tuitionCents,
    discounts: price.discounts,
    discountCents,
    scholarship: program === null ? null : { programId: program.id, amountCents: scholarshipCents },
    netCents,
    extras: price.extras,
    // Tam bursta öğrenim taksiti açılmaz.
    installments: netCents === 0 ? [] : installmentAmounts(netCents, data.installmentCount),
    outstandingTuitionCents: context.outstandingTuitionCents ?? 0,
  }
  return { student, oldClass, target, price: result }
}

/**
 * Önceki eğitim yıllarından ödenmemiş öğrenim ücreti (DOM-KAY-025): yenileme yılından önceki
 * yıla ait, vadesi geçmiş öğrenim taksitlerinin açık kalanı. Vadesi gelmemiş taksit borç değildir
 * (yenileme yıl içinde planlanır); yılı olmayan eski taksit önceki yıl sayılır. Ek hizmet (yemek,
 * servis) borcu öğrenim ücreti değildir. Ödenmiş işaretli taksit kapalıdır, kısmi ödeme
 * dağılımdan düşülür. `today` Europe/Istanbul günüdür.
 */
export function outstandingTuitionCents(
  invoices: readonly {
    id: string
    amount: number
    paidAt?: string | null
    feeKind?: string
    academicYear?: number
    dueDate: string
  }[],
  allocated: ReadonlyMap<string, number>,
  renewalYear: number,
  today: string,
): number {
  let total = 0
  for (const invoice of invoices) {
    if ((invoice.feeKind ?? 'tuition') !== 'tuition') continue
    if (dayKey(invoice.dueDate) >= today) continue
    if (invoice.academicYear !== undefined && invoice.academicYear >= renewalYear) continue
    if (invoice.paidAt) continue
    total += Math.max(invoice.amount - (allocated.get(invoice.id) ?? 0), 0)
  }
  return total
}

/**
 * Borçlu öğrencinin yenilemesi yöneticinin açık onayını ister (DOM-KAY-025, ÖÖKY md. 55/2): onay
 * yoksa 422 `renewal_debt_unapproved`, onayı yönetici dışındaki rol verirse 403. Borç akademik
 * kayıtlara erişimi engellemez; yalnız yenileme kararına girer.
 */
function requireDebtDecision(session: Session, debtCents: number, approved: boolean) {
  if (debtCents <= 0) return
  if (!approved)
    throw new DomainError(
      'renewal_debt_unapproved',
      'Öğrencinin önceki yıldan ödenmemiş öğrenim ücreti borcu var; yenileme yöneticinin açık onayıyla planlanır.',
      { path: ['debtApproved'] },
    )
  if (session.role !== 'yonetici')
    throw new DomainError(
      'renewal_debt_approval_forbidden',
      'Borçlu öğrencinin yenilemesini yalnız yönetici onaylar.',
      { kind: 'forbidden', path: ['debtApproved'] },
    )
}

/** Formun ücret özeti: planla aynı kurallar, hiçbir kayıt değişmez. */
export function quoteRenewal(
  state: State,
  session: Session,
  input: unknown,
  context: RenewalContext,
): RenewalPrice {
  requireRenewalRole(session)
  return priceRenewal(state, session, renewalQuoteSchema.parse(input), context).price
}

/** Ay sonunu aşan gün ayın son gününe çekilir (kesin kayıtla aynı plan). */
export function dueDateOf(start: Date, index: number): string {
  const lastDay = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index + 1, 0),
  ).getUTCDate()
  return new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + index,
      Math.min(start.getUTCDate(), lastDay),
      9,
    ),
  ).toISOString()
}

/**
 * Yenilemeyi planlar: reddedilen istekte State değişmez, bütün denetimler yazmadan önce yapılır.
 * Sözleşme yalnız kendi taksitlerini listeler (`invoiceIds`, DOM-FIN-012); burs ataması servisçe
 * aynı işlemde yazılır. Mezuniyet borç ve sözleşme açmaz.
 */
export function planRenewal(
  state: State,
  session: Session,
  input: unknown,
  makeId: MakeId,
  now: string,
  context: RenewalContext & { approvedByUserId: string },
): {
  renewal: Renewal
  contractId: string | null
  scholarshipAward: RenewalPrice['scholarship']
} {
  requireRenewalRole(session)
  const data = renewalPlanSchema.parse(input)
  if (data.mode === 'graduate') {
    const { student, oldClass } = renewalPreconditions(state, session, {
      studentId: data.studentId,
      targetClassId: '',
      year: data.academicYear,
      mode: 'graduate',
    })
    const entry: Renewal = {
      id: makeId('renewal'),
      studentId: student.id,
      fromClassId: oldClass.id,
      targetClassId: '',
      year: data.academicYear,
      mode: data.mode,
      amount: 0,
      status: 'Planlandı',
      createdAt: now,
      updatedAt: now,
    }
    state.renewals.unshift(entry)
    return { renewal: entry, contractId: null, scholarshipAward: null }
  }
  const { mode, tariffId, firstDueDate, debtApproved, ...quoteFields } = data
  const { student, oldClass, target, price } = priceRenewal(state, session, quoteFields, context)
  requireDebtDecision(session, price.outstandingTuitionCents, debtApproved === true)
  if (tariffId !== price.tariffId)
    throw new DomainError(
      'tariff_changed',
      'Ücret tarifesi değişti. Ödeme planını yeniden kontrol edin.',
      { kind: 'conflict' },
    )
  const contractId = makeId('contract')
  const start = new Date(`${firstDueDate}T09:00:00.000Z`)
  const invoice = (fields: {
    installment: number
    amount: number
    dueDate: string
    feeKind: string
  }) => ({
    id: makeId('inv'),
    studentId: student.id,
    contractId,
    academicYear: data.academicYear,
    paidAt: null,
    method: null,
    reminderAt: null,
    createdAt: now,
    updatedAt: now,
    ...fields,
  })
  const tuitionInvoices = price.installments.map((amount, index) =>
    invoice({
      installment: index + 1,
      amount,
      dueDate: dueDateOf(start, index),
      feeKind: 'tuition',
    }),
  )
  // Ek hizmetler ayrı borç kalemidir, öğrenim ücretine gömülmez (DOM-FIN-003).
  const extraInvoices = price.extras.map((extra, index) =>
    invoice({
      installment: price.installments.length + index + 1,
      amount: extra.amountCents,
      dueDate: start.toISOString(),
      feeKind: extra.kind,
    }),
  )
  const invoices = [...tuitionInvoices, ...extraInvoices]
  state.contracts.push({
    id: contractId,
    studentId: student.id,
    classId: target.id,
    academicYear: data.academicYear,
    date: now,
    amount: invoices.reduce((sum, item) => sum + item.amount, 0),
    title: `${String(data.academicYear)}–${String(data.academicYear + 1)} eğitim sözleşmesi`,
    invoiceIds: invoices.map((item) => item.id),
    tariffId: price.tariffId,
    tariffVersion: price.tariffVersion,
    grossCents: price.tuitionCents,
    netCents: price.netCents,
    discounts: price.discounts,
    extras: price.extras,
    approvedByUserId: context.approvedByUserId,
    payer: 'guardian',
    ...(price.scholarship === null ? {} : { scholarship: price.scholarship }),
  })
  state.invoices.push(...invoices)
  const entry: Renewal = {
    id: makeId('renewal'),
    studentId: student.id,
    fromClassId: oldClass.id,
    targetClassId: target.id,
    year: data.academicYear,
    mode,
    contractId,
    status: 'Planlandı',
    amount: price.netCents,
    gross: price.tuitionCents,
    discountAmount: price.discountCents,
    scholarshipAmount: price.scholarship?.amountCents ?? 0,
    installments: price.installments,
    count: price.installments.length,
    startDate: firstDueDate,
    pricing: {
      tariffId: price.tariffId,
      tariffVersion: price.tariffVersion,
      announcedCents: price.announcedCents,
      ceiling: price.ceiling,
      discounts: price.discounts,
      extras: price.extras,
      scholarship: price.scholarship,
    },
    createdAt: now,
    updatedAt: now,
  }
  state.renewals.unshift(entry)
  return { renewal: entry, contractId, scholarshipAward: price.scholarship }
}

// --- ÜFE ve TÜFE profili (DOM-FIN-005) ---------------------------------------------------------

const rate = (message: string) =>
  z.number(message).int('Oranı on binde birlik tam sayı girin.').min(0, message).max(100_000)
const sourceSchema = z
  .string('Kaynağı yazın.')
  .trim()
  .min(2, 'Kaynağı yazın.')
  .max(200, 'En fazla 200 karakter girebilirsiniz.')

/**
 * Ücret yılının tavan oranları: `academicYear` sınırlanan ücretin yılıdır, oranlar bir önceki yılın
 * ortalamalarıdır. Kaynak TÜİK bülteni ve tarihiyle birlikte girilir.
 */
export const createPriceIndexSchema = z.strictObject({
  academicYear: yearSchema,
  ppiBasisPoints: rate('ÜFE ortalamasını girin.'),
  cpiBasisPoints: rate('TÜFE ortalamasını girin.'),
  source: sourceSchema,
  bulletinDate: daySchema,
})
export type CreatePriceIndexInput = z.input<typeof createPriceIndexSchema>

export const updatePriceIndexSchema = createPriceIndexSchema
  .omit({ academicYear: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan girin.')
export type UpdatePriceIndexInput = z.input<typeof updatePriceIndexSchema>

function requireBulletinPublished(day: string | undefined, today: string) {
  if (day !== undefined && day > today)
    throw new DomainError('price_index_date_future', 'Bülten tarihi gelecekte olamaz.', {
      path: ['bulletinDate'],
    })
}

/** Bir yıla tek oran satırı girilir; düzeltme güncellemeyledir. */
export function planPriceIndexCreate(input: unknown, existing: boolean, today: string) {
  const data = createPriceIndexSchema.parse(input)
  requireBulletinPublished(data.bulletinDate, today)
  if (existing)
    throw new DomainError('price_index_exists', 'Bu yılın oranları zaten girilmiş.', {
      kind: 'conflict',
      path: ['academicYear'],
    })
  return data
}

export function planPriceIndexUpdate(input: unknown, today: string) {
  const data = updatePriceIndexSchema.parse(input)
  requireBulletinPublished(data.bulletinDate, today)
  return data
}
