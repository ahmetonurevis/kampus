import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Video izleme ilerlemesi ucu (IST-041; docs/domain/kaynak-platformu.md DOM-KYN-005). Her test
 * kendi kurumunu örnek veri kesitiyle kurar: Deniz (s1) ve Nehir (s25) 7-A'da (c1, "7. Sınıf"),
 * Ece (s2) 5-A'da (c2, "5. Sınıf"). v1 ve v2 7. Sınıf videosudur; `v5` 5. Sınıf videosu eklenir.
 * Örnek ilerleme: s1/v1 %35, s1/v2 %0, s2/v1 %100 (s2'nin kapsamı dışı video, veri tutarsızlığı).
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1', 'c2']
const STUDENT_IDS = new Set(
  SEED.students.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)
type Sample = Partial<Record<CollectionName, readonly Record<string, unknown>[]>>
const V1 = SEED.videos.find((item) => item.id === 'v1')
assert.ok(V1)
const SAMPLE: Sample = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASS_IDS.includes(item.id)),
  students: SEED.students.filter((item) => STUDENT_IDS.has(item.id)),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
  videos: [...SEED.videos, { ...V1, id: 'v5', level: '5. Sınıf', title: '5. Sınıf videosu' }],
  videoProgress: [
    { studentId: 's1', videoId: 'v1', progress: 35 },
    { studentId: 's25', videoId: 'v1', progress: 80, positionSeconds: 80, durationSeconds: 100 },
  ],
}
/** Yalnız B kurumunda bulunan 7. Sınıf videosu (çapraz kurum). */
const ONLY_B: Sample = { videos: [{ ...V1, id: 'v-only-b', title: 'B kurumunun videosu' }] }

function rows(sample: Sample) {
  return Object.entries(sample).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

type Json = ReturnType<typeof JSON.parse>

describe('video izleme ilerlemesi ucu', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-video-${String(++serial).padStart(5, '0')}` })

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}, extra: Sample = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, rows(SAMPLE), FIXED_NOW)
    await insertMissingRecords(db, created.id, rows(extra), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }
  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }
  const student = async (institutionId: string, studentId = 's1') =>
    (await member(institutionId, 'ogrenci', [{ kind: 'student', recordId: studentId }])).cookie

  function post(
    cookie: string | null,
    videoId: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/videos/${videoId}/progress`,
      headers: {
        origin: TEST_ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  }
  const read = (cookie: string, url: string) =>
    app.inject({ method: 'GET', url, headers: { origin: TEST_ORIGIN, cookie } })

  function assertError(
    response: Awaited<ReturnType<typeof read>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const snapshot = async (institutionId: string) =>
    (await loadRecords(db, institutionId, ['videoProgress'], { includeArchived: true }))
      .map((row) => [row.id, row.version, row.archivedAt, row.data])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  /** Başarısız isteklerden sonra ilerleme kayıtları (veri, sürüm, arşiv) aynı kalır. */
  async function unchanged(institutionId: string, action: () => Promise<void>) {
    const before = await snapshot(institutionId)
    await action()
    assert.deepEqual(await snapshot(institutionId), before)
  }
  async function stored(institutionId: string, studentId: string, videoId: string) {
    const row = await findRecord(db, institutionId, 'videoProgress', `${studentId}:${videoId}`)
    assert.ok(row, `${studentId}:${videoId} yok`)
    return row
  }

  const BODY = { positionSeconds: 30, durationSeconds: 120 }

  test('oturumsuz istek 401', async () => {
    assertError(await post(null, 'v2', BODY), 401)
  })

  test('DOM-YTK-040, DOM-KYN-005: learning modülü kapalıyken 403 module_disabled, kayıt değişmez', async () => {
    const a = await institution({ enabledModules: { learning: false } })
    const s1 = await student(a.id)
    await unchanged(a.id, async () => {
      assertError(await post(s1, 'v2', BODY), 403, 'module_disabled')
    })
  })

  test('DOM-KYN-005: yalnız öğrenci yazar; veli, öğretmen, yönetici ve ön büro 403', async () => {
    const a = await institution()
    const parent = (await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }])).cookie
    const teacher = (await member(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])).cookie
    const frontDesk = (await member(a.id, 'onburo')).cookie
    await unchanged(a.id, async () => {
      for (const cookie of [parent, teacher, frontDesk, a.adminCookie])
        assertError(await post(cookie, 'v2', BODY), 403, 'forbidden')
    })
  })

  test('DOM-KYN-005: öğrenci bağlantısı olmayan hesap 403 student_scope_denied', async () => {
    const a = await institution()
    const unlinked = (await member(a.id, 'ogrenci')).cookie
    await unchanged(a.id, async () => {
      assertError(await post(unlinked, 'v2', BODY), 403, 'student_scope_denied')
    })
  })

  test('DOM-KYN-005: ilk istek kaydı açar, ikinci istek günceller; yüzde, son konum ve süre kalıcıdır', async () => {
    const a = await institution()
    const s1 = await student(a.id)
    const first = await post(s1, 'v2', BODY)
    assert.equal(first.statusCode, 200, first.body)
    assert.deepEqual(first.json().data, {
      videoId: 'v2',
      progress: 25,
      positionSeconds: 30,
      durationSeconds: 120,
    })
    const created = await stored(a.id, 's1', 'v2')
    assert.deepEqual(created.data, {
      studentId: 's1',
      videoId: 'v2',
      progress: 25,
      positionSeconds: 30,
      durationSeconds: 120,
    })
    const second = await post(s1, 'v2', { positionSeconds: 90, durationSeconds: 120 })
    assert.equal(second.statusCode, 200, second.body)
    assert.equal(second.json().data.progress, 75)
    const updated = await stored(a.id, 's1', 'v2')
    assert.equal(updated.data.progress, 75)
    assert.equal(updated.version, created.version + 1)
    // Tohum kaydı (konumsuz %35) yeni konumla güncellenir.
    const seeded = await post(s1, 'v1', { positionSeconds: 10, durationSeconds: 100 })
    assert.deepEqual(seeded.json().data, {
      videoId: 'v1',
      progress: 35,
      positionSeconds: 10,
      durationSeconds: 100,
    })
  })

  test('DOM-KYN-005: ilerleme geri gitmez, son konum yeni değerdir; yüzde 100e sıkıştırılır', async () => {
    const a = await institution()
    const s1 = await student(a.id)
    await post(s1, 'v2', { positionSeconds: 110, durationSeconds: 120 })
    const back = await post(s1, 'v2', { positionSeconds: 5, durationSeconds: 120 })
    assert.equal(back.statusCode, 200, back.body)
    assert.equal(back.json().data.progress, 92)
    assert.equal(back.json().data.positionSeconds, 5)
    const over = await post(s1, 'v2', { positionSeconds: 500, durationSeconds: 120 })
    assert.equal(over.json().data.progress, 100)
    assert.equal(over.json().data.positionSeconds, 120)
    assert.equal((await stored(a.id, 's1', 'v2')).data.progress, 100)
  })

  test('DOM-KYN-005: aynı istek iki kez aynı sonucu verir ve ikinci kez yazmaz (idempotent)', async () => {
    const a = await institution()
    const s1 = await student(a.id)
    const first = await post(s1, 'v2', BODY)
    const before = await stored(a.id, 's1', 'v2')
    const again = await post(s1, 'v2', BODY)
    assert.equal(again.statusCode, 200)
    assert.deepEqual(again.json(), first.json())
    const after = await stored(a.id, 's1', 'v2')
    assert.equal(after.version, before.version)
    assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime())
    // Idempotency-Key ile tekrar saklanan yanıtı döndürür.
    const headers = key()
    const keyed = await post(s1, 'v1', BODY, headers)
    const replay = await post(s1, 'v1', BODY, headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), keyed.json())
  })

  test('DOM-KYN-005: öğrenciler birbirinin ilerlemesini yazmaz ve görmez; kayıt oturumdan çözülür', async () => {
    const a = await institution()
    const s1 = await student(a.id)
    // Gövdedeki bilinmeyen alan 400'dür; kayıt yalnız oturumun öğrencisine yazılır.
    assert.equal((await post(s1, 'v2', { ...BODY, studentId: 's25' })).statusCode, 400)
    assert.equal((await post(s1, 'v2', { ...BODY, institutionId: 'baska' })).statusCode, 400)
    await post(s1, 'v2', BODY)
    assert.equal(await findRecord(db, a.id, 'videoProgress', 's25:v2'), null)
    const list = await read(s1, '/api/v1/collections/videoProgress?pageSize=100')
    assert.equal(list.statusCode, 200, list.body)
    const mine = (list.json().data as Json[]).map((item) => item.record as Json)
    assert.ok(mine.every((item) => item.studentId === 's1'))
    const v2 = mine.find((item) => item.videoId === 'v2')
    assert.equal(v2?.positionSeconds, 30)
    assert.equal(v2?.progress, 25)
  })

  test('DOM-KYN-005: düzeyi dışındaki, olmayan ve başka kurumun videosu 404, kayıt değişmez', async () => {
    const a = await institution()
    const b = await institution({}, ONLY_B)
    const s1 = await student(a.id)
    await unchanged(a.id, async () => {
      assertError(await post(s1, 'v5', BODY), 404, 'not_found')
      assertError(await post(s1, 'v-yok', BODY), 404, 'not_found')
      assertError(await post(s1, 'v-only-b', BODY), 404, 'not_found')
    })
    assert.equal(await findRecord(db, b.id, 'videoProgress', 's1:v-only-b'), null)
    // Ece 5. Sınıf: kendi düzeyinin videosuna yazar, 7. Sınıf videosuna yazamaz.
    const s2 = await student(a.id, 's2')
    assertError(await post(s2, 'v1', BODY), 404, 'not_found')
    assert.equal((await post(s2, 'v5', BODY)).statusCode, 200)
  })

  test('DOM-KYN-005: geçersiz gövde ve başlık 400, kayıt değişmez', async () => {
    const a = await institution()
    const s1 = await student(a.id)
    await unchanged(a.id, async () => {
      const bad: unknown[] = [
        {},
        { positionSeconds: 5 },
        { durationSeconds: 120 },
        { positionSeconds: -1, durationSeconds: 120 },
        { positionSeconds: 5, durationSeconds: 0 },
        // Yuvarlanınca 0 olacak süre (yanıt şeması en az 1 ister): 500 değil 400.
        { positionSeconds: 0, durationSeconds: 0.4 },
        { positionSeconds: '5', durationSeconds: 120 },
        { positionSeconds: 5, durationSeconds: 100_000 },
        { positionSeconds: 5, durationSeconds: 120, progress: 100 },
      ]
      for (const body of bad) assertError(await post(s1, 'v2', body), 400, 'validation_failed')
      assertError(await post(s1, 'v2', BODY, { 'if-match': '"1"' }), 400, 'if_match_not_supported')
    })
  })

  test('DOM-KYN-005: kesirli süre ve konum tam saniyeye yuvarlanır, yanıt ve kayıt tutarlıdır', async () => {
    const a = await institution()
    const s1 = await student(a.id)
    const response = await post(s1, 'v2', { positionSeconds: 6.3, durationSeconds: 12.6 })
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(response.json().data, {
      videoId: 'v2',
      progress: 46,
      positionSeconds: 6,
      durationSeconds: 13,
    })
    assert.equal((await stored(a.id, 's1', 'v2')).data.durationSeconds, 13)
    // En küçük kabul edilen süre 1 sn: 0,5'in üstü 1'e, konum süreyi aşamaz.
    const edge = await post(s1, 'v1', { positionSeconds: 0, durationSeconds: 1 })
    assert.equal(edge.statusCode, 200, edge.body)
    assert.equal(edge.json().data.durationSeconds, 1)
  })

  test('DOM-KYN-005: sık yazılan ilerleme denetim satırı üretmez', async () => {
    const a = await institution()
    const s1 = await student(a.id)
    await post(s1, 'v2', BODY)
    await post(s1, 'v2', { positionSeconds: 60, durationSeconds: 120 })
    const audit = await db.select().from(auditLog).where(eq(auditLog.institutionId, a.id))
    assert.equal(audit.filter((row) => row.entityType === 'videoProgress').length, 0)
  })
})
