import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  staffSurveyParticipants,
  staffSurveyResponses,
  staffSurveys,
} from '../src/db/schema/finance-staff-surveys.ts'
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
 * Personel memnuniyet anketi uçları (DOM-FIN-143; ON-191; K-484…K-486). Her test kendi kurumunu
 * kurar; saat test içinde ilerletilir. FIXED_NOW 2026-10-06 (Europe/Istanbul aynı gün).
 */

const SURVEYS = '/api/v1/finance/staff-surveys'
const QUESTIONS = [
  { kind: 'likert', text: 'İş yükümü dengeli buluyorum', required: true },
  { kind: 'enps', text: 'Kurumu çalışma yeri olarak tavsiye eder misiniz?', required: true },
  { kind: 'open', text: 'Eklemek istedikleriniz', required: false },
]
const SECRET = 'Gizli-anket-cevabi'
const DAY = 86_400_000
const answers = (likert: number, enps: number, text?: string) => ({
  answers: [{ value: likert }, { value: enps }, text === undefined ? {} : { text }],
})

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-143: personel memnuniyet anketi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  let tenantCount = 0
  let clientIp = '10.191.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })
  beforeEach(() => {
    now = FIXED_NOW
  })
  const advance = (days: number) => {
    now = new Date(FIXED_NOW.getTime() + days * DAY)
  }

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
  const key = () => ({ 'idempotency-key': randomUUID() })
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
    clientIp = `10.191.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return {
      id: created.id,
      admin: await signInAs(app, created.admin),
      adminMembershipId: created.adminMembershipId,
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  async function member(t: Tenant, role: Role) {
    const user = await createMember(app, t.id, role)
    return { membershipId: user.membershipId, cookie: await signInAs(app, user) }
  }
  /** Yönetici + iki öğretmen + ön büro: dört kişilik hedef kitle. */
  async function staffed() {
    const t = await institution()
    const [teacher, teacher2, desk] = await Promise.all([
      member(t, 'ogretmen'),
      member(t, 'ogretmen'),
      member(t, 'onburo'),
    ])
    return { t, teacher, teacher2, desk }
  }

  const surveyBody = (overrides: Json = {}) => ({
    title: 'Güz memnuniyet anketi',
    openDate: '2026-10-06',
    closeDate: '2026-10-10',
    audience: { roles: [], unitIds: [] },
    questions: QUESTIONS,
    ...overrides,
  })
  const create = (cookie: string | null, body: unknown = surveyBody(), headers = key()) =>
    call('POST', SURVEYS, cookie, body, headers)
  const detail = (cookie: string | null, s: Json) =>
    call('GET', `${SURVEYS}/${String(s.id)}`, cookie)
  const list = (cookie: string | null, query = '') => call('GET', `${SURVEYS}${query}`, cookie)
  const patch = (cookie: string | null, s: Json, body: unknown) =>
    call('PATCH', `${SURVEYS}/${String(s.id)}`, cookie, body, ifMatch(s.version))
  const publish = (cookie: string | null, s: Json) =>
    call('POST', `${SURVEYS}/${String(s.id)}/publish`, cookie, undefined, ifMatch(s.version))
  const archive = (cookie: string | null, s: Json) =>
    call('DELETE', `${SURVEYS}/${String(s.id)}`, cookie, undefined, ifMatch(s.version))
  const copy = (cookie: string | null, s: Json) =>
    call('POST', `${SURVEYS}/${String(s.id)}/copy`, cookie, undefined, key())
  const results = (cookie: string | null, s: Json, query = '') =>
    call('GET', `${SURVEYS}/${String(s.id)}/results${query}`, cookie)
  const respond = (cookie: string | null, s: Json, body: unknown, headers = key()) =>
    call('POST', `${SURVEYS}/${String(s.id)}/responses`, cookie, body, headers)
  const assigned = (cookie: string | null) => call('GET', `${SURVEYS}/assigned`, cookie)

  async function published(t: Tenant, body: Json = {}) {
    const draft = ok(await create(t.admin, surveyBody(body)), 201)
    return ok(await publish(t.admin, draft))
  }
  const surveyRow = async (id: unknown) =>
    (
      await db
        .select()
        .from(staffSurveys)
        .where(eq(staffSurveys.id, String(id)))
    )[0]
  const responseRows = (surveyId: unknown) =>
    db
      .select()
      .from(staffSurveyResponses)
      .where(eq(staffSurveyResponses.surveyId, String(surveyId)))

  async function unitWith(t: Tenant, name: string, membershipIds: string[]) {
    const unit = ok(
      await call(
        'POST',
        '/api/v1/finance/org-units',
        t.admin,
        { name, kind: 'academic_department' },
        key(),
      ),
      201,
    )
    const position = ok(
      await call(
        'POST',
        '/api/v1/finance/org-positions',
        t.admin,
        { unitId: unit.id, title: `${name} öğretmeni`, headcount: 10 },
        key(),
      ),
      201,
    )
    for (const membershipId of membershipIds)
      ok(
        await call(
          'POST',
          '/api/v1/finance/org-assignments',
          t.admin,
          { positionId: position.id, membershipId, startDate: '2026-09-01' },
          key(),
        ),
        201,
      )
    return String(unit.id)
  }

  test('DOM-FIN-143: kimliksiz 401; yönetim uçları öğretmene 403, yanıt ucu veliye 403', async () => {
    const { t, teacher } = await staffed()
    const s = await published(t)
    assertError(await list(null), 401)
    assertError(await assigned(null), 401)
    assertError(await respond(null, s, answers(4, 9)), 401)
    assertError(await list(teacher.cookie), 403, 'forbidden')
    assertError(await create(teacher.cookie), 403, 'forbidden')
    assertError(await results(teacher.cookie, s), 403, 'forbidden')
    assertError(await publish(teacher.cookie, s), 403, 'forbidden')
    const parent = await member(t, 'veli')
    assertError(await assigned(parent.cookie), 403, 'forbidden')
    assertError(await respond(parent.cookie, s, answers(4, 9)), 403, 'forbidden')
  })

  test('DOM-FIN-143: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await list(closed.admin), 403, 'module_disabled')
    assertError(await assigned(closed.admin), 403, 'module_disabled')
    assertError(await create(closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-143: taslak açılır, eşik kurum ayarından gelir; Idempotency-Key tekrarı ikinci taslak açmaz (K-484)', async () => {
    const t = await institution()
    ok(
      await call(
        'PATCH',
        '/api/v1/finance/staff-feedback-settings',
        t.admin,
        { peerAnonymityThreshold: 4 },
        ifMatch(1),
      ),
    )
    const headers = key()
    const first = await create(t.admin, surveyBody(), headers)
    const draft = ok(first, 201)
    assert.equal(draft.status, 'draft')
    assert.equal(draft.phase, 'draft')
    assert.equal(draft.anonymityThreshold, 4)
    assert.equal(draft.participation, null)
    assert.equal(draft.revision, 1)
    const replay = await create(t.admin, surveyBody(), headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const rows = await db.select().from(staffSurveys).where(eq(staffSurveys.institutionId, t.id))
    assert.equal(rows.length, 1)
    assertError(await create(t.admin, surveyBody()), 201)
    assertError(await create(t.admin, surveyBody(), {}), 400, 'idempotency_key_required')
    const explicit = ok(await create(t.admin, surveyBody({ anonymityThreshold: 6 })), 201)
    assert.equal(explicit.anonymityThreshold, 6)
    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'finance.staff_survey.create'),
          eq(auditLog.entityId, String(draft.id)),
        ),
      )
    assert.equal(audit.length, 1)
  })

  test('DOM-FIN-143: geçersiz taslak 400/422 ve hiçbir satır yazılmaz (K-484)', async () => {
    const t = await institution()
    assertError(await create(t.admin, surveyBody({ closeDate: '2026-10-01' })), 400)
    assertError(await create(t.admin, surveyBody({ questions: [] })), 400)
    assertError(await create(t.admin, surveyBody({ anonymityThreshold: 2 })), 400)
    assertError(
      await create(t.admin, surveyBody({ audience: { roles: ['veli'], unitIds: [] } })),
      400,
    )
    assertError(
      await create(t.admin, surveyBody({ audience: { roles: [], unitIds: [randomUUID()] } })),
      422,
      'staff_survey_unit_not_found',
    )
    const rows = await db.select().from(staffSurveys).where(eq(staffSurveys.institutionId, t.id))
    assert.equal(rows.length, 0)
  })

  test('DOM-FIN-143: taslak düzeltilir; If-Match zorunlu, eski sürüm 409; birleşen tarih 422 (K-484)', async () => {
    const t = await institution()
    const draft = ok(await create(t.admin), 201)
    assertError(
      await call('PATCH', `${SURVEYS}/${String(draft.id)}`, t.admin, { title: 'Yeni' }),
      400,
      'if_match_required',
    )
    const edited = ok(await patch(t.admin, draft, { title: 'Bahar anketi' }))
    assert.equal(edited.title, 'Bahar anketi')
    assert.equal(edited.version, 2)
    assertError(await patch(t.admin, draft, { title: 'Eski sürüm' }), 409)
    assertError(
      await patch(t.admin, edited, { closeDate: '2026-10-01' }),
      422,
      'staff_survey_dates_invalid',
    )
    assertError(await patch(t.admin, edited, {}), 400)
    assert.equal((await surveyRow(draft.id))?.title, 'Bahar anketi')
  })

  test('DOM-FIN-143: yayım hedef kitleyi dondurur; eşik altı hedef kitle 422 ve katılımcı yazılmaz (K-484, K-486)', async () => {
    const t = await institution()
    const teacher = await member(t, 'ogretmen')
    const draft = ok(await create(t.admin), 201)
    const preview = ok(await detail(t.admin, draft))
    assert.equal(preview.audienceSize, 2)
    assertError(await publish(t.admin, draft), 422, 'staff_survey_audience_below_threshold')
    const none = await db
      .select()
      .from(staffSurveyParticipants)
      .where(eq(staffSurveyParticipants.surveyId, String(draft.id)))
    assert.equal(none.length, 0)
    assert.equal((await surveyRow(draft.id))?.status, 'draft')

    const desk = await member(t, 'onburo')
    await member(t, 'veli')
    const live = ok(await publish(t.admin, draft))
    assert.equal(live.status, 'published')
    assert.equal(live.phase, 'open')
    assert.deepEqual(live.participation, { participants: 3, responded: 0, rate: 0 })
    const participants = await db
      .select()
      .from(staffSurveyParticipants)
      .where(eq(staffSurveyParticipants.surveyId, String(draft.id)))
    assert.deepEqual(
      participants.map((row) => row.membershipId).sort(),
      [t.adminMembershipId, teacher.membershipId, desk.membershipId].sort(),
    )
    // Yayımdan sonra gelen personel katılmaz.
    const late = await member(t, 'ogretmen')
    assertError(await respond(late.cookie, live, answers(4, 9)), 404)
    // Yayımlanan anket değişmez: uç 409, veritabanı tetikleyicisi 55000.
    assertError(await patch(t.admin, live, { title: 'Değişti' }), 409, 'staff_survey_not_draft')
    assertError(await publish(t.admin, live), 409, 'staff_survey_not_draft')
    assertError(await archive(t.admin, live), 409, 'staff_survey_not_draft')
    await assert.rejects(
      db.execute(sql`update staff_surveys set title = 'Elle' where id = ${String(live.id)}`),
      (error: unknown) =>
        JSON.stringify(error).includes('55000') || String(error).includes('immutable'),
    )
  })

  test('DOM-FIN-143: rol ve birim süzgeci; birim yayım günü süren atamadan (K-484)', async () => {
    const { t, teacher, teacher2, desk } = await staffed()
    const unit = await unitWith(t, 'Fen zümresi', [
      teacher.membershipId,
      teacher2.membershipId,
      desk.membershipId,
    ])
    const byRole = ok(
      await create(t.admin, surveyBody({ audience: { roles: ['ogretmen'], unitIds: [] } })),
      201,
    )
    assert.equal(ok(await detail(t.admin, byRole)).audienceSize, 2)
    const byUnit = ok(
      await create(t.admin, surveyBody({ audience: { roles: [], unitIds: [unit] } })),
      201,
    )
    const view = ok(await detail(t.admin, byUnit))
    assert.equal(view.audienceSize, 3)
    assert.deepEqual(view.audienceUnits, [{ id: unit, name: 'Fen zümresi' }])
    const live = ok(await publish(t.admin, byUnit))
    const participants = await db
      .select()
      .from(staffSurveyParticipants)
      .where(eq(staffSurveyParticipants.surveyId, String(live.id)))
    assert.ok(participants.every((row) => row.unitId === unit))
    assert.ok(!participants.some((row) => row.membershipId === t.adminMembershipId))
  })

  test('DOM-FIN-143: personel bir kez yanıtlar; yanıt kişiye ve zamana bağlanmaz, denetime cevap yazılmaz (K-485)', async () => {
    const { t, teacher } = await staffed()
    const s = await published(t)
    const mine = ok(await assigned(teacher.cookie)) as unknown as Json[]
    assert.equal(mine.length, 1)
    assert.equal(mine[0]?.responded, false)
    assert.equal((mine[0]?.questions as unknown[]).length, 3)

    now = new Date(FIXED_NOW.getTime() + 3 * 3_600_000)
    const headers = key()
    const first = await respond(teacher.cookie, s, answers(4, 9, SECRET), headers)
    assert.deepEqual(ok(first, 201), { surveyId: s.id, responded: true })
    assert.ok(!first.body.includes(SECRET))
    // Aynı anahtar farklı gövdeyle de ilk yanıtı tekrarlar: özet gövdesizdir.
    const replay = await respond(teacher.cookie, s, answers(1, 0), headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(
      await respond(teacher.cookie, s, answers(2, 3)),
      409,
      'staff_survey_already_responded',
    )

    const rows = await responseRows(s.id)
    assert.equal(rows.length, 1)
    const [row] = rows
    assert.ok(row !== undefined)
    assert.ok(!('membershipId' in row) && !('userId' in row))
    assert.ok(!JSON.stringify(row).includes(teacher.membershipId))
    const survey = await surveyRow(s.id)
    assert.equal(row.createdAt.toISOString(), survey?.publishedAt?.toISOString())
    assert.equal(row.updatedAt.toISOString(), survey?.publishedAt?.toISOString())
    const [participant] = await db
      .select()
      .from(staffSurveyParticipants)
      .where(
        and(
          eq(staffSurveyParticipants.surveyId, String(s.id)),
          eq(staffSurveyParticipants.membershipId, teacher.membershipId),
        ),
      )
    assert.equal(participant?.responded, true)
    assert.equal(participant?.updatedAt.toISOString(), survey?.publishedAt?.toISOString())

    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'finance.staff_survey.respond'))
    const entry = audit.find((item) => item.entityId === s.id)
    assert.deepEqual(entry?.changes, { fields: ['participation'] })
    assert.ok(!JSON.stringify(audit).includes(SECRET))
    const keys = await db.execute(
      sql`select response_body from idempotency_keys where key = ${headers['idempotency-key']}`,
    )
    assert.ok(!JSON.stringify(keys).includes(SECRET))
    // Yanıt satırı değişmez.
    await assert.rejects(
      db.execute(
        sql`update staff_survey_responses set unit_id = null where survey_id = ${String(s.id)}`,
      ),
    )
    const after = ok(await assigned(teacher.cookie)) as unknown as Json[]
    assert.equal(after[0]?.responded, true)
    assert.deepEqual(ok(await detail(t.admin, s)).participation, {
      participants: 4,
      responded: 1,
      rate: 25,
    })
  })

  test('DOM-FIN-143: yanıt doğrulaması 400/422 ve katılım işaretlenmez (K-485)', async () => {
    const { t, teacher } = await staffed()
    const s = await published(t)
    assertError(
      await respond(teacher.cookie, s, { answers: [{ value: 4 }] }),
      422,
      'staff_survey_answers_mismatch',
    )
    assertError(await respond(teacher.cookie, s, answers(6, 9)), 422, 'staff_survey_answer_range')
    assertError(await respond(teacher.cookie, s, answers(4, 11)), 422, 'staff_survey_answer_range')
    assertError(
      await respond(teacher.cookie, s, { answers: [{ value: 4 }, {}, {}] }),
      422,
      'staff_survey_incomplete',
    )
    assertError(await respond(teacher.cookie, s, { ...answers(4, 9), membershipId: 'x' }), 400)
    assertError(
      await respond(teacher.cookie, s, answers(4, 9), {}),
      400,
      'idempotency_key_required',
    )
    assert.equal((await responseRows(s.id)).length, 0)
    const [participant] = await db
      .select()
      .from(staffSurveyParticipants)
      .where(eq(staffSurveyParticipants.membershipId, teacher.membershipId))
    assert.equal(participant?.responded, false)
  })

  test('DOM-FIN-143: açılmadan ve kapanıştan sonra yanıt alınmaz (K-485)', async () => {
    const { t, teacher } = await staffed()
    const later = await published(t, { openDate: '2026-10-08', closeDate: '2026-10-12' })
    assert.equal(later.phase, 'scheduled')
    assertError(await respond(teacher.cookie, later, answers(4, 9)), 422, 'staff_survey_not_open')
    const s = await published(t)
    advance(5)
    assertError(await respond(teacher.cookie, s, answers(4, 9)), 422, 'staff_survey_closed')
    assert.equal((await responseRows(s.id)).length, 0)
    const mine = ok(await assigned(teacher.cookie)) as unknown as Json[]
    assert.deepEqual(
      mine.map((row) => row.id),
      [later.id],
    )
  })

  test('DOM-FIN-143: sonuç kapanmadan ve eşik altında gizli; kapanınca dağılım, ortalama, eNPS (K-486)', async () => {
    const { t, teacher, teacher2, desk } = await staffed()
    const s = await published(t)
    ok(await respond(teacher.cookie, s, answers(5, 10, `${SECRET}-1`)), 201)
    ok(await respond(teacher2.cookie, s, answers(4, 9, `${SECRET}-2`)), 201)
    const open = ok(await results(t.admin, s))
    assert.equal(open.visible, false)
    assert.equal(open.hiddenReason, 'not_closed')
    assert.equal(open.responded, 2)
    assert.ok(!JSON.stringify(open).includes(SECRET))

    advance(5)
    const few = ok(await results(t.admin, s))
    assert.equal(few.hiddenReason, 'below_threshold')
    assert.ok(!JSON.stringify(few).includes(SECRET))

    now = FIXED_NOW
    const other = await published(t, { title: 'Kış anketi' })
    ok(await respond(teacher.cookie, other, answers(5, 10, 'Birinci')), 201)
    ok(await respond(teacher2.cookie, other, answers(4, 9)), 201)
    ok(await respond(desk.cookie, other, answers(2, 3, 'İkinci')), 201)
    advance(5)
    const result = ok(await results(t.admin, other))
    assert.equal(result.visible, true)
    assert.equal(result.rate, 75)
    const [likert, enps, openQuestion] = result.questions as Json[]
    assert.deepEqual(likert?.distribution, [0, 1, 0, 1, 1])
    assert.equal(likert?.average, 3.67)
    assert.deepEqual(enps?.enps, { score: 33, promoters: 2, passives: 0, detractors: 1 })
    // Açık uçlu soruyu 2 kişi cevapladı: eşik altında, metin dönmez.
    assert.equal(openQuestion?.hidden, true)
    assert.deepEqual(openQuestion?.texts, [])
    assert.ok(!JSON.stringify(result).includes('At"'))
    const reads = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'finance.staff_survey_result.read'))
    const mine = reads.filter((entry) => entry.entityId === other.id)
    assert.equal(mine.length, 1)
    assert.deepEqual(mine[0]?.changes, { fields: ['aggregate', 'openTexts'] })
  })

  test('DOM-FIN-143: birim süzgeci eşiği altına düşürürse gösterilmez; açık uçlu cevaplar eşik üstünde (K-486)', async () => {
    const t = await institution()
    const people = await Promise.all(
      ['ogretmen', 'ogretmen', 'ogretmen', 'ogretmen', 'onburo'].map((role) =>
        member(t, role as Role),
      ),
    )
    const science = await unitWith(
      t,
      'Fen zümresi',
      people.slice(0, 4).map((person) => person.membershipId),
    )
    const front = await unitWith(t, 'Ön büro', [people[4]?.membershipId ?? ''])
    const s = await published(t)
    for (const [index, person] of people.entries())
      ok(await respond(person.cookie, s, answers(4, 9, `Görüş ${String(index + 1)}`)), 201)
    advance(5)
    const all = ok(await results(t.admin, s))
    assert.equal(all.visible, true)
    // Fen 4 yanıt görünür; ön büro 1 yanıt gizli ve gizli toplam 1 < 3 olduğundan Fen de
    // kırılımda gösterilmez (tamamlayıcı gizleme).
    assert.deepEqual(all.units, [])
    const texts = (all.questions as Json[])[2]?.texts as string[]
    assert.equal(texts.length, 5)
    assert.deepEqual([...texts].sort(), ['Görüş 1', 'Görüş 2', 'Görüş 3', 'Görüş 4', 'Görüş 5'])
    for (const unit of [science, front, 'none']) {
      const filtered = ok(await results(t.admin, s, `?unit=${unit}`))
      assert.equal(filtered.visible, false)
      assert.equal(filtered.hiddenReason, 'unit_below_threshold')
      assert.ok(!JSON.stringify(filtered).includes('Görüş'))
    }
    assertError(await results(t.admin, s, '?unit=fen'), 400)
  })

  test('DOM-FIN-143: yeni sürüm yayımlanmıştan bir kez açılır; taslak kaldırılır ve listelenmez (K-484)', async () => {
    const { t } = await staffed()
    const s = await published(t)
    const draft = ok(await copy(t.admin, s), 201)
    assert.equal(draft.revision, 2)
    assert.equal(draft.sourceSurveyId, s.id)
    assert.equal(draft.status, 'draft')
    assertError(await copy(t.admin, s), 409, 'staff_survey_copy_exists')
    assertError(await copy(t.admin, draft), 409, 'staff_survey_copy_draft')
    ok(await archive(t.admin, draft))
    const rows = ok(await list(t.admin)) as unknown as Json[]
    assert.deepEqual(
      rows.map((row) => row.id),
      [s.id],
    )
    assertError(await detail(t.admin, draft), 404)
    // Kaldırılan sürümden sonra yeniden kopya açılır.
    ok(await copy(t.admin, s), 201)
    const drafts = ok(await list(t.admin, '?phase=draft')) as unknown as Json[]
    assert.equal(drafts.length, 1)
    const opened = ok(await list(t.admin, '?phase=open')) as unknown as Json[]
    assert.deepEqual(
      opened.map((row) => row.id),
      [s.id],
    )
    assertError(await list(t.admin, '?durum=x'), 400)
  })

  test('DOM-FIN-143: başka kurumun anketi 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const aTeacher = await member(a, 'ogretmen')
    const { t: b } = await staffed()
    const bDraft = ok(await create(b.admin), 201)
    const bLive = await published(b, { title: 'B kurumu anketi' })
    const before = await surveyRow(bDraft.id)
    assertError(await detail(a.admin, bDraft), 404)
    assertError(await patch(a.admin, bDraft, { title: 'Ele geçirildi' }), 404)
    assertError(await publish(a.admin, bDraft), 404)
    assertError(await archive(a.admin, bDraft), 404)
    assertError(await copy(a.admin, bLive), 404)
    assertError(await results(a.admin, bLive), 404)
    assertError(await respond(aTeacher.cookie, bLive, answers(4, 9)), 404)
    assertError(await respond(a.admin, bLive, answers(4, 9)), 404)
    assert.deepEqual(await surveyRow(bDraft.id), before)
    assert.equal((await responseRows(bLive.id)).length, 0)
    const aList = ok(await list(a.admin)) as unknown as Json[]
    assert.equal(aList.length, 0)
    assert.equal((ok(await assigned(aTeacher.cookie)) as unknown as Json[]).length, 0)
    assertError(await create(a.admin, { ...surveyBody(), institutionId: b.id }), 400)
    const bRows = await db.select().from(staffSurveys).where(eq(staffSurveys.institutionId, b.id))
    assert.equal(bRows.length, 2)
  })
})
