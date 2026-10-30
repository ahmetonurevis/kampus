import { dayKey, INVOICE_STATUS_LABELS } from '@kampus/school-core/lib/format.ts'
import type { Scope } from '@kampus/school-core/lib/scope.ts'

import type { CollectionName } from '../db/collections.ts'
import { NotFoundError, ValidationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import {
  countCollection,
  listCollection,
  type CollectionCountQuery,
  type CollectionItem,
  type CollectionListQuery,
  type CountGroup,
} from './collection-reads.ts'
import { readScope } from './read-scope.ts'

/**
 * Genel Bakış özeti (`GET /api/v1/dashboard`): etkin rolün Genel Bakış'ta gösterdiği bütün kart,
 * kısa liste ve mini grafik verisi tek yanıtta. Web eskiden aynı veriyi 6–17 ayrı `counts`/liste
 * isteğiyle topluyordu; tarayıcının bağlantı sınırında bu istekler başka işlemleri geciktiriyordu.
 *
 * Hesap ikinci kez yazılmaz: her kart koleksiyon okuma servisinin (`countCollection`,
 * `listCollection`) aynı sorgusudur. Böylece rol ve kurum kapsamı (core `scopeFor`, istek başına bir
 * kez yüklenen `readScope`), alan ayıklama (rehberlik iç notu gibi gizli alanlar, DOM-YTK-020),
 * türetilmiş taksit durumu, gün aralığı ve aylık gruplama `counts` ucuyla birebir aynıdır. Gün
 * aralığı ve eşitlik süzgeçleri SQL aday süzgecidir; sayımın kendisi okuma servisindeki gibi
 * ayıklanmış kayıtta yapılır (`TODO(perf)`: sayım SQL'e inince burası da hızlanır).
 *
 * Bölüm kuralı: bir bölümün okuduğu koleksiyonlardan biri bu aktöre kapalıysa (modül kapalı,
 * kurum türünde yok veya rol okuyamıyor; core `scope.access`) bölüm `null` döner ve hiç
 * hesaplanmaz. Çekirdek kayıtlara (öğrenci, sınıf, kadro) dayanan kartlar her zaman doludur.
 * Para kuruş, gün `YYYY-MM-DD` (Europe/Istanbul), an ISO UTC; biçimlenmiş metin dönmez.
 */

/** Kısa listelerin uzunluğu (web kartları). */
const SHORT_LIST = 5
/** Öğretmenin bugünkü dersleri listesi. */
const LESSON_LIST = 20
/** Ad eşlemesi için okunan başvuru koleksiyonlarının üst sınırı (web `useCoreAll` ile aynı). */
const ALL_ROWS = 5000
/** Aylık tahsilat grafiği ve haftalık devamsızlık grafiğinin dilim sayısı. */
const MONTHS = 6
const WEEKS = 8

export type DashboardQuery = { studentId?: string | undefined }

type Counts = Awaited<ReturnType<typeof countCollection>>

const OVERDUE = INVOICE_STATUS_LABELS.gecikmis
const UPCOMING = INVOICE_STATUS_LABELS.yaklasan
const PAID = INVOICE_STATUS_LABELS.odendi

function groupOf(counts: Counts, value: string | boolean): CountGroup | undefined {
  const wanted = String(value)
  return counts.groups.find((group) => group.value !== null && String(group.value) === wanted)
}
const countOf = (counts: Counts, value: string | boolean) => groupOf(counts, value)?.count ?? 0
const sumOf = (counts: Counts, value: string | boolean) => groupOf(counts, value)?.sum ?? 0

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

// Tanımsız alan JSON yanıtına girmez: rolün göremediği (ayıklanan) alan yanıtta da yoktur.

// --- Gün yardımcıları (Europe/Istanbul günü anahtarları üzerinde, UTC aritmetiği) -------------

const DAY_MS = 86_400_000
const atNoon = (day: string) => new Date(`${day}T12:00:00.000Z`)
export const addDays = (day: string, days: number) =>
  new Date(atNoon(day).getTime() + days * DAY_MS).toISOString().slice(0, 10)
/** Günün haftasının pazartesisi. */
export const mondayOf = (day: string) => addDays(day, -((atNoon(day).getUTCDay() + 6) % 7))

/** Bugünün haftası dahil son `weeks` hafta (pazartesi–pazar), eskiden yeniye. */
export function weekRanges(today: string, weeks = WEEKS): { from: string; to: string }[] {
  const current = mondayOf(today)
  return Array.from({ length: weeks }, (_, index) => {
    const from = addDays(current, (index - weeks + 1) * 7)
    return { from, to: addDays(from, 6) }
  })
}

/** Bugünün ayı dahil son `months` ay (`YYYY-MM`), eskiden yeniye. */
export function monthKeys(today: string, months = MONTHS): string[] {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7)) - 1
  return Array.from({ length: months }, (_, index) =>
    new Date(Date.UTC(year, month - (months - 1 - index), 15, 12)).toISOString().slice(0, 7),
  )
}

// --- Okuma yardımcıları ----------------------------------------------------------------------

function count(ctx: ServiceContext, collection: CollectionName, query: CollectionCountQuery) {
  return countCollection(ctx, collection, query)
}

async function list(
  ctx: ServiceContext,
  collection: CollectionName,
  query: Partial<CollectionListQuery> & { pageSize: number },
): Promise<{ items: CollectionItem[]; total: number }> {
  return listCollection(ctx, collection, { page: 1, ...query })
}

const all = (
  ctx: ServiceContext,
  collection: CollectionName,
  query: Partial<CollectionListQuery> = {},
) => list(ctx, collection, { ...query, pageSize: ALL_ROWS }).then((result) => result.items)

/** Bölümün bütün koleksiyonları aktöre açık mı (modül, kurum türü, rol; core `scope.access`). */
const opens = (scope: Scope, ...collections: CollectionName[]) =>
  collections.every((collection) => scope.access(collection).allowed)

/** Koşul sağlanırsa bölümü hesaplar; sağlanmazsa `null` (hiç okuma yapılmaz). */
const section = <T>(open: boolean, build: () => Promise<T>): Promise<T | null> =>
  open ? build() : Promise.resolve(null)

const ACTIVE = { isActive: true } as const

// --- Ortak parçalar ---------------------------------------------------------------------------

export interface StatusTotal {
  count: number
  /** Kuruş. */
  amount: number
}

export interface InvoiceSummary {
  /** Taksit sayısı. */
  total: number
  /** Ödeme planı toplamı, kuruş. */
  amount: number
  overdue: StatusTotal
  upcoming: StatusTotal
  paid: StatusTotal
}

function invoiceSummary(counts: Counts): InvoiceSummary {
  const slice = (label: string): StatusTotal => ({
    count: countOf(counts, label),
    amount: sumOf(counts, label),
  })
  return {
    total: counts.total,
    amount: counts.sum ?? 0,
    overdue: slice(OVERDUE),
    upcoming: slice(UPCOMING),
    paid: slice(PAID),
  }
}

/** Taksit durumu dağılımı (`groupBy=status&sum=amount`). */
const invoicesByStatus = (ctx: ServiceContext, filters: CollectionCountQuery['filters'] = {}) =>
  count(ctx, 'invoices', { groupBy: 'status', sum: 'amount', filters }).then(invoiceSummary)

/** Bugün ödenen taksitler (`paidAt` günü). */
async function collectedToday(ctx: ServiceContext, today: string): Promise<StatusTotal> {
  const counts = await count(ctx, 'invoices', {
    groupBy: 'status',
    sum: 'amount',
    dateField: 'paidAt',
    dateFrom: today,
    dateTo: today,
  })
  return { count: countOf(counts, PAID), amount: sumOf(counts, PAID) }
}

export interface AttendanceCounts {
  present: number
  absent: number
  late: number
  excused: number
  /** Bütün yoklama kayıtları (başka durumlar dahil). */
  total: number
}

function attendanceCounts(counts: Counts): AttendanceCounts {
  return {
    present: countOf(counts, 'present'),
    absent: countOf(counts, 'absent'),
    late: countOf(counts, 'late'),
    excused: countOf(counts, 'excused'),
    total: counts.total,
  }
}

const attendanceOfDay = (ctx: ServiceContext, today: string) =>
  count(ctx, 'attendance', { groupBy: 'status', dateFrom: today, dateTo: today }).then(
    attendanceCounts,
  )

// --- Yönetici --------------------------------------------------------------------------------

export interface MonthlyCollection {
  /** Aralıkta ödenen taksit sayısı ve toplamı (kuruş). */
  count: number
  amount: number
  months: { month: string; count: number; amount: number }[]
}

async function monthlyCollection(ctx: ServiceContext, today: string): Promise<MonthlyCollection> {
  const months = monthKeys(today)
  const counts = await count(ctx, 'invoices', {
    groupBy: 'paidAt:month',
    sum: 'amount',
    dateField: 'paidAt',
    dateFrom: `${months[0] ?? today.slice(0, 7)}-01`,
    dateTo: today,
  })
  return {
    count: counts.total,
    amount: counts.sum ?? 0,
    months: months.map((month) => {
      const group = counts.groups.find((item) => item.value === month)
      return { month, count: group?.count ?? 0, amount: group?.sum ?? 0 }
    }),
  }
}

export interface CampusOccupancy {
  id: string
  name: string
  students: number
  capacity: number
}

/**
 * Kampüs başına aktif öğrenci ve kontenjan: sınıf başına öğrenci sayımı sınıfın kampüsüyle
 * birleşir (sayım ucu ilişki zinciri kurmaz, api-tasarimi §3); kontenjan aktif sınıfların
 * `groupBy=branchId&sum=capacity` sayımıdır. Kampüsler aktif kampüslerdir.
 */
function campusOccupancy(
  branches: readonly CollectionItem[],
  classes: readonly CollectionItem[],
  studentsByClass: Counts,
  capacityByBranch: Counts,
): CampusOccupancy[] {
  const classBranch = new Map(
    classes.map((item) => [item.record.id ?? item.id, text(item.record.branchId)]),
  )
  const students = new Map<string, number>()
  for (const group of studentsByClass.groups) {
    const branchId = classBranch.get(String(group.value))
    if (branchId) students.set(branchId, (students.get(branchId) ?? 0) + group.count)
  }
  return branches.map((item) => ({
    id: item.id,
    name: text(item.record.name) ?? '',
    students: students.get(item.id) ?? 0,
    capacity: sumOf(capacityByBranch, item.id),
  }))
}

async function adminDashboard(ctx: ServiceContext, scope: Scope, today: string) {
  const [students, studentsByClass, classes, teachers, recent, classRefs, branchRefs] =
    await Promise.all([
      count(ctx, 'students', { groupBy: 'isActive' }),
      count(ctx, 'students', { groupBy: 'classId', isActive: true }),
      count(ctx, 'classes', { groupBy: 'branchId', sum: 'capacity', ...ACTIVE }),
      count(ctx, 'teachers', { groupBy: 'isActive' }),
      list(ctx, 'students', {
        pageSize: SHORT_LIST,
        sort: [{ field: 'createdAt', descending: true }],
        ...ACTIVE,
      }),
      all(ctx, 'classes'),
      all(ctx, 'branches', ACTIVE),
    ])
  const [finance, attendanceToday] = await Promise.all([
    section(opens(scope, 'invoices'), async () => {
      const [invoices, today_, monthly] = await Promise.all([
        invoicesByStatus(ctx),
        collectedToday(ctx, today),
        monthlyCollection(ctx, today),
      ])
      return { invoices, collectedToday: today_, monthlyCollection: monthly }
    }),
    section(opens(scope, 'attendance'), () => attendanceOfDay(ctx, today)),
  ])
  return {
    role: 'yonetici' as const,
    today,
    students: { active: countOf(students, true), archived: countOf(students, false) },
    classes: {
      active: classes.total,
      campusCount: classes.groups.filter((group) => group.value !== null).length,
    },
    teachers: { active: countOf(teachers, true) },
    finance,
    attendanceToday,
    recentStudents: recent.items.map((item) => ({
      id: item.id,
      name: text(item.record.name) ?? '',
      number: text(item.record.number),
      className: item.joined?.className,
    })),
    campuses: campusOccupancy(branchRefs, classRefs, studentsByClass, classes),
  }
}

// --- Ön büro ---------------------------------------------------------------------------------

export interface InvoiceRow {
  id: string
  studentName?: string
  installment?: number
  /** Kuruş. */
  amount?: number
  dueDate?: string
  paidAt?: string
}

function invoiceRow(item: CollectionItem): InvoiceRow {
  return {
    id: item.id,
    studentName: item.joined?.studentName,
    installment: num(item.record.installment),
    amount: num(item.record.amount),
    dueDate: text(item.record.dueDate),
    paidAt: text(item.record.paidAt),
  }
}

const invoiceList = (ctx: ServiceContext, status: string, sort: CollectionListQuery['sort']) =>
  list(ctx, 'invoices', { pageSize: SHORT_LIST, filters: { status: [status] }, sort }).then(
    (result) => result.items.map(invoiceRow),
  )

async function frontDeskDashboard(ctx: ServiceContext, scope: Scope, today: string) {
  const [finance, prospects] = await Promise.all([
    section(opens(scope, 'invoices'), async () => {
      const [invoices, paidToday, overdue, upcoming, recentPayments] = await Promise.all([
        invoicesByStatus(ctx),
        collectedToday(ctx, today),
        invoiceList(ctx, OVERDUE, [{ field: 'dueDate', descending: false }]),
        invoiceList(ctx, UPCOMING, [{ field: 'dueDate', descending: false }]),
        invoiceList(ctx, PAID, [
          { field: 'updatedAt', descending: true },
          { field: 'dueDate', descending: true },
        ]),
      ])
      return { invoices, collectedToday: paidToday, overdue, upcoming, recentPayments }
    }),
    section(opens(scope, 'prospects'), async () => {
      const counts = await count(ctx, 'prospects', { groupBy: 'stage' })
      return {
        total: counts.total,
        stages: counts.groups.map((group) => ({
          stage: typeof group.value === 'string' ? group.value : null,
          count: group.count,
        })),
      }
    }),
  ])
  return { role: 'onburo' as const, today, finance, prospects }
}

// --- Öğretmen --------------------------------------------------------------------------------

async function teacherDashboard(ctx: ServiceContext, scope: Scope, today: string) {
  // Öğretmenin kendi kaydı (kapsam yalnız onu döndürür): ders ve ödev süzgecinin kimliği.
  const [self, students, studentsByClass, classes] = await Promise.all([
    list(ctx, 'teachers', { pageSize: 1 }),
    count(ctx, 'students', { groupBy: 'isActive' }),
    count(ctx, 'students', { groupBy: 'classId', ...ACTIVE }),
    count(ctx, 'classes', { groupBy: 'isActive' }),
  ])
  const teacherId = self.items[0]?.id ?? ''
  const own = teacherId ? { teacherId: [teacherId] } : null
  const [academic, learning] = await Promise.all([
    section(opens(scope, 'attendance', 'schedule'), async () => {
      const todayRange = { dateFrom: today, dateTo: today }
      const [attendanceToday, lessons, cancelled, recentAbsences] = await Promise.all([
        attendanceOfDay(ctx, today),
        own
          ? list(ctx, 'schedule', {
              pageSize: LESSON_LIST,
              filters: own,
              ...todayRange,
              states: { cancelled: false },
              sort: [{ field: 'date', descending: false }],
            })
          : Promise.resolve({ items: [], total: 0 }),
        own
          ? count(ctx, 'schedule', {
              groupBy: 'teacherId',
              filters: own,
              ...todayRange,
              states: { cancelled: true },
            }).then((counts) => counts.total)
          : Promise.resolve(0),
        list(ctx, 'attendance', {
          pageSize: SHORT_LIST,
          filters: { status: ['absent', 'late'] },
          sort: [{ field: 'date', descending: true }],
        }),
      ])
      return {
        attendanceToday,
        lessons: {
          total: lessons.total,
          cancelled,
          items: lessons.items.map((item) => ({
            id: item.id,
            date: text(item.record.date) ?? '',
            title: text(item.record.title),
            subject: text(item.record.subject),
            room: text(item.record.room),
            duration: num(item.record.duration),
            className: item.joined?.className,
          })),
        },
        recentAbsences: recentAbsences.items.map((item) => ({
          id: item.id,
          date: text(item.record.date) ?? '',
          status: text(item.record.status) ?? '',
          studentName: item.joined?.studentName,
          className: item.joined?.className,
        })),
      }
    }),
    section(opens(scope, 'homework', 'submissions'), async () => {
      const [ungraded, homework] = await Promise.all([
        count(ctx, 'submissions', { groupBy: 'homeworkId', states: { graded: false } }),
        own
          ? list(ctx, 'homework', {
              pageSize: SHORT_LIST,
              filters: own,
              dateField: 'dueDate',
              dateFrom: today,
              sort: [{ field: 'dueDate', descending: false }],
            }).then((result) => result.items)
          : Promise.resolve([]),
      ])
      const ids = homework.map((item) => item.id)
      const deliveries =
        ids.length > 0
          ? await count(ctx, 'submissions', { groupBy: 'homeworkId', filters: { homeworkId: ids } })
          : null
      return {
        ungraded: ungraded.total,
        homework: homework.map((item) => {
          const classId = text(item.record.classId)
          return {
            id: item.id,
            title: text(item.record.title) ?? '',
            dueDate: text(item.record.dueDate) ?? '',
            className: item.joined?.className,
            delivered: deliveries ? countOf(deliveries, item.id) : 0,
            // Beklenen teslim: ödevin sınıfındaki aktif öğrenciler (öğretmenin kapsamında).
            expected: classId ? countOf(studentsByClass, classId) : 0,
          }
        }),
      }
    }),
  ])
  return {
    role: 'ogretmen' as const,
    today,
    students: { active: countOf(students, true) },
    classes: { active: countOf(classes, true) },
    academic,
    learning,
  }
}

// --- Öğrenci ve veli -------------------------------------------------------------------------

/**
 * Özeti gösterilen öğrenci: öğrencide kendi kaydı, velide `studentId` ile seçilen çocuğu
 * (verilmezse kapsamdaki ilk çocuk). Kayıt aktörün kapsamından okunur; kapsam dışı veya yok 404
 * (varlık sızdırılmaz, DOM-YTK-011).
 */
async function selectedStudent(ctx: ServiceContext, studentId: string | undefined) {
  const students = await all(ctx, 'students')
  const found = studentId ? students.find((item) => item.id === studentId) : students[0]
  if (!found) throw new NotFoundError()
  return {
    id: found.id,
    name: text(found.record.name) ?? '',
    classId: text(found.record.classId) ?? '',
  }
}

async function studentDashboard(
  ctx: ServiceContext,
  scope: Scope,
  today: string,
  query: DashboardQuery,
) {
  const student = await selectedStudent(ctx, query.studentId)
  const own = { studentId: [student.id] }
  const ofClass = { classId: [student.classId] }
  const parent = ctx.actor.role === 'veli'
  const [academic, learning, balance] = await Promise.all([
    section(opens(scope, 'grades', 'attendance'), async () => {
      const [grades, attendance, weeks, recentGrades, subjects] = await Promise.all([
        count(ctx, 'grades', { groupBy: 'subjectId', sum: 'score', filters: own }),
        count(ctx, 'attendance', { groupBy: 'status', filters: own }),
        Promise.all(
          weekRanges(today).map(async (week) => {
            const counts = await count(ctx, 'attendance', {
              groupBy: 'status',
              filters: own,
              dateFrom: week.from,
              dateTo: week.to,
            })
            return { ...week, absent: countOf(counts, 'absent') }
          }),
        ),
        list(ctx, 'grades', {
          pageSize: SHORT_LIST,
          filters: own,
          sort: [{ field: 'date', descending: true }],
        }),
        all(ctx, 'subjects'),
      ])
      const subjectNames = new Map(subjects.map((item) => [item.id, text(item.record.name)]))
      return {
        grades: {
          count: grades.total,
          scoreSum: grades.sum ?? 0,
          subjects: grades.groups.flatMap((group) =>
            typeof group.value === 'string' && group.count > 0
              ? [
                  {
                    subjectId: group.value,
                    name: subjectNames.get(group.value),
                    count: group.count,
                    scoreSum: group.sum ?? 0,
                  },
                ]
              : [],
          ),
        },
        attendance: attendanceCounts(attendance),
        weeklyAbsences: weeks,
        recentGrades: recentGrades.items.map((item) => ({
          id: item.id,
          title: text(item.record.title) ?? '',
          date: text(item.record.date) ?? '',
          score: num(item.record.score),
        })),
      }
    }),
    section(opens(scope, 'homework', 'submissions'), async () => {
      const [submitted, assigned, homework] = await Promise.all([
        count(ctx, 'submissions', { groupBy: 'studentId', filters: own }),
        count(ctx, 'homework', { groupBy: 'classId', filters: ofClass }),
        list(ctx, 'homework', {
          pageSize: SHORT_LIST,
          filters: ofClass,
          dateField: 'dueDate',
          dateFrom: today,
          sort: [{ field: 'dueDate', descending: false }],
        }).then((result) => result.items),
      ])
      const ids = homework.map((item) => item.id)
      const submissions =
        ids.length > 0
          ? (
              await list(ctx, 'submissions', {
                pageSize: SHORT_LIST,
                filters: { ...own, homeworkId: ids },
              })
            ).items
          : []
      const submissionOf = (homeworkId: string) =>
        submissions.find((item) => item.record.homeworkId === homeworkId)
      return {
        submitted: submitted.total,
        assigned: assigned.total,
        homework: homework.map((item) => {
          const submission = submissionOf(item.id)
          return {
            id: item.id,
            title: text(item.record.title) ?? '',
            dueDate: text(item.record.dueDate) ?? '',
            // Teslim yoksa `null`; puan `null` ise teslim edilmiş ama notlanmamıştır.
            submission: submission ? { score: num(submission.record.score) ?? null } : null,
          }
        }),
      }
    }),
    // Öğrenciye ödeme bilgisi hiç hesaplanmaz; veli çocuğunun bakiyesini görür (DOM-FIN-052).
    section(parent && opens(scope, 'invoices'), async () => {
      const invoices = await invoicesByStatus(ctx, own)
      return {
        outstanding: invoices.overdue.amount + invoices.upcoming.amount,
        overdueCount: invoices.overdue.count,
      }
    }),
  ])
  const common = {
    today,
    student: { id: student.id, name: student.name },
    academic,
    learning,
  }
  return parent
    ? { role: 'veli' as const, ...common, balance }
    : { role: 'ogrenci' as const, ...common }
}

// --- Giriş -----------------------------------------------------------------------------------

export type Dashboard =
  | Awaited<ReturnType<typeof adminDashboard>>
  | Awaited<ReturnType<typeof frontDeskDashboard>>
  | Awaited<ReturnType<typeof teacherDashboard>>
  | Awaited<ReturnType<typeof studentDashboard>>

/** Etkin rolün Genel Bakış özeti; rol ve kurum kapsamı sunucudadır. */
export async function getDashboard(
  ctx: ServiceContext,
  query: DashboardQuery = {},
): Promise<Dashboard> {
  const role = ctx.actor.role
  if (query.studentId !== undefined && role !== 'ogrenci' && role !== 'veli')
    throw new ValidationError([
      {
        path: ['studentId'],
        code: 'invalid_value',
        message: 'Öğrenci seçimi yalnız öğrenci ve veli özetinde kullanılır.',
      },
    ])
  const scope = await readScope(ctx)
  const today = dayKey(ctx.now)
  switch (role) {
    case 'yonetici':
      return adminDashboard(ctx, scope, today)
    case 'onburo':
      return frontDeskDashboard(ctx, scope, today)
    case 'ogretmen':
      return teacherDashboard(ctx, scope, today)
    case 'ogrenci':
    case 'veli':
      return studentDashboard(ctx, scope, today, query)
    default:
      throw role satisfies never
  }
}
