import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  calendarRangeIssue,
  LEAVE_CALENDAR_CATEGORIES,
  LEAVE_CALENDAR_SOURCES,
  LEAVE_CALENDAR_STATUSES,
} from '@kampus/school-core/lib/finance-leave-calendar.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import { dataResponse } from './common.schemas.ts'

/** İzin takvimi şemaları (DOM-FIN-123; ON-183). */

const period = { startDate: z.string(), endDate: z.string() }

const examWeek = z.object({ label: z.string(), ...period })

/** Çakışma uyarısı (K-422; engel değildir). */
export const leaveConflictSchema = z
  .discriminatedUnion('code', [
    z.object({
      code: z.literal('branch_concurrent'),
      subjectId: z.string(),
      subjectName: z.string(),
      ...period,
      peak: z.number().int().describe('En kalabalık gündeki izinli personel (talep dahil)'),
      threshold: z.number().int(),
      // kvkk: K (personel adı; tür yazılmaz)
      staff: z
        .array(z.object({ membershipId: z.string(), name: z.string() }))
        .describe('Eşiğe ulaşılan günlerde izinli diğer personel'),
    }),
    z.object({ code: z.literal('exam_week'), label: z.string(), ...period }),
    z.object({
      code: z.literal('substitute_on_leave'),
      lessonId: z.string(),
      startsAt: z.string(),
      title: z.string(),
      teacherId: z.string(),
      teacherName: z.string(),
    }),
  ])
  .describe(
    '`branch_concurrent` aynı branşta eşzamanlı izin, `exam_week` sınav haftası, `substitute_on_leave` yedek öğretmen o gün izinli',
  )

const entry = z.object({
  id: z.string(),
  source: z
    .enum(LEAVE_CALENDAR_SOURCES)
    .describe('`request` izin talebi, `record` elle yazılmış izin kaydı, `medical_report` rapor'),
  // kvkk: K (personel üyeliği)
  membershipId: z.string(),
  name: z.string().describe('Personelin adı'),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  subjectIds: z.array(z.string()).describe('Branşlar (bağlı öğretmen kaydının dersi)'),
  status: z.enum(LEAVE_CALENDAR_STATUSES),
  category: z
    .enum(LEAVE_CALENDAR_CATEGORIES)
    .describe('`leave` tür adıyla, `sick` "Raporlu" (tür ve tanı yok), `absent` türsüz (ön büro)'),
  typeLabel: z.string().nullable().describe('Tür adı; yalnız `leave` kategorisinde'),
  ...period,
})

export const leaveCalendarResponse = dataResponse(
  z.object({
    ...period,
    entries: z.array(entry).describe('Aralığa değen izinler, başlangıca göre'),
    examWeeks: z.array(examWeek).describe('Aralığa değen sınav haftaları'),
    holidays: z
      .array(z.object({ title: z.string(), ...period }))
      .describe(
        'Aralığa değen kurum tatilleri: okul takviminin yayımlanmış, tüm kurum hedefli tatil etkinlikleri (DOM-FIN-163, K-545); takvim modülü kapalı olsa da okunur',
      ),
    busyDays: z
      .array(z.object({ day: z.string(), subjectId: z.string(), count: z.number().int() }))
      .describe('Aynı branşta izinli sayısının eşiğe ulaştığı günler (ön büroda boş)'),
    subjects: z
      .array(z.object({ id: z.string(), name: z.string() }))
      .describe('Branş seçenekleri (öğretmen kaydı bağlı personelin dersleri)'),
    concurrentThreshold: z.number().int().nullable().describe('Eşik (ön büroda boş)'),
  }),
)

export const leaveCalendarQuery = z
  .strictObject({
    startDate: daySchema.describe('İlk gün'),
    endDate: daySchema.describe('Son gün (dahil; en çok 62 gün)'),
    subjectId: z.string().trim().min(1).max(40).optional().describe('Branş (ders kimliği)'),
    role: z.enum(STAFF_ROLES).optional().describe('Personel rolü'),
    status: z
      .enum(LEAVE_CALENDAR_STATUSES)
      .optional()
      .describe('Yalnız bekleyen ya da onaylı (ön büroda etkisiz: yalnız onaylı)'),
  })
  .superRefine((value, context) => {
    const issue = calendarRangeIssue(value)
    if (issue !== null) context.addIssue({ code: 'custom', path: ['endDate'], message: issue })
  })

export const leaveCalendarSettingsResponse = dataResponse(
  z.object({
    concurrentThreshold: z.number().int(),
    examWeeks: z.array(examWeek),
    version: z.number().int().describe('`If-Match` için ayar sürümü (hiç kaydedilmediyse 1)'),
  }),
)
