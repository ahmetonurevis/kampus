import { z } from 'zod'

import { BUDGET_PERIOD_STATUSES } from '@kampus/school-core/lib/finance-budget.ts'
import { COST_CENTER_TYPES } from '@kampus/school-core/lib/finance-cost-centers.ts'
import { COST_ALLOCATION_KEYS } from '@kampus/school-core/lib/finance-cost-per-student.ts'

import { dataResponse } from './common.schemas.ts'

/** Öğrenci başı maliyet ve kampüs konsolidasyonu yanıtları (DOM-FIN-065; ON-249, ON-250). */

const cents = (description: string) => z.number().int().describe(description)
const nullableCents = (description: string) => z.number().int().nullable().describe(description)
const basisPoints = (description: string) =>
  z.number().int().nullable().describe(`${description}, on binde bir; toplam sıfırsa boş`)

const periodSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(BUDGET_PERIOD_STATUSES),
  startDate: z.string(),
  endDate: z.string(),
})

const centerSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.enum(COST_CENTER_TYPES),
  path: z.string().describe('Kökten merkeze kod yolu'),
  depth: z.number().int().describe('Kökten düzey, 1 kök'),
  isActive: z.boolean(),
  campusId: z.string().nullable().describe('Merkezin ya da en yakın üst kampüs merkezinin kampüsü'),
  directCents: cents('Merkeze doğrudan yazılmış gider'),
  shared: z.boolean().describe('Birim: gideri kapsamındaki merkezlere paylaştırıldı'),
  sharedInCents: cents('Yukarıdaki ortak giderden gelen pay'),
  totalCents: cents('Merkez ve altındaki giderler artı gelen pay; birimde kendi gideri'),
  studentCount: z.number().int().nullable().describe('Dönemde sayılan öğrenci; birimde boş'),
  perStudentCents: nullableCents('Öğrenci başı maliyet; öğrencisiz ya da küçük grupta boş'),
  suppressed: z.boolean().describe('Öğrenci sayısı eşiğin altında, değer gizlendi'),
})

export const costPerStudentResponseSchema = dataResponse(
  z.object({
    period: periodSchema,
    key: z.enum(COST_ALLOCATION_KEYS),
    minGroupSize: z.number().int().describe('Öğrenci başı değerin gösterildiği en küçük grup'),
    centers: z.array(centerSchema),
    totals: z.object({
      expenseCents: cents('Dönemin gider satırları toplamı'),
      studentCount: z.number().int(),
      perStudentCents: nullableCents('Kurum geneli öğrenci başı maliyet'),
      suppressed: z.boolean(),
      unallocatedCents: cents('Öğrencili merkez olmadığı için paylaştırılamayan ortak gider'),
      studentsWithoutCampus: z.number().int().describe('Sınıfı ya da sınıf kampüsü olmayan'),
    }),
  }),
)

const moneyFields = {
  studentCount: z.number().int(),
  accruedCents: cents('Vadesi dönemde olan taksitler (tahakkuk)'),
  collectedCents: cents('Ödeme günü dönemde olan tahsilatlar'),
  reversedCents: cents('İptal günü dönemde olan tahsilat iptalleri'),
  refundedCents: cents('Ödeme günü dönemde olan iadeler'),
  netCollectedCents: cents('Tahsilat − iptal − iade'),
  budgetExpenseCents: cents('Bütçe gideri (ortak giderden pay dahil)'),
  budgetSharedCents: cents('Bütçe giderinin ortak giderden gelen kısmı'),
  accruedPerStudentCents: nullableCents('Öğrenci başı tahakkuk; küçük grupta boş'),
  budgetExpensePerStudentCents: nullableCents('Öğrenci başı bütçe gideri; küçük grupta boş'),
  suppressed: z.boolean(),
}

export const campusConsolidationResponseSchema = dataResponse(
  z.object({
    period: periodSchema,
    key: z.enum(COST_ALLOCATION_KEYS),
    from: z.string(),
    to: z.string(),
    minGroupSize: z.number().int(),
    campuses: z.array(
      z.object({
        campusId: z.string().nullable().describe('Kampüse bağlı olmayan satırda boş'),
        name: z.string(),
        isActive: z.boolean(),
        hasCostCenter: z.boolean().describe('Kampüse bağlı maliyet merkezi var'),
        ...moneyFields,
        studentShareBasisPoints: basisPoints('Öğrenci payı'),
        accruedShareBasisPoints: basisPoints('Tahakkuk payı'),
        netCollectedShareBasisPoints: basisPoints('Net tahsilat payı'),
        budgetExpenseShareBasisPoints: basisPoints('Bütçe gideri payı'),
      }),
    ),
    totals: z.object(moneyFields).describe('Kampüsler toplamı'),
  }),
)
