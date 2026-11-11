import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords, loadRecords, lockInstitution } from '../src/db/records.ts'
import { evaluationText, PLAN, sampleRows } from './support/assessment-sample.ts'
import { buildTestApp, createInstitution, FIXED_NOW, signInAs, TEST_ORIGIN } from './support/app.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'

/**
 * PostgreSQL 16: etüt planının eşzamanlı onayı (DOM-YTK-021). Kurum kilidi işlemleri sıraya
 * dizer; ikinci onay birincinin etütlerini görür ve çoğaltmaz.
 */
describe('PostgreSQL 16: eşzamanlı etüt planı onayı', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  function post(url: string, cookie: string, body: unknown, key = randomUUID()) {
    return app.inject({
      method: 'POST',
      url,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      payload: JSON.stringify(body),
    })
  }

  test('iki eşzamanlı plan onayında biri 200, öteki 422 alır; etütler çoğalmaz', async () => {
    const institution = await createInstitution(app)
    await insertMissingRecords(db, institution.id, sampleRows(), FIXED_NOW)
    const cookie = await signInAs(app, institution.admin)
    const evaluated = await post('/api/v1/assessment/evaluate', cookie, {
      profileId: 'optical-exam-7-1',
      text: evaluationText(),
    })
    assert.equal(evaluated.statusCode, 200, evaluated.body)

    const [first, second] = await Promise.all([
      post('/api/v1/assessment/plan', cookie, PLAN),
      post('/api/v1/assessment/plan', cookie, PLAN),
    ])
    const statuses = [first.statusCode, second.statusCode].sort()
    assert.deepEqual(statuses, [200, 422], `${first.body} ${second.body}`)
    const rejected = first.statusCode === 422 ? first : second
    assert.equal(rejected.json().code, 'tutoring_nothing_to_create')
    const winner = first.statusCode === 200 ? first : second
    const stored = await loadRecords(db, institution.id, ['tutorSessions'])
    assert.equal(stored.length, winner.json().data.changes.inserted)
    // Aynı öğrenci/kazanım için ikinci etüt yok.
    const seen = new Set<string>()
    for (const row of stored) {
      const students = row.data.studentIds
      assert.ok(Array.isArray(students))
      for (const student of students) {
        const keyOf = `${row.data.subjectId}|${row.data.topic}|${String(student)}`
        assert.ok(!seen.has(keyOf), keyOf)
        seen.add(keyOf)
      }
    }
  })

  test('aynı Idempotency-Key ile eşzamanlı iki onay tek plan oluşturur, öteki ilk yanıtı alır', async () => {
    const institution = await createInstitution(app)
    await insertMissingRecords(db, institution.id, sampleRows(), FIXED_NOW)
    const cookie = await signInAs(app, institution.admin)
    await post('/api/v1/assessment/evaluate', cookie, {
      profileId: 'optical-exam-7-1',
      text: evaluationText(),
    })
    const key = randomUUID()
    const results = await Promise.all([
      post('/api/v1/assessment/plan', cookie, PLAN, key),
      post('/api/v1/assessment/plan', cookie, PLAN, key),
    ])
    const ok = results.filter((item) => item.statusCode === 200)
    assert.ok(ok.length >= 1, results.map((item) => item.body).join(' '))
    // Biri sürerken gelen ikincisi 409 `idempotency_in_progress` olabilir; hiçbir koşulda 2 plan olmaz.
    for (const item of results)
      assert.ok([200, 409].includes(item.statusCode), `${item.statusCode} ${item.body}`)
    const stored = await loadRecords(db, institution.id, ['tutorSessions'])
    assert.equal(stored.length, ok[0]?.json().data.changes.inserted)
  })
  test('önizlemeler kurum kilidini almaz: kilit tutulurken tamamlanır, yazma bekler', async () => {
    const institution = await createInstitution(app)
    await insertMissingRecords(db, institution.id, sampleRows(), FIXED_NOW)
    const cookie = await signInAs(app, institution.admin)
    await post('/api/v1/assessment/evaluate', cookie, {
      profileId: 'optical-exam-7-1',
      text: evaluationText(),
    })
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let locked = () => {}
    const acquired = new Promise<void>((resolve) => {
      locked = resolve
    })
    // Kurum kilidini tutan işlem: yazan her işlem bunu beklemek zorundadır.
    const holder = db.transaction(async (tx) => {
      await lockInstitution(tx, institution.id)
      locked()
      await held
    })
    await acquired
    try {
      const timeout = Symbol('timeout')
      const race = <T>(work: Promise<T>) =>
        Promise.race([work, new Promise<symbol>((r) => setTimeout(() => r(timeout), 3000))])
      const plan = await race(post('/api/v1/assessment/plan/preview', cookie, PLAN))
      assert.notEqual(plan, timeout, 'plan önizlemesi kurum kilidini bekledi')
      assert.equal((plan as { statusCode: number }).statusCode, 200)
      const evaluation = await race(
        post('/api/v1/assessment/evaluate/preview', cookie, {
          profileId: 'optical-exam-7-1',
          text: evaluationText(),
        }),
      )
      assert.notEqual(evaluation, timeout, 'optik önizlemesi kurum kilidini bekledi')
      assert.equal((evaluation as { statusCode: number }).statusCode, 200)
      // Karşılaştırma: aynı kilit yazan işlemi bekletir.
      const write = post('/api/v1/assessment/plan', cookie, PLAN)
      assert.equal(await race(write), timeout, 'yazma kilit tutulurken tamamlandı')
      release()
      await holder
      assert.equal((await write).statusCode, 200)
    } finally {
      release()
      await holder
    }
  })
})
