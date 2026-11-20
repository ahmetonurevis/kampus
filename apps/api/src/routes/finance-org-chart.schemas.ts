import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { ORG_ASSIGNMENT_STATES, ORG_UNIT_KINDS } from '@kampus/school-core/lib/finance-org-chart.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Organizasyon şeması şemaları (DOM-FIN-129; ON-187). */

const unitSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable().describe('Üst birim; boşsa kök'),
  kind: z.enum(ORG_UNIT_KINDS),
  isActive: z.boolean(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

const holderSchema = z.object({
  assignmentId: z.string(),
  membershipId: z.string().describe('Personelin kurum üyeliği'),
  // kvkk: K
  staffName: z.string().describe('Personel adı (üyelikten)'),
  startDate: z.string(),
  endDate: z.string().nullable(),
  version: z.number().int().describe('Atamanın `If-Match` sürümü'),
})

const positionSchema = z.object({
  id: z.string(),
  unitId: z.string(),
  title: z.string(),
  headcount: z.number().int().describe('Kadro sayısı'),
  reportsToPositionId: z.string().nullable().describe('Raporladığı pozisyon; boşsa en üst'),
  filled: z.number().int().describe('Verilen gün süren atama sayısı'),
  vacant: z.number().int().describe('Boş kadro (kadro − dolu, en az 0)'),
  holders: z.array(holderSchema).describe('Verilen gün pozisyondaki personel'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

export const unitResponse = dataResponse(unitSchema)
export const positionResponse = dataResponse(positionSchema)
export const archiveResponse = dataResponse(z.object({ id: z.uuid(), archivedAt: z.string() }))

export const orgChartResponse = dataResponse(
  z.object({
    date: z.string().describe('Görevlilerin hesaplandığı gün'),
    units: z.array(unitSchema).describe('Bütün birimler (pasifler dahil)'),
    positions: z.array(positionSchema).describe('Kaldırılmamış pozisyonlar'),
    totals: z.object({
      units: z.number().int(),
      activeUnits: z.number().int(),
      positions: z.number().int(),
      headcount: z.number().int(),
      filled: z.number().int(),
      vacant: z.number().int(),
    }),
  }),
)

const dateQuery = daySchema
  .optional()
  .describe('Hesap günü (YYYY-MM-DD); varsayılan bugün (Europe/Istanbul)')

export const orgChartQuery = z.strictObject({ date: dateQuery })

const vacancySchema = z.object({
  positionId: z.string(),
  title: z.string(),
  unitId: z.string(),
  unitName: z.string(),
  headcount: z.number().int(),
  filled: z.number().int(),
  vacant: z.number().int(),
  reportsToPositionId: z.string().nullable(),
})
export const vacancyListResponse = z.object({
  data: z.array(vacancySchema),
  meta: pageMetaSchema.extend({ date: z.string().describe('Hesap günü') }),
})
export const vacancyListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  date: dateQuery,
  unitId: z.uuid('Birim geçersiz.').optional().describe('Yalnız bu birimin pozisyonları'),
  q: z.string().trim().min(2).max(100).optional().describe('Unvanda ya da birim adında arama'),
})

const assignmentSchema = z.object({
  id: z.string(),
  positionId: z.string(),
  positionTitle: z.string(),
  unitId: z.string(),
  membershipId: z.string().describe('Personelin kurum üyeliği'),
  // kvkk: K
  staffName: z.string().describe('Personel adı (üyelikten)'),
  staffRole: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  state: z.enum(ORG_ASSIGNMENT_STATES).describe('Hesap gününe göre süren, başlayacak, bitti'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
export const assignmentResponse = dataResponse(assignmentSchema)
export const assignmentListResponse = z.object({
  data: z.array(assignmentSchema),
  meta: pageMetaSchema,
})
export const assignmentListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  date: dateQuery,
  positionId: z.uuid('Pozisyon geçersiz.').optional().describe('Yalnız bu pozisyonun atamaları'),
  membershipId: z.string().trim().min(1).max(100).optional().describe('Yalnız bu personel'),
  state: z.enum(ORG_ASSIGNMENT_STATES).optional().describe('Atama durumu'),
})

export const unitParams = z.object({ unitId: z.uuid('Birim geçersiz.') })
export const positionParams = z.object({ positionId: z.uuid('Pozisyon geçersiz.') })
export const assignmentParams = z.object({ assignmentId: z.uuid('Atama geçersiz.') })
