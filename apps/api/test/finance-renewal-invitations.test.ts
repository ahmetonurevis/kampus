import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  INSTITUTION_TYPES,
  moduleAvailableFor,
} from '@kampus/school-core/modules/collection-modules.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { feeTariffs } from '../src/db/schema/fee-tariffs.ts'
import { renewalInvitations } from '../src/db/schema/renewal-invitations.ts'
import { studentGuardians } from '../src/db/schema/student-guardians.ts'
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
import { checkFinanceMirrorAfterEach } from './support/finance-mirror.ts'

/**
 * Yenileme daveti uçları (K-10; IST-100; DOM-KAY-027). Her test kendi kurumunu kurar: s3 (6-A, c3)
 * ve aynı sınıftaki öğrenciler davet alır, veli s3'ün ödeyicisidir. Yanıt niyet beyanıdır: sözleşme,
 * taksit ve sınıf değişmez.
 */

const SEED = createSeed(FIXED_NOW)
const YEAR = 2027
const BASE = '/api/v1/finance/renewal-invitations'
const RENEWALS = '/api/v1/finance/renewals'
const CLASSES = ['c1', 'c3']
const SID = 's3'
const OTHER = SEED.students.find((item) => item.classId === 'c3' && item.id !== SID)?.id ?? ''
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASSES.includes(item.id)),
  students: SEED.students.filter((item) => CLASSES.includes(item.classId)),
  parents: SEED.parents,
}
const OPEN = { academicYear: YEAR, studentIds: [SID] }
const ANSWER = { response: 'will_renew' }
const BASE_CENTS = 3_000_000

describe('K-10: yenileme daveti uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      Object.entries(SAMPLE).flatMap(([collection, items]) =>
        (items ?? []).map((data) => {
          const name = collection as CollectionName
          const id = recordKey(name, data)
          if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
          return { collection: name, id, data }
        }),
      ),
      FIXED_NOW,
    )
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }

  /** Veli hesabı ve bağı: `payer` ödeyici, `custody` velayet. */
  async function parent(
    institutionId: string,
    studentId: string,
    bond: { payer: boolean; custody?: 'full' | 'none'; restricted?: boolean },
  ) {
    const links: MembershipLinkInput[] = [{ kind: 'child', recordId: studentId }]
    const user = await createMember(app, institutionId, 'veli', links)
    // Çocuk bağlantısı velayetli bağı kendisi kurar; test yalnız bağın niteliklerini değiştirir.
    await db
      .update(studentGuardians)
      .set({
        custody: bond.custody ?? 'full',
        isContactRestricted: bond.restricted ?? false,
        isPayer: bond.payer,
      })
      .where(
        and(
          eq(studentGuardians.institutionId, institutionId),
          eq(studentGuardians.membershipId, user.membershipId),
        ),
      )
    return signInAs(app, user)
  }
  const member = async (id: string, role: Role, links: readonly MembershipLinkInput[] = []) =>
    signInAs(app, await createMember(app, id, role, links))

  type Headers = Record<string, string>
  const post = (url: string, cookie: string | null, body: unknown, headers: Headers = {}) =>
    app.inject({
      method: 'POST',
      url,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      payload: JSON.stringify(body),
    })
  const get = (url: string, cookie: string | null) =>
    app.inject({
      method: 'GET',
      url,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })
  const key = () => ({ 'idempotency-key': randomUUID() })
  const ifMatch = (version: number) => ({ 'if-match': `"${String(version)}"` })
  function assertError(
    response: Awaited<ReturnType<typeof get>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  const rows = (institutionId: string) =>
    db.select().from(renewalInvitations).where(eq(renewalInvitations.institutionId, institutionId))

  async function open(cookie: string, body: unknown = OPEN) {
    const response = await post(BASE, cookie, body, key())
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data as {
      invitations: { id: string; studentId: string }[]
      withoutPayerCount: number
    }
  }
  async function listed(cookie: string, query = '') {
    const response = await get(`${BASE}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as {
      data: {
        id: string
        version: number
        studentId: string
        studentName: string | null
        className: string | null
        status: string
        response: string | null
        note: string | null
        respondedAt: string | null
        canRespond: boolean
      }[]
      meta: { total: number }
    }
  }
  const notifications = async (institutionId: string) =>
    (await loadRecords(db, institutionId, ['notifications'])).filter(
      (row) => row.data.kind === 'renewal_invited',
    )
  async function financeCounts(institutionId: string) {
    const records = await loadRecords(db, institutionId, ['contracts', 'invoices', 'renewals'])
    return records.length
  }

  async function publish(institutionId: string) {
    await db.insert(feeTariffs).values({
      institutionId,
      id: randomUUID(),
      academicYear: YEAR,
      versionNumber: 1,
      status: 'published',
      items: [
        {
          kind: 'tuition',
          level: null,
          amountCents: BASE_CENTS,
          unit: 'year',
          vatBasisPoints: 1000,
          vatEffectiveDate: '2026-01-01',
          announcedAmountCents: BASE_CENTS,
        },
      ],
      discounts: [],
      announcedDate: '2026-05-01',
      publishedByUserId: 'test',
      publishedAt: FIXED_NOW,
    })
  }

  const QUOTE = { studentId: SID, targetClassId: 'c1', academicYear: YEAR, installmentCount: 2 }
  async function plan(admin: string) {
    const rate = await post(`${RENEWALS}/price-indexes`, admin, {
      academicYear: YEAR,
      ppiBasisPoints: 4_000,
      cpiBasisPoints: 3_000,
      source: 'TÜİK bülteni 53607',
      bulletinDate: '2026-02-03',
    })
    assert.equal(rate.statusCode, 201, rate.body)
    const quote = await post(`${RENEWALS}/quote`, admin, QUOTE)
    assert.equal(quote.statusCode, 200, quote.body)
    const made = await post(
      RENEWALS,
      admin,
      {
        ...QUOTE,
        mode: 'renew',
        tariffId: quote.json().data.tariffId as string,
        firstDueDate: '2026-11-15',
      },
      key(),
    )
    assert.equal(made.statusCode, 201, made.body)
    return quote.json().data as { invitationStatus: string | null }
  }

  test('DOM-YTK-001: oturumsuz 401; açma yönetici ve ön büro, yanıt veli; diğer roller 403', async () => {
    const someId = randomUUID()
    assertError(await get(BASE, null), 401)
    assertError(await post(BASE, null, OPEN, key()), 401)
    assertError(await post(`${BASE}/${someId}/respond`, null, ANSWER, ifMatch(1)), 401)
    const a = await institution()
    for (const role of ['ogretmen', 'ogrenci'] as const) {
      const cookie = await member(a.id, role)
      assertError(await get(BASE, cookie), 403, 'forbidden')
      assertError(await post(BASE, cookie, OPEN, key()), 403, 'forbidden')
      assertError(await post(`${BASE}/${someId}/respond`, cookie, ANSWER, ifMatch(1)), 403)
    }
    const veli = await parent(a.id, SID, { payer: true })
    assertError(await post(BASE, veli, OPEN, key()), 403, 'forbidden')
    assert.equal((await rows(a.id)).length, 0)
    const desk = await member(a.id, 'onburo')
    const opened = await open(desk)
    const invitationId = opened.invitations[0]?.id ?? ''
    // Personel velinin yerine yanıt vermez: yanıt velinin kendi hesabındandır.
    assertError(await post(`${BASE}/${invitationId}/respond`, a.admin, ANSWER, ifMatch(1)), 403)
    assertError(await post(`${BASE}/${invitationId}/respond`, desk, ANSWER, ifMatch(1)), 403)
    assert.equal((await rows(a.id))[0]?.response, null)
  })

  test('DOM-YTK-040: finance ya da renewal kapalıysa 403, DOM-YTK-012: dil okulu ve kursta 404', async () => {
    const closings: Record<string, boolean>[] = [{ finance: false }, { renewal: false }]
    for (const enabledModules of closings) {
      const closed = await institution({ enabledModules })
      assertError(await get(BASE, closed.admin), 403, 'module_disabled')
      assertError(await post(BASE, closed.admin, OPEN, key()), 403, 'module_disabled')
    }
    const withoutRenewal = INSTITUTION_TYPES.filter((type) => !moduleAvailableFor('renewal', type))
    assert.ok(withoutRenewal.includes('language_school'))
    for (const type of withoutRenewal) {
      const closed = await institution({ type })
      assertError(await get(BASE, closed.admin), 404)
      assertError(await post(BASE, closed.admin, OPEN, key()), 404)
      assertError(
        await post(`${BASE}/${randomUUID()}/respond`, closed.admin, ANSWER, ifMatch(1)),
        404,
      )
      assert.equal((await rows(closed.id)).length, 0)
    }
  })

  test('DOM-KAY-027: gövde hatası 400 ve kayıt değişmez; Idempotency-Key zorunlu, If-Match desteklenmez', async () => {
    const a = await institution()
    for (const body of [
      {},
      { academicYear: YEAR, studentIds: [] },
      { academicYear: 'x', studentIds: [SID] },
      { ...OPEN, studentIds: Array.from({ length: 201 }, (_, i) => `s${String(i)}`) },
    ])
      assertError(await post(BASE, a.admin, body, key()), 400)
    assertError(await post(BASE, a.admin, OPEN), 400, 'idempotency_key_required')
    assertError(
      await post(BASE, a.admin, OPEN, { ...key(), ...ifMatch(1) }),
      400,
      'if_match_not_supported',
    )
    assert.equal((await rows(a.id)).length, 0)
    assertError(await get(`${BASE}?bilinmeyen=1`, a.admin), 400)
    assertError(await get(`${BASE}?status=belki`, a.admin), 400)
  })

  test('DOM-KAY-027, DOM-ILT-023: toplu davet açılır, ödeyicisi olan veliye yalnız kimlikli bildirim gider; denetimde alan adları', async () => {
    const a = await institution()
    const veli = await parent(a.id, SID, { payer: true })
    const opened = await open(a.admin, { academicYear: YEAR, studentIds: [SID, OTHER] })
    assert.equal(opened.invitations.length, 2)
    assert.equal(opened.withoutPayerCount, 1)
    assert.equal((await rows(a.id)).length, 2)

    const sent = await notifications(a.id)
    assert.equal(sent.length, 1)
    assert.deepEqual(
      { ...sent[0]?.data, id: undefined, createdAt: undefined },
      {
        id: undefined,
        createdAt: undefined,
        kind: 'renewal_invited',
        audience: 'parent',
        studentId: SID,
        subject: {
          type: 'renewal_invitations',
          id: opened.invitations.find((item) => item.studentId === SID)?.id,
        },
      },
    )
    const bell = await get('/api/v1/notifications', veli)
    assert.equal(bell.statusCode, 200, bell.body)
    assert.ok(bell.body.includes('kayıt yenileme daveti'), bell.body)

    const audits = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'renewal_invitation.open')))
    assert.equal(audits.length, 2)
    assert.deepEqual(audits[0]?.changes, { fields: ['studentId', 'academicYear'] })

    const list = await listed(a.admin, `?academicYear=${String(YEAR)}`)
    assert.equal(list.meta.total, 2)
    assert.ok(list.data.every((row) => row.status === 'pending' && row.canRespond === false))
    assert.ok(list.data.every((row) => row.className === '6-A'))
    assert.ok(list.data.some((row) => row.studentName === 'Zeynep Demir'))
    assert.equal((await listed(a.admin, '?q=zeynep')).meta.total, 1)
    assert.equal((await listed(a.admin, '?status=will_renew')).meta.total, 0)
    assert.equal((await listed(a.admin, '?pageSize=1&page=2')).data.length, 1)
    assert.equal((await listed(a.admin, '?academicYear=2030')).meta.total, 0)
  })

  test('DOM-KAY-027: aynı öğrenci ve yıla ikinci davet 409 ve toplu açmada hiçbiri açılmaz; tekrarlanan anahtar ilk yanıtı döner', async () => {
    const a = await institution()
    await parent(a.id, SID, { payer: true })
    const headers = key()
    const first = await post(BASE, a.admin, OPEN, headers)
    assert.equal(first.statusCode, 201, first.body)
    const replay = await post(BASE, a.admin, OPEN, headers)
    assert.equal(replay.statusCode, 201, replay.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), first.json())
    assert.equal((await notifications(a.id)).length, 1)

    assertError(await post(BASE, a.admin, OPEN, key()), 409, 'renewal_invitation_exists')
    assertError(
      await post(BASE, a.admin, { academicYear: YEAR, studentIds: [OTHER, SID] }, key()),
      409,
      'renewal_invitation_exists',
    )
    assert.equal((await rows(a.id)).length, 1)
    assert.equal((await notifications(a.id)).length, 1)
    // Başka yıla ayrı davet açılır.
    await open(a.admin, { academicYear: YEAR + 1, studentIds: [SID] })
    assert.equal((await rows(a.id)).length, 2)
  })

  test('DOM-KAY-027: geçmiş yıl 422 renewal_year_invalid; olmayan öğrenci 404; veritabanı tek açık daveti korur', async () => {
    const a = await institution()
    assertError(
      await post(BASE, a.admin, { academicYear: 2026, studentIds: [SID] }, key()),
      422,
      'renewal_year_invalid',
    )
    assertError(await post(BASE, a.admin, { academicYear: YEAR, studentIds: ['yok'] }, key()), 404)
    assert.equal((await rows(a.id)).length, 0)
    await open(a.admin)
    await assert.rejects(
      db.execute(
        sql`insert into renewal_invitations (institution_id, id, student_id, academic_year, invited_by_user_id) values (${a.id}, ${randomUUID()}, ${SID}, ${YEAR}, 'test')`,
      ),
    )
  })

  test('K-10, DOM-KAY-027: ödeyici veli niyetini bildirir, yanıtı değiştirir; sözleşme, taksit ve sınıf yazılmaz; not denetime girmez', async () => {
    const a = await institution()
    const veli = await parent(a.id, SID, { payer: true })
    const { invitations } = await open(a.admin)
    const id = invitations[0]?.id ?? ''
    const before = await financeCounts(a.id)
    const classBefore = (await loadRecords(db, a.id, ['students'])).find((row) => row.id === SID)
      ?.data.classId

    const seen = await listed(veli)
    assert.equal(seen.meta.total, 1)
    assert.equal(seen.data[0]?.canRespond, true)
    assert.equal(seen.data[0]?.status, 'pending')

    const answered = await post(
      `${BASE}/${id}/respond`,
      veli,
      { response: 'will_not_renew', note: '  Taşınıyoruz.  ' },
      ifMatch(1),
    )
    assert.equal(answered.statusCode, 200, answered.body)
    assert.equal(answered.json().data.status, 'will_not_renew')
    assert.equal(answered.json().data.version, 2)

    const staff = await listed(a.admin)
    assert.equal(staff.data[0]?.status, 'will_not_renew')
    assert.equal(staff.data[0]?.note, 'Taşınıyoruz.')
    assert.equal(staff.data[0]?.respondedAt, FIXED_NOW.toISOString())

    const changed = await post(`${BASE}/${id}/respond`, veli, ANSWER, ifMatch(2))
    assert.equal(changed.statusCode, 200, changed.body)
    const after = (await rows(a.id))[0]
    assert.equal(after?.response, 'will_renew')
    assert.equal(after?.responseNote, null)
    assert.equal(after?.version, 3)

    assert.equal(await financeCounts(a.id), before)
    assert.equal(
      (await loadRecords(db, a.id, ['students'])).find((row) => row.id === SID)?.data.classId,
      classBefore,
    )
    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'renewal_invitation.respond')),
      )
    assert.equal(audits.length, 2)
    assert.deepEqual(audits[0]?.changes, {
      fields: ['response', 'responseNote', 'respondedAt'],
    })
    assert.equal(JSON.stringify(audits).includes('Taşınıyoruz'), false)
  })

  test('DOM-KAY-027: yanıt gövde hatası 400, If-Match eksik 400, eski sürüm 409 ve kayıt değişmez; aynı anahtar ilk yanıtı döner', async () => {
    const a = await institution()
    const veli = await parent(a.id, SID, { payer: true })
    const id = (await open(a.admin)).invitations[0]?.id ?? ''
    const url = `${BASE}/${id}/respond`
    for (const body of [
      {},
      { response: 'belki' },
      { ...ANSWER, note: 'x'.repeat(281) },
      { ...ANSWER, contractId: 'c' },
    ])
      assertError(await post(url, veli, body, ifMatch(1)), 400)
    assertError(await post(url, veli, ANSWER), 400, 'if_match_required')
    assertError(await post(`${BASE}/gecersiz/respond`, veli, ANSWER, ifMatch(1)), 400)
    assertError(await post(url, veli, ANSWER, ifMatch(9)), 409, 'version_conflict')
    assert.equal((await rows(a.id))[0]?.response, null)
    assert.equal((await rows(a.id))[0]?.version, 1)

    const headers = { ...key(), ...ifMatch(1) }
    const first = await post(url, veli, ANSWER, headers)
    assert.equal(first.statusCode, 200, first.body)
    const replay = await post(url, veli, ANSWER, headers)
    assert.equal(replay.statusCode, 200, replay.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await rows(a.id))[0]?.version, 2)
  })

  test('K-04, DOM-KAY-027: ödeyici olmayan velayetli veli görür, yanıt veremez ve notu görmez; velayetsiz ödeyici yanıtlar; kısıtlı ve başka çocuğun velisi 404', async () => {
    const a = await institution()
    const payer = await parent(a.id, SID, { payer: true, custody: 'none' })
    const custodial = await parent(a.id, SID, { payer: false })
    const restricted = await parent(a.id, SID, {
      payer: false,
      custody: 'none',
      restricted: true,
    })
    const stranger = await parent(a.id, OTHER, { payer: true })
    const id = (await open(a.admin)).invitations[0]?.id ?? ''
    const url = `${BASE}/${id}/respond`

    assertError(
      await post(url, custodial, ANSWER, ifMatch(1)),
      403,
      'renewal_invitation_payer_only',
    )
    assertError(await post(url, restricted, ANSWER, ifMatch(1)), 404)
    assertError(await post(url, stranger, ANSWER, ifMatch(1)), 404)
    assert.equal((await rows(a.id))[0]?.response, null)

    const answered = await post(url, payer, { ...ANSWER, note: 'Görüşelim.' }, ifMatch(1))
    assert.equal(answered.statusCode, 200, answered.body)

    const own = await listed(payer)
    assert.equal(own.data[0]?.note, 'Görüşelim.')
    assert.equal(own.data[0]?.canRespond, true)
    const other = await listed(custodial)
    assert.equal(other.data[0]?.status, 'will_renew')
    assert.equal(other.data[0]?.note, null)
    assert.equal(other.data[0]?.canRespond, false)
    assert.equal((await listed(restricted)).meta.total, 0)
    assert.equal((await listed(stranger)).meta.total, 0)
    assert.equal((await listed(stranger, `?studentId=${SID}`)).meta.total, 0)
  })

  test('DOM-KAY-027, DOM-KAY-020: plan daveti planlandı yapar, yanıtı kapatır; yenilemeyecek planı engellemez, önizleme uyarı verir; planlı öğrenciye davet 409', async () => {
    const a = await institution()
    await publish(a.id)
    const veli = await parent(a.id, SID, { payer: true })
    const id = (await open(a.admin)).invitations[0]?.id ?? ''
    const url = `${BASE}/${id}/respond`
    const answered = await post(url, veli, { response: 'will_not_renew' }, ifMatch(1))
    assert.equal(answered.statusCode, 200, answered.body)

    const quote = await plan(a.admin)
    assert.equal(quote.invitationStatus, 'will_not_renew')

    const list = await listed(a.admin, '?status=planned')
    assert.equal(list.meta.total, 1)
    assert.equal(list.data[0]?.response, 'will_not_renew')
    assert.equal((await listed(a.admin, '?status=will_not_renew')).meta.total, 0)
    assert.equal((await listed(veli)).data[0]?.canRespond, false)

    assertError(await post(url, veli, ANSWER, ifMatch(2)), 409, 'renewal_invitation_planned')
    assert.equal((await rows(a.id))[0]?.response, 'will_not_renew')
    assertError(
      await post(BASE, a.admin, { academicYear: YEAR, studentIds: [SID] }, key()),
      409,
      'renewal_invitation_already_planned',
    )
  })

  test('DOM-KAY-027: davetsiz öğrencinin önizlemesinde davet durumu boştur', async () => {
    const a = await institution()
    await publish(a.id)
    assert.equal((await plan(a.admin)).invitationStatus, null)
  })

  test('IST-002: başka kurumun daveti yanıtta 404, B değişmez; listede yok; gövdedeki institutionId reddedilir; B öğrencisine davet açılmaz', async () => {
    const a = await institution()
    const b = await institution()
    const veliA = await parent(a.id, SID, { payer: true })
    const id = (await open(b.admin)).invitations[0]?.id ?? ''
    assertError(await post(`${BASE}/${id}/respond`, veliA, ANSWER, ifMatch(1)), 404)
    assert.equal((await rows(b.id))[0]?.response, null)
    assert.equal((await rows(b.id))[0]?.version, 1)
    assert.equal((await listed(a.admin)).meta.total, 0)
    assert.equal((await listed(veliA)).meta.total, 0)
    assertError(await post(BASE, a.admin, { ...OPEN, institutionId: b.id }, key()), 400)
    const only = SEED.students.find((item) => item.id === SID)
    await insertMissingRecords(
      db,
      b.id,
      [{ collection: 'students', id: 'test-b-ogrenci', data: { ...only, id: 'test-b-ogrenci' } }],
      FIXED_NOW,
    )
    assertError(
      await post(BASE, a.admin, { academicYear: YEAR, studentIds: ['test-b-ogrenci'] }, key()),
      404,
    )
    assert.equal((await rows(a.id)).length, 0)
    assert.equal((await rows(b.id)).length, 1)
  })
})
