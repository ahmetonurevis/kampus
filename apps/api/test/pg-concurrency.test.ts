import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { and, count, eq, sql } from 'drizzle-orm'

import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { conversationMessagePage } from '../src/db/conversation-messages.ts'
import { tryLockIdempotencyKey } from '../src/db/idempotency.ts'
import { insertMissingRecords, lockInstitution, writeRecords } from '../src/db/records.ts'
import { institutions } from '../src/db/schema/auth.ts'
import { feeTariffs } from '../src/db/schema/fee-tariffs.ts'
import { paymentAllocations, payments } from '../src/db/schema/payments.ts'
import { records } from '../src/db/schema/records.ts'
import { studentWithdrawals } from '../src/db/schema/withdrawals.ts'
import { AppError } from '../src/errors.ts'
import { bookAppointmentCommand } from '../src/services/appointments.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import { executeWorkflowCommand, recordAttendanceCommand } from '../src/services/commands.ts'
import { sendMessageCommand } from '../src/services/communication.ts'
import {
  createProspectCommand,
  enrollProspectCommand,
  scheduleProspectMeetingCommand,
  scheduleTrialLessonCommand,
} from '../src/services/prospects.ts'
import { recordPaymentCommand } from '../src/services/payments.ts'
import { withdrawStudentCommand } from '../src/services/withdrawals.ts'
import { answerQuestionCommand } from '../src/services/questions.ts'
import { runCommand, runOperation, type OperationTools } from '../src/services/operation-runner.ts'
import { buildTestApp, createInstitution, createMember, FIXED_NOW } from './support/app.ts'
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

  async function context(
    overrides: Parameters<typeof createInstitution>[1] = {},
  ): Promise<ServiceContext> {
    const created = await createInstitution(app, overrides)
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
  async function untilLockWait(locktype: 'advisory' | 'transactionid' = 'advisory', minimum = 1) {
    for (let attempt = 0; ; attempt += 1) {
      const [waiting] = await db
        .select({ n: count() })
        .from(sql`pg_locks`)
        .where(sql`locktype = ${locktype} and not granted`)
      if ((waiting?.n ?? 0) >= minimum) return
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
  test('aynı yazışmaya eşzamanlı iki mesaj: ikisi de ayrı kayıt olarak yazılır, sıra tekil ve tutarlı (ADR 0005)', async () => {
    const base = await context()
    const seed = createSeed(FIXED_NOW)
    const students = seed.students.filter((item) => item.classId === 'c1')
    const samples = [
      ...seed.subjects.map((data) => ({ collection: 'subjects' as const, id: data.id, data })),
      ...seed.teachers.map((data) => ({ collection: 'teachers' as const, id: data.id, data })),
      ...seed.classes
        .filter((item) => item.id === 'c1')
        .map((data) => ({ collection: 'classes' as const, id: data.id, data })),
      ...students.map((data) => ({ collection: 'students' as const, id: data.id, data })),
      ...seed.assignments
        .filter((item) => item.classId === 'c1')
        .map((data) => ({ collection: 'assignments' as const, id: data.id, data })),
      {
        collection: 'conversations' as const,
        id: 'conv-pg',
        data: { id: 'conv-pg', studentId: 's1', teacherId: 't2', audience: 'student' },
      },
    ]
    await insertMissingRecords(db, base.institutionId, samples, FIXED_NOW)
    const teacher = await createMember(app, base.institutionId, 'ogretmen', [
      { kind: 'teacher', recordId: 't2' },
    ])
    const ctx: ServiceContext = {
      ...base,
      actor: { userId: teacher.id, role: 'ogretmen', membershipId: teacher.membershipId },
    }
    const options = { idempotency: null, expectedVersion: null }
    const outcomes = await Promise.allSettled([
      sendMessageCommand(ctx, 'conv-pg', { text: 'Birinci' }, options),
      sendMessageCommand(ctx, 'conv-pg', { text: 'İkinci' }, options),
    ])
    assert.deepEqual(
      outcomes.map((item) => (item.status === 'fulfilled' ? item.value.statusCode : item.reason)),
      [201, 201],
    )
    const stored = await db
      .select({ id: records.id, position: records.position, data: records.data })
      .from(records)
      .where(
        and(
          eq(records.institutionId, ctx.institutionId),
          eq(records.collection, 'conversationMessages'),
        ),
      )
      .orderBy(records.position, records.id)
    assert.deepEqual(stored.map((row) => row.data.text).sort(), ['Birinci', 'İkinci'])
    // Kurum kilidi gönderimleri sıraya soktuğu için sıralar farklıdır; sayfa aynı sırayı verir.
    assert.equal(new Set(stored.map((row) => row.position)).size, 2)
    const page = await conversationMessagePage(db, ctx.institutionId, 'conv-pg', { limit: 10 })
    assert.deepEqual(
      (page?.rows ?? []).map((row) => (row as { id: string }).id),
      stored.map((row) => row.id),
    )
  })

  test('DOM-ILT-092: aynı soruya aynı sürümle eşzamanlı iki yanıt: biri 201, öteki 409 version_conflict', async () => {
    const base = await context()
    const seed = createSeed(FIXED_NOW)
    const question = seed.questions.find((item) => item.id === 'ask1')
    assert.ok(question !== undefined && question.answeredAt === null, 'örnek soru yanıtsız değil')
    const samples = [
      ...seed.subjects.map((data) => ({ collection: 'subjects' as const, id: data.id, data })),
      ...seed.teachers.map((data) => ({ collection: 'teachers' as const, id: data.id, data })),
      ...seed.classes
        .filter((item) => item.id === 'c1')
        .map((data) => ({ collection: 'classes' as const, id: data.id, data })),
      ...seed.students
        .filter((item) => item.id === 's1')
        .map((data) => ({ collection: 'students' as const, id: data.id, data })),
      ...seed.assignments
        .filter((item) => item.classId === 'c1')
        .map((data) => ({ collection: 'assignments' as const, id: data.id, data })),
      { collection: 'questions' as const, id: question.id, data: question },
    ]
    await insertMissingRecords(db, base.institutionId, samples, FIXED_NOW)
    const teacher = await createMember(app, base.institutionId, 'ogretmen', [
      { kind: 'teacher', recordId: question.teacherId },
    ])
    const ctx: ServiceContext = {
      ...base,
      actor: { userId: teacher.id, role: 'ogretmen', membershipId: teacher.membershipId },
    }
    const options = { idempotency: null, expectedVersion: 1 }
    const outcomes = await Promise.allSettled([
      answerQuestionCommand(ctx, 'ask1', { text: 'Birinci yanıt' }, options),
      answerQuestionCommand(ctx, 'ask1', { text: 'İkinci yanıt' }, options),
    ])
    const fulfilled = outcomes.filter((item) => item.status === 'fulfilled')
    assert.deepEqual(
      fulfilled.map((item) => item.value.statusCode),
      [201],
    )
    const rejected = outcomes.filter((item) => item.status === 'rejected')
    assert.equal(rejected.length, 1)
    const reason: unknown = rejected[0]?.reason
    assert.ok(
      reason instanceof AppError && reason.statusCode === 409 && reason.code === 'version_conflict',
      String(reason),
    )
    // Kaybeden yanıt ek yanıt olarak da yazılmaz: tek yanıt, boş followUps, sürüm 2.
    const [stored] = await db
      .select({ version: records.version, data: records.data })
      .from(records)
      .where(
        and(
          eq(records.institutionId, ctx.institutionId),
          eq(records.collection, 'questions'),
          eq(records.id, 'ask1'),
        ),
      )
    assert.equal(stored?.version, 2)
    assert.ok(['Birinci yanıt', 'İkinci yanıt'].includes(String(stored?.data.answer)))
    assert.deepEqual(stored?.data.followUps ?? [], [])
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

  test('DOM-ILT-101: aynı saate eşzamanlı iki randevu talebi: yalnız biri yazılır, öteki 409 appointment_conflict', async () => {
    const base = await context()
    const seed = createSeed(FIXED_NOW)
    const sample = <
      C extends 'subjects' | 'teachers' | 'classes' | 'students' | 'assignments' | 'availability',
    >(
      collection: C,
      items: readonly { id: string }[],
    ) => items.map((data) => ({ collection, id: data.id, data: { ...data } }))
    await insertMissingRecords(
      db,
      base.institutionId,
      [
        ...sample('subjects', seed.subjects),
        ...sample('teachers', seed.teachers),
        ...sample(
          'classes',
          seed.classes.filter((item) => item.id === 'c1'),
        ),
        ...sample(
          'students',
          seed.students.filter((item) => item.classId === 'c1'),
        ),
        ...sample(
          'assignments',
          seed.assignments.filter((item) => item.classId === 'c1'),
        ),
        ...sample(
          'availability',
          seed.availability.filter((item) => item.id === 'slot-t1-0'),
        ),
      ],
      FIXED_NOW,
    )
    const parentContext = async (studentId: string): Promise<ServiceContext> => {
      const parent = await createMember(app, base.institutionId, 'veli', [
        { kind: 'child', recordId: studentId },
      ])
      return {
        ...base,
        actor: { userId: parent.id, role: 'veli', membershipId: parent.membershipId },
      }
    }
    const [first, second] = await Promise.all([parentContext('s1'), parentContext('s25')])
    const booking = (studentId: string) => ({
      studentId,
      slotId: 'slot-t1-0',
      note: 'Ödev düzenini konuşmak istiyorum.',
    })
    const options = (key: string) => ({
      idempotency: { key, fingerprint: key },
      expectedVersion: null,
    })
    const outcomes = await Promise.allSettled([
      bookAppointmentCommand(first, booking('s1'), options('pg-apt-1')),
      bookAppointmentCommand(second, booking('s25'), options('pg-apt-2')),
    ])
    const fulfilled = outcomes.filter((item) => item.status === 'fulfilled')
    assert.equal(fulfilled.length, 1)
    assert.equal(fulfilled[0]?.value.statusCode, 201)
    const rejected = outcomes.filter((item) => item.status === 'rejected')
    assert.equal(rejected.length, 1)
    const reason: unknown = rejected[0]?.reason
    assert.ok(
      reason instanceof AppError &&
        reason.statusCode === 409 &&
        reason.code === 'appointment_conflict',
      String(reason),
    )
    const [row] = await db
      .select({ n: count() })
      .from(records)
      .where(
        and(eq(records.institutionId, base.institutionId), eq(records.collection, 'appointments')),
      )
    assert.equal(row?.n, 1)
  })

  /** Ön büro bağlamı ve seed kampüsleri; adaylar testin kendi kurumundadır. */
  async function frontDeskContext(
    overrides: Parameters<typeof createInstitution>[1] = {},
  ): Promise<ServiceContext> {
    const base = await context(overrides)
    const seed = createSeed(FIXED_NOW)
    await insertMissingRecords(
      db,
      base.institutionId,
      seed.branches.map((data) => ({
        collection: 'branches' as const,
        id: data.id,
        data: { ...data },
      })),
      FIXED_NOW,
    )
    const desk = await createMember(app, base.institutionId, 'onburo')
    return { ...base, actor: { userId: desk.id, role: 'onburo', membershipId: desk.membershipId } }
  }
  /** Eğitim yılının yayımlanmış tarifesi (1.000 ₺ öğrenim ücreti); kimliği kesin kayıt gövdesine gider. */
  async function publishTariff(ctx: ServiceContext): Promise<string> {
    const tariffId = randomUUID()
    await db.insert(feeTariffs).values({
      institutionId: ctx.institutionId,
      id: tariffId,
      academicYear: FIXED_NOW.getUTCFullYear(),
      versionNumber: 1,
      status: 'published',
      items: [
        {
          kind: 'tuition',
          level: null,
          amountCents: 100_000,
          unit: 'year',
          vatBasisPoints: 1000,
          vatEffectiveDate: '2026-01-01',
          announcedAmountCents: 100_000,
        },
      ],
      announcedDate: '2026-05-01',
      publishedByUserId: ctx.actor.userId,
      publishedAt: FIXED_NOW,
    })
    return tariffId
  }
  const prospectCount = async (institutionId: string) => {
    const [row] = await db
      .select({ n: count() })
      .from(records)
      .where(and(eq(records.institutionId, institutionId), eq(records.collection, 'prospects')))
    return row?.n
  }
  const keyed = (key: string) => ({
    idempotency: { key, fingerprint: key },
    expectedVersion: null,
  })

  test('DOM-KAY-002: aynı adayı eşzamanlı iki istek açar: yalnız biri yazılır, öteki 409 prospect_duplicate', async () => {
    const ctx = await frontDeskContext()
    const prospect = {
      name: 'Test Eşzamanlı Aday',
      phone: '05559990101',
      branchId: 'b1',
      interest: '7. Sınıf · Ortaokul',
      source: 'Web sitesi',
      guardianName: 'Test Veli',
      privacyNoticeVersion: 'aydinlatma-2026-1',
    }
    const outcomes = await Promise.allSettled([
      createProspectCommand(ctx, prospect, keyed('pg-prospect-0001')),
      createProspectCommand(
        ctx,
        { ...prospect, name: 'test eşzamanlı ADAY' },
        keyed('pg-prospect-0002'),
      ),
    ])
    const fulfilled = outcomes.filter((item) => item.status === 'fulfilled')
    assert.deepEqual(
      fulfilled.map((item) => item.value.statusCode),
      [201],
    )
    const rejected = outcomes.filter((item) => item.status === 'rejected')
    assert.equal(rejected.length, 1)
    const reason: unknown = rejected[0]?.reason
    assert.ok(
      reason instanceof AppError &&
        reason.statusCode === 409 &&
        reason.code === 'prospect_duplicate',
      String(reason),
    )
    // Ret eşleşen adayın kimliğini taşımaz.
    const createdId = JSON.stringify(fulfilled[0]?.value.body).match(/"id":"(pr-[^"]+)"/)?.[1]
    assert.ok(createdId)
    assert.equal(JSON.stringify(reason.issues ?? []).includes(createdId), false)
    assert.equal(reason.message.includes(createdId), false)
    assert.equal(await prospectCount(ctx.institutionId), 1)
  })

  test('DOM-KAY-010: son kontenjana eşzamanlı iki kesin kayıt: yalnız biri yazılır, öteki 422 class_capacity_full', async () => {
    const ctx = await frontDeskContext()
    const seed = createSeed(FIXED_NOW)
    const seat = seed.classes.find((item) => item.id === 'c1')
    const open = seed.prospects.filter((item) => item.stage === 'Yeni aday').slice(0, 2)
    assert.ok(seat)
    assert.equal(open.length, 2)
    await insertMissingRecords(
      db,
      ctx.institutionId,
      [
        { collection: 'classes', id: seat.id, data: { ...seat, capacity: 1 } },
        // Adaylar sınıfın kampüsündedir; kampüs denetimi kontenjandan önce çalışır.
        ...open.map((data) => ({
          collection: 'prospects' as const,
          id: data.id,
          data: { ...data, branchId: seat.branchId },
        })),
      ],
      FIXED_NOW,
    )
    const tariffId = await publishTariff(ctx)
    const enrollment = (number: string) => ({
      classId: seat.id,
      tariffId,
      installmentCount: 2,
      firstDueDate: '2026-11-15',
      identity: { kind: 'tc', number, birthDate: '2013-03-01' },
      guardian: { name: 'Test Veli', phone: '05559990123', relationship: 'mother' },
    })
    const numbers = ['10000000146', '11111111110']
    const outcomes = await Promise.allSettled(
      open.map((item, index) =>
        enrollProspectCommand(
          ctx,
          item.id,
          enrollment(numbers[index] ?? ''),
          keyed(`pg-enroll-000${String(index)}`),
        ),
      ),
    )
    assert.deepEqual(
      outcomes.filter((item) => item.status === 'fulfilled').map((item) => item.value.statusCode),
      [201],
    )
    const reason: unknown = outcomes.find((item) => item.status === 'rejected')?.reason
    assert.ok(
      reason instanceof AppError &&
        reason.statusCode === 422 &&
        reason.code === 'class_capacity_full',
      String(reason),
    )
    const rows = await db
      .select({ collection: records.collection, n: count() })
      .from(records)
      .where(eq(records.institutionId, ctx.institutionId))
      .groupBy(records.collection)
    const countOf = (name: string) => rows.find((row) => row.collection === name)?.n
    assert.equal(countOf('students'), 1)
    assert.equal(countOf('parents'), 1)
    assert.equal(countOf('contracts'), 1)
    assert.equal(countOf('invoices'), 2)
  })

  test('DOM-FIN-031, DOM-FIN-050: eşzamanlı tahsilat: aynı referansla biri yazılır, dekont numarası ardışıktır', async () => {
    const ctx = await frontDeskContext()
    const invoice = (id: string, installment: number) => ({
      id,
      studentId: 's1',
      installment,
      amount: 10_000,
      dueDate: `2026-1${String(installment)}-15T09:00:00.000Z`,
      paidAt: null,
      method: null,
      reminderAt: null,
    })
    const student = createSeed(FIXED_NOW).students.find((item) => item.id === 's1')
    assert.ok(student)
    await insertMissingRecords(
      db,
      ctx.institutionId,
      [
        { collection: 'students', id: 's1', data: { ...student } },
        { collection: 'invoices', id: 'pg-inv-0', data: invoice('pg-inv-0', 0) },
        { collection: 'invoices', id: 'pg-inv-1', data: invoice('pg-inv-1', 1) },
      ],
      FIXED_NOW,
    )
    const pay = (reference: string, amountCents: number, key: string) =>
      recordPaymentCommand(
        ctx,
        { studentId: 's1', amountCents, method: 'Banka havalesi', reference },
        keyed(key),
      )
    const sameReference = await Promise.allSettled([
      pay('TR-AYNI', 1_000, 'pg-pay-0001'),
      pay('TR-AYNI', 1_000, 'pg-pay-0002'),
    ])
    assert.equal(sameReference.filter((item) => item.status === 'fulfilled').length, 1)
    const reason: unknown = sameReference.find((item) => item.status === 'rejected')?.reason
    assert.ok(
      reason instanceof AppError && reason.code === 'payment_reference_used',
      String(reason),
    )

    const results = await Promise.all([
      pay('TR-A', 1_000, 'pg-pay-0003'),
      pay('TR-B', 1_000, 'pg-pay-0004'),
      pay('TR-C', 1_000, 'pg-pay-0005'),
    ])
    assert.equal(results.length, 3)
    const rows = await db
      .select({ receiptNumber: payments.receiptNumber })
      .from(payments)
      .where(eq(payments.institutionId, ctx.institutionId))
    assert.deepEqual(rows.map((row) => row.receiptNumber).sort(), [1, 2, 3, 4])
    const [allocated] = await db
      .select({ total: sql<string>`sum(${paymentAllocations.amountCents})` })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.institutionId, ctx.institutionId))
    assert.equal(Number(allocated?.total), 4_000)
  })

  test('DOM-FIN-041: eşzamanlı iki ayrılış: yalnız biri yazılır, öteki 409 student_already_withdrawn', async () => {
    const base = await frontDeskContext()
    const admin = await createMember(app, base.institutionId, 'yonetici')
    const ctx: ServiceContext = {
      ...base,
      actor: { userId: admin.id, role: 'yonetici', membershipId: admin.membershipId },
    }
    const student = createSeed(FIXED_NOW).students.find((item) => item.id === 's1')
    assert.ok(student)
    await insertMissingRecords(
      db,
      ctx.institutionId,
      [
        { collection: 'students', id: 's1', data: { ...student } },
        {
          collection: 'contracts',
          id: 'pg-contract',
          data: {
            id: 'pg-contract',
            studentId: 's1',
            date: '2026-01-01T09:00:00.000Z',
            amount: 10_000,
            title: 'Sözleşme',
            invoiceIds: ['pg-wd-inv'],
          },
        },
        {
          collection: 'invoices',
          id: 'pg-wd-inv',
          data: {
            id: 'pg-wd-inv',
            studentId: 's1',
            installment: 1,
            amount: 10_000,
            dueDate: '2026-09-15T09:00:00.000Z',
            paidAt: null,
            method: null,
            reminderAt: null,
          },
        },
      ],
      FIXED_NOW,
    )
    const input = {
      withdrawalDate: '2026-10-01',
      termStartDate: '2026-09-07',
      attendedUnits: 18,
      totalUnits: 180,
      reason: 'relocation',
    }
    const outcomes = await Promise.allSettled([
      withdrawStudentCommand(ctx, 's1', input, keyed('pg-withdraw-1')),
      withdrawStudentCommand(ctx, 's1', input, keyed('pg-withdraw-2')),
    ])
    assert.deepEqual(
      outcomes.filter((item) => item.status === 'fulfilled').map((item) => item.value.statusCode),
      [201],
    )
    const reason: unknown = outcomes.find((item) => item.status === 'rejected')?.reason
    assert.ok(
      reason instanceof AppError && reason.code === 'student_already_withdrawn',
      String(reason),
    )
    const rows = await db
      .select({ id: studentWithdrawals.id })
      .from(studentWithdrawals)
      .where(eq(studentWithdrawals.institutionId, ctx.institutionId))
    assert.equal(rows.length, 1)
  })

  test('DOM-KAY-033: iki adaya aynı odada eşzamanlı görüşme: yalnız biri yazılır, öteki 409 meeting_conflict', async () => {
    const ctx = await frontDeskContext()
    const open = (id: string, phone: string) => ({
      collection: 'prospects' as const,
      id,
      data: {
        id,
        name: `Test Aday ${id}`,
        phone,
        email: '',
        branchId: 'b1',
        interest: '7. Sınıf',
        source: 'Telefon',
        stage: 'Yeni aday',
        studentId: null,
        createdAt: FIXED_NOW.toISOString(),
        trialAt: null,
        notes: [],
      },
    })
    await insertMissingRecords(
      db,
      ctx.institutionId,
      [open('test-pr-a', '05559990201'), open('test-pr-b', '05559990202')],
      FIXED_NOW,
    )
    const meeting = { date: '2026-10-10T10:00:00.000Z', duration: 45, room: 'Görüşme odası' }
    const versioned = { idempotency: null, expectedVersion: 1 }
    const outcomes = await Promise.allSettled([
      scheduleProspectMeetingCommand(ctx, 'test-pr-a', meeting, versioned),
      scheduleProspectMeetingCommand(ctx, 'test-pr-b', meeting, versioned),
    ])
    assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1)
    const rejected = outcomes.filter((item) => item.status === 'rejected')
    const reason: unknown = rejected[0]?.reason
    assert.ok(
      reason instanceof AppError && reason.statusCode === 409 && reason.code === 'meeting_conflict',
      String(reason),
    )
    const planned = await db
      .select({ id: records.id, data: records.data })
      .from(records)
      .where(and(eq(records.institutionId, ctx.institutionId), eq(records.collection, 'prospects')))
    assert.equal(planned.filter((row) => row.data.trialAt !== null).length, 1)
  })

  test('DOM-KAY-034, DOM-DIL-030: iki deneme istemi son boş deneme yerine eşzamanlı gelir: yalnız biri yazılır, öteki 409 trial_lesson_full', async () => {
    const ctx = await frontDeskContext({ type: 'language_school' })
    const lesson = {
      id: 'test-lesson-pg',
      classId: 'test-c-trial',
      date: '2026-10-08T10:00:00.000Z',
      duration: 60,
    }
    const open = (id: string, phone: string, extra: Record<string, unknown> = {}) => ({
      collection: 'prospects' as const,
      id,
      data: {
        id,
        name: `Test Aday ${id}`,
        phone,
        email: '',
        branchId: 'b1',
        interest: 'B1 · Genel İngilizce',
        source: 'Telefon',
        stage: 'Yeni aday',
        studentId: null,
        minor: true,
        guardianName: 'Test Veli',
        createdAt: FIXED_NOW.toISOString(),
        trialAt: null,
        notes: [],
        ...extra,
      },
    })
    await insertMissingRecords(
      db,
      ctx.institutionId,
      [
        {
          collection: 'classes' as const,
          id: 'test-c-trial',
          data: {
            id: 'test-c-trial',
            name: 'Test Grubu',
            level: 'B1',
            branchId: 'b1',
            capacity: 18,
            isActive: true,
            deletedAt: null,
          },
        },
        { collection: 'schedule' as const, id: lesson.id, data: lesson },
        // Derste bir deneme katılımcısı var: ikinci ve son yer kalmıştır.
        open('test-pr-held', '05559990301', {
          stage: 'Görüşme planlandı',
          trialLesson: {
            lessonId: lesson.id,
            classId: lesson.classId,
            date: lesson.date,
            duration: lesson.duration,
            guardianConsentAt: FIXED_NOW.toISOString(),
            scheduledAt: FIXED_NOW.toISOString(),
            by: { role: 'onburo', userId: 'test-user' },
          },
        }),
        open('test-pr-a', '05559990302'),
        open('test-pr-b', '05559990303'),
      ],
      FIXED_NOW,
    )
    const body = { lessonId: lesson.id, guardianConsent: true }
    const versioned = { idempotency: null, expectedVersion: 1 }
    // Kurum kilidi tutulurken iki istek de kilitte bekler; bırakılınca sırayla işlenir ve ikincisi
    // birincinin yazdığı denemeyi görür.
    const held = gate()
    const release = gate()
    const holder = db.transaction(async (tx) => {
      await lockInstitution(tx, ctx.institutionId)
      held.open()
      await release.opened
    })
    await held.opened
    const outcomes = Promise.allSettled([
      scheduleTrialLessonCommand(ctx, 'test-pr-a', body, versioned),
      scheduleTrialLessonCommand(ctx, 'test-pr-b', body, versioned),
    ])
    try {
      await untilLockWait('advisory', 2)
    } finally {
      release.open()
      await holder
    }
    const settled = await outcomes
    assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1)
    const rejected = settled.filter((item) => item.status === 'rejected')
    assert.equal(rejected.length, 1)
    const reason: unknown = rejected[0]?.reason
    assert.ok(
      reason instanceof AppError &&
        reason.statusCode === 409 &&
        reason.code === 'trial_lesson_full',
      String(reason),
    )
    const stored = await db
      .select({ data: records.data })
      .from(records)
      .where(and(eq(records.institutionId, ctx.institutionId), eq(records.collection, 'prospects')))
    const onLesson = stored.filter(
      (row) => (row.data.trialLesson as { lessonId?: string } | undefined)?.lessonId === lesson.id,
    )
    assert.equal(onLesson.length, 2)
  })
  test('DOM-KAY-011, DOM-KAY-035: aynı adayı eşzamanlı iki kesin kayıt: yalnız biri yazılır, öteki 409; tek öğrenci, tek taksit planı', async () => {
    const ctx = await frontDeskContext()
    const seed = createSeed(FIXED_NOW)
    const target = seed.classes.find((item) => item.id === 'c1')
    const prospect = seed.prospects.find((item) => item.id === 'pr1')
    assert.ok(target && prospect)
    await insertMissingRecords(
      db,
      ctx.institutionId,
      [
        { collection: 'classes' as const, id: target.id, data: { ...target } },
        { collection: 'prospects' as const, id: prospect.id, data: { ...prospect } },
      ],
      FIXED_NOW,
    )
    // Tarifeli gövde: tutar yayımlanmış tarifeden hesaplanır (DOM-FIN-002).
    const body = {
      classId: target.id,
      tariffId: await publishTariff(ctx),
      installmentCount: 3,
      firstDueDate: '2026-11-15',
      identity: { kind: 'tc', number: '10000000146', birthDate: '2013-03-01' },
      guardian: { name: 'Test Veli', phone: '05559990124', relationship: 'mother' },
    }
    const versioned = (key: string) => ({
      idempotency: { key, fingerprint: key },
      expectedVersion: 1,
    })
    // Kurum kilidi tutulurken iki istek de kilitte bekler; bırakılınca sırayla işlenir ve ikincisi
    // birincinin yazdığı `Kayıt oldu` adayı (yeni sürüm) görür.
    const held = gate()
    const release = gate()
    const holder = db.transaction(async (tx) => {
      await lockInstitution(tx, ctx.institutionId)
      held.open()
      await release.opened
    })
    await held.opened
    const outcomes = Promise.allSettled([
      enrollProspectCommand(ctx, prospect.id, body, versioned('pg-enroll-0001')),
      enrollProspectCommand(ctx, prospect.id, body, versioned('pg-enroll-0002')),
    ])
    try {
      await untilLockWait('advisory', 2)
    } finally {
      release.open()
      await holder
    }
    const settled = await outcomes
    const fulfilled = settled.filter((item) => item.status === 'fulfilled')
    assert.deepEqual(
      fulfilled.map((item) => item.value.statusCode),
      [201],
    )
    const rejected = settled.filter((item) => item.status === 'rejected')
    assert.equal(rejected.length, 1)
    const reason: unknown = rejected[0]?.reason
    assert.ok(reason instanceof AppError && reason.statusCode === 409, String(reason))
    const written = async (collection: string) => {
      const [row] = await db
        .select({ n: count() })
        .from(records)
        .where(
          and(eq(records.institutionId, ctx.institutionId), eq(records.collection, collection)),
        )
      return row?.n
    }
    assert.equal(await written('students'), 1)
    assert.equal(await written('parents'), 1)
    assert.equal(await written('invoices'), 3)
    assert.equal(await written('contracts'), 1)
  })
})
