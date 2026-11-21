import { z } from 'zod'

import { WAGE_TYPES } from '@kampus/school-core/lib/finance-pay-rates.ts'
import {
  SGK_REASON_CODES,
  SGK_WARNINGS,
  sgkMonthSchema,
} from '@kampus/school-core/lib/finance-sgk-preparation.ts'

import { dataResponse } from './common.schemas.ts'

/** SGK bildirge hazırlık listesi şemaları (DOM-FIN-107; ON-203). Yalnız yöneticiye döner (K-355). */

export const sgkPreparationQuery = z.strictObject({
  month: sgkMonthSchema.describe('Ay (`YYYY-MM`)'),
  purpose: z
    .enum(['view', 'pdf'], 'Amaç `view` ya da `pdf` olmalıdır.')
    .default('view')
    .describe(
      '`view` ekran (denetim `finance.sgk_preparation.read`), `pdf` PDF üretimi (denetim `finance.sgk_preparation_export`, taze oturum)',
    ),
})

const reasonCode = z.enum(SGK_REASON_CODES)
const source = z.enum(['pay_rate', 'manual']).nullable()

const missingDaySchema = z.object({
  id: z.uuid(),
  membershipId: z.string(),
  days: z.number().int().describe('Eksik gün (1–30)'),
  reasonCode: reasonCode.nullable().describe('Eksik gün nedeni kodu; boşsa girilmemiş'),
  note: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü (kaldırma)'),
  createdAt: z.string(),
})
const employmentDatesSchema = z.object({
  id: z.uuid(),
  membershipId: z.string(),
  entryDate: z.string().nullable().describe('Elle işe giriş günü (YYYY-MM-DD)'),
  exitDate: z.string().nullable().describe('Elle işten çıkış günü (YYYY-MM-DD)'),
  note: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü (kaldırma)'),
  createdAt: z.string(),
})

const rowSchema = z.object({
  membershipId: z.string(),
  // kvkk: K
  name: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  active: z.boolean().describe('Pasifleştirilmiş (ayrılan) personelde `false`'),
  entryDate: z.string().nullable().describe('Ay içindeyse işe giriş günü'),
  entrySource: source.describe('`pay_rate` ücret tanımından, `manual` elle'),
  exitDate: z.string().nullable().describe('Ay içindeyse işten çıkış günü'),
  exitSource: source.describe('`pay_rate` ücret tanımından, `manual` elle'),
  baseDays: z
    .number()
    .int()
    .describe('Eksik gün düşülmeden: tam ayda 30, ay içi giriş/çıkışta takvim günü (en çok 30)'),
  missingDays: z.number().int().describe('Elle girilen eksik gün toplamı'),
  primDays: z.number().int().describe('Prim günü: taban gün − eksik gün (0 altına inmez)'),
  reasonCode: reasonCode
    .nullable()
    .describe('Ayın eksik gün nedeni kodu; birden fazla neden 12 (kısa çalışmada 27, yarımda 24)'),
  // kvkk: K (ücret)
  wage: z
    .object({
      rateType: z.enum(WAGE_TYPES),
      amountCents: z.number().int(),
      startDate: z.string(),
    })
    .nullable()
    .describe('Son çalışılan günde yürürlükteki ana ücret'),
  // kvkk: K (ücret)
  cashBenefitsCents: z.number().int().describe('Nakdi yan hakların aylık toplamı, kuruş'),
  floorCents: z.number().int().describe('Prim günüyle orantılı SGK tabanı, kuruş'),
  ceilingCents: z.number().int().describe('Prim günüyle orantılı SGK tavanı, kuruş'),
  // kvkk: K (ücret)
  sgkBaseCents: z
    .number()
    .int()
    .nullable()
    .describe('SGK matrahı tahmini, kuruş; ana ücret aylık brüt değilse `null`'),
  warnings: z.array(z.enum(SGK_WARNINGS)).describe('Uyarı kodları'),
  missingDayEntries: z.array(missingDaySchema),
  employmentDates: employmentDatesSchema.nullable(),
})

export const sgkPreparationResponse = dataResponse(
  z.object({
    month: z.string(),
    firstDay: z.string(),
    lastDay: z.string(),
    daysInMonth: z.number().int(),
    parameters: z.object({
      effectiveFrom: z.string().describe('Kullanılan bordro parametre setinin başlangıcı'),
      origin: z.enum(['platform', 'institution']),
      stale: z.boolean().describe('Ayın yılı için set yok, son bilinen set kullanıldı'),
      unverified: z.boolean().describe('Asgari ücret ya da taban/tavan çarpanı doğrulanmamış'),
      minimumWageGrossCents: z.number().int(),
      floorCents: z.number().int().describe('Aylık SGK tabanı, kuruş'),
      ceilingCents: z.number().int().describe('Aylık SGK tavanı, kuruş'),
    }),
    rows: z.array(rowSchema),
    totals: z.object({
      staffCount: z.number().int(),
      primDays: z.number().int(),
      missingDays: z.number().int(),
      sgkBaseCents: z.number().int(),
      unestimatedCount: z.number().int(),
      warningRowCount: z.number().int(),
    }),
  }),
)

export const sgkMissingDayResponse = dataResponse(
  missingDaySchema.extend({ month: z.string().describe('Ay (`YYYY-MM`)') }),
)
export const sgkEmploymentDatesResponse = dataResponse(
  employmentDatesSchema.extend({ month: z.string().describe('Ay (`YYYY-MM`)') }),
)
export const sgkArchiveResponse = dataResponse(z.object({ id: z.uuid(), archivedAt: z.string() }))
export const sgkEntryParams = z.object({ entryId: z.uuid('Satır geçersiz.') })
