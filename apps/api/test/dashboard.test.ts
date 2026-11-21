import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { addDays, monthKeys, mondayOf, weekRanges } from '../src/services/dashboard.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  createUser,
  FIXED_NOW,
  signInAs,
  type InstitutionOverrides,
} from './support/app.ts'
import { sampleRows, SEED } from './support/collections-sample.ts'

// Genel Bakış özeti (`GET /api/v1/dashboard`). Değerler aynı veri üzerinde eski çoklu
// `counts`/liste istekleriyle karşılaştırılır: özet ikinci bir hesap değil, aynı okumanın toplamıdır.

/** Örnek kesite Genel Bakış kartlarının okuduğu koleksiyonlar eklenir (ders, ödev, teslim, aday). */
const CLASSES = ['c1', 'c2', 'c3']
const EXTRA: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  branches: SEED.branches,
  schedule: SEED.schedule.filter((item) => CLASSES.includes(item.classId)).slice(0, 120),
  homework: SEED.homework.filter((item) => CLASSES.includes(item.classId)),
  submissions: SEED.submissions.filter((item) => ['s1', 's2', 's3'].includes(item.studentId)),
  prospects: SEED.prospects.slice(0, 8),
  attendance: SEED.attendance.filter((item) => ['s1', 's2'].includes(item.studentId)).slice(0, 60),
  requests: SEED.requests,
  questions: SEED.questions,
}

function extraRows() {
  return Object.entries(EXTRA).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

type Group = { value: string | number | boolean | null; count: number; sum?: number }
type Counts = { groups: Group[]; total: number; sum: number }

const countOf = (counts: Counts, value: string | boolean) =>
  counts.groups.find((group) => group.value !== null && String(group.value) === String(value))
    ?.count ?? 0
const sumOf = (counts: Counts, value: string | boolean) =>
  counts.groups.find((group) => group.value !== null && String(group.value) === String(value))
    ?.sum ?? 0

const TODAY = '2026-10-06'

describe('Genel Bakış özeti', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, [...sampleRows(), ...extraRows()], FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }

  async function memberCookie(
    institutionId: string,
    role: Role,
    links: Parameters<typeof createMember>[3] = [],
  ) {
    return signInAs(app, await createMember(app, institutionId, role, links))
  }

  function get(url: string, cookie?: string) {
    return app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })
  }

  async function dashboard(cookie: string, query = '') {
    const response = await get(`/api/v1/dashboard${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json().data
  }

  async function counts(cookie: string, collection: string, query: string): Promise<Counts> {
    const response = await get(`/api/v1/collections/${collection}/counts?${query}`, cookie)
    assert.equal(response.statusCode, 200, `${collection}?${query}: ${response.body}`)
    const body = response.json()
    return { groups: body.data, total: body.meta.total, sum: body.meta.sum ?? 0 }
  }

  async function listIds(cookie: string, collection: string, query: string) {
    const response = await get(`/api/v1/collections/${collection}?${query}`, cookie)
    assert.equal(response.statusCode, 200, `${collection}?${query}: ${response.body}`)
    const body = response.json()
    return { ids: body.data.map((item: { id: string }) => item.id), total: body.meta.total }
  }

  /** Taksit dağılımı, aynı sorgunun `counts` sonucundan. */
  const invoiceSummaryOf = (value: Counts) => ({
    total: value.total,
    amount: value.sum,
    overdue: { count: countOf(value, 'Gecikmiş'), amount: sumOf(value, 'Gecikmiş') },
    upcoming: { count: countOf(value, 'Yaklaşan'), amount: sumOf(value, 'Yaklaşan') },
    paid: { count: countOf(value, 'Ödendi'), amount: sumOf(value, 'Ödendi') },
  })
  const attendanceOf = (value: Counts) => ({
    present: countOf(value, 'present'),
    absent: countOf(value, 'absent'),
    late: countOf(value, 'late'),
    excused: countOf(value, 'excused'),
    total: value.total,
  })

  test('gün yardımcıları: pazartesi, 8 hafta ve 6 ve 12 ay Europe/Istanbul günü üzerinden', () => {
    assert.equal(mondayOf('2026-10-06'), '2026-10-05')
    assert.equal(mondayOf('2026-10-05'), '2026-10-05')
    assert.equal(mondayOf('2026-10-04'), '2026-09-28')
    assert.equal(addDays('2026-03-28', 2), '2026-03-30')
    const weeks = weekRanges('2026-10-06')
    assert.equal(weeks.length, 8)
    assert.deepEqual(weeks.at(-1), { from: '2026-10-05', to: '2026-10-11' })
    assert.deepEqual(weeks[0], { from: '2026-08-17', to: '2026-08-23' })
    assert.deepEqual(monthKeys('2026-02-10', 6), [
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
    const year = monthKeys('2026-10-06')
    assert.equal(year.length, 12)
    assert.deepEqual([year[0], year.at(-1)], ['2025-11', '2026-10'])
  })

  test('oturumsuz istek 401 unauthenticated', async () => {
    const response = await get('/api/v1/dashboard')
    assert.equal(response.statusCode, 401)
    assert.equal(response.json().code, 'unauthenticated')
  })

  test('etkin kurumu olmayan oturum 403 no_active_institution', async () => {
    const cookie = await signInAs(app, await createUser(app))
    const response = await get('/api/v1/dashboard', cookie)
    assert.equal(response.statusCode, 403)
    assert.equal(response.json().code, 'no_active_institution')
  })

  test('bilinmeyen sorgu parametresi ve personel rolünde studentId 400', async () => {
    const { adminCookie } = await institution()
    const unknown = await get('/api/v1/dashboard?institutionId=x', adminCookie)
    assert.equal(unknown.statusCode, 400)
    assert.equal(unknown.json().code, 'validation_failed')
    const staff = await get('/api/v1/dashboard?studentId=s1', adminCookie)
    assert.equal(staff.statusCode, 400)
    assert.deepEqual(staff.json().issues[0].path, ['studentId'])
  })

  test('yönetici: kartlar eski counts/liste sonuçlarıyla aynıdır', async () => {
    const { adminCookie: cookie } = await institution()
    const data = await dashboard(cookie)
    assert.equal(data.role, 'yonetici')
    assert.equal(data.today, TODAY)

    const students = await counts(cookie, 'students', 'groupBy=isActive')
    assert.deepEqual(data.students, {
      active: countOf(students, true),
      archived: countOf(students, false),
    })
    const classes = await counts(cookie, 'classes', 'groupBy=branchId&sum=capacity&isActive=true')
    assert.deepEqual(data.classes, {
      active: classes.total,
      campusCount: classes.groups.filter((group) => group.value !== null).length,
    })
    const teachers = await counts(cookie, 'teachers', 'groupBy=isActive')
    assert.deepEqual(data.teachers, { active: countOf(teachers, true) })

    const invoices = await counts(cookie, 'invoices', 'groupBy=status&sum=amount')
    assert.ok(invoices.total > 0)
    assert.deepEqual(data.finance.invoices, invoiceSummaryOf(invoices))
    const paidToday = await counts(
      cookie,
      'invoices',
      `groupBy=status&sum=amount&dateField=paidAt&dateFrom=${TODAY}&dateTo=${TODAY}`,
    )
    assert.deepEqual(data.finance.collectedToday, {
      count: countOf(paidToday, 'Ödendi'),
      amount: sumOf(paidToday, 'Ödendi'),
    })
    const monthly = await counts(
      cookie,
      'invoices',
      `groupBy=paidAt:month&sum=amount&dateField=paidAt&dateFrom=2025-11-01&dateTo=${TODAY}`,
    )
    assert.equal(data.finance.monthlyCollection.count, monthly.total)
    assert.equal(data.finance.monthlyCollection.amount, monthly.sum)
    assert.deepEqual(
      data.finance.monthlyCollection.months.map((month: { month: string }) => month.month),
      monthKeys(TODAY, 12),
    )
    for (const month of data.finance.monthlyCollection.months)
      assert.deepEqual(month, {
        month: month.month,
        count: countOf(monthly, month.month),
        amount: sumOf(monthly, month.month),
      })

    const attendance = await counts(
      cookie,
      'attendance',
      `groupBy=status&dateFrom=${TODAY}&dateTo=${TODAY}`,
    )
    assert.deepEqual(data.attendanceToday, attendanceOf(attendance))

    const recent = await listIds(cookie, 'students', 'pageSize=5&sort=-createdAt&isActive=true')
    assert.deepEqual(
      data.recentStudents.map((item: { id: string }) => item.id),
      recent.ids,
    )
    assert.ok(data.recentStudents.every((item: { name: string }) => item.name.length > 0))

    // Kampüs doluluğu: sınıf başına öğrenci sayımı sınıfın kampüsüyle birleşir.
    const byClass = await counts(cookie, 'students', 'groupBy=classId&isActive=true')
    // Sınıfın kampüsü kurumun kendi sınıf kayıtlarından (örnek kesitte olmayan sınıf eşleşmez).
    const branchOf = new Map(
      sampleRows()
        .filter((row) => row.collection === 'classes')
        .map((row) => [row.id, row.data.branchId]),
    )
    for (const campus of data.campuses) {
      const expected = byClass.groups
        .filter((group) => branchOf.get(String(group.value)) === campus.id)
        .reduce((total, group) => total + group.count, 0)
      assert.equal(campus.students, expected, campus.id)
      assert.equal(campus.capacity, sumOf(classes, campus.id), campus.id)
    }
    assert.deepEqual(
      data.campuses.map((campus: { id: string }) => campus.id),
      SEED.branches.filter((item) => item.isActive !== false).map((item) => item.id),
    )
  })

  test('ön büro: taksit dağılımı, öncelikli listeler ve aday aşamaları', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'onburo')
    const data = await dashboard(cookie)
    assert.equal(data.role, 'onburo')
    assert.deepEqual(Object.keys(data).sort(), [
      'finance',
      'prospects',
      'requests',
      'role',
      'today',
    ])

    const invoices = await counts(cookie, 'invoices', 'groupBy=status&sum=amount')
    assert.deepEqual(data.finance.invoices, invoiceSummaryOf(invoices))
    const overdue = await listIds(cookie, 'invoices', 'pageSize=5&sort=dueDate&status=Gecikmiş')
    const upcoming = await listIds(cookie, 'invoices', 'pageSize=5&sort=dueDate&status=Yaklaşan')
    const paid = await listIds(
      cookie,
      'invoices',
      'pageSize=5&sort=-updatedAt,-dueDate&status=Ödendi',
    )
    const ids = (rows: { id: string }[]) => rows.map((row) => row.id)
    assert.deepEqual(ids(data.finance.overdue), overdue.ids)
    assert.deepEqual(ids(data.finance.upcoming), upcoming.ids)
    assert.deepEqual(ids(data.finance.recentPayments), paid.ids)
    for (const row of [...data.finance.overdue, ...data.finance.recentPayments]) {
      assert.equal(typeof row.amount, 'number')
      assert.equal(typeof row.studentName, 'string')
    }

    const prospects = await counts(cookie, 'prospects', 'groupBy=stage')
    assert.equal(data.prospects.total, prospects.total)
    assert.deepEqual(
      data.prospects.stages,
      prospects.groups.map((group) => ({ stage: group.value, count: group.count })),
    )
  })

  test('IST-116: ön büro "Yeni talep" sayısı Şikayet & Talepler listesinin toplamıdır', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'onburo')
    const data = await dashboard(cookie)
    const fresh = await listIds(cookie, 'requests', 'pageSize=20&status=Yeni')
    const review = await listIds(cookie, 'requests', 'pageSize=20&status=İnceleniyor')
    const resolved = await listIds(cookie, 'requests', 'pageSize=20&status=Çözüldü')
    const all = await listIds(cookie, 'requests', 'pageSize=20')
    assert.deepEqual(data.requests, {
      total: all.total,
      new: fresh.total,
      inReview: review.total,
      resolved: resolved.total,
    })
    assert.ok(data.requests.new > 0 && data.requests.inReview > 0, 'örnek veride iki durum var')
    // Liste kampüs süzgeci taşımaz; kart da kampüs seçiminden bağımsızdır.
    const branchId = SEED.branches[0]?.id ?? ''
    const inBranch = await dashboard(cookie, `?branchId=${branchId}`)
    assert.deepEqual(inBranch.requests, data.requests)
  })

  test('DOM-YTK-022: öğretmen yalnız kendi sınıflarını, derslerini ve ödevlerini sayar', async () => {
    const { id, adminCookie } = await institution()
    const cookie = await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
    const data = await dashboard(cookie)
    assert.equal(data.role, 'ogretmen')

    const students = await counts(cookie, 'students', 'groupBy=isActive')
    assert.deepEqual(data.students, { active: countOf(students, true) })
    const all = await counts(adminCookie, 'students', 'groupBy=isActive')
    assert.ok(data.students.active < countOf(all, true), 'öğretmen kapsamı daralır')
    const classes = await counts(cookie, 'classes', 'groupBy=isActive')
    assert.deepEqual(data.classes, { active: countOf(classes, true) })

    const attendance = await counts(
      cookie,
      'attendance',
      `groupBy=status&dateFrom=${TODAY}&dateTo=${TODAY}`,
    )
    assert.deepEqual(data.academic.attendanceToday, attendanceOf(attendance))
    const lessons = await listIds(
      cookie,
      'schedule',
      `pageSize=20&sort=date&teacherId=t1&dateFrom=${TODAY}&dateTo=${TODAY}&cancelled=false`,
    )
    assert.equal(data.academic.lessons.total, lessons.total)
    assert.deepEqual(
      data.academic.lessons.items.map((item: { id: string }) => item.id),
      lessons.ids,
    )
    const cancelled = await counts(
      cookie,
      'schedule',
      `groupBy=teacherId&teacherId=t1&dateFrom=${TODAY}&dateTo=${TODAY}&cancelled=true`,
    )
    assert.equal(data.academic.lessons.cancelled, cancelled.total)
    const absences = await listIds(
      cookie,
      'attendance',
      'pageSize=5&sort=-date&status=absent&status=late',
    )
    assert.deepEqual(
      data.academic.recentAbsences.map((item: { id: string }) => item.id),
      absences.ids,
    )

    const ungraded = await counts(cookie, 'submissions', 'groupBy=homeworkId&graded=false')
    assert.equal(data.learning.ungraded, ungraded.total)
    const homework = await listIds(
      cookie,
      'homework',
      `pageSize=5&sort=dueDate&teacherId=t1&dateField=dueDate&dateFrom=${TODAY}`,
    )
    assert.deepEqual(
      data.learning.homework.map((item: { id: string }) => item.id),
      homework.ids,
    )
    if (homework.ids.length > 0) {
      const deliveries = await counts(
        cookie,
        'submissions',
        `groupBy=homeworkId&${homework.ids.map((hw: string) => `homeworkId=${hw}`).join('&')}`,
      )
      const byClass = await counts(cookie, 'students', 'groupBy=classId&isActive=true')
      for (const item of data.learning.homework) {
        assert.equal(item.delivered, countOf(deliveries, item.id), item.id)
        const classId = SEED.homework.find((hw) => hw.id === item.id)?.classId ?? ''
        assert.equal(item.expected, countOf(byClass, classId), item.id)
      }
    }
  })

  test('IST-116, DOM-ILT-093: öğretmenin yanıt bekleyen soru sayısı soru listesinin toplamıdır', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
    const data = await dashboard(cookie)
    const pending = await listIds(
      cookie,
      'questions',
      'pageSize=100&answered=false&withdrawn=false',
    )
    const own = SEED.questions.filter((q) => q.teacherId === 't1' && !q.answeredAt)
    assert.ok(own.length > 0, 'örnek veride t1 için bekleyen soru var')
    assert.equal(data.questions.total, pending.total)
    assert.equal(data.questions.total, own.length)
    const oldest = own
      .toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .slice(0, 3)
      .map((q) => q.id)
    assert.deepEqual(
      data.questions.items.map((item: { id: string }) => item.id),
      oldest,
    )
    // Süre aşımı iş takvimiyle hesaplanır; aşılanlar toplamın içindedir ve satırda işaretlidir.
    assert.ok(data.questions.overdue <= data.questions.total)
    for (const item of data.questions.items) assert.equal(typeof item.overdue, 'boolean')
    // Başka öğretmenin sorusu sayılmaz.
    const other = await dashboard(
      await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't2' }]),
    )
    const t2 = SEED.questions.filter((q) => q.teacherId === 't2' && !q.answeredAt).length
    assert.equal(other.questions.total, t2)
  })

  test('DOM-ILT-091: geri çekilen soru öğretmenin panosunda sayılmaz', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
    const before = await dashboard(cookie)
    await insertMissingRecords(
      db,
      id,
      [
        {
          collection: 'questions',
          id: 'test-geri-cekilen',
          data: {
            ...SEED.questions[0],
            id: 'test-geri-cekilen',
            teacherId: 't1',
            createdAt: '2026-10-01T08:00:00.000Z',
            answeredAt: null,
            withdrawnAt: '2026-10-02T08:00:00.000Z',
          },
        },
      ],
      new Date(FIXED_NOW.getTime() + 60_000),
    )
    const after = await dashboard(cookie)
    assert.equal(after.questions.total, before.questions.total)
    assert.doesNotMatch(JSON.stringify(after.questions), /test-geri-cekilen/)
  })

  test('IST-116: bekleyen soru sayısı okuma sınırını aşarsa sessizce eksik sayılmaz', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
    const rows = Array.from({ length: 5001 }, (_, index) => ({
      collection: 'questions' as const,
      id: `test-toplu-${index}`,
      data: {
        ...SEED.questions[0],
        id: `test-toplu-${index}`,
        teacherId: 't1',
        answeredAt: null,
      },
    }))
    await insertMissingRecords(db, id, rows, new Date(FIXED_NOW.getTime() + 60_000))
    const response = await get('/api/v1/dashboard', cookie)
    assert.equal(response.statusCode, 500)
  })

  test('öğrenci: yalnız kendi özeti, ödeme alanı yok; başka öğrenci 404', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])
    const data = await dashboard(cookie)
    assert.equal(data.role, 'ogrenci')
    assert.deepEqual(data.student, { id: 's1', name: 'Deniz Yılmaz' })
    assert.equal('balance' in data, false, 'öğrenciye ödeme bilgisi gönderilmez')
    assert.doesNotMatch(JSON.stringify(data), /amount|outstanding/)

    const grades = await counts(cookie, 'grades', 'groupBy=subjectId&sum=score&studentId=s1')
    assert.equal(data.academic.grades.count, grades.total)
    assert.equal(data.academic.grades.scoreSum, grades.sum)
    assert.deepEqual(
      data.academic.grades.subjects.map((row: { subjectId: string; count: number }) => [
        row.subjectId,
        row.count,
      ]),
      grades.groups.map((group) => [group.value, group.count]),
    )
    const attendance = await counts(cookie, 'attendance', 'groupBy=status&studentId=s1')
    assert.deepEqual(data.academic.attendance, attendanceOf(attendance))
    for (const week of data.academic.weeklyAbsences) {
      const slice = await counts(
        cookie,
        'attendance',
        `groupBy=status&studentId=s1&dateFrom=${week.from}&dateTo=${week.to}`,
      )
      assert.equal(week.absent, countOf(slice, 'absent'), week.from)
    }
    const submitted = await counts(cookie, 'submissions', 'groupBy=studentId&studentId=s1')
    const assigned = await counts(cookie, 'homework', 'groupBy=classId&classId=c1')
    assert.equal(data.learning.submitted, submitted.total)
    assert.equal(data.learning.assigned, assigned.total)
    const homework = await listIds(
      cookie,
      'homework',
      `pageSize=5&sort=dueDate&classId=c1&dateField=dueDate&dateFrom=${TODAY}`,
    )
    assert.deepEqual(
      data.learning.homework.map((item: { id: string }) => item.id),
      homework.ids,
    )
    const own = SEED.submissions.filter((item) => item.studentId === 's1')
    for (const item of data.learning.homework) {
      const submission = own.find((row) => row.homeworkId === item.id)
      assert.deepEqual(item.submission, submission ? { score: submission.score ?? null } : null)
    }

    assert.equal((await get('/api/v1/dashboard?studentId=s2', cookie)).statusCode, 404)
    assert.equal((await get('/api/v1/dashboard?studentId=s1', cookie)).statusCode, 200)
  })

  test('DOM-FIN-052: veli iki çocuğu arasında seçer; bakiye seçili çocuğundur, başka öğrenci 404', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'veli', [
      { kind: 'child', recordId: 's1' },
      { kind: 'child', recordId: 's2' },
    ])
    const first = await dashboard(cookie)
    assert.equal(first.role, 'veli')
    assert.equal(first.student.id, 's1', 'verilmezse kapsamdaki ilk çocuk')

    const summaries = []
    for (const child of ['s1', 's2']) {
      const data = await dashboard(cookie, `?studentId=${child}`)
      assert.equal(data.student.id, child)
      const grades = await counts(
        cookie,
        'grades',
        `groupBy=subjectId&sum=score&studentId=${child}`,
      )
      assert.equal(data.academic.grades.count, grades.total, child)
      assert.equal(data.academic.grades.scoreSum, grades.sum, child)
      const attendance = await counts(cookie, 'attendance', `groupBy=status&studentId=${child}`)
      assert.deepEqual(data.academic.attendance, attendanceOf(attendance), child)
      const invoices = await counts(
        cookie,
        'invoices',
        `groupBy=status&sum=amount&studentId=${child}`,
      )
      assert.deepEqual(data.balance, {
        outstanding: sumOf(invoices, 'Gecikmiş') + sumOf(invoices, 'Yaklaşan'),
        overdueCount: countOf(invoices, 'Gecikmiş'),
      })
      summaries.push(data)
    }
    assert.notDeepEqual(summaries[0].academic, summaries[1].academic, 'çocukların özeti ayrışır')

    const other = await get('/api/v1/dashboard?studentId=s11', cookie)
    assert.equal(other.statusCode, 404)
    assert.equal(other.json().code, 'not_found')
  })

  test('bağlı öğrencisi olmayan veli 404 alır', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'veli')
    assert.equal((await get('/api/v1/dashboard', cookie)).statusCode, 404)
  })

  test('DOM-YTK-040: kapalı modülün bölümü null; çekirdek kartlar dolu', async () => {
    const { id, adminCookie } = await institution({
      enabledModules: { finance: false, academic: false, learning: false, crm: false },
    })
    const admin = await dashboard(adminCookie)
    assert.equal(admin.finance, null)
    assert.equal(admin.attendanceToday, null)
    assert.ok(admin.students.active > 0)
    assert.ok(admin.campuses.length > 0)

    const desk = await dashboard(await memberCookie(id, 'onburo'))
    assert.equal(desk.finance, null)
    assert.equal(desk.prospects, null)
    assert.notEqual(desk.requests, null, 'iletişim açık: talep bölümü kalır')

    const teacher = await dashboard(
      await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }]),
    )
    assert.equal(teacher.academic, null)
    assert.equal(teacher.learning, null)
    assert.equal(teacher.questions, null)
    assert.ok(teacher.students.active > 0)

    const parent = await dashboard(
      await memberCookie(id, 'veli', [{ kind: 'child', recordId: 's1' }]),
    )
    assert.equal(parent.academic, null)
    assert.equal(parent.learning, null)
    assert.equal(parent.balance, null)
  })

  test('yalnız finans kapalıyken yönetici ve velide yalnız finans bölümü kalkar', async () => {
    const { id, adminCookie } = await institution({ enabledModules: { finance: false } })
    const admin = await dashboard(adminCookie)
    assert.equal(admin.finance, null)
    assert.notEqual(admin.attendanceToday, null)
    const parent = await dashboard(
      await memberCookie(id, 'veli', [{ kind: 'child', recordId: 's1' }]),
    )
    assert.equal(parent.balance, null)
    assert.notEqual(parent.academic, null)
  })

  test('DOM-YTK-040: iletişim kapalıyken ön büro talep bölümü null, liste ucu 403', async () => {
    const { id } = await institution({ enabledModules: { communication: false } })
    const cookie = await memberCookie(id, 'onburo')
    const desk = await dashboard(cookie)
    assert.equal(desk.requests, null)
    assert.notEqual(desk.finance, null)
    const list = await get('/api/v1/collections/requests', cookie)
    assert.equal(list.statusCode, 403)
  })

  test('başka kurumun kaydı özete girmez', async () => {
    const a = await institution()
    const before = await dashboard(a.adminCookie)
    const b = await institution()
    await insertMissingRecords(
      db,
      b.id,
      [
        {
          collection: 'students',
          id: 'test-b-ogrenci',
          data: { ...SEED.students[0], id: 'test-b-ogrenci', name: 'Test B Öğrenci' },
        },
        {
          collection: 'invoices',
          id: 'test-b-taksit',
          data: { ...SEED.invoices[0], id: 'test-b-taksit', studentId: 'test-b-ogrenci' },
        },
      ],
      new Date(FIXED_NOW.getTime() + 60_000),
    )
    // B kurumunda yeni talep ve yanıtsız soru: A'nın ön büro ve öğretmen sayıları değişmez.
    await insertMissingRecords(
      db,
      b.id,
      [
        {
          collection: 'requests',
          id: 'test-b-talep',
          data: { ...SEED.requests[0], id: 'test-b-talep', status: 'Yeni' },
        },
        {
          collection: 'questions',
          id: 'test-b-soru',
          data: { ...SEED.questions[0], id: 'test-b-soru', teacherId: 't1', answeredAt: null },
        },
      ],
      new Date(FIXED_NOW.getTime() + 120_000),
    )
    const deskA = await memberCookie(a.id, 'onburo')
    const teacherA = await memberCookie(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
    const deskBefore = await dashboard(deskA)
    const teacherBefore = await dashboard(teacherA)
    const after = await dashboard(a.adminCookie)
    assert.deepEqual(after, before)
    assert.equal(
      (await dashboard(await memberCookie(b.id, 'onburo'))).requests.new,
      deskBefore.requests.new + 1,
    )
    assert.equal(
      (await dashboard(await memberCookie(b.id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])))
        .questions.total,
      teacherBefore.questions.total + 1,
    )
    const inB = await dashboard(b.adminCookie)
    assert.equal(inB.students.active, before.students.active + 1)
    assert.equal(inB.finance.invoices.total, before.finance.invoices.total + 1)
    assert.equal(inB.recentStudents[0].id, 'test-b-ogrenci')
    assert.doesNotMatch(JSON.stringify(after), /test-b-/)
  })

  test('DOM-YTK-012: dil okulunda da bütün bölümler döner (Genel Bakış modülleri iki türde açık)', async () => {
    const { adminCookie } = await institution({ type: 'language_school' })
    const data = await dashboard(adminCookie)
    assert.equal(data.role, 'yonetici')
    assert.notEqual(data.finance, null)
    assert.notEqual(data.attendanceToday, null)
  })

  describe('kampüs süzgeci (branchId)', () => {
    // `s1`, `s2` `b1` kampüsündeki `c1`, `c2` sınıfında; `s11` `b2` kampüsündeki `c11` sınıfında.
    async function twoCampuses() {
      const created = await institution()
      await insertMissingRecords(
        db,
        created.id,
        [
          ...SEED.classes
            .filter((item) => item.id === 'c11')
            .map((data) => ({ collection: 'classes' as const, id: data.id, data })),
          ...SEED.teachers
            .filter((item) => item.branchId === 'b2')
            .slice(0, 1)
            .map((data) => ({ collection: 'teachers' as const, id: data.id, data })),
        ],
        FIXED_NOW,
      )
      return created
    }
    const CAMPUS_CLASSES: Record<string, string[]> = { b1: ['c1', 'c2', 'c3'], b2: ['c11'] }
    const classQuery = (branch: string) =>
      (CAMPUS_CLASSES[branch] ?? []).map((id) => `classId=${id}`).join('&')

    test('yönetici: öğrenci, taksit, yoklama ve kampüs doluluğu seçili kampüse daralır', async () => {
      const { adminCookie: cookie } = await twoCampuses()
      const all = await dashboard(cookie)
      for (const branch of ['b1', 'b2']) {
        const data = await dashboard(cookie, `?branchId=${branch}`)
        const students = await counts(cookie, 'students', `groupBy=isActive&${classQuery(branch)}`)
        assert.deepEqual(data.students, {
          active: countOf(students, true),
          archived: countOf(students, false),
        })
        const invoices = await counts(
          cookie,
          'invoices',
          `groupBy=status&sum=amount&${classQuery(branch)}`,
        )
        assert.deepEqual(data.finance.invoices, invoiceSummaryOf(invoices))
        const monthly = await counts(
          cookie,
          'invoices',
          `groupBy=paidAt:month&sum=amount&dateField=paidAt&dateFrom=2025-11-01&dateTo=${TODAY}&${classQuery(branch)}`,
        )
        assert.equal(data.finance.monthlyCollection.amount, monthly.sum)
        const attendance = await counts(
          cookie,
          'attendance',
          `groupBy=status&dateFrom=${TODAY}&dateTo=${TODAY}&${classQuery(branch)}`,
        )
        assert.deepEqual(data.attendanceToday, attendanceOf(attendance))
        assert.deepEqual(
          data.campuses.map((campus: { id: string }) => campus.id),
          [branch],
        )
        assert.equal(data.campuses[0].students, data.students.active)
        assert.equal(data.classes.campusCount, 1)
        const teachers = await counts(cookie, 'teachers', `groupBy=isActive&branchId=${branch}`)
        assert.deepEqual(data.teachers, { active: countOf(teachers, true) })
        assert.equal(data.teachers.active, branch === 'b1' ? 2 : 1, `${branch} öğretmen kadrosu`)
        assert.ok(data.teachers.active < all.teachers.active, `${branch} kadrosu kurumdan dardır`)
        assert.ok(data.students.active < all.students.active, `${branch} kurumdan dardır`)
        const recent = await listIds(
          cookie,
          'students',
          `pageSize=5&sort=-createdAt&isActive=true&${classQuery(branch)}`,
        )
        assert.deepEqual(
          data.recentStudents.map((item: { id: string }) => item.id),
          recent.ids,
        )
      }
    })

    test('sınıfı olmayan kampüs boş döner, kurum toplamına düşmez', async () => {
      const { adminCookie: cookie } = await twoCampuses()
      const data = await dashboard(cookie, '?branchId=b3')
      assert.deepEqual(data.students, { active: 0, archived: 0 })
      assert.equal(data.finance.invoices.total, 0)
      assert.equal(data.finance.monthlyCollection.amount, 0)
      assert.equal(data.attendanceToday.total, 0)
      assert.deepEqual(data.recentStudents, [])
      assert.deepEqual(
        data.campuses.map((campus: { id: string }) => campus.id),
        ['b3'],
      )
    })

    test('ön büro: taksit özeti ve listeleri seçili kampüse daralır', async () => {
      const { id } = await twoCampuses()
      const cookie = await memberCookie(id, 'onburo')
      const data = await dashboard(cookie, '?branchId=b2')
      const invoices = await counts(
        cookie,
        'invoices',
        `groupBy=status&sum=amount&${classQuery('b2')}`,
      )
      assert.deepEqual(data.finance.invoices, invoiceSummaryOf(invoices))
      assert.ok(data.finance.invoices.total > 0)
      assert.ok(data.finance.invoices.total < (await dashboard(cookie)).finance.invoices.total)
      const paid = await listIds(
        cookie,
        'invoices',
        `pageSize=5&sort=-updatedAt,-dueDate&status=Ödendi&${classQuery('b2')}`,
      )
      assert.deepEqual(
        data.finance.recentPayments.map((row: { id: string }) => row.id),
        paid.ids,
      )
    })

    test('başka kurumun gerçek kampüs kimliği 404 döner, o kurumda çözülür', async () => {
      const mine = await twoCampuses()
      const other = await institution()
      const foreign = 'b-baska-kurum'
      const branch = SEED.branches.find((item) => item.id === 'b3')
      assert.ok(branch)
      await insertMissingRecords(
        db,
        other.id,
        [{ collection: 'branches', id: foreign, data: { ...branch, id: foreign } }],
        FIXED_NOW,
      )
      const query = `/api/v1/dashboard?branchId=${foreign}`
      assert.equal((await get(query, other.adminCookie)).statusCode, 200)
      assert.equal((await get(query, mine.adminCookie)).statusCode, 404)
      const desk = await memberCookie(mine.id, 'onburo')
      assert.equal((await get(query, desk)).statusCode, 404)
    })

    test('olmayan kampüs 404; öğretmen, öğrenci ve velide 400', async () => {
      const { id, adminCookie } = await twoCampuses()
      const missing = await get('/api/v1/dashboard?branchId=yok', adminCookie)
      assert.equal(missing.statusCode, 404)
      const desk = await get('/api/v1/dashboard?branchId=yok', await memberCookie(id, 'onburo'))
      assert.equal(desk.statusCode, 404)
      for (const [role, links] of [
        ['ogretmen', [{ kind: 'teacher', recordId: 't1' }]],
        ['ogrenci', [{ kind: 'student', recordId: 's1' }]],
        ['veli', [{ kind: 'child', recordId: 's1' }]],
      ] as const) {
        const response = await get(
          '/api/v1/dashboard?branchId=b1',
          await memberCookie(id, role, [...links]),
        )
        assert.equal(response.statusCode, 400, role)
        assert.deepEqual(response.json().issues[0].path, ['branchId'], role)
      }
    })
  })
})
