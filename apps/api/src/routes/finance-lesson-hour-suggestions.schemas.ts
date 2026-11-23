import { z } from 'zod'

import { LESSON_SHEET_STATUSES } from '@kampus/school-core/lib/finance-lesson-hour-approvals.ts'
import {
  LESSON_ITEM_KINDS,
  LESSON_ITEM_STATUSES,
  SUGGESTION_PAY_BASES,
  SUGGESTION_WARNINGS,
} from '@kampus/school-core/lib/finance-lesson-hour-suggestions.ts'
import { payrollMonthSchema } from '@kampus/school-core/lib/finance-payroll-exports.ts'

import { dataResponse } from './common.schemas.ts'

/**
 * Programdan ek ders önerisi şemaları (DOM-FIN-165; ON-195). Yanıt tutar taşımaz; saat, ders ve
 * neden döner. İzin ve rapor ayrımı yapılmaz (ikisi de "öğretmen izinli").
 */

export const lessonSuggestionParams = z.object({
  month: payrollMonthSchema.describe('Öneri ayı (YYYY-AA)'),
})

export const lessonSuggestionDetailParams = z.object({
  month: payrollMonthSchema.describe('Öneri ayı (YYYY-AA)'),
  membershipId: z.string().min(1).max(100).describe('Öğretmenin kurum üyeliği'),
})

const hours = (description: string) => z.number().int().describe(description)

const totalsSchema = z.object({
  countedHours: hours('Ayda sayılan ders saati (kendi, yedek ve telafi)'),
  ownHours: hours('Kendi dersi'),
  substituteHours: hours('Yedek girdiği ders'),
  makeupHours: hours('Telafi dersi'),
  loadHours: hours('Maaş karşılığına sayılan saat'),
  extraHours: hours('Ek ders sayılan saat (öneri)'),
  overCapHours: hours('Haftalık üst sınırı aşan, sayılmayan saat'),
  cancelledHours: hours('İptal edilen ders'),
  holidayHours: hours('Tatile denk gelen ders'),
  leaveHours: hours('Öğretmenin izinli ya da raporlu olduğu gündeki dersi'),
  substitutedOutHours: hours('Yedeğe devredilen ders'),
  upcomingHours: hours('Henüz yapılmamış ders'),
  attendanceMissingLessons: z
    .number()
    .int()
    .describe('Sınıfın o günü yoklaması alınmamış sayılan ders sayısı'),
})

const weekSchema = z.object({
  startDate: z.string().describe('Hafta pazartesisi'),
  endDate: z.string().describe('Hafta pazarı'),
  monthFrom: z.string().describe('Haftanın bu aya düşen ilk günü'),
  monthTo: z.string().describe('Haftanın bu aya düşen son günü'),
  countedHours: hours('Haftanın sayılan saati (ay dışı günler dahil)'),
  loadHours: hours('Maaş karşılığı'),
  extraHours: hours('Ek ders'),
  overCapHours: hours('Üst sınır üstü'),
  extraInMonth: hours('Ek dersin bu aya düşen kısmı'),
})

const transferSchema = z.object({
  id: z.string(),
  suggestedHours: hours('Aktarım anındaki öneri'),
  previousHours: z.number().int().nullable().describe('Aktarımdan önceki elle giriş; yoksa boş'),
  hours: hours('Yazılan saat'),
  reason: z.string().nullable().describe('Öneriden farkın gerekçesi'),
  weeklyLoad: z.number().int(),
  weeklyCap: z.number().int(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
})

const teacherFields = {
  membershipId: z.string(),
  staffName: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  staffActive: z.boolean(),
  payBasis: z
    .enum(SUGGESTION_PAY_BASES)
    .describe(
      '`monthly` aylık ücretli, `hourly` saat ya da ders saati ücretli (öneri yok), `unknown` ana ücret tanımı yok (aylık sayıldı)',
    ),
  applicable: z.boolean().describe('Öneri verilir mi'),
  suggestedHours: z.number().int().nullable().describe('Önerilen ek ders saati; öneri yoksa boş'),
  currentHours: z
    .number()
    .int()
    .nullable()
    .describe('Ayın elle girilen ek ders (`extra`) saati; kayıt yoksa boş'),
  currentEntryId: z.string().nullable(),
  difference: z
    .number()
    .int()
    .nullable()
    .describe('Elle giriş eksi öneri (kayıt yoksa 0 sayılır); öneri yoksa boş'),
  totals: totalsSchema,
  weeks: z.array(weekSchema).describe('Ayla kesişen haftalar (sayılan dersi olanlar)'),
  warnings: z
    .array(z.enum(SUGGESTION_WARNINGS))
    .describe(
      '`no_pay_rate` ücret tanımı yok, `over_cap` üst sınır aşıldı, `attendance_missing` yoklaması alınmamış ders günü',
    ),
  lastTransfer: transferSchema.nullable().describe('Bu ayın son aktarımı'),
}

export const lessonSuggestionResponse = dataResponse(
  z.object({
    month: z.string(),
    weeklyLoad: z.number().int(),
    weeklyCap: z.number().int(),
    rangeFrom: z.string().describe('Okunan aralığın ilk günü (ayın ilk haftasının pazartesisi)'),
    rangeTo: z.string().describe('Okunan aralığın son günü (ayın son haftasının pazarı)'),
    monthComplete: z.boolean().describe('Ay bitti mi; bitmediyse gelecek dersler sayılmaz'),
    attendanceKnown: z.boolean().describe('Yoklama okunabildi mi (`academic` modülü açık)'),
    sheetStatus: z.enum(LESSON_SHEET_STATUSES).describe('Ayın ek ders çizelgesi durumu'),
    payrollLocked: z.boolean(),
    transferable: z
      .boolean()
      .describe(
        'Aktarım yapılabilir mi (çizelge onaylı ve dönem kilitli değil, ay gelecekte değil)',
      ),
    teachers: z.array(z.object(teacherFields)).describe('Ayda dersi olan öğretmenler, ada göre'),
    unlinked: z
      .array(
        z.object({
          teacherId: z.string(),
          teacherName: z.string().nullable(),
          countedHours: z.number().int(),
        }),
      )
      .describe('Dersi olup personel üyeliğine bağlı olmayan öğretmen kayıtları (aktarılamaz)'),
    totals: z.object({
      teacherCount: z.number().int(),
      suggestedHours: z.number().int(),
      currentHours: z.number().int(),
    }),
  }),
)

const itemSchema = z.object({
  lessonId: z.string(),
  day: z.string(),
  startsAt: z.string(),
  classId: z.string(),
  subjectId: z.string(),
  title: z.string().nullable(),
  hours: hours('Dersin ders saati sayısı (40 dakika, en az 1)'),
  status: z
    .enum(LESSON_ITEM_STATUSES)
    .describe(
      '`counted` sayıldı, `cancelled` iptal, `holiday` tatil, `leave` öğretmen izinli, `substituted_out` yedeğe devredildi, `upcoming` henüz yapılmadı',
    ),
  kind: z
    .enum(LESSON_ITEM_KINDS)
    .describe('`own` kendi dersi, `substitute` yedek, `makeup` telafi'),
  loadHours: z.number().int(),
  extraHours: z.number().int(),
  overCapHours: z.number().int(),
  attendanceMissing: z
    .boolean()
    .nullable()
    .describe(
      'Sınıfın o günü yoklaması alınmadı; yoklama okunamadıysa ya da ders sayılmadıysa boş',
    ),
  makeupForLessonId: z.string().nullable(),
  holidayTitle: z.string().nullable(),
})

export const lessonSuggestionDetailResponse = dataResponse(
  z.object({
    ...teacherFields,
    month: z.string(),
    weeklyLoad: z.number().int(),
    weeklyCap: z.number().int(),
    days: z
      .array(z.object({ day: z.string(), items: z.array(itemSchema) }))
      .describe('Ayın dersi olan günleri ve dersleri'),
    transfers: z.array(transferSchema).describe('Bu ayın aktarımları, yeniden eskiye'),
  }),
)
