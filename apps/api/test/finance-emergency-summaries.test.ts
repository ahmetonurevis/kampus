import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { ensureGuardianLinks } from '../src/db/student-guardians.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { emergencySummaries } from '../src/db/schema/finance-emergency-summaries.ts'
import { healthAccessReasons } from '../src/db/schema/finance-health-access.ts'
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
 * Acil durum özeti uçları (DOM-FIN-155; ON-165; K-520…K-522; H-111). Her test kendi kurumunu
 * kurar. FIXED_NOW 2026-10-06T09:00Z (Europe/Istanbul 12:00).
 */

const BASE = '/api/v1/finance/emergency-summaries'
const CLASSES = `${BASE}/classes`
const ACTION = 'Arı sokmasında adrenalin kalem çantada; 112 ara.'
const NEXT = 'Arı sokmasında kalemi uyluğa uygula, 112 ara, veliyi ara.'
const SECRETS = ['Arı', 'adrenalin', 'Astım', '0532 111 22 12']

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-155: acil durum özeti uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.165.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

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
  /** Yönetim ayrıntısı erişim gerekçesi ister (DOM-FIN-156). */
  const detail = (url: string, cookie: string, code = 'guardian_meeting') =>
    call('GET', url, cookie, undefined, { 'x-access-reason': code })
  const post = (url: string, cookie: string | null, body: unknown, key: string = randomUUID()) =>
    call('POST', url, cookie, body, { 'idempotency-key': key })
  const versioned = (
    method: 'POST' | 'PATCH' | 'DELETE',
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

  /**
   * Kurum: Deniz (`s-1`, 9-A; veli kaydı `p-1`), Ece (`s-2`, 9-B), ayrılmış Can (`s-3`, 9-A).
   * `teacher` 9-A'nın sınıf öğretmeni; `subject` 9-A'ya yalnız derse girer; `outsider` hiçbir
   * sınıfta değil.
   */
  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.165.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      [
        {
          collection: 'teachers' as const,
          id: 't-1',
          data: { id: 't-1', name: 'Selin Kaya', subjectId: 'mat', branchId: 'b-1' },
        },
        {
          collection: 'teachers' as const,
          id: 't-2',
          data: { id: 't-2', name: 'Can Demir', subjectId: 'fen', branchId: 'b-1' },
        },
        {
          collection: 'teachers' as const,
          id: 't-3',
          data: { id: 't-3', name: 'Ayla Er', subjectId: 'tr', branchId: 'b-1' },
        },
        {
          collection: 'classes' as const,
          id: '9-A',
          data: { id: '9-A', grade: 9, level: 'lise', branchId: 'b-1', teacherId: 't-1' },
        },
        {
          collection: 'classes' as const,
          id: '9-B',
          data: { id: '9-B', grade: 9, level: 'lise', branchId: 'b-1', teacherId: 't-3' },
        },
        {
          collection: 'assignments' as const,
          id: 'as-1',
          data: { id: 'as-1', classId: '9-A', teacherId: 't-2', subjectId: 'fen' },
        },
        {
          collection: 'parents' as const,
          id: 'p-1',
          data: { id: 'p-1', name: 'Ayşe Yılmaz', phone: '0532 111 22 12' },
        },
        {
          collection: 'students' as const,
          id: 's-1',
          data: {
            id: 's-1',
            name: 'Deniz Yılmaz',
            classId: '9-A',
            isActive: true,
            parentId: 'p-1',
          },
        },
        {
          collection: 'students' as const,
          id: 's-2',
          data: { id: 's-2', name: 'Ece Yılmaz', classId: '9-B', isActive: true },
        },
        {
          collection: 'students' as const,
          id: 's-3',
          data: { id: 's-3', name: 'Can Ayrılan', classId: '9-A', isActive: false },
        },
      ],
      FIXED_NOW,
    )
    // Deniz'in ilk bağı hesapsız anne kaydı (telefonlu); velinin hesabı ikinci bağ olur. Bağ sırası
    // kimlik sırasıdır: en küçük kimlik ilk bağdır.
    await ensureGuardianLinks(db, created.id, [
      {
        id: '00000000-0000-4000-8000-000000000165',
        studentId: 's-1',
        parentId: 'p-1',
        membershipId: null,
        relationship: 'mother',
        custody: 'full',
        contactRestricted: false,
        isPayer: true,
        canPickUp: true,
      },
    ])
    const teacher = await createMember(app, created.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-1' },
    ])
    const subject = await createMember(app, created.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-2' },
    ])
    const outsider = await createMember(app, created.id, 'ogretmen')
    const desk = await createMember(app, created.id, 'onburo')
    const mother = await createMember(app, created.id, 'veli', [{ kind: 'child', recordId: 's-1' }])
    const student = await createMember(app, created.id, 'ogrenci', [
      { kind: 'student', recordId: 's-1' },
    ])
    return {
      id: created.id,
      admin: await signInAs(app, created.admin),
      teacher: await signInAs(app, teacher),
      subject: await signInAs(app, subject),
      outsider: await signInAs(app, outsider),
      desk: await signInAs(app, desk),
      mother: await signInAs(app, mother),
      student: await signInAs(app, student),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const url = (id: unknown) => `${BASE}/${String(id)}`
  const classUrl = (classId: string, purpose?: string) =>
    `${CLASSES}/${classId}${purpose === undefined ? '' : `?purpose=${purpose}`}`
  const studentUrl = (studentId: string) => `${BASE}/students/${studentId}`
  const revealUrl = (studentId: string, position: number) =>
    `${studentUrl(studentId)}/contacts/${String(position)}/reveal`
  const rows = (institutionId: string) =>
    db.select().from(emergencySummaries).where(eq(emergencySummaries.institutionId, institutionId))
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const create = (t: Tenant, extra: Json = {}, key?: string) =>
    post(BASE, t.admin, { studentId: 's-1', actionText: ACTION, ...extra }, key)
  const approve = (t: Tenant, id: unknown, version: unknown) =>
    versioned('POST', `${url(id)}/approve`, t.admin, {}, version)
  async function published(t: Tenant) {
    const created = ok(await create(t), 201)
    return ok(await approve(t, created.id, created.version))
  }
  const profile = (t: Tenant, body: Json) =>
    call('PATCH', '/api/v1/students/s-1/health-profile', t.admin, body)

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    for (const target of [BASE, url(id), CLASSES, classUrl('9-A'), studentUrl('s-1')])
      assertError(await get(target, null), 401)
    assertError(await post(BASE, null, {}), 401)
    assertError(await call('PATCH', url(id), null, {}), 401)
    assertError(await call('POST', `${url(id)}/approve`, null, {}), 401)
    assertError(await call('DELETE', url(id), null), 401)
    assertError(await call('POST', revealUrl('s-1', 1), null), 401)
  })

  test('DOM-FIN-155: rol süzgeci ve modül kapalı 403 (K-520, K-521)', async () => {
    const t = await institution()
    const created = ok(await create(t), 201)
    for (const cookie of [t.desk, t.teacher, t.mother, t.student]) {
      assertError(await get(BASE, cookie), 403)
      assertError(await get(url(created.id), cookie), 403)
      assertError(await post(BASE, cookie, { studentId: 's-1', actionText: ACTION }), 403)
      assertError(await versioned('PATCH', url(created.id), cookie, { actionText: NEXT }, 1), 403)
      assertError(await versioned('POST', `${url(created.id)}/approve`, cookie, {}, 1), 403)
      assertError(await versioned('DELETE', url(created.id), cookie, undefined, 1), 403)
    }
    for (const cookie of [t.mother, t.student]) {
      assertError(await get(CLASSES, cookie), 403)
      assertError(await get(classUrl('9-A'), cookie), 403)
      assertError(await get(studentUrl('s-1'), cookie), 403)
      assertError(await call('POST', revealUrl('s-1', 1), cookie), 403)
    }
    const [row] = await rows(t.id)
    assert.equal(row?.version, 1)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(BASE, closed.admin), 403, 'module_disabled')
    assertError(await get(classUrl('9-A'), closed.teacher), 403, 'module_disabled')
    assertError(await get(studentUrl('s-1'), closed.desk), 403, 'module_disabled')
  })

  test('DOM-FIN-155: taslak onaydan önce görünmez; metin şifreli; mükerrer istek tek özet (K-520)', async () => {
    const t = await institution()
    const key = randomUUID()
    const first = await create(t, {}, key)
    const created = ok(first, 201)
    assert.equal(first.headers.location, url(created.id))
    assert.equal(created.state, 'draft')
    assert.equal(created.draftText, ACTION)
    assert.equal(created.publishedText, null)
    const replay = await create(t, {}, key)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(await create(t), 409, 'emergency_summary_exists')
    const stored = await rows(t.id)
    assert.equal(stored.length, 1)
    const raw = JSON.stringify(stored)
    for (const secret of SECRETS) assert.ok(!raw.includes(secret), secret)
    assert.equal(stored[0]?.publishedCiphertext, null)

    assert.deepEqual(ok(await get(classUrl('9-A'), t.admin)).cards, [])
    assertError(await get(studentUrl('s-1'), t.teacher), 404)
    assertError(await call('POST', revealUrl('s-1', 1), t.admin), 404)
    const classes = ok(await get(CLASSES, t.admin)) as unknown as Json[]
    assert.deepEqual(
      classes.map((item) => [item.classId, item.summaryCount]),
      [
        ['9-A', 0],
        ['9-B', 0],
      ],
    )
    const list = (await get(BASE, t.admin)).json()
    assert.equal(list.meta.total, 1)
    assert.equal(list.data[0].state, 'draft')
    assert.equal(list.data[0].studentName, 'Deniz Yılmaz')
    assert.equal(list.data[0].className, '9-A')
    assert.equal('draftText' in list.data[0], false)

    const audit = await audits(t.id, 'finance.emergency_summary.create')
    assert.equal(audit.length, 1)
    for (const secret of SECRETS) assert.ok(!JSON.stringify(audit).includes(secret), secret)
  })

  test('DOM-FIN-155: doğrulama 400, olmayan ve ayrılmış öğrenci 422; kayıt açılmaz', async () => {
    const t = await institution()
    assertError(await create(t, { actionText: 'kısa' }), 400)
    assertError(await create(t, { extra: true }), 400)
    assertError(await create(t, { studentId: 'yok' }), 422, 'emergency_summary_student_not_found')
    assertError(await create(t, { studentId: 's-3' }), 422, 'emergency_summary_student_inactive')
    assertError(await call('POST', BASE, t.admin, { studentId: 's-1', actionText: ACTION }), 400)
    assert.equal((await rows(t.id)).length, 0)
    assertError(await get(`${BASE}?state=bilinmeyen`, t.admin), 400)
    assertError(await get(`${BASE}?x=1`, t.admin), 400)
    assertError(await get(classUrl('9-A', 'csv'), t.admin), 400)
  })

  test('DOM-FIN-155: onay yayına alır; kart işaret, ilaç ve maskeli iletişim taşır; okuma öğrenci başına denetimde (K-521, K-522)', async () => {
    const t = await institution()
    ok(
      await profile(t, {
        allergies: [{ name: 'Arı', severity: 'severe' }],
        chronicConditions: [{ name: 'Astım' }],
        emergencyInstructions: 'Adrenalin kalem çantada.',
        legalBasis: 'vital_interest',
        version: 1,
      }),
    )
    const mother = t.mother
    const consent = ok(
      await post('/api/v1/finance/infirmary/medication-consents', mother, {
        studentId: 's-1',
        medicationName: 'Parol şurup',
        dose: '5 ml',
        times: ['12:30'],
        startDate: '2026-10-06',
        endDate: '2026-10-08',
      }),
      201,
    )
    ok(
      await versioned(
        'POST',
        `/api/v1/finance/infirmary/medication-consents/${String(consent.id)}/approve`,
        t.admin,
        {},
        consent.version,
      ),
    )
    const created = ok(await create(t), 201)
    assert.equal(created.profileInstructions, 'Adrenalin kalem çantada.')
    const approved = ok(await approve(t, created.id, created.version))
    assert.equal(approved.state, 'published')
    assert.equal(approved.publishedText, ACTION)
    assert.equal(approved.draftText, null)
    assert.equal(approved.needsReview, false)

    for (const cookie of [t.admin, t.desk, t.teacher, t.subject]) {
      const body = ok(await get(classUrl('9-A'), cookie))
      const cards = body.cards as Json[]
      assert.equal(cards.length, 1)
      assert.deepEqual(JSON.parse(JSON.stringify(cards[0])), {
        summaryId: created.id,
        studentId: 's-1',
        studentName: 'Deniz Yılmaz',
        classId: '9-A',
        className: '9-A',
        actionText: ACTION,
        alerts: { allergy: true, chronic: true, medication: false },
        medicationToday: true,
        contacts: [
          {
            position: 1,
            name: 'Ayşe Yılmaz',
            relationship: 'mother',
            phoneMasked: '0532 *** ** 12',
            hasPhone: true,
          },
          {
            position: 2,
            name: 'Test Kullanıcı',
            relationship: 'other',
            phoneMasked: null,
            hasPhone: false,
          },
        ],
        needsReview: false,
        approvedAt: FIXED_NOW.toISOString(),
      })
      assert.ok(!JSON.stringify(body).includes('Astım'))
      assert.ok(!JSON.stringify(body).includes('Parol'))
    }
    ok(await get(studentUrl('s-1'), t.teacher))
    assertError(await get(classUrl('9-A'), t.outsider), 404)
    assertError(await get(studentUrl('s-1'), t.outsider), 404)
    assertError(await get(classUrl('9-B'), t.teacher), 404)
    assertError(await get(classUrl('yok'), t.admin), 404)
    const teacherClasses = ok(await get(CLASSES, t.teacher)) as unknown as Json[]
    assert.deepEqual(
      teacherClasses.map((item) => [item.classId, item.summaryCount]),
      [['9-A', 1]],
    )
    assert.deepEqual(ok(await get(CLASSES, t.outsider)), [])

    const reads = await audits(t.id, 'finance.emergency_summary.read')
    assert.equal(reads.length, 5)
    assert.ok(reads.every((row) => row.entityType === 'students' && row.entityId === 's-1'))
    assert.deepEqual(reads[0]?.changes, {
      fields: ['actionText', 'alertFlags', 'medicationToday', 'contacts'],
    })
    ok(await get(classUrl('9-A', 'print'), t.desk))
    assert.equal((await audits(t.id, 'finance.emergency_summary.print')).length, 1)
    const all = JSON.stringify(
      await db.select().from(auditLog).where(eq(auditLog.institutionId, t.id)),
    )
    for (const secret of SECRETS) assert.ok(!all.includes(secret), secret)
  })

  test('DOM-FIN-155: tam telefon açılışı denetimde ve no-store; kişi yoksa 404 (K-521)', async () => {
    const t = await institution()
    await published(t)
    const response = await call('POST', revealUrl('s-1', 1), t.subject)
    const data = ok(response)
    assert.equal(data.phone, '0532 111 22 12')
    assert.equal(response.headers['cache-control'], 'no-store')
    assertError(
      await call('POST', revealUrl('s-1', 2), t.subject),
      422,
      'emergency_contact_phone_missing',
    )
    assertError(await call('POST', revealUrl('s-1', 3), t.subject), 400)
    assertError(await call('POST', revealUrl('s-1', 1), t.outsider), 404)
    assertError(await call('POST', revealUrl('s-2', 1), t.admin), 404)
    const reveals = await audits(t.id, 'finance.emergency_summary.contact_reveal')
    assert.equal(reveals.length, 1)
    assert.equal(reveals[0]?.entityId, 's-1')
    assert.ok(!JSON.stringify(reveals).includes('0532'))
  })

  test('DOM-FIN-155: düzeltme onaya kadar eski metni gösterir; aynı metin ve boş onay 422 (K-520)', async () => {
    const t = await institution()
    const live = await published(t)
    const edited = ok(
      await versioned('PATCH', url(live.id), t.admin, { actionText: NEXT }, live.version),
    )
    assert.equal(edited.state, 'pending_revision')
    assert.equal(edited.draftText, NEXT)
    assert.equal(edited.publishedText, ACTION)
    const card = ok(await get(studentUrl('s-1'), t.teacher))
    assert.equal(card.actionText, ACTION)
    assertError(
      await versioned('PATCH', url(live.id), t.admin, { actionText: NEXT }, edited.version),
      422,
      'emergency_summary_unchanged',
    )
    assertError(
      await versioned('PATCH', url(live.id), t.admin, { actionText: ACTION }, live.version),
      409,
    )
    const [before] = await rows(t.id)
    assert.equal(before?.version, edited.version)
    const done = ok(await approve(t, live.id, edited.version))
    assert.equal(done.publishedText, NEXT)
    assert.equal(ok(await get(studentUrl('s-1'), t.teacher)).actionText, NEXT)
    assertError(
      await approve(t, live.id, done.version),
      422,
      'emergency_summary_nothing_to_approve',
    )
    const reverted = ok(
      await versioned('PATCH', url(live.id), t.admin, { actionText: ACTION }, done.version),
    )
    const back = ok(
      await versioned('PATCH', url(live.id), t.admin, { actionText: NEXT }, reverted.version),
    )
    assert.equal(back.state, 'published')
    assert.equal(back.draftText, null)
    assertError(
      await call('PATCH', url(live.id), t.admin, { actionText: ACTION }),
      400,
      'if_match_required',
    )
  })

  test('DOM-FIN-155: profil değişince gözden geçirilmeli; metin değişmeden yeniden onaylanır (K-520)', async () => {
    const t = await institution()
    const live = await published(t)
    assert.equal(live.needsReview, false)
    ok(
      await profile(t, {
        allergies: [{ name: 'Arı', severity: 'severe' }],
        legalBasis: 'vital_interest',
        version: 1,
      }),
    )
    const list = (await get(BASE, t.admin)).json()
    assert.equal(list.data[0].needsReview, true)
    assert.equal(ok(await get(studentUrl('s-1'), t.desk)).needsReview, true)
    const opened = ok(await detail(url(live.id), t.admin))
    assert.equal(opened.needsReview, true)
    const reviewed = ok(await approve(t, live.id, opened.version))
    assert.equal(reviewed.needsReview, false)
    assert.equal(reviewed.publishedText, ACTION)
    const approvals = await audits(t.id, 'finance.emergency_summary.approve')
    assert.deepEqual(approvals.at(-1)?.changes, { fields: ['reviewedProfile'] })
    assert.equal((await audits(t.id, 'finance.emergency_summary.manage_read')).length >= 3, true)
  })

  test('DOM-FIN-155: arşivlenen özet görünmez, yeni özet açılabilir; süzgeçler', async () => {
    const t = await institution()
    const live = await published(t)
    ok(await post(BASE, t.admin, { studentId: 's-2', actionText: NEXT }), 201)
    assert.equal((await get(`${BASE}?state=draft`, t.admin)).json().meta.total, 1)
    assert.equal((await get(`${BASE}?classId=9-A`, t.admin)).json().meta.total, 1)
    assert.equal((await get(`${BASE}?q=ece`, t.admin)).json().meta.total, 1)
    assertError(await versioned('DELETE', url(live.id), t.admin, undefined, 99), 409)
    const archived = ok(await versioned('DELETE', url(live.id), t.admin, undefined, live.version))
    assert.deepEqual(archived, { id: live.id, archived: true })
    assertError(await detail(url(live.id), t.admin), 404)
    assertError(await get(studentUrl('s-1'), t.admin), 404)
    assert.deepEqual(ok(await get(classUrl('9-A'), t.admin)).cards, [])
    ok(await create(t), 201)
    assert.equal((await audits(t.id, 'finance.emergency_summary.archive')).length, 1)
  })

  test('DOM-FIN-155: başka kurumun özeti 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bSummary = await published(b)
    const bUrl = url(bSummary.id)
    assertError(await detail(bUrl, a.admin), 404)
    assertError(
      await versioned('PATCH', bUrl, a.admin, { actionText: NEXT }, bSummary.version),
      404,
    )
    assertError(await versioned('POST', `${bUrl}/approve`, a.admin, {}, bSummary.version), 404)
    assertError(await versioned('DELETE', bUrl, a.admin, undefined, bSummary.version), 404)
    assert.equal((await get(BASE, a.admin)).json().meta.total, 0)
    assert.deepEqual(ok(await get(classUrl('9-A'), a.admin)).cards, [])
    const aClasses = ok(await get(CLASSES, a.admin)) as unknown as Json[]
    assert.ok(aClasses.every((item) => item.summaryCount === 0))
    assertError(await get(studentUrl('s-1'), a.admin), 404)
    assertError(await call('POST', revealUrl('s-1', 1), a.admin), 404)
    assertError(await create(a, { institutionId: b.id }), 400)
    const [bRow] = await rows(b.id)
    assert.equal(bRow?.version, bSummary.version)
    assert.notEqual(bRow?.publishedCiphertext, null)
    assert.equal(bRow?.archivedAt, null)
    assert.equal((await rows(a.id)).length, 0)
  })

  test('DOM-FIN-156: yönetim ayrıntısı gerekçe ister; kart gerekçesiz emergency yazılır (K-521)', async () => {
    const t = await institution()
    const live = await published(t)
    assertError(await get(url(live.id), t.admin), 400, 'health_access_reason_required')
    assertError(
      await detail(url(live.id), t.admin, 'bilinmeyen'),
      400,
      'health_access_reason_invalid',
    )
    ok(await detail(url(live.id), t.admin))
    ok(await get(studentUrl('s-1'), t.teacher))
    ok(await call('GET', classUrl('9-A'), t.desk, undefined, { 'x-access-reason': 'first_aid' }))
    assertError(
      await call('GET', studentUrl('s-1'), t.teacher, undefined, { 'x-access-reason': 'x' }),
      400,
      'health_access_reason_invalid',
    )
    const reasons = await db
      .select()
      .from(healthAccessReasons)
      .where(eq(healthAccessReasons.institutionId, t.id))
    assert.deepEqual(reasons.map((row) => row.reasonCode).sort(), [
      'emergency',
      'first_aid',
      'guardian_meeting',
    ])
    assert.ok(reasons.every((row) => row.studentId === 's-1'))
    // Yazanın kendi yanıtı ve telefon açılışı erişim günlüğüne gerekçeyle düşmez.
    assert.equal((await audits(t.id, 'finance.emergency_summary.manage_read')).length, 3)
  })
})
