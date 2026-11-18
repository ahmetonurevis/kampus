import { z } from 'zod'

import {
  TEACHER_PERMIT_STATUSES,
  WORK_PERMIT_STATES,
  WORK_PERMIT_STATUSES,
  WORK_PERMIT_TYPES,
} from '@kampus/school-core/lib/finance-work-permits.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Öğretmen çalışma onayı şemaları (DOM-FIN-114; ON-174). Yalnız yöneticiye döner (K-377). */

const permitTypeSchema = z
  .enum(WORK_PERMIT_TYPES)
  .describe('`initial` ilk onay, `renewal` yenileme, `branch_change` branş değişikliği')

const permitSchema = z.object({
  id: z.string(),
  teacher: z.object({ membershipId: z.string(), name: z.string() }),
  permitType: permitTypeSchema,
  branch: z.string(),
  status: z
    .enum(WORK_PERMIT_STATUSES)
    .describe('Saklanan durum: `preparing`, `applied`, `approved`, `rejected`'),
  state: z
    .enum(WORK_PERMIT_STATES)
    .describe('Gösterilen durum; geçerlilik bitişi bugünden önceki onay `expired` (K-376)'),
  applicationDate: z.string().nullable().describe('MEBBİS başvuru günü (YYYY-MM-DD)'),
  approvalDate: z.string().nullable().describe('Onay günü'),
  approvalNumber: z.string().nullable().describe('Onay sayısı ya da belge numarası'),
  validUntil: z
    .string()
    .nullable()
    .describe('Geçerlilik bitişi (dahil); onaylı kayıtta boşsa süresiz'),
  rejectionDate: z.string().nullable().describe('Ret günü'),
  documentFileId: z.string().nullable().describe('Onay belgesi dosyası'),
  note: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

const permitDetailSchema = permitSchema.extend({
  rejectionReason: z.string().nullable(),
  documentFile: z
    .object({ id: z.string(), name: z.string(), byteSize: z.number().int() })
    .nullable()
    .describe('Onay belgesi; silinmiş ya da reddedilmiş dosyada boş'),
})

export const permitResponse = dataResponse(permitDetailSchema)
export const permitListResponse = z.object({ data: z.array(permitSchema), meta: pageMetaSchema })
export const permitCancelResponse = dataResponse(
  z.object({ id: z.string(), cancelledAt: z.string() }),
)

const teacherRowSchema = z.object({
  membershipId: z.string(),
  name: z.string(),
  status: z
    .enum(TEACHER_PERMIT_STATUSES)
    .describe(
      '`valid` geçerli, `expiring` 30 gün içinde dolacak, `expired` süresi doldu, `missing` onay yok (K-376)',
    ),
  daysLeft: z
    .number()
    .int()
    .nullable()
    .describe('Geçerlilik bitişine kalan gün (eksi: geçen); süresiz ya da onaysızsa boş'),
  current: z
    .object({
      id: z.string(),
      permitType: permitTypeSchema,
      branch: z.string(),
      approvalDate: z.string(),
      validUntil: z.string().nullable(),
    })
    .nullable()
    .describe('Geçerli (bitişi en geç) onay'),
  openApplication: z
    .object({
      id: z.string(),
      permitType: permitTypeSchema,
      status: z.enum(WORK_PERMIT_STATUSES),
      applicationDate: z.string().nullable(),
    })
    .nullable()
    .describe('Hazırlanan ya da başvurulan kayıt'),
  teaching: z
    .boolean()
    .describe('Önümüzdeki 30 günde ders programında dersi ya da süren dil grubu var (K-376)'),
  warning: z
    .boolean()
    .describe('Programda görevli ve geçerli onayı yok (onay yok ya da süresi doldu)'),
})
export const teacherListResponse = z.object({
  data: z.array(teacherRowSchema),
  meta: pageMetaSchema,
  counts: z
    .object({
      attention: z.number().int().describe('Geçerli onayı olmayan ya da süresi dolmak üzere olan'),
      warning: z.number().int().describe('Programda görevli ve geçerli onayı olmayan'),
    })
    .describe('Süzgeçten bağımsız rozet sayıları (bütün etkin öğretmenler)'),
})

const search = z.string().trim().min(2).max(100).optional()

export const teacherListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: search.describe('Öğretmen adında arama'),
  status: z
    .enum([...TEACHER_PERMIT_STATUSES, 'attention'])
    .optional()
    .describe('Onay durumu; `attention` geçerli olmayan her durum (dolmak üzere, doldu, yok)'),
  warning: z
    .enum(['true', 'false'])
    .optional()
    .describe('`true` yalnız programda görevli ve onaysız öğretmenler'),
})

export const permitListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: search.describe('Öğretmen adında ve branşta arama'),
  membershipId: z.string().trim().min(1).max(100).optional().describe('Öğretmenin üyeliği'),
  state: z.enum(WORK_PERMIT_STATES).optional().describe('Gösterilen durum'),
})

export const permitParams = z.object({ permitId: z.uuid('Çalışma onayı kaydı geçersiz.') })
