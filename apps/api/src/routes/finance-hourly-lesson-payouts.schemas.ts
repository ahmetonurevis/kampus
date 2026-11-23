import { z } from 'zod'

import {
  PAYOUT_LINE_KINDS,
  PAYOUT_LINE_STATUSES,
  PAYOUT_PAY_BASES,
  PAYOUT_RATE_TYPES,
  PAYOUT_UNPRICED,
  PAYOUT_WARNINGS,
} from '@kampus/school-core/lib/finance-hourly-lesson-payouts.ts'
import { payrollMonthSchema } from '@kampus/school-core/lib/finance-payroll-exports.ts'

import { dataResponse } from './common.schemas.ts'

/**
 * Saat ücretli öğretmen ders saati hakediş dökümü şemaları (DOM-FIN-167; ON-075). Tutar kuruş
 * tamsayıdır; satır ve özet saklanmaz, her okumada hesaplanır. İzin ve rapor ayrılmaz.
 */

export const hourlyPayoutParams = z.object({
  month: payrollMonthSchema.describe('Döküm ayı (YYYY-AA)'),
})

export const hourlyPayoutDetailParams = z.object({
  month: payrollMonthSchema.describe('Döküm ayı (YYYY-AA)'),
  membershipId: z.string().min(1).max(100).describe('Öğretmenin kurum üyeliği'),
})

const count = (description: string) => z.number().int().describe(description)
const cents = (description: string) => z.number().int().describe(`${description} (kuruş)`)

const totalsSchema = z.object({
  lessons: count('Ayın bütün ders satırları'),
  givenLessons: count('Verilen ders sayısı'),
  givenHours: count('Verilen ders saati'),
  givenMinutes: count('Verilen dersin dakikası'),
  ownHours: count('Kendi dersi (verilen)'),
  substituteHours: count('Yedek girdiği ders (verilen)'),
  makeupLessons: count('Verilen telafi dersi sayısı'),
  makeupHours: count('Verilen telafi ders saati'),
  groupHours: count('Plandan grup dersi (verilen)'),
  cancelledLessons: count('İptal edilen ders sayısı'),
  cancelledHours: count('İptal edilen ders saati'),
  substitutedOutLessons: count('Yedeğe devredilen ders sayısı'),
  holidayLessons: count('Tatile denk gelen ders sayısı'),
  leaveLessons: count('Öğretmenin izinli ya da raporlu olduğu gündeki ders sayısı'),
  upcomingLessons: count('Henüz yapılmamış ders sayısı'),
  duplicateLessons: count('Programla çakıştığı için sayılmayan grup oturumu'),
  attendanceMissingLessons: count('Sınıfın o günü yoklaması alınmamış verilen ders'),
  amountCents: cents('Fiyatlanan derslerin toplamı'),
  unpricedHours: count('Verilip tutarı hesaplanamayan ders saati'),
})

const rateSchema = z.object({
  rateType: z
    .enum(PAYOUT_RATE_TYPES)
    .describe('`hourly` saatlik (dakikadan), `lesson_hour` ders saati ücreti'),
  rateCents: cents('Birim ücret'),
  startDate: z.string(),
  endDate: z.string().nullable(),
  lessons: count('Bu ücretle fiyatlanan ders'),
  hours: count('Ders saati'),
  minutes: count('Dakika'),
  amountCents: cents('Tutar'),
})

const teacherFields = {
  membershipId: z.string(),
  staffName: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  staffActive: z.boolean(),
  payBasis: z
    .enum(PAYOUT_PAY_BASES)
    .describe(
      '`hourly` saat ya da ders saati ücretli, `mixed` ay içinde aylık ve saat ücreti, `unknown` ayda ana ücret tanımı yok',
    ),
  totals: totalsSchema,
  rates: z.array(rateSchema).describe('Ay içinde uygulanan ücret tanımları (değişirse birden çok)'),
  warnings: z
    .array(z.enum(PAYOUT_WARNINGS))
    .describe(
      '`no_pay_rate` ana ücret yok, `rate_gap` bazı günlerde tanım yok, `monthly_days` bazı günlerde aylık ücret, `attendance_missing` yoklama alınmamış gün, `group_plan` grup dersleri plandan, `duplicate` programla çakışan grup oturumu',
    ),
}

const lineSchema = z.object({
  lessonId: z.string().describe('Ders programı kaydı ya da `group:<grup>:<gün>:<saat>`'),
  source: z.enum(['schedule', 'group']).describe('`schedule` ders programı, `group` grup planı'),
  day: z.string(),
  startsAt: z.string(),
  minutes: count('Dakika'),
  hours: count('Ders saati (programda 40, grupta 45 dakika; en az 1)'),
  classId: z.string().nullable(),
  groupId: z.string().nullable(),
  subjectId: z.string().nullable(),
  title: z.string().nullable().describe('Ders ya da kur adı'),
  placeName: z.string().nullable().describe('Sınıf ya da grup adı; kayıt yoksa boş'),
  status: z
    .enum(PAYOUT_LINE_STATUSES)
    .describe(
      '`counted` verildi, `cancelled` iptal, `holiday` tatil, `leave` öğretmen izinli, `substituted_out` yedeğe devredildi, `upcoming` henüz yapılmadı, `duplicate` programla çakışan grup oturumu',
    ),
  kind: z
    .enum(PAYOUT_LINE_KINDS)
    .describe('`own` kendi dersi, `substitute` yedek, `makeup` telafi, `group` grup dersi'),
  makeupForLessonId: z.string().nullable(),
  holidayTitle: z.string().nullable(),
  attendanceMissing: z.boolean().nullable(),
  rateType: z.enum(PAYOUT_RATE_TYPES).nullable(),
  rateCents: z.number().int().nullable(),
  amountCents: z.number().int().nullable().describe('Satır tutarı (kuruş); fiyatlanamadıysa boş'),
  unpriced: z
    .enum(PAYOUT_UNPRICED)
    .nullable()
    .describe('Verilen dersin tutarı neden boş: `no_rate` tanım yok, `monthly` aylık ücret'),
})

const detailSchema = z.object({
  ...teacherFields,
  month: z.string(),
  monthComplete: z.boolean().describe('Ay bitti mi; bitmediyse gelecek dersler sayılmaz'),
  attendanceKnown: z.boolean().describe('Yoklama okunabildi mi (`academic` modülü açık)'),
  days: z
    .array(z.object({ day: z.string(), lines: z.array(lineSchema) }))
    .describe('Ayın dersi olan günleri ve dersleri'),
})

export const hourlyPayoutResponse = dataResponse(
  z.object({
    month: z.string(),
    monthComplete: z.boolean(),
    attendanceKnown: z.boolean(),
    teachers: z
      .array(z.object(teacherFields))
      .describe('Ayda dersi olan saat ücretli ya da ücret tanımsız öğretmenler, ada göre'),
    totals: z.object({
      teacherCount: count('Öğretmen'),
      givenLessons: count('Verilen ders'),
      givenHours: count('Verilen ders saati'),
      cancelledLessons: count('İptal edilen ders'),
      makeupLessons: count('Verilen telafi dersi'),
      amountCents: cents('Toplam tutar'),
      unpricedTeacherCount: count('Tutarı eksik kalan öğretmen'),
    }),
  }),
)

export const hourlyPayoutDetailResponse = dataResponse(detailSchema)

export const ownHourlyPayoutResponse = dataResponse(
  z.object({
    month: z.string(),
    payout: detailSchema.nullable().describe('Dökümün yoksa (aylık ücretli ya da dersin yok) boş'),
  }),
)
