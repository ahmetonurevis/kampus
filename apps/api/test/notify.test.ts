import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { records } from '../src/db/schema/records.ts'
import { AppError } from '../src/errors.ts'
import { notify, type NotifyContext, type NotifyInput } from '../src/services/notify.ts'
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
 * Bildirim gönderimi servisi (OG-018, IST-065; docs/domain/iletisim-ve-veli.md DOM-ILT-020,
 * -022, -023, -073; DOM-YTK-040). `notify` çağıranın transaction'ında yazar; görünürlük
 * listeleme ucundan doğrulanır. Aynı transaction, geri alma, başka kurumun alıcısı, mükerrer
 * `dedupeKey`, kapalı modül, şema reddi ve yetişkin kursiyer denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>
const FEEDBACK = { type: 'feedback_released', data: { submissionId: 'sub-1' } } as const

describe('bildirim gönderimi (notify)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  const logs: string[] = []

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { logs, clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  /** Deniz (`s-1`) ve Can (`s-3`); Deniz'in öğrenci ve veli hesabı, Can'ın velisi. */
  async function tenant(overrides: Partial<InstitutionOverrides> = {}) {
    const institution = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      institution.id,
      [
        ['s-1', 'Deniz Yılmaz'],
        ['s-3', 'Can Arslan'],
      ].map(([id, name]) => ({
        collection: 'students' as const,
        id: id!,
        data: { id, name, classId: '9-A', isActive: true },
      })),
      FIXED_NOW,
    )
    const member = (role: 'ogretmen' | 'ogrenci' | 'veli', kind: string, recordId: string) =>
      createMember(app, institution.id, role, [{ kind, recordId } as never])
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, await member('ogretmen', 'teacher', 't-1')),
      student: await signInAs(app, await member('ogrenci', 'student', 's-1')),
      parent: await signInAs(app, await member('veli', 'child', 's-1')),
      otherParent: await signInAs(app, await member('veli', 'child', 's-3')),
    }
    const ctx: NotifyContext = {
      institutionId: institution.id,
      now: FIXED_NOW,
      log: app.log,
      actor: { userId: institution.admin.id, role: 'yonetici' },
    }
    return { institution, cookies, ctx }
  }

  const send = (ctx: NotifyContext, input: NotifyInput) =>
    db.transaction((tx) => notify(tx, ctx, input))

  const stored = (institutionId: string) =>
    db
      .select({ id: records.id, data: records.data })
      .from(records)
      .where(and(eq(records.institutionId, institutionId), eq(records.collection, 'notifications')))
      .orderBy(records.position)
  const audits = (institutionId: string) =>
    db
      .select({
        action: auditLog.action,
        actorUserId: auditLog.actorUserId,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        changes: auditLog.changes,
      })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, 'notification.create')),
      )

  async function seen(cookie: string) {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { origin: TEST_ORIGIN, cookie },
    })
    assert.equal(response.statusCode, 200, response.body)
    return (response.json().data as Json[]).map((n) => [n.kind, n.audience, n.studentId, n.title])
  }

  test('IST-065, DOM-ILT-073: notify aynı transaction’da yazar; öğrenci ve veli kendi bildirimini görür, başkası görmez', async () => {
    const { institution, cookies, ctx } = await tenant()
    const from = logs.length
    const result = await send(ctx, { ...FEEDBACK, recipients: { studentIds: ['s-1'] } })
    assert.equal(result.created.length, 2)
    assert.deepEqual([result.deduplicated, result.unknownRecipients, result.skipped], [0, 0, null])
    assert.deepEqual(await seen(cookies.student), [
      ['feedback_released', 'student', 's-1', 'Görevine öğretmen geri bildirimi geldi.'],
    ])
    assert.deepEqual(await seen(cookies.parent), [
      ['feedback_released', 'parent', 's-1', 'Deniz için öğretmen geri bildirimi geldi.'],
    ])
    for (const cookie of [cookies.otherParent, cookies.teacher, cookies.admin])
      assert.deepEqual(await seen(cookie), [])
    // Kayıtta veri yok: yalnız tür, kitle, öğrenci, konu ve an (DOM-ILT-023).
    const rows = await stored(institution.id)
    assert.deepEqual(
      rows.map((row) => row.id),
      result.created,
    )
    for (const row of rows)
      assert.deepEqual(Object.keys(row.data).sort(), [
        'audience',
        'createdAt',
        'id',
        'kind',
        'studentId',
        'subject',
      ])
    assert.deepEqual(await audits(institution.id), [
      {
        action: 'notification.create',
        actorUserId: institution.admin.id,
        entityType: 'task_submission',
        entityId: 'sub-1',
        changes: { fields: ['audience', 'createdAt', 'id', 'kind', 'studentId', 'subject'] },
      },
    ])
    const written = logs.slice(from).join('\n')
    assert.ok(written.includes('notification.created'))
    for (const text of ['s-1', 'Deniz', 'geri bildirimi geldi'])
      assert.ok(!written.includes(text), `${text} loglandı`)
  })

  test('IST-065: çağıranın işlemi geri alınırsa bildirim ve denetim satırı da yoktur', async () => {
    const { institution, cookies, ctx } = await tenant()
    await assert.rejects(
      db.transaction(async (tx) => {
        const result = await notify(tx, ctx, { ...FEEDBACK, recipients: { studentIds: ['s-1'] } })
        assert.equal(result.created.length, 2)
        throw new Error('çağıran işlem başarısız')
      }),
      /çağıran işlem başarısız/,
    )
    assert.deepEqual(await stored(institution.id), [])
    assert.deepEqual(await audits(institution.id), [])
    assert.deepEqual(await seen(cookies.parent), [])
  })

  test('IST-065: başka kurumun ve olmayan öğrencinin kimliği atlanır; B kurumunda kayıt oluşmaz', async () => {
    const a = await tenant()
    const b = await tenant()
    await insertMissingRecords(
      db,
      b.institution.id,
      [{ collection: 'students', id: 's-9', data: { id: 's-9', name: 'Ece Kaya' } }],
      FIXED_NOW,
    )
    const result = await send(a.ctx, {
      ...FEEDBACK,
      recipients: { studentIds: ['s-9', 's-1', 'yok', 's-1'] },
    })
    assert.equal(result.unknownRecipients, 2)
    assert.deepEqual(
      (await stored(a.institution.id)).map((row) => [row.data.audience, row.data.studentId]),
      [
        ['student', 's-1'],
        ['parent', 's-1'],
      ],
    )
    assert.deepEqual(await stored(b.institution.id), [])
    await insertMissingRecords(
      db,
      a.institution.id,
      [{ collection: 'students', id: 's-a', data: { id: 's-a', name: 'Ali Demir' } }],
      FIXED_NOW,
    )
    // Yalnız yabancı alıcı: hiçbir şey yazılmaz, denetim satırı yok.
    const none = await send(b.ctx, { ...FEEDBACK, recipients: { studentIds: ['s-a', 'yok'] } })
    assert.deepEqual([none.created, none.unknownRecipients], [[], 2])
    assert.deepEqual(await audits(b.institution.id), [])
    assert.ok(logs.some((line) => line.includes('notification.recipient_skipped')))
  })

  test('IST-065: aynı dedupeKey aynı alıcıya ikinci bildirim yazmaz; başka anahtar yeni bildirimdir', async () => {
    const { institution, cookies, ctx } = await tenant()
    const input = {
      ...FEEDBACK,
      recipients: { studentIds: ['s-1'] },
      dedupeKey: 'sub-1:v1',
    } satisfies NotifyInput
    const first = await send(ctx, input)
    assert.equal(first.created.length, 2)
    const again = await send(ctx, input)
    assert.deepEqual([again.created, again.deduplicated], [[], 2])
    // Aynı olay, yeni alıcı eklenince yalnız yeni alıcıya yazılır.
    const wider = await send(ctx, { ...input, recipients: { studentIds: ['s-1', 's-3'] } })
    assert.deepEqual([wider.created.length, wider.deduplicated], [2, 2])
    const other = await send(ctx, { ...input, dedupeKey: 'sub-1:v2' })
    assert.equal(other.created.length, 2)
    assert.equal((await stored(institution.id)).length, 6)
    assert.equal((await seen(cookies.parent)).length, 2)
    // Mükerrer çağrı denetim satırı da eklemez.
    assert.equal((await audits(institution.id)).length, 3)
  })

  test('DOM-YTK-040: iletişim ya da türün modülü kapalıysa hiçbir şey yazılmaz; çağıranın işlemi sürer', async () => {
    for (const closed of ['communication', 'learning']) {
      const { institution, ctx } = await tenant({ enabledModules: { [closed]: false } })
      const result = await send(ctx, { ...FEEDBACK, recipients: { studentIds: ['s-1'] } })
      assert.deepEqual([result.created, result.skipped], [[], 'module_disabled'], closed)
      assert.deepEqual(await stored(institution.id), [], closed)
      assert.deepEqual(await audits(institution.id), [], closed)
    }
    assert.ok(logs.some((line) => line.includes('notification.skipped')))
    // Öğrenme modülü kapalıyken başka modülün türü üretilir.
    const { institution, ctx } = await tenant({ enabledModules: { learning: false } })
    const enrolled = await send(ctx, {
      type: 'enrollment_completed',
      recipients: { studentIds: ['s-1'] },
      data: { studentId: 's-1' },
    })
    assert.equal(enrolled.created.length, 1)
    assert.deepEqual(
      (await stored(institution.id)).map((row) => [row.data.audience, row.data.subject]),
      [['parent', { type: 'students', id: 's-1' }]],
    )
  })

  test('DOM-ILT-023: veri tür şemasına uymazsa, tür bilinmiyorsa ya da anahtar geçersizse 500; çağıranın yazdığı da geri alınır', async () => {
    const { institution, ctx } = await tenant()
    const internal = (error: unknown) =>
      error instanceof AppError && error.statusCode === 500 && error.code === 'internal_error'
    const bad: unknown[] = [
      { ...FEEDBACK, data: { submissionId: 'sub-1', note: 'Puan: 85' } },
      { ...FEEDBACK, data: {} },
      { type: 'payment_overdue', data: { invoiceId: 'i-1' } },
      { ...FEEDBACK, dedupeKey: '' },
    ]
    for (const input of bad)
      await assert.rejects(
        db.transaction(async (tx) => {
          await insertMissingRecords(
            tx,
            institution.id,
            [{ collection: 'students', id: 's-yeni', data: { id: 's-yeni', name: 'Yeni' } }],
            FIXED_NOW,
          )
          await notify(tx, ctx, { ...(input as NotifyInput), recipients: { studentIds: ['s-1'] } })
        }),
        internal,
      )
    assert.deepEqual(await stored(institution.id), [])
    const students = await db
      .select({ id: records.id })
      .from(records)
      .where(and(eq(records.institutionId, institution.id), eq(records.id, 's-yeni')))
    assert.deepEqual(students, [])
  })

  test('DOM-ILT-052: dil okulunda yetişkin kursiyerin bildirimi veliye gitmez; aktörsüz çağrı denetimde aktörsüzdür', async () => {
    const { institution, cookies, ctx } = await tenant({ type: 'language_school' })
    await insertMissingRecords(
      db,
      institution.id,
      [
        { collection: 'prospects', id: 'p-1', data: { id: 'p-1', studentId: 's-1', minor: false } },
        { collection: 'prospects', id: 'p-3', data: { id: 'p-3', studentId: 's-3', minor: true } },
      ],
      FIXED_NOW,
    )
    const result = await send(
      { ...ctx, actor: null },
      { ...FEEDBACK, recipients: { studentIds: ['s-1', 's-3'] } },
    )
    assert.equal(result.created.length, 3)
    assert.deepEqual(await seen(cookies.parent), [])
    assert.equal((await seen(cookies.student)).length, 1)
    assert.deepEqual(
      (await seen(cookies.otherParent)).map(([, audience, studentId]) => [audience, studentId]),
      [['parent', 's-3']],
    )
    const [audit] = await audits(institution.id)
    assert.equal(audit?.actorUserId, null)
  })
})
