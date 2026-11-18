import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  LEAVE_KINDS,
  LEAVE_TYPE_LOCKABLE_FIELDS,
  leaveTypeCodeSchema,
} from '@kampus/school-core/lib/finance-staff-leave.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Personel izin şemaları (DOM-FIN-109; ON-181). Yalnız yöneticiye döner. */

const kind = z
  .enum(LEAVE_KINDS)
  .describe('`annual` yıllık, `excuse` mazeret, `unpaid` ücretsiz, `sick` rapor, `other` diğer')

const leaveTypeSchema = z.object({
  code: z.string().describe('Tür kodu'),
  kind,
  label: z.string(),
  paid: z.boolean().describe('İzin günleri ücretli mi'),
  deductsFromAnnual: z.boolean().describe('Yıllık izin bakiyesinden düşer mi'),
  defaultDays: z.number().int().nullable().describe('Varsayılan gün (bilgi)'),
  statutoryMinDays: z
    .number()
    .int()
    .nullable()
    .describe('Yasal en az gün (4857 Ek md. 2); varsayılan gün bunun altına inmez'),
  isActive: z.boolean(),
  isCustom: z.boolean().describe('Kurumun ek türü mü'),
  locked: z
    .array(z.enum(LEAVE_TYPE_LOCKABLE_FIELDS))
    .describe('Kurum ayarıyla değişmeyen alanlar (K-361)'),
  version: z
    .number()
    .int()
    .describe('`If-Match` için sürüm; ayarı hiç yazılmamış varsayılan türde 1'),
})
export const leaveTypeResponse = dataResponse(leaveTypeSchema)
export const leaveTypeListResponse = dataResponse(z.array(leaveTypeSchema))

const openingSchema = z
  .object({
    asOf: z.string().describe('Açılış devrinin günü'),
    days: z.number().int().describe('O günün sonundaki kalan yıllık izin (gün)'),
  })
  .nullable()

const profileSchema = z.object({
  // kvkk: K
  seniorityStartDate: z.string().describe('Kıdem başlangıcı (işe giriş günü)'),
  // kvkk: K
  birthDate: z.string().nullable().describe('Doğum günü (yaş kuralı için)'),
  openingBalance: openingSchema,
  version: z.number().int().describe('`If-Match` için profil sürümü'),
})
export const leaveProfileResponse = dataResponse(profileSchema.extend({ membershipId: z.string() }))

const recordSchema = z.object({
  id: z.string(),
  membershipId: z.string(),
  typeCode: z.string(),
  kind,
  typeLabel: z.string().describe('Kayıt anındaki tür adı'),
  paid: z.boolean().describe('Kayıt anında ücretli miydi'),
  deductsFromAnnual: z.boolean().describe('Kayıt anında yıllık izinden düşüyor muydu'),
  startDate: z.string(),
  endDate: z.string(),
  days: z.number().int().describe('Kullanılan iş günü'),
  note: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü (iptal)'),
})
export const leaveRecordResponse = dataResponse(recordSchema)
export const leaveRecordCancelResponse = dataResponse(z.object({ id: z.string() }))

const accrualSchema = z.object({
  serviceYear: z.number().int().describe('Kaçıncı hizmet yılının dolumu'),
  date: z.string().describe('Hak ediş günü (yıl dönümü)'),
  baseDays: z.number().int().describe('Kıdem dilimine göre gün (14, 20, 26)'),
  age: z.number().int().nullable().describe('Hak ediş günündeki yaş; doğum günü yoksa boş'),
  ageRule: z.boolean().describe('18 yaş altı ya da 50 yaş ve üstü en az 20 gün uygulandı mı'),
  days: z.number().int(),
})

const entitlementSchema = z.object({
  asOf: z.string(),
  serviceYears: z.number().int(),
  accruals: z
    .array(
      accrualSchema.extend({
        inOpeningBalance: z.boolean().describe('Açılış devrinin içinde (ayrıca sayılmaz)'),
      }),
    )
    .describe('Her tam hizmet yılının hak edişi'),
  next: accrualSchema.nullable().describe('Bir sonraki hak ediş; hizmet bittiyse boş'),
  openingDays: z.number().int(),
  entitledDays: z.number().int(),
  usedDays: z.number().int(),
  plannedDays: z.number().int().describe('Günden sonra başlayan yıllık izin kayıtları'),
  carriedOverDays: z.number().int().describe('Son hak edişten önceki yıllardan devreden'),
  currentYearDays: z.number().int(),
  usedThisYearDays: z.number().int(),
  balanceDays: z.number().int().describe('Kalan; eksi avans izindir'),
  balanceAfterPlannedDays: z.number().int(),
})

const staffBase = {
  membershipId: z.string(),
  name: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  active: z.boolean().describe('Pasifleştirilmiş (ayrılan) personelde `false`'),
}

const staffRowSchema = z.object({
  ...staffBase,
  seniorityStartDate: z.string().nullable().describe('Kıdem başlangıcı; profil yoksa boş'),
  summary: z
    .object({
      serviceYears: z.number().int(),
      lastAccrualDate: z.string().nullable(),
      annualDays: z.number().int().nullable().describe('Son hak edişte kazanılan gün'),
      nextAccrualDate: z.string().nullable(),
      nextAccrualDays: z.number().int().nullable(),
      entitledDays: z.number().int(),
      usedDays: z.number().int(),
      carriedOverDays: z.number().int(),
      balanceDays: z.number().int(),
      balanceAfterPlannedDays: z.number().int(),
    })
    .nullable()
    .describe('Gündeki yıllık izin özeti; profil yoksa boş'),
  recordCount: z.number().int().describe('İptal edilmemiş izin kaydı sayısı'),
})
export const leaveStaffListResponse = z.object({
  data: z.array(staffRowSchema),
  meta: pageMetaSchema,
})

export const leaveStaffDetailResponse = dataResponse(
  z.object({
    ...staffBase,
    date: z.string().describe('Bakiyenin hesaplandığı gün'),
    employmentEndDate: z
      .string()
      .nullable()
      .describe('Pasifleştirilme günü; hizmet o gün biter (etkin personelde boş)'),
    profile: profileSchema.nullable(),
    entitlement: entitlementSchema.nullable().describe('Hak ediş ve bakiye; profil yoksa boş'),
    records: z.array(recordSchema).describe('İptal edilmemiş kayıtlar, yeni başlayan önce'),
  }),
)

const dateQuery = daySchema
  .optional()
  .describe('Bakiyenin hesaplanacağı gün (YYYY-MM-DD); varsayılan bugün (Europe/Istanbul)')

export const leaveStaffListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
  status: z
    .enum(['active', 'passive'])
    .optional()
    .describe('`active` etkin, `passive` pasifleştirilmiş (ayrılan) personel'),
  date: dateQuery,
})
export const leaveStaffDetailQuery = z.strictObject({ date: dateQuery })

export const leaveStaffParams = z.object({
  membershipId: z.string().trim().min(1).max(100).describe('Personelin kurum üyeliği'),
})
export const leaveTypeParams = z.object({ code: leaveTypeCodeSchema })
export const leaveRecordParams = z.object({ recordId: z.uuid('İzin kaydı geçersiz.') })
