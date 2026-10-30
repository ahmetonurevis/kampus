import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { and, count, eq, sql } from 'drizzle-orm'

import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { tryLockIdempotencyKey } from '../src/db/idempotency.ts'
import { insertMissingRecords, lockInstitution, writeRecords } from '../src/db/records.ts'
import { institutions } from '../src/db/schema/auth.ts'
import { records } from '../src/db/schema/records.ts'
import { AppError } from '../src/errors.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import { executeWorkflowCommand, recordAttendanceCommand } from '../src/services/commands.ts'
import { runCommand, runOperation, type OperationTools } from '../src/services/operation-runner.ts'
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
    throw new DomainError(
      'attendance_already_taken',
      'Bu öğrencinin bugünkü yoklaması zaten alınmış.',
    )
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

  /** Bir bağlantı kilit bekleyene kadar yoklar (sabit uyku yerine koşul). */
  async function untilLockWait(locktype: 'advisory' | 'transactionid' = 'advisory') {
    for (let attempt = 0; ; attempt += 1) {
      const [waiting] = await db
        .select({ n: count() })
        .from(sql`pg_locks`)
        .where(sql`locktype = ${locktype} and not granted`)
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

  const mark = (id: string) => ({
    id,
    studentId: STUDENT,
    classId: 'test-c-pg',
    date: DAY,
    status: 'present',
    reason: '',
  })
  const update = (id: string, status: string) => ({
    kind: 'update' as const,
    collection: 'attendance' as const,
    id,
    data: { ...mark(id), status },
    expectedVersion: 1,
  })

  async function twoMarks() {
    const ctx = await context()
    await writeRecords(
      db,
      ctx.institutionId,
      ['test-att-a', 'test-att-b'].map((id) => ({
        kind: 'insert' as const,
        collection: 'attendance' as const,
        id,
        data: mark(id),
      })),
      FIXED_NOW,
    )
    return ctx
  }

  test('yazmalar (koleksiyon, kimlik) sırasıyla: ters sırada verilen yazma kilitlenme üretmez', async () => {
    const { institutionId } = await twoMarks()
    const held = gate()
    const release = gate()
    const first = db.transaction(async (tx) => {
      await writeRecords(tx, institutionId, [update('test-att-a', 'late')], FIXED_NOW)
      held.open()
      await release.opened
      await writeRecords(tx, institutionId, [update('test-att-b', 'late')], FIXED_NOW)
    })
    await held.opened
    // B, A sırasıyla verildi; depo önce A'yı yazar ve ilk transaction'ı bekler, B'yi tutmaz.
    const second = writeRecords(
      db,
      institutionId,
      [update('test-att-b', 'absent'), update('test-att-a', 'absent')],
      FIXED_NOW,
    )
    second.catch(() => {})
    try {
      await untilLockWait('transactionid')
    } finally {
      release.open()
    }
    await first
    await assert.rejects(
      second,
      (error: unknown) => error instanceof AppError && error.code === 'version_conflict',
    )
  })

  test('kilitlenme kurbanı 409 conflict ile döner; öteki transaction tamamlanır', async () => {
    const { institutionId } = await twoMarks()
    const aLocked = gate()
    const bLocked = gate()
    const outcomes = await Promise.allSettled([
      db.transaction(async (tx) => {
        await writeRecords(tx, institutionId, [update('test-att-a', 'late')], FIXED_NOW)
        aLocked.open()
        await bLocked.opened
        await writeRecords(tx, institutionId, [update('test-att-b', 'late')], FIXED_NOW)
      }),
      db.transaction(async (tx) => {
        await aLocked.opened
        await writeRecords(tx, institutionId, [update('test-att-b', 'absent')], FIXED_NOW)
        bLocked.open()
        await writeRecords(tx, institutionId, [update('test-att-a', 'absent')], FIXED_NOW)
      }),
    ])
    assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1)
    const [victim] = outcomes.filter((item) => item.status === 'rejected')
    assert.ok(victim?.status === 'rejected')
    assert.ok(victim.reason instanceof AppError, String(victim.reason))
    assert.equal(victim.reason.statusCode, 409)
    assert.equal(victim.reason.code, 'conflict')
  })

  test('aynı Idempotency-Key ile süren istek varken ikincisi 409 idempotency_in_progress', async () => {
    const ctx = await context()
    const idem = { key: 'test-key-pg-0001', fingerprint: 'f' }
    const held = gate()
    const release = gate()
    const holder = db.transaction(async (tx) => {
      assert.equal(
        await tryLockIdempotencyKey(tx, ctx.institutionId, ctx.actor.userId, idem.key),
        true,
      )
      held.open()
      await release.opened
    })
    await held.opened
    try {
      await assert.rejects(
        runCommand(ctx, request, () => ({ statusCode: 200, body: {} }), idem),
        (error: unknown) =>
          error instanceof AppError &&
          error.statusCode === 409 &&
          error.code === 'idempotency_in_progress',
      )
    } finally {
      release.open()
      await holder
    }
    assert.equal(await attendanceCount(ctx.institutionId), 0)
  })

  test('aynı Idempotency-Key ile eşzamanlı iki istek: biri yazar, öteki süren istek veya tekrar', async () => {
    const ctx = await context()
    const idem = { key: 'test-key-pg-0002', fingerprint: 'f' }
    const respond = () => ({ statusCode: 200, body: { data: 'ok' } })
    const outcomes = await Promise.allSettled([
      runCommand(ctx, request, respond, idem),
      runCommand(ctx, request, respond, idem),
    ])
    const fulfilled = outcomes.filter((item) => item.status === 'fulfilled')
    assert.ok(fulfilled.length >= 1)
    for (const item of outcomes)
      if (item.status === 'rejected')
        assert.ok(
          item.reason instanceof AppError && item.reason.code === 'idempotency_in_progress',
          String(item.reason),
        )
    assert.equal(await attendanceCount(ctx.institutionId), 1)
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

  test('aynı sınıfın yoklaması iki kez aynı anda: öğrenci başına tek kayıt (DOM yoklama yinelenmez)', async () => {
    const ctx = await context()
    const seed = createSeed(FIXED_NOW)
    const classroom = seed.classes.find((item) => item.id === 'c1')
    assert.ok(classroom)
    const students = seed.students.filter((item) => item.classId === 'c1' && item.isActive)
    await insertMissingRecords(
      db,
      ctx.institutionId,
      [
        { collection: 'classes', id: classroom.id, data: classroom },
        ...students.map((data) => ({ collection: 'students' as const, id: data.id, data })),
      ],
      FIXED_NOW,
    )
    const marks = Object.fromEntries(students.map((item) => [item.id, 'present' as const]))
    const options = { idempotency: null, expectedVersion: null }
    // Yönetici yoklaması gerekçe ister (DOM-AKD-035).
    const reason = 'Eşzamanlılık denemesi'
    const outcomes = await Promise.allSettled([
      recordAttendanceCommand(ctx, 'c1', { date: DAY, marks, reason }, options),
      recordAttendanceCommand(
        ctx,
        'c1',
        { date: DAY, marks: { ...marks, [students[0]?.id ?? '']: 'late' }, reason },
        options,
      ),
    ])
    assert.deepEqual(
      outcomes.map((item) => item.status),
      ['fulfilled', 'fulfilled'],
    )
    assert.equal(await attendanceCount(ctx.institutionId), students.length)
  })
  test('komut ortamı kurum kilidinden sonra okunur: kilit sahibinin kapattığı modül görülür', async () => {
    const ctx = await context()
    const held = gate()
    const release = gate()
    const holder = db.transaction(async (tx) => {
      await lockInstitution(tx, ctx.institutionId)
      await tx
        .update(institutions)
        .set({ enabledModules: { goals: false } })
        .where(eq(institutions.id, ctx.institutionId))
      held.open()
      await release.opened
    })
    await held.opened
    const waiting = executeWorkflowCommand(
      ctx,
      { command: 'goal', input: {}, recordId: undefined, childId: undefined },
      { idempotency: null, expectedVersion: null },
    )
    waiting.catch(() => {})
    try {
      await untilLockWait()
    } finally {
      release.open()
      await holder
    }
    // Ortam kilitten önce okunsaydı modül açık görünür, işlem gövde doğrulamasına takılırdı.
    await assert.rejects(
      waiting,
      (error) => error instanceof AppError && error.code === 'module_disabled',
    )
  })
})
