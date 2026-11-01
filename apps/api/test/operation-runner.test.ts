import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { asc, eq } from 'drizzle-orm'

import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import { enrollProspect, payInvoice } from '@kampus/school-core/lib/domain.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { runWorkflow } from '@kampus/school-core/lib/school-workflows.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { records } from '../src/db/schema/records.ts'
import { AppError, mapDatabaseError, MESSAGES } from '../src/errors.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import { mapOperationError, runOperation } from '../src/services/operation-runner.ts'
import { buildTestApp, createInstitution, createTestDatabase, FIXED_NOW } from './support/app.ts'

const LATER = new Date('2026-10-06T10:00:00.000Z')
const seed = createSeed(FIXED_NOW)

function seedItems(collections: readonly CollectionName[]) {
  return collections.flatMap((collection) => {
    const items: readonly Record<string, unknown>[] = seed[collection]
    return items.map((data) => {
      const id = recordKey(collection, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection, id, data }
    })
  })
}

/** Belirlenimci kimlik üreteci: `<önek>-test-1`, `<önek>-test-2` … */
function counterIds() {
  let n = 0
  return (prefix: string) => `${prefix}-test-${++n}`
}

function hasStatus(status: number, code?: string) {
  return (error: unknown) => {
    assert.ok(error instanceof AppError, `AppError bekleniyordu: ${String(error)}`)
    assert.equal(error.statusCode, status)
    if (code) assert.equal(error.code, code)
    return true
  }
}

describe('işlem çalıştırıcı', () => {
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

  async function institution(collections: readonly CollectionName[]) {
    const created = await createInstitution(app)
    await insertMissingRecords(db, created.id, seedItems(collections), FIXED_NOW)
    const ctx: ServiceContext = {
      db,
      institutionId: created.id,
      actor: {
        userId: created.admin.id,
        role: 'yonetici',
        membershipId: created.adminMembershipId,
      },
      now: LATER,
      log: app.log,
    }
    return ctx
  }

  function snapshot(institutionId: string) {
    return Promise.all([
      db
        .select()
        .from(records)
        .where(eq(records.institutionId, institutionId))
        .orderBy(asc(records.collection), asc(records.id)),
      db.select().from(auditLog).where(eq(auditLog.institutionId, institutionId)),
    ])
  }

  const unpaid = seed.invoices.find((invoice) => !invoice.paidAt)
  assert.ok(unpaid, 'örnek veride ödenmemiş taksit var')
  const pay = (state: State, now: string) => payInvoice(state, unpaid.id, 'Kredi kartı', now)

  test('ödeme yalnız ilgili taksiti sürümüyle yazar ve denetim kaydı bırakır', async () => {
    const ctx = await institution(['invoices'])
    const outcome = await runOperation(ctx, {
      action: 'invoice.pay',
      entity: { type: 'invoices', id: unpaid.id },
      collections: ['invoices'],
      run: (state, { now }) => pay(state, now),
    })
    assert.equal(outcome.result.id, unpaid.id)
    assert.deepEqual(outcome.changes, [
      { kind: 'update', collection: 'invoices', id: unpaid.id, version: 2 },
    ])
    const row = await findRecord(db, ctx.institutionId, 'invoices', unpaid.id)
    assert.equal(row?.data.paidAt, LATER.toISOString())
    assert.equal(row?.data.method, 'Kredi kartı')
    const all = await loadRecords(db, ctx.institutionId, ['invoices'])
    assert.equal(all.length, seed.invoices.length)
    assert.equal(all.filter((item) => item.version !== 1).length, 1)

    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.institutionId, ctx.institutionId))
    assert.equal(audit.length, 1)
    assert.equal(audit[0]?.action, 'invoice.pay')
    assert.equal(audit[0]?.entityType, 'invoices')
    assert.equal(audit[0]?.entityId, unpaid.id)
    assert.equal(audit[0]?.actorRole, 'yonetici')
    assert.deepEqual(audit[0]?.changes, { fields: ['method', 'paidAt'] })
  })

  test('mükerrer ödeme 409 ile reddedilir ve hiçbir kayıt değişmez', async () => {
    const ctx = await institution(['invoices'])
    const request = {
      action: 'invoice.pay',
      entity: { type: 'invoices', id: unpaid.id },
      collections: ['invoices'] as const,
      run: (state: State, { now }: { now: string }) => pay(state, now),
    }
    await runOperation(ctx, request)
    const before = await snapshot(ctx.institutionId)
    await assert.rejects(runOperation(ctx, request), (error: unknown) => {
      hasStatus(409, 'invoice_already_paid')(error)
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'Bu taksit zaten ödenmiş.')
      return true
    })
    assert.deepEqual(await snapshot(ctx.institutionId), before)
  })

  test('istemcinin eski sürümü 409, olmayan kaydı 404 verir', async () => {
    const ctx = await institution(['invoices'])
    const before = await snapshot(ctx.institutionId)
    const run = (state: State, { now }: { now: string }) => pay(state, now)
    await assert.rejects(
      runOperation(ctx, {
        action: 'invoice.pay',
        entity: { type: 'invoices', id: unpaid.id },
        collections: ['invoices'],
        expectedVersions: [{ collection: 'invoices', id: unpaid.id, version: 7 }],
        run,
      }),
      hasStatus(409, 'version_conflict'),
    )
    await assert.rejects(
      runOperation(ctx, {
        action: 'invoice.pay',
        entity: { type: 'invoices', id: unpaid.id },
        collections: ['invoices'],
        expectedVersions: [{ collection: 'invoices', id: 'test-inv-missing', version: 1 }],
        run,
      }),
      hasStatus(404, 'not_found'),
    )
    assert.deepEqual(await snapshot(ctx.institutionId), before)

    const outcome = await runOperation(ctx, {
      action: 'invoice.pay',
      entity: { type: 'invoices', id: unpaid.id },
      collections: ['invoices'],
      expectedVersions: [{ collection: 'invoices', id: unpaid.id, version: 1 }],
      run,
    })
    assert.equal(outcome.changes[0]?.version, 2)
  })

  test('eski sürümde core yetki/kapsam reddi (403, 404) sürümden önce gelir; kural ve çakışma 409 olur, 500 gizlenmez', async () => {
    const ctx = await institution(['invoices'])
    const before = await snapshot(ctx.institutionId)
    const stale = (run: () => never) =>
      runOperation(ctx, {
        action: 'invoice.pay',
        entity: { type: 'invoices', id: unpaid.id },
        collections: ['invoices'],
        expectedVersions: [{ collection: 'invoices', id: unpaid.id, version: 7 }],
        run,
      })
    const fail = (kind: 'not_found' | 'forbidden' | 'rule' | 'conflict') => () => {
      throw new DomainError(`test_${kind}`, 'Test hatası.', { kind })
    }
    await assert.rejects(stale(fail('not_found')), hasStatus(404, 'not_found'))
    await assert.rejects(stale(fail('forbidden')), hasStatus(403, 'test_forbidden'))
    await assert.rejects(stale(fail('rule')), hasStatus(409, 'version_conflict'))
    await assert.rejects(stale(fail('conflict')), hasStatus(409, 'version_conflict'))
    await assert.rejects(
      stale(() => {
        throw new TypeError('beklenmeyen')
      }),
      hasStatus(500),
    )
    assert.deepEqual(await snapshot(ctx.institutionId), before)
  })

  test('başka kurumun kaydı işlemde görünmez; B değişmez', async () => {
    const a = await institution([])
    const b = await institution(['invoices'])
    const bBefore = await snapshot(b.institutionId)
    await assert.rejects(
      runOperation(a, {
        action: 'invoice.pay',
        entity: { type: 'invoices', id: unpaid.id },
        collections: ['invoices'],
        run: (state, { now }) => pay(state, now),
      }),
      (error: unknown) => {
        hasStatus(404, 'not_found')(error)
        return true
      },
    )
    assert.deepEqual(await snapshot(b.institutionId), bBefore)
  })

  const enrollmentCollections = [
    'prospects',
    'classes',
    'branches',
    'students',
    'parents',
    'invoices',
    'contracts',
  ] as const satisfies readonly CollectionName[]
  const prospect = seed.prospects.find((item) => !item.studentId && item.stage !== 'Kayıt oldu')
  const target = seed.classes.find(
    (item) =>
      item.isActive &&
      seed.students.filter((s) => s.classId === item.id && s.isActive).length < item.capacity,
  )

  test('çok koleksiyonlu kayıt işlemi eklemeleri ve güncellemeyi birlikte yazar', async () => {
    assert.ok(prospect && target, 'örnek veride kayıt adayı ve boş sınıf var')
    const ctx = await institution(enrollmentCollections)
    const outcome = await runOperation(ctx, {
      action: 'prospect.enroll',
      collections: enrollmentCollections,
      makeId: counterIds(),
      run: (state, { now, makeId }) =>
        enrollProspect(
          state,
          {
            prospectId: prospect.id,
            classId: target.id,
            totalCents: 12_000_000,
            count: 3,
            startDate: '2026-11-01',
          },
          makeId,
          now,
        ),
      entity: { type: 'prospects', id: prospect.id },
    })
    const summary = outcome.changes.map(
      (change) => `${change.kind}:${change.collection}:${change.id}`,
    )
    assert.deepEqual(summary.sort(), [
      'insert:contracts:contract-test-6',
      'insert:invoices:inv-test-3',
      'insert:invoices:inv-test-4',
      'insert:invoices:inv-test-5',
      'insert:parents:p-test-2',
      'insert:students:s-test-1',
      `update:prospects:${prospect.id}`,
    ])
    const student = await findRecord(db, ctx.institutionId, 'students', 's-test-1')
    assert.equal(student?.data.classId, target.id)
    assert.equal(student?.data.joinedAt, LATER.toISOString())
    const invoices = await loadRecords(db, ctx.institutionId, ['invoices'])
    const created = invoices.filter((row) => row.data.studentId === 's-test-1')
    assert.equal(
      created.reduce((sum, row) => sum + Number(row.data.amount), 0),
      12_000_000,
    )
    assert.equal((await findRecord(db, ctx.institutionId, 'prospects', prospect.id))?.version, 2)
    // Denetim, çağıranın verdiği varlığa bağlanır; yazılan ilk kayda (sözleşme) değil.
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.institutionId, ctx.institutionId))
    assert.deepEqual([audit?.entityType, audit?.entityId], ['prospects', prospect.id])
    assert.equal(outcome.changes[0]?.collection, 'contracts')
  })

  test('doğrulama hatası 400 ve alan yollarıyla döner; hiçbir kayıt değişmez', async () => {
    assert.ok(prospect && target)
    const ctx = await institution(enrollmentCollections)
    const before = await snapshot(ctx.institutionId)
    await assert.rejects(
      runOperation(ctx, {
        action: 'prospect.enroll',
        entity: { type: 'prospects', id: prospect.id },
        collections: enrollmentCollections,
        run: (state, { now, makeId }) =>
          enrollProspect(
            state,
            {
              prospectId: prospect.id,
              classId: target.id,
              totalCents: 5,
              count: 3,
              startDate: 'x',
            },
            makeId,
            now,
          ),
      }),
      (error: unknown) => {
        hasStatus(400, 'validation_failed')(error)
        assert.ok(error instanceof AppError)
        assert.deepEqual(error.issues?.map((issue) => issue.path.join('.')).sort(), [
          'startDate',
          'totalCents',
        ])
        return true
      },
    )
    assert.deepEqual(await snapshot(ctx.institutionId), before)
  })

  test('işlem değiştirdikten sonra hata verirse hiçbir şey yazılmaz', async () => {
    const ctx = await institution(['invoices'])
    const before = await snapshot(ctx.institutionId)
    await assert.rejects(
      runOperation(ctx, {
        action: 'invoice.pay',
        entity: { type: 'invoices', id: unpaid.id },
        collections: ['invoices'],
        run: (state, { now }) => {
          pay(state, now)
          state.invoices.push({ ...unpaid, id: 'test-inv-new' })
          throw new DomainError('installment_plan_rejected', 'Taksit planı onaylanmadı.')
        },
      }),
      hasStatus(422, 'installment_plan_rejected'),
    )
    assert.deepEqual(await snapshot(ctx.institutionId), before)
  })

  test('yazma aşamasındaki hata bütün işlemi ve denetim kaydını geri alır', async () => {
    const ctx = await institution(['invoices'])
    const before = await snapshot(ctx.institutionId)
    await assert.rejects(
      runOperation(ctx, {
        action: 'invoice.pay',
        entity: { type: 'invoices', id: unpaid.id },
        collections: ['invoices'],
        run: (state, { now }) => {
          pay(state, now)
          state.invoices.push({ ...unpaid, id: 'test-inv-big', method: 'x'.repeat(270_000) })
        },
      }),
      hasStatus(422, 'record_too_large'),
    )
    assert.deepEqual(await snapshot(ctx.institutionId), before)
  })

  test('listeden çıkarılan kayıt arşivlenir; State dışı alanlar bağlamdan gelir', async () => {
    const ctx = await institution(['transportAssignments'])
    const assignment = seed.transportAssignments[0]
    assert.ok(assignment)
    const outcome = await runOperation(ctx, {
      action: 'transport.remove',
      entity: { type: 'transportAssignments', id: assignment.id },
      collections: ['transportAssignments'],
      scalars: { modules: seed.modules },
      makeId: counterIds(),
      run: (state, { now, makeId }) =>
        runWorkflow(
          state,
          { role: 'yonetici' },
          'transport-remove',
          {},
          makeId,
          assignment.id,
          now,
        ),
    })
    assert.deepEqual(
      outcome.changes.map((change) => `${change.kind}:${change.collection}:${change.id}`).sort(),
      ['archive:transportAssignments:' + assignment.id],
    )
    const live = await loadRecords(db, ctx.institutionId, ['transportAssignments'])
    assert.ok(!live.some((row) => row.id === assignment.id))
    const archived = await findRecord(
      db,
      ctx.institutionId,
      'transportAssignments',
      assignment.id,
      {
        includeArchived: true,
      },
    )
    assert.equal(archived?.archivedAt?.toISOString(), LATER.toISOString())
    assert.equal(archived?.version, 2)
  })

  test('core denetimi kalıcı yazılmaz; rehberlik iç notu loga ve denetim kaydına düşmez', async () => {
    const logs: string[] = []
    const logged = await buildTestApp(db, { logs })
    try {
      const guidance = [
        'guidanceCases',
        'students',
        'teachers',
        'classes',
        'assignments',
        'clubs',
        'mockExams',
      ] as const
      const ctx = { ...(await institution(guidance)), log: logged.log }
      // Eski sürümden kalmış core denetim satırı: yüklenmez, dokunulmaz.
      await db.insert(records).values({
        institutionId: ctx.institutionId,
        collection: 'audit',
        id: 'test-audit-legacy',
        data: { id: 'test-audit-legacy', action: 'guidance' },
        position: 0,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      })
      const secret = 'GIZLI-IC-NOT-7f3a'
      const secretNote = 'GIZLI-GORUSME-NOTU-91c2'
      // Rehberlik iç notunu yalnız rehberlik görevli öğretmen (örnek veride t1) yazar (DOM-YTK-020).
      const session = { role: 'ogretmen' as const }
      const ids = counterIds()
      const created = await runOperation(ctx, {
        action: 'guidance.create',
        collections: guidance,
        scalars: { modules: seed.modules },
        entity: { type: 'guidanceCases', id: 'guidance-new' },
        makeId: ids,
        run: (state, { now, makeId }) => {
          const result = runWorkflow(
            state,
            session,
            'guidance',
            {
              studentId: 's1',
              teacherId: 't1',
              title: 'Takip',
              plan: 'Plan',
              sharedNote: '',
              internalNote: secret,
              followUp: '2026-10-20',
            },
            makeId,
            undefined,
            now,
          )
          // Core kendi denetimini State'e ekledi; sunucu bunu yazmaz.
          assert.equal(state.audit.length, 1)
          return result
        },
      })
      const caseId = created.changes.find((change) => change.collection === 'guidanceCases')?.id
      assert.ok(caseId)
      await runOperation(ctx, {
        action: 'guidance.note',
        collections: guidance,
        scalars: { modules: seed.modules },
        entity: { type: 'guidanceCases', id: caseId },
        makeId: ids,
        run: (state, { now, makeId }) =>
          runWorkflow(
            state,
            session,
            'guidance-note',
            { text: secretNote, sharedNote: '', followUp: '2026-10-27', status: 'Takipte' },
            makeId,
            caseId,
            now,
          ),
      })
      const auditRecords = await loadRecords(db, ctx.institutionId, ['audit'], {
        includeArchived: true,
      })
      assert.deepEqual(
        auditRecords.map((row) => [row.id, row.version]),
        [['test-audit-legacy', 1]],
      )
      const entries = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.institutionId, ctx.institutionId))
      assert.deepEqual(entries.map((entry) => entry.action).sort(), [
        'guidance.create',
        'guidance.note',
      ])
      for (const entry of entries) assert.equal(entry.actorUserId, ctx.actor.userId)
      const note = entries.find((entry) => entry.action === 'guidance.note')
      assert.deepEqual(note?.changes, { fields: ['followUp', 'notes'] })
      const text = JSON.stringify(entries) + logs.join('')
      assert.ok(logs.some((line) => line.includes('operation.applied')))
      assert.ok(!text.includes(secret), 'iç not sızdı')
      assert.ok(!text.includes(secretNote), 'görüşme notu sızdı')
    } finally {
      await logged.close()
    }
  })

  test('skaler alanı değiştiren işlem geri alınır: 500 ve değersiz yapılandırılmış log', async () => {
    const logs: string[] = []
    const logged = await buildTestApp(db, { logs })
    try {
      const ctx = { ...(await institution(['invoices'])), log: logged.log }
      const before = await snapshot(ctx.institutionId)
      await assert.rejects(
        runOperation(ctx, {
          action: 'invoice.pay',
          collections: ['invoices'],
          entity: { type: 'invoices', id: unpaid.id },
          scalars: { modules: { ...seed.modules }, academicYear: 2026 },
          run: (state, { now }) => {
            pay(state, now)
            state.modules.transport = false
            state.academicYear = 4321
          },
        }),
        hasStatus(500, 'internal_error'),
      )
      assert.deepEqual(await snapshot(ctx.institutionId), before)
      const line = logs.find((item) => item.includes('operation.scalar_changed'))
      assert.ok(line, 'skaler değişikliği loglanmadı')
      const entry = JSON.parse(line)
      assert.equal(entry.level, 50)
      assert.deepEqual(entry.fields, ['academicYear', 'modules.transport'])
      assert.ok(!line.includes('4321'))
    } finally {
      await logged.close()
    }
  })

  test('skaler alanı okuyup değiştirmeyen işlem yazılır', async () => {
    const ctx = await institution(['invoices'])
    const outcome = await runOperation(ctx, {
      action: 'invoice.pay',
      collections: ['invoices'],
      entity: { type: 'invoices', id: unpaid.id },
      scalars: { modules: { ...seed.modules }, academicYear: 2026 },
      run: (state, { now }) => {
        assert.equal(state.academicYear, 2026)
        return pay(state, now)
      },
    })
    assert.equal(outcome.changes.length, 1)
  })

  test('arşivli kaydı yeniden açma sürümü sürdürür ve denetime yeniden açıldı düşer', async () => {
    const ctx = await institution(['transportAssignments'])
    const assignment = seed.transportAssignments[0]
    assert.ok(assignment)
    const entity = { type: 'transportAssignments', id: assignment.id }
    await runOperation(ctx, {
      action: 'transport.remove',
      collections: ['transportAssignments'],
      entity,
      run: (state) => {
        state.transportAssignments.splice(0, 1)
      },
    })
    const archived = await findRecord(
      db,
      ctx.institutionId,
      'transportAssignments',
      assignment.id,
      {
        includeArchived: true,
      },
    )
    assert.equal(archived?.version, 2)
    assert.ok(archived?.archivedAt)

    const reopened = { ...assignment, status: 'test-yeniden' }
    const outcome = await runOperation(ctx, {
      action: 'transport.assign',
      collections: ['transportAssignments'],
      entity,
      run: (state) => {
        state.transportAssignments.unshift(reopened)
      },
    })
    assert.deepEqual(outcome.changes, [
      { kind: 'restore', collection: 'transportAssignments', id: assignment.id, version: 3 },
    ])
    const live = await findRecord(db, ctx.institutionId, 'transportAssignments', assignment.id)
    assert.equal(live?.archivedAt, null)
    assert.equal(live?.version, 3)
    assert.deepEqual(live?.data, JSON.parse(JSON.stringify(reopened)))
    // Yeniden açılan kayıt core'un koyduğu yerde (başta) yüklenir.
    const order = await loadRecords(db, ctx.institutionId, ['transportAssignments'])
    assert.equal(order[0]?.id, assignment.id)

    const entries = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.institutionId, ctx.institutionId))
    const assign = entries.find((entry) => entry.action === 'transport.assign')
    assert.deepEqual(assign?.changes, {
      fields: Object.keys(JSON.parse(JSON.stringify(reopened))).sort(),
      restored: [{ collection: 'transportAssignments', id: assignment.id }],
    })
    const remove = entries.find((entry) => entry.action === 'transport.remove')
    assert.equal(remove?.changes && 'restored' in remove.changes, false)
  })

  test('yüklenmeyen koleksiyona erişim programlama hatasıdır (500)', async () => {
    const ctx = await institution(['transportAssignments'])
    const before = await snapshot(ctx.institutionId)
    await assert.rejects(
      runOperation(ctx, {
        action: 'transport.remove',
        entity: { type: 'transportAssignments', id: 'test-assignment' },
        collections: ['transportAssignments'],
        run: (state) => state.students.length,
      }),
      hasStatus(500, 'internal_error'),
    )
    await assert.rejects(
      runOperation(ctx, {
        action: 'transport.remove',
        entity: { type: 'transportAssignments', id: 'test-assignment' },
        collections: ['transportAssignments'],
        // modules verilmedi: sessizce "kapalı" sayılmaz.
        run: (state) => state.modules.transport,
      }),
      hasStatus(500, 'internal_error'),
    )
    assert.deepEqual(await snapshot(ctx.institutionId), before)
  })

  /** jsonb'nin saklayacağı biçim; core State'iyle karşılaştırmak için. */
  const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

  async function loadedOrder(institutionId: string, collection: CollectionName) {
    const rows = await loadRecords(db, institutionId, [collection])
    return rows.map((row) => row.data)
  }

  test('yükle, işlem, yükle: diziler core doğrudan çalıştığında oluşan sıradadır', async () => {
    assert.ok(prospect && target)
    const ctx = await institution(enrollmentCollections)
    const input = {
      prospectId: prospect.id,
      classId: target.id,
      totalCents: 12_000_000,
      count: 3,
      startDate: '2026-11-01',
    }
    await runOperation(ctx, {
      action: 'prospect.enroll',
      collections: enrollmentCollections,
      entity: { type: 'prospects', id: prospect.id },
      makeId: counterIds(),
      run: (state, { now, makeId }) => enrollProspect(state, input, makeId, now),
    })
    const direct = structuredClone(seed)
    enrollProspect(direct, input, counterIds(), LATER.toISOString())
    for (const collection of enrollmentCollections)
      assert.deepEqual(
        await loadedOrder(ctx.institutionId, collection),
        json(direct[collection]),
        collection,
      )
    // Yerinde kalan kayıtlara yazılmaz: yalnız eklenen kayıtlar ve aday değişti.
    const rows = await loadRecords(db, ctx.institutionId, enrollmentCollections)
    assert.deepEqual(
      rows.filter((row) => row.updatedAt.getTime() !== FIXED_NOW.getTime()).length,
      7,
    )
  })

  test('başa, araya ve yer değiştirerek yazılan sıra korunur; yalnız değişenler yazılır', async () => {
    const ctx = await institution(['invoices'])
    const extra = (id: string) => ({ ...unpaid, id, amount: 1 })
    const reorder = (state: State) => {
      const last = state.invoices.pop()
      assert.ok(last)
      state.invoices.unshift(last)
      state.invoices.splice(5, 0, extra('test-inv-mid-1'), extra('test-inv-mid-2'))
      state.invoices.unshift(extra('test-inv-head'))
    }
    const outcome = await runOperation(ctx, {
      action: 'invoice.reorder',
      collections: ['invoices'],
      entity: { type: 'invoices', id: 'test-inv-head' },
      run: reorder,
    })
    assert.deepEqual(outcome.changes.map((change) => change.kind).sort(), [
      'insert',
      'insert',
      'insert',
      'move',
    ])
    const direct = structuredClone(seed)
    reorder(direct)
    assert.deepEqual(await loadedOrder(ctx.institutionId, 'invoices'), json(direct.invoices))
  })

  test('aynı noktaya art arda ekleme aralığı tüketince yalnız o koleksiyon numaralanır', async () => {
    const ctx = await institution(['invoices', 'students'])
    const studentsBefore = await loadRecords(db, ctx.institutionId, ['students'])
    const mirror = structuredClone(seed.invoices)
    for (let round = 0; round < 14; round += 1) {
      const item = { ...unpaid, id: `test-inv-wedge-${round}` }
      mirror.splice(1, 0, structuredClone(item))
      await runOperation(ctx, {
        action: 'invoice.wedge',
        collections: ['invoices'],
        entity: { type: 'invoices', id: item.id },
        run: (state) => {
          state.invoices.splice(1, 0, item)
        },
      })
      assert.deepEqual(await loadedOrder(ctx.institutionId, 'invoices'), json(mirror))
    }
    assert.deepEqual(await loadRecords(db, ctx.institutionId, ['students']), studentsBefore)
  })

  describe('kısmi yükleme (loadScope)', () => {
    const others = seed.invoices.filter((invoice) => invoice.id !== unpaid.id)
    const fresh = (id: string) => ({ ...unpaid, id, amount: 1 })

    test('yalnız verilen kimlik yüklenir; yüklenmeyen kayıtlar arşivlenmez, değişmez', async () => {
      const ctx = await institution(['invoices', 'students'])
      const before = await loadRecords(db, ctx.institutionId, ['invoices'])
      let seen = -1
      const outcome = await runOperation(ctx, {
        action: 'invoice.pay',
        entity: { type: 'invoices', id: unpaid.id },
        collections: ['invoices', 'students'],
        loadScope: { invoices: { ids: [unpaid.id] }, students: { ids: [] } },
        run: (state, { now }) => {
          seen = state.invoices.length
          pay(state, now)
          state.invoices.push(fresh('test-inv-partial'))
        },
      })
      assert.equal(seen, 1)
      assert.deepEqual(outcome.loaded, { invoices: 1, students: 0 })
      assert.deepEqual(outcome.changes.map((change) => change.kind).sort(), ['insert', 'update'])
      const after = await loadRecords(db, ctx.institutionId, ['invoices'])
      assert.equal(after.length, before.length + 1)
      // Yüklenmeyen kayıtlar aynen kalır: sürüm, sıra, veri, arşiv yok.
      const untouched = new Map(after.map((row) => [row.id, row]))
      for (const row of before.filter((item) => item.id !== unpaid.id))
        assert.deepEqual(untouched.get(row.id), row)
      // Yeni kayıt koleksiyonun sonuna eklenir.
      assert.equal(after.at(-1)?.id, 'test-inv-partial')
      assert.equal(
        (await loadRecords(db, ctx.institutionId, ['students'])).length,
        seed.students.length,
      )
    })

    test('süzgeçli yükleme yalnız eşleşenleri verir; yüklenen ve listeden çıkarılan kayıt arşivlenir', async () => {
      const ctx = await institution(['invoices'])
      const own = seed.invoices.filter((invoice) => invoice.studentId === unpaid.studentId)
      const before = await loadRecords(db, ctx.institutionId, ['invoices'])
      const outcome = await runOperation(ctx, {
        action: 'invoice.drop',
        entity: { type: 'invoices', id: unpaid.id },
        collections: ['invoices'],
        loadScope: { invoices: { match: [{ field: 'studentId', values: [unpaid.studentId] }] } },
        run: (state) => {
          assert.ok(state.invoices.every((item) => item.studentId === unpaid.studentId))
          state.invoices = state.invoices.filter((item) => item.id !== unpaid.id)
        },
      })
      assert.equal(outcome.loaded.invoices, own.length)
      assert.deepEqual(outcome.changes, [
        { kind: 'archive', collection: 'invoices', id: unpaid.id, version: 2 },
      ])
      const after = await loadRecords(db, ctx.institutionId, ['invoices'])
      assert.deepEqual(
        after,
        before.filter((row) => row.id !== unpaid.id),
      )
    })

    test('kısmi yükte sıra değiştirmek 500; yüklenmeyen kimlikle ekleme 409; hiçbir kayıt değişmez', async () => {
      const ctx = await institution(['invoices'])
      const before = await snapshot(ctx.institutionId)
      const [first, second] = seed.invoices
      assert.ok(first && second && others[0])
      await assert.rejects(
        runOperation(ctx, {
          action: 'invoice.reorder',
          entity: { type: 'invoices', id: first.id },
          collections: ['invoices'],
          loadScope: { invoices: { ids: [first.id, second.id] } },
          run: (state) => {
            state.invoices.reverse()
          },
        }),
        hasStatus(500, 'internal_error'),
      )
      await assert.rejects(
        runOperation(ctx, {
          action: 'invoice.prepend',
          entity: { type: 'invoices', id: first.id },
          collections: ['invoices'],
          loadScope: { invoices: { ids: [first.id] } },
          run: (state) => {
            state.invoices.unshift(fresh('test-inv-head'))
          },
        }),
        hasStatus(500, 'internal_error'),
      )
      // Görülmeyen canlı kayıtla aynı kimlik: eşzamanlı ekleme gibi 409, üzerine yazılmaz.
      await assert.rejects(
        runOperation(ctx, {
          action: 'invoice.insert',
          entity: { type: 'invoices', id: first.id },
          collections: ['invoices'],
          loadScope: { invoices: { ids: [] } },
          run: (state) => {
            state.invoices.push(fresh(first.id))
          },
        }),
        hasStatus(409, 'version_conflict'),
      )
      await assert.rejects(
        runOperation(ctx, {
          action: 'invoice.pay',
          entity: { type: 'invoices', id: first.id },
          collections: ['invoices'],
          loadScope: { students: { ids: [] } },
          run: () => undefined,
        }),
        hasStatus(500, 'internal_error'),
      )
      assert.deepEqual(await snapshot(ctx.institutionId), before)
    })
  })

  test('değişiklik yoksa yazma ve denetim kaydı yoktur', async () => {
    const ctx = await institution(['invoices'])
    const before = await snapshot(ctx.institutionId)
    const outcome = await runOperation(ctx, {
      action: 'invoice.read',
      entity: { type: 'invoices', id: 'test-all' },
      collections: ['invoices'],
      run: (state) => state.invoices.length,
    })
    assert.equal(outcome.result, seed.invoices.length)
    assert.deepEqual(outcome.changes, [])
    assert.deepEqual(await snapshot(ctx.institutionId), before)
  })
})

describe('veritabanı hata eşlemesi', () => {
  /** Drizzle sürücü hatasını `cause`'a sarar; eşleme zinciri izler. */
  const wrapped = (code: string, constraint?: string) =>
    new Error('Failed query', { cause: Object.assign(new Error('pg'), { code, constraint }) })

  test('kilitlenme ve serileştirme 409 conflict, boyut kısıtı 422; ötekiler aynen kalır', () => {
    for (const code of ['40P01', '40001']) {
      const mapped = mapDatabaseError(wrapped(code))
      assert.ok(mapped instanceof AppError)
      assert.deepEqual([mapped.statusCode, mapped.code], [409, 'conflict'])
    }
    const size = mapDatabaseError(wrapped('23514', 'records_data_size_check'))
    assert.ok(size instanceof AppError)
    assert.deepEqual([size.statusCode, size.code], [422, 'record_too_large'])
    const otherCheck = wrapped('23514', 'başka_check')
    assert.equal(mapDatabaseError(otherCheck), otherCheck)
    const node = Object.assign(new Error('x'), { code: 'ERR_INVALID_ARG_TYPE' })
    assert.equal(mapDatabaseError(node), node)
  })
})

describe('core hata eşlemesi', () => {
  test('DomainError türü HTTP durumuna eşlenir', () => {
    const domain = (kind: 'rule' | 'conflict' | 'forbidden' | 'not_found') =>
      new DomainError('goal_already_open', 'Bu öğrenci için açık bir hedef zaten var.', { kind })
    const mapped = (['rule', 'conflict', 'forbidden', 'not_found'] as const).map((kind) => {
      const error = mapOperationError(domain(kind))
      assert.ok(error instanceof AppError)
      return [error.statusCode, error.code, error.message]
    })
    assert.deepEqual(mapped, [
      [422, 'goal_already_open', 'Bu öğrenci için açık bir hedef zaten var.'],
      [409, 'goal_already_open', 'Bu öğrenci için açık bir hedef zaten var.'],
      [403, 'goal_already_open', 'Bu öğrenci için açık bir hedef zaten var.'],
      [404, 'not_found', MESSAGES.not_found],
    ])
  })

  test('DOM-YTK-001 path taşıyan DomainError 422/409/403 gövdesinde issues olur; path yoksa alan çıkmaz; 404 genel kalır', () => {
    const path = ['subjectTeachers', 'math']
    const message = 'Matematik dersi için uygun branş öğretmeni seçin.'
    const issues = [{ path, code: 'subject_teacher_required', message }]
    for (const [kind, status] of [
      ['rule', 422],
      ['conflict', 409],
      ['forbidden', 403],
    ] as const) {
      const error = mapOperationError(
        new DomainError('subject_teacher_required', message, { kind, path }),
      )
      assert.ok(error instanceof AppError)
      assert.equal(error.statusCode, status)
      assert.deepEqual(error.issues, issues)
      const plain = mapOperationError(
        new DomainError('subject_teacher_required', message, { kind }),
      )
      assert.ok(plain instanceof AppError)
      assert.equal(plain.issues, undefined)
    }
    const missing = mapOperationError(
      new DomainError('class_not_found', 'Sınıf yok.', { kind: 'not_found', path: ['classId'] }),
    )
    assert.ok(missing instanceof AppError)
    assert.deepEqual([missing.statusCode, missing.issues], [404, undefined])
  })

  test('core module_disabled API modül mesajıyla 403 olur', () => {
    const error = mapOperationError(
      new DomainError('module_disabled', 'Bu modül kullanıma kapalı.', { kind: 'forbidden' }),
    )
    assert.ok(error instanceof AppError)
    assert.deepEqual(
      [error.statusCode, error.code, error.message],
      [403, 'module_disabled', MESSAGES.module_disabled],
    )
  })

  test('DomainError adını taşıyan düz Error yapısal olarak kabul edilmez: 500', () => {
    const fake = Object.assign(new Error('Sahte kural'), {
      name: 'DomainError',
      code: 'fake',
      kind: 'rule',
    })
    const error = mapOperationError(fake)
    assert.ok(error instanceof AppError)
    assert.deepEqual([error.statusCode, error.code], [500, 'internal_error'])
  })

  test('düz Error ve alt sınıfları 500 internal_error; iç mesaj yanıta gitmez', () => {
    for (const thrown of [
      new Error('Seçilen sınıfın kontenjanı dolu.'),
      new TypeError("Cannot read properties of undefined (reading 'find')"),
      'metin',
    ]) {
      const error = mapOperationError(thrown)
      assert.ok(error instanceof AppError)
      assert.deepEqual(
        [error.statusCode, error.code, error.message],
        [500, 'internal_error', MESSAGES.internal_error],
      )
    }
  })
})
