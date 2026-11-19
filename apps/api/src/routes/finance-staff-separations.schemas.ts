import { z } from 'zod'

import { FIXED_ASSET_RETURN_CONDITIONS } from '@kampus/school-core/lib/finance-fixed-asset-assignments.ts'
import {
  SGK_EXIT_CODES,
  STAFF_SEPARATION_REASONS,
  STAFF_SEPARATION_STATUSES,
  STAFF_SEPARATION_STEPS,
} from '@kampus/school-core/lib/finance-staff-separations.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** İşten ayrılış şemaları (DOM-FIN-118; ON-180). Yalnız yöneticiye döner (K-403). */

const separationSchema = z.object({
  id: z.string(),
  membershipId: z.string().describe('Ayrılan personelin kurum üyeliği'),
  // kvkk: K
  staffName: z.string().describe('Personel adı (üyelikten)'),
  staffRole: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  staffActive: z.boolean().describe('Hesap etkin mi; `false` ise pasifleştirildi (hesap kapandı)'),
  separationDate: z.string().describe('Ayrılış (son çalışma) günü'),
  reason: z.enum(STAFF_SEPARATION_REASONS).describe('Ayrılış nedeni'),
  sgkExitCode: z.enum(SGK_EXIT_CODES).describe('SGK işten ayrılış nedeni kodu (H-85)'),
  hireDate: z.string().nullable().describe('İşe giriş günü'),
  noticeGivenDate: z.string().nullable().describe('Bildirim günü'),
  // kvkk: K (serbest metin)
  note: z.string().nullable().describe('Not'),
  status: z.enum(STAFF_SEPARATION_STATUSES).describe('`open`, `completed` ya da `cancelled`'),
  createdAt: z.string().describe('Dosyanın açıldığı an'),
  completedAt: z.string().nullable().describe('İlişiğin kesildiği an'),
  cancelledAt: z.string().nullable().describe('İptal anı'),
  cancelReason: z.string().nullable().describe('İptal gerekçesi'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

const stepSchema = z.object({
  step: z.enum(STAFF_SEPARATION_STEPS),
  required: z.boolean().describe('Tamamlamak için bitmeli mi (kıdem adımı değil)'),
  automatic: z.boolean().describe('Kayıtlardan okunur, işaretlenmez'),
  done: z.boolean(),
  checkedAt: z.string().nullable().describe('Elle adımda işaret anı'),
  checkedByName: z.string().nullable().describe('İşaretleyen yönetici'),
})

const assetSchema = z.object({
  assignmentId: z
    .string()
    .describe('Zimmet kaydı; iade `POST /finance/fixed-asset-assignments/:id/return`'),
  assetId: z.string(),
  assetTagNumber: z.string().describe('Demirbaş etiket numarası'),
  assetName: z.string(),
  assignedDate: z.string(),
  returnDate: z.string().nullable().describe('İade günü; boşsa zimmet açık'),
  returnCondition: z.enum(FIXED_ASSET_RETURN_CONDITIONS).nullable(),
  version: z.number().int().describe('Zimmet kaydının sürümü (iade `If-Match`)'),
})

export const separationDetailSchema = separationSchema.extend({
  accountClosedDate: z
    .string()
    .nullable()
    .describe('Hesabın pasifleştirildiği gün (Europe/Istanbul); etkinse boş'),
  completedByName: z.string().nullable().describe('Dosyayı tamamlayan yönetici'),
  notice: z
    .object({
      applies: z.boolean().describe('Bu nedende yasal bildirim süresi uygulanır mı (H-86)'),
      weeks: z.number().int().describe('Hizmet süresine göre bildirim süresi (hafta)'),
      noticeEndDate: z.string().nullable().describe('Bildirim süresinin bittiği gün'),
      shortDays: z.number().int().describe('Ayrılış süre bitmeden ise eksik kalan gün'),
    })
    .nullable()
    .describe('Bildirim süresi bilgisi; işe giriş günü yoksa boş (K-405)'),
  steps: z.array(stepSchema).describe('Kontrol listesi, sırasıyla (K-404)'),
  missingSteps: z.array(z.enum(STAFF_SEPARATION_STEPS)).describe('Bitmemiş zorunlu adımlar'),
  assets: z.array(assetSchema).describe('Personelin zimmetleri: açıklar önce'),
  deductions: z.object({
    openAdvanceCount: z.number().int().describe('Ayrılış ayından kesilecek taksiti olan avans'),
    // kvkk: K
    openAdvanceCents: z.number().int().describe('Ayrılış ayından (dahil) kesilecek avans, kuruş'),
    // kvkk: K (icra bilgisi; okuması denetlenir)
    activeGarnishmentCount: z.number().int().describe('Süren icra sayısı'),
    currency: z.literal('TRY'),
  }),
  leave: z.object({
    hasProfile: z.boolean().describe('Personelin izin bilgisi (DOM-FIN-109) var mı'),
    unusedDays: z
      .number()
      .int()
      .nullable()
      .describe('Ayrılış günündeki kullanılmayan yıllık izin günü; tamamlanmışta dondurulmuş'),
    frozen: z.boolean().describe('Gün tamamlanma anında donduruldu mu'),
  }),
  serviceCertificate: z
    .object({ id: z.string(), label: z.string(), createdAt: z.string() })
    .nullable()
    .describe('İptal edilmemiş hizmet belgesi (DOM-FIN-106)'),
  payrollMonth: z.string().describe('Ayrılış ayı (YYYY-MM)'),
  payrollMonthLocked: z
    .boolean()
    .describe('Ayrılış ayının bordrosu onaylı (kilitli) mı; son bordro düzeltmeyle (DOM-FIN-108)'),
})

export const separationResponse = dataResponse(separationDetailSchema)
export const separationListResponse = z.object({
  data: z.array(separationSchema),
  meta: pageMetaSchema,
})

export const separationDocumentResponse = dataResponse(
  separationSchema.extend({
    institutionName: z.string().describe('Belge başlığındaki kurum adı'),
    completedByName: z.string().nullable(),
    steps: z.array(
      z.object({ step: z.enum(STAFF_SEPARATION_STEPS), required: z.boolean(), done: z.boolean() }),
    ),
    assets: z.array(assetSchema),
    unusedLeaveDays: z.number().int().nullable().describe('Kullanılmayan yıllık izin günü'),
    serviceCertificateLabel: z.string().nullable().describe('Hizmet belgesi numarası'),
    generatedAt: z.string().describe('Verinin üretildiği an'),
  }),
)

export const separationListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
  status: z.enum(STAFF_SEPARATION_STATUSES).optional().describe('Durum'),
  membershipId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Yalnız bu personelin dosyaları'),
})

export const separationParams = z.object({
  separationId: z.uuid('Ayrılış dosyası geçersiz.'),
})

export const separationCompleteBody = z.strictObject({})
