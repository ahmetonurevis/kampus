import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { records } from '../src/db/schema/records.ts'
import { studentGuardians } from '../src/db/schema/student-guardians.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import { defineFileAttachment } from '../src/services/file-registry.ts'
import { attachFile, recordFileCheck } from '../src/services/files.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
import { findMembership } from '../src/services/memberships.ts'
import { notify } from '../src/services/notify.ts'
import { readScope } from '../src/services/read-scope.ts'
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
import { multipart, PDF, tempStorage, uploadParts } from './support/files-sample.ts'
import { seedResource } from './support/resources-sample.ts'

/**
 * Velayet ve iletişim kısıtının okuma kapsamı (IST-019, OG-032; docs/domain/iletisim-ve-veli.md
 * DOM-ILT-070, DOM-ILT-074). Kapsam aktörün bağlantıları kurulurken daralır
 * (`services/memberships.ts` `listMembershipLinks`, core `guardedActorLinks`): kısıtlı ya da
 * velayeti olmayan veli öğrenciyi `/me` çocuk listesinde, not ve yoklama koleksiyonunda,
 * yazışmada, bildirimde, panoda ve bağlı dosyada görmez; kısıt kalkınca yeniden görür.
 */

type Json = ReturnType<typeof JSON.parse>

const SEED = createSeed(FIXED_NOW)

/**
 * Testin bağlı kayıt türü: dosya bağlı öğrenciyi okuma kapsamında görebilene açılır. Kapsam
 * işlemin bağlantısıyla kurulur (PGlite tek bağlantılıdır; `ctx.db` açık işlemi beklerdi).
 */
const STUDENT_DOCUMENT = 'test_student_document'
defineFileAttachment(STUDENT_DOCUMENT, {
  purposes: ['document'],
  canRead: async (tx, ctx, studentId) =>
    (await readScope({ ...ctx, db: tx })).studentIds.has(studentId),
})

describe('velayet ve iletişim kısıtı okuma kapsamı', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, { storage: store.storage, clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  function call(method: 'GET' | 'POST' | 'PATCH', url: string, cookie: string, payload?: unknown) {
    return app.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        ...(method === 'GET' ? {} : { 'idempotency-key': randomUUID() }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const get = (cookie: string, url: string) => call('GET', url, cookie)
  async function data(cookie: string, url: string) {
    const response = await get(cookie, url)
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`)
    return response.json().data as Json
  }

  /**
   * Örnek kesit (`s1` 7-A, `s2`); anne Ayşe `s1` ve `s2`'nin, baba yalnız `s1`'in velayetli
   * velisidir (üyelik bağlantısıyla açılan bağ). Selin Kaya (`t1`) `s1`'in sınıf rehberidir.
   */
  async function world() {
    const institution = await createInstitution(app)
    await insertMissingRecords(db, institution.id, sampleRows(), FIXED_NOW)
    const member = async (role: Role, links: MembershipLinkInput[] = []) => {
      const user = await createMember(app, institution.id, role, links)
      return { ...user, cookie: await signInAs(app, user) }
    }
    const admin = { ...institution.admin, cookie: await signInAs(app, institution.admin) }
    const mother = await member('veli', [
      { kind: 'child', recordId: 's1' },
      { kind: 'child', recordId: 's2' },
    ])
    const father = await member('veli', [{ kind: 'child', recordId: 's1' }])
    const teacher = await member('ogretmen', [{ kind: 'teacher', recordId: 't1' }])
    const membership = await findMembership(db, institution.id, admin.id)
    assert.ok(membership)
    const ctx: ServiceContext = {
      db,
      institutionId: institution.id,
      actor: { userId: admin.id, role: 'yonetici', membershipId: membership.id },
      now: FIXED_NOW,
      log: app.log,
    }
    return { institution, admin, mother, father, teacher, ctx }
  }
  type World = Awaited<ReturnType<typeof world>>

  /** Annenin `s1` bağını değiştirir (yönetici, sürüm kilidiyle). */
  async function setMotherBond(w: World, body: Record<string, unknown>) {
    const bonds = (await data(w.admin.cookie, '/api/v1/students/s1/guardians')) as Json[]
    const own = bonds.find((bond) => bond.membershipId === w.mother.membershipId)
    assert.ok(own)
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/students/s1/guardians/${own.id}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie: w.admin.cookie,
        'content-type': 'application/json',
        'if-match': `"${own.rowVersion}"`,
      },
      payload: JSON.stringify(body),
    })
    assert.equal(response.statusCode, 200, response.body)
  }
  const restrict = (w: World) => setMotherBond(w, { custody: 'none', contactRestricted: true })
  const lift = (w: World) => setMotherBond(w, { custody: 'joint', contactRestricted: false })

  const children = async (cookie: string) =>
    ((await data(cookie, '/api/v1/me')).activeMembership.links as Json[])
      .filter((link) => link.kind === 'child')
      .map((link) => link.recordId as string)
      .sort()
  const studentIdsOf = async (cookie: string, collection: string) =>
    [
      ...new Set(
        ((await data(cookie, `/api/v1/collections/${collection}?pageSize=100`)) as Json[]).map(
          (row) => row.record.studentId as string,
        ),
      ),
    ].sort()

  test('IST-019 DOM-ILT-074 kısıtlı veli /me çocuk listesinde, not, yoklama ve panoda öğrenciyi görmez; kısıt kalkınca yeniden görür', async () => {
    const w = await world()
    assert.deepEqual(await children(w.mother.cookie), ['s1', 's2'])
    assert.deepEqual(await studentIdsOf(w.mother.cookie, 'grades'), ['s1', 's2'])
    assert.deepEqual(await studentIdsOf(w.mother.cookie, 'attendance'), ['s1', 's2'])
    assert.equal((await get(w.mother.cookie, '/api/v1/dashboard?studentId=s1')).statusCode, 200)

    await restrict(w)
    assert.deepEqual(await children(w.mother.cookie), ['s2'])
    assert.deepEqual(await studentIdsOf(w.mother.cookie, 'grades'), ['s2'])
    assert.deepEqual(await studentIdsOf(w.mother.cookie, 'attendance'), ['s2'])
    assert.equal((await get(w.mother.cookie, '/api/v1/collections/students/s1')).statusCode, 404)
    assert.equal((await get(w.mother.cookie, '/api/v1/dashboard?studentId=s1')).statusCode, 404)
    assert.equal((await get(w.mother.cookie, '/api/v1/dashboard?studentId=s2')).statusCode, 200)
    // Velayetli öbür veli etkilenmez.
    assert.deepEqual(await children(w.father.cookie), ['s1'])
    assert.deepEqual(await studentIdsOf(w.father.cookie, 'grades'), ['s1'])

    await lift(w)
    assert.deepEqual(await children(w.mother.cookie), ['s1', 's2'])
    assert.deepEqual(await studentIdsOf(w.mother.cookie, 'grades'), ['s1', 's2'])
    assert.equal((await get(w.mother.cookie, '/api/v1/dashboard?studentId=s1')).statusCode, 200)
  })

  test('IST-019 DOM-ILT-070 velayeti olmayan kısıtsız veli de öğrenciyi görmez (varsayılan erişimsiz)', async () => {
    const w = await world()
    await setMotherBond(w, { custody: 'none' })
    assert.deepEqual(await children(w.mother.cookie), ['s2'])
    assert.deepEqual(await studentIdsOf(w.mother.cookie, 'grades'), ['s2'])
    assert.equal((await get(w.mother.cookie, '/api/v1/dashboard?studentId=s1')).statusCode, 404)
    await setMotherBond(w, { custody: 'full' })
    assert.deepEqual(await children(w.mother.cookie), ['s1', 's2'])
  })

  test('IST-019 DOM-KYN-041 kısıtlı veli çocuğa paylaşılan kaynağı görmez, studentId ile 404; velayetli veli etkilenmez, kısıt kalkınca yeniden görür', async () => {
    const w = await world()
    // `s1` 7-A (7. sınıf), `s2` 5-A (5. sınıf).
    const shared = (studentId: string, grade: number) =>
      seedResource(db, w.institution.id, {
        ownerUserId: w.admin.id,
        shareScope: 'students',
        sharedStudentIds: [studentId],
        versions: [{ status: 'published', input: { tags: { gradeLevels: [grade] } } }],
      })
    const deniz = (await shared('s1', 7)).resource.id
    const ece = (await shared('s2', 5)).resource.id
    const ids = async (cookie: string, query = '') =>
      ((await data(cookie, `/api/v1/resources${query}`)) as Json[]).map((row) => row.id).sort()
    assert.deepEqual(await ids(w.mother.cookie, '?studentId=s1'), [deniz])
    assert.deepEqual(await ids(w.mother.cookie, '?studentId=s2'), [ece])

    await restrict(w)
    assert.equal((await get(w.mother.cookie, '/api/v1/resources?studentId=s1')).statusCode, 404)
    assert.equal((await get(w.mother.cookie, `/api/v1/resources/${deniz}`)).statusCode, 404)
    assert.deepEqual(await ids(w.mother.cookie), [ece])
    assert.deepEqual(await ids(w.mother.cookie, '?studentId=s2'), [ece])
    // Velayetli baba etkilenmez; bağlı olmadığı Ece'yi seçemez.
    assert.deepEqual(await ids(w.father.cookie, '?studentId=s1'), [deniz])
    assert.equal((await get(w.father.cookie, '/api/v1/resources?studentId=s2')).statusCode, 404)

    await lift(w)
    assert.deepEqual(await ids(w.mother.cookie, '?studentId=s1'), [deniz])

    // Velayeti olmayan kısıtsız veli de çocuğu seçemez (DOM-ILT-070 varsayılan erişimsiz).
    await setMotherBond(w, { custody: 'none' })
    assert.equal((await get(w.mother.cookie, '/api/v1/resources?studentId=s1')).statusCode, 404)
    assert.equal((await get(w.mother.cookie, `/api/v1/resources/${deniz}`)).statusCode, 404)
    assert.deepEqual(await ids(w.mother.cookie), [ece])
  })

  test('IST-019 DOM-ILT-074 kısıtlı veli yazışmasını görmez; öğretmenin veli listesinde yoktur, yazışma başlatılamaz', async () => {
    const w = await world()
    const accounts = async () =>
      ((await data(w.teacher.cookie, '/api/v1/students/s1/parent-accounts')) as Json[])
        .map((item) => item.userId as string)
        .sort()
    assert.deepEqual(await accounts(), [w.mother.id, w.father.id].sort())
    const start = (parentUserId: string) =>
      call('POST', '/api/v1/conversations', w.teacher.cookie, {
        studentId: 's1',
        audience: 'parent',
        parentUserId,
        text: 'Merhaba',
      })
    const opened = await start(w.mother.id)
    assert.equal(opened.statusCode, 201, opened.body)
    const conversationId = opened.json().data.entity.id as string
    const total = async () =>
      (await get(w.mother.cookie, '/api/v1/conversations')).json().meta.total
    assert.equal(await total(), 1)

    await restrict(w)
    assert.equal(await total(), 0)
    assert.equal(
      (await get(w.mother.cookie, `/api/v1/conversations/${conversationId}/messages`)).statusCode,
      404,
    )
    const reply = await call(
      'POST',
      `/api/v1/conversations/${conversationId}/messages`,
      w.mother.cookie,
      { text: 'Yanıt' },
    )
    // Kısıtlı veli yazışmanın tarafı değildir: varlığı da sızmaz.
    assert.equal(reply.statusCode, 404, reply.body)
    assert.equal(reply.json().code, 'not_found')
    // Öğretmen kısıtlı veliyi listede görmez ve onunla yeni yazışma açamaz: veli seçimi
    // erişimli hesaplardan yapılır (core `parentUserFor`).
    assert.deepEqual(await accounts(), [w.father.id])
    const denied = await start(w.mother.id)
    assert.equal(denied.statusCode, 422, denied.body)
    assert.equal(denied.json().code, 'parent_account_not_found')
    assert.equal((await start(w.father.id)).statusCode, 201)

    await lift(w)
    assert.equal(await total(), 1)
    assert.deepEqual(await accounts(), [w.mother.id, w.father.id].sort())
  })

  test('IST-019 DOM-ILT-074 öğretmen kısıtlı ya da velayeti kalkan veliyle açık yazışmaya yazamaz; kısıt kalkınca yazar', async () => {
    const w = await world()
    const opened = await call('POST', '/api/v1/conversations', w.teacher.cookie, {
      studentId: 's1',
      audience: 'parent',
      parentUserId: w.mother.id,
      text: 'Merhaba',
    })
    assert.equal(opened.statusCode, 201, opened.body)
    const conversationId = opened.json().data.entity.id as string
    const send = (text: string) =>
      call('POST', `/api/v1/conversations/${conversationId}/messages`, w.teacher.cookie, { text })
    const messages = async () =>
      ((await data(w.teacher.cookie, `/api/v1/conversations/${conversationId}/messages`)) as Json[])
        .length
    assert.equal((await send('Bir')).statusCode, 201)
    assert.equal(await messages(), 2)

    for (const bond of [
      { custody: 'none', contactRestricted: true },
      { custody: 'none', contactRestricted: false },
    ]) {
      await setMotherBond(w, bond)
      const denied = await send('Kısıt döneminde')
      assert.equal(denied.statusCode, 403, denied.body)
      assert.equal(denied.json().code, 'conversation_parent_restricted')
      // Yazışma öğretmene salt okur kalır; mesaj eklenmez.
      assert.equal(await messages(), 2)
    }
    // Aynı öğrencinin velayetli babasıyla yazışma etkilenmez.
    const father = await call('POST', '/api/v1/conversations', w.teacher.cookie, {
      studentId: 's1',
      audience: 'parent',
      parentUserId: w.father.id,
      text: 'Merhaba',
    })
    assert.equal(father.statusCode, 201, father.body)

    await lift(w)
    assert.equal((await send('Kısıt kalktı')).statusCode, 201)
    assert.equal(await messages(), 3)
  })

  /** Yayımlanmış rıza metni ve veliden rıza (öğrenci 18 yaş altı sayılır). */
  async function consentText(w: World, purpose: string) {
    const response = await call('POST', '/api/v1/privacy-notices', w.admin.cookie, {
      kind: 'consent_text',
      purpose,
      title: 'Rıza metni',
      body: 'Açık rıza metni.',
    })
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data.id as string
  }
  async function giveConsent(cookie: string, purpose: string, textId: string) {
    const response = await call('POST', '/api/v1/consents', cookie, {
      purpose,
      studentId: 's1',
      textId,
      decision: 'granted',
      channel: 'web',
    })
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data.id as string
  }
  const consentIds = async (cookie: string, url: string) =>
    ((await data(cookie, url)) as Json[]).map((row) => row.id as string).sort()

  test('IST-019 DOM-ILT-071 DOM-YTK-059 velayeti kalkan veli kendi rızasını listede görür ve geri çeker; başkasının rızasını görmez', async () => {
    const w = await world()
    const sharing = await consentText(w, 'photo_video_sharing')
    const speaking = await consentText(w, 'speaking_recording')
    const own = await giveConsent(w.mother.cookie, 'photo_video_sharing', sharing)
    const fathers = await giveConsent(w.father.cookie, 'speaking_recording', speaking)

    await restrict(w)
    // Kapsam dışı öğrenci için yalnız kendi açık satırı; babanınki ve öğrenci verisi yok.
    const scoped = (await data(w.mother.cookie, '/api/v1/consents?studentId=s1')) as Json[]
    assert.deepEqual(
      scoped.map((row) => [row.id, row.subjectKind, row.subjectId, row.canWithdraw]),
      [[own, 'student', 's1', true]],
    )
    assert.equal(scoped[0].grantedByUserId, undefined)
    assert.deepEqual(
      await consentIds(w.mother.cookie, '/api/v1/consents?studentId=s1&status=all'),
      [own],
    )
    assert.deepEqual(
      await consentIds(w.mother.cookie, '/api/v1/consents?studentId=s1&purpose=speaking_recording'),
      [],
    )
    // Hesap listesi de kapsam dışı öğrencideki kendi satırını taşır (ekrandan geri çekme).
    assert.deepEqual(await consentIds(w.mother.cookie, '/api/v1/consents'), [own])
    // Kendi satırı olmayan kapsam dışı öğrenci ve olmayan öğrenci aynı 404.
    for (const studentId of ['s3', 'olmayan-ogrenci']) {
      const missing = await get(w.mother.cookie, `/api/v1/consents?studentId=${studentId}`)
      assert.equal(missing.statusCode, 404, missing.body)
      assert.equal(missing.json().code, 'not_found')
    }
    // Rızanın geçerlilik sonucu da kapsam dışıdır.
    assert.equal(
      (await get(w.mother.cookie, '/api/v1/consents/status?studentId=s1')).statusCode,
      404,
    )
    // Başkasının rızasını geri çekemez (404); kendi rızasını çeker.
    const foreign = await call('POST', `/api/v1/consents/${fathers}/withdraw`, w.mother.cookie, {})
    assert.equal(foreign.statusCode, 404, foreign.body)
    const withdrawn = await call('POST', `/api/v1/consents/${own}/withdraw`, w.mother.cookie, {})
    assert.equal(withdrawn.statusCode, 200, withdrawn.body)
    assert.equal(withdrawn.json().data.withdrawalReason, 'withdrawn')
    // Açık satırı kalmayınca kapsam dışı öğrenci yeniden 404; hesap listesinde de yok.
    const after = await get(w.mother.cookie, '/api/v1/consents?studentId=s1&status=all')
    assert.equal(after.statusCode, 404, after.body)
    assert.deepEqual(await consentIds(w.mother.cookie, '/api/v1/consents'), [])
    // Velayetli baba ikisini de geçmişte görür; annenin satırını geri çekmiş görür.
    assert.deepEqual(
      await consentIds(w.father.cookie, '/api/v1/consents?studentId=s1&status=all'),
      [own, fathers].sort(),
    )
    assert.deepEqual(await consentIds(w.father.cookie, '/api/v1/consents?studentId=s1'), [fathers])
  })

  test('IST-019 DOM-ILT-070 kapsamdaki veli kendi rızasını yalnız çocuğun listesinde görür; hesap listesinde yinelenmez', async () => {
    const w = await world()
    const sharing = await consentText(w, 'photo_video_sharing')
    const own = await giveConsent(w.mother.cookie, 'photo_video_sharing', sharing)
    assert.deepEqual(await consentIds(w.mother.cookie, '/api/v1/consents?studentId=s1'), [own])
    assert.deepEqual(await consentIds(w.mother.cookie, '/api/v1/consents'), [])
  })

  test('IST-019 DOM-ILT-074 kısıtlı veliye bildirim ulaşmaz; okunmamış sayısı da sıfırdır', async () => {
    const w = await world()
    await restrict(w)
    const result = await db.transaction((tx) =>
      notify(tx, w.ctx, {
        type: 'feedback_released',
        recipients: { studentIds: ['s1'] },
        data: { submissionId: 'sub-1' },
      }),
    )
    assert.ok(result)
    const seen = async (cookie: string) =>
      ((await data(cookie, '/api/v1/notifications')) as Json[]).filter(
        (item) => item.studentId === 's1',
      ).length
    const unread = async (cookie: string) =>
      (await data(cookie, '/api/v1/notifications/unread-count')).unread as number
    assert.equal(await seen(w.father.cookie), 1)
    assert.equal(await unread(w.father.cookie), 1)
    assert.equal(await seen(w.mother.cookie), 0)
    assert.equal(await unread(w.mother.cookie), 0)
  })

  test('IST-019 DOM-ILT-074 kısıtlı veliye gelen bildirim kısıt kalkınca görünür (bugünkü davranış; kısıt dönemi süzülmez)', async () => {
    const w = await world()
    await restrict(w)
    await db.transaction((tx) =>
      notify(tx, w.ctx, {
        type: 'feedback_released',
        recipients: { studentIds: ['s1'] },
        data: { submissionId: 'sub-kisit' },
      }),
    )
    const seen = async () =>
      ((await data(w.mother.cookie, '/api/v1/notifications')) as Json[]).filter(
        (item) => item.studentId === 's1',
      ).length
    assert.equal(await seen(), 0)
    // DOM-ILT-074 açık soru: kısıt döneminde üretilen bildirim kısıt kalkınca açılır.
    await lift(w)
    assert.equal(await seen(), 1)
  })

  test('IST-019 DOM-ILT-074 kısıtlı veli fatura, tahsilat ve randevu okumasında öğrenciyi görmez', async () => {
    const w = await world()
    await insertMissingRecords(
      db,
      w.institution.id,
      [
        {
          collection: 'invoices',
          id: 'test-inv-kisit',
          data: {
            id: 'test-inv-kisit',
            studentId: 's1',
            installment: 9,
            amount: 10_000,
            dueDate: '2026-11-15T09:00:00.000Z',
            paidAt: null,
            method: null,
            reminderAt: null,
          },
        },
        ...SEED.appointments
          .filter((item) => item.studentId === 's1')
          .map((item) => ({ collection: 'appointments' as const, id: item.id, data: item })),
      ],
      FIXED_NOW,
    )
    const paid = await call('POST', '/api/v1/payments', w.admin.cookie, {
      studentId: 's1',
      amountCents: 1_000,
      method: 'Banka havalesi',
      reference: 'TR-KISIT-1',
    })
    assert.equal(paid.statusCode, 201, paid.body)
    const paymentId = paid.json().data.id as string
    const payments = async (cookie: string) =>
      ((await data(cookie, '/api/v1/payments')) as Json[]).map((row) => row.id as string)
    const appointments = (cookie: string) => studentIdsOf(cookie, 'appointments')
    assert.ok((await studentIdsOf(w.mother.cookie, 'invoices')).includes('s1'))
    assert.deepEqual(await payments(w.mother.cookie), [paymentId])
    assert.deepEqual(await appointments(w.mother.cookie), ['s1'])

    await restrict(w)
    assert.ok(!(await studentIdsOf(w.mother.cookie, 'invoices')).includes('s1'))
    assert.deepEqual(await payments(w.mother.cookie), [])
    const detail = await get(w.mother.cookie, `/api/v1/payments/${paymentId}`)
    assert.equal(detail.statusCode, 404, detail.body)
    assert.deepEqual(await appointments(w.mother.cookie), [])
    // Velayetli baba etkilenmez.
    assert.deepEqual(await payments(w.father.cookie), [paymentId])
    assert.deepEqual(await appointments(w.father.cookie), ['s1'])
  })

  test('IST-019 DOM-ILT-074 kısıtlı veli childId ile iş akışında çocuğun kayıt durumunu öğrenemez: etkin, pasif ve olmayan öğrenci aynı 403', async () => {
    const w = await world()
    const event = SEED.schoolEvents.find((item) => item.id === 'event-science')
    assert.ok(event)
    await insertMissingRecords(
      db,
      w.institution.id,
      [{ collection: 'schoolEvents', id: event.id, data: event }],
      FIXED_NOW,
    )
    const consent = (cookie: string, childId: string) =>
      call('POST', `/api/v1/workflows/consent/${event.id}?childId=${childId}`, cookie, {
        decision: 'Onaylandı',
      })
    const denied = async (childId: string) => {
      const response = await consent(w.mother.cookie, childId)
      assert.equal(response.statusCode, 403, `${childId}: ${response.body}`)
      assert.equal(response.json().code, 'student_scope_denied')
    }
    await restrict(w)
    await denied('s1')
    await denied('olmayan-ogrenci')
    const s1 = SEED.students.find((item) => item.id === 's1')
    assert.ok(s1)
    await db
      .update(records)
      .set({ data: { ...s1, isActive: false } })
      .where(
        and(
          eq(records.institutionId, w.institution.id),
          eq(records.collection, 'students'),
          eq(records.id, 's1'),
        ),
      )
    await denied('s1')
    // Velayetli baba kendi çocuğunun pasif olduğunu görür (422).
    const father = await consent(w.father.cookie, 's1')
    assert.equal(father.statusCode, 422, father.body)
    assert.equal(father.json().code, 'record_inactive')
  })

  test('IST-019 DOM-ILT-071 bağı kaldırılan (arşivli) veli öğrenciyi görmez', async () => {
    const w = await world()
    const bonds = (await data(w.admin.cookie, '/api/v1/students/s1/guardians')) as Json[]
    const own = bonds.find((bond) => bond.membershipId === w.mother.membershipId)
    assert.ok(own)
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/students/s1/guardians/${own.id}`,
      headers: { origin: TEST_ORIGIN, cookie: w.admin.cookie, 'if-match': `"${own.rowVersion}"` },
    })
    assert.equal(removed.statusCode, 200, removed.body)
    assert.ok(removed.json().data.archivedAt)
    assert.deepEqual(await children(w.mother.cookie), ['s2'])
    assert.deepEqual(await studentIdsOf(w.mother.cookie, 'grades'), ['s2'])
    assert.equal((await get(w.mother.cookie, '/api/v1/dashboard?studentId=s1')).statusCode, 404)
    assert.deepEqual(await children(w.father.cookie), ['s1'])
  })

  test('IST-019 DOM-ILT-070 student_guardians bağı olmayan çocuk bağlantısı kapsam vermez (kapalı başarısız)', async () => {
    const w = await world()
    await db
      .delete(studentGuardians)
      .where(
        and(
          eq(studentGuardians.institutionId, w.institution.id),
          eq(studentGuardians.studentId, 's1'),
          eq(studentGuardians.membershipId, w.mother.membershipId),
        ),
      )
    assert.deepEqual(await children(w.mother.cookie), ['s2'])
    assert.deepEqual(await studentIdsOf(w.mother.cookie, 'grades'), ['s2'])
    assert.equal((await get(w.mother.cookie, '/api/v1/collections/students/s1')).statusCode, 404)
    assert.deepEqual(await children(w.father.cookie), ['s1'])
  })

  test('IST-019 DOM-ILT-074 öğrenciye bağlı dosya kısıtlı veliye 404; kısıt kalkınca açılır', async () => {
    const w = await world()
    const body = multipart(uploadParts('document', PDF))
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        cookie: w.admin.cookie,
        'content-type': body.contentType,
        'idempotency-key': randomUUID(),
      },
      payload: body.payload,
    })
    assert.equal(uploaded.statusCode, 201, uploaded.body)
    const fileId = uploaded.json().data.id as string
    await recordFileCheck(db, store.storage, {
      institutionId: w.institution.id,
      fileId,
      outcome: 'ready',
      now: FIXED_NOW,
      log: app.log,
    })
    await db.transaction((tx) =>
      attachFile(tx, w.ctx, {
        fileId,
        attachedType: STUDENT_DOCUMENT,
        attachedId: 's1',
        dataSubjectId: 's1',
      }),
    )
    const status = async () => (await get(w.mother.cookie, `/api/v1/files/${fileId}`)).statusCode
    assert.equal(await status(), 200)
    await restrict(w)
    assert.equal(await status(), 404)
    assert.equal((await get(w.father.cookie, `/api/v1/files/${fileId}`)).statusCode, 200)
    await lift(w)
    assert.equal(await status(), 200)
  })
})
