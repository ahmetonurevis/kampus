import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
import { createMember, FIXED_NOW, signInAs, TEST_ORIGIN } from './support/app.ts'
import {
  app,
  assertError,
  classStudents,
  DAY,
  db,
  institution,
  marksFor,
  member,
  post,
  REASON,
  useCommandsHarness,
} from './support/commands-harness.ts'

/**
 * Yoklamadan devamsızlık bildirimi (OG-043, IST-072; docs/domain/iletisim-ve-veli.md
 * DOM-ILT-052). `POST /classes/:classId/attendance` "gelmedi" işaretlenen öğrencinin velisine
 * (yetişkin kursiyerde kendisine) aynı transaction'da uygulama içi bildirim yazar. Aynı durumu
 * yeniden kaydetmek yinelemez; "gelmedi" düzeltilirse ayrı düzeltme bildirimi gider. Kısıtlı
 * veli, başka kurum, kapalı akademik modül ve geçmiş gün denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>
const URL = '/api/v1/classes/c1/attendance'
const [first, second] = classStudents('c1')
if (!first || !second) throw new Error('örnek veride c1 öğrencileri eksik')

describe('devamsızlık bildirimi (yoklama)', () => {
  useCommandsHarness()

  const marks = (overrides: Record<string, string> = {}) => ({
    ...marksFor('c1'),
    ...overrides,
  })
  /** Öğretmen aynı gün kendi sınıfının yoklamasını alır; gerekçe isteğe bağlıdır. */
  const teacher = (institutionId: string) =>
    member(institutionId, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
  const save = (cookie: string, body: Record<string, unknown>) =>
    post(URL, cookie, { date: DAY, ...body })

  async function account(institutionId: string, role: 'veli' | 'ogrenci', studentId: string) {
    const links: MembershipLinkInput[] = [
      { kind: role === 'veli' ? 'child' : 'student', recordId: studentId },
    ]
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }

  /** Bildirim merkezinden görünenler: tür, kitle, öğrenci ve başlık. */
  async function seen(cookie: string) {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { origin: TEST_ORIGIN, cookie },
    })
    assert.equal(response.statusCode, 200, response.body)
    return (response.json().data as Json[]).map((n) => [n.kind, n.audience, n.studentId, n.title])
  }
  const stored = async (institutionId: string) =>
    (await loadRecords(db, institutionId, ['notifications'])).map((row) => row.data)

  test('DOM-ILT-052: gelmedi işaretlenen öğrencinin velisine tek bildirim gider; ad dışında kişisel veri yok', async () => {
    const a = await institution()
    const parent = await account(a.id, 'veli', first.id)
    const otherParent = await account(a.id, 'veli', second.id)
    const student = await account(a.id, 'ogrenci', first.id)
    const response = await save(await teacher(a.id), { marks: marks({ [first.id]: 'absent' }) })
    assert.equal(response.statusCode, 200, response.body)

    assert.deepEqual(await seen(parent.cookie), [
      [
        'absence_recorded',
        'parent',
        first.id,
        `${first.name.split(' ')[0]} yoklamada gelmedi olarak işaretlendi.`,
      ],
    ])
    // Başka öğrencinin velisi ve (18 yaş altı) öğrencinin kendisi almaz.
    assert.deepEqual(await seen(otherParent.cookie), [])
    assert.deepEqual(await seen(student.cookie), [])
    // Kayıtta serbest metin, durum ya da gerekçe yok (DOM-ILT-023).
    const [row, ...rest] = await stored(a.id)
    assert.equal(rest.length, 0)
    assert.deepEqual(Object.keys(row ?? {}).sort(), [
      'audience',
      'createdAt',
      'id',
      'kind',
      'studentId',
      'subject',
    ])
    assert.deepEqual(row?.subject, { type: 'attendance', id: `att-${first.id}-${DAY}` })
    // Yoklama ve bildirim aynı işlemde: "geldi" işaretli öğrenciye bildirim yok.
    assert.equal((await stored(a.id)).length, 1)
    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'notification.create')))
    assert.equal(audits.length, 1)
  })

  test('DOM-ILT-052: aynı gün aynı durumu yeniden kaydetmek bildirimi yinelemez; ikinci öğrenci ayrı bildirim alır', async () => {
    const a = await institution()
    const parent = await account(a.id, 'veli', first.id)
    const cookie = await teacher(a.id)
    const body = { marks: marks({ [first.id]: 'absent' }) }
    assert.equal((await save(cookie, body)).statusCode, 200)
    assert.equal((await save(cookie, body)).statusCode, 200)
    assert.equal((await seen(parent.cookie)).length, 1)
    // Gün içinde ikinci öğrencinin gelmediği sonradan işlenirse yalnız o öğrenci için eklenir.
    const secondParent = await account(a.id, 'veli', second.id)
    const both = { marks: marks({ [first.id]: 'absent', [second.id]: 'absent' }) }
    assert.equal((await save(cookie, both)).statusCode, 200)
    assert.equal((await seen(parent.cookie)).length, 1)
    assert.equal((await seen(secondParent.cookie)).length, 1)
    assert.equal((await stored(a.id)).length, 2)
  })

  test('DOM-ILT-052: gelmedi başka duruma düzeltilirse düzeltme bildirimi gider; önceki bildirim kalır; yeniden gelmedi yeni bildirimdir', async () => {
    const a = await institution()
    const parent = await account(a.id, 'veli', first.id)
    const cookie = await teacher(a.id)
    const name = first.name.split(' ')[0]
    const kinds = async () => (await seen(parent.cookie)).map(([kind]) => kind).reverse()

    await save(cookie, { marks: marks({ [first.id]: 'absent' }) })
    assert.deepEqual(await kinds(), ['absence_recorded'])
    // Geldiye düzeltme: önceki bildirim geri çekilmez, düzeltildiği ayrı bildirimle belirtilir.
    await save(cookie, { marks: marks() })
    assert.deepEqual(await kinds(), ['absence_recorded', 'absence_corrected'])
    assert.deepEqual((await seen(parent.cookie))[0], [
      'absence_corrected',
      'parent',
      first.id,
      `${name} için gelmedi kaydı düzeltildi.`,
    ])
    // Aynı düzeltmeyi yeniden göndermek yeni bildirim açmaz.
    await save(cookie, { marks: marks() })
    assert.deepEqual(await kinds(), ['absence_recorded', 'absence_corrected'])
    // Düzeltmeden sonra yeniden gelmedi yeni bir olaydır; bildirim sessiz kalmaz.
    await save(cookie, { marks: marks({ [first.id]: 'absent' }) })
    assert.deepEqual(await kinds(), ['absence_recorded', 'absence_corrected', 'absence_recorded'])
    // "Mazeretli" ya da "geç" düzeltmesi yeni durumu söylemeden düzeltme olarak bildirilir.
    await save(cookie, { marks: marks({ [first.id]: 'excused' }) })
    assert.deepEqual((await kinds()).slice(3), ['absence_corrected'])
    assert.equal((await stored(a.id)).length, 4)
  })

  test('DOM-ILT-052: gelmedi bildirimi gitmemiş kayıtta düzeltme bildirimi yazılmaz', async () => {
    const a = await institution()
    const parent = await account(a.id, 'veli', first.id)
    const cookie = await teacher(a.id)
    await save(cookie, { marks: marks({ [first.id]: 'late' }) })
    await save(cookie, { marks: marks() })
    assert.deepEqual(await seen(parent.cookie), [])
    assert.equal((await stored(a.id)).length, 0)
  })

  test('DOM-ILT-052: yönetici geçmiş güne gelmedi yazarsa aynı gün bildirimi gitmez', async () => {
    const a = await institution()
    const parent = await account(a.id, 'veli', first.id)
    const response = await post(URL, a.adminCookie, {
      date: '2026-10-05',
      marks: marks({ [first.id]: 'absent' }),
      reason: REASON,
    })
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(await seen(parent.cookie), [])
  })

  test('DOM-ILT-052: yönetici gerekçeli düzeltmesi (gelmedi → geldi) velisine düzeltme bildirimi gönderir', async () => {
    const a = await institution()
    const parent = await account(a.id, 'veli', first.id)
    await save(await teacher(a.id), { marks: marks({ [first.id]: 'absent' }) })
    const response = await save(a.adminCookie, { marks: marks(), reason: REASON })
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(
      (await seen(parent.cookie)).map(([kind]) => kind),
      ['absence_corrected', 'absence_recorded'],
    )
    // Gerekçe (kişisel veri) bildirimde ve denetimde yok.
    assert.ok(!JSON.stringify(await stored(a.id)).includes(REASON))
  })

  test('DOM-ILT-070, DOM-ILT-074: iletişim kısıtlı veli devamsızlık bildirimini görmez, kısıtsız veli görür', async () => {
    const a = await institution()
    const restricted = await account(a.id, 'veli', first.id)
    const free = await account(a.id, 'veli', first.id)
    const bonds = await app.inject({
      method: 'GET',
      url: `/api/v1/students/${first.id}/guardians`,
      headers: { origin: TEST_ORIGIN, cookie: a.adminCookie },
    })
    assert.equal(bonds.statusCode, 200, bonds.body)
    const own = (bonds.json().data as Json[]).find(
      (bond) => bond.membershipId === restricted.membershipId,
    )
    assert.ok(own)
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/students/${first.id}/guardians/${own.id}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie: a.adminCookie,
        'content-type': 'application/json',
        'if-match': `"${own.rowVersion}"`,
        'idempotency-key': randomUUID(),
      },
      payload: JSON.stringify({ custody: 'none', contactRestricted: true }),
    })
    assert.equal(patch.statusCode, 200, patch.body)

    await save(await teacher(a.id), { marks: marks({ [first.id]: 'absent' }) })
    assert.deepEqual(await seen(restricted.cookie), [])
    assert.equal((await seen(free.cookie)).length, 1)
  })

  test('DOM-ILT-052: dil okulunda yetişkin kursiyerin bildirimi kendisine gider, veliye gitmez', async () => {
    const a = await institution({ type: 'language_school' })
    await insertMissingRecords(
      db,
      a.id,
      [
        {
          collection: 'prospects',
          id: 'p-yetiskin',
          data: { id: 'p-yetiskin', studentId: first.id, minor: false },
        },
        {
          collection: 'prospects',
          id: 'p-kucuk',
          data: { id: 'p-kucuk', studentId: second.id, minor: true },
        },
      ],
      FIXED_NOW,
    )
    const adult = await account(a.id, 'ogrenci', first.id)
    const adultParent = await account(a.id, 'veli', first.id)
    const minorParent = await account(a.id, 'veli', second.id)
    const response = await save(a.adminCookie, {
      marks: marks({ [first.id]: 'absent', [second.id]: 'absent' }),
      reason: REASON,
    })
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(await seen(adult.cookie), [
      ['absence_recorded', 'student', first.id, 'Yoklamada gelmedi olarak işaretlendin.'],
    ])
    assert.deepEqual(await seen(adultParent.cookie), [])
    assert.deepEqual(
      (await seen(minorParent.cookie)).map(([kind, audience]) => [kind, audience]),
      [['absence_recorded', 'parent']],
    )
  })

  test('DOM-ILT-052, IST-072: başka kurum etkilenmez; gövdedeki kurum kimliği etkisizdir', async () => {
    const a = await institution()
    const b = await institution()
    const parentB = await account(b.id, 'veli', first.id)
    const parentA = await account(a.id, 'veli', first.id)
    const response = await save(await teacher(a.id), {
      marks: marks({ [first.id]: 'absent' }),
      institutionId: b.id,
    })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal((await seen(parentA.cookie)).length, 1)
    assert.deepEqual(await seen(parentB.cookie), [])
    assert.deepEqual(await stored(b.id), [])
  })

  test('DOM-YTK-040: akademik modül kapanınca devamsızlık bildirimi listeden ve sayıdan düşer, açılınca döner', async () => {
    const a = await institution()
    const parent = await account(a.id, 'veli', first.id)
    await save(await teacher(a.id), { marks: marks({ [first.id]: 'absent' }) })
    const unread = async () =>
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/notifications/unread-count',
          headers: { origin: TEST_ORIGIN, cookie: parent.cookie },
        })
      ).json().data.unread as number
    assert.equal((await seen(parent.cookie)).length, 1)
    assert.equal(await unread(), 1)

    async function setAcademic(enabled: boolean) {
      const settings = await app.inject({
        method: 'GET',
        url: '/api/v1/modules',
        headers: { origin: TEST_ORIGIN, cookie: a.adminCookie },
      })
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/modules/academic',
        headers: {
          origin: TEST_ORIGIN,
          cookie: a.adminCookie,
          'content-type': 'application/json',
          'if-match': `"${settings.json().data.version}"`,
          'idempotency-key': randomUUID(),
        },
        payload: JSON.stringify({ enabled }),
      })
      assert.equal(response.statusCode, 200, response.body)
    }
    await setAcademic(false)
    // Bildirim merkezi açık, ama türün modülü kapalı: liste ve okunmamış sayısı boş.
    assert.deepEqual(await seen(parent.cookie), [])
    assert.equal(await unread(), 0)
    assert.equal((await stored(a.id)).length, 1)
    await setAcademic(true)
    assert.equal((await seen(parent.cookie)).length, 1)
  })

  test('DOM-ILT-052: yoklama reddedilirse (eksik işaret, yetkisiz rol) hiçbir bildirim yazılmaz', async () => {
    const a = await institution()
    const parent = await account(a.id, 'veli', first.id)
    const cookie = await teacher(a.id)
    const partial = Object.fromEntries(Object.entries(marks({ [first.id]: 'absent' })).slice(0, 1))
    assertError(await save(cookie, { marks: partial }), 422, 'attendance_incomplete')
    assertError(await save(parent.cookie, { marks: marks() }), 403, 'forbidden')
    assertError(
      await save(await member(a.id, 'ogrenci', [{ kind: 'student', recordId: first.id }]), {
        marks: marks({ [first.id]: 'absent' }),
      }),
      403,
      'forbidden',
    )
    assert.deepEqual(await seen(parent.cookie), [])
    assert.deepEqual(await stored(a.id), [])
  })
})
