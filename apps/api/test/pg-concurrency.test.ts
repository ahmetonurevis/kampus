import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { and, count, eq, sql } from 'drizzle-orm'

import type { State } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { lockInstitution, writeRecords } from '../src/db/records.ts'
import { records } from '../src/db/schema/records.ts'
import { AppError } from '../src/errors.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import { runOperation, type OperationTools } from '../src/services/operation-runner.ts'
import { buildTestApp, createInstitution, FIXED_NOW } from './support/app.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'

const DAY = '2026-10-06'
const STUDENT = 'test-s-pg'

/**
 * Kontrol et, sonra yeni kimlikle ekle: kilitsiz iki eşzamanlı işlem ikisi de "yok" görüp iki
 * kayıt ekleyebilir (sürüm denetimi yalnız var olan satırı korur).
 */
function markOnce(state: State, { makeId }: OperationTools) {
  if (state.attendance.some((item) => item.studentId === STUDENT && item.date === DAY))
    throw new Error('Bu öğrencinin bugünkü yoklaması zaten alınmış.')
  state.attendance.push({
    id: makeId('att'),
    studentId: STUDENT,
    classId: 'test-c-pg',
    date: DAY,
    status: 'present',
    reason: '',
  })
}

function isRuleRejection(reason: unknown): boolean {
  return reason instanceof AppError && reason.statusCode === 422
}

/** Dışarıdan çözülen söz: kilit sahibini test adımlarına göre bekletmek için. */
function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, opened }
}

describe('PostgreSQL 16: eşzamanlı işlemler', { skip: PG_SKIP }, () => {
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

  async function context(): Promise<ServiceContext> {
    const created = await createInstitution(app)
    return {
      db,
      institutionId: created.id,
      actor: {
        userId: created.admin.id,
        role: 'yonetici',
        membershipId: created.adminMembershipId,
      },
      now: FIXED_NOW,
      log: app.log,
    }
  }

  async function attendanceCount(institutionId: string) {
    const [row] = await db
      .select({ n: count() })
      .from(records)
      .where(and(eq(records.institutionId, institutionId), eq(records.collection, 'attendance')))
    return row?.n
  }

  /** Bir bağlantı danışma kilidini bekleyene kadar yoklar (sabit uyku yerine koşul). */
  async function untilLockWait() {
    for (let attempt = 0; ; attempt += 1) {
      const [waiting] = await db
        .select({ n: count() })
        .from(sql`pg_locks`)
        .where(sql`locktype = 'advisory' and not granted`)
      if ((waiting?.n ?? 0) > 0) return
      assert.ok(attempt < 300, 'işlem kurum kilidini beklemedi')
      await delay(10)
    }
  }

  const request = {
    action: 'attendance.mark',
    collections: ['attendance'] as const,
    entity: { type: 'attendance', id: STUDENT },
    run: markOnce,
  }

  test('aynı yoklama iki kez aynı anda: biri yazılır, öteki iş kuralıyla reddedilir', async () => {
    const ctx = await context()
    const outcomes = await Promise.allSettled([
      runOperation(ctx, request),
      runOperation(ctx, request),
    ])
    assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1)
    const rejected = outcomes.filter((item) => item.status === 'rejected')
    assert.equal(rejected.length, 1)
    assert.ok(isRuleRejection(rejected[0]?.reason), String(rejected[0]?.reason))
    assert.equal(await attendanceCount(ctx.institutionId), 1)
  })

  test('işlem kurum kilidini bekler ve kilit sahibinin yazdığını görür', async () => {
    const ctx = await context()
    const held = gate()
    const release = gate()
    const holder = db.transaction(async (tx) => {
      await lockInstitution(tx, ctx.institutionId)
      await writeRecords(
        tx,
        ctx.institutionId,
        [
          {
            kind: 'insert',
            collection: 'attendance',
            id: 'test-att-holder',
            data: {
              id: 'test-att-holder',
              studentId: STUDENT,
              classId: 'test-c-pg',
              date: DAY,
              status: 'late',
              reason: '',
            },
          },
        ],
        FIXED_NOW,
      )
      held.open()
      await release.opened
    })
    await held.opened
    const waiting = runOperation(ctx, request)
    // Bekleyen söz reddedilirse yakalanmamış ret sayılmasın; sonuç aşağıda denetlenir.
    waiting.catch(() => {})
    try {
      await untilLockWait()
    } finally {
      release.open()
      await holder
    }
    await assert.rejects(waiting, isRuleRejection)
    assert.equal(await attendanceCount(ctx.institutionId), 1)
  })

  test('boyut kısıtı ihlali node-postgres hatasından da 422 record_too_large olur', async () => {
    const ctx = await context()
    const data = { id: 'test-att-dense', list: Array.from({ length: 100_000 }, () => 0) }
    await assert.rejects(
      writeRecords(
        db,
        ctx.institutionId,
        [{ kind: 'insert', collection: 'attendance', id: data.id, data }],
        FIXED_NOW,
      ),
      (error: unknown) =>
        error instanceof AppError && error.statusCode === 422 && error.code === 'record_too_large',
    )
    assert.equal(await attendanceCount(ctx.institutionId), 0)
  })

  test('farklı kurumların işlemleri birbirini beklemez', async () => {
    const [a, b] = await Promise.all([context(), context()])
    const held = gate()
    const release = gate()
    const holder = db.transaction(async (tx) => {
      await lockInstitution(tx, a.institutionId)
      held.open()
      await release.opened
    })
    await held.opened
    try {
      await runOperation(b, request)
    } finally {
      release.open()
      await holder
    }
    assert.equal(await attendanceCount(b.institutionId), 1)
  })
})
