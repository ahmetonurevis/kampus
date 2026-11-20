import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { files } from '../src/db/schema/files.ts'
import { jobApplications, jobPostings } from '../src/db/schema/finance-job-postings.ts'
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
 * İş ilanı ve başvuru havuzu uçları (DOM-FIN-128; ON-177; K-439…K-441). Her test kendi kurumunu
 * kurar. FIXED_NOW 2026-10-06 (Europe/Istanbul günü de 2026-10-06).
 */

const FINANCE = '/api/v1/finance'
const POSTINGS = `${FINANCE}/job-postings`
const APPLICATIONS = `${FINANCE}/job-applications`
const RETENTION = `${FINANCE}/job-application-retention`
const ANONYMIZE = `${FINANCE}/job-application-anonymizations`
const SETTINGS = `${FINANCE}/job-application-settings`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-128: iş ilanı ve başvuru uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let tenantCount = 0
  let clientIp = '10.128.0.1'

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

  function call(
    method: 'GET' | 'POST' | 'PATCH',
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
  const post = (url: string, cookie: string | null, body: unknown, key = randomUUID()) =>
    call('POST', url, cookie, body, { 'idempotency-key': key })
  const versioned = (
    method: 'POST' | 'PATCH',
    url: string,
    cookie: string,
    body: unknown,
    version: unknown,
  ) => call(method, url, cookie, body, { 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.128.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const member = async (institutionId: string, role: Parameters<typeof createMember>[2]) =>
    signInAs(app, await createMember(app, institutionId, role))
  async function upload(t: Tenant, cookie: string) {
    const body = multipart(uploadParts('document', PDF, 'ozgecmis.pdf'))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': body.contentType,
        'idempotency-key': randomUUID(),
      },
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
  const postingBody = {
    title: 'İngilizce öğretmeni',
    position: 'İngilizce öğretmeni',
    employmentType: 'full_time',
    description: 'Ortaokul İngilizce dersleri için öğretmen arıyoruz.',
    publishOn: '2026-09-01',
    deadlineOn: '2026-10-31',
  }
  async function published(t: Tenant) {
    const draft = ok(await post(POSTINGS, t.admin, postingBody), 201)
    return ok(
      await versioned(
        'POST',
        `${POSTINGS}/${String(draft.id)}/status`,
        t.admin,
        { status: 'published' },
        draft.version,
      ),
    )
  }
  const applicationBody = (postingId: unknown, extra: Json = {}) => ({
    jobPostingId: postingId,
    candidateName: 'Deniz Aday',
    email: 'deniz@ornek.com',
    channel: 'email',
    receivedOn: '2026-09-10',
    privacyNoticeVersion: 'v1',
    privacyNoticeShownOn: '2026-09-10',
    ...extra,
  })
  const countApplications = async (institutionId: string) =>
    (
      await db
        .select()
        .from(jobApplications)
        .where(eq(jobApplications.institutionId, institutionId))
    ).length

  test('kimliksiz istek 401', async () => {
    assertError(await get(POSTINGS, null), 401)
    assertError(await post(POSTINGS, null, {}), 401)
    assertError(await get(APPLICATIONS, null), 401)
    assertError(await post(APPLICATIONS, null, {}), 401)
    assertError(await get(RETENTION, null), 401)
    assertError(await post(ANONYMIZE, null, {}), 401)
    assertError(await get(SETTINGS, null), 401)
  })

  test('DOM-FIN-128: öğretmen 403; ön büro ilan okur ve başvuru girer, havuzu görmez; modül kapalı 403 (K-440)', async () => {
    const t = await institution()
    const teacher = await member(t.id, 'ogretmen')
    assertError(await get(POSTINGS, teacher), 403)
    assertError(await post(APPLICATIONS, teacher, {}), 403)
    const desk = await member(t.id, 'onburo')
    const posting = await published(t)
    assert.equal((await get(POSTINGS, desk)).statusCode, 200)
    assertError(await post(POSTINGS, desk, postingBody), 403)
    ok(await post(APPLICATIONS, desk, applicationBody(posting.id)), 201)
    assertError(await get(APPLICATIONS, desk), 403)
    assertError(await get(SETTINGS, desk), 403)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(POSTINGS, closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-128: ilan, başvuru, aşama ve aday talebiyle anonimleştirme (K-439…K-441)', async () => {
    const t = await institution()
    const posting = await published(t)
    assertError(
      await post(APPLICATIONS, t.admin, applicationBody(posting.id, { email: null })),
      400,
    )
    const cv = await upload(t, t.admin)
    const created = ok(
      await post(APPLICATIONS, t.admin, applicationBody(posting.id, { cvFileId: cv })),
      201,
    )
    assert.equal(created.stage, 'new')
    assert.equal((created.history as Json[]).length, 1)
    assertError(
      await post(APPLICATIONS, t.admin, applicationBody(posting.id)),
      409,
      'job_application_duplicate',
    )
    const staged = ok(
      await versioned(
        'POST',
        `${APPLICATIONS}/${String(created.id)}/stage`,
        t.admin,
        { stage: 'interview', changedOn: '2026-10-01' },
        created.version,
      ),
    )
    assert.equal(staged.stage, 'interview')
    assert.equal((staged.history as Json[]).length, 2)
    assertError(
      await versioned(
        'POST',
        `${APPLICATIONS}/${String(created.id)}/stage`,
        t.admin,
        { stage: 'screening', changedOn: '2026-10-02' },
        staged.version,
      ),
      422,
      'job_application_stage_transition',
    )
    assertError(
      await post(ANONYMIZE, t.admin, { applicationIds: [created.id], reason: 'retention_expired' }),
      422,
      'job_application_retention_not_due',
    )
    const done = ok(
      await post(ANONYMIZE, t.admin, {
        applicationIds: [created.id],
        reason: 'data_subject_request',
      }),
    )
    assert.equal(done.cvFileCount, 1)
    const detail = ok(await get(`${APPLICATIONS}/${String(created.id)}`, t.admin))
    assert.equal(detail.candidateName, 'Anonim aday')
    assert.equal(detail.email, null)
    assert.equal(detail.cvFileId, null)
    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.institutionId, t.id), eq(files.id, cv)))
    assert.ok(file?.retentionUntil !== null)
    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.job_application.anonymize'),
        ),
      )
    assert.equal(audit.length, 1)
  })

  test('DOM-FIN-128: başka kurumun ilanı ve başvurusu 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bPosting = await published(b)
    const bApplication = ok(await post(APPLICATIONS, b.admin, applicationBody(bPosting.id)), 201)
    assertError(await get(`${POSTINGS}/${String(bPosting.id)}`, a.admin), 404)
    assertError(await get(`${APPLICATIONS}/${String(bApplication.id)}`, a.admin), 404)
    assert.equal((await get(POSTINGS, a.admin)).json().meta.total, 0)
    assert.equal((await get(APPLICATIONS, a.admin)).json().meta.total, 0)
    assertError(await post(POSTINGS, a.admin, { ...postingBody, institutionId: b.id }), 400)
    assertError(
      await post(APPLICATIONS, a.admin, applicationBody(bPosting.id)),
      422,
      'job_application_posting_not_found',
    )
    assertError(
      await post(ANONYMIZE, a.admin, {
        applicationIds: [bApplication.id],
        reason: 'data_subject_request',
      }),
      422,
      'job_application_not_found',
    )
    const bPostingUrl = `${POSTINGS}/${String(bPosting.id)}`
    const bApplicationUrl = `${APPLICATIONS}/${String(bApplication.id)}`
    assertError(await versioned('PATCH', bPostingUrl, a.admin, postingBody, bPosting.version), 404)
    assertError(
      await versioned('POST', `${bPostingUrl}/status`, a.admin, { status: 'closed' }, 2),
      404,
    )
    assertError(
      await versioned('PATCH', bApplicationUrl, a.admin, { note: 'x' }, bApplication.version),
      404,
    )
    assertError(
      await versioned(
        'POST',
        `${bApplicationUrl}/stage`,
        a.admin,
        { stage: 'rejected', changedOn: '2026-10-01' },
        bApplication.version,
      ),
      404,
    )
    assert.equal((await get(RETENTION, a.admin)).json().meta.total, 0)
    assert.equal(ok(await get(SETTINGS, a.admin)).version, 1)
    assertError(
      await versioned('PATCH', SETTINGS, a.admin, { retentionMonths: 6, institutionId: b.id }, 1),
      400,
    )
    assert.equal(await countApplications(b.id), 1)
    const [bRow] = await db.select().from(jobPostings).where(eq(jobPostings.institutionId, b.id))
    assert.equal(bRow?.status, 'published')
  })
  test('DOM-FIN-128: ilan düzeltme, yayın kilidi, son başvuru ve kapanış kuralları (K-439)', async () => {
    const t = await institution()
    const draft = ok(await post(POSTINGS, t.admin, postingBody), 201)
    assert.equal(draft.status, 'draft')
    const url = `${POSTINGS}/${String(draft.id)}`
    assertError(
      await versioned('PATCH', url, t.admin, postingBody, draft.version),
      422,
      'job_posting_unchanged',
    )
    assertError(await versioned('PATCH', url, t.admin, { ...postingBody, title: 'Yeni' }, 99), 409)
    assertError(
      await call('PATCH', url, t.admin, { ...postingBody, title: 'Yeni' }),
      400,
      'if_match_required',
    )
    const edited = ok(
      await versioned(
        'PATCH',
        url,
        t.admin,
        {
          ...postingBody,
          title: 'İngilizce öğretmeni (yarı zamanlı)',
          employmentType: 'part_time',
        },
        draft.version,
      ),
    )
    assert.equal(edited.employmentType, 'part_time')
    const published = ok(
      await versioned('POST', `${url}/status`, t.admin, { status: 'published' }, edited.version),
    )
    assertError(
      await versioned(
        'PATCH',
        url,
        t.admin,
        { ...postingBody, publishOn: '2026-09-02' },
        published.version,
      ),
      422,
      'job_posting_publish_locked',
    )
    ok(
      await post(
        APPLICATIONS,
        t.admin,
        applicationBody(published.id, { receivedOn: '2026-09-20' }),
      ),
      201,
    )
    assertError(
      await versioned(
        'PATCH',
        url,
        t.admin,
        { ...postingBody, deadlineOn: '2026-09-15' },
        published.version,
      ),
      422,
      'job_posting_deadline_before_applications',
    )
    const closed = ok(
      await versioned('POST', `${url}/status`, t.admin, { status: 'closed' }, published.version),
    )
    assert.equal(closed.status, 'closed')
    assert.equal(closed.closedOn, '2026-10-06')
    assert.equal(closed.applicationCount, 1)
    assertError(
      await versioned('POST', `${url}/status`, t.admin, { status: 'published' }, closed.version),
      422,
      'job_posting_transition',
    )
    assertError(
      await versioned('PATCH', url, t.admin, { ...postingBody, title: 'Başka' }, closed.version),
      422,
      'job_posting_closed',
    )
    const late = ok(
      await post(POSTINGS, t.admin, {
        ...postingBody,
        publishOn: '2026-08-01',
        deadlineOn: '2026-09-01',
      }),
      201,
    )
    assertError(
      await versioned(
        'POST',
        `${POSTINGS}/${String(late.id)}/status`,
        t.admin,
        { status: 'published' },
        late.version,
      ),
      422,
      'job_posting_deadline_passed',
    )
    assertError(
      await post(APPLICATIONS, t.admin, applicationBody(late.id)),
      422,
      'job_application_posting_draft',
    )
    const listed = await get(`${POSTINGS}?status=closed`, t.admin)
    assert.equal(listed.json().meta.total, 1)
  })

  test('DOM-FIN-128: saklama listesi ret gününden ve ilan kapanışından sayar; süresi dolan anonimleşir (K-441)', async () => {
    const t = await institution()
    const old = ok(
      await post(POSTINGS, t.admin, {
        ...postingBody,
        publishOn: '2025-01-01',
        deadlineOn: '2026-12-31',
      }),
      201,
    )
    const oldPosting = ok(
      await versioned(
        'POST',
        `${POSTINGS}/${String(old.id)}/status`,
        t.admin,
        { status: 'published' },
        old.version,
      ),
    )
    const rejected = ok(
      await post(
        APPLICATIONS,
        t.admin,
        applicationBody(oldPosting.id, {
          receivedOn: '2025-03-01',
          privacyNoticeShownOn: '2025-03-01',
        }),
      ),
      201,
    )
    const rejectedNow = ok(
      await versioned(
        'POST',
        `${APPLICATIONS}/${String(rejected.id)}/stage`,
        t.admin,
        { stage: 'rejected', changedOn: '2025-04-01' },
        rejected.version,
      ),
    )
    assert.equal(rejectedNow.retentionDueOn, '2026-04-01')
    const recent = ok(
      await post(
        APPLICATIONS,
        t.admin,
        applicationBody(oldPosting.id, { email: 'yeni@ornek.com', receivedOn: '2026-09-01' }),
      ),
      201,
    )
    const ongoing = ok(
      await post(
        APPLICATIONS,
        t.admin,
        applicationBody(oldPosting.id, { email: 'suren@ornek.com', receivedOn: '2025-05-01' }),
      ),
      201,
    )
    assert.equal(ongoing.retentionDueOn, null)
    let due = await get(RETENTION, t.admin)
    assert.equal(due.statusCode, 200, due.body)
    assert.deepEqual(
      (due.json().data as Json[]).map((row) => row.id),
      [rejected.id],
    )
    assert.equal(due.json().meta.retentionMonths, 12)

    // İlan kapanınca işe alınmamış başvuruların süresi kapanış gününden başlar.
    const closed = ok(
      await versioned(
        'POST',
        `${POSTINGS}/${String(oldPosting.id)}/status`,
        t.admin,
        { status: 'closed' },
        oldPosting.version,
      ),
    )
    assert.equal(closed.closedOn, '2026-10-06')
    await db
      .update(jobPostings)
      .set({ closedOn: '2025-06-01' })
      .where(and(eq(jobPostings.institutionId, t.id), eq(jobPostings.id, String(oldPosting.id))))
    due = await get(RETENTION, t.admin)
    assert.equal(due.json().meta.total, 3)

    // 17 ayda ret (2025-04-01 → 2026-09-01) dolmuş, kapanış (2025-06-01 → 2026-11-01) dolmamıştır.
    const settings = ok(await get(SETTINGS, t.admin))
    assert.deepEqual(settings, { retentionMonths: 12, privacyNoticeVersion: null, version: 1 })
    assertError(
      await versioned('PATCH', SETTINGS, t.admin, { retentionMonths: 12 }, 1),
      422,
      'job_application_settings_unchanged',
    )
    assertError(await versioned('PATCH', SETTINGS, t.admin, { retentionMonths: 61 }, 1), 400)
    const saved = ok(
      await versioned(
        'PATCH',
        SETTINGS,
        t.admin,
        { retentionMonths: 17, privacyNoticeVersion: 'v2' },
        1,
      ),
    )
    assert.deepEqual(saved, { retentionMonths: 17, privacyNoticeVersion: 'v2', version: 2 })
    assertError(await versioned('PATCH', SETTINGS, t.admin, { retentionMonths: 6 }, 1), 409)
    due = await get(RETENTION, t.admin)
    assert.deepEqual(
      (due.json().data as Json[]).map((row) => row.id),
      [rejected.id],
    )

    assertError(
      await post(ANONYMIZE, t.admin, {
        applicationIds: [rejected.id, recent.id],
        reason: 'retention_expired',
      }),
      422,
      'job_application_retention_not_due',
    )
    assert.equal(ok(await get(`${APPLICATIONS}/${String(rejected.id)}`, t.admin)).anonymized, false)
    const key = randomUUID()
    const done = ok(
      await post(
        ANONYMIZE,
        t.admin,
        { applicationIds: [rejected.id], reason: 'retention_expired' },
        key,
      ),
    )
    assert.deepEqual(done, { anonymizedCount: 1, cvFileCount: 0, reason: 'retention_expired' })
    const again = await post(
      ANONYMIZE,
      t.admin,
      { applicationIds: [rejected.id], reason: 'retention_expired' },
      key,
    )
    assert.equal(again.statusCode, 200, again.body)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assertError(
      await post(ANONYMIZE, t.admin, {
        applicationIds: [rejected.id],
        reason: 'data_subject_request',
      }),
      422,
      'job_application_already_anonymized',
    )
    assert.equal((await get(RETENTION, t.admin)).json().meta.total, 0)
    const detail = ok(await get(`${APPLICATIONS}/${String(rejected.id)}`, t.admin))
    assert.equal(detail.anonymizationReason, 'retention_expired')
    assert.equal(detail.privacyNoticeVersion, 'v1')
    assert.equal((detail.history as Json[]).length, 2)
    assertError(
      await versioned(
        'PATCH',
        `${APPLICATIONS}/${String(rejected.id)}`,
        t.admin,
        { note: 'x' },
        detail.version,
      ),
      422,
      'job_application_anonymized',
    )
    // Arama anonimleştirilmiş adı bulmaz.
    const search = await get(`${APPLICATIONS}?q=Deniz`, t.admin)
    assert.ok(!(search.json().data as Json[]).some((row) => row.id === rejected.id))
  })

  test('DOM-FIN-128: düzeltme mükerrer iletişimi reddeder; özgeçmiş bağlantısı yalnız yöneticide; çift gönderim tek başvuru (K-440)', async () => {
    const t = await institution()
    const posting = await published(t)
    const desk = await member(t.id, 'onburo')
    const cv = await upload(t, desk)
    const key = randomUUID()
    const body = applicationBody(posting.id, { cvFileId: cv, channel: 'in_person' })
    const first = await post(APPLICATIONS, desk, body, key)
    assert.equal(first.statusCode, 201, first.body)
    const replay = await post(APPLICATIONS, desk, body, key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(await countApplications(t.id), 1)
    const created = first.json().data as Json

    assertError(await get(`/api/v1/files/${cv}/url`, desk), 404)
    assert.equal((await get(`/api/v1/files/${cv}/url`, t.admin)).statusCode, 200)

    const other = ok(
      await post(
        APPLICATIONS,
        t.admin,
        applicationBody(posting.id, {
          email: null,
          phone: '05321234567',
          candidateName: 'Ece Aday',
        }),
      ),
      201,
    )
    assertError(
      await versioned(
        'PATCH',
        `${APPLICATIONS}/${String(other.id)}`,
        t.admin,
        { email: 'deniz@ornek.com' },
        other.version,
      ),
      409,
      'job_application_duplicate',
    )
    assertError(
      await versioned(
        'PATCH',
        `${APPLICATIONS}/${String(other.id)}`,
        t.admin,
        { phone: null },
        other.version,
      ),
      422,
      'job_application_contact_required',
    )
    const fixed = ok(
      await versioned(
        'PATCH',
        `${APPLICATIONS}/${String(other.id)}`,
        t.admin,
        { candidateName: 'Ece Yılmaz', note: 'Tavsiye' },
        other.version,
      ),
    )
    assert.equal(fixed.candidateName, 'Ece Yılmaz')
    const list = await get(`${APPLICATIONS}?channel=in_person`, t.admin)
    assert.equal(list.json().meta.total, 1)
    assert.equal('email' in (list.json().data as Json[])[0]!, false)

    const hired = ok(
      await versioned(
        'POST',
        `${APPLICATIONS}/${String(created.id)}/stage`,
        t.admin,
        { stage: 'hired', changedOn: '2026-10-06' },
        created.version,
      ),
    )
    assertError(
      await post(ANONYMIZE, t.admin, {
        applicationIds: [hired.id],
        reason: 'data_subject_request',
      }),
      422,
      'job_application_hired',
    )
    assertError(
      await versioned(
        'POST',
        `${APPLICATIONS}/${String(hired.id)}/stage`,
        t.admin,
        { stage: 'rejected', changedOn: '2026-10-06' },
        hired.version,
      ),
      422,
      'job_application_closed',
    )
    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.job_application.update'),
        ),
      )
    assert.deepEqual(audit[0]?.changes, { fields: ['candidateName', 'note'] })
  })
})
