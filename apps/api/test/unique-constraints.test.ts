import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'

import { eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { coordinatorDuties } from '../src/db/schema/coordinator-duties.ts'
import { classify, readAreaMap } from '../../../.claude/hooks/alan-koruma.ts'
import {
  AppError,
  mapDatabaseError,
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
 * 409 `conflict`, iş anlamı taşıyan tekillik 409 ve kendi kodu, tabloda olmayan kısıt eski
 * davranışla 409 `conflict` ve `warn` logu. Envanter testi migration'lardan sonraki tekil
 * indekslerden, şema dosyası sınıf tablosunun sahibine ait tabloların kısıtlarını zorunlu tutar;
 * öteki sahibin (Onur) kısıtları tabloda olabilir ama zorunlu değildir.
 */

/** Drizzle sürücü hatasını `cause`'a sarar; eşleme zinciri izler. */
const wrapped = (code: string, constraint?: string) =>
  new Error('Failed query', {
    cause: Object.assign(new Error('pg'), { code, ...(constraint ? { constraint } : {}) }),
  })

const entries = Object.entries(UNIQUE_CONSTRAINTS) as [string, UniqueConstraintClass][]

const TABLE_FILE = 'apps/api/src/unique-constraints.ts'
const SCHEMA_DIR = 'apps/api/src/db/schema'
const areaMap = readAreaMap()

/** Dosyanın sahibi (`alan-koruma` sınıflaması); ortak dosya `shared`. */
function ownerOf(path: string): string {
  const area = classify(path, areaMap)
  return area.kind === 'owner' ? area.owner : 'shared'
}

/** Sınıf tablosunu yalnız sahibi yazabilir; onun şema dosyalarındaki kısıtlar zorunludur. */
const TABLE_OWNER = ownerOf(TABLE_FILE)

/** Tablo adı → onu tanımlayan şema dosyası (`pgTable('<ad>'`). */
function schemaFiles(): Map<string, string> {
  const files = new Map<string, string>()
  const folder = new URL('../src/db/schema/', import.meta.url)
  for (const name of readdirSync(folder).filter((file) => file.endsWith('.ts'))) {
    const source = readFileSync(new URL(name, folder), 'utf8')
    for (const match of source.matchAll(/pgTable\(\s*'([a-z0-9_]+)'/g))
      files.set(match[1]!, `${SCHEMA_DIR}/${name}`)
  }
  return files
}

interface CatalogIndex {
  name: string
  table: string
}

/**
 * Envanter farkı. `missing`: sahibin tablosunda olup sınıflanmamış kısıt (dosyası bilinmeyen
 * tablo da zorunludur); `stale`: veritabanında olmayan, sahibin listelediği kısıt; `foreign`:
 * öteki sahibin tablosunda olup `ONUR_RETRY` dışında sınıflanmış kısıt.
 */
function inventory(indexes: readonly CatalogIndex[], files: ReadonlyMap<string, string>) {
  const fileOf = (table: string) => files.get(table)
  const required = (table: string) => {
    const file = fileOf(table)
    return file === undefined || ownerOf(file) === TABLE_OWNER
  }
  const missing = indexes
    .filter((index) => required(index.table) && !Object.hasOwn(UNIQUE_CONSTRAINTS, index.name))
    .map(
      (index) =>
        `${index.name} (tablo ${index.table}, şema ${fileOf(index.table) ?? 'bulunamadı'}) → ${TABLE_FILE} UNIQUE_CONSTRAINTS`,
    )
  const names = new Set(indexes.map((index) => index.name))
  const stale = entries
    .filter(([name, entry]) => !names.has(name) && !(entry.kind === 'retry' && entry.owner))
    .map(([name]) => name)
  const foreign = indexes
    .filter((index) => !required(index.table) && Object.hasOwn(UNIQUE_CONSTRAINTS, index.name))
    .filter((index) => {
      const entry = UNIQUE_CONSTRAINTS[index.name as keyof typeof UNIQUE_CONSTRAINTS]
      return !(entry.kind === 'retry' && 'owner' in entry && entry.owner === 'onur')
    })
    .map((index) => index.name)
  return { missing, stale, foreign }
}

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

  test('OG-279: tabloda olmayan tekillik ihlali eski davranışla 409 conflict ve kısıt adını taşır', () => {
    const unknown = mapDatabaseError(wrapped('23505', 'yeni_tablo_ad_key'))
    assert.ok(unknown instanceof UnclassifiedUniqueViolationError)
    assert.ok(unknown instanceof TransientConflictError)
    assert.deepEqual(
      [unknown.statusCode, unknown.code, unknown.constraint],
      [409, 'conflict', 'yeni_tablo_ad_key'],
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

  async function catalog(): Promise<CatalogIndex[]> {
    const { rows } = (await db.execute(sql`
      select index.relname as name, tbl.relname as "table"
      from pg_index
      join pg_class index on index.oid = pg_index.indexrelid
      join pg_class tbl on tbl.oid = pg_index.indrelid
      join pg_namespace namespace on namespace.oid = index.relnamespace
      where pg_index.indisunique and namespace.nspname = 'public'
      order by 1`)) as unknown as { rows: CatalogIndex[] }
    return rows
  }

  test(`OG-279: migration sonrası ${TABLE_OWNER} tablolarının her tekil indeksi sınıf tablosunda, tabloda fazlası yok`, async () => {
    const indexes = await catalog()
    const files = schemaFiles()
    assert.ok(indexes.length > 100 && files.size > 50)
    const { missing, stale, foreign } = inventory(indexes, files)
    assert.deepEqual(
      missing,
      [],
      `Sınıflanmamış tekillik kısıtı; sınıfıyla (retry ya da rule) ekleyin:\n${missing.join('\n')}`,
    )
    assert.deepEqual(stale, [], `Veritabanında olmayan kısıt; tablodan silin: ${stale.join(', ')}`)
    assert.deepEqual(
      foreign,
      [],
      `Öteki sahibin kısıtı yalnız ONUR_RETRY ile listelenir: ${foreign.join(', ')}`,
    )
    // Onur'un listelenmiş kısıtları gerçekten Onur'un şema dosyalarındadır.
    const onur = entries.filter(([, entry]) => entry.kind === 'retry' && entry.owner === 'onur')
    assert.ok(onur.length > 0)
    const tableOf = new Map(indexes.map((index) => [index.name, index.table]))
    for (const [name] of onur) {
      const table = tableOf.get(name)
      if (table === undefined) continue
      assert.equal(ownerOf(files.get(table) ?? ''), 'onur', name)
    }
  })

  test("OG-279: Onur'un tablosuna eklenen sınıflanmamış kısıt envanteri kırmızı yapmaz, Oğuzhan'ınki yapar", async () => {
    const files = schemaFiles()
    const indexes = [
      ...(await catalog()),
      { name: 'payments_yeni_key', table: 'payments' },
      { name: 'coordinator_duties_yeni_key', table: 'coordinator_duties' },
      { name: 'yeni_tablo_key', table: 'yeni_tablo' },
    ]
    assert.equal(ownerOf(files.get('payments')!), 'onur')
    assert.deepEqual(inventory(indexes, files).missing, [
      `coordinator_duties_yeni_key (tablo coordinator_duties, şema ${SCHEMA_DIR}/coordinator-duties.ts) → ${TABLE_FILE} UNIQUE_CONSTRAINTS`,
      `yeni_tablo_key (tablo yeni_tablo, şema bulunamadı) → ${TABLE_FILE} UNIQUE_CONSTRAINTS`,
    ])
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

  test('OG-279: tabloda olmayan kısıt uçta eski davranışla 409 conflict olur, kısıt adıyla warn loglanır, kayıt değişmez', async () => {
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
        assert.equal(second.statusCode, 409, second.body)
        assert.equal(second.json().code, 'conflict', second.body)
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
