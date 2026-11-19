import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  LEAVE_REQUEST_STATUSES,
  SUBSTITUTE_WARNINGS,
} from '@kampus/school-core/lib/finance-leave-requests.ts'
import {
  calendarDays,
  LEAVE_DAYS_MAX,
  LEAVE_KINDS,
} from '@kampus/school-core/lib/finance-staff-leave.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'
import { leaveConflictSchema } from './finance-leave-calendar.schemas.ts'

/** İzin talebi şemaları (DOM-FIN-116; ON-182). Yalnız yöneticiye döner. */

const status = z
  .enum(LEAVE_REQUEST_STATUSES)
  .describe(
    '`pending` onay bekliyor, `approved` onaylandı, `rejected` reddedildi, `cancelled` iptal',
  )
const warning = z
  .enum(SUBSTITUTE_WARNINGS)
  .describe(
    '`busy` bu saatte başka dersi var, `on_leave` bu gün izinli, `other_subject` başka branş',
  )

const requestFields = {
  id: z.string(),
  // kvkk: K (personel üyeliği)
  membershipId: z.string(),
  name: z.string().describe('Personelin adı'),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  typeCode: z.string(),
  kind: z.enum(LEAVE_KINDS),
  typeLabel: z.string().describe('Talep anındaki tür adı'),
  deductsFromAnnual: z.boolean().describe('Talep anında tür yıllık izinden düşüyor muydu'),
  startDate: z.string(),
  endDate: z.string(),
  days: z.number().int().describe('İstenen iş günü (tam gün)'),
  // kvkk: K
  description: z.string().nullable(),
  status,
  decidedAt: z.string().nullable().describe('Onay ya da ret anı'),
  // kvkk: K
  rejectReason: z.string().nullable(),
  advanceApproved: z.boolean().describe('Avans izin olarak onaylandı mı (K-398)'),
  cancelledAt: z.string().nullable(),
  // kvkk: K
  cancelReason: z.string().nullable(),
  lessonCount: z.number().int().describe('Talebe bağlı ders sayısı'),
  substitutedCount: z.number().int().describe('Yedek öğretmen seçilmiş ders sayısı'),
  createdAt: z.string(),
  version: z.number().int().describe('`If-Match` için talep sürümü'),
}

export const leaveRequestListResponse = z.object({
  data: z.array(z.object(requestFields)),
  meta: pageMetaSchema,
})

const lessonSchema = z.object({
  lessonId: z.string(),
  startsAt: z.string().describe('Dersin başlangıcı (talep anındaki kopya)'),
  duration: z.number().int().describe('Dakika'),
  classId: z.string(),
  className: z.string().nullable(),
  subjectId: z.string(),
  title: z.string(),
  substituteTeacherId: z.string().nullable(),
  substituteName: z.string().nullable(),
  substituteWarnings: z.array(warning).describe('Seçilen yedeğin uyarıları (engel değildir)'),
  candidateWarnings: z
    .array(z.object({ teacherId: z.string(), warnings: z.array(warning) }))
    .describe('Uyarısı olan yedek adayları; listede olmayan adayın uyarısı yok'),
})

const teacherSchema = z.object({
  id: z.string().describe('Öğretmen kaydı'),
  name: z.string(),
  subjectId: z.string().nullable(),
})

export const leaveRequestResponse = dataResponse(
  z.object({
    ...requestFields,
    balanceAfterDays: z
      .number()
      .int()
      .nullable()
      .describe(
        'Bekleyen talepte onaylanırsa kalacak yıllık izin (eksi avans izindir); yıllıktan düşmeyen türde ya da karara bağlanmış talepte boş',
      ),
    ownTeacherId: z.string().nullable().describe('Personelin bağlı öğretmen kaydı'),
    conflicts: z
      .array(leaveConflictSchema)
      .describe(
        'Çakışma uyarıları; kapanmış talepte boş (DOM-FIN-123, K-422; engel değildir): aynı branşta eşzamanlı izin, sınav haftası, yedeği izinli ders',
      ),
    lessons: z.array(lessonSchema).describe('Etkilenen dersler, başlangıca göre'),
    teachers: z
      .array(teacherSchema)
      .describe('Yedek adayları: etkin öğretmenler, izne çıkan hariç'),
  }),
)

export const leaveRequestPreviewResponse = dataResponse(
  z.object({
    membershipId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    ownTeacherId: z.string().nullable(),
    lessonCount: z.number().int().describe('Aralıktaki etkilenen ders sayısı'),
    lessonLimit: z.number().int().describe('Bir talebe bağlanabilecek en çok ders'),
    conflicts: z
      .array(leaveConflictSchema)
      .describe(
        'Çakışma uyarıları (DOM-FIN-123, K-422; engel değildir): aynı branşta eşzamanlı izin, sınav haftası; yedek henüz seçilmediği için yedek uyarısı yok',
      ),
    lessons: z.array(lessonSchema).describe('Etkilenen dersler (en çok `lessonLimit`)'),
    teachers: z.array(teacherSchema),
    deductsFromAnnual: z
      .boolean()
      .nullable()
      .describe('Seçilen tür yıllıktan düşer mi; tür yoksa boş'),
    balanceAfterDays: z
      .number()
      .int()
      .nullable()
      .describe('Talep onaylanırsa kalacak yıllık izin; tür, gün ya da profil yoksa boş'),
  }),
)

export const leaveRequestListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: status.optional(),
  membershipId: z.string().trim().min(1).max(100).optional().describe('Personel üyeliği'),
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
  from: daySchema.optional().describe('Bu güne ya da sonrasına uzanan talepler'),
  to: daySchema.optional().describe('Bu güne kadar başlayan talepler'),
})

export const leaveRequestPreviewQuery = z
  .strictObject({
    membershipId: z.string().trim().min(1).max(100).describe('Personel üyeliği'),
    startDate: daySchema,
    endDate: daySchema,
    typeCode: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,39}$/)
      .optional()
      .describe('İzin türü; bakiye önizlemesi için'),
    days: z.coerce.number().int().min(1).max(LEAVE_DAYS_MAX).optional().describe('İş günü'),
  })
  .superRefine((value, context) => {
    if (value.endDate < value.startDate)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Bitiş günü başlangıç gününden önce olamaz.',
      })
    else if (calendarDays(value.startDate, value.endDate) > LEAVE_DAYS_MAX)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: `Aralık en çok ${String(LEAVE_DAYS_MAX)} gün olabilir.`,
      })
  })

export const leaveRequestParams = z.object({ requestId: z.uuid('İzin talebi geçersiz.') })
