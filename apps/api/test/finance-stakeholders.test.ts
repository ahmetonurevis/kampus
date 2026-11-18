import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { files } from '../src/db/schema/files.ts'
import { stakeholderAgreements, stakeholders } from '../src/db/schema/finance-stakeholders.ts'
import { recordFileCheck } from '../src/services/files.ts'
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
import { multipart, PDF, tempStorage, uploadParts } from './support/files-sample.ts'

/**
 * Paydaş ve sponsor uçları (DOM-FIN-102; ON-262). Her test kendi kurumunu kurar. FIXED_NOW
 * 2026-10-06 (Europe/Istanbul günü de 2026-10-06).
 */

const STAKEHOLDERS = '/api/v1/finance/stakeholders'
const AGREEMENTS = '/api/v1/finance/stakeholder-agreements'
const VKN = '1111111114'
const SPONSOR = {
  name: 'Mavi Holding',
  type: 'sponsor',
  taxNumber: VKN,
  contactName: 'Deniz Kara',
  contactEmail: 'deniz@mavi.com.tr',
  contactPhone: '05321234512',
  tags: ['Bahar Şenliği', 'izmir'],
}
const AGREEMENT = {
  subject: 'Bahar şenliği sponsorluğu',
  startDate: '2026-09-01',
  endDate: '2026-10-20',
  renewalNoticeDays: 30,
  contributionType: 'cash',
  contributionAmountCents: 15_000_000,
  benefits: ['logo', 'event_naming'],
  benefitNote: 'Mavi Bahar Şenliği',
}

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-102: paydaş ve sponsor uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let tenantCount = 0
  let clientIp = '10.102.0.1'

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

  const key = () => ({ 'idempotency-key': randomUUID() })
  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const get = (url: string, cookie: string | null) => call('GET', url, cookie)
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.102.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const member = async (institutionId: string, role: Parameters<typeof createMember>[2]) =>
    signInAs(app, await createMember(app, institutionId, role))
  const create = (cookie: string, body: Json = SPONSOR, headers: Record<string, string> = key()) =>
    call('POST', STAKEHOLDERS, cookie, body, headers)
  const sponsor = async (t: Tenant, body: Json = SPONSOR) => ok(await create(t.admin, body), 201)
  const urlOf = (stakeholder: Json) => `${STAKEHOLDERS}/${String(stakeholder.id)}`
  const agreementUrl = (agreement: Json) => `${AGREEMENTS}/${String(agreement.id)}`
  const open = (
    cookie: string,
    stakeholder: Json,
    body: Json = AGREEMENT,
    headers: Record<string, string> = key(),
  ) => call('POST', `${urlOf(stakeholder)}/agreements`, cookie, body, headers)
  const agreement = async (t: Tenant, stakeholder: Json, body: Json = AGREEMENT) =>
    ok(await open(t.admin, stakeholder, body), 201)
  const activate = (cookie: string, item: Json) =>
    call('POST', `${agreementUrl(item)}/activate`, cookie, undefined, ifMatch(item.version))
  const terminate = (cookie: string, item: Json, body: Json) =>
    call('POST', `${agreementUrl(item)}/terminate`, cookie, body, ifMatch(item.version))
  const stakeholdersOf = (institutionId: string) =>
    db.select().from(stakeholders).where(eq(stakeholders.institutionId, institutionId))
  const agreementsOf = (institutionId: string) =>
    db
      .select()
      .from(stakeholderAgreements)
      .where(eq(stakeholderAgreements.institutionId, institutionId))
  const listOf = async (cookie: string, url: string) => {
    const response = await get(url, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  async function upload(t: Tenant, cookie = t.admin) {
    const body = multipart(uploadParts('document', PDF, 'Mavi sponsorluk sözleşmesi.pdf'))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      remoteAddress: clientIp,
      headers: { origin: TEST_ORIGIN, cookie, 'content-type': body.contentType, ...key() },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.id
    await recordFileCheck(db, store.storage, {
      institutionId: t.id,
      fileId: id,
      outcome: 'ready',
      now: FIXED_NOW,
      log: app.log,
    })
    return id
  }

  test('kimliksiz istek 401', async () => {
    const stakeholder = `${STAKEHOLDERS}/${randomUUID()}`
    const item = `${AGREEMENTS}/${randomUUID()}`
    assertError(await get(STAKEHOLDERS, null), 401)
    assertError(await call('POST', STAKEHOLDERS, null, SPONSOR, key()), 401)
    assertError(await get(stakeholder, null), 401)
    assertError(await call('PATCH', stakeholder, null, { name: 'Yeni' }, ifMatch(1)), 401)
    assertError(await call('POST', `${stakeholder}/agreements`, null, AGREEMENT, key()), 401)
    assertError(await get(AGREEMENTS, null), 401)
    assertError(await get(item, null), 401)
    assertError(await call('PATCH', item, null, { subject: 'Yeni konu' }, ifMatch(1)), 401)
    assertError(await call('POST', `${item}/activate`, null, undefined, ifMatch(1)), 401)
    assertError(await call('POST', `${item}/terminate`, null, { reason: 'x' }, ifMatch(1)), 401)
    assertError(await call('DELETE', item, null, undefined, ifMatch(1)), 401)
  })

  test('DOM-FIN-102: ön büro, öğretmen, veli ve öğrenci 403; modül kapalıyken 403 (K-317)', async () => {
    const t = await institution()
    const created = await sponsor(t)
    const item = await agreement(t, created)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(STAKEHOLDERS, cookie), 403)
      assertError(await get(urlOf(created), cookie), 403)
      assertError(await create(cookie), 403)
      assertError(await get(AGREEMENTS, cookie), 403)
      assertError(await get(agreementUrl(item), cookie), 403)
      assertError(await activate(cookie, item), 403)
    }
    assert.equal((await stakeholdersOf(t.id)).length, 1)
    const [row] = await agreementsOf(t.id)
    assert.equal(row?.status, 'draft')

    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(STAKEHOLDERS, closed.admin), 403, 'module_disabled')
    assertError(await create(closed.admin), 403, 'module_disabled')
    assertError(await get(AGREEMENTS, closed.admin), 403, 'module_disabled')
    assert.equal((await stakeholdersOf(closed.id)).length, 0)
  })

  test('DOM-FIN-102: paydaş eklenir; listede iletişim maskeli, ayrıntıda tam; denetimde alan adları (K-316, K-317)', async () => {
    const t = await institution()
    const response = await create(t.admin)
    const created = ok(response, 201)
    assert.equal(response.headers.location, urlOf(created))
    assert.deepEqual(created.tags, ['bahar şenliği', 'izmir'])
    assert.equal(created.contactEmail, SPONSOR.contactEmail)
    assert.equal(created.isActive, true)

    const list = await listOf(t.admin, STAKEHOLDERS)
    assert.equal(list.meta.total, 1)
    assert.equal(list.data[0]?.contactEmail, 'd***@mavi.com.tr')
    assert.equal(list.data[0]?.contactPhone, '0532 *** ** 12')
    assert.equal(list.data[0]?.contactName, 'Deniz Kara')
    assert.equal(ok(await get(urlOf(created), t.admin)).contactPhone, SPONSOR.contactPhone)

    const minimal = await sponsor(t, { name: 'Ege Üniversitesi', type: 'university' })
    assert.equal(minimal.taxNumber, null)
    assert.equal((await listOf(t.admin, `${STAKEHOLDERS}?type=university`)).meta.total, 1)
    assert.equal((await listOf(t.admin, `${STAKEHOLDERS}?tag=izmir`)).meta.total, 1)
    assert.equal((await listOf(t.admin, `${STAKEHOLDERS}?q=deniz`)).meta.total, 1)
    assert.equal((await listOf(t.admin, `${STAKEHOLDERS}?q=ege%20univ`)).meta.total, 1)

    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'stakeholder.create')))
    assert.equal(audits.length, 2)
    assert.equal(JSON.stringify(audits).includes('deniz@'), false)
    assert.equal(JSON.stringify(audits).includes('contactEmail'), true)
  })

  test('DOM-FIN-102: Idempotency-Key zorunlu, aynı anahtar ikinci paydaş açmaz; VKN tekil 409; 400 kayıt yazmaz', async () => {
    const t = await institution()
    assertError(await create(t.admin, SPONSOR, {}), 400)
    const headers = key()
    const first = await create(t.admin, SPONSOR, headers)
    const replay = await create(t.admin, SPONSOR, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(replay.json().data.id, first.json().data.id)
    assertError(
      await create(t.admin, { ...SPONSOR, name: 'Başka Holding' }),
      409,
      'stakeholder_tax_number_exists',
    )
    assertError(await create(t.admin, { ...SPONSOR, taxNumber: '1111111115' }), 400)
    assertError(await create(t.admin, { ...SPONSOR, type: 'supplier' }), 400)
    assertError(await create(t.admin, { ...SPONSOR, contactPhone: '5321234512' }), 400)
    assert.equal((await stakeholdersOf(t.id)).length, 1)
  })

  test('DOM-FIN-102: paydaş düzeltilir ve pasifleşir; pasif paydaşla anlaşma açılmaz (K-316)', async () => {
    const t = await institution()
    const created = await sponsor(t)
    const other = await sponsor(t, { name: 'Ege Vakfı', type: 'municipality_ngo' })
    assertError(
      await call('PATCH', urlOf(other), t.admin, { taxNumber: VKN }, ifMatch(other.version)),
      409,
      'stakeholder_tax_number_exists',
    )
    assertError(
      await call('PATCH', urlOf(created), t.admin, { name: SPONSOR.name }, ifMatch(1)),
      422,
      'stakeholder_unchanged',
    )
    assertError(await call('PATCH', urlOf(created), t.admin, { isActive: false }), 400)
    const passive = ok(
      await call('PATCH', urlOf(created), t.admin, { isActive: false, tags: [] }, ifMatch(1)),
    )
    assert.equal(passive.isActive, false)
    assert.deepEqual(passive.tags, [])
    assertError(
      await call('PATCH', urlOf(created), t.admin, { name: 'Eski sürüm' }, ifMatch(1)),
      409,
      'version_conflict',
    )
    assertError(await open(t.admin, created), 422, 'stakeholder_inactive')
    assert.equal((await agreementsOf(t.id)).length, 0)
    assert.equal((await listOf(t.admin, `${STAKEHOLDERS}?status=inactive`)).meta.total, 1)
  })

  test('DOM-FIN-102: anlaşma taslak açılır, yürürlüğe alınır, yenileme uyarısı ve bitiş süzgeci (K-318, K-319)', async () => {
    const t = await institution()
    const created = await sponsor(t)
    const response = await open(t.admin, created)
    const draft = ok(response, 201)
    assert.equal(response.headers.location, agreementUrl(draft))
    assert.equal(draft.status, 'draft')
    assert.equal(draft.renewalDue, false)
    assert.deepEqual(draft.stakeholder, { id: created.id, name: SPONSOR.name, type: 'sponsor' })

    const active = ok(await activate(t.admin, draft))
    assert.equal(active.status, 'active')
    assert.equal(active.daysLeft, 14)
    assert.equal(active.noticeDate, '2026-09-20')
    assert.equal(active.renewalDue, true)
    assert.equal(active.activatedAt, FIXED_NOW.toISOString())
    assertError(await activate(t.admin, active), 422, 'stakeholder_agreement_not_draft')

    const later = ok(
      await activate(
        t.admin,
        await agreement(t, created, { ...AGREEMENT, subject: 'Yaz okulu', endDate: '2027-06-30' }),
      ),
    )
    assert.equal(later.renewalDue, false)
    const ended = ok(
      await activate(
        t.admin,
        await agreement(t, created, {
          ...AGREEMENT,
          subject: 'Geçen yılın şenliği',
          startDate: '2025-09-01',
          endDate: '2026-06-30',
        }),
      ),
    )
    assert.equal(ended.status, 'ended')
    assert.equal(ended.daysLeft, null)

    const expiring = await listOf(t.admin, `${AGREEMENTS}?expiringWithinDays=30`)
    assert.deepEqual(
      expiring.data.map((item) => item.subject),
      [AGREEMENT.subject],
    )
    assert.equal((await listOf(t.admin, `${AGREEMENTS}?expiringWithinDays=365`)).meta.total, 2)
    assert.equal((await listOf(t.admin, `${AGREEMENTS}?renewalDue=true`)).meta.total, 1)
    assert.equal((await listOf(t.admin, `${AGREEMENTS}?status=ended`)).meta.total, 1)
    assert.equal((await listOf(t.admin, `${AGREEMENTS}?status=active`)).meta.total, 2)
    assert.equal(
      (await listOf(t.admin, `${AGREEMENTS}?stakeholderId=${String(created.id)}`)).meta.total,
      3,
    )
    assertError(await get(`${AGREEMENTS}?expiringWithinDays=0`, t.admin), 400)
    assertError(await get(`${AGREEMENTS}?bilinmeyen=1`, t.admin), 400)

    const [row] = (await listOf(t.admin, STAKEHOLDERS)).data
    assert.equal(row?.activeAgreementCount, 2)
    assert.equal(row?.renewalDueCount, 1)
    assert.equal((await listOf(t.admin, `${STAKEHOLDERS}?renewalDue=true`)).meta.total, 1)
  })

  test('DOM-FIN-102: katkı ve tarih kuralları 422, şema hataları 400; anlaşma yazılmaz', async () => {
    const t = await institution()
    const created = await sponsor(t)
    assertError(
      await open(t.admin, created, { ...AGREEMENT, endDate: '2026-08-31' }),
      422,
      'stakeholder_agreement_dates_invalid',
    )
    assertError(
      await open(t.admin, created, { ...AGREEMENT, contributionAmountCents: null }),
      422,
      'stakeholder_agreement_amount_required',
    )
    const inKind = await open(t.admin, created, {
      ...AGREEMENT,
      contributionType: 'in_kind',
      contributionAmountCents: null,
    })
    assertError(inKind, 422, 'stakeholder_agreement_description_required')
    assert.deepEqual(inKind.json().issues[0].path, ['contributionDescription'])
    assertError(await open(t.admin, created, { ...AGREEMENT, contributionAmountCents: 0 }), 400)
    assertError(await open(t.admin, created, { ...AGREEMENT, status: 'active' }), 400)
    assertError(await open(t.admin, created, AGREEMENT, {}), 400)
    assertError(
      await call('POST', `${STAKEHOLDERS}/${randomUUID()}/agreements`, t.admin, AGREEMENT, key()),
      404,
    )
    assert.equal((await agreementsOf(t.id)).length, 0)
    const service = await agreement(t, created, {
      ...AGREEMENT,
      contributionType: 'service',
      contributionAmountCents: null,
      contributionDescription: 'Yaz okulu robotik eğitmenliği',
    })
    assert.equal(service.contributionAmountCents, null)
  })

  test('DOM-FIN-102: düzeltme birleşik değerle denetlenir; fesih, feshedilmiş değişmez, yalnız taslak silinir (K-318)', async () => {
    const t = await institution()
    const created = await sponsor(t)
    const active = ok(await activate(t.admin, await agreement(t, created)))
    const extended = ok(
      await call(
        'PATCH',
        agreementUrl(active),
        t.admin,
        { endDate: '2027-06-30' },
        ifMatch(active.version),
      ),
    )
    assert.equal(extended.renewalDue, false)
    assertError(
      await call(
        'PATCH',
        agreementUrl(extended),
        t.admin,
        { startDate: '2027-07-01' },
        ifMatch(extended.version),
      ),
      422,
      'stakeholder_agreement_dates_invalid',
    )
    assertError(
      await call(
        'PATCH',
        agreementUrl(extended),
        t.admin,
        { subject: AGREEMENT.subject },
        ifMatch(extended.version),
      ),
      422,
      'stakeholder_agreement_unchanged',
    )
    assertError(
      await call('DELETE', agreementUrl(extended), t.admin, undefined, ifMatch(extended.version)),
      422,
      'stakeholder_agreement_not_draft',
    )
    assertError(
      await terminate(t.admin, extended, {
        terminationDate: '2026-08-01',
        reason: 'Bütçe kesintisi',
      }),
      422,
      'stakeholder_agreement_termination_date_invalid',
    )
    assertError(
      await terminate(t.admin, extended, { terminationDate: '2026-10-31', reason: 'x' }),
      400,
    )
    const terminated = ok(
      await terminate(t.admin, extended, {
        terminationDate: '2026-10-31',
        reason: 'Sponsor bütçesi kesildi',
      }),
    )
    assert.equal(terminated.status, 'terminated')
    assert.equal(terminated.terminationDate, '2026-10-31')
    assert.equal(terminated.terminationReason, 'Sponsor bütçesi kesildi')
    assertError(
      await call(
        'PATCH',
        agreementUrl(terminated),
        t.admin,
        { subject: 'Yeni konu' },
        ifMatch(terminated.version),
      ),
      422,
      'stakeholder_agreement_terminated',
    )
    assertError(
      await terminate(t.admin, terminated, {
        terminationDate: '2026-10-31',
        reason: 'Yeniden fesih',
      }),
      422,
      'stakeholder_agreement_terminated',
    )
    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'stakeholder_agreement.terminate'),
        ),
      )
    assert.equal(JSON.stringify(audits).includes('bütçesi'), false)

    const draft = await agreement(t, created, { ...AGREEMENT, subject: 'Vazgeçilen taslak' })
    assertError(
      await terminate(t.admin, draft, { terminationDate: '2026-10-01', reason: 'Taslak fesih' }),
      422,
      'stakeholder_agreement_not_active',
    )
    const archived = ok(
      await call('DELETE', agreementUrl(draft), t.admin, undefined, ifMatch(draft.version)),
    )
    assert.equal(archived.id, draft.id)
    assertError(await get(agreementUrl(draft), t.admin), 404)
    assert.equal((await listOf(t.admin, AGREEMENTS)).meta.total, 1)
  })

  test('DOM-FIN-102: sözleşme dosyası bağlanır, yönetici açar, değişince eski bağ kalkar', async () => {
    const t = await institution()
    const created = await sponsor(t)
    const fileId = await upload(t)
    const item = await agreement(t, created, { ...AGREEMENT, contractFileId: fileId })
    assert.deepEqual(item.contractFile, {
      id: fileId,
      name: 'Mavi sponsorluk sözleşmesi.pdf',
      byteSize: PDF.length,
    })
    assert.equal((await get(`/api/v1/files/${fileId}/url`, t.admin)).statusCode, 200)
    const desk = await member(t.id, 'onburo')
    assertError(await get(`/api/v1/files/${fileId}/url`, desk), 404)
    // Aynı dosya ikinci anlaşmaya bağlanamaz; anlaşma yazılmaz.
    assertError(
      await open(t.admin, created, { ...AGREEMENT, subject: 'İkinci', contractFileId: fileId }),
      409,
      'file_already_attached',
    )
    assert.equal((await agreementsOf(t.id)).length, 1)

    const replacement = await upload(t)
    const replaced = ok(
      await call(
        'PATCH',
        agreementUrl(item),
        t.admin,
        { contractFileId: replacement },
        ifMatch(item.version),
      ),
    )
    assert.equal(replaced.contractFileId, replacement)
    const [oldFile] = await db
      .select({ attachedId: files.attachedId })
      .from(files)
      .where(and(eq(files.institutionId, t.id), eq(files.id, fileId)))
    assert.equal(oldFile?.attachedId, null)
    const removed = ok(
      await call(
        'PATCH',
        agreementUrl(replaced),
        t.admin,
        { contractFileId: null },
        ifMatch(replaced.version),
      ),
    )
    assert.equal(removed.contractFile, null)
  })

  test('DOM-FIN-102: CSV iletişim taşımaz, formül kaçışlı; denetim kaydı', async () => {
    const t = await institution()
    const created = await sponsor(t, { ...SPONSOR, name: '=Mavi Holding' })
    await agreement(t, created)
    const csvOf = async (url: string) => {
      const response = await app.inject({
        method: 'GET',
        url,
        remoteAddress: clientIp,
        headers: { origin: TEST_ORIGIN, cookie: t.admin, accept: 'text/csv' },
      })
      assert.equal(response.statusCode, 200, response.body)
      assert.match(String(response.headers['content-type']), /text\/csv/)
      return response
    }
    const people = await csvOf(STAKEHOLDERS)
    assert.match(String(people.headers['content-disposition']), /paydaslar-2026-10-06\.csv/)
    assert.equal(people.body.charCodeAt(0), 0xfeff)
    assert.match(people.body, /"'=Mavi Holding";"Sponsor";"1111111114"/)
    assert.equal(people.body.includes('deniz'), false)
    assert.equal(people.body.includes('0532'), false)
    const deals = await csvOf(AGREEMENTS)
    assert.match(String(deals.headers['content-disposition']), /paydas-anlasmalari-2026-10-06\.csv/)
    assert.match(
      deals.body,
      /"Bahar şenliği sponsorluğu";"2026-09-01";"2026-10-20";30;"Nakdi";150000,00/,
    )
    const exports = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.actorRole, 'yonetici')))
    const actions = exports.map((row) => row.action)
    assert.ok(actions.includes('finance.stakeholder_export'))
    assert.ok(actions.includes('finance.stakeholder_agreement_export'))
  })

  test('DOM-FIN-102: başka kurumun paydaşı ve anlaşması 404 ve B değişmez; listede yok; B dosyası ve institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bStakeholder = await sponsor(b)
    const bAgreement = await agreement(b, bStakeholder)
    const bFile = await upload(b)
    const bUrl = urlOf(bStakeholder)
    const bAgreementUrl = agreementUrl(bAgreement)

    assertError(await get(bUrl, a.admin), 404)
    assertError(await call('PATCH', bUrl, a.admin, { name: 'Başka kurum' }, ifMatch(1)), 404)
    assertError(await open(a.admin, bStakeholder), 404)
    assertError(await get(bAgreementUrl, a.admin), 404)
    assertError(
      await call('PATCH', bAgreementUrl, a.admin, { subject: 'Başka kurum' }, ifMatch(1)),
      404,
    )
    assertError(await activate(a.admin, bAgreement), 404)
    assertError(
      await terminate(a.admin, bAgreement, {
        terminationDate: '2026-10-06',
        reason: 'Başka kurum',
      }),
      404,
    )
    assertError(await call('DELETE', bAgreementUrl, a.admin, undefined, ifMatch(1)), 404)
    assertError(await get(`/api/v1/files/${bFile}/url`, a.admin), 404)

    const aStakeholder = await sponsor(a)
    assertError(
      await open(a.admin, aStakeholder, { ...AGREEMENT, contractFileId: bFile }),
      422,
      'file_unavailable',
    )
    assertError(await create(a.admin, { ...SPONSOR, institutionId: b.id }), 400)
    const listOfA = await listOf(a.admin, STAKEHOLDERS)
    assert.deepEqual(
      listOfA.data.map((row) => row.id),
      [aStakeholder.id],
    )
    assert.equal(
      (await listOf(a.admin, `${AGREEMENTS}?stakeholderId=${String(bStakeholder.id)}`)).meta.total,
      0,
    )
    assert.equal((await listOf(a.admin, AGREEMENTS)).meta.total, 0)

    const [bRow] = await stakeholdersOf(b.id)
    assert.equal(bRow?.version, 1)
    assert.equal(bRow?.name, SPONSOR.name)
    const [bAgreementRow] = await agreementsOf(b.id)
    assert.equal(bAgreementRow?.version, 1)
    assert.equal(bAgreementRow?.status, 'draft')
    assert.equal(bAgreementRow?.archivedAt, null)
    assert.equal((await agreementsOf(a.id)).length, 0)
  })
})
