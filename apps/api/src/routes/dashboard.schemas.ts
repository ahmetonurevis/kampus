import { z } from 'zod'

import { dataResponse } from './common.schemas.ts'

// Genel Bakış özeti (`GET /api/v1/dashboard`). Yanıt role özgüdür (`role` ayırıcılı birleşim):
// şemada olmayan alan istemciye gitmez, öğrenci özetinde ödeme alanı hiç yoktur. Okuduğu
// koleksiyonlardan biri aktöre kapalı olan bölüm (modül kapalı, kurum türünde yok, rol okuyamıyor)
// `null`'dır. Para kuruş, gün `YYYY-MM-DD` (Europe/Istanbul), an ISO UTC.

export const dashboardQuerySchema = z
  .object({
    studentId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Yalnız öğrenci ve velide: özeti gösterilecek öğrenci. Velide seçili çocuk (verilmezse kapsamdaki ilk çocuk); kapsam dışı öğrenci 404. Diğer rollerde 400',
      ),
    branchId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Yalnız yönetici ve ön büroda: özeti daraltılacak kampüs. Öğrenci, sınıf, taksit ve yoklama değerleri kampüsün sınıflarıyla sınırlanır; kampüs yok ya da kapsam dışıysa 404. Diğer rollerde 400',
      ),
  })
  .strict()

const count = z.number().int().min(0)
const cents = z.number().int().describe('Kuruş')
const day = z.string().describe('Europe/Istanbul günü (`YYYY-MM-DD`)')
const instant = z.string().describe('Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri')

const statusTotal = z
  .object({ count, amount: cents })
  .meta({ id: 'DashboardStatusTotal' })
  .describe('Taksit sayısı ve tutarı (kuruş)')

const invoiceSummary = z
  .object({
    total: count.describe('Taksit sayısı'),
    amount: cents.describe('Ödeme planı toplamı (kuruş)'),
    overdue: statusTotal.describe('Gecikmiş'),
    upcoming: statusTotal.describe('Yaklaşan'),
    paid: statusTotal.describe('Ödendi'),
  })
  .meta({ id: 'DashboardInvoiceSummary' })
  .describe('Taksit durumu dağılımı (core `invoiceStatus`, isteğin Istanbul günü)')

const attendanceCounts = z
  .object({ present: count, absent: count, late: count, excused: count, total: count })
  .meta({ id: 'DashboardAttendanceCounts' })
  .describe('Yoklama durum sayıları; `total` bütün kayıtlar')

const invoiceRow = z
  .object({
    id: z.string(),
    studentName: z.string().optional().describe('Bağlı öğrenci adı; kapsam dışında yok'),
    installment: z.number().int().optional(),
    amount: cents.optional(),
    dueDate: instant.optional(),
    paidAt: instant.optional(),
  })
  .meta({ id: 'DashboardInvoiceRow' })

const adminSchema = z
  .object({
    role: z.literal('yonetici'),
    today: day,
    students: z.object({ active: count, archived: count }),
    classes: z.object({
      active: count,
      campusCount: count.describe('Aktif sınıfı olan kampüs sayısı'),
    }),
    teachers: z.object({ active: count }),
    finance: z
      .object({
        invoices: invoiceSummary,
        collectedToday: statusTotal.describe('Bugün (`paidAt` günü) ödenen taksitler'),
        monthlyCollection: z.object({
          count: count.describe('Son 12 ayda ödenen taksit'),
          amount: cents,
          months: z
            .array(z.object({ month: z.string().describe('`YYYY-MM`'), count, amount: cents }))
            .describe(
              'Eskiden yeniye 12 ay (`paidAt:month`); kaydı olmayan ay sıfır. Son 6 ay dönem seçicisi içindir',
            ),
        }),
      })
      .nullable()
      .describe('`finance` modülü kapalıysa `null`'),
    attendanceToday: attendanceCounts
      .nullable()
      .describe('Bugünkü yoklama; `academic` modülü kapalıysa `null`'),
    recentStudents: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          number: z.string().optional(),
          className: z.string().optional(),
        }),
      )
      .describe('En son eklenen 5 aktif öğrenci'),
    campuses: z
      .array(z.object({ id: z.string(), name: z.string(), students: count, capacity: count }))
      .describe('Aktif kampüs başına aktif öğrenci ve aktif sınıf kontenjanı'),
  })
  .meta({ id: 'DashboardAdmin' })

const frontDeskSchema = z
  .object({
    role: z.literal('onburo'),
    today: day,
    finance: z
      .object({
        invoices: invoiceSummary,
        collectedToday: statusTotal,
        overdue: z.array(invoiceRow).describe('Vadesi en eski 5 gecikmiş taksit'),
        upcoming: z.array(invoiceRow).describe('Vadesi en yakın 5 yaklaşan taksit'),
        recentPayments: z.array(invoiceRow).describe('En son kaydedilen 5 ödeme'),
      })
      .nullable()
      .describe('`finance` modülü kapalıysa `null`'),
    prospects: z
      .object({
        total: count,
        stages: z
          .array(z.object({ stage: z.string().nullable(), count }))
          .describe('Aşama başına aday; aşamasız `null` sonda'),
      })
      .nullable()
      .describe('`crm` modülü kapalıysa `null`'),
  })
  .meta({ id: 'DashboardFrontDesk' })

const teacherSchema = z
  .object({
    role: z.literal('ogretmen'),
    today: day,
    students: z.object({ active: count }),
    classes: z.object({ active: count }),
    academic: z
      .object({
        attendanceToday: attendanceCounts,
        lessons: z.object({
          total: count.describe('Bugünkü iptal edilmemiş ders'),
          cancelled: count.describe('Bugün iptal edilen ders'),
          items: z.array(
            z.object({
              id: z.string(),
              date: instant,
              title: z.string().optional(),
              subject: z.string().optional(),
              room: z.string().optional(),
              duration: z.number().optional(),
              className: z.string().optional(),
            }),
          ),
        }),
        recentAbsences: z
          .array(
            z.object({
              id: z.string(),
              date: instant,
              status: z.string(),
              studentName: z.string().optional(),
              className: z.string().optional(),
            }),
          )
          .describe('Son 5 gelmedi/geç geldi kaydı'),
      })
      .nullable()
      .describe('`academic` modülü kapalıysa `null`'),
    learning: z
      .object({
        ungraded: count.describe('Notlanmamış teslim'),
        homework: z
          .array(
            z.object({
              id: z.string(),
              title: z.string(),
              dueDate: instant,
              className: z.string().optional(),
              delivered: count,
              expected: count.describe('Ödevin sınıfındaki aktif öğrenci'),
            }),
          )
          .describe('Son teslim günü bugün veya sonrası olan en yakın 5 ödev'),
      })
      .nullable()
      .describe('`learning` modülü kapalıysa `null`'),
  })
  .meta({ id: 'DashboardTeacher' })

const studentShape = {
  today: day,
  student: z.object({ id: z.string(), name: z.string() }),
  academic: z
    .object({
      grades: z.object({
        count,
        scoreSum: z.number(),
        subjects: z.array(
          z.object({
            subjectId: z.string(),
            name: z.string().optional(),
            count,
            scoreSum: z.number(),
          }),
        ),
      }),
      attendance: attendanceCounts,
      weeklyAbsences: z
        .array(z.object({ from: day, to: day, absent: count }))
        .describe('Son 8 hafta (pazartesi–pazar), eskiden yeniye'),
      recentGrades: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          date: instant,
          score: z.number().optional(),
        }),
      ),
    })
    .nullable()
    .describe('`academic` modülü kapalıysa `null`'),
  learning: z
    .object({
      submitted: count,
      assigned: count.describe('Sınıfa verilen ödev'),
      homework: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          dueDate: instant,
          submission: z
            .object({ score: z.number().nullable() })
            .nullable()
            .describe('Teslim yoksa `null`; `score` `null` ise notlanmamış'),
        }),
      ),
    })
    .nullable()
    .describe('`learning` modülü kapalıysa `null`'),
}

const studentSchema = z
  .object({ role: z.literal('ogrenci'), ...studentShape })
  .meta({ id: 'DashboardStudent' })
  .describe('Öğrenci özeti; ödeme bilgisi yoktur')

const parentSchema = z
  .object({
    role: z.literal('veli'),
    ...studentShape,
    balance: z
      .object({
        outstanding: cents.describe('Gecikmiş + yaklaşan taksit toplamı'),
        overdueCount: count,
      })
      .nullable()
      .describe('Seçili çocuğun bakiyesi; `finance` modülü kapalıysa `null`'),
  })
  .meta({ id: 'DashboardParent' })

export const dashboardSchema = z
  .discriminatedUnion('role', [
    adminSchema,
    frontDeskSchema,
    teacherSchema,
    studentSchema,
    parentSchema,
  ])
  .meta({ id: 'Dashboard' })

export const dashboardResponseSchema = dataResponse(dashboardSchema)
