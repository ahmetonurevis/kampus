import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { asc, eq } from 'drizzle-orm'

import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import { enrollProspect, payInvoice } from '@kampus/school-core/lib/domain.ts'
import { runWorkflow } from '@kampus/school-core/lib/school-workflows.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { records } from '../src/db/schema/records.ts'
import { AppError } from '../src/errors.ts'
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

  test('mükerrer ödeme 422 ile reddedilir ve hiçbir kayıt değişmez', async () => {
    const ctx = await institution(['invoices'])
    const request = {
      action: 'invoice.pay',
      collections: ['invoices'] as const,
      run: (state: State, { now }: { now: string }) => pay(state, now),
    }
    await runOperation(ctx, request)
    const before = await snapshot(ctx.institutionId)
    await assert.rejects(runOperation(ctx, request), (error: unknown) => {
      hasStatus(422, 'rule_violation')(error)
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
        collections: ['invoices'],
        expectedVersions: [{ collection: 'invoices', id: unpaid.id, version: 7 }],
        run,
      }),
      hasStatus(409, 'version_conflict'),
    )
    await assert.rejects(
      runOperation(ctx, {
        action: 'invoice.pay',
        collections: ['invoices'],
        expectedVersions: [{ collection: 'invoices', id: 'test-inv-missing', version: 1 }],
        run,
      }),
      hasStatus(404, 'not_found'),
    )
    assert.deepEqual(await snapshot(ctx.institutionId), before)

    const outcome = await runOperation(ctx, {
      action: 'invoice.pay',
      collections: ['invoices'],
      expectedVersions: [{ collection: 'invoices', id: unpaid.id, version: 1 }],
      run,
    })
    assert.equal(outcome.changes[0]?.version, 2)
  })

  test('başka kurumun kaydı işlemde görünmez; B değişmez', async () => {
    const a = await institution([])
    const b = await institution(['invoices'])
    const bBefore = await snapshot(b.institutionId)
    await assert.rejects(
      runOperation(a, {
        action: 'invoice.pay',
        collections: ['invoices'],
        run: (state, { now }) => pay(state, now),
      }),
      (error: unknown) => {
        hasStatus(422)(error)
        assert.ok(error instanceof Error)
        assert.equal(error.message, 'Ödeme kaydı bulunamadı.')
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
            total: 120000,
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
  })

  test('doğrulama hatası 400 ve alan yollarıyla döner; hiçbir kayıt değişmez', async () => {
    assert.ok(prospect && target)
    const ctx = await institution(enrollmentCollections)
    const before = await snapshot(ctx.institutionId)
    await assert.rejects(
      runOperation(ctx, {
        action: 'prospect.enroll',
        collections: enrollmentCollections,
        run: (state, { now, makeId }) =>
          enrollProspect(
            state,
            { prospectId: prospect.id, classId: target.id, total: 5, count: 3, startDate: 'x' },
            makeId,
            now,
          ),
      }),
      (error: unknown) => {
        hasStatus(400, 'validation_failed')(error)
        assert.ok(error instanceof AppError)
        assert.deepEqual(error.issues?.map((issue) => issue.path.join('.')).sort(), [
          'startDate',
          'total',
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
        collections: ['invoices'],
        run: (state, { now }) => {
          pay(state, now)
          state.invoices.push({ ...unpaid, id: 'test-inv-new' })
          throw new Error('Taksit planı onaylanmadı.')
        },
      }),
      hasStatus(422, 'rule_violation'),
    )
    assert.deepEqual(await snapshot(ctx.institutionId), before)
  })

  test('yazma aşamasındaki hata bütün işlemi ve denetim kaydını geri alır', async () => {
    const ctx = await institution(['invoices'])
    const before = await snapshot(ctx.institutionId)
    await assert.rejects(
      runOperation(ctx, {
        action: 'invoice.pay',
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
    const ctx = await institution(['transportAssignments', 'audit'])
    const assignment = seed.transportAssignments[0]
    assert.ok(assignment)
    const outcome = await runOperation(ctx, {
      action: 'transport.remove',
      collections: ['transportAssignments', 'audit'],
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
      ['archive:transportAssignments:' + assignment.id, 'insert:audit:audit-test-1'],
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

  test('yüklenmeyen koleksiyona erişim programlama hatasıdır (500)', async () => {
    const ctx = await institution(['transportAssignments'])
    const before = await snapshot(ctx.institutionId)
    await assert.rejects(
      runOperation(ctx, {
        action: 'transport.remove',
        collections: ['transportAssignments'],
        run: (state) => state.students.length,
      }),
      hasStatus(500, 'internal_error'),
    )
    await assert.rejects(
      runOperation(ctx, {
        action: 'transport.remove',
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
      total: 120000,
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

  test('değişiklik yoksa yazma ve denetim kaydı yoktur', async () => {
    const ctx = await institution(['invoices'])
    const before = await snapshot(ctx.institutionId)
    const outcome = await runOperation(ctx, {
      action: 'invoice.read',
      collections: ['invoices'],
      run: (state) => state.invoices.length,
    })
    assert.equal(outcome.result, seed.invoices.length)
    assert.deepEqual(outcome.changes, [])
    assert.deepEqual(await snapshot(ctx.institutionId), before)
  })
})

describe('core hata eşlemesi', () => {
  test('DomainError türü HTTP durumuna eşlenir', () => {
    const domain = (kind: string) =>
      Object.assign(new Error('Bu öğrenci için açık bir hedef zaten var.'), {
        name: 'DomainError',
        code: 'goal_already_open',
        kind,
      })
    const statuses = ['rule', 'conflict', 'forbidden', 'not_found'].map((kind) => {
      const mapped = mapOperationError(domain(kind))
      assert.ok(mapped instanceof AppError)
      return [mapped.statusCode, mapped.code]
    })
    assert.deepEqual(statuses, [
      [422, 'goal_already_open'],
      [409, 'goal_already_open'],
      [403, 'goal_already_open'],
      [404, 'not_found'],
    ])
  })

  test('düz Error kural reddidir; alt sınıflar programlama hatası olarak kalır', () => {
    const rule = mapOperationError(new Error('Seçilen sınıfın kontenjanı dolu.'))
    assert.ok(rule instanceof AppError)
    assert.equal(rule.statusCode, 422)
    assert.equal(rule.message, 'Seçilen sınıfın kontenjanı dolu.')
    const bug = new TypeError("Cannot read properties of undefined (reading 'find')")
    assert.equal(mapOperationError(bug), bug)
    const thrown = mapOperationError('metin')
    assert.ok(thrown instanceof AppError)
    assert.equal(thrown.statusCode, 500)
  })
})
