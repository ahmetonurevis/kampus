import { z } from 'zod'

import { HR_ROLE_GROUPS, SENIORITY_BAND_KEYS } from '@kampus/school-core/lib/finance-hr-reports.ts'
import { LEAVE_KINDS } from '@kampus/school-core/lib/finance-staff-leave.ts'
import {
  staffCostMonthSchema,
  staffCostRangeIssue,
} from '@kampus/school-core/lib/finance-staff-costs.ts'

import { dataResponse } from './common.schemas.ts'

/** İK raporu şemaları (DOM-FIN-117; ON-192). Kişi adı ve kimliği yoktur; yalnız yöneticiye döner. */

export const hrReportQuery = z
  .strictObject({
    from: staffCostMonthSchema
      .optional()
      .describe('Başlangıç ayı (YYYY-MM); varsayılan `to` ya da bu ay (Europe/Istanbul)'),
    to: staffCostMonthSchema.optional().describe('Bitiş ayı (YYYY-MM, dahil); varsayılan `from`'),
    purpose: z
      .enum(['view', 'pdf'], 'Amaç `view` ya da `pdf` olmalıdır.')
      .default('view')
      .describe(
        '`view` ekran (denetim `finance.hr_report.read`), `pdf` PDF üretimi (denetim `finance.hr_report.export`, taze oturum)',
      ),
  })
  .superRefine((value, context) => {
    if (value.from === undefined || value.to === undefined) return
    const issue = staffCostRangeIssue(value.from, value.to)
    if (issue !== null) context.addIssue({ code: 'custom', path: ['to'], message: issue })
  })

const hiddenInt = (description: string) =>
  z.number().int().nullable().describe(`${description}; küçük grupta boş`)
const turnoverFields = {
  opening: hiddenInt('Dönem başı personel (ilk günden önce girip ilk gün çalışan)'),
  hires: hiddenInt('Dönemde giren'),
  exits: hiddenInt('Dönemde çıkan (pasifleştirilen)'),
  closing: hiddenInt('Dönem sonu personel (son gün ya da bugün çıkmamış)'),
  averageHeadcount: z
    .number()
    .nullable()
    .describe('(dönem başı + dönem sonu) ÷ 2; buçuklu olabilir; küçük grupta boş'),
  turnoverBasisPoints: hiddenInt('Devir oranı, on binde bir (1250 = %12,5); ortalama 0 ise de boş'),
  suppressed: z.boolean().describe('Küçük grup: 1–4 kişi ya da ikincil bastırma (K-401)'),
}

export const hrReportResponse = dataResponse(
  z.object({
    from: z.string(),
    to: z.string(),
    firstDay: z.string().describe('Dönemin ilk günü (YYYY-MM-DD)'),
    lastDay: z.string().describe('Dönemin son günü'),
    endDay: z.string().describe('Hesabın bittiği gün: son gün ya da süren dönemde bugün'),
    minGroupSize: z.number().int().describe('Sayıların gösterildiği en küçük kişi sayısı'),
    turnover: z.object({
      totals: z.object(turnoverFields).describe('Kurum toplamı; kurum 1–4 kişiyse gizli'),
      byRole: z.array(
        z.object({
          group: z
            .enum(HR_ROLE_GROUPS)
            .describe('`teacher` öğretmen, `administrative` yönetici ve ön büro'),
          ...turnoverFields,
        }),
      ),
      byCenter: z.array(
        z.object({
          id: z.string().nullable().describe('Atanmamış satırında boş'),
          code: z.string().nullable(),
          name: z.string(),
          path: z.string().nullable().describe('Kökten merkeze kod yolu'),
          isActive: z.boolean(),
          ...turnoverFields,
        }),
      ),
    }),
    seniority: z.object({
      asOf: z.string().describe('Kıdemin hesaplandığı gün (dönem sonu)'),
      total: hiddenInt('Dönem sonundaki personel'),
      totalSuppressed: z.boolean(),
      bands: z.array(
        z.object({
          key: z.enum(SENIORITY_BAND_KEYS),
          count: hiddenInt('Banttaki personel'),
          suppressed: z.boolean(),
        }),
      ),
    }),
    leave: z.object({
      types: z.array(
        z.object({
          code: z.string(),
          label: z.string(),
          kind: z.enum(LEAVE_KINDS),
          usedDays: hiddenInt('Dönemde başlayan kayıtların iş günü toplamı'),
          staffCount: hiddenInt('Bu türden izin kullanan personel'),
          perStaffDays: z
            .number()
            .nullable()
            .describe('Kullanılan gün ÷ ortalama personel (bir ondalık); küçük grupta boş'),
          suppressed: z.boolean(),
        }),
      ),
      totals: z.object({
        usedDays: hiddenInt('Toplam kullanılan gün'),
        staffCount: hiddenInt('İzin kullanan personel'),
        perStaffDays: z.number().nullable(),
        suppressed: z.boolean(),
      }),
      balance: z.object({
        staffCount: hiddenInt('Dönem sonunda kıdem başlangıcı girilmiş personel'),
        balanceDays: hiddenInt('Kalan yıllık izin bakiyesi toplamı (gün; eksi avans izindir)'),
        perStaffDays: z.number().nullable(),
        suppressed: z.boolean(),
        missingProfileCount: z
          .number()
          .int()
          .describe('Dönem sonunda kıdem başlangıcı girilmemiş personel (bakiyeye girmez)'),
      }),
      medical: z
        .object({
          totalDays: hiddenInt('Rapor günleri toplamı (takvim günü)'),
          suppressed: z.boolean(),
        })
        .describe('Yalnız kurum toplamı; raporlu personel 1–4 ise gizli (K-402)'),
    }),
    warnings: z.object({
      missingSeniorityCount: z
        .number()
        .int()
        .describe('Dönemdeki personelden kıdem başlangıcı girilmemiş olanlar'),
    }),
  }),
)
