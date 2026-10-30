import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { asc, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import type { CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords, writeRecords } from '../src/db/records.ts'
import { records } from '../src/db/schema/records.ts'
import { READABLE_COLLECTIONS } from '../src/services/collection-access.ts'
import { readScope, readsWholeCollection } from '../src/services/read-scope.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
} from './support/app.ts'
import { SAMPLE, sampleRows, SEED, STUDENT_IDS } from './support/collections-sample.ts'

/**
 * Koleksiyon okumalarının türetilmiş ve bağlı alanları: taksit durumu süzgeci, toplu sayım ucu,
 * bağlı adla arama ve sıralama. Kapsam ve alan ayıklaması her birinde ayrıca sabitlenir.
 * FIXED_NOW 2026-10-06T09:00Z: Europe/Istanbul günü 2026-10-06.
 */

/** Örnek kesitteki taksitler ödenmiştir; durum dağılımı için ödenmemiş taksitler eklenir. */
const EXTRA_INVOICES = [
  { id: 'test-inv-late-s1', studentId: 's1', dueDate: '2026-10-05', amount: 100_00 },
  { id: 'test-inv-today-s2', studentId: 's2', dueDate: '2026-10-06', amount: 200_00 },
  { id: 'test-inv-late-s11', studentId: 's11', dueDate: '2026-09-01', amount: 400_00 },
].map((item) => ({ ...item, installment: 9, paidAt: null, method: null, reminderAt: null }))

const PAID_SAMPLE = sampleRows().filter((row) => row.collection === 'invoices')

function extraRows(): { collection: CollectionName; id: string; data: Record<string, unknown> }[] {
  return [
    ...SEED.branches.slice(0, 2).map((data) => ({
      collection: 'branches' as const,
      id: data.id,
      data,
    })),
    ...EXTRA_INVOICES.map((data) => ({ collection: 'invoices' as const, id: data.id, data })),
  ]
}

describe('koleksiyon sorguları: durum, sayım, bağlı alan', () => {
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

  async function institution() {
    const created = await createInstitution(app)
    await insertMissingRecords(db, created.id, [...sampleRows(), ...extraRows()], FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }

  async function memberCookie(
    institutionId: string,
    role: Role,
    links: Parameters<typeof createMember>[3] = [],
    target: App = app,
  ) {
    return signInAs(target, await createMember(target, institutionId, role, links))
  }

  function get(url: string, cookie?: string, target: App = app) {
    return target.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })
  }

  async function ids(cookie: string, url: string, target: App = app): Promise<string[]> {
    const response = await get(url, cookie, target)
    assert.equal(response.statusCode, 200, `${url} ${response.body}`)
    const body = response.json()
    assert.equal(body.meta.total, body.data.length, url)
    return body.data.map((item: { id: string }) => item.id)
  }

  function rowsOf(institutionId: string) {
    return db
      .select()
      .from(records)
      .where(eq(records.institutionId, institutionId))
      .orderBy(asc(records.collection), asc(records.id))
  }

  const invoicesUrl = (query: string) => `/api/v1/collections/invoices?pageSize=100&${query}`
  const status = (label: string) => `status=${encodeURIComponent(label)}`

  describe('taksit durumu süzgeci', () => {
    test('durum core invoiceStatus ile türetilir; çoklu değer ve sıralama', async () => {
      const { adminCookie } = await institution()

      assert.deepEqual(await ids(adminCookie, invoicesUrl(status('Gecikmiş'))), [
        'test-inv-late-s1',
        'test-inv-late-s11',
      ])
      assert.deepEqual(await ids(adminCookie, invoicesUrl(status('Yaklaşan'))), [
        'test-inv-today-s2',
      ])
      assert.deepEqual(
        await ids(adminCookie, invoicesUrl(status('Ödendi'))),
        PAID_SAMPLE.map((row) => row.id),
      )
      assert.deepEqual(
        await ids(adminCookie, invoicesUrl(`${status('Yaklaşan')}&${status('Gecikmiş')}`)),
        ['test-inv-late-s1', 'test-inv-today-s2', 'test-inv-late-s11'],
      )
      // Türetilmiş durumla sıralama: Gecikmiş < Ödendi < Yaklaşan (tr-TR), eşitlikte depo sırası.
      const sortedIds = await ids(adminCookie, invoicesUrl('sort=status'))
      assert.deepEqual(sortedIds.slice(0, 2), ['test-inv-late-s1', 'test-inv-late-s11'])
      assert.equal(sortedIds.at(-1), 'test-inv-today-s2')
      // Diğer süzgeçlerle birlikte.
      assert.deepEqual(await ids(adminCookie, invoicesUrl(`${status('Gecikmiş')}&studentId=s11`)), [
        'test-inv-late-s11',
      ])
    })

    test('durum isteğin saatinden hesaplanır: ertesi gün bugünkü vade gecikmiş olur', async () => {
      const { id, admin } = await institution()
      const tomorrow = await buildTestApp(db, {
        clock: () => new Date('2026-10-06T21:00:00.000Z'),
      })
      try {
        const cookie = await signInAs(tomorrow, admin)
        assert.deepEqual(await ids(cookie, invoicesUrl(status('Gecikmiş')), tomorrow), [
          'test-inv-late-s1',
          'test-inv-today-s2',
          'test-inv-late-s11',
        ])
        // Bir milisaniye öncesi hâlâ 2026-10-06 (Europe/Istanbul 23:59:59.999).
        const sameDay = await buildTestApp(db, {
          clock: () => new Date('2026-10-06T20:59:59.999Z'),
        })
        try {
          const sameCookie = await signInAs(sameDay, admin)
          assert.deepEqual(await ids(sameCookie, invoicesUrl(status('Yaklaşan')), sameDay), [
            'test-inv-today-s2',
          ])
        } finally {
          await sameDay.close()
        }
      } finally {
        await tomorrow.close()
      }
      assert.ok(id)
    })

    test('DOM-YTK-025: veli yalnız kendi çocuklarının gecikmiş taksitini görür', async () => {
      const { id } = await institution()
      const cookie = await memberCookie(id, 'veli', [
        { kind: 'child', recordId: 's1' },
        { kind: 'child', recordId: 's2' },
      ])
      assert.deepEqual(await ids(cookie, invoicesUrl(status('Gecikmiş'))), ['test-inv-late-s1'])
      const student = await memberCookie(id, 'ogrenci', [{ kind: 'student', recordId: 's11' }])
      assert.deepEqual(await ids(student, invoicesUrl(status('Gecikmiş'))), ['test-inv-late-s11'])
      const teacher = await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
      assert.equal((await get(invoicesUrl(status('Gecikmiş')), teacher)).statusCode, 403)
    })

    test('classId süzgeci ve gruplaması öğrencinin güncel sınıfından; kapsam korunur', async () => {
      const { id, adminCookie } = await institution()
      const classOf = (studentId: unknown) =>
        SEED.students.find((item) => item.id === studentId)?.classId
      const invoices = [...PAID_SAMPLE.map((row) => row.data), ...EXTRA_INVOICES]
      const inClasses = (...classIds: string[]) =>
        invoices
          .filter((row) => classIds.includes(classOf(row.studentId) ?? ''))
          .map((row) => String(row.id))
          .sort()
      const s1Class = classOf('s1')
      const s11Class = classOf('s11')
      assert.ok(s1Class && s11Class && s1Class !== s11Class)
      const sortedIds = async (cookie: string, query: string) =>
        (await ids(cookie, invoicesUrl(query))).sort()

      const firstClass = await sortedIds(adminCookie, `classId=${s1Class}`)
      assert.ok(firstClass.includes('test-inv-late-s1'))
      assert.deepEqual(firstClass, inClasses(s1Class))
      assert.deepEqual(
        await sortedIds(adminCookie, `classId=${s1Class}&classId=${s11Class}`),
        inClasses(s1Class, s11Class),
      )
      assert.deepEqual(await ids(adminCookie, invoicesUrl('classId=test-bos')), [])
      // Diğer süzgeçlerle birlikte: sınıfın gecikmiş taksitleri.
      assert.deepEqual(
        await ids(adminCookie, invoicesUrl(`classId=${s11Class}&${status('Gecikmiş')}`)),
        ['test-inv-late-s11'],
      )
      // Sınıf başına sayım da öğrencinin sınıfıyla.
      const groups = await get(
        `/api/v1/collections/invoices/counts?groupBy=classId&sum=amount`,
        adminCookie,
      )
      assert.equal(groups.statusCode, 200, groups.body)
      for (const group of groups.json().data as { value: string; count: number }[])
        assert.equal(group.count, inClasses(group.value).length, group.value)
      assert.ok((groups.json().data as { value: unknown }[]).every((group) => group.value !== null))
      // Veli sınıf süzgeciyle kendi çocukları dışındaki taksiti görmez.
      const parent = await memberCookie(id, 'veli', [{ kind: 'child', recordId: 's1' }])
      const parentIds = await sortedIds(parent, `classId=${s1Class}`)
      assert.ok(parentIds.length > 0)
      assert.deepEqual(
        parentIds,
        invoices
          .filter((row) => row.studentId === 's1')
          .map((row) => String(row.id))
          .sort(),
      )
      assert.deepEqual(await ids(parent, invoicesUrl(`classId=${s11Class}`)), [])
    })

    test('metin olmayan doğru ödeme değeri süzgeçte, sıralamada ve sayımda Ödendi', async () => {
      const { id, adminCookie } = await institution()
      const odd = [
        { id: 'test-inv-dizi', paidAt: [] },
        { id: 'test-inv-nesne', paidAt: {} },
        { id: 'test-inv-dogru', paidAt: true },
      ].map((item) => ({
        ...item,
        studentId: 's1',
        installment: 10,
        amount: 50_00,
        dueDate: '2026-09-01',
        method: null,
        reminderAt: null,
      }))
      await insertMissingRecords(
        db,
        id,
        odd.map((data) => ({ collection: 'invoices' as const, id: data.id, data })),
        FIXED_NOW,
      )
      const oddIds = odd.map((item) => item.id)
      const paid = await ids(adminCookie, invoicesUrl(status('Ödendi')))
      assert.ok(
        oddIds.every((key) => paid.includes(key)),
        'SQL adayı ve bellek kararı aynı',
      )
      for (const label of ['Gecikmiş', 'Yaklaşan'])
        assert.ok(
          (await ids(adminCookie, invoicesUrl(status(label)))).every(
            (key) => !oddIds.includes(key),
          ),
          label,
        )
      const response = await get(
        '/api/v1/collections/invoices/counts?groupBy=status&studentId=s1',
        adminCookie,
      )
      assert.equal(response.statusCode, 200, response.body)
      const s1Paid = paid.filter((key) =>
        [...PAID_SAMPLE.map((row) => row.data), ...odd].some(
          (row) => row.id === key && row.studentId === 's1',
        ),
      )
      assert.deepEqual(response.json().data, [
        { value: 'Gecikmiş', count: 1 },
        { value: 'Ödendi', count: s1Paid.length },
      ])
    })

    test('bilinmeyen durum değeri 400; kayıtlar değişmez', async () => {
      const { id, adminCookie } = await institution()
      const before = await rowsOf(id)
      for (const query of [status('gecikmis'), `${status('Ödendi')}&status=x`]) {
        const response = await get(invoicesUrl(query), adminCookie)
        assert.equal(response.statusCode, 400, query)
        assert.equal(response.json().code, 'validation_failed')
        assert.deepEqual(response.json().issues[0].path, ['status'])
      }
      // Durumu saklanan koleksiyonda `status` alan eşitliğidir.
      assert.equal(
        (await get('/api/v1/collections/attendance?status=absent', adminCookie)).statusCode,
        200,
      )
      assert.deepEqual(await rowsOf(id), before)
    })

    test('oturumsuz 401; başka kurumun taksiti durum süzgecinde görünmez', async () => {
      assert.equal((await get(invoicesUrl(status('Gecikmiş')))).statusCode, 401)
      const first = await institution()
      const other = await createInstitution(app)
      const cookie = await signInAs(app, other.admin)
      assert.deepEqual(await ids(cookie, invoicesUrl(status('Gecikmiş'))), [])
      assert.ok(first.id)
    })
  })

  describe('toplu sayım ucu', () => {
    const countsUrl = (collection: string, query: string) =>
      `/api/v1/collections/${collection}/counts?${query}`

    async function counts(cookie: string, url: string) {
      const response = await get(url, cookie)
      assert.equal(response.statusCode, 200, `${url} ${response.body}`)
      return response.json() as {
        data: { value: unknown; count: number; sum?: number }[]
        meta: { total: number; sum?: number }
      }
    }

    const sumOf = (rows: readonly { data: Record<string, unknown> }[]) =>
      rows.reduce((total, row) => total + Number(row.data.amount), 0)

    test('durum başına taksit sayısı ve tutarı (kuruş); meta toplamı', async () => {
      const { adminCookie } = await institution()
      const body = await counts(adminCookie, countsUrl('invoices', 'groupBy=status&sum=amount'))
      assert.deepEqual(body.data, [
        { value: 'Gecikmiş', count: 2, sum: 500_00 },
        { value: 'Ödendi', count: PAID_SAMPLE.length, sum: sumOf(PAID_SAMPLE) },
        { value: 'Yaklaşan', count: 1, sum: 200_00 },
      ])
      assert.deepEqual(body.meta, {
        total: PAID_SAMPLE.length + 3,
        sum: sumOf(PAID_SAMPLE) + 700_00,
      })
      // Toplamsız sayımda `sum` alanı yoktur; liste süzgeçleri aynıdır.
      const late = await counts(
        adminCookie,
        countsUrl('invoices', `groupBy=studentId&${status('Gecikmiş')}`),
      )
      assert.deepEqual(late, {
        data: [
          { value: 's1', count: 1 },
          { value: 's11', count: 1 },
        ],
        meta: { total: 2 },
      })
    })

    test('kampüs başına sınıf, sınıf başına öğrenci; öğrenci koleksiyonunda sınıf öğrenciden', async () => {
      const { adminCookie } = await institution()
      assert.deepEqual(
        (await counts(adminCookie, countsUrl('classes', 'groupBy=branchId&sum=capacity'))).data,
        [{ value: 'b1', count: 3, sum: 72 }],
      )
      const students = SEED.students.filter((item) => STUDENT_IDS.includes(item.id))
      const byClass = new Map<string, number>()
      for (const student of students)
        byClass.set(student.classId, (byClass.get(student.classId) ?? 0) + 1)
      const expected = [...byClass.entries()]
        .sort(([a], [b]) => new Intl.Collator('tr-TR', { numeric: true }).compare(a, b))
        .map(([value, count]) => ({ value, count }))
      assert.deepEqual(
        (await counts(adminCookie, countsUrl('students', 'groupBy=classId'))).data,
        expected,
      )
      // Notlarda sınıf kayıtta yoktur: öğrencinin güncel sınıfıyla gruplanır.
      const grades = SAMPLE.grades ?? []
      const gradeGroups = (
        await counts(adminCookie, countsUrl('grades', 'groupBy=classId&sum=score'))
      ).data
      const classOf = (id: unknown) => students.find((item) => item.id === id)?.classId
      for (const group of gradeGroups) {
        const rows = grades.filter((row) => classOf(row.studentId) === group.value)
        assert.equal(group.count, rows.length, String(group.value))
        assert.equal(
          group.sum,
          rows.reduce((total, row) => total + Number(row.score), 0),
        )
      }
      assert.equal(
        gradeGroups.reduce((total, group) => total + group.count, 0),
        grades.length,
      )
      // Alanı olmayan kayıt etkindir; skaler olmayan değer `null` grubudur.
      assert.deepEqual(
        (await counts(adminCookie, countsUrl('branches', 'groupBy=isActive'))).data,
        [{ value: true, count: 2 }],
      )
      assert.deepEqual(
        (await counts(adminCookie, countsUrl('parents', 'groupBy=studentId'))).data,
        [{ value: null, count: 1 }],
      )
    })

    test('DOM-YTK-025/022: kapsam dışı kayıt sayılmaz ve toplama girmez', async () => {
      const { id } = await institution()
      const parent = await memberCookie(id, 'veli', [
        { kind: 'child', recordId: 's1' },
        { kind: 'child', recordId: 's2' },
      ])
      const own = PAID_SAMPLE.filter((row) => ['s1', 's2'].includes(String(row.data.studentId)))
      assert.deepEqual(await counts(parent, countsUrl('invoices', 'groupBy=status&sum=amount')), {
        data: [
          { value: 'Gecikmiş', count: 1, sum: 100_00 },
          { value: 'Ödendi', count: own.length, sum: sumOf(own) },
          { value: 'Yaklaşan', count: 1, sum: 200_00 },
        ],
        meta: { total: own.length + 2, sum: sumOf(own) + 300_00 },
      })
      // Bağlı olmayan çocuğun kimliğiyle süzmek sayım üretmez.
      assert.deepEqual(
        await counts(parent, countsUrl('invoices', 'groupBy=status&studentId=s11')),
        { data: [], meta: { total: 0 } },
      )
      // Türkçe branş öğretmeni (rehber değil) yalnız kendi dersinin notlarını sayar.
      const teacher = await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't2' }])
      const subjects = (await counts(teacher, countsUrl('grades', 'groupBy=subjectId'))).data
      assert.deepEqual(
        subjects.map((group) => group.value),
        ['turkish'],
      )
      assert.ok(subjects.every((group) => group.count > 0))
      // Başka kurumun yöneticisi bu kurumun kayıtlarını saymaz.
      const other = await createInstitution(app)
      const otherCookie = await signInAs(app, other.admin)
      assert.deepEqual(
        await counts(otherCookie, countsUrl('invoices', 'groupBy=status&sum=amount')),
        {
          data: [],
          meta: { total: 0, sum: 0 },
        },
      )
    })

    test('DOM-YTK-021/020: ayıklanan alanla gruplama ve toplama 400; gizli alanla arama sayılmaz', async () => {
      const { id, adminCookie } = await institution()
      const before = await rowsOf(id)
      const frontOffice = await memberCookie(id, 'onburo')
      const response = await get(countsUrl('students', 'groupBy=classId&sum=progress'), frontOffice)
      assert.equal(response.statusCode, 400)
      assert.equal(response.json().code, 'validation_failed')
      assert.deepEqual(response.json().issues[0].path, ['sum'])
      // Aynı alan yöneticide görünür ve toplanır.
      const admin = await counts(adminCookie, countsUrl('students', 'groupBy=classId&sum=progress'))
      assert.equal(
        admin.meta.sum,
        SEED.students
          .filter((item) => STUDENT_IDS.includes(item.id))
          .reduce((total, item) => total + item.progress, 0),
      )
      const student = await memberCookie(id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])
      const teachers = await get(
        countsUrl('teachers', 'groupBy=subjectId&sum=attendanceRate'),
        student,
      )
      assert.equal(teachers.statusCode, 400)
      // Rehberlik iç notu yöneticide ayıklanır: onunla arama hiçbir kaydı saymaz.
      const words = encodeURIComponent(
        SEED.guidanceCases[0]?.internalNote.split(' ').slice(0, 2).join(' ') ?? '',
      )
      assert.deepEqual(
        await counts(adminCookie, countsUrl('guidanceCases', `groupBy=status&q=${words}`)),
        {
          data: [],
          meta: { total: 0 },
        },
      )
      assert.deepEqual(await rowsOf(id), before)
    })

    test('401, 403, 404 ve 400: liste ucuyla aynı kurallar', async () => {
      // Kimlik sorgu doğrulamasından önce: oturumsuz istek geçersiz sorguda da 401.
      for (const url of [
        countsUrl('invoices', 'groupBy=status'),
        countsUrl('invoices', ''),
        '/api/v1/collections/invoices?sort=bilinmeyen',
      ])
        assert.equal((await get(url)).statusCode, 401, url)
      const { id, adminCookie } = await institution()
      const outcome = async (url: string, cookie: string) => {
        const response = await get(url, cookie)
        return `${response.statusCode} ${response.json().code}`
      }
      for (const query of [
        '',
        'groupBy=name',
        'groupBy=status&sum=name',
        'groupBy=status&page=1',
        'groupBy=status&sort=id',
        'groupBy=status&institutionId=x',
      ])
        assert.equal(
          await outcome(countsUrl('invoices', query), adminCookie),
          '400 validation_failed',
          query,
        )
      assert.equal(
        await outcome(countsUrl('bilinmeyen', 'groupBy=status'), adminCookie),
        '404 not_found',
      )
      assert.equal(
        await outcome(countsUrl('audit', 'groupBy=status'), adminCookie),
        '404 not_found',
      )
      const frontOffice = await memberCookie(id, 'onburo')
      assert.equal(
        await outcome(countsUrl('grades', 'groupBy=subjectId'), frontOffice),
        '403 forbidden',
      )
      const closed = await createInstitution(app, { enabledModules: { finance: false } })
      const closedCookie = await signInAs(app, closed.admin)
      assert.equal(
        await outcome(countsUrl('invoices', 'groupBy=status'), closedCookie),
        '403 module_disabled',
      )
      const language = await createInstitution(app, { type: 'language_school' })
      const languageCookie = await signInAs(app, language.admin)
      assert.equal(
        await outcome(countsUrl('guidanceCases', 'groupBy=status'), languageCookie),
        '404 not_found',
      )
    })
  })

  describe('bağlı adla arama ve sıralama', () => {
    const q = (text: string) => `q=${encodeURIComponent(text)}`
    const invoicesOf = (...students: string[]) =>
      [...PAID_SAMPLE.map((row) => row.data), ...EXTRA_INVOICES]
        .filter((row) => students.includes(String(row.studentId)))
        .map((row) => String(row.id))
    const listed = (collection: string, query: string) =>
      `/api/v1/collections/${collection}?pageSize=100&${query}`

    /**
     * Selin Kaya (`t1`, Kadıköy) Beşiktaş kampüsündeki bir sınıfta da ders verir: sınıfı görür,
     * kampüsünü (b2) okuyamaz. Kampüs adıyla arama ve sıralama bu kampüsü kullanmamalı.
     */
    async function withOtherCampusClass() {
      const created = await institution()
      await insertMissingRecords(
        db,
        created.id,
        [
          {
            collection: 'classes',
            id: 'test-c-b2',
            data: {
              id: 'test-c-b2',
              name: 'Test-B2',
              grade: 7,
              section: 'B',
              level: '7. Sınıf',
              branchId: 'b2',
              teacherId: 'test-t-b2',
              capacity: 20,
            },
          },
          {
            collection: 'assignments',
            id: 'test-a-b2',
            data: { id: 'test-a-b2', classId: 'test-c-b2', teacherId: 't1', subjectId: 'math' },
          },
        ],
        FIXED_NOW,
      )
      return created
    }

    test('sınıf listesinde kampüs adı; taksit, not ve yoklamada öğrenci adı, numarası, sınıf adı', async () => {
      const { adminCookie } = await withOtherCampusClass()
      assert.deepEqual(await ids(adminCookie, listed('classes', q('kadıköy kampüsü'))), [
        'c1',
        'c2',
        'c3',
      ])
      assert.deepEqual(await ids(adminCookie, listed('classes', q('BEŞİKTAŞ'))), ['test-c-b2'])
      // Öğrenci adı (Türkçe duyarsız), okul numarası ve öğrencinin sınıfının adı.
      assert.deepEqual(
        await ids(adminCookie, listed('invoices', q('deniz yilmaz'))),
        invoicesOf('s1'),
      )
      assert.deepEqual(
        await ids(adminCookie, listed('invoices', q('Yılmaz'))),
        invoicesOf('s1', 's2'),
      )
      assert.deepEqual(await ids(adminCookie, listed('invoices', q('2026011'))), invoicesOf('s11'))
      assert.deepEqual(await ids(adminCookie, listed('invoices', q('5-A'))), invoicesOf('s2'))
      // Kendi alanında arama sürer; bağlı alan ve süzgeç birlikte.
      assert.deepEqual(await ids(adminCookie, listed('invoices', q('test-inv-late'))), [
        'test-inv-late-s1',
        'test-inv-late-s11',
      ])
      assert.deepEqual(
        await ids(adminCookie, listed('invoices', `${q('Yılmaz')}&${status('Gecikmiş')}`)),
        ['test-inv-late-s1'],
      )
      const grades = (SAMPLE.grades ?? [])
        .filter((row) => row.studentId === 's2')
        .map((row) => String(row.id))
      assert.deepEqual(await ids(adminCookie, listed('grades', q('Ece'))), grades)
      // Yoklamada sınıf adı kaydın kendi sınıfından.
      const attendance = (SAMPLE.attendance ?? [])
        .filter((row) => row.classId === 'c3')
        .map((row) => String(row.id))
      assert.deepEqual(await ids(adminCookie, listed('attendance', q('6-A'))), attendance)
      // Sayım ucu aynı aramayı kullanır.
      const counted = await get(
        `/api/v1/collections/invoices/counts?groupBy=studentId&${q('Yılmaz')}`,
        adminCookie,
      )
      assert.deepEqual(
        counted.json().data.map((group: { value: string }) => group.value),
        ['s1', 's2'],
      )
    })

    test('bağlı alanla sıralama: öğrenci adı, kampüs adı; eşitlikte depo sırası', async () => {
      const { adminCookie } = await withOtherCampusClass()
      const collator = new Intl.Collator('tr-TR', { numeric: true })
      const name = (id: string) => SEED.students.find((item) => item.id === id)?.name ?? ''
      const all = invoicesOf('s1', 's2', 's11')
      const stored = await ids(adminCookie, listed('invoices', ''))
      const byName = [...all].sort((a, b) => {
        const studentOf = (id: string) => {
          const row = [...PAID_SAMPLE.map((item) => item.data), ...EXTRA_INVOICES].find(
            (item) => item.id === id,
          )
          return String(row?.studentId)
        }
        return (
          collator.compare(name(studentOf(a)), name(studentOf(b))) ||
          stored.indexOf(a) - stored.indexOf(b)
        )
      })
      assert.deepEqual(await ids(adminCookie, listed('invoices', 'sort=studentName')), byName)
      const descending = await ids(adminCookie, listed('invoices', 'sort=-studentName,dueDate'))
      assert.deepEqual(descending.slice(0, invoicesOf('s2').length).sort(), invoicesOf('s2').sort())
      assert.deepEqual(await ids(adminCookie, listed('classes', 'sort=-branchName,id')), [
        'c1',
        'c2',
        'c3',
        'test-c-b2',
      ])
      // Beşiktaş < Kadıköy (tr-TR).
      assert.deepEqual(await ids(adminCookie, listed('classes', 'sort=branchName')), [
        'test-c-b2',
        'c1',
        'c2',
        'c3',
      ])
      // Öğrencinin sınıfı örnek kesitte yoksa sınıf adı boştur: sıralamada sona düşer.
      const byClass = await ids(adminCookie, listed('invoices', 'sort=className'))
      assert.deepEqual(byClass.slice(-invoicesOf('s11').length).sort(), invoicesOf('s11').sort())
      // Bağlı alanı olmayan listede veya başka listenin bağlı alanıyla sıralama 400.
      for (const url of [
        listed('students', 'sort=studentName'),
        listed('invoices', 'sort=branchName'),
        listed('branches', 'sort=className'),
      ]) {
        const response = await get(url, adminCookie)
        assert.equal(response.statusCode, 400, url)
        assert.deepEqual(response.json().issues[0].path, ['sort'])
      }
    })

    test('DOM-YTK-022/025: kapsam dışı bağlı kaydın adı eşleşme ve sıra üretmez', async () => {
      const { id, adminCookie } = await withOtherCampusClass()
      const teacher = await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
      // Öğretmen sınıfı görür, kampüsünü okuyamaz: kampüs adıyla bulunmaz, sıralamada sondadır.
      assert.ok((await ids(teacher, listed('classes', ''))).includes('test-c-b2'))
      assert.deepEqual(await ids(teacher, listed('classes', q('Beşiktaş'))), [])
      assert.deepEqual(
        (await ids(teacher, listed('classes', 'sort=-branchName'))).at(-1),
        'test-c-b2',
      )
      assert.deepEqual(await ids(teacher, listed('classes', q('Kadıköy'))), ['c1', 'c2', 'c3'])
      // Veli bağlı olmayan çocuğun adı, numarası ve sınıfıyla taksit bulamaz; yönetici bulur.
      const parent = await memberCookie(id, 'veli', [
        { kind: 'child', recordId: 's1' },
        { kind: 'child', recordId: 's2' },
      ])
      for (const text of ['Duru Aksoy', '2026011']) {
        assert.deepEqual(await ids(parent, listed('invoices', q(text))), [], text)
        assert.deepEqual(
          await ids(adminCookie, listed('invoices', q(text))),
          invoicesOf('s11'),
          text,
        )
        const counted = await get(
          `/api/v1/collections/invoices/counts?groupBy=status&${q(text)}`,
          parent,
        )
        assert.deepEqual(counted.json().meta, { total: 0 })
      }
      assert.deepEqual(await ids(parent, listed('invoices', q('Yılmaz'))), invoicesOf('s1', 's2'))
      // Öğrenci yalnız kendini görür: kardeşinin adıyla not bulunmaz.
      const student = await memberCookie(id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])
      assert.deepEqual(await ids(student, listed('grades', q('Ece'))), [])
      // Branş öğretmeni (Türkçe) kapsamındaki öğrencinin adıyla yalnız kendi dersini bulur.
      const branch = await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't2' }])
      const turkish = (SAMPLE.grades ?? [])
        .filter((row) => row.studentId === 's1' && row.subjectId === 'turkish')
        .map((row) => String(row.id))
      assert.deepEqual(await ids(branch, listed('grades', q('Deniz'))), turkish)
    })
  })

  describe('SQL sayfalaması (koleksiyonun tamamını okuyan rol)', () => {
    const JUNK = [
      {},
      {
        id: 'test-x',
        studentId: 'test-x',
        studentIds: ['test-x'],
        classId: 'test-x',
        branchId: 'test-x',
        teacherId: 'test-x',
        clubId: 'test-x',
        level: 'test-x',
        grade: -1,
        audience: 'test-x',
      },
    ]

    test('yönetici ve ön büro okuyabildikleri her koleksiyonda her satırı okur (core kuralı `all`)', async () => {
      const { id, admin, adminMembershipId } = await institution()
      const frontOffice = await createMember(app, id, 'onburo')
      const actors = [
        { userId: admin.id, role: 'yonetici' as const, membershipId: adminMembershipId },
        { userId: frontOffice.id, role: 'onburo' as const, membershipId: frontOffice.membershipId },
      ]
      for (const actor of actors) {
        const scope = await readScope({
          db,
          institutionId: id,
          actor,
          now: FIXED_NOW,
          log: app.log,
        })
        let readable = 0
        for (const collection of READABLE_COLLECTIONS) {
          assert.equal(readsWholeCollection(scope, collection), scope.access(collection).allowed)
          if (!scope.access(collection).allowed) continue
          readable += 1
          for (const row of JUNK)
            assert.equal(scope.canRead(collection, row), true, `${actor.role} ${collection}`)
        }
        assert.ok(readable >= 10, actor.role)
      }
      // Kişisel kapsamlı roller bütün koleksiyonu okumaz.
      const parent = await createMember(app, id, 'veli', [{ kind: 'child', recordId: 's1' }])
      const parentScope = await readScope({
        db,
        institutionId: id,
        actor: { userId: parent.id, role: 'veli', membershipId: parent.membershipId },
        now: FIXED_NOW,
        log: app.log,
      })
      assert.equal(readsWholeCollection(parentScope, 'invoices'), false)
    })

    test('süzgeçsiz liste SQL sayfasıyla bellek yoluyla aynı sayfa ve toplamı verir; ayıklama korunur', async () => {
      const { id, adminCookie } = await institution()
      const frontOffice = await memberCookie(id, 'onburo')
      // `q` ve `sort=id` bellek yolunu kullanır; süzgeçsiz istek SQL sayfasını.
      for (const [cookie, collection] of [
        [adminCookie, 'invoices'],
        [adminCookie, 'guidanceCases'],
        [frontOffice, 'students'],
      ] as const) {
        const memory = await ids(cookie, `/api/v1/collections/${collection}?pageSize=100&sort=id`)
        for (const pageSize of [1, 2, 5]) {
          const pages: string[] = []
          for (let page = 1; page <= Math.ceil(memory.length / pageSize) + 1; page += 1) {
            const response = await get(
              `/api/v1/collections/${collection}?pageSize=${pageSize}&page=${page}`,
              cookie,
            )
            assert.equal(response.statusCode, 200)
            assert.equal(response.json().meta.total, memory.length, `${collection} ${page}`)
            pages.push(...response.json().data.map((item: { id: string }) => item.id))
          }
          assert.deepEqual([...pages].sort(), [...memory].sort(), `${collection} ${pageSize}`)
        }
      }
      // Ayıklama SQL sayfasında da: ön büro `progress`, yönetici rehberlik iç notunu görmez.
      const students = (await get('/api/v1/collections/students?pageSize=3', frontOffice)).json()
      for (const item of students.data) assert.equal('progress' in item.record, false)
      const cases = (await get('/api/v1/collections/guidanceCases?pageSize=3', adminCookie)).json()
      assert.ok(cases.data.length > 0)
      for (const item of cases.data) {
        assert.equal('internalNote' in item.record, false)
        assert.equal('notes' in item.record, false)
      }
    })

    test('arşiv kipleri SQL sayfasında da geçerli; başka kurum satırı sayılmaz', async () => {
      const { id, adminCookie } = await institution()
      await writeRecords(
        db,
        id,
        [{ kind: 'archive', collection: 'branches', id: 'b2', expectedVersion: 1 }],
        FIXED_NOW,
      )
      const page = async (query: string) =>
        (await get(`/api/v1/collections/branches?${query}`, adminCookie)).json()
      assert.deepEqual(
        (await page('')).data.map((item: { id: string }) => item.id),
        ['b1'],
      )
      assert.deepEqual((await page('')).meta.total, 1)
      assert.deepEqual(
        (await page('archived=only')).data.map((item: { id: string }) => item.id),
        ['b2'],
      )
      assert.deepEqual((await page('archived=include')).meta.total, 2)
      const other = await createInstitution(app)
      const otherCookie = await signInAs(app, other.admin)
      assert.deepEqual(
        (await get('/api/v1/collections/branches?archived=include', otherCookie)).json().meta,
        { page: 1, pageSize: 25, total: 0 },
      )
    })
  })
})
