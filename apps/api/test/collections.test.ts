import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { asc, eq } from 'drizzle-orm'

import { ALWAYS_ON, COLLECTION_MODULES } from '@kampus/school-core/modules/collection-modules.ts'

import type { App } from '../src/app.ts'
import { ROLES, type Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { RECORD_COLLECTIONS } from '../src/db/collections.ts'
import { insertMissingRecords, writeRecords } from '../src/db/records.ts'
import { records } from '../src/db/schema/records.ts'
import { moduleOfCollection, READABLE_COLLECTIONS } from '../src/services/collection-access.ts'
import { parseSort, searchKey } from '../src/services/collection-reads.ts'
import { ensureMembershipLinks } from '../src/services/identity.ts'
import { readScope } from '../src/services/read-scope.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  type InstitutionOverrides,
} from './support/app.ts'
import { ofStudents, SAMPLE, sampleIds, sampleRows, SEED } from './support/collections-sample.ts'

const LATER = new Date('2026-10-06T10:00:00.000Z')
describe('koleksiyon okuma uçları', () => {
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

  /** Örnek kesitle kurulmuş kurum ve yöneticisinin oturumu. */
  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, sampleRows(), FIXED_NOW)
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

  function rowsOf(institutionId: string) {
    return db
      .select()
      .from(records)
      .where(eq(records.institutionId, institutionId))
      .orderBy(asc(records.collection), asc(records.id))
  }

  test('modül eşlemesi core kaydındandır; denetim listesi, yazışmalar ve bildirimler genel okumaya kapalı', () => {
    for (const collection of RECORD_COLLECTIONS)
      assert.equal(
        moduleOfCollection(collection) ?? ALWAYS_ON,
        COLLECTION_MODULES[collection],
        collection,
      )
    assert.equal(READABLE_COLLECTIONS.includes('audit'), false)
    assert.equal(READABLE_COLLECTIONS.includes('conversations'), false)
    assert.equal(READABLE_COLLECTIONS.includes('conversationMessages'), false)
    // Bildirimler ve okundu kayıtları yalnız bildirim uçlarından okunur (F6a, DOM-ILT-073).
    assert.equal(READABLE_COLLECTIONS.includes('notifications'), false)
    assert.equal(READABLE_COLLECTIONS.includes('notificationReads'), false)
    assert.equal(READABLE_COLLECTIONS.length, RECORD_COLLECTIONS.length - 5)
  })

  test('sıralama ve arama yardımcıları', () => {
    assert.deepEqual(parseSort('-createdAt,name'), [
      { field: 'createdAt', descending: true },
      { field: 'name', descending: false },
    ])
    assert.deepEqual(parseSort(undefined), [])
    assert.equal(searchKey('IŞIK İnce Çağrı'), 'isik ince cagri')
  })

  test('oturumsuz liste ve tekil istek 401 döner', async () => {
    for (const url of ['/api/v1/collections/students', '/api/v1/collections/students/s1']) {
      const response = await get(url)
      assert.equal(response.statusCode, 401, url)
      assert.equal(response.json().code, 'unauthenticated')
    }
  })

  test('bilinmeyen veya açılmamış koleksiyon 404 döner', async () => {
    const { adminCookie } = await institution()
    for (const name of [
      'bilinmeyen',
      'audit',
      'conversations',
      'conversationMessages',
      'constructor',
      '__proto__',
    ]) {
      const list = await get(`/api/v1/collections/${name}`, adminCookie)
      assert.equal(list.statusCode, 404, name)
      assert.equal(list.json().code, 'not_found')
      assert.equal((await get(`/api/v1/collections/${name}/x`, adminCookie)).statusCode, 404)
    }
  })

  test('yönetici listesi kurum kayıtlarını sürüm ve kolon zamanlarıyla döndürür', async () => {
    const { adminCookie } = await institution()

    const response = await get('/api/v1/collections/students', adminCookie)

    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['cache-control'], 'no-store')
    const body = response.json()
    assert.deepEqual(body.meta, { page: 1, pageSize: 25, total: 5 })
    // Varsayılan sıra deponun sırasıdır: core dizisinin sırası (`position`), kimlik değil.
    assert.deepEqual(
      body.data.map((item: { id: string }) => item.id),
      ['s1', 's2', 's3', 's11', 's12'],
    )
    const first = body.data[0]
    assert.equal(first.version, 1)
    assert.equal(first.createdAt, FIXED_NOW.toISOString())
    assert.equal(first.updatedAt, FIXED_NOW.toISOString())
    assert.equal(first.archivedAt, null)
    assert.equal(first.record.name, 'Deniz Yılmaz')
    assert.equal(first.record.progress, SEED.students[0]?.progress)
  })

  test('tekil kayıt döner; güncellemeden sonra yeni sürüm görünür', async () => {
    const { id, adminCookie } = await institution()
    const before = (await get('/api/v1/collections/students/s1', adminCookie)).json().data
    assert.equal(before.version, 1)

    await writeRecords(
      db,
      id,
      [
        {
          kind: 'update',
          collection: 'students',
          id: 's1',
          data: { ...before.record, progress: 60 },
          expectedVersion: 1,
        },
      ],
      LATER,
    )

    const after = (await get('/api/v1/collections/students/s1', adminCookie)).json().data
    assert.equal(after.version, 2)
    assert.equal(after.record.progress, 60)
    assert.equal(after.createdAt, FIXED_NOW.toISOString())
    assert.equal(after.updatedAt, LATER.toISOString())
  })

  test('DOM-YTK-011: başka kurumun kaydı listede yok, tekil istekte 404 ve kayıt değişmez', async () => {
    const a = await institution()
    const b = await createInstitution(app)
    await insertMissingRecords(
      db,
      b.id,
      [{ collection: 'students', id: 'test-b-ogr', data: { id: 'test-b-ogr', name: 'B Öğrenci' } }],
      FIXED_NOW,
    )
    const before = await rowsOf(b.id)

    const list = (await get('/api/v1/collections/students?pageSize=100', a.adminCookie)).json()
    assert.equal(
      list.data.some((item: { id: string }) => item.id === 'test-b-ogr'),
      false,
    )
    const single = await get('/api/v1/collections/students/test-b-ogr', a.adminCookie)
    assert.equal(single.statusCode, 404)
    assert.equal(single.json().code, 'not_found')
    assert.deepEqual(await rowsOf(b.id), before)
  })

  test('DOM-YTK-010: sorgudaki kurum kimliği kabul edilmez (400)', async () => {
    const a = await institution()
    const b = await createInstitution(app)
    const response = await get(
      `/api/v1/collections/students?institutionId=${encodeURIComponent(b.id)}`,
      a.adminCookie,
    )
    assert.equal(response.statusCode, 400)
    assert.equal(response.json().code, 'validation_failed')
  })

  test('sayfalama sınırları: pageSize ≤ 100, page ≥ 1, son sayfadan sonrası boş', async () => {
    const { adminCookie } = await institution()

    const second = (await get('/api/v1/collections/students?page=2&pageSize=2', adminCookie)).json()
    assert.deepEqual(second.meta, { page: 2, pageSize: 2, total: 5 })
    assert.deepEqual(
      second.data.map((item: { id: string }) => item.id),
      ['s3', 's11'],
    )
    const beyond = (await get('/api/v1/collections/students?page=9&pageSize=2', adminCookie)).json()
    assert.deepEqual(beyond.data, [])
    assert.equal(beyond.meta.total, 5)
    assert.equal(
      (await get('/api/v1/collections/students?pageSize=100', adminCookie)).statusCode,
      200,
    )
    for (const query of ['pageSize=101', 'pageSize=0', 'page=0', 'page=abc', 'bilinmeyen=1']) {
      const response = await get(`/api/v1/collections/students?${query}`, adminCookie)
      assert.equal(response.statusCode, 400, query)
      assert.equal(response.json().code, 'validation_failed')
    }
  })

  test('filtre, Türkçe duyarsız arama ve sıralama', async () => {
    const { adminCookie } = await institution()
    const ids = async (query: string) => {
      const response = await get(`/api/v1/collections/students?${query}`, adminCookie)
      assert.equal(response.statusCode, 200, query)
      return response.json().data.map((item: { id: string }) => item.id)
    }
    const classOf = (id: string) => SEED.students.find((item) => item.id === id)?.classId

    assert.deepEqual(
      await ids('classId=c1'),
      ['s1', 's2', 's3', 's11', 's12'].filter((id) => classOf(id) === 'c1'),
    )
    assert.deepEqual(await ids('classId=c1&classId=c2'), ['s1', 's2'])
    assert.deepEqual(await ids('q=DENİZ%20YILMAZ'), ['s1'])
    assert.deepEqual(await ids('q=deniz%20yilmaz'), ['s1'])
    const names = SEED.students
      .filter((item) => ['s1', 's2', 's3', 's11', 's12'].includes(item.id))
      .map((item) => ({ id: item.id, name: item.name }))
      .sort((left, right) => new Intl.Collator('tr-TR').compare(right.name, left.name))
    assert.deepEqual(
      await ids('sort=-name'),
      names.map((item) => item.id),
    )
    for (const query of ['q=a', 'sort=bilinmeyen', 'sort=name,,id', 'sort=a,b,c,d']) {
      const response = await get(`/api/v1/collections/students?${query}`, adminCookie)
      assert.equal(response.statusCode, 400, query)
    }
  })

  test('isActive süzgeci: kampüs/sınıf arşivi (isActive: false) ayrı listelenir; alanı olmayan etkindir', async () => {
    const { id, adminCookie } = await institution()
    const c2 = SAMPLE.classes?.find((item) => item.id === 'c2')
    assert.ok(c2)
    await writeRecords(
      db,
      id,
      [
        {
          kind: 'update',
          collection: 'classes',
          id: 'c2',
          data: { ...c2, isActive: false, deletedAt: LATER.toISOString() },
          expectedVersion: 1,
        },
        {
          kind: 'insert',
          collection: 'classes',
          id: 'test-c-alansiz',
          data: { id: 'test-c-alansiz' },
        },
      ],
      LATER,
    )
    const ids = async (query: string) => {
      const response = await get(`/api/v1/collections/classes?${query}`, adminCookie)
      assert.equal(response.statusCode, 200, query)
      return response.json().data.map((item: { id: string }) => item.id)
    }
    assert.deepEqual(await ids('isActive=false'), ['c2'])
    assert.deepEqual(await ids('isActive=true'), ['c1', 'c3', 'test-c-alansiz'])
    assert.deepEqual(await ids(''), ['c1', 'c2', 'c3', 'test-c-alansiz'])
    assert.deepEqual(await ids('isActive=true&q=5-A'), [])
    for (const query of ['isActive=yes', 'isActive=1', 'isActive=true&isActive=false']) {
      const response = await get(`/api/v1/collections/classes?${query}`, adminCookie)
      assert.equal(response.statusCode, 400, query)
    }
  })

  test('dateFrom/dateTo: yoklama Europe/Istanbul gününe göre süzülür, iki uç dahil', async () => {
    const { id, adminCookie } = await institution()
    const mark = (key: string, date: string) => ({
      collection: 'attendance' as const,
      id: key,
      data: { id: key, studentId: 's1', classId: 'c1', date, status: 'present' },
    })
    await insertMissingRecords(
      db,
      id,
      [
        mark('test-att-a', '2026-10-05T20:59:59.999Z'),
        mark('test-att-b', '2026-10-05T21:00:00.000Z'),
        mark('test-att-c', '2026-10-06T09:00:00.000Z'),
        mark('test-att-d', '2026-10-06T21:00:00.000Z'),
      ],
      FIXED_NOW,
    )
    const ids = async (query: string) => {
      const response = await get(
        `/api/v1/collections/attendance?pageSize=100&${query}`,
        adminCookie,
      )
      assert.equal(response.statusCode, 200, query)
      return response.json().data.map((item: { id: string }) => item.id)
    }
    assert.deepEqual(await ids('dateFrom=2026-10-06&dateTo=2026-10-06'), [
      'test-att-b',
      'test-att-c',
    ])
    assert.deepEqual(await ids('dateFrom=2026-10-06'), ['test-att-b', 'test-att-c', 'test-att-d'])
    // Örnek veri yoklamaları geçmiş günlerdedir; bitiş süzgeci onları ve 5 Ekim'i alır.
    const before = await ids('dateTo=2026-10-05&classId=c1')
    assert.ok(before.includes('test-att-a'))
    assert.equal(before.includes('test-att-b'), false)
    assert.equal(
      before.length,
      (SAMPLE.attendance ?? []).filter((row) => row.classId === 'c1').length + 1,
    )
    for (const query of [
      'dateFrom=2026-10-07&dateTo=2026-10-06',
      'dateFrom=2026-02-30',
      'dateTo=6.10.2026',
    ]) {
      const response = await get(`/api/v1/collections/attendance?${query}`, adminCookie)
      assert.equal(response.statusCode, 400, query)
      assert.equal(response.json().code, 'validation_failed')
    }
  })

  test('grades classId süzgeci öğrencinin sınıfından çözülür; kapsam korunur', async () => {
    const { id, adminCookie } = await institution()
    const classOf = (studentId: unknown) =>
      SEED.students.find((item) => item.id === studentId)?.classId
    const ofClass =
      (...classIds: string[]) =>
      (row: Record<string, unknown>) =>
        classIds.includes(classOf(row.studentId) ?? '')

    assert.deepEqual(
      (await list(adminCookie, 'grades', '&classId=c1')).ids,
      sampleIds('grades', ofClass('c1')),
    )
    assert.deepEqual(
      (await list(adminCookie, 'grades', '&classId=c1&classId=c2')).ids,
      sampleIds('grades', ofClass('c1', 'c2')),
    )
    assert.deepEqual((await list(adminCookie, 'grades', '&classId=test-bos')).ids, [])
    // Branş öğretmeni t2 (Türkçe) yalnız kendi dersini görür; sınıf süzgeci kapsamı genişletmez.
    const teacher = await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't2' }])
    const s11Class = classOf('s11') ?? ''
    assert.deepEqual(
      (await list(teacher, 'grades', '&classId=c2')).ids,
      sampleIds('grades', (row) => ofClass('c2')(row) && row.subjectId === 'turkish'),
    )
    assert.deepEqual((await list(teacher, 'grades', `&classId=${s11Class}`)).ids, [])
    const parent = await memberCookie(id, 'veli', [{ kind: 'child', recordId: 's1' }])
    assert.deepEqual((await list(parent, 'grades', '&classId=c2')).ids, [])
    // Kaydında sınıf olan koleksiyonda süzgeç kaydın alanıdır.
    assert.deepEqual(
      (await list(adminCookie, 'attendance', '&classId=c2')).ids,
      sampleIds('attendance', (row) => row.classId === 'c2'),
    )
  })

  test('arşivli kayıt varsayılan olarak dönmez; archived=include/only ile döner', async () => {
    const { id, adminCookie } = await institution()
    await writeRecords(
      db,
      id,
      [{ kind: 'archive', collection: 'students', id: 's3', expectedVersion: 1 }],
      LATER,
    )
    const ids = async (query: string) =>
      (await get(`/api/v1/collections/students?${query}`, adminCookie))
        .json()
        .data.map((item: { id: string }) => item.id)

    assert.deepEqual(await ids(''), ['s1', 's2', 's11', 's12'])
    assert.deepEqual(await ids('archived=include'), ['s1', 's2', 's3', 's11', 's12'])
    assert.deepEqual(await ids('archived=only'), ['s3'])
    assert.equal((await get('/api/v1/collections/students/s3', adminCookie)).statusCode, 404)
    const archived = await get('/api/v1/collections/students/s3?archived=include', adminCookie)
    assert.equal(archived.statusCode, 200)
    assert.equal(archived.json().data.archivedAt, LATER.toISOString())
    assert.equal(archived.json().data.version, 2)
  })

  test('DOM-YTK-040: kapalı modülün koleksiyonu 403 module_disabled; çekirdek kayıtlar açık', async () => {
    const { adminCookie } = await institution({ enabledModules: { guidance: false } })

    for (const url of [
      '/api/v1/collections/guidanceCases',
      '/api/v1/collections/guidanceCases/guidance-s1',
    ]) {
      const response = await get(url, adminCookie)
      assert.equal(response.statusCode, 403, url)
      assert.equal(response.json().code, 'module_disabled')
    }
    assert.equal((await get('/api/v1/collections/studentGoals', adminCookie)).statusCode, 200)
    assert.equal((await get('/api/v1/collections/students', adminCookie)).statusCode, 200)
  })

  test('DOM-YTK-012: dil okulunda kurum türüne uymayan modülün koleksiyonu bulunmaz (404)', async () => {
    const { adminCookie } = await institution({ type: 'language_school' })

    for (const url of [
      '/api/v1/collections/guidanceCases',
      '/api/v1/collections/guidanceCases/guidance-s1',
      '/api/v1/collections/studentGoals',
      '/api/v1/collections/mockExams',
    ]) {
      const response = await get(url, adminCookie)
      assert.equal(response.statusCode, 404, url)
      assert.equal(response.json().code, 'not_found')
    }
    // İki türde de bulunan modül ve çekirdek kayıtlar açıktır.
    assert.equal((await get('/api/v1/collections/mealMenus', adminCookie)).statusCode, 200)
    assert.equal((await get('/api/v1/collections/students', adminCookie)).statusCode, 200)
  })

  test('DOM-YTK-020/DOM-ILT-040: yönetici rehberlik iç notunu görmez ve onunla arayamaz', async () => {
    const { adminCookie } = await institution()
    const guidance = SEED.guidanceCases[0]
    assert.ok(guidance?.internalNote)

    const list = (await get('/api/v1/collections/guidanceCases', adminCookie)).json()
    assert.equal(list.meta.total, SEED.guidanceCases.length)
    for (const item of list.data) {
      assert.equal('internalNote' in item.record, false)
      assert.equal('notes' in item.record, false)
      assert.ok(item.record.sharedNote)
    }
    const single = (
      await get(`/api/v1/collections/guidanceCases/${guidance.id}`, adminCookie)
    ).json().data
    assert.equal('internalNote' in single.record, false)
    const words = guidance.internalNote.split(' ').slice(0, 2).join(' ')
    const search = await get(
      `/api/v1/collections/guidanceCases?q=${encodeURIComponent(words)}`,
      adminCookie,
    )
    assert.equal(search.json().meta.total, 0)
  })

  /** Listenin kimlikleri ve kayıtları (tek sayfa yeter: kesit 100 satırdan küçük). */
  async function list(cookie: string, collection: string, query = '') {
    const response = await get(`/api/v1/collections/${collection}?pageSize=100${query}`, cookie)
    assert.equal(response.statusCode, 200, `${collection}${query}`)
    const body = response.json()
    const items: { id: string; record: Record<string, unknown> }[] = body.data
    assert.equal(body.meta.total, items.length, collection)
    return { ids: items.map((item) => item.id), records: items.map((item) => item.record) }
  }

  async function status(cookie: string, url: string) {
    const response = await get(url, cookie)
    return `${response.statusCode} ${response.json().code ?? 'ok'}`
  }

  const internalWords = () =>
    encodeURIComponent(SEED.guidanceCases[0]?.internalNote.split(' ').slice(0, 2).join(' ') ?? '')

  test('DOM-YTK-020: yönetici kurumun bütün kişisel koleksiyonlarını okur', async () => {
    const { adminCookie } = await institution()

    assert.deepEqual((await list(adminCookie, 'students')).ids, sampleIds('students'))
    for (const collection of ['grades', 'attendance', 'invoices', 'guidanceCases'] as const)
      assert.deepEqual((await list(adminCookie, collection)).ids, sampleIds(collection), collection)
  })

  test('DOM-YTK-021: ön büro idari kayıtları görür, akademik alan ve koleksiyonları görmez', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'onburo')

    const students = await list(cookie, 'students')
    assert.deepEqual(students.ids, sampleIds('students'))
    for (const record of students.records) {
      assert.equal('progress' in record, false)
      assert.ok(record.name)
    }
    assert.deepEqual((await list(cookie, 'invoices')).ids, sampleIds('invoices'))
    assert.equal((await get('/api/v1/collections/students?sort=-name', cookie)).statusCode, 200)
    assert.equal((await get('/api/v1/collections/classes', cookie)).statusCode, 200)
    // Gizli alanla arama sonuç vermez: yalnız `progress` değeri olan öğrenci bulunmaz.
    const progress = String(SEED.students[0]?.progress)
    assert.equal((await list(cookie, 'students', `&q=${progress}`)).ids.includes('s1'), false)
    for (const name of ['grades', 'attendance', 'guidanceCases', 'studentGoals', 'teachers']) {
      assert.equal(await status(cookie, `/api/v1/collections/${name}`), '403 forbidden', name)
      assert.equal(await status(cookie, `/api/v1/collections/${name}/x`), '403 forbidden', name)
    }
  })

  test('DOM-YTK-022/026: rehber ve rehberlik görevli öğretmen şubesinin bütün notlarını ve iç notları görür', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])

    assert.deepEqual((await list(cookie, 'students')).ids, ['s1', 's2', 's3'])
    // Sınıf rehber öğretmeni şubesindeki öğrencilerin bütün derslerini okur (Türkçe dahil).
    assert.deepEqual(
      (await list(cookie, 'grades')).ids,
      sampleIds('grades', ofStudents('s1', 's2')),
    )
    assert.deepEqual(
      (await list(cookie, 'attendance')).ids,
      sampleIds('attendance', ofStudents('s1', 's2')),
    )
    const guidance = await list(cookie, 'guidanceCases')
    assert.deepEqual(guidance.ids, sampleIds('guidanceCases'))
    for (const record of guidance.records) assert.ok(record.internalNote)
    assert.deepEqual((await list(cookie, 'guidanceCases', `&q=${internalWords()}`)).ids, [
      'guidance-s1',
    ])
    assert.equal(await status(cookie, '/api/v1/collections/students/s11'), '404 not_found')
    assert.equal(await status(cookie, '/api/v1/collections/invoices'), '403 forbidden')
    // Yemek modülünün core rol listesinde öğretmen yok.
    assert.equal(await status(cookie, '/api/v1/collections/mealMenus'), '403 forbidden')
  })

  test('DOM-YTK-022/ILT-040: branş öğretmeni kendi dersini görür; iç notu görmez ve onunla arayamaz', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't2' }])

    assert.deepEqual((await list(cookie, 'students')).ids, ['s1', 's2', 's3'])
    assert.deepEqual(
      (await list(cookie, 'grades')).ids,
      sampleIds('grades', (row) => ofStudents('s1', 's2')(row) && row.subjectId === 'turkish'),
    )
    assert.equal(await status(cookie, '/api/v1/collections/grades/g-s1-0-0'), '404 not_found')
    const guidance = await list(cookie, 'guidanceCases')
    assert.deepEqual(guidance.ids, sampleIds('guidanceCases'))
    for (const record of guidance.records) {
      assert.equal('internalNote' in record, false)
      assert.equal('notes' in record, false)
      assert.ok(record.sharedNote)
    }
    assert.deepEqual((await list(cookie, 'guidanceCases', `&q=${internalWords()}`)).ids, [])
    const detail = (await get('/api/v1/collections/guidanceCases/guidance-s1', cookie)).json()
    assert.equal('internalNote' in detail.data.record, false)
  })

  test('DOM-YTK-022: bağlantısı olmayan öğretmenin kapsamı boştur', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'ogretmen')

    for (const collection of ['students', 'grades', 'attendance', 'guidanceCases'])
      assert.deepEqual((await list(cookie, collection)).ids, [], collection)
    assert.equal(await status(cookie, '/api/v1/collections/students/s1'), '404 not_found')
    assert.equal((await list(cookie, 'subjects')).ids.length, 3)
  })

  test('DOM-YTK-024: öğrenci yalnız kendi kayıtlarını ve ödemelerini görür', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])

    assert.deepEqual((await list(cookie, 'students')).ids, ['s1'])
    for (const collection of ['grades', 'attendance', 'invoices', 'guidanceCases'] as const)
      assert.deepEqual(
        (await list(cookie, collection)).ids,
        sampleIds(collection, ofStudents('s1')),
        collection,
      )
    const guidance = await list(cookie, 'guidanceCases')
    assert.equal('internalNote' in (guidance.records[0] ?? {}), false)
    assert.equal((await get('/api/v1/collections/students/s1', cookie)).statusCode, 200)
    for (const url of [
      '/api/v1/collections/students/s2',
      '/api/v1/collections/guidanceCases/guidance-s2',
      `/api/v1/collections/invoices/${sampleIds('invoices', ofStudents('s2'))[0]}`,
    ])
      assert.equal(await status(cookie, url), '404 not_found', url)
    assert.equal((await list(cookie, 'mealMenus')).ids.length, 2)
  })

  test('DOM-YTK-025: iki çocuklu veli iki çocuğunu görür; bağlı olmayan çocuk 404 ve aramada yok', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'veli', [
      { kind: 'child', recordId: 's1' },
      { kind: 'child', recordId: 's2' },
    ])

    assert.deepEqual((await list(cookie, 'students')).ids, ['s1', 's2'])
    for (const collection of ['grades', 'attendance', 'invoices', 'guidanceCases'] as const)
      assert.deepEqual(
        (await list(cookie, collection)).ids,
        sampleIds(collection, ofStudents('s1', 's2')),
        collection,
      )
    for (const record of (await list(cookie, 'guidanceCases')).records)
      assert.equal('internalNote' in record, false)
    assert.deepEqual((await list(cookie, 'parents')).ids, ['p1'])
    assert.equal((await get('/api/v1/collections/students/s2', cookie)).statusCode, 200)
    for (const url of [
      '/api/v1/collections/students/s11',
      `/api/v1/collections/grades/${sampleIds('grades', ofStudents('s11'))[0]}`,
      `/api/v1/collections/invoices/${sampleIds('invoices', ofStudents('s11'))[0]}`,
      '/api/v1/collections/students/test-yok',
    ])
      assert.equal(await status(cookie, url), '404 not_found', url)
    // Bağlı olmayan çocuğun adı, kimliği veya kayıtları arama ve filtreyle de bulunmaz.
    const other = SEED.students.find((item) => item.id === 's11')
    assert.ok(other)
    const byName = await list(cookie, 'students', `&q=${encodeURIComponent(other.name)}`)
    assert.deepEqual(byName.ids, [])
    assert.deepEqual((await list(cookie, 'grades', '&studentId=s11')).ids, [])
    assert.deepEqual((await list(cookie, 'invoices', '&q=s11')).ids, [])
  })

  test('DOM-YTK-040: kapalı modül öğretmen, öğrenci ve velide de 403 module_disabled', async () => {
    const { id } = await institution({ enabledModules: { guidance: false, finance: false } })
    const cookies = [
      await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }]),
      await memberCookie(id, 'ogrenci', [{ kind: 'student', recordId: 's1' }]),
      await memberCookie(id, 'veli', [{ kind: 'child', recordId: 's1' }]),
    ]
    for (const cookie of cookies) {
      for (const url of [
        '/api/v1/collections/guidanceCases',
        '/api/v1/collections/guidanceCases/guidance-s1',
      ])
        assert.equal(await status(cookie, url), '403 module_disabled', url)
      assert.equal((await get('/api/v1/collections/students', cookie)).statusCode, 200)
    }
    const parent = cookies[2] ?? ''
    assert.equal(await status(parent, '/api/v1/collections/invoices'), '403 module_disabled')
  })

  test('DOM-YTK-012: dil okulunda öğretmen ve velide de okul türü modülü bulunmaz', async () => {
    const { id } = await institution({ type: 'language_school' })
    const teacher = await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
    const parent = await memberCookie(id, 'veli', [{ kind: 'child', recordId: 's1' }])

    for (const cookie of [teacher, parent]) {
      assert.equal(await status(cookie, '/api/v1/collections/guidanceCases'), '404 not_found')
      assert.equal(await status(cookie, '/api/v1/collections/studentGoals'), '404 not_found')
    }
    const grades = await list(teacher, 'grades')
    assert.deepEqual(grades.ids, sampleIds('grades', ofStudents('s1', 's2')))
    const invoices = await list(parent, 'invoices')
    assert.deepEqual(invoices.ids, sampleIds('invoices', ofStudents('s1')))
  })

  test('kapsam dışı kayıt ile olmayan kayıt aynı yanıtı alır: varlık sızdırılmaz', async () => {
    const { id } = await institution()
    for (const role of ROLES.filter((item) => item !== 'yonetici')) {
      const cookie = await memberCookie(id, role)
      const existing = await get('/api/v1/collections/grades/g-s1-0-0', cookie)
      const missing = await get('/api/v1/collections/grades/test-yok', cookie)
      // Ön büro notları hiç okuyamaz (403); bağlantısız diğer rollerin kapsamı boştur (404).
      assert.equal(existing.statusCode, role === 'onburo' ? 403 : 404, role)
      assert.equal(missing.statusCode, existing.statusCode, role)
      assert.equal(missing.json().code, existing.json().code, role)
    }
  })

  test('kapsam istek başına hesaplanır: aynı istekte bir kez, yeni bağlantı sonraki istekte geçerli', async () => {
    const { id } = await institution()
    const parent = await createMember(app, id, 'veli', [{ kind: 'child', recordId: 's1' }])
    const cookie = await signInAs(app, parent)
    const ctx = {
      db,
      institutionId: id,
      actor: { userId: parent.id, role: 'veli' as const, membershipId: parent.membershipId },
      now: FIXED_NOW,
      log: app.log,
    }
    const first = readScope(ctx)
    assert.equal(readScope(ctx), first)
    assert.notEqual(readScope({ ...ctx }), first)
    assert.deepEqual([...(await first).studentIds], ['s1'])

    assert.deepEqual((await list(cookie, 'students')).ids, ['s1'])
    await ensureMembershipLinks(db, id, parent.membershipId, [{ kind: 'child', recordId: 's2' }])
    assert.deepEqual((await list(cookie, 'students')).ids, ['s1', 's2'])
  })

  test('arşivlenen öğretmen kaydı ve türü bozuk kaynak satırı kapsam vermez', async () => {
    const { id } = await institution()
    await insertMissingRecords(
      db,
      id,
      [{ collection: 'students', id: 'test-bozuk', data: { id: 'test-bozuk', classId: 7 } }],
      FIXED_NOW,
    )
    const teacher = await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't2' }])
    const parent = await memberCookie(id, 'veli', [{ kind: 'child', recordId: 'test-bozuk' }])
    assert.equal((await list(teacher, 'students')).ids.length, 3)

    await writeRecords(
      db,
      id,
      [{ kind: 'archive', collection: 'teachers', id: 't2', expectedVersion: 1 }],
      LATER,
    )
    assert.deepEqual((await list(teacher, 'students')).ids, [])
    assert.deepEqual((await list(teacher, 'grades')).ids, [])
    assert.deepEqual((await list(parent, 'students')).ids, [])
    assert.equal(await status(parent, '/api/v1/collections/students/test-bozuk'), '404 not_found')
  })

  test('liste ve tekil okuma logu kişisel veri ve arama metni taşımaz', async () => {
    const logs: string[] = []
    const logged = await buildTestApp(db, { logs })
    try {
      const created = await createInstitution(logged)
      await insertMissingRecords(db, created.id, sampleRows(), FIXED_NOW)
      const cookie = await signInAs(logged, created.admin)
      logs.length = 0
      const list = await logged.inject({
        method: 'GET',
        url: '/api/v1/collections/students?q=Deniz',
        headers: { cookie },
      })
      assert.equal(list.statusCode, 200)
      const single = await logged.inject({
        method: 'GET',
        url: '/api/v1/collections/students/s1',
        headers: { cookie },
      })
      assert.equal(single.statusCode, 200)
      const text = logs.join('')
      assert.ok(text.includes('/api/v1/collections/students'))
      for (const secret of [
        'Deniz',
        'Yılmaz',
        'ogrenci1@',
        '05550100001',
        'q=',
        created.admin.email,
      ])
        assert.equal(text.includes(secret), false, secret)
    } finally {
      await logged.close()
    }
  })
})
