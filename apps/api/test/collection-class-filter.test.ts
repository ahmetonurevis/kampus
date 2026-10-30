import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
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
  'clubAttendance',
  'opticalEvaluations',
  'videoProgress',
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
  videoProgress: [{ studentId: 's3', videoId: 'v1', progress: 50 }],
  clubAttendance: [
    { id: 'test-att-s1', clubId: 'club1', studentId: 's1', date: '2026-09-01', status: 'Geldi' },
    { id: 'test-att-s2', clubId: 'club1', studentId: 's2', date: '2026-09-01', status: 'Geldi' },
  ],
  opticalEvaluations: [
    { id: 'test-opt-s1', examId: 'e1', studentId: 's1', subjectId: 'math', net: 10 },
    { id: 'test-opt-s3', examId: 'e1', studentId: 's3', subjectId: 'math', net: 8 },
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
    dataset(collection).map((data) => ({
      collection,
      id: String(recordKey(collection, data)),
      data,
    })),
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
      .map((row) => String(recordKey(collection, row)))
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

  describe('not: kaydın kendi sınıfı ve kapsam dışı öğrenci (DOM-YTK-022)', () => {
    /** `studentId` öğrencisine, başka sınıfta verilmiş (kaydında `classId` olan) Türkçe notu. */
    const givenIn = (id: string, studentId: string, classId: string) => {
      const base = SEED.grades.find((x) => x.studentId === studentId && x.subjectId === 'turkish')
      assert.ok(base, 'örnek verideki Türkçe not')
      return { collection: 'grades' as const, id, data: { ...base, id, classId, score: 77 } }
    }
    async function withGrades(extra: ReturnType<typeof givenIn>[]) {
      const created = await createInstitution(app)
      await insertMissingRecords(db, created.id, [...sampleRows(), ...extra], FIXED_NOW)
      return {
        ...created,
        adminCookie: await signInAs(app, created.admin),
        t2: await member(created.id, 'ogretmen', [{ kind: 'teacher', recordId: 't2' }]),
      }
    }
    const groupsOf = async (cookie: string) => {
      const response = await get('/api/v1/collections/grades/counts?groupBy=classId', cookie)
      assert.equal(response.statusCode, 200, response.body)
      return (response.json().data as { value: string | null; count: number }[]).map(
        (group) => group.value,
      )
    }

    test('kapsam dışı öğrencinin güncel sınıfı süzgeçte ve gruplamada görünmez', async () => {
      // s11, t2'nin sınıfları dışında bir sınıftadır; nota c1'de verilmiştir (t2 kapsamındaki sınıf).
      const outClass = classOf('s11') ?? SEED.students.find((x) => x.id === 's11')?.classId
      assert.ok(outClass && !['c1', 'c2', 'c3'].includes(outClass))
      const moved = givenIn('test-g-s11-in-c1', 's11', 'c1')
      const { adminCookie, t2 } = await withGrades([moved])
      assert.equal((await get('/api/v1/collections/students/s11', t2)).statusCode, 404)
      // Not kendi sınıfı (c1) yüzünden okunur; öğrencinin başka sınıfı hiçbir yoldan çıkmaz.
      assert.ok((await idsOf(t2, 'grades')).includes(moved.id))
      assert.deepEqual(await idsOf(t2, 'grades', `classId=${outClass}`), [])
      assert.ok((await idsOf(t2, 'grades', 'classId=c1')).includes(moved.id))
      const groups = await groupsOf(t2)
      assert.ok(!groups.includes(outClass), `kapsam dışı sınıf gruplamada: ${groups.join()}`)
      assert.ok(groups.includes('c1'))
      // Yönetici davranışı değişmez: öğrencinin güncel sınıfı ve kaydın sınıfı birlikte görünür.
      assert.ok((await idsOf(adminCookie, 'grades', `classId=${outClass}`)).length > 0)
      assert.ok(!(await idsOf(adminCookie, 'grades', `classId=${outClass}`)).includes(moved.id))
      assert.ok((await groupsOf(adminCookie)).includes(outClass))
    })

    test('classId süzgeci ve gruplaması notun kendi sınıfını kullanır; sınıfsız not öğrencinin sınıfına düşer', async () => {
      // s1 c1'dedir; nota c3'te verilmiştir.
      const moved = givenIn('test-g-s1-in-c3', 's1', 'c3')
      const { adminCookie, t2 } = await withGrades([moved])
      for (const cookie of [adminCookie, t2]) {
        assert.ok((await idsOf(cookie, 'grades')).includes(moved.id))
        assert.ok((await idsOf(cookie, 'grades', 'classId=c3')).includes(moved.id))
        assert.ok(!(await idsOf(cookie, 'grades', 'classId=c1')).includes(moved.id))
        assert.ok(!(await idsOf(cookie, 'grades', 'classId=c1&classId=c2')).includes(moved.id))
        assert.ok(
          (await idsOf(cookie, 'grades', 'classId=c1&classId=c3')).includes(moved.id),
          'çoklu sınıf birleşimi',
        )
      }
      // Sınıfsız (örnek veri) s1 notu öğrencinin güncel sınıfı c1'de görünür, c3'te görünmez.
      const plain = SEED.grades.find((x) => x.studentId === 's1' && x.subjectId === 'math')
      assert.ok(plain && !('classId' in plain))
      const inC1 = await idsOf(adminCookie, 'grades', 'classId=c1')
      assert.ok(inC1.includes(plain.id))
      assert.ok(!(await idsOf(adminCookie, 'grades', 'classId=c3')).includes(plain.id))
      // Sayım aynı kuralı izler: c3 grubunda yalnız kaydı c3 olan not ve s3'ün sınıfsız notları.
      const counts = await get('/api/v1/collections/grades/counts?groupBy=classId', adminCookie)
      const c3 = (counts.json().data as { value: string; count: number }[]).find(
        (group) => group.value === 'c3',
      )
      const c3List = await idsOf(adminCookie, 'grades', 'classId=c3')
      assert.equal(c3?.count, c3List.length)
    })
  })
})
