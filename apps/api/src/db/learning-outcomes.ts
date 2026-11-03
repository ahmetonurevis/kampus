import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm'
import { unionAll } from 'drizzle-orm/pg-core'

import {
  outcomeKey,
  type LearningOutcome,
  type LearningOutcomeInput,
  type OutcomeRef,
  type PlatformOutcomeSeed,
} from '@kampus/school-core/content/outcomes.ts'
import type { OutcomeSource } from '@kampus/school-core/content/taxonomy.ts'

import { ConflictError } from '../errors.ts'
import type { Database } from './client.ts'
import { learningOutcomes, platformLearningOutcomes } from './schema/learning-outcomes.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Kazanım kataloğu deposu (ADR 0004 karar 9; DOM-KYN-011). Kurum satırları kurum kapsamlıdır
 * (ilk parametre `institutionId`); platform satırları kurumdan bağımsızdır ve yalnız bakım
 * betiği yazar (`syncPlatformOutcomes`). Arşivli satır listeye yalnız `codes` ile istenirse girer.
 */

export interface StoredLearningOutcome extends LearningOutcome {
  createdAt: string
  /** Satır sürümü (`If-Match`); platform satırında da vardır ama HTTP'den yazılmaz. */
  rowVersion: number
}

export interface LearningOutcomeQuery {
  subject?: string | undefined
  level?: number | undefined
  q?: string | undefined
  source?: OutcomeSource | undefined
  /** Verilirse yalnız bu kodlar, arşivliler dahil (mevcut içeriğin kazanımlarını çözmek için). */
  codes?: readonly string[] | undefined
  page: number
  pageSize: number
}

const iso = (value: Date | null) => (value === null ? null : value.toISOString())

function platformFilter(query: LearningOutcomeQuery): SQL | undefined {
  const t = platformLearningOutcomes
  return and(
    query.codes === undefined ? isNull(t.archivedAt) : inArray(t.code, [...query.codes]),
    query.subject === undefined ? undefined : eq(t.subjectId, query.subject),
    query.level === undefined ? undefined : eq(t.gradeLevel, query.level),
    searchOf(t.code, t.name, query.q),
  )
}

function institutionFilter(institutionId: string, query: LearningOutcomeQuery): SQL | undefined {
  const t = learningOutcomes
  return and(
    eq(t.institutionId, institutionId),
    query.codes === undefined ? isNull(t.archivedAt) : inArray(t.code, [...query.codes]),
    query.subject === undefined ? undefined : eq(t.subjectId, query.subject),
    query.level === undefined ? undefined : eq(t.gradeLevel, query.level),
    searchOf(t.code, t.name, query.q),
  )
}

/** Kod ya da adda Türkçe harf duyarsız arama (`strpos`, joker yok). */
function searchOf(code: AnyColumn, name: AnyColumn, q: string | undefined): SQL | undefined {
  const term = q?.trim()
  if (!term) return undefined
  const folded = foldSearch(term)
  return or(
    sql`strpos(${foldSql(code)}, ${folded}) > 0`,
    sql`strpos(${foldSql(name)}, ${folded}) > 0`,
  )
}

/**
 * Platform ve kurum kataloğu birleşik, sayfalı (`GET /learning-outcomes`). Sıra: sınıf düzeyi, ders,
 * kaynak (önce öğretim programı), platform sırası, kod.
 */
export async function listLearningOutcomes(
  db: Database,
  institutionId: string,
  query: LearningOutcomeQuery,
): Promise<{ rows: StoredLearningOutcome[]; total: number }> {
  const p = platformLearningOutcomes
  const i = learningOutcomes
  const platformRows = db
    .select({
      source: sql<OutcomeSource>`'platform'`.as('source'),
      code: p.code,
      name: p.name,
      subjectId: p.subjectId,
      gradeLevel: p.gradeLevel,
      programVersion: sql<string | null>`${p.programVersion}`.as('program_version'),
      position: p.position,
      archivedAt: p.archivedAt,
      createdAt: p.createdAt,
      rowVersion: p.version,
    })
    .from(p)
    .where(platformFilter(query))
  const institutionRows = db
    .select({
      source: sql<OutcomeSource>`'institution'`.as('source'),
      code: i.code,
      name: i.name,
      subjectId: i.subjectId,
      gradeLevel: i.gradeLevel,
      programVersion: sql<string | null>`null`.as('program_version'),
      position: sql<number>`0`.as('position'),
      archivedAt: i.archivedAt,
      createdAt: i.createdAt,
      rowVersion: i.version,
    })
    .from(i)
    .where(institutionFilter(institutionId, query))
  const parts =
    query.source === 'platform'
      ? platformRows
      : query.source === 'institution'
        ? institutionRows
        : unionAll(platformRows, institutionRows)
  const rows = await parts
    .orderBy(
      asc(sql`grade_level`),
      asc(sql`subject_id`),
      // Birleşimin sırası yalnız çıktı kolon adıyla yazılır; `platform` > `institution`.
      desc(sql`source`),
      asc(sql`position`),
      asc(sql`code`),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  const [platformCount, institutionCount] = await Promise.all([
    query.source === 'institution'
      ? Promise.resolve([{ total: 0 }])
      : db.select({ total: count() }).from(p).where(platformFilter(query)),
    query.source === 'platform'
      ? Promise.resolve([{ total: 0 }])
      : db.select({ total: count() }).from(i).where(institutionFilter(institutionId, query)),
  ])
  return {
    rows: rows.map((row) => ({
      source: row.source,
      code: row.code,
      name: row.name,
      subjectId: row.subjectId,
      gradeLevel: row.gradeLevel,
      programVersion: row.programVersion,
      archivedAt: iso(row.archivedAt),
      createdAt: new Date(row.createdAt).toISOString(),
      rowVersion: row.rowVersion,
    })),
    total: (platformCount[0]?.total ?? 0) + (institutionCount[0]?.total ?? 0),
  }
}

function institutionView(row: typeof learningOutcomes.$inferSelect): StoredLearningOutcome {
  return {
    source: 'institution',
    code: row.code,
    name: row.name,
    subjectId: row.subjectId,
    gradeLevel: row.gradeLevel,
    programVersion: null,
    archivedAt: iso(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    rowVersion: row.version,
  }
}

/** Kurum kazanımı (arşivli dahil); yoksa `undefined`. */
export async function findInstitutionOutcome(
  db: Database,
  institutionId: string,
  code: string,
): Promise<StoredLearningOutcome | undefined> {
  const [row] = await db
    .select()
    .from(learningOutcomes)
    .where(and(eq(learningOutcomes.institutionId, institutionId), eq(learningOutcomes.code, code)))
  return row ? institutionView(row) : undefined
}

/** Kod platform kataloğunda var mı (arşivli dahil). */
export async function platformCodeExists(db: Database, code: string): Promise<boolean> {
  const [row] = await db
    .select({ code: platformLearningOutcomes.code })
    .from(platformLearningOutcomes)
    .where(eq(platformLearningOutcomes.code, code))
  return row !== undefined
}

export async function insertInstitutionOutcome(
  db: Database,
  institutionId: string,
  input: LearningOutcomeInput & { createdByUserId: string },
  now: Date,
): Promise<void> {
  await db.insert(learningOutcomes).values({
    institutionId,
    code: input.code,
    name: input.name,
    subjectId: input.subjectId,
    gradeLevel: input.gradeLevel,
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
  })
}

/** Arşiv; beklenen satır sürümü tutmazsa 409 `version_conflict`. */
export async function archiveInstitutionOutcome(
  db: Database,
  institutionId: string,
  code: string,
  expectedVersion: number,
  now: Date,
): Promise<void> {
  const updated = await db
    .update(learningOutcomes)
    .set({ archivedAt: now, updatedAt: now, version: sql`${learningOutcomes.version} + 1` })
    .where(
      and(
        eq(learningOutcomes.institutionId, institutionId),
        eq(learningOutcomes.code, code),
        eq(learningOutcomes.version, expectedVersion),
        isNull(learningOutcomes.archivedAt),
      ),
    )
    .returning({ code: learningOutcomes.code })
  if (updated.length === 0) throw new ConflictError()
}

/**
 * İstenen kazanım bağlantılarının katalog satırları (arşivli dahil), anahtar `outcomeKey`. Kaynak
 * yazımında yeni seçimin denetimi içindir (core `outcomeSelectionIssues`).
 */
export async function catalogRowsFor(
  db: Database,
  institutionId: string,
  refs: readonly OutcomeRef[],
): Promise<Map<string, { archivedAt: string | null }>> {
  const map = new Map<string, { archivedAt: string | null }>()
  const platformCodes = refs.filter((r) => r.outcomeSource === 'platform').map((r) => r.outcomeId)
  const ownCodes = refs.filter((r) => r.outcomeSource === 'institution').map((r) => r.outcomeId)
  if (platformCodes.length > 0) {
    const rows = await db
      .select({
        code: platformLearningOutcomes.code,
        archivedAt: platformLearningOutcomes.archivedAt,
      })
      .from(platformLearningOutcomes)
      .where(inArray(platformLearningOutcomes.code, platformCodes))
    for (const row of rows)
      map.set(outcomeKey({ outcomeSource: 'platform', outcomeId: row.code }), {
        archivedAt: iso(row.archivedAt),
      })
  }
  if (ownCodes.length > 0) {
    const rows = await db
      .select({ code: learningOutcomes.code, archivedAt: learningOutcomes.archivedAt })
      .from(learningOutcomes)
      .where(
        and(
          eq(learningOutcomes.institutionId, institutionId),
          inArray(learningOutcomes.code, ownCodes),
        ),
      )
    for (const row of rows)
      map.set(outcomeKey({ outcomeSource: 'institution', outcomeId: row.code }), {
        archivedAt: iso(row.archivedAt),
      })
  }
  return map
}

/** Senkron sonucu: eklenen yeni kod sayısı ve kurum koduyla çakıştığı için atlanan kodlar. */
export interface PlatformOutcomeSyncResult {
  inserted: number
  /** Platformda henüz olmayan ama bir kurumun kendi kodu olarak kullandığı kodlar (sıralı). */
  conflicts: string[]
}

/**
 * Platform bakım betiği (ADR 0004 karar 9; HTTP'den değil): verilen program satırlarını koda göre
 * ekler ya da günceller; satır değişmediyse sürüm artmaz. Tekrar çalıştırmak güvenlidir. Listede
 * olmayan satıra dokunulmaz (program geçişi ayrı adımdır; OG-132).
 *
 * Kod platform ve kurum kataloğunda tekildir (DOM-KYN-011): kurum kazanımı eklenirken platform kodu
 * reddedilir, burada da platformda olmayan ve bir kurumda kullanılan kod eklenmez, `conflicts` ile
 * raporlanır (sessiz ikilik olmasın; çözüm resmî program içe aktarımında, OG-132). Platformda zaten
 * olan kod güncellenir; kurum o kodu sonradan alamaz.
 */
export async function syncPlatformOutcomes(
  db: Database,
  rows: readonly PlatformOutcomeSeed[],
  now: Date,
): Promise<PlatformOutcomeSyncResult> {
  if (rows.length === 0) return { inserted: 0, conflicts: [] }
  const t = platformLearningOutcomes
  const codes = rows.map((row) => row.code)
  const [known, taken] = await Promise.all([
    db.select({ code: t.code }).from(t).where(inArray(t.code, codes)),
    db
      .selectDistinct({ code: learningOutcomes.code })
      .from(learningOutcomes)
      .where(inArray(learningOutcomes.code, codes)),
  ])
  const platformCodes = new Set(known.map((row) => row.code))
  const conflicts = [
    ...new Set(taken.map((row) => row.code).filter((code) => !platformCodes.has(code))),
  ].sort()
  const blocked = new Set(conflicts)
  const writable = rows.filter((row) => !blocked.has(row.code))
  if (writable.length === 0) return { inserted: 0, conflicts }
  const result = await db
    .insert(t)
    .values(
      writable.map((row) => ({
        code: row.code,
        programVersion: row.programVersion,
        subjectId: row.subjectId,
        gradeLevel: row.gradeLevel,
        name: row.name,
        position: row.position,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: t.code,
      set: {
        programVersion: sql`excluded.program_version`,
        subjectId: sql`excluded.subject_id`,
        gradeLevel: sql`excluded.grade_level`,
        name: sql`excluded.name`,
        position: sql`excluded.position`,
        updatedAt: now,
        version: sql`${t.version} + 1`,
      },
      setWhere: sql`(${t.programVersion}, ${t.subjectId}, ${t.gradeLevel}, ${t.name}, ${t.position}) is distinct from (excluded.program_version, excluded.subject_id, excluded.grade_level, excluded.name, excluded.position)`,
    })
    .returning({ inserted: sql<boolean>`xmax = 0` })
  return { inserted: result.filter((row) => row.inserted).length, conflicts }
}
