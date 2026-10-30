import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { asc, eq } from 'drizzle-orm'

import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import { ALWAYS_ON, COLLECTION_MODULES } from '@kampus/school-core/modules/collection-modules.ts'
import { schoolModules } from '@kampus/school-core/modules/school-workflows.ts'

import type { App } from '../src/app.ts'
import { ROLES, type Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { RECORD_COLLECTIONS, recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords, writeRecords } from '../src/db/records.ts'
import { records } from '../src/db/schema/records.ts'
import {
  collectionAccessTable,
  moduleOfCollection,
  READABLE_COLLECTIONS,
} from '../src/services/collection-access.ts'
import { parseSort, searchKey } from '../src/services/collection-reads.ts'
import { isModuleKey } from '../src/services/modules.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  type InstitutionOverrides,
} from './support/app.ts'

const LATER = new Date('2026-10-06T10:00:00.000Z')
const SEED: State = createSeed(FIXED_NOW)

/** Örnek veriden küçük, tutarlı bir kesit: iki sınıf, beş öğrenci, bağlı kayıtlar. */
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  subjects: SEED.subjects.slice(0, 3),
  classes: SEED.classes.filter((item) => ['c1', 'c2'].includes(item.id)),
  students: SEED.students.filter((item) => ['s1', 's2', 's3', 's11', 's12'].includes(item.id)),
  parents: SEED.parents.filter((item) => item.id === 'p1'),
  grades: SEED.grades.filter((item) => item.studentId === 's1').slice(0, 3),
  guidanceCases: SEED.guidanceCases,
  studentGoals: SEED.studentGoals,
  mealMenus: SEED.mealMenus.slice(0, 2),
}

function sampleRows() {
  return Object.entries(SAMPLE).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

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

  test('erişim tablosu core modül kaydıyla tutarlı; core rol listesi dışında rol açmaz', () => {
    const table = collectionAccessTable()
    assert.deepEqual(Object.keys(table).sort(), [...RECORD_COLLECTIONS].sort())
    const moduleRoles = new Map(schoolModules.map((module) => [module.key, module.roles]))
    for (const collection of READABLE_COLLECTIONS) {
      const access = table[collection]
      assert.ok(access, collection)
      const module = moduleOfCollection(collection)
      assert.equal(module ?? ALWAYS_ON, COLLECTION_MODULES[collection], collection)
      if (module === null) continue
      assert.ok(isModuleKey(module), `${collection}: ${module}`)
      const allowed = moduleRoles.get(module)
      if (!allowed) continue
      for (const role of Object.keys(access.read))
        assert.ok(
          allowed.some((item) => item === role),
          `${collection}: ${role}`,
        )
    }
    // Core denetim listesi ve birebir yazışmalar genel okumaya açılmaz.
    assert.equal(READABLE_COLLECTIONS.includes('audit'), false)
    assert.equal(READABLE_COLLECTIONS.includes('conversations'), false)
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
    for (const name of ['bilinmeyen', 'audit', 'conversations', 'constructor', '__proto__']) {
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

  test('DOM-YTK-021: ön büro idari kayıtları görür, akademik alan ve koleksiyonları görmez', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'onburo')

    const students = (await get('/api/v1/collections/students', cookie)).json()
    assert.equal(students.meta.total, 5)
    for (const item of students.data) {
      assert.equal('progress' in item.record, false)
      assert.ok(item.record.name)
    }
    assert.equal((await get('/api/v1/collections/students?sort=-name', cookie)).statusCode, 200)
    assert.equal((await get('/api/v1/collections/classes', cookie)).statusCode, 200)
    for (const name of ['grades', 'guidanceCases', 'studentGoals', 'teachers']) {
      const response = await get(`/api/v1/collections/${name}`, cookie)
      assert.equal(response.statusCode, 403, name)
      assert.equal(response.json().code, 'forbidden')
    }
  })

  test('DOM-YTK-022: öğretmen için kişiye göre kapsam core’da yok; kişisel koleksiyonlar kapalı', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])

    for (const url of [
      '/api/v1/collections/students',
      '/api/v1/collections/students/s1',
      '/api/v1/collections/grades',
      '/api/v1/collections/studentGoals',
      '/api/v1/collections/guidanceCases',
      // Yemek modülünün core rol listesinde öğretmen yok.
      '/api/v1/collections/mealMenus',
    ]) {
      const response = await get(url, cookie)
      assert.equal(response.statusCode, 403, url)
      assert.equal(response.json().code, 'forbidden')
    }
    const subjects = (await get('/api/v1/collections/subjects', cookie)).json()
    assert.equal(subjects.meta.total, 3)
  })

  test('DOM-YTK-024: öğrenci kendi kaydı dahil kişisel koleksiyonları okuyamaz; menü açık', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])

    for (const url of [
      '/api/v1/collections/students',
      '/api/v1/collections/students/s1',
      '/api/v1/collections/students/s2',
      '/api/v1/collections/grades',
      '/api/v1/collections/guidanceCases/guidance-s1',
    ])
      assert.equal((await get(url, cookie)).statusCode, 403, url)
    assert.equal((await get('/api/v1/collections/mealMenus', cookie)).json().meta.total, 2)
    assert.equal((await get('/api/v1/collections/subjects', cookie)).statusCode, 200)
  })

  test('DOM-YTK-025: iki çocuklu veli de kişisel koleksiyonlara erişemez; menü açık', async () => {
    const { id } = await institution()
    const cookie = await memberCookie(id, 'veli', [
      { kind: 'child', recordId: 's1' },
      { kind: 'child', recordId: 's2' },
    ])
    const me = (await get('/api/v1/me', cookie)).json().data
    assert.deepEqual(
      me.activeMembership.links.map((link: { recordId: string }) => link.recordId),
      ['s1', 's2'],
    )

    for (const url of [
      '/api/v1/collections/students',
      '/api/v1/collections/students/s1',
      '/api/v1/collections/students/s2',
      '/api/v1/collections/studentGoals',
      '/api/v1/collections/guidanceCases',
      '/api/v1/collections/parents/p1',
    ]) {
      const response = await get(url, cookie)
      assert.equal(response.statusCode, 403, url)
      assert.equal(response.json().code, 'forbidden')
    }
    assert.equal((await get('/api/v1/collections/mealMenus', cookie)).statusCode, 200)
  })

  test('her rol kimlikli; kapalı koleksiyonda tekil kayıt bilgisi sızmaz', async () => {
    const { id } = await institution()
    for (const role of ROLES.filter((item) => item !== 'yonetici')) {
      const cookie = await memberCookie(id, role)
      // Var olan ve olmayan kayıt aynı yanıtı alır: varlık sızdırılmaz.
      const existing = await get('/api/v1/collections/grades/g-s1-0-0', cookie)
      const missing = await get('/api/v1/collections/grades/test-yok', cookie)
      assert.equal(existing.statusCode, 403, role)
      assert.equal(missing.statusCode, 403, role)
    }
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
