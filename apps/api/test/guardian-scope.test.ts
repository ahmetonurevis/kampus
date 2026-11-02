import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
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

/**
 * Velayet ve iletişim kısıtının okuma kapsamı (IST-019, OG-032; docs/domain/iletisim-ve-veli.md
 * DOM-ILT-070, DOM-ILT-074). Kapsam aktörün bağlantıları kurulurken daralır
 * (`services/memberships.ts` `listMembershipLinks`, core `guardedActorLinks`): kısıtlı ya da
 * velayeti olmayan veli öğrenciyi `/me` çocuk listesinde, not ve yoklama koleksiyonunda,
 * yazışmada, bildirimde, panoda ve bağlı dosyada görmez; kısıt kalkınca yeniden görür.
 */

type Json = ReturnType<typeof JSON.parse>

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
    assert.ok([403, 404].includes(reply.statusCode), reply.body)
    // Öğretmen kısıtlı veliyi listede görmez ve onunla yeni yazışma açamaz.
    assert.deepEqual(await accounts(), [w.father.id])
    const denied = await start(w.mother.id)
    assert.ok([403, 404, 422].includes(denied.statusCode), denied.body)
    assert.equal((await start(w.father.id)).statusCode, 201)

    await lift(w)
    assert.equal(await total(), 1)
    assert.deepEqual(await accounts(), [w.mother.id, w.father.id].sort())
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
