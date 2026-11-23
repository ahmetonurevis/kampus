import { z } from 'zod'

import {
  createPermissionFormSchema,
  decidePermissionSchema,
  PERMISSION_DECISIONS,
  PERMISSION_FORM_TOPIC_KEYS,
  updatePermissionFormSchema,
} from '@kampus/school-core/lib/permission-forms.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * İzin formu uçlarının şemaları (IST-067; docs/domain/iletisim-ve-veli.md DOM-ILT-030, -031,
 * -036…039). Gövdeler core işlem şemalarıdır (`lib/permission-forms.ts`), katıdır (bilinmeyen
 * alan 400). Yanıt beyaz listedir: karar verenin kullanıcı kimliği yalnız yöneticiye döner;
 * hedef sınıflar ve formu açan öğretmen veli ve öğrenciye dönmez; karar satırı ve velinin notu
 * yalnız yönetici, rehber öğretmen, kararı veren veli ve öğrenciye döner (DOM-ILT-037).
 */

const identifier = z.string().min(1).max(200)
const instant = z.string().describe('ISO 8601 UTC')

export const permissionFormParamsSchema = z.object({
  formId: identifier.describe('İzin formu kimliği'),
})

export const PERMISSION_FORM_STATUSES = ['open', 'closed'] as const
export const PERMISSION_FORM_STATUS_FILTERS = ['all', ...PERMISSION_FORM_STATUSES] as const
export const PERMISSION_STATUSES = ['pending', ...PERMISSION_DECISIONS] as const

export const permissionFormListQuerySchema = pageQuerySchema
  .extend({
    status: z
      .enum(PERMISSION_FORM_STATUS_FILTERS)
      .default('all')
      .describe('`open` karar alan, `closed` kapatılmış ya da son günü geçmiş; varsayılan `all`'),
    topic: z.enum(PERMISSION_FORM_TOPIC_KEYS).optional().describe('Konu türü'),
    q: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .optional()
      .describe('Başlık araması; Türkçe büyük/küçük harf ve aksan duyarsız, parça eşleşir'),
  })
  .strict()

export const createPermissionFormBodySchema = createPermissionFormSchema
export const updatePermissionFormBodySchema = updatePermissionFormSchema
export const decidePermissionBodySchema = decidePermissionSchema

const version = z.number().int().min(1).describe('Kaydın sürümü; yazmada `If-Match`')

export const permissionFormSchema = z
  .object({
    id: z.string(),
    version,
    topic: z.enum(PERMISSION_FORM_TOPIC_KEYS),
    title: z.string(),
    description: z.string(),
    deadline: z.iso
      .date()
      .describe('Son gün (Europe/Istanbul, `YYYY-MM-DD`; o günün sonuna kadar)'),
    deadlineEndsAt: instant.describe('Son günün bittiği an, ISO 8601 UTC'),
    eventDate: z.iso
      .date()
      .nullable()
      .describe('Etkinlik günü (Europe/Istanbul, `YYYY-MM-DD`); belirtilmemişse `null`'),
    eventTime: z.string().nullable().describe('Etkinlik saati (`SS:DD`); belirtilmemişse `null`'),
    location: z.string().nullable().describe('Etkinlik yeri; belirtilmemişse `null`'),
    transport: z.string().nullable().describe('Ulaşım biçimi; belirtilmemişse `null`'),
    fee: z
      .number()
      .int()
      .nullable()
      .describe('Katılım ücreti, tamsayı kuruş; belirtilmemişse `null`'),
    detailsRevision: z
      .number()
      .int()
      .min(0)
      .describe(
        'Etkinlik ayrıntısı sürümü: gün, saat, yer, ulaşım ya da ücret her değiştiğinde bir artar ve o ana kadar verilen kararlar düşer (DOM-ILT-032)',
      ),
    classIds: z
      .array(z.string())
      .optional()
      .describe('Hedef sınıflar; yalnız yönetici ve öğretmene döner'),
    studentIds: z
      .array(z.string())
      .describe(
        'Hedef öğrencilerden okuyanın gördükleri: yönetici ve formun öğretmeni hepsini, öbür öğretmen kapsamındakileri, veli 18 yaş altındaki çocuğunu, öğrenci kendisini görür',
      ),
    targetStudentIds: z
      .array(z.string())
      .optional()
      .describe(
        'Sınıf dışında ya da sınıfın bir kısmı için tek tek hedeflenen öğrenciler (girildiği gibi; düzenlemede `studentIds` gövdesi). Yalnız yönetici ve formun öğretmenine döner; alanı olmayan eski kayıtta boş',
      ),
    hasDecisions: z
      .boolean()
      .optional()
      .describe(
        'Formda herhangi bir karar satırı var mı (geçerli sayılmayanlar dahil): varsa hedef daraltılamaz, form arşivlenemez. Yalnız yönetici ve formun öğretmenine döner',
      ),
    teacherId: z
      .string()
      .nullable()
      .optional()
      .describe('Formu açan öğretmen; yönetici açtıysa `null`. Yalnız yönetici ve öğretmene döner'),
    status: z
      .enum(PERMISSION_FORM_STATUSES)
      .describe('Türetilir: kapatılmış ya da son günü geçmişse `closed`'),
    closedAt: instant.nullable(),
    cancelledAt: instant
      .nullable()
      .describe('Etkinliğin iptal edildiği an (iptal formu da kapatır); iptal değilse `null`'),
    acceptingDecisions: z.boolean().describe('Form karar alıyor mu (açık ve son gün geçmemiş)'),
    createdAt: instant,
    updatedAt: instant.describe('Kaydın son değiştiği an'),
  })
  .meta({ id: 'PermissionForm' })

export const permissionCountsSchema = z
  .object({
    pending: z.number().int().min(0),
    approved: z.number().int().min(0),
    rejected: z.number().int().min(0),
    total: z.number().int().min(0),
  })
  .describe('Okuyanın gördüğü öğrencilerin geçerli izin durumlarının sayıları')
  .meta({ id: 'PermissionCounts' })

const permissionStatusSchema = z
  .enum(PERMISSION_STATUSES)
  .describe(
    'Öğrencinin geçerli durumu (saklanmaz): bir ret varsa `rejected`, yoksa bir onay `approved`, karar yoksa `pending`',
  )

export const permissionDecisionSchema = z
  .object({
    id: z.string(),
    decision: z.enum(PERMISSION_DECISIONS),
    // kvkk: Ç — velinin serbest notu.
    note: z.string(),
    relation: z
      .enum(['guardian', 'self'])
      .describe('`guardian` 18 yaş altında veli, `self` 18 yaşını doldurmuş öğrenci'),
    decidedAt: instant,
    current: z
      .boolean()
      .describe(
        '`false`: etkinlik ayrıntısı bu karardan sonra değişti ve karar düştü; satır ispat olarak kalır, durumu etkilemez (DOM-ILT-032)',
      ),
    mine: z.boolean().describe('Kararı okuyan kişi mi verdi'),
    // kvkk: K — yalnız yöneticiye döner.
    decidedByUserId: z.string().nullable().describe('Kararı veren kullanıcı; yalnız yöneticiye'),
  })
  .meta({ id: 'PermissionDecision' })

export const permissionStudentSchema = z
  .object({
    studentId: z.string(),
    status: permissionStatusSchema,
    canDecide: z
      .boolean()
      .describe(
        'Okuyan bu öğrenci için karar veren taraf mı (core `permissionDecider`): veli 18 yaş altındaki çocuğu, öğrenci 18 yaşını doldurduysa kendisi için; personelde `false`. Formun karar alıp almadığı `acceptingDecisions`',
      ),
    decisions: z
      .array(permissionDecisionSchema)
      .describe(
        'Okuyanın görebildiği kararlar, karar anına göre: yönetici ve öğrencinin rehber öğretmeni hepsini, öğrenci kendisininkileri, veli yalnız kendi kararını görür; derse giren öğretmene boş döner (yalnız `status`)',
      ),
  })
  .meta({ id: 'PermissionFormStudent' })

export const permissionFormListItemSchema = permissionFormSchema
  .extend({
    counts: permissionCountsSchema,
    students: z
      .array(permissionStudentSchema)
      .optional()
      .describe(
        'Yalnız veli ve öğrenci satırında: görünen öğrencilerin durumu, kendi kararları ve `canDecide` (karar kartı ayrıntı isteği atmaz)',
      ),
  })
  .meta({ id: 'PermissionFormListItem' })

export const permissionFormDetailSchema = permissionFormListItemSchema
  .extend({ students: z.array(permissionStudentSchema) })
  .meta({ id: 'PermissionFormDetail' })

export const permissionDecisionResultSchema = z
  .object({
    id: z.string(),
    version,
    formId: z.string(),
    studentId: z.string(),
    decision: z.enum(PERMISSION_DECISIONS),
    // kvkk: Ç — velinin serbest notu.
    note: z.string(),
    relation: z.enum(['guardian', 'self']),
    decidedAt: instant,
    studentStatus: permissionStatusSchema,
  })
  .meta({ id: 'PermissionDecisionResult' })

export const permissionFormResponseSchema = dataResponse(permissionFormSchema)
export const permissionFormDetailResponseSchema = dataResponse(permissionFormDetailSchema)
export const permissionFormListResponseSchema = pageResponse(permissionFormListItemSchema)
export const permissionDecisionResponseSchema = dataResponse(permissionDecisionResultSchema)
