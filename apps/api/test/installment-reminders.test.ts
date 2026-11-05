import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { installmentRemindersJob } from '../src/jobs/installment-reminders.ts'
import type { JobDeps } from '../src/jobs/types.ts'
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
import { checkFinanceMirrorAfterEach } from './support/finance-mirror.ts'
import { tempStorage } from './support/files-sample.ts'

/**
 * Vade ve gecikme taraması (ON-026; IST-109; docs/domain/finans.md DOM-FIN-034, DOM-FIN-035). İş
 * doğrudan sabit `now` ile koşulur (`JOBS_ENABLED` testte kapalı). FIXED_NOW 2026-10-06 09:00Z
 * (İstanbul 12:00). Her test kendi kurumunu kurar: 7-A, iki öğrenci. Görünürlük bildirim listesi
 * ucundan doğrulanır.
 */

type Json = ReturnType<typeof JSON.parse>
const SEED = createSeed(FIXED_NOW)
const [STUDENT, OTHER] = SEED.students.filter((item) => item.classId === 'c1')
const SID = STUDENT?.id ?? ''
const DAY = 86_400_000
const at = (days: number) => new Date(FIXED_NOW.getTime() + days * DAY)
const invoice = (id: string, dueDate: Date | string, extra: Record<string, unknown> = {}) => ({
  id,
  studentId: SID,
  installment: 1,
  amount: 10_000,
  dueDate: typeof dueDate === 'string' ? dueDate : dueDate.toISOString(),
  paidAt: null,
  method: null,
  reminderAt: null,
  ...extra,
})
const subjectOf = (row: Record<string, unknown>) => (row.subject as { id: string }).id
const guardianTitle = `${STUDENT?.name.split(' ')[0] ?? ''} için taksit vadesi yaklaşıyor.`

describe('vade ve gecikme taraması', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let deps: JobDeps
  let store: Awaited<ReturnType<typeof tempStorage>>
  let serial = 0
  const logs: string[] = []
  const key = () => `test-remind-${String(++serial).padStart(5, '0')}`
  // ON-046e: her testten sonra taksit ve sözleşme aynası kaynakla aynıdır.
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    assert.ok(STUDENT)
    assert.ok(OTHER)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { logs, clock: () => FIXED_NOW })
    store = await tempStorage()
    deps = { db, storage: store.storage, log: app.log }
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  async function institution(
    invoices: Record<string, unknown>[] = [],
    overrides: Partial<InstitutionOverrides> = {},
  ) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      [
        ...SEED.classes
          .filter((item) => item.id === 'c1')
          .map((data) => ({ collection: 'classes' as const, id: data.id, data: { ...data } })),
        ...[STUDENT, OTHER].flatMap((data) =>
          data ? [{ collection: 'students' as const, id: data.id, data: { ...data } }] : [],
        ),
        ...invoices.map((data) => ({
          collection: 'invoices' as const,
          id: String(data.id),
          data,
        })),
      ],
      FIXED_NOW,
    )
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }
  async function member(institutionId: string, role: Role, recordId = SID) {
    const links = [
      role === 'ogrenci'
        ? ({ kind: 'student', recordId } as const)
        : ({ kind: 'child', recordId } as const),
    ]
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }
  const run = (institutionId: string, now = FIXED_NOW) =>
    installmentRemindersJob.run(deps, { institutionId }, now)
  async function seen(cookie: string) {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { origin: TEST_ORIGIN, cookie },
    })
    assert.equal(response.statusCode, 200, response.body)
    return (response.json().data as Json[]).map((item) => ({
      kind: item.kind as string,
      subjectId: item.subject.id as string,
      title: item.title as string,
    }))
  }
  const stored = async (institutionId: string) =>
    (await loadRecords(db, institutionId, ['notifications'])).map((row) => row.data)
  async function setBond(adminCookie: string, membershipId: string, body: Record<string, unknown>) {
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/students/${SID}/guardians`,
      headers: { origin: TEST_ORIGIN, cookie: adminCookie },
    })
    assert.equal(list.statusCode, 200, list.body)
    const bond = (list.json().data as Json[]).find((item) => item.membershipId === membershipId)
    assert.ok(bond)
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/students/${SID}/guardians/${String(bond.id)}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie: adminCookie,
        'content-type': 'application/json',
        'if-match': `"${String(bond.rowVersion)}"`,
      },
      payload: JSON.stringify(body),
    })
    assert.equal(response.statusCode, 200, response.body)
  }

  test('IST-109: vadesi yaklaşan ve geçen taksit veliye yazılır; pencere dışı ve ödenmiş taksit yazılmaz', async () => {
    const a = await institution([
      invoice('soon', at(2)),
      invoice('late', at(-1)),
      invoice('far', at(30)),
      invoice('paid', at(-1), { paidAt: at(-2).toISOString(), method: 'Banka havalesi' }),
    ])
    const parent = await member(a.id, 'veli')
    const learner = await member(a.id, 'ogrenci')
    const from = logs.length

    assert.deepEqual(await run(a.id), {
      invoices: 2,
      reminded: 2,
      created: 2,
      deduplicated: 0,
      skipped: null,
    })

    const firstName = STUDENT?.name.split(' ')[0]
    assert.deepEqual(
      (await seen(parent.cookie)).sort((x, y) => x.subjectId.localeCompare(y.subjectId)),
      [
        {
          kind: 'installment_overdue',
          subjectId: 'late',
          title: `${firstName} için taksit vadesi geçti.`,
        },
        {
          kind: 'installment_due',
          subjectId: 'soon',
          title: `${firstName} için taksit vadesi yaklaşıyor.`,
        },
      ],
    )
    // Okuldaki öğrenciye değil, veliye gider (18 yaş altı).
    assert.deepEqual(await seen(learner.cookie), [])

    // DOM-ILT-023: kayıtta tutar ve vade yok; log öğrenci kimliği taşımaz; denetim aktörsüzdür.
    const rows = await stored(a.id)
    assert.equal(rows.length, 2)
    for (const row of rows)
      assert.deepEqual(Object.keys(row).sort(), [
        'audience',
        'createdAt',
        'id',
        'kind',
        'studentId',
        'subject',
      ])
    assert.ok(
      !logs
        .slice(from, logs.length)
        .some((line) => line.includes('notification.created') && line.includes(SID)),
    )
    const audits = await db
      .select({ actor: auditLog.actorUserId })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'notification.create')))
    assert.deepEqual(
      audits.map((row) => row.actor),
      [null, null],
    )
  })

  test('DOM-FIN-035: aynı taksit için günde en çok bir hatırlatma; ikinci çalıştırma ve sonraki günler yinelemez, vade geçince gecikme bir kez yazılır', async () => {
    const a = await institution([invoice('one', at(1))])
    const parent = await member(a.id, 'veli')

    assert.equal((await run(a.id)).created, 1)
    const again = await run(a.id)
    assert.deepEqual([again.created, again.deduplicated, again.reminded], [0, 1, 0])
    // Ertesi gün (vade günü) hâlâ aynı olay.
    assert.equal((await run(a.id, at(1))).created, 0)
    assert.deepEqual(
      (await seen(parent.cookie)).map((item) => item.kind),
      ['installment_due'],
    )
    // Vade geçti: tek gecikme bildirimi, sonraki günlerde yinelenmez.
    assert.equal((await run(a.id, at(2))).created, 1)
    assert.equal((await run(a.id, at(2))).created, 0)
    assert.equal((await run(a.id, at(9))).created, 0)
    assert.deepEqual((await seen(parent.cookie)).map((item) => item.kind).sort(), [
      'installment_due',
      'installment_overdue',
    ])
    assert.equal((await stored(a.id)).length, 2)
  })

  test('IST-109: kısmi ödeme taksiti açık bırakır; tam ödenen taksite hatırlatma gitmez, iptal edilen tahsilat yeniden açar', async () => {
    const a = await institution([invoice('full', at(1)), invoice('part', at(2))])
    // Eski vade önce: 15.000 kuruş `full`u kapatır, `part`a 5.000 yazar.
    const paid = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: {
        origin: TEST_ORIGIN,
        cookie: a.adminCookie,
        'content-type': 'application/json',
        'idempotency-key': key(),
      },
      payload: JSON.stringify({
        studentId: SID,
        amountCents: 15_000,
        method: 'Banka havalesi',
        reference: 'TR-REM-1',
      }),
    })
    assert.equal(paid.statusCode, 201, paid.body)
    const reminded = async () =>
      (await stored(a.id))
        .filter((row) => String(row.kind).startsWith('installment_'))
        .map(subjectOf)
        .sort()

    assert.equal((await run(a.id)).created, 1)
    assert.deepEqual(await reminded(), ['part'])

    // İptal `full`u yeniden açar; `part` için yazılmış bildirim yinelenmez.
    const { id, version } = paid.json().data
    const reversed = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${String(id)}/reverse`,
      headers: {
        origin: TEST_ORIGIN,
        cookie: a.adminCookie,
        'content-type': 'application/json',
        'idempotency-key': key(),
        'if-match': `"${String(version)}"`,
      },
      payload: JSON.stringify({ reason: 'Yanlış öğrenciye girildi' }),
    })
    assert.equal(reversed.statusCode, 200, reversed.body)
    const next = await run(a.id)
    assert.deepEqual([next.created, next.deduplicated], [1, 1])
    assert.deepEqual(await reminded(), ['full', 'part'])
  })

  test('DOM-YTK-040: finans ya da iletişim modülü kapalıysa okunmaz ve yazılmaz', async () => {
    for (const closed of ['finance', 'communication']) {
      const a = await institution([invoice('one', at(1))], {
        enabledModules: { [closed]: false },
      })
      assert.deepEqual(await run(a.id), {
        invoices: 0,
        reminded: 0,
        created: 0,
        deduplicated: 0,
        skipped: 'module_disabled',
      })
      assert.deepEqual(await stored(a.id), [])
    }
  })

  test('DOM-YTK-001: tarama yalnız verilen kurumu yazar; kurumda olmayan öğrencinin taksiti atlanır', async () => {
    const a = await institution([
      invoice('own', at(1)),
      invoice('foreign', at(1), { studentId: 'baska-kurumun-ogrencisi' }),
    ])
    const b = await institution([invoice('theirs', at(1))])
    const parentB = await member(b.id, 'veli')

    const result = await run(a.id)
    assert.deepEqual([result.invoices, result.created], [1, 1])
    assert.deepEqual((await stored(a.id)).map(subjectOf), ['own'])
    assert.deepEqual(await stored(b.id), [])
    assert.deepEqual(await seen(parentB.cookie), [])
    assert.equal((await run('olmayan-kurum')).skipped, 'institution_missing')
  })

  test('IST-109: işlem başarısızsa hiçbir bildirim kalmaz; yeniden çalıştırma tamamlar', async () => {
    const a = await institution([invoice('one', at(1)), invoice('two', at(2))])
    await db.execute(sql`
      create function test_fail_reminder_audit() returns trigger language plpgsql as $$
      begin raise exception 'test failure'; end $$`)
    await db.execute(
      sql.raw(`
      create trigger test_fail_reminder_audit before insert on audit_log for each row
      when (new.action = 'notification.create' and new.institution_id = '${a.id}'
            and new.entity_id = 'two')
      execute function test_fail_reminder_audit()`),
    )
    try {
      await assert.rejects(run(a.id))
      assert.deepEqual(await stored(a.id), [])
    } finally {
      await db.execute(sql`drop trigger test_fail_reminder_audit on audit_log`)
      await db.execute(sql`drop function test_fail_reminder_audit()`)
    }
    assert.equal((await run(a.id)).created, 2)
  })

  test('DOM-ILT-074: iletişim kısıtlı veli bildirim görmez; velayetli ödeyici tek bildirim görür; ödeyici olmayan velayetli veli de görür', async () => {
    const a = await institution([invoice('one', at(1))])
    const payer = await member(a.id, 'veli')
    const custodial = await member(a.id, 'veli')
    const restricted = await member(a.id, 'veli')
    await setBond(a.adminCookie, payer.membershipId, { isPayer: true })
    await setBond(a.adminCookie, restricted.membershipId, {
      custody: 'none',
      contactRestricted: true,
    })

    assert.equal((await run(a.id)).created, 1)
    // Velayet ve ödeyici bağı aynı bildirimi açar; ikinci kopya yazılmaz ve listelenmez.
    assert.deepEqual(await seen(payer.cookie), [
      { kind: 'installment_due', subjectId: 'one', title: guardianTitle },
    ])
    assert.deepEqual(await seen(restricted.cookie), [])
    assert.equal((await seen(custodial.cookie)).length, 1)
  })

  test('DOM-ILT-074 K-04: velayeti olmayan ödeyici veli finans bildirimini görür; iletişim kısıtlı veli görmez', async () => {
    const a = await institution([invoice('one', at(1))])
    const keeper = await member(a.id, 'veli')
    const payer = await member(a.id, 'veli')
    const restricted = await member(a.id, 'veli')
    await setBond(a.adminCookie, payer.membershipId, { custody: 'none', isPayer: true })
    // İletişim kısıtlı veli ödeyici olamaz (`guardian_restricted_payer`); kısıtlı veli hiç almaz.
    await setBond(a.adminCookie, restricted.membershipId, {
      custody: 'none',
      contactRestricted: true,
    })
    assert.equal((await run(a.id)).created, 1)
    assert.deepEqual(await seen(payer.cookie), [
      { kind: 'installment_due', subjectId: 'one', title: guardianTitle },
    ])
    assert.deepEqual(await seen(restricted.cookie), [])
    assert.equal((await seen(keeper.cookie)).length, 1)
  })

  test('DOM-FIN-052: yetişkin kursiyerin hatırlatması kendisine gider, veliye gitmez', async () => {
    const a = await institution([invoice('one', at(1))], { type: 'language_school' })
    await insertMissingRecords(
      db,
      a.id,
      [{ collection: 'prospects', id: 'p-1', data: { id: 'p-1', studentId: SID, minor: false } }],
      FIXED_NOW,
    )
    const parent = await member(a.id, 'veli')
    const learner = await member(a.id, 'ogrenci')
    assert.equal((await run(a.id)).created, 1)
    assert.deepEqual(await seen(parent.cookie), [])
    assert.deepEqual(await seen(learner.cookie), [
      { kind: 'installment_due', subjectId: 'one', title: 'Taksit vaden yaklaşıyor.' },
    ])
  })

  test('IST-109: arşivlenmiş öğrencinin taksiti taranmaz; pasif öğrencinin kalan borcu taranır', async () => {
    const a = await institution([
      invoice('archived', at(-1)),
      invoice('passive', at(-1), { studentId: OTHER?.id }),
    ])
    await db.execute(sql`
      update records set archived_at = now()
      where institution_id = ${a.id} and collection = 'students' and id = ${SID}`)
    await db.execute(sql`
      update records set data = jsonb_set(data, '{isActive}', 'false')
      where institution_id = ${a.id} and collection = 'students' and id = ${OTHER?.id ?? ''}`)
    assert.equal((await run(a.id)).created, 1)
    assert.deepEqual((await stored(a.id)).map(subjectOf), ['passive'])
  })

  test('IST-109: biçimi bozuk taksit taramayı durdurmaz, kimlik loglanmaz', async () => {
    const a = await institution([invoice('bad', 'dün'), invoice('good', at(1))])
    const from = logs.length
    const result = await run(a.id)
    assert.deepEqual([result.invoices, result.created], [1, 1])
    assert.deepEqual((await stored(a.id)).map(subjectOf), ['good'])
    const lines = logs.slice(from).join('')
    assert.ok(lines.includes('installment_reminder.invalid_invoice'))
    assert.ok(!lines.includes(`"${SID}"`))
  })

  test('DOM-ILT-021: sessiz saatte iş okumaz ve yazmaz; 08:00 ile 20:59 arası çalışır', async () => {
    const a = await institution([invoice('one', at(1))])
    // İstanbul = UTC+3. 04:59Z 07:59, 18:00Z 21:00.
    for (const night of ['2026-10-06T04:59:00.000Z', '2026-10-06T18:00:00.000Z']) {
      const result = await run(a.id, new Date(night))
      assert.equal(result.skipped, 'quiet_hours', night)
      assert.deepEqual(await stored(a.id), [])
    }
    const morning = await run(a.id, new Date('2026-10-06T05:00:00.000Z'))
    assert.deepEqual([morning.skipped, morning.created], [null, 1])
  })

  test('iş tanımı: kuyruk adı ve beş alanlı cron; dilim saatten kısa değil', () => {
    assert.match(installmentRemindersJob.name, /^[a-z][a-z0-9.-]+$/)
    assert.equal(installmentRemindersJob.cron.split(' ').length, 5)
    assert.ok(installmentRemindersJob.slotSeconds >= 3600)
  })
})
