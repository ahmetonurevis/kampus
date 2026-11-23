import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
} from './support/app.ts'
import { sampleRows } from './support/collections-sample.ts'

/**
 * `level` süzgeci (IST-035): materyalin düzeyi sunucuda, sayfalamadan önce SQL'de süzülür.
 * Değer CEFR seviyesi ya da `N. Sınıf`; başka değer 400. Kurum ve rol kapsamı süzgeçle değişmez.
 */

const material = (id: string, level: string, subjectId = 'math', title = id) => ({
  id,
  title,
  fileName: `${id}.pdf`,
  subjectId,
  subject: subjectId,
  level,
  teacherId: 't1',
  size: 'PDF',
  createdAt: '2026-10-01',
  type: 'Doküman',
  content: ['Özet'],
})

const MATERIALS = [
  ...Array.from({ length: 7 }, (_, i) => material(`test-mat-7-${i}`, '7. Sınıf')),
  material('test-mat-8-0', '8. Sınıf'),
  material('test-mat-8-1', '8. Sınıf', 'turkish'),
  material('test-mat-b1', 'B1'),
  material('test-mat-b2', 'B2+'),
]
const OTHER_MATERIALS = [material('test-mat-x-7', '7. Sınıf'), material('test-mat-x-b1', 'B1')]

const ids = (level: string) =>
  MATERIALS.filter((item) => item.level === level)
    .map((item) => item.id)
    .sort()

describe('level süzgeci: materyal düzeyi (IST-035)', () => {
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

  const rows = (data: readonly Record<string, unknown>[]) =>
    data.map((item) => ({ collection: 'materials' as const, id: String(item.id), data: item }))

  async function institution() {
    const created = await createInstitution(app)
    const other = await createInstitution(app)
    await insertMissingRecords(db, created.id, [...sampleRows(), ...rows(MATERIALS)], FIXED_NOW)
    await insertMissingRecords(db, other.id, rows(OTHER_MATERIALS), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }
  const member = async (
    institutionId: string,
    role: Role,
    links: Parameters<typeof createMember>[3] = [],
  ) => signInAs(app, await createMember(app, institutionId, role, links))
  const get = (url: string, cookie: string) =>
    app.inject({ method: 'GET', url, headers: { cookie } })
  async function page(cookie: string, query: string) {
    const response = await get(`/api/v1/collections/materials?${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json() as { data: { id: string }[]; meta: { total: number } }
    return { ids: body.data.map((item) => item.id), total: body.meta.total }
  }

  test('DOM-KYN-012: sınıf düzeyi ve CEFR değeri yalnız eşleşen materyalleri döner', async () => {
    const { adminCookie } = await institution()
    assert.deepEqual(
      (await page(adminCookie, 'pageSize=100&level=7.%20S%C4%B1n%C4%B1f')).ids.sort(),
      ids('7. Sınıf'),
    )
    assert.deepEqual(
      (await page(adminCookie, 'pageSize=100&level=8.%20S%C4%B1n%C4%B1f')).ids.sort(),
      ids('8. Sınıf'),
    )
    assert.deepEqual((await page(adminCookie, 'pageSize=100&level=B1')).ids, ['test-mat-b1'])
    assert.deepEqual((await page(adminCookie, 'pageSize=100&level=B2%2B')).ids, ['test-mat-b2'])
    // Süzgeçsiz liste hepsini taşır; süzgeç daraltır.
    assert.equal((await page(adminCookie, 'pageSize=100')).total, MATERIALS.length)
  })

  test('çoklu level değeri birleşim döner; ders süzgeciyle kesişir', async () => {
    const { adminCookie } = await institution()
    const both = await page(adminCookie, 'pageSize=100&level=8.%20S%C4%B1n%C4%B1f&level=B1')
    assert.deepEqual(both.ids.sort(), [...ids('8. Sınıf'), 'test-mat-b1'].sort())
    const narrowed = await page(
      adminCookie,
      'pageSize=100&level=8.%20S%C4%B1n%C4%B1f&subjectId=turkish',
    )
    assert.deepEqual(narrowed.ids, ['test-mat-8-1'])
  })

  test('sayfalama süzgeçten sonra: toplam süzülmüş sayıdır, sayfalar süzülmüş kümeyi böler', async () => {
    const { adminCookie } = await institution()
    const level = 'level=7.%20S%C4%B1n%C4%B1f&sort=id'
    const first = await page(adminCookie, `${level}&page=1&pageSize=3`)
    const second = await page(adminCookie, `${level}&page=2&pageSize=3`)
    const third = await page(adminCookie, `${level}&page=3&pageSize=3`)
    const beyond = await page(adminCookie, `${level}&page=4&pageSize=3`)
    assert.equal(first.total, 7)
    assert.equal(third.total, 7)
    assert.deepEqual([first.ids.length, second.ids.length, third.ids.length], [3, 3, 1])
    assert.deepEqual(beyond.ids, [])
    assert.deepEqual([...first.ids, ...second.ids, ...third.ids], ids('7. Sınıf'))
  })

  test('geçersiz level değeri 400; geçerli değerle birlikte de 400', async () => {
    const { adminCookie } = await institution()
    for (const query of [
      'level=Yok',
      'level=b1',
      'level=C3',
      'level=4.%20S%C4%B1n%C4%B1f',
      'level=13.%20S%C4%B1n%C4%B1f',
      'level=B1&level=Yok',
      'level=',
    ]) {
      const response = await get(`/api/v1/collections/materials?${query}`, adminCookie)
      assert.equal(response.statusCode, 400, query)
      assert.equal(response.json().code, 'validation_failed', query)
    }
    // Düzey alanı olmayan koleksiyonda süzgeç geçerli değerle boş döner, bozulmaz.
    const students = await get('/api/v1/collections/students?level=B1', adminCookie)
    assert.equal(students.statusCode, 200, students.body)
    assert.deepEqual(students.json().data, [])
  })

  test('DOM-YTK-011: başka kurumun materyali süzgeçte ve toplamda görünmez', async () => {
    const { adminCookie } = await institution()
    const sevenths = await page(adminCookie, 'pageSize=100&level=7.%20S%C4%B1n%C4%B1f')
    assert.equal(sevenths.total, 7)
    assert.ok(!sevenths.ids.includes('test-mat-x-7'))
    const b1 = await page(adminCookie, 'pageSize=100&level=B1')
    assert.deepEqual(b1.ids, ['test-mat-b1'])
  })

  test('401 oturumsuz; öğrenci kendi düzeyi dışındaki materyali süzgeçle de göremez (DOM-YTK-021)', async () => {
    const { id, adminCookie } = await institution()
    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/collections/materials?level=B1',
    })
    assert.equal(anonymous.statusCode, 401)
    const teacher = await member(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
    assert.deepEqual((await page(teacher, 'pageSize=100&level=B1')).ids, ['test-mat-b1'])
    const student = await member(id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])
    const all = await page(student, 'pageSize=100')
    // Öğrenci yalnız kendi düzeyindeki (7. Sınıf) materyalleri görür; süzgeç kapsamı genişletmez.
    assert.deepEqual([...all.ids].sort(), ids('7. Sınıf'))
    for (const level of ['8. Sınıf', 'B1', 'B2+']) {
      const filtered = await page(student, `pageSize=100&level=${encodeURIComponent(level)}`)
      assert.deepEqual(filtered, { ids: [], total: 0 }, level)
    }
    const own = await page(student, `pageSize=100&level=${encodeURIComponent('7. Sınıf')}`)
    assert.deepEqual([...own.ids].sort(), ids('7. Sınıf'))
    assert.equal(
      (await page(adminCookie, 'pageSize=100&level=8.%20S%C4%B1n%C4%B1f')).total,
      ids('8. Sınıf').length,
    )
  })
})
