import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import {
  hasValidConsent,
  planConsent,
  planConsentWithdrawal,
} from '@kampus/school-core/lib/consents.ts'
import {
  needsNoticeAcknowledgement,
  planNoticeAcknowledgement,
  planNoticePublication,
} from '@kampus/school-core/lib/privacy-notices.ts'

import type { Database } from '../src/db/client.ts'
import {
  closeConsent,
  findConsent,
  insertConsent,
  insertNoticeAcknowledgement,
  insertPrivacyNotice,
  listConsentsOfSubject,
  listNoticeAcknowledgements,
  listPrivacyNotices,
} from '../src/db/privacy.ts'
import { institutions } from '../src/db/schema/auth.ts'
import { consents, noticeAcknowledgements, privacyNotices } from '../src/db/schema/privacy.ts'
import { databaseErrorInfo } from '../src/errors.ts'
import { createTestDatabase, FIXED_NOW, uniqueId } from './support/app.ts'

/**
 * Aydınlatma ve rıza tabloları (migration 0024; DOM-YTK-056…062). Uç bu dilimde yok (OG-016);
 * satırlar depo yardımcılarıyla ve core kararlarıyla yazılır, ihlal kısıt adıyla doğrulanır.
 */

const TABLES = ['privacy_notices', 'notice_acknowledgements', 'consents']
const NOW = FIXED_NOW.toISOString()
const YEAR_END = '2027-06-30T21:00:00.000Z'
const MINOR = { id: 'test-s1', birthDate: '2012-03-04' }
const PARENT = {
  role: 'veli' as const,
  userId: 'test-u-veli',
  links: [{ kind: 'child' as const, recordId: MINOR.id }],
}
const BONDS = [{ studentId: MINOR.id, verified: true, custody: true }]

/** Sürücüden bağımsız kısıt ihlali beklentisi: PGlite ve node-postgres hatası `cause`'ta. */
async function violates(work: Promise<unknown>, constraint: string, code?: string) {
  await assert.rejects(work, (error: unknown) => {
    const info = databaseErrorInfo(error)
    assert.equal(info?.constraint, constraint)
    if (code !== undefined) assert.equal(info?.code, code)
    return true
  })
}

/** Değişmezlik tetikleyicisinin reddi: 55000; ileti teknik ve İngilizcedir. */
async function rejectsChange(work: Promise<unknown>) {
  await assert.rejects(work, (error: unknown) => {
    assert.equal(databaseErrorInfo(error)?.code, '55000')
    return true
  })
}

describe('0024: aydınlatma ve rıza tabloları', () => {
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
    TABLES.map((table) => sql`${table}`),
    sql`, `,
  )

  async function institution(): Promise<string> {
    const id = uniqueId('test-kurum')
    await db
      .insert(institutions)
      .values({ id, name: id, slug: id, createdAt: FIXED_NOW, enabledModules: {} })
    return id
  }

  /** Kuruma veli aydınlatması ve fotoğraf rıza metni yayımlar. */
  async function publish(institutionId: string) {
    const ids = { notice: randomUUID(), photo: randomUUID() }
    for (const [id, input] of [
      [ids.notice, { kind: 'notice', audience: 'veli', title: 'Veli aydınlatma', body: 'Metin' }],
      [
        ids.photo,
        { kind: 'consent_text', purpose: 'photo_video_sharing', title: 'Fotoğraf', body: 'Metin' },
      ],
    ] as const) {
      const draft = planNoticePublication({
        notices: await listPrivacyNotices(db, institutionId),
        publishedByUserId: 'test-u-admin',
        input,
        now: NOW,
      })
      await insertPrivacyNotice(db, institutionId, { id, ...draft }, FIXED_NOW)
    }
    return ids
  }

  async function grant(institutionId: string, textId: string) {
    const plan = planConsent({
      actor: PARENT,
      student: MINOR,
      guardianBonds: BONDS,
      texts: await listPrivacyNotices(db, institutionId),
      consents: await listConsentsOfSubject(db, institutionId, {
        kind: 'student',
        id: MINOR.id,
        openOnly: true,
      }),
      input: { purpose: 'photo_video_sharing', studentId: MINOR.id, textId, channel: 'web' },
      now: NOW,
      academicYearEndsAt: YEAR_END,
    })
    const id = randomUUID()
    await insertConsent(db, institutionId, { id, ...plan.consent }, FIXED_NOW)
    return { id, plan }
  }

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
    for (const table of TABLES) {
      const own = columns.filter((column) => column.table_name === table)
      assert.ok(own.length > 0, `${table} yok`)
      const byName = new Map(own.map((column) => [column.column_name, column]))
      for (const required of ['institution_id', 'created_at', 'updated_at', 'version'])
        assert.equal(byName.get(required)?.is_nullable, 'NO', `${table}.${required} zorunlu`)
      assert.equal(byName.get('archived_at')?.is_nullable, 'YES', `${table}.archived_at`)
      for (const column of own)
        assert.notEqual(column.data_type, 'timestamp without time zone', column.column_name)
    }
    // Rıza satırı metni taşımaz; metin yalnız `privacy_notices`'tadır.
    const consentColumns = columns.filter((column) => column.table_name === 'consents')
    assert.ok(consentColumns.every((column) => !['title', 'body'].includes(column.column_name)))
  })

  test('indeks ve kısıt adları; her indeks ve yabancı anahtar institution_id ile başlar ve indekslidir', async () => {
    const indexes = await rows<{ tablename: string; indexname: string; indexdef: string }>(
      sql`select tablename, indexname, indexdef from pg_indexes
          where schemaname = 'public' and tablename in (${tableList})`,
    )
    for (const index of indexes) {
      assert.match(index.indexdef, /\(institution_id[,)]/, index.indexname)
      assert.ok(index.indexname.startsWith(`${index.tablename}_`), index.indexname)
      assert.match(index.indexname, /_(idx|key|pkey)$/, index.indexname)
    }
    const partial = indexes.find(
      (index) => index.indexname === 'consents_subject_purpose_decision_key',
    )
    assert.match(
      partial?.indexdef ?? '',
      /UNIQUE.*WHERE.*withdrawn_at IS NULL.*archived_at IS NULL/,
    )

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
      assert.equal(constraint.columns[0], 'institution_id', constraint.conname)
      assert.ok(
        indexColumns.some(
          (index) =>
            index.table_name === constraint.table_name &&
            constraint.columns.every((column, position) => index.columns[position] === column),
        ),
        `${constraint.conname} indeksli olmalı`,
      )
    }
    assert.equal(foreignKeys, 5)
  })

  test('DOM-YTK-056, 059: değişmezlik tetikleyicileri kurulu ve etkin', async () => {
    const triggers = await rows<{ table_name: string; tgname: string; proname: string }>(
      sql`select c.relname::text as table_name, t.tgname::text as tgname, p.proname::text as proname
          from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_proc p on p.oid = t.tgfoid
          where not t.tgisinternal and t.tgenabled = 'O' and c.relname in (${tableList})
          order by c.relname, t.tgname`,
    )
    assert.deepEqual(
      triggers.map((trigger) => [trigger.tgname, trigger.proname]),
      [
        ['consents_truncate_trigger', 'kampus_reject_consent_change'],
        ['consents_withdrawal_trigger', 'kampus_reject_consent_change'],
        ['notice_acknowledgements_immutable_trigger', 'kampus_reject_immutable_change'],
        ['notice_acknowledgements_truncate_trigger', 'kampus_reject_immutable_change'],
        ['privacy_notices_content_trigger', 'kampus_reject_privacy_notice_change'],
        ['privacy_notices_truncate_trigger', 'kampus_reject_privacy_notice_change'],
      ],
    )
  })

  test('DOM-YTK-056 metin sürümü konu başına tekil, yayımlanmış içerik değişmez; gösterim bir kez ve değişmez', async () => {
    const institutionId = await institution()
    const ids = await publish(institutionId)
    const notices = await listPrivacyNotices(db, institutionId)
    assert.deepEqual(
      notices.map((notice) => [notice.kind, notice.audience, notice.purpose, notice.version]),
      [
        ['consent_text', null, 'photo_video_sharing', 1],
        ['notice', 'veli', null, 1],
      ],
    )
    // Aynı kitle için aynı sürüm ikinci kez yazılamaz.
    await violates(
      insertPrivacyNotice(
        db,
        institutionId,
        {
          id: randomUUID(),
          kind: 'notice',
          audience: 'veli',
          purpose: null,
          version: 1,
          title: 'Kopya',
          body: 'Metin',
          requiresReconsent: false,
          publishedAt: NOW,
          publishedByUserId: 'test-u-admin',
        },
        FIXED_NOW,
      ),
      'privacy_notices_audience_version_key',
      '23505',
    )
    // Kitlesiz aydınlatma ya da amaçsız rıza metni kısıtla reddedilir.
    await violates(
      db.execute(
        sql`insert into privacy_notices (institution_id, id, kind, purpose, notice_version, title, body, published_at, published_by_user_id)
            values (${institutionId}, ${randomUUID()}, 'notice', 'photo_video_sharing', 9, 'A', 'B', now(), 'u')`,
      ),
      'privacy_notices_topic_check',
      '23514',
    )
    await rejectsChange(
      db
        .update(privacyNotices)
        .set({ body: 'Değişti' })
        .where(
          and(eq(privacyNotices.institutionId, institutionId), eq(privacyNotices.id, ids.notice)),
        ),
    )
    await rejectsChange(
      db
        .delete(privacyNotices)
        .where(
          and(eq(privacyNotices.institutionId, institutionId), eq(privacyNotices.id, ids.photo)),
        ),
    )

    const user = { userId: PARENT.userId, role: 'veli' as const }
    assert.equal(needsNoticeAcknowledgement(notices, [], user)?.id, ids.notice)
    const draft = planNoticeAcknowledgement({
      notices,
      acknowledgements: [],
      user,
      input: { noticeId: ids.notice, channel: 'mobile' },
      now: NOW,
    })
    const ackId = randomUUID()
    await insertNoticeAcknowledgement(db, institutionId, { id: ackId, ...draft }, FIXED_NOW)
    const acknowledgements = await listNoticeAcknowledgements(db, institutionId, PARENT.userId)
    assert.deepEqual(acknowledgements, [{ id: ackId, ...draft }])
    assert.equal(needsNoticeAcknowledgement(notices, acknowledgements, user), null)
    await violates(
      insertNoticeAcknowledgement(db, institutionId, { id: randomUUID(), ...draft }, FIXED_NOW),
      'notice_acknowledgements_user_notice_key',
      '23505',
    )
    await rejectsChange(
      db
        .update(noticeAcknowledgements)
        .set({ channel: 'web' })
        .where(eq(noticeAcknowledgements.institutionId, institutionId)),
    )
    // Gösterilmiş sürüm imha ayarıyla bile, gösterim durdukça silinemez (ispat; 23001 restrict).
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.execute(sql`set local kampus.allow_immutable_purge = 'on'`)
        await tx
          .delete(privacyNotices)
          .where(
            and(eq(privacyNotices.institutionId, institutionId), eq(privacyNotices.id, ids.notice)),
          )
      }),
      (error: unknown) => databaseErrorInfo(error)?.code === '23001',
    )
    // Arşiv içerik değişikliği değildir.
    await db
      .update(privacyNotices)
      .set({ archivedAt: FIXED_NOW, version: sql`${privacyNotices.version} + 1` })
      .where(and(eq(privacyNotices.institutionId, institutionId), eq(privacyNotices.id, ids.photo)))
    assert.equal((await listPrivacyNotices(db, institutionId)).length, 1)
  })

  test('DOM-YTK-058 kısmi benzersiz indeks aynı veri sahibi + amaç için ikinci etkin rızayı reddeder', async () => {
    const institutionId = await institution()
    const ids = await publish(institutionId)
    const first = await grant(institutionId, ids.photo)
    // Core mükerreri önce yakalar; veritabanı kısıtı eşzamanlı ikinci yazmayı da durdurur.
    await violates(
      insertConsent(db, institutionId, { id: randomUUID(), ...first.plan.consent }, FIXED_NOW),
      'consents_subject_purpose_decision_key',
      '23505',
    )
    // Başka amaç, başka veri sahibi ve itiraz (başka karar) aynı anda etkin olabilir.
    for (const fields of [
      { purpose: 'photo_video_website' as const },
      { subjectId: 'test-s2' },
      {
        decision: 'objected' as const,
        grantedByUserId: 'test-u-s1',
        grantorRelation: 'self' as const,
      },
    ])
      await insertConsent(
        db,
        institutionId,
        { id: randomUUID(), ...first.plan.consent, ...fields },
        FIXED_NOW,
      )
    // Başka kurumun aynı veri sahibi kimliği çakışmaz; ama başka kurumun metnine bağlanamaz.
    const other = await institution()
    await violates(
      insertConsent(db, other, { id: randomUUID(), ...first.plan.consent }, FIXED_NOW),
      'consents_text_fkey',
      '23503',
    )
    assert.equal(await findConsent(db, other, first.id), null)
    const stored = await findConsent(db, institutionId, first.id)
    assert.deepEqual(stored, { id: first.id, ...first.plan.consent, rowVersion: 1 })
    assert.equal(
      hasValidConsent(
        await listConsentsOfSubject(db, institutionId, { kind: 'student', id: MINOR.id }),
        { subjectId: MINOR.id, purpose: 'photo_video_sharing' },
        NOW,
      ),
      // Öğrencinin itirazı etkin.
      false,
    )
  })

  test('DOM-YTK-059 geri çekme aynı satıra bir kez yazılır; sonra yeni rıza açılabilir; satır başka türlü değişmez', async () => {
    const institutionId = await institution()
    const ids = await publish(institutionId)
    const {
      id,
      plan: { consent: first },
    } = await grant(institutionId, ids.photo)
    const stored = await findConsent(db, institutionId, id)
    assert.ok(stored)
    const later = new Date(FIXED_NOW.getTime() + 60_000)
    const closure = planConsentWithdrawal({
      actor: PARENT,
      consent: stored,
      student: MINOR,
      guardianBonds: BONDS,
      input: { consentId: id },
      now: later.toISOString(),
    })
    // Yanlış sürüm yazmaz (409), doğru sürüm bir kez yazar.
    assert.equal(await closeConsent(db, institutionId, { ...closure, rowVersion: 7 }, later), false)
    assert.equal(await closeConsent(db, institutionId, { ...closure, rowVersion: 1 }, later), true)
    assert.equal(await closeConsent(db, institutionId, { ...closure, rowVersion: 2 }, later), false)
    const withdrawn = await findConsent(db, institutionId, id)
    assert.deepEqual(
      [
        withdrawn?.withdrawnAt,
        withdrawn?.withdrawnByUserId,
        withdrawn?.withdrawalReason,
        withdrawn?.rowVersion,
      ],
      [later.toISOString(), PARENT.userId, 'withdrawn', 2],
    )
    assert.equal(
      hasValidConsent([withdrawn!], { subjectId: MINOR.id, purpose: 'photo_video_sharing' }, NOW),
      false,
    )
    // Geri çekme kolonları birlikte yazılır.
    await violates(
      insertConsent(
        db,
        institutionId,
        {
          ...first,
          id: randomUUID(),
          withdrawnAt: NOW,
          withdrawnByUserId: null,
          withdrawalReason: null,
        },
        FIXED_NOW,
      ),
      'consents_withdrawal_check',
      '23514',
    )
    // Geri çekilmiş satır ikinci kez geri çekilemez, değiştirilemez, arşivlenemez, silinemez.
    const byId = and(eq(consents.institutionId, institutionId), eq(consents.id, id))
    await rejectsChange(db.update(consents).set({ withdrawnAt: FIXED_NOW }).where(byId))
    await rejectsChange(db.update(consents).set({ archivedAt: FIXED_NOW }).where(byId))
    await rejectsChange(db.delete(consents).where(byId))
    // Yeni rıza açılabilir; açık satırın veri sahibi ya da amacı değiştirilemez.
    const second = await grant(institutionId, ids.photo)
    await rejectsChange(
      db
        .update(consents)
        .set({ purpose: 'photo_video_print' })
        .where(and(eq(consents.institutionId, institutionId), eq(consents.id, second.id))),
    )
    assert.deepEqual(
      (
        await listConsentsOfSubject(db, institutionId, {
          kind: 'student',
          id: MINOR.id,
          openOnly: true,
        })
      ).map((row) => row.id),
      [second.id],
    )
    // İmha işi silebilir.
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local kampus.allow_immutable_purge = 'on'`)
      await tx.delete(consents).where(byId)
    })
    assert.equal(await findConsent(db, institutionId, id), null)
  })
})
