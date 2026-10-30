import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import type { CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
} from './support/app.ts'
import { SAMPLE, sampleRows, SEED } from './support/collections-sample.ts'

/**
 * `classId` süzgeci ve `counts?groupBy=classId`: kaydında sınıf olmayan öğrenci koleksiyonlarında
 * öğrencinin güncel sınıfıdır (`CLASS_VIA_STUDENT`). Kaydın kendi `classId` alanı olan
 * `contracts` ve `enrollmentHistory` kayıt alanıyla süzülür. Kapsam ve alan ayıklaması (rehberlik
 * iç notu, DOM-ILT-040) süzgeçle değişmez.
 */

const VIA_STUDENT = [
  'guidanceCases',
  'studyTasks',
  'appointments',
  'requests',
  'renewals',
  'eventConsents',
  'transportAssignments',
  'clubMemberships',
  'socialAchievements',
] as const satisfies readonly CollectionName[]

/** Örnek veride boş olan koleksiyonlar için elle kayıtlar (`studentId` var, `classId` yok). */
const MANUAL: Partial<Record<CollectionName, Record<string, unknown>[]>> = {
  renewals: [
    { id: 'test-ren-s1', studentId: 's1', fromClassId: 'c1', targetClassId: 'c2', year: 2027 },
    { id: 'test-ren-s2', studentId: 's2', fromClassId: 'c2', targetClassId: 'c3', year: 2027 },
  ],
  eventConsents: [
    { id: 'test-cons-s2', studentId: 's2', eventId: 'ev1', parentId: 'p1', consent: true },
    { id: 'test-cons-s3', studentId: 's3', eventId: 'ev1', parentId: 'p3', consent: false },
  ],
  // Kendi `classId` alanı olanlar: süzgeç kaydın alanıdır, öğrencinin sınıfı değil.
  contracts: [
    { id: 'test-con-moved', studentId: 's1', classId: 'c3', amount: 1, date: '2026-09-01' },
    { id: 'test-con-plain', studentId: 's1', amount: 1, date: '2026-09-01' },
  ],
  enrollmentHistory: [{ id: 'test-enr-s1', studentId: 's1', classId: 'c3', year: 2025 }],
}

const dataset = (collection: CollectionName): Record<string, unknown>[] => [
  ...((SEED as unknown as Record<string, Record<string, unknown>[]>)[collection] ?? []),
  ...(MANUAL[collection] ?? []),
]

/** Kuruma yazılan öğrenciler örnek kesittir (`SAMPLE.students`); kesitte olmayan öğrencinin sınıfı yoktur. */
const classOf = (studentId: unknown) =>
  SAMPLE.students?.find((item) => item.id === studentId)?.classId

function extraRows() {
  const names = [...VIA_STUDENT, 'contracts', 'enrollmentHistory'] as const
  return names.flatMap((collection) =>
    dataset(collection).map((data) => ({ collection, id: String(data.id), data })),
  )
}

describe('classId süzgeci: öğrenciye bağlı koleksiyonlar', () => {
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
  const member = async (
    institutionId: string,
    role: Role,
    links: Parameters<typeof createMember>[3] = [],
  ) => signInAs(app, await createMember(app, institutionId, role, links))
  const get = (url: string, cookie: string) =>
    app.inject({ method: 'GET', url, headers: { cookie } })
  async function list(cookie: string, collection: string, query = '') {
    const response = await get(`/api/v1/collections/${collection}?pageSize=100&${query}`, cookie)
    assert.equal(response.statusCode, 200, `${collection} ${response.body}`)
    return response.json().data as { id: string; record: Record<string, unknown> }[]
  }
  const idsOf = async (cookie: string, collection: string, query = '') =>
    (await list(cookie, collection, query)).map((item) => item.id).sort()
  /** Örnek öğrencisi `classIds` sınıflarından birinde olan kayıtların kimlikleri. */
  const expected = (collection: CollectionName, ...classIds: string[]) =>
    dataset(collection)
      .filter((row) => classIds.includes(String(classOf(row.studentId))))
      .map((row) => String(row.id))
      .sort()

  for (const collection of VIA_STUDENT) {
    test(`${collection}: classId öğrencinin güncel sınıfından çözülür (DOM-YTK-024)`, async () => {
      const { id, adminCookie } = await institution()
      const first = expected(collection, 'c1')
      const second = expected(collection, 'c2')
      assert.ok(first.length + second.length > 0, 'örnek veri bu sınıflarda kayıt taşımalı')
      assert.deepEqual(await idsOf(adminCookie, collection, 'classId=c1'), first)
      assert.deepEqual(
        await idsOf(adminCookie, collection, 'classId=c1&classId=c2'),
        expected(collection, 'c1', 'c2'),
      )
      assert.deepEqual(await idsOf(adminCookie, collection, 'classId=test-bos'), [])
      // Sınıf sayımı da öğrencinin sınıfıyla.
      const counts = await get(
        `/api/v1/collections/${collection}/counts?groupBy=classId`,
        adminCookie,
      )
      assert.equal(counts.statusCode, 200, counts.body)
      for (const group of counts.json().data as { value: string | null; count: number }[]) {
        if (group.value !== null)
          assert.equal(group.count, expected(collection, group.value).length, group.value)
      }
      // Veli sınıf süzgeciyle kendi çocuğunun dışındaki kaydı görmez (modül/rol izin vermiyorsa 403).
      const parent = await member(id, 'veli', [{ kind: 'child', recordId: 's1' }])
      const response = await get(
        `/api/v1/collections/${collection}?pageSize=100&classId=c1&classId=c2`,
        parent,
      )
      if (response.statusCode === 200) {
        const rows = response.json().data as { record: { studentId?: unknown } }[]
        for (const row of rows) assert.equal(row.record.studentId, 's1', collection)
        assert.deepEqual(
          (await idsOf(parent, collection, 'classId=c2')).filter((x) => !first.includes(x)),
          [],
        )
      } else assert.equal(response.statusCode, 403, response.body)
    })
  }

  test('DOM-ILT-040: classId süzgeci rehberlik iç notunu sızdırmaz', async () => {
    const { id, adminCookie } = await institution()
    const teacher = await member(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
    const admin = await list(adminCookie, 'guidanceCases', 'classId=c1')
    assert.ok(admin.length > 0)
    for (const item of admin) {
      assert.equal('internalNote' in item.record, false, 'yönetici iç notu görmez')
      assert.equal('notes' in item.record, false)
    }
    // İç not yalnız rehberlik görevli öğretmende (t1) kalır; süzgeç bunu değiştirmez.
    const counselor = await list(teacher, 'guidanceCases', 'classId=c1')
    assert.deepEqual(counselor.map((item) => item.id).sort(), admin.map((item) => item.id).sort())
    assert.ok(counselor.every((item) => typeof item.record.internalNote === 'string'))
    // İç not ayıklandığı için ona göre arama da eşleşmez, süzgeçle birleşince de.
    const secret = String(SEED.guidanceCases[0]?.internalNote).slice(0, 20)
    assert.deepEqual(await list(adminCookie, 'guidanceCases', `classId=c1&q=${secret}`), [])
  })

  test('ön büro: rolün okuyamadığı koleksiyonda classId süzgeci 403, okuduğunda daralır', async () => {
    const { id } = await institution()
    const front = await member(id, 'onburo')
    assert.equal((await get('/api/v1/collections/guidanceCases?classId=c1', front)).statusCode, 403)
    assert.equal((await get('/api/v1/collections/studyTasks?classId=c1', front)).statusCode, 403)
    assert.deepEqual(await idsOf(front, 'requests', 'classId=c1'), expected('requests', 'c1'))
  })

  test('kaydında sınıf olan contracts ve enrollmentHistory kaydın classId alanıyla süzülür', async () => {
    const { adminCookie } = await institution()
    // s1 güncel sınıfı c1'dir; sözleşme/geçmiş kaydının sınıfı c3'tür ve süzgeç ona bakar.
    assert.deepEqual(await idsOf(adminCookie, 'contracts', 'classId=c3'), ['test-con-moved'])
    assert.deepEqual(await idsOf(adminCookie, 'contracts', 'classId=c1'), [])
    assert.deepEqual(await idsOf(adminCookie, 'enrollmentHistory', 'classId=c3'), ['test-enr-s1'])
    assert.deepEqual(await idsOf(adminCookie, 'enrollmentHistory', 'classId=c1'), [])
  })

  test('öğrenci sınıf değiştirince süzgeç ve sayım yeni sınıfı izler', async () => {
    const created = await createInstitution(app)
    const moved = sampleRows().map((row) =>
      row.collection === 'students' && row.id === 's1'
        ? { ...row, data: { ...row.data, classId: 'c2' } }
        : row,
    )
    await insertMissingRecords(db, created.id, [...moved, ...extraRows()], FIXED_NOW)
    const cookie = await signInAs(app, created.admin)
    assert.deepEqual(await idsOf(cookie, 'requests', 'classId=c1'), [])
    assert.deepEqual(await idsOf(cookie, 'requests', 'classId=c2'), ['req1', 'req2'])
    const counts = await get('/api/v1/collections/requests/counts?groupBy=classId', cookie)
    assert.deepEqual(
      (counts.json().data as { value: string; count: number }[]).filter((g) => g.value === 'c2'),
      [{ value: 'c2', count: 2 }],
    )
  })
})
