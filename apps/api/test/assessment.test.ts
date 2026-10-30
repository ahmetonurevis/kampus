import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import {
  ASSESSMENT_COMMANDS,
  type AssessmentCommand,
} from '@kampus/school-core/modules/commands.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import type { CollectionName } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { ASSESSMENT_ROUTES } from '../src/routes/assessment.schemas.ts'
import { planDifference } from '../src/services/assessment.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
import {
  ASSESSMENT_COLLECTIONS,
  classStudents,
  evaluationText,
  PLAN,
  profileBody,
  SEED,
  sampleRows,
} from './support/assessment-sample.ts'
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
 * Optik değerlendirme ve otomatik etüt uçları (`/api/v1/assessment/...`, DOM-YTK-021,
 * DOM-YTK-040): komut köprüsü, saf önizleme, dosya sınırı, idempotency, kapsamlı okuma.
 * Her test kendi kurumunu kurar; başarısızlıkta kaydın değişmediği satır karşılaştırmasıyla
 * doğrulanır.
 */

const AFTER_PLAN = new Date('2026-10-21T10:00:00.000Z')
const BASE = '/api/v1/assessment'

describe('optik değerlendirme ve etüt uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, sampleRows(), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }

  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    return signInAs(app, await createMember(app, institutionId, role, links))
  }

  const key = () => ({ 'idempotency-key': randomUUID() })

  function post(
    url: string,
    cookie: string | null,
    body: unknown = {},
    headers: Record<string, string> = {},
    target: App = app,
  ) {
    return target.inject({
      method: 'POST',
      url,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        'content-type': 'application/json',
        ...headers,
      },
      payload: JSON.stringify(body),
    })
  }

  function get(url: string, cookie: string) {
    return app.inject({ method: 'GET', url, headers: { cookie } })
  }

  function assertError(
    response: Awaited<ReturnType<typeof post>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  /** Kurumun etüt/optik koleksiyonlarının satırları (sürüm ve veri) ve denetim kaydı sayısı. */
  async function snapshot(institutionId: string) {
    const rows = await loadRecords(db, institutionId, [...ASSESSMENT_COLLECTIONS], {
      includeArchived: true,
    })
    const audits = await db.select().from(auditLog).where(eq(auditLog.institutionId, institutionId))
    return {
      rows: rows.map((row) => [row.collection, row.id, row.version, row.data]),
      audits: audits.length,
    }
  }

  async function count(institutionId: string, collection: CollectionName) {
    return (await loadRecords(db, institutionId, [collection])).length
  }

  async function evaluated() {
    const a = await institution()
    const response = await post(
      `${BASE}/evaluate`,
      a.adminCookie,
      { profileId: 'optical-exam-7-1', text: evaluationText() },
      key(),
    )
    assert.equal(response.statusCode, 200, response.body)
    return a
  }

  async function planned() {
    const a = await evaluated()
    const response = await post(`${BASE}/plan`, a.adminCookie, PLAN, key())
    assert.equal(response.statusCode, 200, response.body)
    const sessions = await loadRecords(db, a.id, ['tutorSessions'])
    assert.ok(sessions.length > 0)
    return { a, sessions }
  }

  const evaluate = { profileId: 'optical-exam-7-1', text: evaluationText() }

  // --- Ortak güvence ------------------------------------------------------------------------

  describe('tablo ve yüzey', () => {
    test('her core komutunun rotası var ve modülü core tablosundandır', () => {
      const commands = Object.keys(ASSESSMENT_COMMANDS) as AssessmentCommand[]
      assert.deepEqual(Object.keys(ASSESSMENT_ROUTES).sort(), [...commands].sort())
    })

    test('kimliksiz her uç 401', async () => {
      const urls = [
        ...Object.entries(ASSESSMENT_ROUTES).flatMap(([name, route]) => [
          ...(route.record === 'required' ? [] : [`${BASE}/${name}`]),
          ...(route.record === 'none' ? [] : [`${BASE}/${name}/x`]),
        ]),
        `${BASE}/plan/preview`,
        `${BASE}/evaluate/preview`,
      ]
      assert.equal(urls.length, 10)
      for (const url of urls) assertError(await post(url, null, {}), 401, 'unauthenticated')
    })

    test('yönetici ve öğretmen dışı roller 403, kayıt değişmez', async () => {
      const a = await institution()
      const roles = [
        await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }]),
        await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }]),
        await member(a.id, 'onburo'),
      ]
      const before = await snapshot(a.id)
      for (const cookie of roles) {
        assertError(await post(`${BASE}/evaluate`, cookie, evaluate, key()), 403)
        assertError(await post(`${BASE}/evaluate/preview`, cookie, evaluate), 403)
        assertError(await post(`${BASE}/plan`, cookie, PLAN, key()), 403)
        assertError(await post(`${BASE}/plan/preview`, cookie, PLAN), 403)
        assertError(
          await post(`${BASE}/slot`, cookie, {
            teacherId: 't1',
            date: '2026-10-11T10:00:00.000Z',
            duration: 30,
          }),
          403,
        )
        assertError(await post(`${BASE}/slot-remove/slot-t1-0`, cookie, {}), 403)
      }
      assert.deepEqual(await snapshot(a.id), before)
    })

    test('cevap anahtarını yalnız yönetici düzenler: öğretmen 403', async () => {
      const a = await institution()
      const teacher = await member(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
      const profile = SEED.opticalProfiles[0]
      assert.ok(profile)
      const body = profileBody()
      assertError(
        await post(`${BASE}/profile/${profile.id}`, teacher, body),
        403,
        'answer_key_admin_only',
      )
    })

    test('modül kapalıysa 403 module_disabled; dil okulunda 404', async () => {
      const noOptical = await institution({ enabledModules: { ...SEED.modules, optical: false } })
      assertError(
        await post(`${BASE}/evaluate`, noOptical.adminCookie, evaluate, key()),
        403,
        'module_disabled',
      )
      assertError(
        await post(`${BASE}/evaluate/preview`, noOptical.adminCookie, evaluate),
        403,
        'module_disabled',
      )
      const noTutoring = await institution({ enabledModules: { ...SEED.modules, tutoring: false } })
      for (const url of [`${BASE}/plan`, `${BASE}/plan/preview`])
        assertError(await post(url, noTutoring.adminCookie, PLAN, key()), 403, 'module_disabled')
      assertError(
        await post(`${BASE}/slot`, noTutoring.adminCookie, {
          teacherId: 't1',
          date: '2026-10-11T10:00:00.000Z',
          duration: 30,
        }),
        403,
        'module_disabled',
      )
      assert.equal(await count(noTutoring.id, 'tutorSessions'), 0)
      const language = await institution({ type: 'language_school' })
      assertError(await post(`${BASE}/plan`, language.adminCookie, PLAN, key()), 404)
    })
  })

  // --- Değerlendirme --------------------------------------------------------------------------

  describe('POST /assessment/evaluate (okuyucu dosyası)', () => {
    test('başarıda sonuç kayıtları oluşur; gövdedeki institutionId etkisiz', async () => {
      const a = await institution()
      const b = await institution()
      const before = await snapshot(b.id)
      const students = classStudents('c1')
      const response = await post(
        `${BASE}/evaluate`,
        a.adminCookie,
        { ...evaluate, institutionId: b.id },
        key(),
      )
      assert.equal(response.statusCode, 200, response.body)
      const changes = response.json().data.changes
      assert.ok(changes.inserted >= students.length)
      const evaluations = await loadRecords(db, a.id, ['opticalEvaluations'])
      assert.equal(evaluations.length, students.length * 3)
      const results = await loadRecords(db, a.id, ['mockResults'])
      const optical = results.filter((row) => row.data.source === 'optical')
      assert.equal(optical.length, students.length * 3)
      assert.deepEqual(await snapshot(b.id), before)
      const audits = await db.select().from(auditLog).where(eq(auditLog.institutionId, a.id))
      assert.ok(audits.some((row) => row.action === 'assessment.evaluate'))
    })

    test('Idempotency-Key zorunlu; aynı anahtar ilk yanıtı tekrarlar, kayıt çoğalmaz', async () => {
      const a = await institution()
      assertError(
        await post(`${BASE}/evaluate`, a.adminCookie, evaluate),
        400,
        'idempotency_key_required',
      )
      assert.equal(await count(a.id, 'opticalEvaluations'), 0)
      const headers = key()
      const first = await post(`${BASE}/evaluate`, a.adminCookie, evaluate, headers)
      const again = await post(`${BASE}/evaluate`, a.adminCookie, evaluate, headers)
      assert.equal(first.statusCode, 200, first.body)
      assert.equal(again.statusCode, 200, again.body)
      assert.equal(again.headers['idempotent-replayed'], 'true')
      assert.deepEqual(again.json(), first.json())
      const rows = await loadRecords(db, a.id, ['opticalEvaluations'])
      assert.ok(rows.every((row) => row.version === 1))
      assertError(
        await post(
          `${BASE}/evaluate`,
          a.adminCookie,
          { ...evaluate, text: evaluationText('AAAAAAAAAAAA') },
          headers,
        ),
        422,
        'idempotency_key_reused',
      )
    })

    test('ayrıştırma hatası satır numarasıyla 422 döner ve hiçbir kayıt değişmez', async () => {
      const a = await institution()
      const before = await snapshot(a.id)
      const [first] = classStudents('c1')
      assert.ok(first)
      const text = [
        'student;booklet;answers',
        `${first.number};A;BBBDABCDABCD`,
        '2026999;A;BBB',
      ].join('\n')
      const response = await post(`${BASE}/evaluate`, a.adminCookie, { ...evaluate, text }, key())
      assertError(response, 422, 'optical_student_unmatched')
      assert.deepEqual(response.json().issues, [
        {
          path: ['text', 'line', 3],
          code: 'optical_student_unmatched',
          message: response.json().message,
        },
      ])
      // Yanlış sütun sayısı da satır numarası taşır.
      const columns = await post(
        `${BASE}/evaluate`,
        a.adminCookie,
        { ...evaluate, text: 'student;booklet;answers\n2026001;A' },
        key(),
      )
      assertError(columns, 422, 'csv_invalid_column_count')
      assert.deepEqual(columns.json().issues[0].path, ['text', 'line', 2])
      assert.deepEqual(await snapshot(a.id), before)
    })

    test('1 MB üstü dosya 413 ve hiçbir kayıt değişmez; sınır tam 1 MB', async () => {
      const a = await institution()
      const before = await snapshot(a.id)
      const big = `student;booklet;answers\n${'x'.repeat(1024 * 1024)}`
      const response = await post(
        `${BASE}/evaluate`,
        a.adminCookie,
        { ...evaluate, text: big },
        key(),
      )
      assertError(response, 413, 'payload_too_large')
      assert.deepEqual(response.json().issues[0].path, ['text'])
      const preview = await post(`${BASE}/evaluate/preview`, a.adminCookie, {
        ...evaluate,
        text: big,
      })
      assertError(preview, 413, 'payload_too_large')
      assert.deepEqual(await snapshot(a.id), before)
    })

    test('öğretmen yalnız kendi sınıfındaki öğrencilerin kendi branş sonucunu kaydeder', async () => {
      const a = await institution()
      const teacher = await member(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't2' }])
      const response = await post(`${BASE}/evaluate`, teacher, evaluate, key())
      assert.equal(response.statusCode, 200, response.body)
      const rows = await loadRecords(db, a.id, ['opticalEvaluations'])
      assert.ok(rows.length > 0)
      assert.ok(rows.every((row) => row.data.subjectId === 'turkish'))
      // Sınıfında dersi olmayan öğretmenin kapsamı öğrenciyi içermez.
      const other = await institution()
      const outsider = await member(other.id, 'ogretmen', [{ kind: 'teacher', recordId: 't33' }])
      const denied = await post(`${BASE}/evaluate`, outsider, evaluate, key())
      assertError(denied, 422, 'optical_student_out_of_scope')
      assert.equal(await count(other.id, 'opticalEvaluations'), 0)
    })

    test('önizleme hiçbir satırı değiştirmez; digest ile onay, bayat digest 409', async () => {
      const a = await institution()
      const before = await snapshot(a.id)
      const preview = await post(`${BASE}/evaluate/preview`, a.adminCookie, evaluate)
      assert.equal(preview.statusCode, 200, preview.body)
      const data = preview.json().data
      assert.equal(data.summary.studentCount, classStudents('c1').length)
      assert.equal(data.rows.length, data.summary.rowCount)
      assert.ok(data.rows.every((row: Record<string, unknown>) => !('questionResults' in row)))
      assert.match(data.digest, /^[0-9a-f]{64}$/)
      assert.deepEqual(await snapshot(a.id), before)

      assertError(
        await post(
          `${BASE}/evaluate`,
          a.adminCookie,
          { ...evaluate, expectedDigest: '0'.repeat(64) },
          key(),
        ),
        409,
        'evaluation_stale',
      )
      assert.deepEqual(await snapshot(a.id), before)
      const commit = await post(
        `${BASE}/evaluate`,
        a.adminCookie,
        { ...evaluate, expectedDigest: data.digest },
        key(),
      )
      assert.equal(commit.statusCode, 200, commit.body)
      // Aynı dosya yeniden önizlenince sonuçların üzerine yazılacağı işaretlenir.
      const again = await post(`${BASE}/evaluate/preview`, a.adminCookie, evaluate)
      assert.equal(again.json().data.summary.replacesCount, data.summary.rowCount)
    })

    test('önizleme dosya hatasında satır numarası döner, kayıt değişmez', async () => {
      const a = await institution()
      const before = await snapshot(a.id)
      const response = await post(`${BASE}/evaluate/preview`, a.adminCookie, {
        ...evaluate,
        text: 'student;booklet;answers\n2026001;Z;BBBDABCDABCD',
      })
      assertError(response, 422, 'optical_booklet_unknown')
      assert.deepEqual(response.json().issues[0].path, ['text', 'line', 2])
      assert.deepEqual(await snapshot(a.id), before)
    })

    test('olmayan profil 404; başka kurumun profili 404 ve B değişmez', async () => {
      const a = await institution()
      const b = await institution()
      await insertMissingRecords(
        db,
        b.id,
        [
          {
            collection: 'opticalProfiles',
            id: 'test-profil-b',
            data: { ...SEED.opticalProfiles[0], id: 'test-profil-b' },
          },
        ],
        FIXED_NOW,
      )
      const before = await snapshot(b.id)
      assertError(
        await post(
          `${BASE}/evaluate`,
          a.adminCookie,
          { ...evaluate, profileId: 'test-profil-b' },
          key(),
        ),
        404,
        'not_found',
      )
      assert.deepEqual(await snapshot(b.id), before)
    })
  })

  // --- Profil -----------------------------------------------------------------------------------

  describe('POST /assessment/profile', () => {
    test('anahtar revizyonu eski analizi etüt için kullanılmaz kılar; If-Match sürümü denetlenir', async () => {
      const a = await evaluated()
      const url = `${BASE}/profile/optical-exam-7-1`
      const changed = profileBody((answer) => (answer === 'A' ? 'B' : 'A'))
      assertError(
        await post(url, a.adminCookie, changed, { 'if-match': '"9"' }),
        409,
        'version_conflict',
      )
      assert.equal(
        (await findRecord(db, a.id, 'opticalProfiles', 'optical-exam-7-1'))?.data.revision,
        1,
      )
      const update = await post(url, a.adminCookie, changed, { 'if-match': '"1"' })
      assert.equal(update.statusCode, 200, update.body)
      const stored = await findRecord(db, a.id, 'opticalProfiles', 'optical-exam-7-1')
      assert.equal(stored?.data.revision, 2)
      assert.equal(stored?.version, 2)
      const preview = await post(`${BASE}/plan/preview`, a.adminCookie, PLAN)
      assert.equal(preview.statusCode, 200, preview.body)
      assert.equal(preview.json().data.evaluatedStudents, 0)
      assert.equal(preview.json().data.sessions.length, 0)
      assertError(
        await post(`${BASE}/plan`, a.adminCookie, PLAN, key()),
        422,
        'tutoring_nothing_to_create',
      )
    })

    test('cevap anahtarı hatası satır numarasıyla 422 ve profil değişmez', async () => {
      const a = await institution()
      const before = await snapshot(a.id)
      const body = profileBody()
      const lines = body.keyCsv.split('\n')
      lines[3] = 'A;3;math;Denklemler;Z'
      const response = await post(`${BASE}/profile/optical-exam-7-1`, a.adminCookie, {
        ...body,
        keyCsv: lines.join('\n'),
      })
      assertError(response, 422, 'answer_key_invalid_values')
      assert.deepEqual(response.json().issues[0].path, ['keyCsv', 'line', 4])
      assert.deepEqual(await snapshot(a.id), before)
    })

    test('aynı sınav için ikinci profil 409; If-Match oluşturmada 400', async () => {
      const a = await institution()
      const body = profileBody()
      assertError(await post(`${BASE}/profile`, a.adminCookie, body), 409, 'optical_profile_exists')
      assertError(
        await post(`${BASE}/profile`, a.adminCookie, body, { 'if-match': '"1"' }),
        400,
        'if_match_not_supported',
      )
    })
  })

  // --- Plan ------------------------------------------------------------------------------------

  describe('etüt planı: önizleme ve onay', () => {
    test('önizleme hiçbir satırı değiştirmez; oturum, kapasite ve uyarı döner', async () => {
      const a = await evaluated()
      const before = await snapshot(a.id)
      const response = await post(`${BASE}/plan/preview`, a.adminCookie, PLAN)
      assert.equal(response.statusCode, 200, response.body)
      const data = response.json().data
      assert.ok(data.sessions.length > 0)
      for (const session of data.sessions) {
        assert.ok(session.studentIds.length <= session.capacity)
        assert.ok(session.capacity <= PLAN.maxGroupSize)
      }
      assert.equal(data.summary.sessionCount, data.sessions.length)
      assert.equal(typeof data.expectedPlan, 'string')
      assert.equal(JSON.parse(data.expectedPlan).sessions.length, data.sessions.length)
      assert.deepEqual(await snapshot(a.id), before)
      // Tekrarlanan önizleme de aynı planı verir (saf işlem).
      assert.equal(
        (await post(`${BASE}/plan/preview`, a.adminCookie, PLAN)).json().data.expectedPlan,
        data.expectedPlan,
      )
    })

    test('uygunluk saati yoksa gruplar nedeniyle yerleşemeyenlerde döner', async () => {
      const a = await evaluated()
      const slots = await loadRecords(db, a.id, ['availability'])
      assert.ok(slots.length > 0)
      const response = await post(`${BASE}/plan/preview`, a.adminCookie, {
        ...PLAN,
        fromDate: '2026-12-01',
        toDate: '2026-12-10',
      })
      assert.equal(response.statusCode, 200, response.body)
      const data = response.json().data
      assert.equal(data.sessions.length, 0)
      assert.ok(data.unresolved.length > 0)
      assert.ok(data.unresolved.every((group: { reason: string }) => group.reason.length > 0))
    })

    test('onay önizlenen planı oluşturur; plan değiştiyse 409 ve fark, hiçbir şey yazılmaz', async () => {
      const a = await evaluated()
      const preview = (await post(`${BASE}/plan/preview`, a.adminCookie, PLAN)).json().data
      const created = await post(
        `${BASE}/plan`,
        a.adminCookie,
        { ...PLAN, expectedPlan: preview.expectedPlan },
        key(),
      )
      assert.equal(created.statusCode, 200, created.body)
      assert.equal(created.json().data.changes.inserted, preview.sessions.length)
      const before = await snapshot(a.id)
      // Aynı etütler artık planlı: önizlemedeki plan bayattır.
      const stale = await post(
        `${BASE}/plan`,
        a.adminCookie,
        { ...PLAN, expectedPlan: preview.expectedPlan },
        key(),
      )
      assertError(stale, 409, 'tutoring_plan_stale')
      const issues = stale.json().issues
      assert.ok(issues.length > 0)
      assert.ok(issues.every((item: { code: string }) => item.code.startsWith('plan_')))
      assert.ok(issues.some((item: { code: string }) => item.code === 'plan_session_removed'))
      assert.deepEqual(await snapshot(a.id), before)
      assertError(
        await post(`${BASE}/plan`, a.adminCookie, PLAN, key()),
        422,
        'tutoring_nothing_to_create',
      )
    })

    test('onayda yeni çakışma 409 döndürür: araya giren uygunluk kaldırılınca plan değişir', async () => {
      const a = await evaluated()
      const preview = (await post(`${BASE}/plan/preview`, a.adminCookie, PLAN)).json().data
      const first = preview.sessions[0]
      assert.ok(first)
      const slot = SEED.availability.find(
        (item) => item.teacherId === first.teacherId && item.date === first.date,
      )
      assert.ok(slot)
      const removed = await post(`${BASE}/slot-remove/${slot.id}`, a.adminCookie, {})
      assert.equal(removed.statusCode, 200, removed.body)
      const before = await snapshot(a.id)
      const stale = await post(
        `${BASE}/plan`,
        a.adminCookie,
        { ...PLAN, expectedPlan: preview.expectedPlan },
        key(),
      )
      assertError(stale, 409, 'tutoring_plan_stale')
      assert.ok(
        stale.json().issues.some((item: { code: string }) => item.code === 'plan_session_removed'),
      )
      assert.deepEqual(await snapshot(a.id), before)
    })

    test('Idempotency-Key zorunlu; aynı anahtar etütleri çoğaltmaz', async () => {
      const a = await evaluated()
      assertError(await post(`${BASE}/plan`, a.adminCookie, PLAN), 400, 'idempotency_key_required')
      assert.equal(await count(a.id, 'tutorSessions'), 0)
      const headers = key()
      const first = await post(`${BASE}/plan`, a.adminCookie, PLAN, headers)
      const created = await count(a.id, 'tutorSessions')
      assert.ok(created > 0)
      const again = await post(`${BASE}/plan`, a.adminCookie, PLAN, headers)
      assert.equal(again.headers['idempotent-replayed'], 'true')
      assert.deepEqual(again.json(), first.json())
      assert.equal(await count(a.id, 'tutorSessions'), created)
    })

    test('geçersiz tarih aralığı 422, bilinmeyen alan etkisiz, hatada kayıt değişmez', async () => {
      const a = await evaluated()
      const before = await snapshot(a.id)
      assertError(
        await post(`${BASE}/plan/preview`, a.adminCookie, { ...PLAN, fromDate: '2026-09-01' }),
        422,
        'tutoring_date_range_invalid',
      )
      assertError(
        await post(`${BASE}/plan`, a.adminCookie, { ...PLAN, threshold: 0 }, key()),
        400,
        'validation_failed',
      )
      assert.deepEqual(await snapshot(a.id), before)
    })

    test('If-Match oluşturma komutunda 400 if_match_not_supported', async () => {
      const a = await evaluated()
      assertError(
        await post(`${BASE}/plan`, a.adminCookie, PLAN, { ...key(), 'if-match': '"1"' }),
        400,
        'if_match_not_supported',
      )
    })
  })

  // --- Uygunluk, iptal, yoklama ------------------------------------------------------------------

  describe('uygunluk saati, etüt iptali ve yoklaması', () => {
    const slot = { teacherId: 't1', date: '2026-10-11T10:00:00.000Z', duration: 30 }

    test('yönetici uygunluk ekler; çakışan ikinci saat 409; kaldırma sürümü denetler', async () => {
      const a = await institution()
      const added = await post(`${BASE}/slot`, a.adminCookie, slot)
      assert.equal(added.statusCode, 200, added.body)
      const id: string = added.json().data.entity.id
      assert.equal(added.json().data.entity.collection, 'availability')
      assertError(await post(`${BASE}/slot`, a.adminCookie, slot), 409, 'availability_overlap')
      assertError(
        await post(`${BASE}/slot-remove/${id}`, a.adminCookie, {}, { 'if-match': '"7"' }),
        409,
        'version_conflict',
      )
      const removed = await post(
        `${BASE}/slot-remove/${id}`,
        a.adminCookie,
        {},
        { 'if-match': '"1"' },
      )
      assert.equal(removed.statusCode, 200, removed.body)
      assert.equal(await findRecord(db, a.id, 'availability', id), null)
      assertError(await post(`${BASE}/slot-remove/${id}`, a.adminCookie, {}), 404, 'not_found')
    })

    test('öğretmen yalnız kendi uygunluğunu ekler ve kaldırır', async () => {
      const a = await institution()
      const teacher = await member(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't2' }])
      assertError(await post(`${BASE}/slot`, teacher, slot), 403, 'availability_own_only')
      const own = await post(`${BASE}/slot`, teacher, { ...slot, teacherId: 't2' })
      assert.equal(own.statusCode, 200, own.body)
      assertError(
        await post(`${BASE}/slot-remove/slot-t1-0`, teacher, {}),
        403,
        'availability_own_only',
      )
      assert.ok(await findRecord(db, a.id, 'availability', 'slot-t1-0'))
    })

    test('başka kurumun uygunluğu ve etüdü 404, B değişmez', async () => {
      const { a: b, sessions } = await planned()
      const a = await institution()
      const foreign = {
        id: 'test-slot-b',
        teacherId: 't1',
        date: '2026-10-11T10:00:00.000Z',
        duration: 30,
      }
      await insertMissingRecords(
        db,
        b.id,
        [{ collection: 'availability', id: foreign.id, data: foreign }],
        FIXED_NOW,
      )
      const before = await snapshot(b.id)
      const id = sessions[0]?.id ?? ''
      assertError(
        await post(`${BASE}/cancel/${id}`, a.adminCookie, { reason: 'Deneme.' }),
        404,
        'not_found',
      )
      assertError(
        await post(`${BASE}/attendance/${id}`, a.adminCookie, { marks: {} }),
        404,
        'not_found',
      )
      assertError(
        await post(`${BASE}/slot-remove/test-slot-b`, a.adminCookie, {}, { 'if-match': '"1"' }),
        404,
      )
      assert.deepEqual(await snapshot(b.id), before)
    })

    test('etüt gerekçeyle iptal edilir; geçmiş korunur, ikinci iptal 409, If-Match denetlenir', async () => {
      const { a, sessions } = await planned()
      const id = sessions[0]?.id ?? ''
      const url = `${BASE}/cancel/${id}`
      assertError(await post(url, a.adminCookie, { reason: '' }), 400, 'validation_failed')
      assertError(
        await post(url, a.adminCookie, { reason: 'Deneme.' }, { 'if-match': '"4"' }),
        409,
        'version_conflict',
      )
      const done = await post(
        url,
        a.adminCookie,
        { reason: 'Öğretmen izinli.' },
        { 'if-match': '"1"' },
      )
      assert.equal(done.statusCode, 200, done.body)
      const stored = await findRecord(db, a.id, 'tutorSessions', id)
      assert.equal(stored?.data.status, 'İptal')
      assert.equal(stored?.data.cancelReason, 'Öğretmen izinli.')
      assertError(
        await post(url, a.adminCookie, { reason: 'Tekrar.' }),
        409,
        'tutoring_already_cancelled',
      )
    })

    test('gelecek etüdün yoklaması 422; etüt saatinden sonra yoklama alınır ve geçmiş kalır', async () => {
      const { a, sessions } = await planned()
      const session = sessions[0]
      assert.ok(session)
      const ids = session.data.studentIds
      assert.ok(Array.isArray(ids))
      const marks = Object.fromEntries(ids.map((id) => [String(id), 'Geldi']))
      const url = `${BASE}/attendance/${session.id}`
      assertError(await post(url, a.adminCookie, { marks }), 422, 'tutoring_attendance_future')
      assert.equal((await findRecord(db, a.id, 'tutorSessions', session.id))?.version, 1)
      const later = await buildTestApp(db, { clock: () => AFTER_PLAN })
      try {
        const cookie = await signInAs(later, a.admin)
        assertError(
          await post(url, cookie, { marks: {} }, {}, later),
          422,
          'tutoring_attendance_roster_mismatch',
        )
        const done = await post(url, cookie, { marks }, {}, later)
        assert.equal(done.statusCode, 200, done.body)
        // Tamamlanmış etüt iptal edilemez; yoklama geçmişi korunur.
        assertError(
          await post(`${BASE}/cancel/${session.id}`, cookie, { reason: 'Geç.' }, {}, later),
          422,
          'tutoring_completed',
        )
      } finally {
        await later.close()
      }
      assert.deepEqual(
        (await findRecord(db, a.id, 'tutorSessions', session.id))?.data.attendance,
        marks,
      )
    })
  })

  // --- Okuma kapsamı -------------------------------------------------------------------------

  describe('okuma uçları rol kapsamı (GET /collections/...)', () => {
    async function rows(url: string, cookie: string) {
      const response = await get(url, cookie)
      assert.equal(response.statusCode, 200, response.body)
      return response.json().data as { id: string; record: Record<string, unknown> }[]
    }

    test('opticalProfiles: öğrenci ve veli cevap anahtarsız okur, ön büro 403, öğretmen ve yönetici anahtarla okur; başka kurumun profili yok', async () => {
      const a = await institution()
      const b = await institution()
      await insertMissingRecords(
        db,
        b.id,
        [
          {
            collection: 'opticalProfiles',
            id: 'test-profil-b',
            data: { ...SEED.opticalProfiles[0], id: 'test-profil-b' },
          },
        ],
        FIXED_NOW,
      )
      const url = '/api/v1/collections/opticalProfiles'
      assert.equal((await get(url, await member(a.id, 'onburo'))).statusCode, 403)
      // Öğrenci ve veli profili yalnız güncel analizi eşlemek için okur: anahtar alanları gelmez.
      for (const cookie of [
        await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }]),
        await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }]),
      ]) {
        const [profile] = await rows(url, cookie)
        assert.equal(profile?.id, 'optical-exam-7-1')
        assert.equal(profile.record.revision, 1)
        assert.equal('keyCsv' in profile.record, false)
        assert.equal('keys' in profile.record, false)
      }
      const teacher = await member(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't2' }])
      for (const cookie of [a.adminCookie, teacher]) {
        const list = await rows(url, cookie)
        assert.deepEqual(
          list.map((item) => item.id),
          ['optical-exam-7-1'],
        )
        assert.ok(typeof list[0]?.record.keyCsv === 'string')
      }
    })

    test('opticalEvaluations: öğretmen yalnız kendi branşını görür; öğrenci ve veli yalnız kendi/çocuğunun analizini görür', async () => {
      const a = await evaluated()
      const url = '/api/v1/collections/opticalEvaluations'
      const [s1, s2] = classStudents('c1')
      assert.ok(s1 && s2)
      assert.equal((await get(url, await member(a.id, 'onburo'))).statusCode, 403)
      // Öğrenci kendi, veli bağlı çocuğunun analizini görür; başkasının adı, sonucu ve kimliği gelmez.
      const student = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: s1.id }])
      const parent = await member(a.id, 'veli', [{ kind: 'child', recordId: s2.id }])
      for (const [cookie, own] of [
        [student, s1.id],
        [parent, s2.id],
      ] as const) {
        const list = await rows(`${url}?pageSize=100`, cookie)
        assert.ok(list.length > 0)
        assert.ok(list.every((item) => item.record.studentId === own))
        const other = (await rows(`${url}?pageSize=100`, a.adminCookie)).find(
          (item) => item.record.studentId !== own,
        )
        assert.ok(other)
        assert.equal(
          list.some((item) => item.id === other.id),
          false,
        )
        assert.equal((await get(`${url}/${other.id}`, cookie)).statusCode, 404)
        assert.equal((await get(`${url}/${list[0]!.id}`, cookie)).statusCode, 200)
      }
      // Bağlantısı olmayan öğrenci hiçbir analiz görmez.
      const stranger = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's2' }])
      assert.deepEqual(await rows(url, stranger), [])
      const teacher = await member(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't2' }])
      const own = await rows(url, teacher)
      assert.ok(own.length > 0)
      assert.ok(own.every((item) => item.record.subjectId === 'turkish'))
      const all = await rows(`${url}?pageSize=100`, a.adminCookie)
      assert.ok(all.length > own.length)
      const other = await institution()
      assert.deepEqual(await rows(url, other.adminCookie), [])
    })

    test('tutorSessions: öğrenci ve veli yalnız kendi etüdünü, yalnız kendi adını görür', async () => {
      const { a } = await planned()
      const url = '/api/v1/collections/tutorSessions'
      const [s1, s2] = classStudents('c1')
      assert.ok(s1 && s2)
      const student = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: s1.id }])
      const mine = await rows(url, student)
      assert.ok(mine.length > 0)
      for (const item of mine) {
        assert.deepEqual(item.record.studentIds, [s1.id])
        const attendance = item.record.attendance as Record<string, unknown>
        assert.ok(Object.keys(attendance).every((id) => id === s1.id))
        const scores = item.record.scores as { studentId: string }[]
        assert.ok(scores.every((score) => score.studentId === s1.id))
      }
      const parent = await member(a.id, 'veli', [{ kind: 'child', recordId: s2.id }])
      for (const item of await rows(url, parent)) assert.deepEqual(item.record.studentIds, [s2.id])
      const stranger = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's2' }])
      assert.deepEqual(await rows(url, stranger), [])
      const teacher = await member(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
      const own = await rows(url, teacher)
      assert.ok(own.every((item) => item.record.teacherId === 't1'))
      const other = await institution()
      assert.deepEqual(await rows(url, other.adminCookie), [])
    })

    test('availability: öğrenci ve veli 403, öğretmen yalnız kendi saatlerini görür', async () => {
      const a = await institution()
      const url = '/api/v1/collections/availability?pageSize=100'
      for (const cookie of [
        await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }]),
        await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }]),
      ])
        assert.equal((await get(url, cookie)).statusCode, 403)
      const teacher = await member(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
      const own = await rows(url, teacher)
      assert.ok(own.length > 0)
      assert.ok(own.every((item) => item.record.teacherId === 't1'))
      const all = await rows(url, a.adminCookie)
      assert.ok(all.length > own.length)
    })
  })

  describe('plan farkı (birim)', () => {
    const session = (topic: string, studentIds: string[]) => ({
      teacherId: 't1',
      date: '2026-10-07T13:00:00.000Z',
      roomClassId: 'c1',
      subjectId: 'math',
      topic,
      studentIds,
    })
    const plan = (sessions: ReturnType<typeof session>[], unresolved: unknown[] = []) => ({
      sessions,
      unresolved,
    })

    test('yeni, kalkan ve öğrenci listesi değişen etütleri ayırır; bozuk metni bildirir', () => {
      const expected = JSON.stringify(plan([session('A', ['s1']), session('B', ['s1'])]))
      const issues = planDifference(
        plan([session('A', ['s1', 's2']), session('C', ['s1'])]),
        expected,
      )
      assert.deepEqual(issues.map((item) => item.code).sort(), [
        'plan_session_added',
        'plan_session_removed',
        'plan_session_students_changed',
      ])
      assert.equal(planDifference(plan([]), 'bozuk')[0]?.code, 'plan_expected_invalid')
      assert.equal(
        planDifference(plan([]), JSON.stringify(plan([])))[0]?.code,
        'plan_details_changed',
      )
      assert.equal(
        planDifference(plan([], [1]), JSON.stringify(plan([])))[0]?.code,
        'plan_unresolved_changed',
      )
    })
  })
})
