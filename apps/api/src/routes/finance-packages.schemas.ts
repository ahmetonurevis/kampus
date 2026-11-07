import { z } from 'zod'

import { PROGRESSION_OUTCOMES } from '@kampus/school-core/cefr/progression.ts'
import { enumKeys } from '@kampus/school-core/content/taxonomy.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { PACKAGE_KINDS, PACKAGE_SALE_STATUSES } from '@kampus/school-core/lib/finance-packages.ts'
import { contractPaymentTermSchema } from '@kampus/school-core/lib/payment-terms.ts'
import { COURSE_OFFER_ROW_STATUSES } from '@kampus/school-core/lib/renewal-course-offer-list.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

const PROGRESSION_OUTCOME_KEYS = enumKeys(PROGRESSION_OUTCOMES)

/** Paket ve satış uçlarının sorgu ve yanıt şemaları (IST-078; DOM-DIL-050, -051). */

const packageSchema = z.object({
  id: z.string(),
  kind: z.enum(PACKAGE_KINDS).describe('`course` kur ücreti, `hours` saat, `private` özel ders'),
  name: z.string(),
  courseId: z.string().nullable(),
  level: z.string().nullable().describe('Tarife düzeyi; kura bağlı pakette kurdan okunur'),
  lessonHours: z.number().int().nullable().describe('Kur ücreti paketinde saat kurdan okunur'),
  hourlyCents: z
    .number()
    .int()
    .nullable()
    .describe('İlan altı saat ücreti, kuruş; boşsa tarifenin saat ücreti'),
  validityDays: z.number().int().nullable().describe('Kullanım süresi, gün; boşsa süresiz'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
export const packageResponse = dataResponse(packageSchema)
export const packageArchiveResponse = dataResponse(z.object({ id: z.string() }))
export const packageListResponse = z.object({ data: z.array(packageSchema), meta: pageMetaSchema })
export const packageParams = z.object({ packageId: z.uuid('Paket geçersiz.') })
export const packageListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Paket adında arama'),
  kind: z.enum(PACKAGE_KINDS).optional(),
  courseId: z.uuid('Kur geçersiz.').optional(),
})

const lineSchema = z.object({ kind: z.string(), amountCents: z.number().int() })
export const quoteResponse = dataResponse(
  z.object({
    packageId: z.string(),
    tariffId: z.string(),
    tariffVersion: z.number().int(),
    level: z.string().nullable(),
    purchasedHours: z.number().int(),
    announcedHourlyCents: z.number().int().describe('Tarifenin saat ücreti, kuruş'),
    hourlyCents: z.number().int().describe('Uygulanan saat ücreti, kuruş'),
    announcedCents: z.number().int().describe('Saat × tarife saat ücreti'),
    grossCents: z.number().int().describe('Saat × uygulanan saat ücreti'),
    discounts: z.array(lineSchema),
    discountCents: z.number().int(),
    netCents: z.number().int().describe('İndirimden sonra öğrenim ücreti'),
    extras: z.array(lineSchema).describe('Ayrı borç kalemleri (DOM-FIN-003)'),
    installments: z.array(z.number().int()).describe('Öğrenim taksitleri, kuruş'),
    paymentTerm: contractPaymentTermSchema
      .nullable()
      .describe('Taksit sayısının ilanlı koşulu (DOM-FIN-013); koşulsuz eski tarifede boş'),
    expiresDate: z.string().nullable().describe('Son kullanma günü; boşsa süresiz'),
  }),
)

const saleSchema = z.object({
  id: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
  packageId: z.string(),
  packageName: z.string().describe('Satış anındaki ad'),
  kind: z.enum(PACKAGE_KINDS),
  courseId: z.string().nullable(),
  level: z.string().nullable().describe('Satış anındaki seviye'),
  studentId: z.string(),
  contractId: z.string().describe('Satışın açtığı sözleşme'),
  tariffId: z.string(),
  tariffVersion: z.number().int(),
  hourlyCents: z.number().int().describe('Uygulanan saat ücreti; iade bu ücretle hesaplanır'),
  grossCents: z.number().int(),
  netCents: z.number().int(),
  purchasedHours: z.number().int().describe('Satın alınan saat'),
  consumedHours: z.number().int().describe('Tüketilen saat'),
  refundedHours: z.number().int().describe('İade edilen saat'),
  remainingHours: z.number().int().describe('Kalan saat; hesaplanır, saklanmaz (DOM-DIL-051)'),
  // Eski idempotency yanıtı bu alanı taşımaz: tekrar yanıtı şemadan geçerken düşmesin.
  usedHoursRecorded: z
    .boolean()
    .default(false)
    .describe('Kullanılan saat girildi mi; `false` ise iade hesabı sıfır saate dayanır (K-21)'),
  expiresDate: z.string().nullable().describe('Son kullanma günü; boşsa süresiz'),
  status: z
    .enum(PACKAGE_SALE_STATUSES)
    .describe('`expired`: süre doldu, kalan saat silinmez; `depleted`: saat bitti. Türetilir.'),
  soldAt: z.string(),
})
export const saleResponse = dataResponse(saleSchema)

/** Okuma uçlarında tutar alanı role özgüdür: veli ve öğrenci yanıtında anahtar yoktur (K-40). */
const STAFF_ONLY = 'Yalnız `yonetici` ve `onburo` yanıtında; veli ve öğrencide alan yoktur (K-40).'
const staffOnly = <T extends z.ZodType>(schema: T, description: string) =>
  schema.optional().describe(`${description}. ${STAFF_ONLY}`)
const listedSaleSchema = saleSchema.extend({
  hourlyCents: staffOnly(
    z.number().int(),
    'Uygulanan saat ücreti, kuruş; iade bu ücretle hesaplanır',
  ),
  grossCents: staffOnly(z.number().int(), 'Saat × uygulanan saat ücreti, kuruş'),
  netCents: staffOnly(z.number().int(), 'İndirimden sonra öğrenim ücreti, kuruş'),
  studentName: z.string().nullable(),
})
export const saleListResponse = z.object({ data: z.array(listedSaleSchema), meta: pageMetaSchema })
export const saleDetailResponse = dataResponse(
  listedSaleSchema.extend({
    invoices: staffOnly(
      z.array(
        z.object({
          id: z.string(),
          installment: z.number().int(),
          amountCents: z.number().int(),
          dueDate: z.string(),
          paidAt: z.string().nullable(),
          feeKind: z.string().nullable(),
        }),
      ),
      'Sözleşmenin yalnız bu satışa ait taksitleri',
    ),
  }),
)
export const saleParams = z.object({ saleId: z.uuid('Satış geçersiz.') })
export const saleListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  studentId: z.string().min(1).max(200).optional().describe('Öğrenci; kapsamı daraltır'),
  packageId: z.uuid('Paket geçersiz.').optional(),
})

/** Kur yenileme ve üst kur teklif listesi (IST-088, ON-082; DOM-DIL-070, DOM-DIL-050). */
export const courseOfferListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Kursiyer adında arama'),
  outcome: z.enum(PROGRESSION_OUTCOME_KEYS).optional().describe('Kur sonu kararının sonucu'),
  studentId: z.string().trim().min(1).max(200).optional().describe('Tek kursiyer'),
})

const courseOfferSchema = z.object({
  studentId: z.string(),
  studentName: z.string(),
  status: z
    .enum(COURSE_OFFER_ROW_STATUSES)
    .describe('`ready` teklif açılabilir; `no_next_level` geçti ama üst seviye ya da kur yok'),
  decisionId: z.string().describe('Teklifin dayandığı onaylı kur sonu kararı'),
  outcome: z.enum(PROGRESSION_OUTCOME_KEYS),
  approvedAt: z.string().nullable().describe('Kararın onaylandığı an'),
  fromCourseId: z.string(),
  fromCourseName: z.string(),
  fromLevel: z.string(),
  courseId: z.string().nullable().describe('Teklif edilen kur; zincirsiz kurdan geçişte boş'),
  courseName: z.string().nullable(),
  level: z.string().nullable().describe('Teklif edilen seviye'),
  options: z
    .array(
      z.object({
        packageId: z.string(),
        packageName: z.string(),
        kind: z.enum(PACKAGE_KINDS),
        hours: z.number().int(),
        announcedCents: z.number().int().describe('Saat × tarifenin saat ücreti, kuruş'),
        priceCents: z
          .number()
          .int()
          .describe('Saat × uygulanan saat ücreti, kuruş; indirimler satışta düşer'),
      }),
    )
    .describe('Teklife uyan etkin paketler ve kurum tarifesinden indirimsiz fiyatı'),
  saleId: z
    .string()
    .nullable()
    .describe('Karar onayından sonra teklif edilen kur ya da seviyede yapılan son satış'),
  problem: z
    .object({ code: z.string(), message: z.string() })
    .nullable()
    .describe('Teklif açılamıyorsa nedeni'),
})
export const courseOfferListResponse = z.object({
  data: z.array(courseOfferSchema),
  meta: pageMetaSchema,
})

// --- Bakiye ve rapor (IST-114; DOM-FIN-058) ------------------------------------------------------

const hours = (description: string) => z.number().int().describe(description)
const cents = (description: string) => z.number().int().describe(`${description}, kuruş`)

const balanceAmountsSchema = z
  .object({
    netCents: cents('Satışların net ücreti'),
    recognizedCents: cents('Kullanılan saatin net ücretteki payı (tanınan gelir)'),
    returnedCents: cents('İade edilen saatin net ücretteki payı; ödenen iade değildir'),
    deferredCents: cents('Kalan saatin net ücretteki payı (ertelenmiş gelir)'),
  })
  .describe('Yalnız `yonetici` ve `onburo` yanıtında; veli ve öğrencide alan yoktur')

export const studentPackageParams = z.object({
  studentId: z.string().min(1).max(200).describe('Öğrenci kimliği'),
})
export const packageBalanceResponse = dataResponse(
  z.object({
    studentId: z.string(),
    purchasedHours: hours('Satılan (alınan) saat'),
    usedHours: hours('Kullanılan saat'),
    refundedHours: hours('Ayrılışta iade edilen saat'),
    remainingHours: hours('Kalan saat; süresi dolan saat dahil (DOM-DIL-051)'),
    expiredHours: hours('Süresi dolmuş satışların kalan saati; kalan saatin içindedir'),
    usedHoursRecorded: z
      .boolean()
      .describe('Bir satışta kullanılan saat hiç girilmediyse `false` (K-21)'),
    amounts: balanceAmountsSchema.optional(),
    sales: z.array(
      z.object({
        saleId: z.string(),
        packageName: z.string(),
        kind: z.enum(PACKAGE_KINDS),
        soldDate: z.string().describe('Satış günü, Europe/Istanbul'),
        expiresDate: z.string().nullable(),
        status: z.enum(PACKAGE_SALE_STATUSES),
        purchasedHours: z.number().int(),
        usedHours: z.number().int(),
        refundedHours: z.number().int(),
        remainingHours: z.number().int(),
        expiredHours: z.number().int(),
        usedHoursRecorded: z.boolean(),
        amounts: balanceAmountsSchema.optional(),
      }),
    ),
  }),
)

export const packageReportQuery = z.strictObject({
  ...pageQuerySchema.shape,
  from: daySchema.describe('Dönem başlangıcı (dahil), Europe/Istanbul günü'),
  to: daySchema.describe('Dönem bitişi (dahil); dönem en çok bir yıl'),
})

const flowShape = {
  soldHours: hours('Dönemde satılan saat'),
  usedHours: hours('Dönemde kullanılan saat; elle giriş düzeltmesi eksi olabilir'),
  refundedHours: hours('Dönemde ayrılışla iade edilen saat'),
  expiredHours: hours(
    'Son kullanma günü dönemde olan, bugün süresi dolmuş satışların dönem sonu kalanı',
  ),
  soldCents: cents('Dönemde satılan paketlerin net ücreti'),
  recognizedCents: cents('Dönemde kullanılan saatin net ücretteki payı (tanınan gelir)'),
  returnedCents: cents('Dönemde iade edilen saatin net ücretteki payı; ödenen iade değildir'),
}
const balanceShape = {
  openingHours: hours('Dönem başında kalan saat'),
  closingHours: hours('Dönem sonunda kalan saat'),
  openingDeferredCents: cents('Dönem başında ertelenmiş gelir'),
  closingDeferredCents: cents('Dönem sonunda ertelenmiş gelir'),
}
export const packageReportResponse = z.object({
  data: z.object({
    from: z.string(),
    to: z.string(),
    totals: z.object({
      saleCount: z.number().int().describe('Satır sayısı'),
      ...flowShape,
      ...balanceShape,
    }),
    months: z.array(z.object({ month: z.string().describe('YYYY-MM'), ...flowShape })),
    lines: z.array(
      z.object({
        saleId: z.string(),
        studentId: z.string(),
        studentName: z.string().nullable(),
        packageName: z.string(),
        kind: z.enum(PACKAGE_KINDS),
        soldDate: z.string(),
        expiresDate: z.string().nullable(),
        purchasedHours: z.number().int(),
        netCents: cents('Satışın net ücreti'),
        ...flowShape,
        ...balanceShape,
      }),
    ),
  }),
  meta: pageMetaSchema,
})
