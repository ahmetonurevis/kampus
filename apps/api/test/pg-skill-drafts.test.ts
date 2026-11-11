import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { count, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { loadDraft, saveDraft } from '../src/db/skills.ts'
import { AppError } from '../src/errors.ts'
import { buildTestApp, createInstitution, FIXED_NOW } from './support/app.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'
import { LEARNER, seedSkillChain } from './support/skills-sample.ts'

/**
 * PostgreSQL 16: taslağın iyimser kilidi (IST-047). İki pencere aynı revizyondan yazınca ikincisi
 * birincinin transaction'ını bekler, ardından 0 satır görür ve 409 `draft_conflict` alır; kazanan
 * yazma ezilmez. PGlite tek bağlantılı olduğundan bekleme yalnız burada sınanır.
 */

const LATER = new Date(FIXED_NOW.getTime() + 60_000)

/** Dışarıdan çözülen söz: kilit sahibini test adımlarına göre bekletmek için. */
function gate<T = void>() {
  let open: (value: T) => void = () => {}
  const opened = new Promise<T>((resolve) => {
    open = resolve
  })
  return { open, opened }
}

function isDraftConflict(reason: unknown): boolean {
  return reason instanceof AppError && reason.statusCode === 409 && reason.code === 'draft_conflict'
}

describe('PostgreSQL 16: eşzamanlı taslak kaydı', { skip: PG_SKIP }, () => {
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

  /**
   * Verilen arka uç (`pg_backend_pid()`) başka transaction'ın satır/benzersizlik kilidini bekleyene
   * kadar yoklar. Süzgeç yalnız bu bağlantıdır: paralel test dosyalarının kilit beklemeleri sayılmaz.
   */
  async function untilLockWait(pid: number) {
    for (let attempt = 0; ; attempt += 1) {
      const [waiting] = await db
        .select({ n: count() })
        .from(sql`pg_locks`)
        .where(sql`locktype = 'transactionid' and not granted and pid = ${pid}`)
      if ((waiting?.n ?? 0) > 0) return
      assert.ok(attempt < 300, 'ikinci yazma ilk transaction’ı beklemedi')
      await delay(10)
    }
  }

  const draft = (revision: number, body: string) => ({
    learnerId: LEARNER,
    body,
    revision,
    savedAt: LATER.toISOString(),
  })

  /** İlk yazma transaction'ı açık tutulurken ikincisi başlar; ilk kapanınca ikincinin sonucu. */
  async function race(institutionId: string, assignmentId: string, revision: number) {
    const held = gate()
    const release = gate()
    const first = db.transaction(async (tx) => {
      await saveDraft(tx, institutionId, assignmentId, draft(revision, 'Birinci pencere'), LATER)
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
      return saveDraft(tx, institutionId, assignmentId, draft(revision, 'İkinci pencere'), LATER)
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
    return outcome
  }

  async function setup() {
    const institution = await createInstitution(app)
    const chain = await seedSkillChain(db, institution.id, institution.admin.id)
    return { institutionId: institution.id, assignmentId: chain.assignmentId }
  }

  test('IST-047: ilk taslağı iki pencere aynı anda açar: ikincisi benzersizlik kilidini bekler ve 409 draft_conflict', async () => {
    const { institutionId, assignmentId } = await setup()
    const outcome = await race(institutionId, assignmentId, 1)
    assert.ok(outcome?.status === 'rejected', 'ikinci yazma kabul edildi')
    assert.ok(isDraftConflict(outcome.reason), String(outcome.reason))
    assert.deepEqual(
      await loadDraft(db, institutionId, assignmentId, LEARNER),
      draft(1, 'Birinci pencere'),
    )
  })

  test('IST-047: aynı revizyondan iki güncelleme: ikincisi satır kilidini bekler, 0 satır görür ve 409 draft_conflict', async () => {
    const { institutionId, assignmentId } = await setup()
    await saveDraft(db, institutionId, assignmentId, draft(1, 'İlk'), FIXED_NOW)
    const outcome = await race(institutionId, assignmentId, 2)
    assert.ok(outcome?.status === 'rejected', 'ikinci yazma kabul edildi')
    assert.ok(isDraftConflict(outcome.reason), String(outcome.reason))
    assert.deepEqual(
      await loadDraft(db, institutionId, assignmentId, LEARNER),
      draft(2, 'Birinci pencere'),
    )
  })
})
