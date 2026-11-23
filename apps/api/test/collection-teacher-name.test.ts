import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { records } from '../src/db/schema/records.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { sampleRows } from './support/collections-sample.ts'

/**
 * Soru ve randevu satırının öğretmen adı (`joined.teacherName`, OG-221): öğretmen kadrodan
 * ayrılmış (sistem arşivi ya da pasif kadro) olsa da ad döner; öğrenci ve veli arşivli öğretmenin
 * kaydını `teachers` ucundan okuyamaz, ad satırdan gelir.
 */

const ARCHIVED = 'test-t-arsiv'
const INACTIVE = 'test-t-pasif'
const teacher = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  collection: 'teachers' as const,
  id,
  data: {
    id,
    name,
    subjectId: 'math',
    branchId: 'b1',
    phone: '0555 000 00 00',
    email: `${id}@ornek.test`,
    ...extra,
  },
})
const question = (id: string, teacherId: string) => ({
  collection: 'questions' as const,
  id,
  data: {
    id,
    studentId: 's1',
    teacherId,
    subjectId: 'math',
    title: `Soru ${id}`,
    text: 'Üçgenin alanı nasıl bulunur?',
    createdAt: '2026-10-14T09:00:00.000Z',
    answeredAt: null,
    answer: '',
    fileName: null,
  },
})
const appointment = (id: string, teacherId: string) => ({
  collection: 'appointments' as const,
  id,
  data: {
    id,
    studentId: 's1',
    teacherId,
    date: '2026-10-20T10:00:00.000Z',
    duration: 30,
    type: 'Bireysel etüt',
    note: 'Denklemleri konuşmak istiyorum.',
    status: 'Bekliyor',
    requestedBy: { role: 'ogrenci', userId: 'u-s1' },
    history: [],
  },
})

const EXTRA = [
  teacher(ARCHIVED, 'Mehmet Demir'),
  teacher(INACTIVE, 'Zeynep Aksoy', { isActive: false, deletedAt: '2026-09-01T00:00:00.000Z' }),
  question('test-q-aktif', 't1'),
  question('test-q-arsiv', ARCHIVED),
  question('test-q-pasif', INACTIVE),
  question('test-q-yok', 'test-t-hic-yok'),
  appointment('test-a-aktif', 't1'),
  appointment('test-a-arsiv', ARCHIVED),
  appointment('test-a-pasif', INACTIVE),
]

describe('soru ve randevu: joined.teacherName', () => {
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
    await insertMissingRecords(db, created.id, [...sampleRows(), ...EXTRA], FIXED_NOW)
    // Sistem arşivi: kayıt varsayılan okumada ve kimlikle çözümde dışlanır.
    await db
      .update(records)
      .set({ archivedAt: FIXED_NOW })
      .where(
        and(
          eq(records.institutionId, created.id),
          eq(records.collection, 'teachers'),
          eq(records.id, ARCHIVED),
        ),
      )
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }

  async function member(institutionId: string, role: Role, links: MembershipLinkInput[]) {
    return signInAs(app, await createMember(app, institutionId, role, links))
  }

  const get = (cookie: string, url: string) =>
    app.inject({ method: 'GET', url, headers: { origin: TEST_ORIGIN, cookie } })

  async function names(cookie: string, collection: 'questions' | 'appointments') {
    const response = await get(cookie, `/api/v1/collections/${collection}?pageSize=100`)
    assert.equal(response.statusCode, 200, response.body)
    const items = response.json().data as {
      id: string
      joined?: { teacherName?: string }
      record: Record<string, unknown>
    }[]
    return Object.fromEntries(items.map((item) => [item.id, item.joined?.teacherName]))
  }

  test('öğrenci: arşivli ve pasif öğretmenin adı satırda döner; bilinmeyen öğretmen adsızdır', async () => {
    const a = await institution()
    const cookie = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])
    const questions = await names(cookie, 'questions')
    assert.equal(questions['test-q-aktif'], SEED_T1_NAME)
    assert.equal(questions['test-q-arsiv'], 'Mehmet Demir')
    assert.equal(questions['test-q-pasif'], 'Zeynep Aksoy')
    assert.ok('test-q-yok' in questions)
    assert.equal(questions['test-q-yok'], undefined)
    const appointments = await names(cookie, 'appointments')
    assert.equal(appointments['test-a-aktif'], SEED_T1_NAME)
    assert.equal(appointments['test-a-arsiv'], 'Mehmet Demir')
    assert.equal(appointments['test-a-pasif'], 'Zeynep Aksoy')
  })

  test('arşivli öğretmen öğrencinin `teachers` ucunda yoktur: ad yalnız satırdan gelir; iletişim sızmaz', async () => {
    const a = await institution()
    const cookie = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])
    const response = await get(cookie, '/api/v1/collections/teachers?pageSize=100')
    assert.equal(response.statusCode, 200, response.body)
    const listed = (response.json().data as { id: string }[]).map((item) => item.id)
    assert.ok(!listed.includes(ARCHIVED))
    const single = await get(cookie, `/api/v1/collections/teachers/${ARCHIVED}`)
    assert.equal(single.statusCode, 404)
    const items = (await get(cookie, '/api/v1/collections/questions?pageSize=100')).json().data as {
      joined?: Record<string, unknown>
    }[]
    for (const item of items)
      assert.deepEqual(
        Object.keys(item.joined ?? {}).filter((key) => /phone|email|contact/i.test(key)),
        [],
      )
  })

  test('veli, yönetici ve kayıttaki öğretmen aynı adı görür; tek kayıt yanıtı da ad taşır', async () => {
    const a = await institution()
    const parent = await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    assert.equal((await names(parent, 'questions'))['test-q-arsiv'], 'Mehmet Demir')
    assert.equal((await names(a.adminCookie, 'appointments'))['test-a-pasif'], 'Zeynep Aksoy')
    const single = await get(a.adminCookie, '/api/v1/collections/questions/test-q-arsiv')
    assert.equal(single.statusCode, 200, single.body)
    assert.equal(single.json().data.joined.teacherName, 'Mehmet Demir')
  })

  test('başka kurum: öğretmen adı kurum sınırını aşmaz', async () => {
    const a = await institution()
    const other = await createInstitution(app)
    await insertMissingRecords(
      db,
      other.id,
      [...sampleRows(), question('test-q-b', ARCHIVED)],
      FIXED_NOW,
    )
    const cookie = await signInAs(app, other.admin)
    const questions = await names(cookie, 'questions')
    assert.ok('test-q-b' in questions)
    assert.equal(questions['test-q-b'], undefined)
    assert.ok(a.id !== other.id)
  })

  test('401: oturumsuz istek', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/collections/questions' })
    assert.equal(response.statusCode, 401)
  })
})

const SEED_T1_NAME = sampleRows().find((row) => row.collection === 'teachers' && row.id === 't1')
  ?.data.name
