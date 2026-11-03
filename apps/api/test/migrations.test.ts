import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import { asc, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

import { academicTermNameKey } from '@kampus/school-core/lib/academic-years.ts'

import { loadAcademicYears } from '../src/db/academic-years.ts'
import { MIGRATIONS_FOLDER, schema, type Database } from '../src/db/client.ts'
import { stateRecords, demoState } from '../src/db/demo-seed.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { academicYears } from '../src/db/schema/academic-years.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { records } from '../src/db/schema/records.ts'
import { studentGuardians } from '../src/db/schema/student-guardians.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  newPGlite,
} from './support/app.ts'
import { seedResource } from './support/resources-sample.ts'

/**
 * Her takım yeni bir bellek içi PostgreSQL açıp migration uygular; yüklü makinede (paralel test
 * süreçleri) bu birkaç saniye sürer. Süre sınırı takılan bir veritabanını sonsuza dek beklemek
 * yerine açık bir hata verir; takım başına normal koşu ~1–5 sn, yükte ~15 sn olduğundan sınır geniştir (OG-202).
 */
const SLOW = { timeout: 180_000 }

interface Journal {
  entries: { tag: string }[]
}

/** Yalnız `lastTag`'e kadarki migration'ları içeren geçici klasör: veri dönüştüren adımı sınamak için. */
async function migrationsUpTo(lastTag: string): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'kampus-migrations-'))
  const journal: Journal = JSON.parse(
    await readFile(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  )
  const last = journal.entries.findIndex((entry) => entry.tag === lastTag)
  assert.ok(last >= 0, `${lastTag} yok`)
  const entries = journal.entries.slice(0, last + 1)
  await mkdir(path.join(folder, 'meta'))
  await writeFile(
    path.join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries }),
  )
  for (const entry of entries)
    await copyFile(
      path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
      path.join(folder, `${entry.tag}.sql`),
    )
  return folder
}

type MigrationTarget = Parameters<typeof migrate>[0]

/**
 * Better Auth her okumada şemadaki bütün kolonları seçer. Sonraki migration'ların kimlik
 * tablolarına eklediği kolonlar (0046 `memberships.deactivated_at`, `invitations.name` ve
 * `invitations.membership_id`; 0048 `invitations.teacher_id`) eski şemada yoksa test uygulaması üye ya da davet açamaz; kolonlar
 * kısmi şemaya geçici eklenir ve kalan migration'lardan önce kaldırılır.
 */
async function migratePartial(db: MigrationTarget, folder: string): Promise<void> {
  await migrate(db, { migrationsFolder: folder })
  await db.execute(sql`alter table memberships add column if not exists deactivated_at timestamp`)
  await db.execute(
    sql`alter table invitations add column if not exists name text, add column if not exists membership_id text, add column if not exists teacher_id text`,
  )
}

async function migrateRest(db: MigrationTarget): Promise<void> {
  await db.execute(sql`alter table memberships drop column if exists deactivated_at`)
  await db.execute(
    sql`alter table invitations drop column if exists name, drop column if exists membership_id, drop column if exists teacher_id`,
  )
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
}

describe('veri dönüştüren migration’lar', SLOW, () => {
  const client = newPGlite()
  const pglite = drizzle({ client, schema })
  const db: Database = pglite
  let folder: string

  before(async () => {
    folder = await migrationsUpTo('0003_create_institution_settings')
    await migratePartial(pglite, folder)
  })
  after(async () => {
    await client.close()
    await rm(folder, { recursive: true, force: true })
  })

  test('0004–0005: mevcut sıra korunarak numaralanır; tohum sırayı veri ve sürüme dokunmadan core dizisine eşitler; core denetimi arşivlenir', async () => {
    const app = await buildTestApp(db)
    try {
      const { id } = await createInstitution(app, { academicYear: null })
      const items = stateRecords(demoState('akademi', FIXED_NOW)).filter(
        (item) => item.collection === 'students' || item.collection === 'invoices',
      )
      // Eski tohum: sıra kolonu yokken tek çok satırlı ekleme, core sırasında.
      for (let start = 0; start < items.length; start += 1000) {
        const values = items
          .slice(start, start + 1000)
          .map(
            (item) =>
              sql`(${id}, ${item.collection}, ${item.id}, ${JSON.stringify(item.data)}::jsonb, ${FIXED_NOW}, ${FIXED_NOW})`,
          )
        await db.execute(
          sql`insert into records (institution_id, collection, id, data, created_at, updated_at) values ${sql.join(values, sql`, `)}`,
        )
      }
      const updated = items.find((item) => item.collection === 'students')
      assert.ok(updated)
      await db.execute(
        sql`update records set data = data || '{"progress": 1}'::jsonb, version = version + 1 where institution_id = ${id} and collection = 'students' and id = ${updated.id}`,
      )

      // Eski sürümün yazdığı core denetim satırı (değerleri maskesiz).
      await db.execute(
        sql`insert into records (institution_id, collection, id, data, created_at, updated_at) values (${id}, 'audit', 'audit-legacy', '{"id": "audit-legacy"}'::jsonb, ${FIXED_NOW}, ${FIXED_NOW})`,
      )

      await migrateRest(pglite)

      // 0005: core denetim satırları arşivlenir ve yüklenmez.
      assert.deepEqual(await loadRecords(db, id, ['audit']), [])
      const [legacy] = await loadRecords(db, id, ['audit'], { includeArchived: true })
      assert.equal(legacy?.version, 2)
      assert.ok(legacy?.archivedAt)

      // Dolgu, sıra kolonundan önceki yükleme sırasını (kimlik) korur; core sırası SQL'de bilinmez.
      const coreOrder = (collection: string) =>
        items.filter((item) => item.collection === collection).map((item) => item.id)
      for (const collection of ['students', 'invoices'] as const)
        assert.deepEqual(
          (await loadRecords(db, id, [collection])).map((row) => row.id),
          coreOrder(collection).sort(),
        )

      // Tohumu yeniden çalıştırmak yalnız sırası bozuk satırı düzeltir; veri ve sürüm değişmez.
      const snapshot = () =>
        db
          .select()
          .from(records)
          .where(eq(records.institutionId, id))
          .orderBy(asc(records.collection), asc(records.id))
      const before = await snapshot()
      assert.equal(await insertMissingRecords(db, id, items, FIXED_NOW), 0)
      const afterSeed = await snapshot()
      for (const collection of ['students', 'invoices'] as const)
        assert.deepEqual(
          (await loadRecords(db, id, [collection])).map((row) => row.id),
          coreOrder(collection),
        )
      assert.deepEqual(
        afterSeed.map((row) => ({ ...row, position: 0 })),
        before.map((row) => ({ ...row, position: 0 })),
      )
      assert.equal(await insertMissingRecords(db, id, items, FIXED_NOW), 0)
      assert.deepEqual(await snapshot(), afterSeed)
    } finally {
      await app.close()
    }
  })
})

describe('0007: veli kimliği olmayan yazışmaların doldurulması', SLOW, () => {
  const client = newPGlite()
  const pglite = drizzle({ client, schema })
  const db: Database = pglite
  let folder: string

  before(async () => {
    folder = await migrationsUpTo('0006_create_idempotency_keys')
    await migratePartial(pglite, folder)
  })
  after(async () => {
    await client.close()
    await rm(folder, { recursive: true, force: true })
  })

  test('tek veli hesabı olan öğrencinin eski yazışması o hesapla dolar; iki veya sıfır hesapta boş kalır', async () => {
    const app = await buildTestApp(db)
    try {
      const { id } = await createInstitution(app, { academicYear: null })
      // Bağlantı SQL ile: `ensureMembershipLinks` 0027'nin veli bağı tablosuna da yazar, o tablo
      // bu sürümde yok.
      const parent = async (studentId: string) => {
        const member = await createMember(app, id, 'veli')
        await db.execute(
          sql`insert into membership_links (institution_id, membership_id, kind, record_id) values (${id}, ${member.membershipId}, 'child', ${studentId})`,
        )
        return member
      }
      const only = await parent('s1')
      await parent('s2')
      await parent('s2')
      const conversation = (key: string, studentId: string, extra: Record<string, unknown>) => ({
        id: key,
        data: { id: key, studentId, teacherId: 't1', audience: 'parent', messages: [], ...extra },
      })
      const rows = [
        conversation('conv-tek', 's1', {}),
        conversation('conv-iki', 's2', {}),
        conversation('conv-yok', 's3', {}),
        conversation('conv-dolu', 's1', { parentUserId: 'u-baska' }),
        conversation('conv-ogrenci', 's1', { audience: 'student' }),
      ]
      for (const row of rows)
        await db.execute(
          sql`insert into records (institution_id, collection, id, data, position, created_at, updated_at) values (${id}, 'conversations', ${row.id}, ${JSON.stringify(row.data)}::jsonb, 1024, ${FIXED_NOW}, ${FIXED_NOW})`,
        )

      // Yalnız 0007; 0009 gömülü mesaj dizisini kaldırıp sürümü artırır (ayrı test).
      const upTo0007 = await migrationsUpTo('0007_backfill_conversation_parent_user')
      try {
        await migrate(pglite, { migrationsFolder: upTo0007 })
      } finally {
        await rm(upTo0007, { recursive: true, force: true })
      }

      const stored = new Map(
        (await loadRecords(db, id, ['conversations'])).map((row) => [row.id, row]),
      )
      const parentOf = (key: string) => stored.get(key)?.data.parentUserId
      assert.equal(parentOf('conv-tek'), only.id)
      assert.equal(stored.get('conv-tek')?.version, 2)
      assert.equal(parentOf('conv-iki'), undefined)
      assert.equal(parentOf('conv-yok'), undefined)
      assert.equal(parentOf('conv-dolu'), 'u-baska')
      assert.equal(parentOf('conv-ogrenci'), undefined)
      for (const key of ['conv-iki', 'conv-yok', 'conv-dolu', 'conv-ogrenci'])
        assert.equal(stored.get(key)?.version, 1, key)
    } finally {
      await app.close()
    }
  })
})

describe('0008: denetim kaydı gerekçe kolonu', SLOW, () => {
  const client = newPGlite()
  const pglite = drizzle({ client, schema })
  const db: Database = pglite
  let folder: string

  before(async () => {
    folder = await migrationsUpTo('0007_backfill_conversation_parent_user')
    await migratePartial(pglite, folder)
  })
  after(async () => {
    await client.close()
    await rm(folder, { recursive: true, force: true })
  })

  test('yazışma erişim gerekçesi changes içinden reason kolonuna taşınır; diğer kayıtlar değişmez; 500 karakter sınırı', async () => {
    const REASON = 'Veli şikâyeti üzerine inceleme'
    const insert = (action: string, changes: unknown) =>
      db.execute(
        sql`insert into audit_log (action, entity_type, entity_id, changes) values (${action}, 'conversations', 'conv-1', ${JSON.stringify(changes)}::jsonb)`,
      )
    await insert('conversation.access', { reason: REASON })
    await insert('conversation.access', { reason: REASON, fields: ['messages'] })
    await insert('message.send', { fields: ['messages'] })

    await migrateRest(pglite)

    const rows = await db
      .select({ action: auditLog.action, reason: auditLog.reason, changes: auditLog.changes })
      .from(auditLog)
      .orderBy(auditLog.id)
    const access = rows.filter((row) => row.action === 'conversation.access')
    assert.deepEqual(
      access.map((row) => row.reason),
      [REASON, REASON],
    )
    assert.deepEqual(
      access.map((row) => row.changes).sort(),
      [null, { fields: ['messages'] }].sort(),
    )
    const other = rows.find((row) => row.action === 'message.send')
    assert.equal(other?.reason, null)
    assert.deepEqual(other?.changes, { fields: ['messages'] })

    // Gerekçe en çok 500 karakter (core şemasıyla aynı sınır).
    await db.execute(
      sql`insert into audit_log (action, reason) values ('conversation.access', ${'x'.repeat(500)})`,
    )
    await assert.rejects(
      db.execute(
        sql`insert into audit_log (action, reason) values ('conversation.access', ${'x'.repeat(501)})`,
      ),
    )
  })
})

describe('0009: yazışma mesajlarının ayrı kayıtlara bölünmesi', SLOW, () => {
  const client = newPGlite()
  const pglite = drizzle({ client, schema })
  const db: Database = pglite
  let folder: string

  before(async () => {
    folder = await migrationsUpTo('0008_add_audit_log_reason')
    await migratePartial(pglite, folder)
  })
  after(async () => {
    await client.close()
    await rm(folder, { recursive: true, force: true })
  })

  test('mesajlar kimlik ve sırayla bölünür, taraf anahtarlarını taşır; dizi kalkar, son mesaj anı yazılır; tekrar etkisiz; taşınamayan öğe veri kaybettirmez', async () => {
    const app = await buildTestApp(db)
    try {
      const { id } = await createInstitution(app, { academicYear: null })
      const message = (key: string, sender: string, date: string, extra = {}) => ({
        id: key,
        text: `Metin ${key}`,
        sender,
        date,
        ...extra,
      })
      const rows = [
        {
          id: 'conv-b',
          position: 2048,
          archived: false,
          data: {
            id: 'conv-b',
            studentId: 's1',
            teacherId: 't1',
            audience: 'parent',
            parentUserId: 'u-veli',
            createdAt: '2026-10-01T08:00:00.000Z',
            messages: [
              message('b-1', 'parent', '2026-10-02T08:00:00.000Z', { senderUserId: 'u-veli' }),
              message('b-2', 'teacher', '2026-10-03T08:00:00.000Z', {
                readAt: '2026-10-03T09:00:00.000Z',
              }),
            ],
          },
        },
        {
          id: 'conv-a',
          position: 1024,
          archived: false,
          data: {
            id: 'conv-a',
            studentId: 's2',
            teacherId: 't1',
            audience: 'student',
            messages: [message('a-1', 'student', '2026-10-04T08:00:00.000Z')],
          },
        },
        {
          id: 'conv-bos',
          position: 3072,
          archived: false,
          data: {
            id: 'conv-bos',
            studentId: 's3',
            teacherId: 't1',
            audience: 'student',
            messages: [],
          },
        },
        {
          id: 'conv-arsiv',
          position: 4096,
          archived: true,
          data: {
            id: 'conv-arsiv',
            studentId: 's4',
            teacherId: 't1',
            audience: 'student',
            messages: [message('arsiv-1', 'teacher', '2026-09-01T08:00:00.000Z')],
          },
        },
        {
          // Kimliksiz öğe taşınamaz: dizi yerinde kalır, hiçbir mesajı kaybolmaz.
          id: 'conv-bozuk',
          position: 5120,
          archived: false,
          data: {
            id: 'conv-bozuk',
            studentId: 's5',
            teacherId: 't1',
            audience: 'student',
            messages: [message('bozuk-1', 'student', '2026-10-05T08:00:00.000Z'), { text: 'x' }],
          },
        },
      ]
      for (const row of rows)
        await db.execute(
          sql`insert into records (institution_id, collection, id, data, position, created_at, updated_at, archived_at) values (${id}, 'conversations', ${row.id}, ${JSON.stringify(row.data)}::jsonb, ${row.position}, ${FIXED_NOW}, ${FIXED_NOW}, ${row.archived ? FIXED_NOW : null})`,
        )

      await migrateRest(pglite)

      const stored = await loadRecords(db, id, ['conversations', 'conversationMessages'], {
        includeArchived: true,
      })
      const conversations = new Map(
        stored.filter((r) => r.collection === 'conversations').map((r) => [r.id, r]),
      )
      const messages = stored.filter((r) => r.collection === 'conversationMessages')
      // Kurum içinde yazışma sırası (position), sonra dizideki sıra.
      assert.deepEqual(
        messages.map((r) => r.id),
        ['a-1', 'b-1', 'b-2', 'arsiv-1', 'bozuk-1'],
      )
      assert.deepEqual(messages.find((r) => r.id === 'b-1')?.data, {
        id: 'b-1',
        text: 'Metin b-1',
        sender: 'parent',
        senderUserId: 'u-veli',
        date: '2026-10-02T08:00:00.000Z',
        conversationId: 'conv-b',
        studentId: 's1',
        teacherId: 't1',
        audience: 'parent',
        parentUserId: 'u-veli',
      })
      assert.equal(messages.find((r) => r.id === 'b-2')?.data.readAt, '2026-10-03T09:00:00.000Z')
      assert.equal('parentUserId' in (messages.find((r) => r.id === 'a-1')?.data ?? {}), false)
      assert.notEqual(messages.find((r) => r.id === 'arsiv-1')?.archivedAt, null)
      assert.equal(messages.find((r) => r.id === 'a-1')?.archivedAt, null)

      const b = conversations.get('conv-b')
      assert.deepEqual(b?.data, {
        id: 'conv-b',
        studentId: 's1',
        teacherId: 't1',
        audience: 'parent',
        parentUserId: 'u-veli',
        createdAt: '2026-10-01T08:00:00.000Z',
        lastMessageAt: '2026-10-03T08:00:00.000Z',
      })
      assert.equal(b?.version, 2)
      assert.equal(conversations.get('conv-a')?.data.lastMessageAt, '2026-10-04T08:00:00.000Z')
      const empty = conversations.get('conv-bos')?.data
      assert.equal(empty !== undefined && ('messages' in empty || 'lastMessageAt' in empty), false)
      assert.equal('messages' in (conversations.get('conv-arsiv')?.data ?? {}), false)
      const broken = conversations.get('conv-bozuk')
      assert.equal(Array.isArray(broken?.data.messages), true)
      assert.equal(broken?.version, 1)

      // Tekrar çalıştırmak (dizisi kalmamış kayıtlarda) hiçbir şeyi değiştirmez.
      const statements = (
        await readFile(path.join(MIGRATIONS_FOLDER, '0009_split_conversation_messages.sql'), 'utf8')
      )
        .split('--> statement-breakpoint')
        .filter((statement) => !/CREATE INDEX/.test(statement))
      for (const statement of statements) await db.execute(sql.raw(statement))
      const again = await loadRecords(db, id, ['conversations', 'conversationMessages'], {
        includeArchived: true,
      })
      assert.deepEqual(
        again.map((r) => [r.collection, r.id, r.version, r.position]),
        stored.map((r) => [r.collection, r.id, r.version, r.position]),
      )
    } finally {
      await app.close()
    }
  })
})

describe('0010–0012: içerik havuzu tabloları', SLOW, () => {
  let db: Database
  let close: () => Promise<void>
  let app: Awaited<ReturnType<typeof buildTestApp>>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  /** Sürücüden bağımsız `execute` sonucu: PGlite ve node-postgres ikisi de `rows` döndürür. */
  const rows = async <T>(query: ReturnType<typeof sql>) =>
    ((await db.execute(query)) as unknown as { rows: T[] }).rows

  test('arama indeksi kurumla başlayan bileşik GIN; her indeks institution_id ile başlar; btree_gin kurulu', async () => {
    const extensions = await rows<{ extname: string }>(
      sql`select extname from pg_extension where extname = 'btree_gin'`,
    )
    assert.equal(extensions.length, 1)
    const indexes = await rows<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes
          where tablename in ('resources', 'resource_versions', 'resource_version_outcomes',
            'resource_version_items', 'resource_shares')
          order by indexname`,
    )
    assert.ok(indexes.length >= 10)
    for (const index of indexes)
      assert.match(index.indexdef, /\(institution_id[,)]/, `${index.indexname} kurumla başlamalı`)
    const search = indexes.find((index) => index.indexname === 'resource_versions_search_idx')
    assert.match(search?.indexdef ?? '', /USING gin \(institution_id, search_vector\)/)
  })

  test('DOM-KYN-051: kısıtlar başka kurumun sürümüne bağlanmayı, içeriksiz canlı sürümü ve ikinci açık taslağı reddeder', async () => {
    const a = await createInstitution(app)
    const b = await createInstitution(app)
    const owner = a.admin.id
    const { resource, versions } = await seedResource(db, a.id, {
      ownerUserId: owner,
      versions: [{ status: 'published' }, { status: 'draft' }],
    })
    const published = versions[0]!
    const stored = await rows<{ current_version_id: string; license_kind: string }>(
      sql`select r.current_version_id, v.license_kind from resources r
          join resource_versions v on v.institution_id = r.institution_id and v.id = r.current_version_id
          where r.institution_id = ${a.id} and r.id = ${resource.id}`,
    )
    assert.deepEqual(stored, [
      { current_version_id: published.id, license_kind: 'institution_original' },
    ])

    const violates = async (query: ReturnType<typeof sql>, constraint: string) => {
      await assert.rejects(db.execute(query), (error: unknown) => {
        const cause = (error as { cause?: { constraint?: string } }).cause
        assert.equal(cause?.constraint ?? (error as { constraint?: string }).constraint, constraint)
        return true
      })
    }
    // Başka kurumun sürümünü güncel yapmak: bileşik yabancı anahtar.
    const { resource: other } = await seedResource(db, b.id, { ownerUserId: b.admin.id })
    await violates(
      sql`update resources set current_version_id = ${published.id}
          where institution_id = ${b.id} and id = ${other.id}`,
      'resources_current_version_fkey',
    )
    await violates(
      sql`update resource_versions set content = null
          where institution_id = ${a.id} and id = ${published.id}`,
      'resource_versions_content_check',
    )
    await violates(
      sql`insert into resource_versions (institution_id, id, resource_id, version_number, status,
            author_user_id, title, content, search_vector)
          values (${a.id}, gen_random_uuid(), ${resource.id}, 3, 'rejected', ${owner}, 'Başlık',
            '{"type":"text","body":"x","fileId":null}', to_tsvector('simple', 'baslik'))`,
      'resource_versions_editable_key',
    )
    await violates(
      sql`update resource_versions set status = 'published', published_at = null
          where institution_id = ${a.id} and id = ${versions[1]!.id}`,
      'resource_versions_published_check',
    )
    // 0012: sözlük kolonları core sabitleriyle sınırlı; türetilmiş lisans türü dahil.
    for (const [assignment, constraint] of [
      [sql`activity_mode = 'dance'`, 'resource_versions_activity_mode_check'],
      [sql`interaction_channel = 'telepathy'`, 'resource_versions_interaction_channel_check'],
      [sql`license = '{"kind":"stolen"}'::jsonb`, 'resource_versions_license_kind_check'],
    ] as const)
      await violates(
        sql`update resource_versions set ${assignment}
            where institution_id = ${a.id} and id = ${published.id}`,
        constraint,
      )
    await db.execute(
      sql`update resource_versions set activity_mode = 'mediation', interaction_channel = 'online',
            license = null
          where institution_id = ${a.id} and id = ${versions[1]!.id}`,
    )
  })
})

describe('0013: beceri görevi tabloları', SLOW, () => {
  const skillTables = [
    'rubrics',
    'rubric_versions',
    'task_assignments',
    'task_assignment_targets',
    'task_attempts',
    'task_submissions',
    'submission_versions',
    'submission_drafts',
    'resubmission_requests',
    'rubric_scores',
    'second_rating_requests',
    'score_appeals',
    'score_transfers',
  ]
  let db: Database
  let close: () => Promise<void>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
  })
  after(async () => {
    await close()
  })

  const rows = async <T>(query: ReturnType<typeof sql>) =>
    ((await db.execute(query)) as unknown as { rows: T[] }).rows
  const tableList = sql.join(
    skillTables.map((table) => sql`${table}`),
    sql`, `,
  )

  test('her tabloda kurum kolonları zorunlu; zaman kolonları timestamptz', async () => {
    const columns = await rows<{
      table_name: string
      column_name: string
      data_type: string
      is_nullable: 'YES' | 'NO'
    }>(
      sql`select table_name, column_name, data_type, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name in (${tableList})`,
    )
    for (const table of skillTables) {
      const own = columns.filter((column) => column.table_name === table)
      assert.ok(own.length > 0, `${table} yok`)
      const byName = new Map(own.map((column) => [column.column_name, column]))
      for (const required of ['institution_id', 'created_at', 'updated_at', 'version'])
        assert.equal(byName.get(required)?.is_nullable, 'NO', `${table}.${required} zorunlu`)
      assert.equal(byName.get('archived_at')?.is_nullable, 'YES', `${table}.archived_at`)
      for (const column of own)
        assert.notEqual(
          column.data_type,
          'timestamp without time zone',
          `${table}.${column.column_name} timestamptz olmalı`,
        )
    }
  })

  test('her indeks institution_id ile başlar ve <tablo>_…_idx|_key|_pkey adını taşır', async () => {
    const indexes = await rows<{ tablename: string; indexname: string; indexdef: string }>(
      sql`select tablename, indexname, indexdef from pg_indexes
          where schemaname = 'public' and tablename in (${tableList})`,
    )
    assert.ok(indexes.length >= skillTables.length * 2)
    for (const index of indexes) {
      assert.match(index.indexdef, /\(institution_id[,)]/, `${index.indexname} kurumla başlamalı`)
      assert.ok(index.indexname.startsWith(`${index.tablename}_`), index.indexname)
      assert.match(index.indexname, /_(idx|key|pkey)$/, index.indexname)
    }
  })

  test('kısıt adları türüne uygun; her yabancı anahtar institution_id ile başlar ve bir indeksin önekidir', async () => {
    const constraints = await rows<{
      table_name: string
      conname: string
      contype: string
      columns: string[]
    }>(
      sql`select c.conrelid::regclass::text as table_name, c.conname, c.contype::text as contype,
            coalesce(array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, n)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
              order by k.n), '{}') as columns
          from pg_constraint c
          where c.conrelid::regclass::text in (${tableList}) and c.contype in ('p', 'u', 'f', 'c')`,
    )
    const indexColumns = await rows<{ table_name: string; columns: string[] }>(
      sql`select i.indrelid::regclass::text as table_name,
            array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum, n)
              join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
              order by k.n) as columns
          from pg_index i where i.indrelid::regclass::text in (${tableList})`,
    )
    const suffix: Record<string, RegExp> = {
      p: /_pkey$/,
      u: /_key$/,
      f: /(_fkey|_institution_id_institutions_id_fk)$/,
      c: /_check$/,
    }
    let foreignKeys = 0
    for (const constraint of constraints) {
      assert.ok(constraint.conname.startsWith(`${constraint.table_name}_`), constraint.conname)
      assert.match(constraint.conname, suffix[constraint.contype]!, constraint.conname)
      if (constraint.contype !== 'f') continue
      foreignKeys += 1
      assert.equal(constraint.columns[0], 'institution_id', `${constraint.conname} kurumla başlar`)
      const covered = indexColumns.some(
        (index) =>
          index.table_name === constraint.table_name &&
          constraint.columns.every((column, position) => index.columns[position] === column),
      )
      assert.ok(covered, `${constraint.conname} indeksli olmalı`)
    }
    assert.ok(foreignKeys >= 30, `yabancı anahtar sayısı ${foreignKeys}`)
  })

  test('DOM-BEC-040, 060: değişmez dört tabloda satır ve truncate tetikleyicisi kurulu, etkin ve ortak fonksiyonu çağırır', async () => {
    const triggers = await rows<{
      table_name: string
      tgname: string
      tgtype: number
      tgenabled: string
      proname: string
    }>(
      sql`select c.relname::text as table_name, t.tgname::text as tgname, t.tgtype::int as tgtype,
            t.tgenabled::text as tgenabled, p.proname::text as proname
          from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_proc p on p.oid = t.tgfoid
          where not t.tgisinternal and c.relname in (${tableList})
          order by c.relname, t.tgname`,
    )
    // pg_trigger.tgtype bitleri: ROW 1, BEFORE 2, DELETE 8, UPDATE 16, TRUNCATE 32.
    const ROW_UPDATE_DELETE = 1 | 2 | 8 | 16
    const STATEMENT_TRUNCATE = 2 | 32
    const immutableTables = [
      'resubmission_requests',
      'rubric_scores',
      'score_transfers',
      'submission_versions',
    ]
    assert.deepEqual(
      triggers.map(({ table_name, tgname, tgtype }) => [table_name, tgname, tgtype]),
      immutableTables.flatMap((table) => [
        [table, `${table}_immutable_trigger`, ROW_UPDATE_DELETE],
        [table, `${table}_truncate_trigger`, STATEMENT_TRUNCATE],
      ]),
    )
    for (const trigger of triggers) {
      assert.equal(trigger.tgenabled, 'O', `${trigger.tgname} etkin olmalı`)
      assert.equal(trigger.proname, 'kampus_reject_immutable_change')
    }
  })

  test('0025: bildirim ifade indeksi kısmi ve sorgunun ifadesiyle kurulur (IST-065)', async () => {
    const client = newPGlite()
    try {
      const fresh = drizzle({ client, schema })
      await migrate(fresh, { migrationsFolder: MIGRATIONS_FOLDER })
      const { rows } = (await fresh.execute(
        sql`select indexdef from pg_indexes where indexname = 'records_notifications_idx'`,
      )) as unknown as { rows: { indexdef: string }[] }
      assert.equal(rows.length, 1)
      const definition = rows[0]!.indexdef
      assert.match(
        definition,
        /\(institution_id, \(\(data ->> 'studentId'::text\)\), "position", id\)/,
      )
      assert.match(definition, /collection = 'notifications'::text/)
      assert.match(definition, /archived_at IS NULL/)
    } finally {
      await client.close()
    }
  })

  test('migration ikinci kez uygulanınca hiçbir adım yeniden çalışmaz', async () => {
    const client = newPGlite()
    try {
      const fresh = drizzle({ client, schema })
      await migrate(fresh, { migrationsFolder: MIGRATIONS_FOLDER })
      const count = async () =>
        (
          (await fresh.execute(
            sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
          )) as unknown as { rows: { n: number }[] }
        ).rows[0]!.n
      const first = await count()
      const journal: Journal = JSON.parse(
        await readFile(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
      )
      assert.equal(first, journal.entries.length)
      // Son kayıt dizindeki son `.sql` dosyasıdır; sabit ad beklenmez, yeni migration bu testi
      // değiştirmeden eklenir (#16).
      const sqlFiles = (await readdir(MIGRATIONS_FOLDER))
        .filter((name) => name.endsWith('.sql'))
        .sort()
      assert.equal(journal.entries.length, sqlFiles.length)
      assert.equal(`${journal.entries.at(-1)?.tag}.sql`, sqlFiles.at(-1))
      await migrate(fresh, { migrationsFolder: MIGRATIONS_FOLDER })
      assert.equal(await count(), first)
    } finally {
      await client.close()
    }
  })
})

describe('0026: kurum ayarından etkin yıl geri doldurması', SLOW, () => {
  const client = newPGlite()
  const pglite = drizzle({ client, schema })
  const db: Database = pglite
  let folder: string

  before(async () => {
    folder = await migrationsUpTo('0025_index_notifications')
    await migratePartial(pglite, folder)
  })
  after(async () => {
    await client.close()
    await rm(folder, { recursive: true, force: true })
  })

  test('DOM-YTK-063, 065: ayar satırı olan kurum güncel yılını varsayılan aralıkla etkin alır; ayarsız kurum boş kalır', async () => {
    const app = await buildTestApp(db)
    try {
      // Tablolar yokken açılış yolu yıl yazamaz; ayar satırı eski sürümdeki gibi elle eklenir.
      const withSettings = await createInstitution(app, { academicYear: null })
      const withoutSettings = await createInstitution(app, { academicYear: null })
      await db.execute(
        sql`insert into institution_settings (institution_id, academic_year) values (${withSettings.id}, 2025)`,
      )

      await migrateRest(pglite)

      const rows = await db
        .select()
        .from(academicYears)
        .where(inArray(academicYears.institutionId, [withSettings.id, withoutSettings.id]))
      assert.equal(rows.length, 1)
      const [row] = rows
      assert.equal(row?.institutionId, withSettings.id)
      assert.equal(row?.startYear, 2025)
      assert.equal(row?.startDate, '2025-09-01')
      assert.equal(row?.endDate, '2026-08-31')
      assert.equal(row?.status, 'active')
      assert.ok(row?.activatedAt)
      assert.equal(row?.closedAt, null)
      assert.equal(row?.version, 1)
      assert.equal((await loadAcademicYears(db, withSettings.id))[0]?.terms.length, 0)
    } finally {
      await app.close()
    }
  })
})

describe('0026: eğitim yılı tabloları', SLOW, () => {
  let db: Database
  let close: () => Promise<void>
  let app: Awaited<ReturnType<typeof buildTestApp>>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  const violates = async (query: ReturnType<typeof sql>, constraint: string) => {
    await assert.rejects(db.execute(query), (error: unknown) => {
      const cause = (error as { cause?: { constraint?: string } }).cause
      assert.equal(cause?.constraint ?? (error as { constraint?: string }).constraint, constraint)
      return true
    })
  }

  test('DOM-YTK-063, 065: tek etkin yıl, yıl aralığı, yaşam döngüsü ve dönem kısıtları veritabanında da korunur', async () => {
    // Ayarsız kurum: açılış yolu varsayılan yılı yazmaz, yıllar burada elle eklenir.
    const a = await createInstitution(app, { academicYear: null })
    const b = await createInstitution(app, { academicYear: null })
    const year = (institutionId: string, startYear: number, status = 'active') =>
      sql`insert into academic_years (institution_id, start_year, start_date, end_date, status, activated_at)
          values (${institutionId}, ${startYear}, ${`${startYear}-09-01`}, ${`${startYear + 1}-08-31`},
            ${status}, ${status === 'planned' ? null : FIXED_NOW})`
    await db.execute(year(a.id, 2026))
    // Başka kurumun etkin yılı kısıtlamaz; aynı kurumda ikinci etkin yıl reddedilir.
    await db.execute(year(b.id, 2026))
    await violates(year(a.id, 2027), 'academic_years_active_key')
    await db.execute(year(a.id, 2027, 'planned'))
    await violates(
      sql`insert into academic_years (institution_id, start_year, start_date, end_date, status)
          values (${a.id}, 2028, '2028-09-01', '2029-09-01', 'planned')`,
      'academic_years_dates_check',
    )
    await violates(
      sql`insert into academic_years (institution_id, start_year, start_date, end_date, status)
          values (${a.id}, 2029, '2030-01-01', '2030-06-01', 'planned')`,
      'academic_years_dates_check',
    )
    await violates(
      sql`update academic_years set status = 'closed'
          where institution_id = ${a.id} and start_year = 2027`,
      'academic_years_lifecycle_check',
    )
    // Dönem başka kurumun yılına bağlanamaz (bileşik yabancı anahtar).
    await violates(
      sql`insert into academic_terms (institution_id, id, start_year, name, name_key, start_date, end_date)
          values (${a.id}, gen_random_uuid(), 2030, 'Güz', 'güz', '2030-09-10', '2031-01-10')`,
      'academic_terms_year_fkey',
    )
    const term = (name: string) =>
      sql`insert into academic_terms (institution_id, id, start_year, name, name_key, start_date, end_date)
          values (${a.id}, gen_random_uuid(), 2026, ${name}, ${academicTermNameKey(name)},
            '2026-09-10', '2027-01-10')`
    await db.execute(term('I. dönem'))
    await violates(term('ı. DÖNEM'), 'academic_terms_year_name_key')
    // Tekillik core anahtarındadır, `lower()`'da değil: "i. dönem" Türkçede ayrı addır.
    await db.execute(term('i. dönem'))
    await violates(
      sql`insert into academic_terms (institution_id, id, start_year, name, name_key, start_date, end_date)
          values (${a.id}, gen_random_uuid(), 2026, 'Ters', 'ters', '2027-02-10', '2027-02-01')`,
      'academic_terms_dates_check',
    )
  })
})

describe('0027: veli bağı geri doldurması', SLOW, () => {
  const client = newPGlite()
  const pglite = drizzle({ client, schema })
  const db: Database = pglite
  let folder: string

  before(async () => {
    folder = await migrationsUpTo('0026_create_academic_years')
    await migratePartial(pglite, folder)
  })
  after(async () => {
    await client.close()
    await rm(folder, { recursive: true, force: true })
  })

  test('DOM-ILT-070 doğrulanmış etkin çocuk bağlantısı velayetli ve kısıtsız bağ olur; arşivli ve çocuk dışı bağlantı dolmaz', async () => {
    const app = await buildTestApp(db)
    try {
      const { id } = await createInstitution(app, { academicYear: null })
      const link = async (role: 'veli' | 'ogrenci', kind: string, archived = false) => {
        const member = await createMember(app, id, role)
        await db.execute(
          sql`insert into membership_links (institution_id, membership_id, kind, record_id, archived_at)
              values (${id}, ${member.membershipId}, ${kind}, 's1', ${archived ? FIXED_NOW : null})`,
        )
        return member.membershipId
      }
      const parent = await link('veli', 'child')
      await link('veli', 'child', true)
      await link('ogrenci', 'student')

      await migrateRest(pglite)

      const rows = await db
        .select()
        .from(studentGuardians)
        .where(eq(studentGuardians.institutionId, id))
      assert.equal(rows.length, 1)
      const [row] = rows
      assert.equal(row?.studentId, 's1')
      assert.equal(row?.membershipId, parent)
      assert.equal(row?.parentId, null)
      assert.equal(row?.relationship, 'other')
      assert.equal(row?.custody, 'full')
      assert.equal(row?.isContactRestricted, false)
      assert.equal(row?.isPayer, false)
      assert.equal(row?.isPickupAuthorized, false)
      assert.equal(row?.version, 1)
      assert.equal(row?.archivedAt, null)
    } finally {
      await app.close()
    }
  })
})

describe('0027: veli bağı tablosu', SLOW, () => {
  let db: Database
  let close: () => Promise<void>
  let app: Awaited<ReturnType<typeof buildTestApp>>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  const violates = async (query: ReturnType<typeof sql>, constraint: string) => {
    await assert.rejects(db.execute(query), (error: unknown) => {
      const cause = (error as { cause?: { constraint?: string } }).cause
      assert.equal(cause?.constraint ?? (error as { constraint?: string }).constraint, constraint)
      return true
    })
  }

  test('DOM-ILT-074: tek ödeyici, kısıtlı velinin velayet/ödeme/teslim yasağı ve veli kimliği veritabanında da korunur', async () => {
    const a = await createInstitution(app, { academicYear: null })
    const b = await createInstitution(app, { academicYear: null })
    const bond = (
      institutionId: string,
      parentId: string | null,
      extra: { custody?: string; payer?: boolean; restricted?: boolean; pickup?: boolean } = {},
    ) =>
      sql`insert into student_guardians (institution_id, id, student_id, parent_id, relationship,
            custody, is_payer, is_contact_restricted, is_pickup_authorized)
          values (${institutionId}, gen_random_uuid(), 's1', ${parentId}, 'other',
            ${extra.custody ?? 'full'}, ${extra.payer ?? false}, ${extra.restricted ?? false},
            ${extra.pickup ?? false})`
    await db.execute(bond(a.id, 'p1', { payer: true }))
    // Başka kurumun ödeyicisi kısıtlamaz; aynı öğrencide ikinci ödeyici reddedilir.
    await db.execute(bond(b.id, 'p1', { payer: true }))
    await violates(bond(a.id, 'p2', { payer: true }), 'student_guardians_payer_key')
    await violates(bond(a.id, 'p1'), 'student_guardians_student_parent_key')
    await violates(bond(a.id, null), 'student_guardians_identity_check')
    await violates(bond(a.id, 'p3', { restricted: true }), 'student_guardians_restriction_check')
    await violates(
      bond(a.id, 'p3', { restricted: true, custody: 'none', pickup: true }),
      'student_guardians_restriction_check',
    )
    await violates(bond(a.id, 'p3', { custody: 'shared' }), 'student_guardians_custody_check')
    await db.execute(bond(a.id, 'p3', { restricted: true, custody: 'none' }))
    // Arşivli ödeyici yeni ödeyiciye engel değildir.
    await db.execute(
      sql`update student_guardians set archived_at = now()
          where institution_id = ${a.id} and is_payer`,
    )
    await db.execute(bond(a.id, 'p4', { payer: true }))
  })
})

describe('0028: kur programı tablosu', SLOW, () => {
  let db: Database
  let close: () => Promise<void>
  let app: Awaited<ReturnType<typeof buildTestApp>>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  const rows = async <T>(query: ReturnType<typeof sql>) =>
    ((await db.execute(query)) as unknown as { rows: T[] }).rows
  const violates = async (query: ReturnType<typeof sql>, constraint: string) => {
    await assert.rejects(db.execute(query), (error: unknown) => {
      const cause = (error as { cause?: { constraint?: string } }).cause
      assert.equal(cause?.constraint ?? (error as { constraint?: string }).constraint, constraint)
      return true
    })
  }

  test('indeksler institution_id ile başlar; kurum kolonları zorunlu, zamanlar timestamptz', async () => {
    const indexes = await rows<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes where tablename = 'courses'`,
    )
    assert.deepEqual(indexes.map((index) => index.indexname).sort(), [
      'courses_e_ozel_program_key',
      'courses_name_key',
      'courses_next_course_idx',
      'courses_pkey',
    ])
    for (const index of indexes)
      assert.match(index.indexdef, /\(institution_id[,)]/, index.indexname)
    const columns = await rows<{ column_name: string; data_type: string; is_nullable: string }>(
      sql`select column_name, data_type, is_nullable from information_schema.columns
          where table_name = 'courses'`,
    )
    const byName = new Map(columns.map((column) => [column.column_name, column]))
    for (const required of ['institution_id', 'created_at', 'updated_at', 'version'])
      assert.equal(byName.get(required)?.is_nullable, 'NO', required)
    for (const column of columns)
      assert.notEqual(column.data_type, 'timestamp without time zone', column.column_name)
  })

  test('DOM-DIL-005…007: saat, mevcut, yaşam döngüsü, e-Özel izi, ad tekilliği ve sonraki kur bağı veritabanında da korunur', async () => {
    const a = await createInstitution(app, { type: 'language_school' })
    const b = await createInstitution(app, { type: 'language_school' })
    const id = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
    const course = (
      institutionId: string,
      courseId: string,
      overrides: {
        name?: string
        total?: number
        weekly?: number
        session?: number
        min?: number
        max?: number
        status?: string
        activated?: boolean
        certified?: boolean
        approval?: string
        next?: string | null
        focus?: string
      } = {},
    ) => {
      const name = overrides.name ?? `Kur ${courseId.slice(-3)}`
      const approval = overrides.approval ?? 'not_submitted'
      const recorded = approval === 'not_submitted' ? null : FIXED_NOW
      return sql`insert into courses (institution_id, id, name, name_key, language, level, skill_focus,
          total_hours, weekly_hours, session_minutes, min_learners, max_learners, certified,
          next_course_id, status, activated_at, archived_at, e_ozel_program_code, e_ozel_program_key,
          e_ozel_approval, e_ozel_recorded_at, e_ozel_recorded_by_user_id)
        values (${institutionId}, ${courseId}, ${name}, ${name.toLocaleLowerCase('tr-TR')}, 'en', 'B1',
          ${overrides.focus ?? '{}'}::text[], ${overrides.total ?? 72}, ${overrides.weekly ?? 6},
          ${overrides.session ?? 45}, ${overrides.min ?? 6}, ${overrides.max ?? 14},
          ${overrides.certified ?? false}, ${overrides.next ?? null}, ${overrides.status ?? 'draft'},
          ${overrides.activated ? FIXED_NOW : null},
          ${overrides.status === 'archived' ? FIXED_NOW : null},
          ${recorded ? `P-${courseId.slice(-3)}` : null}, ${recorded ? `P-${courseId.slice(-3)}` : null},
          ${approval}, ${recorded}, ${recorded ? 'user-x' : null})`
    }
    await db.execute(course(a.id, id(1)))
    await violates(course(a.id, id(2), { total: 4 }), 'courses_hours_check')
    await violates(course(a.id, id(2), { session: 90, weekly: 3 }), 'courses_session_check')
    await violates(course(a.id, id(2), { max: 19 }), 'courses_learners_check')
    await violates(course(a.id, id(2), { min: 10, max: 8 }), 'courses_learners_check')
    await violates(course(a.id, id(2), { focus: '{grammar}' }), 'courses_skill_focus_check')
    await violates(course(a.id, id(2), { status: 'active' }), 'courses_lifecycle_check')
    await violates(
      course(a.id, id(2), { status: 'active', activated: true, certified: true }),
      'courses_certified_check',
    )
    await violates(
      sql`update courses set e_ozel_approval = 'pending' where institution_id = ${a.id} and id = ${id(1)}`,
      'courses_e_ozel_check',
    )
    // Ad arşivlenmemiş kurlarda tekildir; başka kurumda ve arşivde serbesttir.
    await violates(course(a.id, id(2), { name: 'Kur 101' }), 'courses_name_key')
    await db.execute(course(b.id, id(2), { name: 'Kur 101' }))
    await db.execute(course(a.id, id(3), { name: 'Kur 101', status: 'archived' }))
    // Sonraki kur aynı kurumdadır ve kendisi olamaz.
    await violates(course(a.id, id(4), { next: id(2) }), 'courses_next_course_fkey')
    await violates(course(a.id, id(4), { next: id(4) }), 'courses_next_course_check')
    await db.execute(course(a.id, id(4), { next: id(1), approval: 'approved' }))
  })
})

describe('0029: dil okulu grup tabloları', SLOW, () => {
  let db: Database
  let close: () => Promise<void>
  let app: Awaited<ReturnType<typeof buildTestApp>>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  const rows = async <T>(query: ReturnType<typeof sql>) =>
    ((await db.execute(query)) as unknown as { rows: T[] }).rows
  const violates = async (query: ReturnType<typeof sql>, constraint: string) => {
    await assert.rejects(db.execute(query), (error: unknown) => {
      const cause = (error as { cause?: { constraint?: string } }).cause
      assert.equal(cause?.constraint ?? (error as { constraint?: string }).constraint, constraint)
      return true
    })
  }

  test('indeksler institution_id ile başlar; kurum kolonları zorunlu, zamanlar timestamptz', async () => {
    for (const table of ['language_groups', 'language_group_members', 'language_group_waitlist']) {
      const indexes = await rows<{ indexname: string; indexdef: string }>(
        sql`select indexname, indexdef from pg_indexes where tablename = ${table}`,
      )
      assert.ok(indexes.length >= 2, table)
      for (const index of indexes)
        assert.match(index.indexdef, /\(institution_id[,)]/, index.indexname)
      const columns = await rows<{ column_name: string; data_type: string; is_nullable: string }>(
        sql`select column_name, data_type, is_nullable from information_schema.columns
            where table_name = ${table}`,
      )
      const byName = new Map(columns.map((column) => [column.column_name, column]))
      for (const required of ['institution_id', 'created_at', 'updated_at', 'version'])
        assert.equal(byName.get(required)?.is_nullable, 'NO', `${table}.${required}`)
      for (const column of columns)
        assert.notEqual(column.data_type, 'timestamp without time zone', column.column_name)
    }
  })

  test('DOM-DIL-008, -040, -043: kur bağı, kapasite, derslik, yaşam döngüsü ve bekleme sırası veritabanında da korunur', async () => {
    const a = await createInstitution(app, { type: 'language_school' })
    const b = await createInstitution(app, { type: 'language_school' })
    const id = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`
    const courseId = id(99)
    await db.execute(sql`insert into courses (institution_id, id, name, name_key, language, level,
        total_hours, weekly_hours, session_minutes, min_learners, max_learners, certified, status,
        activated_at, e_ozel_approval)
      values (${a.id}, ${courseId}, 'Kur', 'kur', 'en', 'B1', 12, 4, 45, 2, 12, false, 'active',
        ${FIXED_NOW}, 'not_submitted')`)
    const group = (
      institutionId: string,
      groupId: string,
      overrides: {
        name?: string
        capacity?: number
        delivery?: string
        room?: string | null
        state?: string
        opened?: boolean
        schedule?: string
        end?: string
        merged?: string | null
      } = {},
    ) => {
      const name = overrides.name ?? `Grup ${groupId.slice(-3)}`
      const room = overrides.room === undefined ? 'D1' : overrides.room
      const cancelled = overrides.state === 'cancelled'
      return sql`insert into language_groups (institution_id, id, course_id, name, name_key, age_band,
          delivery, room, room_key, schedule, start_date, end_date, capacity, state, opened_at,
          cancelled_at, cancel_reason, merged_into_group_id)
        values (${institutionId}, ${groupId}, ${courseId}, ${name}, ${name.toLocaleLowerCase('tr-TR')},
          'adult', ${overrides.delivery ?? 'in_person'}, ${room}, ${room === null ? null : room.toLowerCase()},
          ${overrides.schedule ?? '[{"weekday":1,"startTime":"18:00"}]'}::jsonb, '2026-10-12',
          ${overrides.end ?? '2026-10-28'}, ${overrides.capacity ?? 10}, ${overrides.state ?? 'planned'},
          ${overrides.opened ? FIXED_NOW : null}, ${cancelled ? FIXED_NOW : null},
          ${cancelled ? 'İptal' : null}, ${overrides.merged ?? null})`
    }
    await db.execute(group(a.id, id(1)))
    // Kur aynı kurumdadır.
    await violates(group(b.id, id(2)), 'language_groups_course_fkey')
    await violates(group(a.id, id(2), { capacity: 19 }), 'language_groups_capacity_check')
    await violates(group(a.id, id(2), { delivery: 'online' }), 'language_groups_room_check')
    await violates(group(a.id, id(2), { state: 'open' }), 'language_groups_lifecycle_check')
    await violates(group(a.id, id(2), { end: '2026-10-01' }), 'language_groups_dates_check')
    await violates(group(a.id, id(2), { schedule: '[]' }), 'language_groups_schedule_check')
    await violates(group(a.id, id(2), { merged: id(1) }), 'language_groups_cancel_check')
    // Ad iptal edilmemiş gruplarda tekildir.
    await violates(group(a.id, id(2), { name: 'Grup 201' }), 'language_groups_name_key')
    await db.execute(group(a.id, id(2), { name: 'Grup 201', state: 'cancelled', merged: id(1) }))
    await db.execute(
      group(a.id, id(3), { delivery: 'online', room: null, state: 'open', opened: true }),
    )

    // Kursiyer aynı kurumun `students` kaydıdır (bileşik yabancı anahtar, üretilen koleksiyon).
    const student = (institutionId: string, collection: string, recordId: string) =>
      sql`insert into records (institution_id, collection, id, data, position)
        values (${institutionId}, ${collection}, ${recordId}, '{}'::jsonb, 1)`
    await db.execute(student(a.id, 'students', 's1'))
    await db.execute(student(a.id, 'teachers', 's2'))
    await db.execute(student(b.id, 'students', 's3'))
    const member = (groupId: string, studentId: string) =>
      sql`insert into language_group_members (institution_id, id, group_id, student_id, status, joined_at)
        values (${a.id}, gen_random_uuid(), ${groupId}, ${studentId}, 'active', ${FIXED_NOW})`
    for (const missing of ['s-yok', 's2', 's3'])
      await violates(member(id(1), missing), 'language_group_members_student_fkey')
    await db.execute(member(id(1), 's1'))
    await violates(member(id(1), 's1'), 'language_group_members_group_student_key')
    await db.execute(member(id(3), 's1'))

    const waiting = (
      overrides: { student?: string | null; prospect?: string | null; status?: string } = {},
    ) =>
      sql`insert into language_group_waitlist (institution_id, id, course_id, group_id, student_id,
          prospect_id, requested_at, status)
        values (${a.id}, gen_random_uuid(), ${courseId}, ${id(1)},
          ${overrides.student === undefined ? 's9' : overrides.student},
          ${overrides.prospect ?? null}, ${FIXED_NOW}, ${overrides.status ?? 'waiting'})`
    await db.execute(waiting())
    await violates(waiting(), 'language_group_waitlist_student_key')
    await violates(waiting({ student: null }), 'language_group_waitlist_learner_check')
    await violates(waiting({ prospect: 'p1' }), 'language_group_waitlist_learner_check')
    await violates(
      waiting({ student: 's8', status: 'offered' }),
      'language_group_waitlist_offer_check',
    )
    await db.execute(waiting({ student: null, prospect: 'p1' }))
  })

  test('öğretmen aynı kurumun üyeliğidir; üyelik silinince yalnız öğretmen boşalır', async () => {
    const a = await createInstitution(app, { type: 'language_school' })
    const b = await createInstitution(app, { type: 'language_school' })
    const courseId = '00000000-0000-4000-8000-000000000398'
    await db.execute(sql`insert into courses (institution_id, id, name, name_key, language, level,
        total_hours, weekly_hours, session_minutes, min_learners, max_learners, certified, status,
        activated_at, e_ozel_approval)
      values (${a.id}, ${courseId}, 'Kur', 'kur', 'en', 'B1', 12, 4, 45, 2, 12, false, 'active',
        ${FIXED_NOW}, 'not_submitted')`)
    const teacher = await createMember(app, a.id, 'ogretmen')
    const group = (groupId: string, membershipId: string) =>
      sql`insert into language_groups (institution_id, id, course_id, name, name_key, age_band,
          teacher_membership_id, delivery, room, room_key, schedule, start_date, end_date, capacity,
          state)
        values (${a.id}, ${groupId}, ${courseId}, ${groupId}, ${groupId}, 'adult', ${membershipId},
          'online', null, null, '[{"weekday":1,"startTime":"18:00"}]'::jsonb, '2026-10-12',
          '2026-10-28', 10, 'planned')`
    await violates(
      group('00000000-0000-4000-8000-000000000301', b.adminMembershipId),
      'language_groups_teacher_fkey',
    )
    const groupId = '00000000-0000-4000-8000-000000000302'
    await db.execute(group(groupId, teacher.membershipId))
    await db.execute(sql`delete from memberships where id = ${teacher.membershipId}`)
    const [row] = await rows<{ institution_id: string; teacher_membership_id: string | null }>(
      sql`select institution_id, teacher_membership_id from language_groups where id = ${groupId}`,
    )
    assert.deepEqual(row, { institution_id: a.id, teacher_membership_id: null })
  })
})
