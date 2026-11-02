import { randomUUID } from 'node:crypto'

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'

import type {
  LearnerKind,
  PlacementDecisionDraft,
  PlacementSectionEntry,
  PlacementSessionDraft,
  PlacementSessionRow,
} from '@kampus/school-core/cefr/placement.ts'
import type {
  ProgressionDecisionDraft,
  ProgressionDecisionRecord,
} from '@kampus/school-core/cefr/progression.ts'
import type { LevelDecisionRow } from '@kampus/school-core/cefr/suggestion.ts'
import type { PrimarySkill } from '@kampus/school-core/content/taxonomy.ts'

import type { Database } from './client.ts'
import { levelDecisions, placementSessions, progressionDecisions } from './schema/cefr.ts'

/**
 * CEFR deposu (OG-053; IST-058, IST-060, IST-062; ADR 0004 karar 8). Kurum kapsamlıdır: ilk
 * parametre `institutionId`. Yalnız satır okur ve yazar; kural (oturum açma, yerleştirme kararı,
 * kur sonu kararı) core `cefr/*` planlarındadır ve servis bu fonksiyonları onların çıktısıyla,
 * kurum kilidi altında tek işlemde çağırır. Arşivlenmiş satır okunmaz. `level_decisions`
 * değişmezdir; depo güncelleme sunmaz.
 */

/** Tespite giren kişi: öğrenci veya CRM adayı (`records` kimliği). */
export type Learner = { kind: LearnerKind; id: string }

/**
 * Saklanan tespit oturumu: core `PlacementSessionRow`, bölüm girişleri ve satır sürümü (iyimser
 * kilit; OG-054).
 */
export type StoredPlacementSession = PlacementSessionRow & {
  sectionEntries: PlacementSectionEntry[]
  rowVersion: number
  updatedAt: string
}

/** Seviye kararı satırı: core `LevelDecisionRow` ve kişisi; yerleştirmede tespit oturumu. */
export type StoredLevelDecision = LevelDecisionRow & {
  learnerKind: LearnerKind
  learnerId: string
  placementSessionId: string | null
}

/** Yazılacak seviye kararı. Yerleştirme kararı core `planPlacementDecision` çıktısıdır. */
export type LevelDecisionDraft =
  | PlacementDecisionDraft
  | (Omit<LevelDecisionRow, 'id' | 'kind'> & {
      kind: Exclude<LevelDecisionRow['kind'], 'placement'>
      learnerKind: LearnerKind
      learnerId: string
    })

const iso = (value: Date | null) => (value === null ? null : value.toISOString())

type SessionRow = typeof placementSessions.$inferSelect
type LevelRow = typeof levelDecisions.$inferSelect
type ProgressionRow = typeof progressionDecisions.$inferSelect

function toSession(row: SessionRow): StoredPlacementSession {
  return {
    sectionEntries: row.sectionEntries,
    rowVersion: row.version,
    updatedAt: row.updatedAt.toISOString(),
    id: row.id,
    learnerKind: row.learnerKind,
    learnerId: row.learnerId,
    formId: row.formId,
    formVersionId: row.formVersionId,
    mode: row.mode,
    startedAt: row.startedAt.toISOString(),
    completedAt: iso(row.completedAt),
  }
}

function toLevelDecision(row: LevelRow): StoredLevelDecision {
  return {
    id: row.id,
    kind: row.kind,
    skill: row.skill,
    level: row.level,
    rationale: row.rationale,
    decidedByUserId: row.decidedByUserId,
    decidedAt: row.decidedAt.toISOString(),
    evidenceSnapshot: row.evidenceSnapshot,
    learnerKind: row.learnerKind,
    learnerId: row.learnerId,
    placementSessionId: row.placementSessionId,
  }
}

function toProgression(row: ProgressionRow): ProgressionDecisionRecord {
  return {
    id: row.id,
    enrollmentId: row.enrollmentId,
    learnerId: row.learnerId,
    courseId: row.courseId,
    outcome: row.outcome,
    status: row.status,
    rationale: row.rationale,
    correctsDecisionId: row.correctsDecisionId,
    decidedByUserId: row.decidedByUserId,
    decidedAt: row.decidedAt.toISOString(),
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: iso(row.reviewedAt),
    rejectionReason: row.rejectionReason,
    basis: row.basis,
    evidenceSnapshot: row.evidenceSnapshot,
  }
}

// --- Seviye tespit oturumu ----------------------------------------------------------------

/** Core `planPlacementSession` çıktısını yazar. Süren ikinci oturum 23505 ile reddedilir. */
export async function insertPlacementSession(
  db: Database,
  institutionId: string,
  draft: PlacementSessionDraft,
  id: string = randomUUID(),
): Promise<StoredPlacementSession> {
  const [row] = await db
    .insert(placementSessions)
    .values({
      institutionId,
      id,
      learnerKind: draft.learnerKind,
      learnerId: draft.learnerId,
      formId: draft.formId,
      formVersionId: draft.formVersionId,
      mode: draft.mode,
      startedAt: new Date(draft.startedAt),
      completedAt: draft.completedAt === null ? null : new Date(draft.completedAt),
    })
    .returning()
  if (row === undefined) throw new Error('placement session insert returned no row')
  return toSession(row)
}

/** Kurumun tespit oturumu; yoksa ya da başka kurumunsa `null`. */
export async function findPlacementSession(
  db: Database,
  institutionId: string,
  sessionId: string,
): Promise<StoredPlacementSession | null> {
  const [row] = await db
    .select()
    .from(placementSessions)
    .where(
      and(
        eq(placementSessions.institutionId, institutionId),
        eq(placementSessions.id, sessionId),
        isNull(placementSessions.archivedAt),
      ),
    )
  return row === undefined ? null : toSession(row)
}

/**
 * Kişinin oturumları, başlangıca göre eskiden yeniye. Dönem süzgeci serviste
 * (`TODO(cefr-donem)`); core `planPlacementSession` ve `placementRequired` bunları alır.
 */
export async function listPlacementSessions(
  db: Database,
  institutionId: string,
  learner: Learner,
): Promise<StoredPlacementSession[]> {
  const rows = await db
    .select()
    .from(placementSessions)
    .where(
      and(
        eq(placementSessions.institutionId, institutionId),
        eq(placementSessions.learnerKind, learner.kind),
        eq(placementSessions.learnerId, learner.id),
        isNull(placementSessions.archivedAt),
      ),
    )
    .orderBy(asc(placementSessions.startedAt), asc(placementSessions.id))
  return rows.map(toSession)
}

/**
 * Oturumu sürüm koşuluyla günceller (bölüm girişi, bitiş, karar sonrası sürüm artışı; OG-054).
 * Verilmeyen alan değişmez; sürüm bir artar. Sürüm tutmazsa ya da oturum yoksa `null`.
 */
export async function savePlacementSession(
  db: Database,
  institutionId: string,
  sessionId: string,
  expectedVersion: number,
  patch: { sectionEntries?: readonly PlacementSectionEntry[]; completedAt?: string },
  now: Date,
): Promise<StoredPlacementSession | null> {
  const [row] = await db
    .update(placementSessions)
    .set({
      ...(patch.sectionEntries === undefined ? {} : { sectionEntries: [...patch.sectionEntries] }),
      ...(patch.completedAt === undefined ? {} : { completedAt: new Date(patch.completedAt) }),
      updatedAt: now,
      version: sql`${placementSessions.version} + 1`,
    })
    .where(
      and(
        eq(placementSessions.institutionId, institutionId),
        eq(placementSessions.id, sessionId),
        eq(placementSessions.version, expectedVersion),
        isNull(placementSessions.archivedAt),
      ),
    )
    .returning()
  return row === undefined ? null : toSession(row)
}

/** Oturumun seviye kararları (yerleştirme), karar anına göre eskiden yeniye. */
export async function listSessionDecisions(
  db: Database,
  institutionId: string,
  sessionId: string,
): Promise<StoredLevelDecision[]> {
  const rows = await db
    .select()
    .from(levelDecisions)
    .where(
      and(
        eq(levelDecisions.institutionId, institutionId),
        eq(levelDecisions.placementSessionId, sessionId),
        isNull(levelDecisions.archivedAt),
      ),
    )
    .orderBy(asc(levelDecisions.decidedAt), asc(levelDecisions.id))
  return rows.map(toLevelDecision)
}

// --- Seviye kararı ------------------------------------------------------------------------

/**
 * Seviye kararlarını ekler (yerleştirmede genel ve beceri satırları birlikte). Satırlar değişmez;
 * aynı oturumda aynı beceriye ikinci yerleştirme kararı 23505 ile reddedilir.
 */
export async function insertLevelDecisions(
  db: Database,
  institutionId: string,
  drafts: readonly LevelDecisionDraft[],
): Promise<StoredLevelDecision[]> {
  if (drafts.length === 0) return []
  const rows = await db
    .insert(levelDecisions)
    .values(
      drafts.map((draft) => ({
        institutionId,
        id: randomUUID(),
        learnerKind: draft.learnerKind,
        learnerId: draft.learnerId,
        kind: draft.kind,
        placementSessionId: draft.kind === 'placement' ? draft.placementSessionId : null,
        skill: draft.skill,
        level: draft.level,
        rationale: draft.rationale,
        decidedByUserId: draft.decidedByUserId,
        decidedAt: new Date(draft.decidedAt),
        evidenceSnapshot: draft.evidenceSnapshot,
      })),
    )
    .returning()
  return rows.map(toLevelDecision)
}

const learnerDecisions = (institutionId: string, learner: Learner) =>
  and(
    eq(levelDecisions.institutionId, institutionId),
    eq(levelDecisions.learnerKind, learner.kind),
    eq(levelDecisions.learnerId, learner.id),
    isNull(levelDecisions.archivedAt),
  )

/** Kişinin kararlarının zaman çizelgesi, en yeniden eskiye (core `cefrProfileView` sırası). */
export async function listLevelDecisions(
  db: Database,
  institutionId: string,
  learner: Learner,
): Promise<StoredLevelDecision[]> {
  const rows = await db
    .select()
    .from(levelDecisions)
    .where(learnerDecisions(institutionId, learner))
    .orderBy(desc(levelDecisions.decidedAt), desc(levelDecisions.id))
  return rows.map(toLevelDecision)
}

/**
 * Beceri başına (genel için `null`) güncel seviye: en son karar; aynı anda verilmişse kimliği
 * büyük olan (core `cefrProfileView` ile aynı eşitlik bozucu).
 */
export async function loadCurrentLevels(
  db: Database,
  institutionId: string,
  learner: Learner,
): Promise<{ skill: PrimarySkill | null; decision: StoredLevelDecision }[]> {
  const rows = await db
    .selectDistinctOn([levelDecisions.skill])
    .from(levelDecisions)
    .where(learnerDecisions(institutionId, learner))
    .orderBy(levelDecisions.skill, desc(levelDecisions.decidedAt), desc(levelDecisions.id))
  return rows.map((row) => ({ skill: row.skill, decision: toLevelDecision(row) }))
}

// --- Kur sonu kararı ----------------------------------------------------------------------

/**
 * Yazılacak kur sonu kararı: core `planProgressionDecision` çıktısı ve kaydın grubu. Grup, kararı
 * kayda, kursiyere ve kura bağlayan bileşik yabancı anahtarın parçasıdır (`language_group_members`
 * satırının `group_id`'si).
 */
export type GroupProgressionDraft = ProgressionDecisionDraft & { groupId: string }

/**
 * Kur sonu kararını yazar. Kayıtta ikinci açık karar 23505 ile; kaydın kursiyeri, grubu ya da
 * grubun kuru olmayan değer ve başka kaydın kararına düzeltme 23503 ile reddedilir.
 */
export async function insertProgressionDecision(
  db: Database,
  institutionId: string,
  draft: GroupProgressionDraft,
  id: string = randomUUID(),
): Promise<ProgressionDecisionRecord> {
  const [row] = await db
    .insert(progressionDecisions)
    .values({
      institutionId,
      id,
      enrollmentId: draft.enrollmentId,
      groupId: draft.groupId,
      courseId: draft.courseId,
      learnerId: draft.learnerId,
      outcome: draft.outcome,
      status: draft.status,
      rationale: draft.rationale,
      correctsDecisionId: draft.correctsDecisionId,
      decidedByUserId: draft.decidedByUserId,
      decidedAt: new Date(draft.decidedAt),
      reviewedByUserId: draft.reviewedByUserId,
      reviewedAt: draft.reviewedAt === null ? null : new Date(draft.reviewedAt),
      rejectionReason: draft.rejectionReason,
      basis: draft.basis,
      evidenceSnapshot: draft.evidenceSnapshot,
    })
    .returning()
  if (row === undefined) throw new Error('progression decision insert returned no row')
  return toProgression(row)
}

/**
 * Kur kaydının (`enrollmentId`) ya da kursiyerin (`learnerId`) kur sonu kararları, karar anına
 * göre eskiden yeniye; bekleyen, onaylı ve reddedilmiş hepsi (core `planProgressionDecision`
 * `existingDecisions`).
 */
export async function listProgressionDecisions(
  db: Database,
  institutionId: string,
  filter: { enrollmentId: string } | { learnerId: string },
): Promise<ProgressionDecisionRecord[]> {
  const rows = await db
    .select()
    .from(progressionDecisions)
    .where(
      and(
        eq(progressionDecisions.institutionId, institutionId),
        'enrollmentId' in filter
          ? eq(progressionDecisions.enrollmentId, filter.enrollmentId)
          : eq(progressionDecisions.learnerId, filter.learnerId),
        isNull(progressionDecisions.archivedAt),
      ),
    )
    .orderBy(asc(progressionDecisions.decidedAt), asc(progressionDecisions.id))
  return rows.map(toProgression)
}
