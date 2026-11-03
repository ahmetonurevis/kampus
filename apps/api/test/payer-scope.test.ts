import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
import { findMembership, listActorLinks, listMembershipLinks } from '../src/services/memberships.ts'
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

/**
 * Ödeyici velinin kapsamı (OG-1002, iş isteği #33, K-04 kullanıcı kararı 2026-11-03;
 * DOM-ILT-070, DOM-ILT-074). Velayeti olmayan ödeyici veli aktöre `payer` bağlantısıyla taşınır
 * (`listActorLinks`): okuma kapsamında yalnız `payerStudentIds` kümesine girer ve finans türü
 * bildirimi görür. Akademik, iletişim ve rıza okumaları ile `/me` çocuk listesi velayet
 * bağlantısında kalır. Finans koleksiyonlarının okuma kuralı Onur'undur (ON-291).
 */

type Json = ReturnType<typeof JSON.parse>

describe('ödeyici velinin kapsamı (OG-1002, K-04)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
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
   * Örnek kesit (`s1` 7-A, `s2`): anne Ayşe `s1` ve `s2`'nin, baba yalnız `s1`'in velisidir;
   * ikisi de üyelik bağlantısıyla velayetli açılır, ödeyici değildir.
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
    const membership = await findMembership(db, institution.id, admin.id)
    assert.ok(membership)
    const ctx: ServiceContext = {
      db,
      institutionId: institution.id,
      actor: { userId: admin.id, role: 'yonetici', membershipId: membership.id },
      now: FIXED_NOW,
      log: app.log,
    }
    const parentCtx = (parent: typeof mother): ServiceContext => ({
      ...ctx,
      actor: { userId: parent.id, role: 'veli', membershipId: parent.membershipId },
    })
    return { institution, admin, mother, father, ctx, parentCtx }
  }
  type World = Awaited<ReturnType<typeof world>>

  async function setBond(w: World, membershipId: string, body: Record<string, unknown>) {
    const bonds = (await data(w.admin.cookie, '/api/v1/students/s1/guardians')) as Json[]
    const own = bonds.find((bond) => bond.membershipId === membershipId)
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
  /** Anne `s1`'de velayetsiz ödeyici olur; baba velayetli kalır (DOM-ILT-075). */
  const payerOnly = (w: World) =>
    setBond(w, w.mother.membershipId, { custody: 'none', isPayer: true })

  const meLinks = async (cookie: string) =>
    ((await data(cookie, '/api/v1/me')).activeMembership.links as Json[])
      .map((link) => `${link.kind}:${link.recordId}`)
      .sort()
  const studentIdsOf = async (cookie: string, collection: string) =>
    [
      ...new Set(
        ((await data(cookie, `/api/v1/collections/${collection}?pageSize=100`)) as Json[]).map(
          (row) => row.record.studentId as string,
        ),
      ),
    ].sort()

  async function notifyBoth(w: World, tag: string) {
    await db.transaction(async (tx) => {
      await notify(tx, w.ctx, {
        type: 'payment_received',
        recipients: { studentIds: ['s1'] },
        data: { paymentId: `test-pay-${tag}` },
      })
      await notify(tx, w.ctx, {
        type: 'feedback_released',
        recipients: { studentIds: ['s1'] },
        data: { submissionId: `test-sub-${tag}` },
      })
    })
  }
  const kindsSeen = async (cookie: string) =>
    ((await data(cookie, '/api/v1/notifications')) as Json[])
      .filter((item) => item.studentId === 's1')
      .map((item) => item.kind as string)
      .sort()
  const unread = async (cookie: string) =>
    (await data(cookie, '/api/v1/notifications/unread-count')).unread as number

  test('OG-1002 DOM-ILT-074 velayetsiz ödeyici veli aktörde ödeyici bağlantısı alır; /me ve velayet bağlantıları değişmez', async () => {
    const w = await world()
    await payerOnly(w)
    const actorLinks = await listActorLinks(db, w.institution.id, w.mother.membershipId)
    assert.deepEqual(actorLinks.map((link) => `${link.kind}:${link.recordId}`).sort(), [
      'child:s2',
      'payer:s1',
    ])
    assert.deepEqual(
      (await listMembershipLinks(db, w.institution.id, w.mother.membershipId)).map(
        (link) => `${link.kind}:${link.recordId}`,
      ),
      ['child:s2'],
    )
    // `/me` istemciye ödeyici bağlantısı göndermez; çocuk listesi velayettir.
    assert.deepEqual(await meLinks(w.mother.cookie), ['child:s2'])
    const scope = await readScope(w.parentCtx(w.mother))
    assert.deepEqual([...scope.studentIds].sort(), ['s2'])
    assert.deepEqual([...scope.payerStudentIds], ['s1'])
    // Personel ve velayetli ödeyici olmayan velide ödeyici kümesi boştur.
    assert.deepEqual([...(await readScope(w.ctx)).payerStudentIds], [])
    assert.deepEqual([...(await readScope(w.parentCtx(w.father))).payerStudentIds], [])
  })

  test('OG-1002 DOM-ILT-070 velayetsiz ödeyici veli not, yoklama, ödev, öğrenci kaydı ve panoda öğrenciyi görmez', async () => {
    const w = await world()
    await payerOnly(w)
    assert.deepEqual(await studentIdsOf(w.mother.cookie, 'grades'), ['s2'])
    assert.deepEqual(await studentIdsOf(w.mother.cookie, 'attendance'), ['s2'])
    assert.ok(!(await studentIdsOf(w.mother.cookie, 'submissions')).includes('s1'))
    assert.equal((await get(w.mother.cookie, '/api/v1/collections/students/s1')).statusCode, 404)
    assert.equal((await get(w.mother.cookie, '/api/v1/dashboard?studentId=s1')).statusCode, 404)
    assert.equal((await get(w.mother.cookie, '/api/v1/dashboard?studentId=s2')).statusCode, 200)
    // Velayetli baba etkilenmez.
    assert.deepEqual(await studentIdsOf(w.father.cookie, 'grades'), ['s1'])
  })

  test('OG-1002 DOM-ILT-070 velayetsiz ödeyici veli yazışma, randevu ve rıza okumasında öğrenciyi görmez', async () => {
    const w = await world()
    await payerOnly(w)
    assert.equal((await get(w.mother.cookie, '/api/v1/conversations')).json().meta.total, 0)
    assert.ok(!(await studentIdsOf(w.mother.cookie, 'appointments')).includes('s1'))
    const consents = await get(w.mother.cookie, '/api/v1/consents?studentId=s1')
    assert.equal(consents.statusCode, 404, consents.body)
    const status = await get(w.mother.cookie, '/api/v1/consents/status?studentId=s1')
    assert.equal(status.statusCode, 404, status.body)
    // Rıza da veremez: velayet bağlantısı yoktur (DOM-YTK-057).
    const text = await call('POST', '/api/v1/privacy-notices', w.admin.cookie, {
      kind: 'consent_text',
      purpose: 'photo_video_sharing',
      title: 'Rıza metni',
      body: 'Açık rıza metni.',
    })
    assert.equal(text.statusCode, 201, text.body)
    const given = await call('POST', '/api/v1/consents', w.mother.cookie, {
      purpose: 'photo_video_sharing',
      studentId: 's1',
      textId: text.json().data.id,
      decision: 'granted',
      channel: 'web',
    })
    assert.equal(given.statusCode, 403, given.body)
    assert.equal(given.json().code, 'consent_custody_required')
  })

  test('OG-1002 DOM-ILT-074 ödeyici veli finans bildirimini görür ve okur; diğer türler velayetli veliye kalır', async () => {
    const w = await world()
    await payerOnly(w)
    await notifyBoth(w, 'a')
    assert.deepEqual(await kindsSeen(w.mother.cookie), ['payment_received'])
    assert.equal(await unread(w.mother.cookie), 1)
    assert.deepEqual(await kindsSeen(w.father.cookie), ['feedback_released', 'payment_received'])

    const [item] = (await data(w.mother.cookie, '/api/v1/notifications')) as Json[]
    assert.ok(item)
    const read = await call('POST', `/api/v1/notifications/${item.id}/read`, w.mother.cookie, {})
    assert.equal(read.statusCode, 200, read.body)
    assert.equal(await unread(w.mother.cookie), 0)
    // Velayet bildirimi ödeyiciye okuma ucundan da açılmaz (404, varlık sızmaz).
    const fatherItems = (await data(w.father.cookie, '/api/v1/notifications')) as Json[]
    const feedback = fatherItems.find((row) => row.kind === 'feedback_released')
    assert.ok(feedback)
    const denied = await call(
      'POST',
      `/api/v1/notifications/${feedback.id}/read`,
      w.mother.cookie,
      {},
    )
    assert.equal(denied.statusCode, 404, denied.body)

    await notifyBoth(w, 'b')
    assert.equal(await unread(w.mother.cookie), 1)
    const all = await call('POST', '/api/v1/notifications/read-all', w.mother.cookie, {})
    assert.equal(all.statusCode, 200, all.body)
    assert.equal(await unread(w.mother.cookie), 0)
    // Babanın okundu durumu etkilenmez (DOM-ILT-073).
    assert.equal(await unread(w.father.cookie), 4)
  })

  test('OG-1002 DOM-ILT-074 ödeyici işareti kalkınca finans bildirimi ve ödeyici kümesi kapanır', async () => {
    const w = await world()
    await payerOnly(w)
    await notifyBoth(w, 'c')
    assert.deepEqual(await kindsSeen(w.mother.cookie), ['payment_received'])
    await setBond(w, w.mother.membershipId, { isPayer: false })
    assert.deepEqual(await kindsSeen(w.mother.cookie), [])
    assert.equal(await unread(w.mother.cookie), 0)
    assert.deepEqual([...(await readScope(w.parentCtx(w.mother))).payerStudentIds], [])
  })

  test('OG-1002 DOM-ILT-070 velayetli ödeyici veli çift bağlantıyla aynı akademik kapsamı ve bütün bildirimleri görür', async () => {
    const w = await world()
    const before = await studentIdsOf(w.father.cookie, 'grades')
    await setBond(w, w.father.membershipId, { isPayer: true })
    assert.deepEqual(await studentIdsOf(w.father.cookie, 'grades'), before)
    assert.deepEqual(await meLinks(w.father.cookie), ['child:s1'])
    await notifyBoth(w, 'd')
    assert.deepEqual(await kindsSeen(w.father.cookie), ['feedback_released', 'payment_received'])
    // Bildirim tek kayıttır; çift bağlantı yinelenmiş satır üretmez.
    assert.equal(await unread(w.father.cookie), 2)
  })
})
