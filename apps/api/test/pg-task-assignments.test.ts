import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { count, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { findAssignment, updateAssignmentDeadline } from '../src/db/skills.ts'
import { AppError } from '../src/errors.ts'
import { buildTestApp, createInstitution, FIXED_NOW, signInAs, TEST_ORIGIN } from './support/app.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'
import { DUE_AT, seedSkillChain } from './support/skills-sample.ts'

/**
 * PostgreSQL 16: atama son tesliminin eşzamanlı değişikliği (DOM-BEC-044; ADR 0004 karar 4). Aynı
 * satır sürümüyle iki işlem son teslimi uzatırsa ikincisi birincinin satır kilidini bekler, sonra
 * 0 satır görür ve 409 alır. PGlite tek bağlantılı olduğundan bekleme yalnız burada sınanır.
 */

const LATER = new Date(FIXED_NOW.getTime() + 60_000)

function gate<T = void>() {
  let open: (value: T) => void = () => {}
  const opened = new Promise<T>((resolve) => {
    open = resolve
  })
  return { open, opened }
}

describe('PostgreSQL 16: eşzamanlı atama değişikliği', { skip: PG_SKIP }, () => {
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

  async function untilLockWait(pid: number) {
    for (let attempt = 0; ; attempt += 1) {
      const [waiting] = await db
        .select({ n: count() })
        .from(sql`pg_locks`)
        .where(sql`locktype = 'transactionid' and not granted and pid = ${pid}`)
      if ((waiting?.n ?? 0) > 0) return
      assert.ok(attempt < 300, 'ikinci değişiklik ilk transaction’ı beklemedi')
      await delay(10)
    }
  }

  test('DOM-BEC-044: aynı sürümle iki son teslim uzatması: ikincisi satır kilidini bekler ve 409 version_conflict; ilk değişiklik kalır', async () => {
    const institution = await createInstitution(app)
    const chain = await seedSkillChain(db, institution.id, institution.admin.id)
    const extend = (tx: Database, lateAcceptanceDays: number) =>
      updateAssignmentDeadline(
        tx,
        institution.id,
        { id: chain.assignmentId, rowVersion: 1 },
        { dueAt: DUE_AT.toISOString(), lateAcceptanceDays },
        LATER,
      )
    const held = gate()
    const release = gate()
    const first = db.transaction(async (tx) => {
      await extend(tx, 2)
      held.open()
      await release.opened
    })
    await held.opened
    const backend = gate<number>()
    const second = db.transaction(async (tx) => {
      const { rows } = (await tx.execute(sql`select pg_backend_pid() as pid`)) as unknown as {
        rows: { pid: number }[]
      }
      backend.open(rows[0]!.pid)
      return extend(tx, 5)
    })
    // Sonuç hemen yakalanır: ilk transaction kapanırken `second` reddedilir; dinleyici araya `await`
    // girdikten sonra bağlanırsa Node bunu işlenmemiş ret sayıp testi düşürür.
    const secondSettled = Promise.allSettled([second])
    try {
      await untilLockWait(await backend.opened)
    } finally {
      release.open()
      await first
    }
    const [outcome] = await secondSettled
    assert.ok(outcome?.status === 'rejected', 'ikinci değişiklik kabul edildi')
    assert.ok(
      outcome.reason instanceof AppError &&
        outcome.reason.statusCode === 409 &&
        outcome.reason.code === 'version_conflict',
      String(outcome.reason),
    )
    const stored = await findAssignment(db, institution.id, chain.assignmentId)
    assert.deepEqual([stored?.deadline.lateAcceptanceDays, stored?.rowVersion], [2, 2])
  })

  test('DOM-BEC-044, IST-034: uçtan eşzamanlı iki PATCH (If-Match "1"): biri 200, diğeri 409 version_conflict; satır sürümü 2', async () => {
    const institution = await createInstitution(app)
    const chain = await seedSkillChain(db, institution.id, institution.admin.id)
    const cookie = await signInAs(app, institution.admin)
    const dueAt = new Date(DUE_AT.getTime() + 7 * 24 * 60 * 60_000).toISOString()
    const patch = (lateAcceptanceDays: number) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/task-assignments/${chain.assignmentId}`,
        headers: {
          origin: TEST_ORIGIN,
          cookie,
          'content-type': 'application/json',
          'if-match': '"1"',
        },
        payload: JSON.stringify({ deadline: { dueAt, lateAcceptanceDays } }),
      })
    const responses = await Promise.all([patch(2), patch(5)])
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409])
    const loser = responses.find((r) => r.statusCode === 409)
    assert.equal(loser?.json().code, 'version_conflict', loser?.body)
    const winner = responses.find((r) => r.statusCode === 200)?.json().data
    const stored = await findAssignment(db, institution.id, chain.assignmentId)
    assert.deepEqual([stored?.deadline, stored?.rowVersion], [winner.deadline, 2])
  })
})
