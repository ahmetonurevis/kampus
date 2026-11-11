import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { and, count, eq, isNull, sql } from 'drizzle-orm'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import {
  insertScholarshipAward,
  insertScholarshipProgram,
} from '../../src/db/finance-scholarships.ts'
import { lockInstitution } from '../../src/db/records.ts'
import {
  scholarshipFundAllocations,
  scholarshipFundDonations,
} from '../../src/db/schema/finance-scholarship-funds.ts'
import { scholarshipAwards } from '../../src/db/schema/finance-scholarships.ts'
import { AppError } from '../../src/errors.ts'
import type { ServiceContext } from '../../src/plugins/authenticate.ts'
import {
  allocateFromScholarshipFundCommand,
  cancelScholarshipFundDonationCommand,
  createScholarshipFundCommand,
  donateToScholarshipFundCommand,
} from '../../src/services/finance-scholarship-funds.ts'
import { archiveCancelledRenewalAwards } from '../../src/services/finance-scholarships.ts'
import type { CommandResponse } from '../../src/services/operation-runner.ts'
import { buildTestApp, createInstitution, FIXED_NOW } from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * PostgreSQL 16: burs fonu bakiyesi eşzamanlılıkta aşılmaz (DOM-FIN-068, K-96, K-97; ON-259).
 * İki istek kurum kilidinde bekletilir, kilit bırakılınca sırayla işlenir: ikincisi birincinin
 * yazdığı satırı görür ve bakiye yetmezse 422 alır, hiçbir kaydı yazılmaz.
 */

const AWARD_CENTS = 1_000_000

type Movement = { id: string; kind: string; version: number }

function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, opened }
}

describe('PostgreSQL 16: burs fonu bakiyesi', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const keyed = () => {
    const key = `pg-fund-${String(++serial).padStart(5, '0')}`
    return { key, fingerprint: key }
  }

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  /** Yönetici bağlamı, iki burs ataması ve verilen tutarda tek bağışlı fon. */
  async function setup(donationCents: number) {
    const created = await createInstitution(app)
    const ctx: ServiceContext = {
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
    const programId = randomUUID()
    await insertScholarshipProgram(db, created.id, {
      id: programId,
      academicYear: 2026,
      name: 'Başarı Bursu',
      conditions: 'Sınav puanı 90 ve üstü.',
      terminationConditions: 'Disiplin cezası.',
      durationNote: 'Bir yıl',
      percentBasisPoints: null,
      amountCents: AWARD_CENTS,
      capacity: 5,
      now: FIXED_NOW,
    })
    const awards: string[] = []
    for (const studentId of ['test-s1', 'test-s2']) {
      const id = randomUUID()
      awards.push(id)
      await insertScholarshipAward(db, created.id, {
        id,
        programId,
        studentId,
        academicYear: 2026,
        amountCents: AWARD_CENTS,
        awardedByUserId: 'test',
        now: FIXED_NOW,
      })
    }
    const fund = await createScholarshipFundCommand(
      ctx,
      { name: 'Mezunlar Fonu', donorKind: 'anonymous' },
      null,
    )
    const fundId = (fund.body as { data: { fund: { id: string } } }).data.fund.id
    const donated = await donateToScholarshipFundCommand(
      ctx,
      fundId,
      { amountCents: donationCents, donatedOn: '2026-10-01', channel: 'cash' },
      keyed(),
    )
    const donation = (donated.body as { data: { movements: Movement[] } }).data.movements[0]
    assert.ok(donation)
    return { ctx, fundId, awards, donation }
  }

  async function untilLockWait(minimum: number) {
    for (let attempt = 0; ; attempt += 1) {
      const [waiting] = await db
        .select({ n: count() })
        .from(sql`pg_locks`)
        .where(
          sql`locktype = 'advisory' and not granted and pid in (select pid from pg_stat_activity where datname = current_database())`,
        )
      if ((waiting?.n ?? 0) >= minimum) return
      assert.ok(attempt < 300, 'işlem kilidi beklemedi')
      await delay(10)
    }
  }

  /** Kurum kilidi tutulurken komutları başlatır; hepsi kilitte bekleyince bırakır. */
  async function race(
    ctx: ServiceContext,
    commands: readonly (() => Promise<CommandResponse>)[],
  ): Promise<PromiseSettledResult<CommandResponse>[]> {
    const held = gate()
    const release = gate()
    const holder = db.transaction(async (tx) => {
      await lockInstitution(tx, ctx.institutionId)
      held.open()
      await release.opened
    })
    await held.opened
    const outcomes = Promise.allSettled(commands.map((run) => run()))
    try {
      await untilLockWait(commands.length)
    } finally {
      release.open()
      await holder
    }
    return outcomes
  }

  function assertOneRejected(settled: PromiseSettledResult<CommandResponse>[], code: string) {
    assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1)
    const reason: unknown = settled.find((item) => item.status === 'rejected')?.reason
    assert.ok(
      reason instanceof AppError && reason.statusCode === 422 && reason.code === code,
      String(reason),
    )
  }

  const activeAllocations = (institutionId: string) =>
    db
      .select({ amountCents: scholarshipFundAllocations.amountCents })
      .from(scholarshipFundAllocations)
      .where(
        and(
          eq(scholarshipFundAllocations.institutionId, institutionId),
          isNull(scholarshipFundAllocations.cancelledAt),
        ),
      )

  test('DOM-FIN-068: eşzamanlı iki atama bakiyeyi aşamaz; ikincisi 422 alır ve yazılmaz (K-96)', async () => {
    const { ctx, fundId, awards } = await setup(1_000_000)
    const settled = await race(
      ctx,
      awards.map(
        (awardId) => () =>
          allocateFromScholarshipFundCommand(
            ctx,
            fundId,
            { awardId, amountCents: 600_000 },
            keyed(),
          ),
      ),
    )
    assertOneRejected(settled, 'scholarship_fund_insufficient')
    assert.deepEqual(await activeAllocations(ctx.institutionId), [{ amountCents: 600_000 }])
  })

  test('DOM-FIN-068: bağış iptali ile atama yarışında bakiye eksiye düşmez (K-97)', async () => {
    const { ctx, fundId, awards, donation } = await setup(600_000)
    const awardId = awards[0] ?? ''
    const settled = await race(ctx, [
      () =>
        allocateFromScholarshipFundCommand(ctx, fundId, { awardId, amountCents: 600_000 }, keyed()),
      () =>
        cancelScholarshipFundDonationCommand(
          ctx,
          fundId,
          donation.id,
          { reason: 'Mükerrer giriş düzeltmesi' },
          donation.version,
          keyed(),
        ),
    ])
    const winner = settled.findIndex((item) => item.status === 'fulfilled')
    assertOneRejected(
      settled,
      winner === 0 ? 'scholarship_fund_donation_in_use' : 'scholarship_fund_insufficient',
    )
    const allocated = (await activeAllocations(ctx.institutionId)).reduce(
      (total, row) => total + row.amountCents,
      0,
    )
    const [donated] = await db
      .select({
        total:
          sql<number>`coalesce(sum(${scholarshipFundDonations.amountCents}), 0)::bigint`.mapWith(
            Number,
          ),
      })
      .from(scholarshipFundDonations)
      .where(
        and(
          eq(scholarshipFundDonations.institutionId, ctx.institutionId),
          isNull(scholarshipFundDonations.cancelledAt),
        ),
      )
    assert.ok((donated?.total ?? 0) - allocated >= 0)
  })

  test('DOM-FIN-068, K-117: burs arşivi ile fondan atama yarışında arşivli bursa geçerli atama kalmaz', async () => {
    for (const archiveFirst of [true, false]) {
      const { ctx, fundId, awards } = await setup(1_000_000)
      const awardId = awards[0] ?? ''
      // Ayrılış komutunun yazma adımı: kurum kilidi altında arşiv ve fon payının bırakılması.
      const archive = async (): Promise<CommandResponse> => {
        await db.transaction(async (tx) => {
          await lockInstitution(tx, ctx.institutionId)
          await archiveCancelledRenewalAwards(tx, { ...ctx, db: tx }, 'test-s1', [2026])
        })
        return { statusCode: 200, body: null, replayed: false } as CommandResponse
      }
      const allocate = () =>
        allocateFromScholarshipFundCommand(ctx, fundId, { awardId, amountCents: 600_000 }, keyed())
      const settled = await race(ctx, archiveFirst ? [archive, allocate] : [allocate, archive])
      const [award] = await db
        .select({ archivedAt: scholarshipAwards.archivedAt })
        .from(scholarshipAwards)
        .where(
          and(
            eq(scholarshipAwards.institutionId, ctx.institutionId),
            eq(scholarshipAwards.id, awardId),
          ),
        )
      assert.notEqual(award?.archivedAt, null)
      // Hangi istek önce kilidi alırsa alsın arşivli bursun geçerli ataması yoktur ve bakiye tamdır.
      assert.deepEqual(await activeAllocations(ctx.institutionId), [])
      const failed = settled.filter((item) => item.status === 'rejected')
      assert.ok(failed.length <= 1)
      if (failed[0]?.status === 'rejected')
        assert.ok(
          failed[0].reason instanceof AppError && failed[0].reason.statusCode === 404,
          String(failed[0].reason),
        )
    }
  })
})
