import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { count, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { applyRubricPublish, insertRubricVersion, loadRubricVersions } from '../src/db/skills.ts'
import { AppError } from '../src/errors.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'
import { sampleRubricData, seedSkillChain } from './support/skills-sample.ts'

/**
 * PostgreSQL 16: rubrik yayımının eşzamanlılığı (DOM-BEC-022). Aynı taslağı iki işlem birlikte
 * yayımlarsa ikincisi birincinin satır kilidini bekler, ardından 0 satır görür ve 409 alır;
 * rubrikte tek yayındaki sürüm kalır. PGlite tek bağlantılı olduğundan bekleme yalnız burada sınanır.
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

describe('PostgreSQL 16: eşzamanlı rubrik yayımı', { skip: PG_SKIP }, () => {
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

  /** Verilen arka uç başka transaction'ın satır kilidini bekleyene kadar yoklar. */
  async function untilLockWait(pid: number) {
    for (let attempt = 0; ; attempt += 1) {
      const [waiting] = await db
        .select({ n: count() })
        .from(sql`pg_locks`)
        .where(sql`locktype = 'transactionid' and not granted and pid = ${pid}`)
      if ((waiting?.n ?? 0) > 0) return
      assert.ok(attempt < 300, 'ikinci yayım ilk transaction’ı beklemedi')
      await delay(10)
    }
  }

  /** Yayındaki v1 ve taslak v2 olan rubrik. */
  async function setup() {
    const institution = await createInstitution(app)
    const chain = await seedSkillChain(db, institution.id, institution.admin.id)
    const draftId = randomUUID()
    await insertRubricVersion(
      db,
      institution.id,
      {
        ...sampleRubricData(),
        id: draftId,
        rubricId: chain.rubricId,
        versionNumber: 2,
        status: 'draft',
        createdAt: FIXED_NOW.toISOString(),
        publishedAt: null,
        archivedAt: null,
      },
      FIXED_NOW,
    )
    return { institutionId: institution.id, chain, draftId }
  }

  test('DOM-BEC-022: aynı taslağı iki işlem yayımlar: ikincisi satır kilidini bekler ve 409 version_conflict; tek yayındaki sürüm kalır', async () => {
    const { institutionId, chain, draftId } = await setup()
    const publish = (tx: Database) =>
      applyRubricPublish(
        tx,
        institutionId,
        { id: draftId, rowVersion: 1 },
        [{ id: chain.rubricVersionId, rowVersion: 1 }],
        { publishedAt: LATER.toISOString(), archiveVersionIds: [chain.rubricVersionId] },
        LATER,
      )
    const held = gate()
    const release = gate()
    const first = db.transaction(async (tx) => {
      await publish(tx)
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
      return publish(tx)
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
    assert.ok(outcome?.status === 'rejected', 'ikinci yayım kabul edildi')
    assert.ok(
      outcome.reason instanceof AppError &&
        outcome.reason.statusCode === 409 &&
        outcome.reason.code === 'version_conflict',
      String(outcome.reason),
    )
    const versions = await loadRubricVersions(db, institutionId, chain.rubricId)
    assert.deepEqual(
      versions.map((v) => [v.id, v.status, v.rowVersion]),
      [
        [chain.rubricVersionId, 'archived', 2],
        [draftId, 'published', 2],
      ],
    )
  })
  test('DOM-BEC-022: uçtan eşzamanlı iki yayım ve iki yeni sürüm: biri başarılı, diğeri 409; tek yayındaki sürüm ve tek açık taslak kalır', async () => {
    const institution = await createInstitution(app)
    const teacher = await createMember(app, institution.id, 'ogretmen')
    const cookie = await signInAs(app, teacher)
    const send = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
      app.inject({
        method: 'POST',
        url: `/api/v1${url}`,
        headers: { origin: TEST_ORIGIN, cookie, 'content-type': 'application/json', ...headers },
        payload: JSON.stringify(payload),
      })
    const created = await send('/rubrics', sampleRubricData())
    assert.equal(created.statusCode, 201, created.body)
    const { rubric, version } = created.json().data
    const publish = () =>
      send(`/rubrics/${rubric.id}/versions/${version.id}/publish`, {}, { 'if-match': '"1"' })
    const published = await Promise.all([publish(), publish()])
    assert.deepEqual(published.map((r) => r.statusCode).sort(), [200, 409])
    const loser = published.find((r) => r.statusCode === 409)
    assert.ok(
      ['version_conflict', 'rubric_version_immutable'].includes(loser?.json().code),
      loser?.body,
    )

    const open = () => send(`/rubrics/${rubric.id}/versions`, sampleRubricData())
    const opened = await Promise.all([open(), open()])
    assert.deepEqual(opened.map((r) => r.statusCode).sort(), [201, 409])
    assert.equal(
      opened.find((r) => r.statusCode === 409)?.json().code,
      'open_rubric_version_exists',
    )
    const versions = await loadRubricVersions(db, institution.id, rubric.id)
    assert.deepEqual(
      versions.map((v) => [v.versionNumber, v.status]),
      [
        [1, 'published'],
        [2, 'draft'],
      ],
    )
  })
})
