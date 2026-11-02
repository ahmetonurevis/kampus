import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { coordinatorDuties } from '../src/db/schema/coordinator-duties.ts'
import {
  AppError,
  mapDatabaseError,
  MESSAGES,
  RuleViolationError,
  TransientConflictError,
  UnclassifiedUniqueViolationError,
} from '../src/errors.ts'
import { UNIQUE_CONSTRAINTS, type UniqueConstraintClass } from '../src/unique-constraints.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'

/**
 * Tekillik ihlalinin (23505) kısıt adına göre sınıflanması (OG-279): yeniden denenebilir yarış
 * 409 `conflict`, iş anlamı taşıyan tekillik 409 ve core kodu, tabloda olmayan kısıt 422
 * `duplicate_record` ve `warn` logu. Envanter testi migration'lardan sonraki bütün tekil
 * indekslerin tabloda olduğunu denetler.
 */

/** Drizzle sürücü hatasını `cause`'a sarar; eşleme zinciri izler. */
const wrapped = (code: string, constraint?: string) =>
  new Error('Failed query', {
    cause: Object.assign(new Error('pg'), { code, ...(constraint ? { constraint } : {}) }),
  })

const entries = Object.entries(UNIQUE_CONSTRAINTS) as [string, UniqueConstraintClass][]

/** Onur'un tabloları (kayıt ve finans); kısıtları davranış değişmeden `retry` kalır. */
const ONUR_TABLES = [
  'student_identities',
  'fee_tariffs',
  'payments',
  'payment_allocations',
  'payment_settings',
  'bank_accounts',
  'student_withdrawals',
  'scholarship_programs',
  'scholarship_awards',
]

describe('tekillik kısıtı eşlemesi (birim)', () => {
  test('OG-279: bilinen yarış kısıtı 409 conflict (yeniden denenebilir)', () => {
    for (const constraint of ['idempotency_keys_pkey', 'records_pkey', 'sessions_token_unique']) {
      const mapped = mapDatabaseError(wrapped('23505', constraint))
      assert.ok(mapped instanceof TransientConflictError, constraint)
      assert.deepEqual([mapped.statusCode, mapped.code], [409, 'conflict'])
    }
  })

  test("OG-279: Onur'un kısıtları davranış değişmeden 409 conflict", () => {
    for (const constraint of ['payments_receipt_key', 'student_identities_number_key']) {
      const mapped = mapDatabaseError(wrapped('23505', constraint))
      assert.ok(mapped instanceof TransientConflictError, constraint)
      assert.deepEqual([mapped.statusCode, mapped.code], [409, 'conflict'])
    }
    const onur = entries.filter(([name]) => ONUR_TABLES.some((table) => name.startsWith(table)))
    assert.ok(onur.length > 0)
    for (const [name, entry] of onur)
      assert.deepEqual(entry, { kind: 'retry', owner: 'onur' }, name)
  })

  test('OG-279, DOM-YTK-027: bilinen kural kısıtı 409 ve kendi kodu, Türkçe ileti', () => {
    const mapped = mapDatabaseError(
      wrapped('23505', 'coordinator_duties_membership_kind_scope_key'),
    )
    assert.ok(mapped instanceof AppError)
    assert.ok(!(mapped instanceof TransientConflictError))
    assert.deepEqual(
      [mapped.statusCode, mapped.code, mapped.message],
      [409, 'coordinator_duty_exists', 'Bu görev öğretmene zaten verilmiş.'],
    )
    const year = mapDatabaseError(wrapped('23505', 'academic_years_active_key'))
    assert.ok(year instanceof AppError)
    assert.deepEqual([year.statusCode, year.code], [409, 'academic_year_active_exists'])
  })

  test('OG-279: kural sınıfının kodu snake_case, iletisi boş değil ve conflict değil', () => {
    for (const [name, entry] of entries) {
      if (entry.kind !== 'rule') continue
      assert.match(entry.code, /^[a-z]+(_[a-z]+)+$/, name)
      assert.notEqual(entry.code, 'conflict', name)
      assert.ok(entry.message.length > 0 && entry.message.endsWith('.'), name)
    }
  })

  test('OG-279: tabloda olmayan tekillik ihlali 422 duplicate_record ve kısıt adını taşır', () => {
    const unknown = mapDatabaseError(wrapped('23505', 'yeni_tablo_ad_key'))
    assert.ok(unknown instanceof UnclassifiedUniqueViolationError)
    assert.ok(unknown instanceof RuleViolationError)
    assert.deepEqual(
      [unknown.statusCode, unknown.code, unknown.message, unknown.constraint],
      [422, 'duplicate_record', MESSAGES.duplicate_record, 'yeni_tablo_ad_key'],
    )
    // Nesne prototipindeki adlar tabloda sayılmaz.
    const proto = mapDatabaseError(wrapped('23505', 'constructor'))
    assert.ok(proto instanceof UnclassifiedUniqueViolationError)
    const nameless = mapDatabaseError(wrapped('23505'))
    assert.ok(nameless instanceof UnclassifiedUniqueViolationError)
    assert.equal(nameless.constraint, undefined)
  })

  test('OG-279: kilitlenme, serileştirme ve boyut kısıtı eşlemesi değişmedi', () => {
    for (const code of ['40P01', '40001']) {
      const mapped = mapDatabaseError(wrapped(code))
      assert.ok(mapped instanceof TransientConflictError)
      assert.deepEqual([mapped.statusCode, mapped.code], [409, 'conflict'])
    }
    const size = mapDatabaseError(wrapped('23514', 'records_data_size_check'))
    assert.ok(size instanceof RuleViolationError)
    assert.deepEqual([size.statusCode, size.code], [422, 'record_too_large'])
    const app = new AppError(409, 'open_version_exists', 'x')
    assert.equal(mapDatabaseError(app), app)
  })
})

describe('tekillik kısıtı envanteri ve uç davranışı', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  const logs: string[] = []

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { logs })
  })
  after(async () => {
    await app.close()
    await close()
  })

  test('OG-279: migration sonrası her tekil indeks ve kısıt sınıf tablosunda, tabloda fazlası yok', async () => {
    const { rows } = (await db.execute(sql`
      select index.relname as name
      from pg_index
      join pg_class index on index.oid = pg_index.indexrelid
      join pg_namespace namespace on namespace.oid = index.relnamespace
      where pg_index.indisunique and namespace.nspname = 'public'
      order by 1`)) as unknown as { rows: { name: string }[] }
    const inDatabase = rows.map((row) => row.name)
    const classified = Object.keys(UNIQUE_CONSTRAINTS).sort()
    const missing = inDatabase.filter((name) => !Object.hasOwn(UNIQUE_CONSTRAINTS, name))
    assert.deepEqual(
      missing,
      [],
      `Sınıflanmamış tekillik kısıtı: ${missing.join(', ')}. src/unique-constraints.ts tablosuna sınıfıyla ekleyin.`,
    )
    const stale = classified.filter((name) => !inDatabase.includes(name))
    assert.deepEqual(stale, [], `Veritabanında olmayan kısıt: ${stale.join(', ')}`)
  })

  async function languageSchool() {
    const institution = await createInstitution(app, { type: 'language_school' })
    const cookie = await signInAs(app, institution.admin)
    const teachers = [
      await createMember(app, institution.id, 'ogretmen'),
      await createMember(app, institution.id, 'ogretmen'),
    ]
    const assign = (membershipId: string, scopeId: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/coordinator-duties',
        headers: {
          cookie,
          origin: TEST_ORIGIN,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        payload: JSON.stringify({ membershipId, scopeId }),
      })
    const rows = async () =>
      (
        await db
          .select()
          .from(coordinatorDuties)
          .where(eq(coordinatorDuties.institutionId, institution.id))
      ).map((row) => [row.membershipId, row.scopeId, row.version])
    const audits = async () =>
      (await db.select().from(auditLog).where(eq(auditLog.institutionId, institution.id))).length
    return { institution, teachers, assign, rows, audits }
  }

  /** Kısıtı test süresince değiştirir; core denetimini aşan ihlal ancak böyle üretilebilir. */
  async function withIndex(change: string[], restore: string[], work: () => Promise<void>) {
    for (const statement of change) await db.execute(sql.raw(statement))
    try {
      await work()
    } finally {
      for (const statement of restore) await db.execute(sql.raw(statement))
    }
  }

  test('OG-279, DOM-YTK-027: core denetimini aşan kural ihlali uçta 409 coordinator_duty_exists döner, kayıt değişmez', async () => {
    const t = await languageSchool()
    const [head] = t.teachers
    // Kısıt aynı adla genişletilir (üyelik × görev türü): core farklı seviyeyi ihlal saymaz.
    await withIndex(
      [
        'drop index coordinator_duties_membership_kind_scope_key',
        `create unique index coordinator_duties_membership_kind_scope_key on coordinator_duties
           (institution_id, membership_id, kind) where archived_at is null`,
      ],
      [
        'drop index coordinator_duties_membership_kind_scope_key',
        `create unique index coordinator_duties_membership_kind_scope_key on coordinator_duties
           (institution_id, membership_id, kind, scope_id) where archived_at is null`,
      ],
      async () => {
        const first = await t.assign(head!.membershipId, 'B1')
        assert.equal(first.statusCode, 201, first.body)
        const before = [await t.rows(), await t.audits()]
        const second = await t.assign(head!.membershipId, 'B2')
        assert.equal(second.statusCode, 409, second.body)
        assert.deepEqual(
          [second.json().code, second.json().message],
          ['coordinator_duty_exists', 'Bu görev öğretmene zaten verilmiş.'],
        )
        assert.deepEqual([await t.rows(), await t.audits()], before)
      },
    )
  })

  test('OG-279: tabloda olmayan kısıt uçta 422 duplicate_record olur, kısıt adıyla warn loglanır, kayıt değişmez', async () => {
    const t = await languageSchool()
    const [head, other] = t.teachers
    await withIndex(
      [
        `create unique index test_coordinator_duties_scope_key on coordinator_duties
           (institution_id, scope_id) where archived_at is null`,
      ],
      ['drop index test_coordinator_duties_scope_key'],
      async () => {
        const first = await t.assign(head!.membershipId, 'A2')
        assert.equal(first.statusCode, 201, first.body)
        const before = [await t.rows(), await t.audits()]
        logs.length = 0
        const second = await t.assign(other!.membershipId, 'A2')
        assert.equal(second.statusCode, 422, second.body)
        assert.deepEqual(
          [second.json().code, second.json().message],
          ['duplicate_record', MESSAGES.duplicate_record],
        )
        assert.doesNotMatch(second.body, /test_coordinator|23505|unique/i)
        assert.deepEqual([await t.rows(), await t.audits()], before)
        const warned = logs
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .filter((line) => line.event === 'db.unclassified_unique_violation')
        assert.equal(warned.length, 1)
        assert.equal(warned[0]!.level, 40)
        assert.equal(warned[0]!.constraint, 'test_coordinator_duties_scope_key')
        // Değer (pg `detail`) ve kişisel veri loga girmez.
        const raw = logs.join('\n')
        assert.doesNotMatch(raw, /Key \(|already exists/)
        assert.ok(!raw.includes(t.institution.admin.email))
      },
    )
  })
})
