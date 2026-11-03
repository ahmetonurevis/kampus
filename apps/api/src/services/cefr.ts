import { randomUUID } from 'node:crypto'

import type { z } from 'zod'

import {
  PLACEMENT_ANSWER_SECTIONS,
  PLACEMENT_SECTIONS,
  placementEvidence,
  placementSectionLevel,
  placementSectionResults,
  placementSectionRow,
  placementSummary,
  placementValidity,
  planPlacementCompletion,
  planPlacementDecision,
  planPlacementSectionEntry,
  planPlacementSession,
  type placementDecisionInputSchema,
  type placementScoreInputSchema,
  type LearnerKind,
  type PlacementSection,
  type PlacementSectionRow,
  type PlacementSectionScoring,
  type PlacementSessionDraft,
} from '@kampus/school-core/cefr/placement.ts'
import {
  canViewCefrProfile,
  cefrProfileView,
  suggestCefrLevels,
  type CefrSuggestion,
  type LevelDecisionRow,
} from '@kampus/school-core/cefr/suggestion.ts'
import { decisionEvidence, levelTimeline } from '@kampus/school-core/cefr/timeline.ts'
import { SKILLS, type PrimarySkill } from '@kampus/school-core/content/taxonomy.ts'
import {
  coordinatorScopeOf,
  NO_COORDINATOR_SCOPE,
} from '@kampus/school-core/lib/coordinator-duties.ts'
import { canReadGroup } from '@kampus/school-core/lib/language-groups.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import type { RubricVersionData } from '@kampus/school-core/skills/rubric.ts'

import {
  findPlacementSession,
  insertLevelDecisions,
  insertPlacementSession,
  levelDeciderNames,
  listLevelDecisions,
  listPlacementSessions,
  listSessionDecisions,
  savePlacementSession,
  type StoredLevelDecision,
  type StoredPlacementSession,
} from '../db/cefr.ts'
import type { Database } from '../db/client.ts'
import { activeDutiesOf } from '../db/coordinator-duties.ts'
import { loadCourses } from '../db/courses.ts'
import { loadGroups, loadMembershipsOfStudents } from '../db/language-groups.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { loadVersionPairs } from '../db/resources.ts'
import { findRubricVersion } from '../db/skills.ts'
import { LEARNER_COLLECTIONS } from '../db/schema/cefr.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { loadTaskEvidence, type EvidenceAudience } from './cefr-evidence.ts'
import { getInstitution, listMembershipLinks } from './memberships.ts'
import { viewerOf, visible } from './task-assignments.ts'
import {
  mapOperationError,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { auditWork, questionsFor, versionScoringContext, type ScoringContext } from './task-work.ts'

/**
 * Seviye tespiti ve CEFR profili (OG-054; IST-058, IST-060; docs/domain/dil-okulu.md
 * DOM-DIL-010…012, docs/domain/beceri-gelisimi.md DOM-BEC-030…034; ADR 0004 karar 5, 8). Kural
 * core `cefr/placement.ts` ve `cefr/suggestion.ts`'tedir; burada yükleme, okuma kapsamı, sürüm
 * denetimi ve yazma vardır. Uçlar yalnız dil okulundadır (rota). Her yazma tek transaction ve
 * kurum kilidi altındadır (`runCommand`); gövdedeki `version` oturumun satır sürümüdür. Öneri,
 * bölüm puanı ve geçerlilik saklanmaz, her okumada hesaplanır. Denetime yalnız alan adları yazılır.
 */

const ENTITY = 'placement_session'
const entity = (sessionId: string) => ({ type: ENTITY, id: sessionId })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const decider = (ctx: ServiceContext) => ({ userId: ctx.actor.userId, role: ctx.actor.role })

/** Kurum kilidi altında okunan kurum türü; kurum yoksa 404. */
async function institutionTypeOf(db: Database, ctx: ServiceContext) {
  const institution = await getInstitution(db, ctx.institutionId)
  if (institution === null) throw new NotFoundError()
  return institution.type
}

// --- Bölüm puanlaması --------------------------------------------------------------------

type FormScoring = {
  /** Formun otomatik bölümleri: bölüm başına maddeler ve hedef seviye. */
  auto: Map<PlacementSection, Extract<PlacementSectionScoring, { mode: 'auto' }>>
  /** Soru görünümü (`questionsFor`) için formun puanlama bağlamı. */
  context: ScoringContext
}

/**
 * Formun bölüm maddeleri: puanlama bağlamının maddeleri soru sürümünün birincil becerisine göre
 * bölümlere ayrılır; bölümün hedef seviyesi soruların ortak seviyesidir (core
 * `placementSectionLevel`).
 */
function formScoringOf(context: ScoringContext): FormScoring {
  const auto: FormScoring['auto'] = new Map()
  for (const section of Object.keys(PLACEMENT_SECTIONS) as PlacementSection[]) {
    if (PLACEMENT_SECTIONS[section].scoring !== 'auto') continue
    const items = context.items.filter(
      (item) => context.versions.get(item.questionVersionId)?.tags.primarySkill === section,
    )
    if (items.length === 0) continue
    auto.set(section, {
      mode: 'auto',
      items,
      targetLevel: placementSectionLevel(
        items.map((item) => context.versions.get(item.questionVersionId)?.tags.cefrLevel ?? null),
      ),
    })
  }
  return { auto, context }
}

async function loadFormScoring(db: Database, ctx: ServiceContext, formVersionId: string) {
  return formScoringOf(await versionScoringContext(db, ctx.institutionId, formVersionId))
}

/** Rubrikli bölüm için rubrik sürümü; kurumda yoksa 404. */
async function loadRubric(
  db: Database,
  ctx: ServiceContext,
  rubricVersionId: string,
): Promise<RubricVersionData & { status: string }> {
  const version = UUID.test(rubricVersionId)
    ? await findRubricVersion(db, ctx.institutionId, rubricVersionId)
    : null
  if (version === null) {
    throw mapOperationError(
      new DomainError('rubric_version_not_found', 'Rubrik sürümü bulunamadı.', {
        kind: 'not_found',
        path: ['rubricVersionId'],
      }),
    )
  }
  return version
}

/**
 * Oturumun bölüm sonuçları (`PlacementSectionRow`): girilen bölüm puanlanmış, formda olup
 * girilmemiş otomatik bölüm ve girilmemiş rubrikli bölüm puanlanmamış satırdır.
 */
async function sectionRowsOf(
  db: Database,
  ctx: ServiceContext,
  session: StoredPlacementSession,
  form: FormScoring,
): Promise<PlacementSectionRow[]> {
  const rows: PlacementSectionRow[] = []
  for (const section of Object.keys(PLACEMENT_SECTIONS) as PlacementSection[]) {
    const entry = session.sectionEntries.find((item) => item.section === section)
    const auto = form.auto.get(section)
    if (entry === undefined) {
      if (PLACEMENT_SECTIONS[section].scoring === 'rubric' || auto !== undefined)
        rows.push({ section, resultId: null, targetLevel: null, result: null })
      continue
    }
    if (entry.mode === 'auto') {
      if (auto === undefined) continue
      rows.push(placementSectionRow(session.id, entry, auto))
      continue
    }
    const rubric = await loadRubric(db, ctx, entry.rubricVersionId)
    rows.push(placementSectionRow(session.id, entry, { mode: 'rubric', rubric }))
  }
  return rows
}

// --- Görünüm ------------------------------------------------------------------------------

function suggestionView(suggestion: CefrSuggestion) {
  return {
    context: suggestion.context,
    computedAt: suggestion.computedAt,
    overall: suggestion.overall,
    skills: (Object.keys(suggestion.skills) as PrimarySkill[]).map((skill) => {
      const s = suggestion.skills[skill]
      return {
        skill,
        label: SKILLS[skill].label,
        status: s.status,
        level: s.status === 'suggested' ? s.level : null,
        plus: s.status === 'suggested' && s.plus,
        demonstratedBy: s.status === 'suggested' ? s.demonstratedBy : null,
        missingEvidence: s.status === 'suggested' ? 0 : s.missingEvidence,
        missingItems: s.status === 'suggested' ? 0 : s.missingItems,
        evidenceIds: s.evidenceIds,
      }
    }),
  }
}

function decisionView(decision: StoredLevelDecision | LevelDecisionRow) {
  return {
    id: decision.id,
    kind: decision.kind,
    skill: decision.skill,
    level: decision.level,
    rationale: decision.rationale,
    decidedByUserId: decision.decidedByUserId,
    decidedAt: decision.decidedAt,
    placementSessionId: 'placementSessionId' in decision ? decision.placementSessionId : null,
  }
}

const skillRank = (skill: PrimarySkill | null) =>
  skill === null ? -1 : Object.keys(SKILLS).indexOf(skill)
const bySkill = (a: StoredLevelDecision, b: StoredLevelDecision) =>
  a.decidedAt.localeCompare(b.decidedAt) || skillRank(a.skill) - skillRank(b.skill)

async function sessionView(db: Database, ctx: ServiceContext, session: StoredPlacementSession) {
  const form = await loadFormScoring(db, ctx, session.formVersionId)
  const rows = await sectionRowsOf(db, ctx, session, form)
  const summary = placementSummary({ session, sections: rows, now: ctx.now })
  const decisions = await listSessionDecisions(db, ctx.institutionId, session.id)
  const results = placementSectionResults(rows)
  return {
    id: session.id,
    learnerKind: session.learnerKind,
    learnerId: session.learnerId,
    formId: session.formId,
    formVersionId: session.formVersionId,
    mode: session.mode,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    version: session.rowVersion,
    updatedAt: session.updatedAt,
    sections: results.map((result) => {
      const row = rows.find((item) => item.section === result.section)
      const entry = session.sectionEntries.find((item) => item.section === result.section)
      return {
        ...result,
        targetLevel: row?.targetLevel ?? null,
        enteredByUserId: entry?.enteredByUserId ?? null,
        enteredAt: entry?.enteredAt ?? null,
      }
    }),
    validity: summary.validity,
    preliminary: summary.preliminary,
    suggestion: suggestionView(summary.suggestion),
    // Aynı anda verilen satırlar: önce genel seviye, sonra beceri sırası.
    decisions: decisions.sort(bySkill).map(decisionView),
  }
}

// --- Okuma kapsamı ------------------------------------------------------------------------

/**
 * Öğretmenin kursiyeri görmesi (IST-060): kursiyerin grubunu okuyabilmesi (kendi grubu ya da
 * akademik koordinatörü olduğu seviyenin grubu; core `canReadGroup`). Kapsam yalnız ETKİN grup
 * üyeliğiyle kurulur: dondurulan ya da gruptan ayrılan (arşivlenen) kursiyerin eski öğretmeni
 * profile ve tespitlere ulaşamaz (404). Beceri ilerleme panosu da kullanır (DOM-BEC-035).
 */
export async function teacherReaches(
  db: Database,
  ctx: ServiceContext,
  studentId: string,
): Promise<boolean> {
  const [memberships, groups, courses, duties] = await Promise.all([
    loadMembershipsOfStudents(db, ctx.institutionId, [studentId]),
    loadGroups(db, ctx.institutionId),
    loadCourses(db, ctx.institutionId),
    activeDutiesOf(db, ctx.institutionId, ctx.actor.membershipId),
  ])
  const reader = {
    role: ctx.actor.role,
    membershipId: ctx.actor.membershipId,
    coordination: duties.length === 0 ? NO_COORDINATOR_SCOPE : coordinatorScopeOf(duties),
    studentIds: [] as string[],
  }
  const members = memberships.filter((member) => member.status === 'active')
  const courseOf = new Map(courses.map((course) => [course.id, course]))
  return members.some((member) => {
    const group = groups.find((item) => item.id === member.groupId)
    const course = group === undefined ? undefined : courseOf.get(group.courseId)
    return (
      group !== undefined && course !== undefined && canReadGroup(reader, group, course, members)
    )
  })
}

/**
 * Tespit uçlarında kişi kapsamı (IST-058, IST-060): yönetici kurumun her kişisine, öğretmen yalnız
 * grubundan okuyabildiği öğrenciye ulaşır; kapsam dışı öğrenci 404 (varlık sızmaz). Aday (CRM
 * `prospect`) henüz bir gruba bağlı olmadığından her öğretmen adayın tespitini yürütebilir.
 */
async function assertLearnerReach(
  db: Database,
  ctx: ServiceContext,
  learner: { learnerKind: LearnerKind; learnerId: string },
) {
  if (ctx.actor.role === 'yonetici' || learner.learnerKind === 'prospect') return
  if (!(await teacherReaches(db, ctx, learner.learnerId))) throw new NotFoundError()
}

// --- Okuma --------------------------------------------------------------------------------

/** Tek oturum; olmayan ya da başka kurumun oturumu 404. */
export async function getPlacementSession(ctx: ServiceContext, sessionId: string) {
  const session = UUID.test(sessionId)
    ? await findPlacementSession(ctx.db, ctx.institutionId, sessionId)
    : null
  if (session === null) throw new NotFoundError()
  await assertLearnerReach(ctx.db, ctx, session)
  return sessionView(ctx.db, ctx, session)
}

/**
 * Oturumun tespit formu (OG-078, IST-058): otomatik bölümlerin soruları, cevap girişi için.
 * Bölümler `PLACEMENT_SECTIONS` sırasıyla, yalnız formda sorusu olanlar; soru gövdesi anahtarsızdır
 * (doğru cevap ve açıklama gönderilmez). Seçenekler ve öğeler kursiyer görünümüyle aynı çekirdek
 * karıştırmayla (`learnerView`) dizilir: sıralama öğeleri doğru sırada, eşleştirme seçenekleri
 * öncülle hizalı görünmez. Tohum `oturumKimliği:soruSürümüKimliği`'dir, aynı oturum yeniden
 * açılınca sıra değişmez. Kapsam oturum okumasıyla aynıdır: olmayan, başka kurumun ya da
 * öğretmenin kapsamı dışındaki oturum 404.
 */
export async function getPlacementForm(ctx: ServiceContext, sessionId: string) {
  const session = UUID.test(sessionId)
    ? await findPlacementSession(ctx.db, ctx.institutionId, sessionId)
    : null
  if (session === null) throw new NotFoundError()
  await assertLearnerReach(ctx.db, ctx, session)
  const form = await loadFormScoring(ctx.db, ctx, session.formVersionId)
  return {
    sessionId: session.id,
    formVersionId: session.formVersionId,
    sections: PLACEMENT_ANSWER_SECTIONS.flatMap((section) => {
      const scoring = form.auto.get(section)
      if (scoring === undefined) return []
      return [
        {
          section,
          targetLevel: scoring.targetLevel,
          items: questionsFor({ ...form.context, items: [...scoring.items] }, session.id),
        },
      ]
    }),
  }
}

/**
 * Kişinin oturumları, başlangıca göre eskiden yeniye (özet; bölüm ve öneri tek oturumda).
 * Öğretmenin kapsamı dışındaki öğrenci 404.
 */
export async function listLearnerPlacementSessions(
  ctx: ServiceContext,
  learner: { learnerKind: LearnerKind; learnerId: string },
) {
  await assertLearnerReach(ctx.db, ctx, learner)
  const sessions = await listPlacementSessions(ctx.db, ctx.institutionId, {
    kind: learner.learnerKind,
    id: learner.learnerId,
  })
  return sessions.map((session) => ({
    id: session.id,
    learnerKind: session.learnerKind,
    learnerId: session.learnerId,
    formId: session.formId,
    formVersionId: session.formVersionId,
    mode: session.mode,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    version: session.rowVersion,
    validity: placementValidity(session, ctx.now),
  }))
}

// --- Yazma --------------------------------------------------------------------------------

function respond(out: { body?: unknown }, statusCode: number) {
  return () => {
    if (out.body === undefined) throw new Error('placement session was not written')
    return { statusCode, body: out.body }
  }
}

/** Kişi kurumun öğrenci ya da aday kaydı olmalı; değilse 404 (başka kurumun kaydı sızmaz). */
async function assertLearner(db: Database, ctx: ServiceContext, kind: LearnerKind, id: string) {
  const [record] = await loadRecordsByIds(db, ctx.institutionId, LEARNER_COLLECTIONS[kind], [id])
  if (record === undefined) {
    throw mapOperationError(
      new DomainError('placement_learner_not_found', 'Kişi bulunamadı.', {
        kind: 'not_found',
        path: ['learnerId'],
      }),
    )
  }
}

/** Form kurumun bölümlü quiz kaynağının sürümü olmalı; değilse 404 ya da 422. */
async function assertForm(db: Database, ctx: ServiceContext, formId: string, versionId: string) {
  const pairs = await loadVersionPairs(db, ctx.institutionId, [versionId])
  const pair = pairs.get(versionId)
  if (pair === undefined || pair.resource.id !== formId) {
    throw mapOperationError(
      new DomainError('placement_form_not_found', 'Tespit formu bulunamadı.', {
        kind: 'not_found',
        path: ['formVersionId'],
      }),
    )
  }
  if (pair.version.content?.type !== 'quiz') {
    throw mapOperationError(
      new DomainError('placement_form_invalid', 'Tespit formu bölümlü bir quiz olmalıdır.', {
        path: ['formVersionId'],
      }),
    )
  }
}

/**
 * Tespit oturumu açar (DOM-DIL-010, 012; core `planPlacementSession`). Kişinin süren oturumu varsa
 * ya da dönem sınırı dolduysa 409; ikinci tespit aynı formla 422. Başarı 201.
 */
// TODO(cefr-donem): Dönem sınırı tanımlanana kadar kişinin bütün oturumları sayılır (en
// muhafazakâr yorum: iki tespitten sonra yeni oturum açılmaz).
export function openPlacementSession(
  ctx: ServiceContext,
  input: { learnerKind: LearnerKind; learnerId: string; formId: string; formVersionId: string },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  const id = randomUUID()
  return runCommand<{ draft: PlacementSessionDraft }>(
    ctx,
    {
      action: 'placement_session.open',
      collections: [],
      entity: entity(id),
      load: async (tx) => {
        const institutionType = await institutionTypeOf(tx, ctx)
        await assertLearner(tx, ctx, input.learnerKind, input.learnerId)
        await assertLearnerReach(tx, ctx, input)
        await assertForm(tx, ctx, input.formId, input.formVersionId)
        const termSessions = await listPlacementSessions(tx, ctx.institutionId, {
          kind: input.learnerKind,
          id: input.learnerId,
        })
        return {
          run: () => {
            const draft = planPlacementSession({
              institutionType,
              termSessions,
              input,
              now: ctx.now,
            })
            return { draft }
          },
        }
      },
      after: async (tx, { draft }) => {
        const session = await insertPlacementSession(tx, ctx.institutionId, draft, id)
        await auditWork(tx, ctx, 'placement_session.open', entity(id), [
          'learnerKind',
          'learnerId',
          'formId',
          'formVersionId',
          'mode',
        ])
        out.body = { data: await sessionView(tx, ctx, session) }
      },
    },
    respond(out, 201),
    idempotency,
  )
}

/**
 * Var olan oturuma komut: kurum kilidi altında yükler; oturum yoksa ya da kişisi kapsam dışıysa
 * 404, gövdedeki `version` tutmazsa 409 (plandan önce). Plan oturumun yeni alanlarını verir; sürüm
 * koşuluyla yazılır.
 */
function runSessionCommand<R>(
  ctx: ServiceContext,
  command: {
    action: string
    sessionId: string
    expectedVersion: number
    plan: (
      tx: Database,
      session: StoredPlacementSession,
      institutionType: Awaited<ReturnType<typeof institutionTypeOf>>,
    ) => Promise<() => R>
    write: (tx: Database, session: StoredPlacementSession, result: R) => Promise<string[]>
  },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  return runCommand<{ session: StoredPlacementSession; result: R }>(
    ctx,
    {
      action: command.action,
      collections: [],
      entity: entity(command.sessionId),
      load: async (tx) => {
        const session = UUID.test(command.sessionId)
          ? await findPlacementSession(tx, ctx.institutionId, command.sessionId)
          : null
        if (session === null) throw new NotFoundError()
        await assertLearnerReach(tx, ctx, session)
        if (session.rowVersion !== command.expectedVersion) throw new ConflictError()
        const institutionType = await institutionTypeOf(tx, ctx)
        const run = await command.plan(tx, session, institutionType)
        return { run: () => ({ session, result: run() }) }
      },
      after: async (tx, { session, result }) => {
        const fields = await command.write(tx, session, result)
        await auditWork(tx, ctx, command.action, entity(session.id), fields)
        const saved = await findPlacementSession(tx, ctx.institutionId, session.id)
        if (saved === null) throw new NotFoundError()
        out.body = { data: await sessionView(tx, ctx, saved) }
      },
    },
    respond(out, 200),
    idempotency,
  )
}

async function saveOrConflict(
  tx: Database,
  ctx: ServiceContext,
  session: StoredPlacementSession,
  patch: Parameters<typeof savePlacementSession>[4],
) {
  const saved = await savePlacementSession(
    tx,
    ctx.institutionId,
    session.id,
    session.rowVersion,
    patch,
    ctx.now,
  )
  if (saved === null) throw new ConflictError()
}

/** Bölüm girişi gövdesi: core `placementScoreInputSchema` çıktısı (`version` dahil). */
export type PlacementScoreBody = z.output<typeof placementScoreInputSchema>

/**
 * Bölüm puanı girişi (DOM-DIL-010; core `planPlacementSectionEntry`): otomatik bölümde cevaplar
 * formun anahtarıyla, rubrikli bölümde bantlar rubrik sürümüyle puanlanır. Bölüm bir kez girilir
 * (409 `placement_section_scored`); karar verilmiş oturumda giriş yok (409).
 */
export function scorePlacementSection(
  ctx: ServiceContext,
  sessionId: string,
  body: PlacementScoreBody,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return runSessionCommand(
    ctx,
    {
      action: 'placement_session.score',
      sessionId,
      expectedVersion: body.version,
      plan: async (tx, session, institutionType) => {
        const decided = (await listSessionDecisions(tx, ctx.institutionId, session.id)).length > 0
        let scoring: PlacementSectionScoring
        if ('answers' in body) {
          const form = await loadFormScoring(tx, ctx, session.formVersionId)
          scoring = form.auto.get(body.section) ?? { mode: 'auto', items: [], targetLevel: null }
        } else {
          const rubric = await loadRubric(tx, ctx, body.rubricVersionId)
          if (rubric.status !== 'published') {
            throw mapOperationError(
              new DomainError(
                'rubric_version_unpublished',
                'Yalnız yayındaki rubrik sürümüyle puanlanır.',
                { kind: 'conflict', path: ['rubricVersionId'] },
              ),
            )
          }
          // Yazma bölümü yazma, konuşma bölümü konuşma rubriğiyle puanlanır; başka becerinin
          // kriterleri bölümün seviye kanıtı olamaz.
          if (rubric.skill !== body.section) {
            throw mapOperationError(
              new DomainError(
                'placement_rubric_skill_mismatch',
                'Rubriğin becerisi puanlanan bölümle aynı olmalıdır.',
                { path: ['rubricVersionId'] },
              ),
            )
          }
          scoring = { mode: 'rubric', rubric }
        }
        return () =>
          planPlacementSectionEntry({
            institutionType,
            session,
            entries: session.sectionEntries,
            decided,
            scorer: decider(ctx),
            scoring,
            input: body,
            now: ctx.now,
          })
      },
      write: async (tx, session, entry) => {
        await saveOrConflict(tx, ctx, session, {
          sectionEntries: [...session.sectionEntries, entry],
        })
        return ['sectionEntries', entry.section]
      },
    },
    idempotency,
  )
}

/** Oturumu bitirir (DOM-DIL-012; core `planPlacementCompletion`); bitmiş oturum 409. */
export function completePlacementSession(
  ctx: ServiceContext,
  sessionId: string,
  body: { version: number },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return runSessionCommand(
    ctx,
    {
      action: 'placement_session.complete',
      sessionId,
      expectedVersion: body.version,
      plan: async (_tx, session, institutionType) => () =>
        planPlacementCompletion({ institutionType, session, decider: decider(ctx), now: ctx.now }),
      write: async (tx, session, result) => {
        await saveOrConflict(tx, ctx, session, { completedAt: result.completedAt })
        return ['completedAt']
      },
    },
    idempotency,
  )
}

/**
 * Karar gövdesi: core `placementDecisionInputSchema` çıktısı; oturum kimliği yoldan gelir, `version`
 * satır sürümüdür (rota şeması `decidePlacementBodySchema`).
 */
export type PlacementDecisionBody = Omit<
  z.output<typeof placementDecisionInputSchema>,
  'sessionId'
> & { version: number }

/**
 * Yerleştirme kararı (DOM-DIL-010…012; core `planPlacementDecision`): genel ve isteğe bağlı beceri
 * seviyeleri `level_decisions` satırı olur, karar anının önerisi kopya olarak yazılır. Oturum
 * sürümü bir artar; ikinci karar 409.
 */
// TODO(cefr-gorev-kaniti): Öğrencinin görev kanıtları (F4a sonuçları) tespit önerisine henüz
// yüklenmiyor; öneri yalnız oturumun bölümlerinden çıkar.
export function decidePlacement(
  ctx: ServiceContext,
  sessionId: string,
  body: PlacementDecisionBody,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return runSessionCommand(
    ctx,
    {
      action: 'placement_session.decide',
      sessionId,
      expectedVersion: body.version,
      plan: async (tx, session, institutionType) => {
        const form = await loadFormScoring(tx, ctx, session.formVersionId)
        const sections = await sectionRowsOf(tx, ctx, session, form)
        const existingDecisions = (
          await listSessionDecisions(tx, ctx.institutionId, session.id)
        ).flatMap((decision) =>
          decision.placementSessionId === null
            ? []
            : [{ placementSessionId: decision.placementSessionId }],
        )
        return () =>
          planPlacementDecision({
            institutionType,
            session,
            sections,
            existingDecisions,
            decider: decider(ctx),
            // Core şeması `version`'ı (sürüm denetimi yukarıda) almaz, düşürür.
            input: { ...body, sessionId: session.id },
            now: ctx.now,
          })
      },
      write: async (tx, session, plan) => {
        await insertLevelDecisions(tx, ctx.institutionId, plan.decisions)
        await saveOrConflict(tx, ctx, session, {})
        return ['level', 'skillLevels', 'rationale']
      },
    },
    idempotency,
  )
}

// --- CEFR profili -------------------------------------------------------------------------

/**
 * Öğrencinin "Tahmini seviye" önerisi (DOM-BEC-030, 031): değerlendirme görevlerinin sonuçları
 * (`cefr-evidence.ts`, OG-247) ve bitmiş tespit oturumlarının bölümleri. Profil ve kur sonu
 * kararının kopyası (`evidenceSnapshot`, DOM-DIL-070) personel görünümündeki aynı öneriyi kullanır;
 * öğrenci ve veli görünümünde yalnız geri bildirimi açılmış puan kanıttır (DOM-BEC-045). `links`
 * görev kanıtının atamasını ve puanlama türünü verir (ekran kanıt görevine bağlanır).
 */
export async function learnerSuggestion(
  db: Database,
  ctx: ServiceContext,
  studentId: string,
  audience: EvidenceAudience = 'staff',
) {
  const sessions = await listPlacementSessions(db, ctx.institutionId, {
    kind: 'student',
    id: studentId,
  })
  const tasks = await loadTaskEvidence(db, ctx, studentId, audience)
  const candidates = [...tasks.candidates]
  for (const session of sessions) {
    if (session.completedAt === null) continue
    const form = await loadFormScoring(db, ctx, session.formVersionId)
    candidates.push(...placementEvidence(session, await sectionRowsOf(db, ctx, session, form)))
  }
  return {
    sessions,
    links: tasks.links,
    suggestion: suggestCefrLevels({ candidates, now: ctx.now }),
  }
}

/**
 * Kursiyerin CEFR profili (IST-060; DOM-BEC-034; core `cefrProfileView`): beceri başına güncel
 * seviye (insan kararı), "Tahmini seviye" önerisi ve dayandığı kanıtlar, karar zaman çizelgesi.
 * Öğrenci kendisi, veli bağlı çocuğu, öğretmen kursiyerin grubuna göre, yönetici herkesi görür;
 * göremediği ya da olmayan öğrenci 404 (varlık sızmaz). Öğrenci ve veli `learner` görünümünü alır
 * (kararın gerekçesi ve vereni yok), personel `staff` görünümünü.
 */
// TODO(cefr-aday-donusum): Profil yalnız öğrenci kimliğini okur; aday döneminde yapılan tespit ve
// yerleştirme kararı aday kimliğinde kalır ve dönüşümden sonra burada görünmez
// (docs/domain/beceri-gelisimi.md DOM-BEC-034 notu).
export async function getCefrProfile(ctx: ServiceContext, studentId: string) {
  const [record] = await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', [studentId])
  if (record === undefined) throw new NotFoundError()
  const links = await listMembershipLinks(ctx.db, ctx.institutionId, ctx.actor.membershipId)
  const actor = { role: ctx.actor.role, links, userId: ctx.actor.userId }
  if (!canViewCefrProfile(actor, studentId)) throw new NotFoundError()
  if (ctx.actor.role === 'ogretmen' && !(await teacherReaches(ctx.db, ctx, studentId)))
    throw new NotFoundError()

  const learner = { kind: 'student' as const, id: studentId }
  const learnerView = ctx.actor.role === 'ogrenci' || ctx.actor.role === 'veli'
  const {
    sessions,
    links: taskLinks,
    suggestion,
  } = await learnerSuggestion(ctx.db, ctx, studentId, learnerView ? 'learner' : 'staff')
  const [decisions, viewer] = await Promise.all([
    listLevelDecisions(ctx.db, ctx.institutionId, learner),
    viewerOf(ctx),
  ])
  const view = cefrProfileView({ institutionType: 'language_school', suggestion, decisions })
  // Görev bağlantısı yalnız izleyicinin görev ucunda görebildiği atamaya çizilir (`linkable`):
  // kapsam kuralı görev uçlarınınkiyle aynı fonksiyondur (`visible`). Öğretmen kursiyerin başka
  // öğretmenden aldığı görevi, öğrenci eski grubunun görevini açamaz; kanıt yine sayılır.
  const taskOf = (id: string) => {
    const link = taskLinks.get(id)
    return link === undefined
      ? null
      : {
          assignmentId: link.assignmentId,
          scoring: link.scoring,
          linkable: visible(viewer, link.assignment),
        }
  }
  // Çizelge core `levelTimeline` ile: en yeniden eskiye, aynı becerinin önceki kararına göre
  // değişim (OG-079). Sıra `view.decisions.history` ile aynıdır.
  const timeline = levelTimeline(decisions)
  const shared = {
    studentId,
    title: view.title,
    estimate: {
      label: view.estimate.label,
      ...suggestionView(suggestion),
      evidence: view.estimate.evidence.map((e) => ({
        id: e.id,
        title: e.title,
        source: e.source,
        task: taskOf(e.id),
        skill: e.skill,
        targetLevel: e.targetLevel,
        performedAt: e.performedAt,
        expiresAt: e.expiresAt,
        successful: e.successful,
        percent: e.percent,
      })),
    },
    current: (view.decisions?.current ?? []).map(({ skill, decision }) => ({
      skill,
      level: decision.level,
      decisionId: decision.id,
      decidedAt: decision.decidedAt,
    })),
    placements: sessions.map((session) => ({
      id: session.id,
      mode: session.mode,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      validity: placementValidity(session, ctx.now),
    })),
  }
  // Öğrenci ve veli kararın gerekçesini (öğretmenin serbest metni) ve vereni görmez (Sabah kararı
  // 35); alan kapsamı role özgü yanıt şemasıyla da kapanır.
  // Kanıt özeti de yalnız personeldedir (OG-079 güvenli taraf; Sabah kararı önerisi): öğrenci ve
  // veli çizelgede seviye, tür, an ve önceki seviyeyi görür.
  // Kanıt sayılmayan sonuçlar (puanlanmamış, itirazlı, süresi dolmuş) yalnız personelde (OG-247):
  // öğrenci ve veli açılmamış puanın varlığını bu listeden de çıkaramaz (DOM-BEC-045); kursiyer
  // yanıt şemasında alan yoktur.
  if (learnerView) {
    return {
      view: 'learner' as const,
      ...shared,
      timeline: timeline.map((d) => ({
        id: d.id,
        kind: d.kind,
        skill: d.skill,
        level: d.level,
        decidedAt: d.decidedAt,
        placementSessionId: d.placementSessionId,
        previousLevel: d.previousLevel,
        change: d.change,
      })),
    }
  }
  const names = await levelDeciderNames(
    ctx.db,
    ctx.institutionId,
    timeline.map((d) => d.decidedByUserId),
  )
  return {
    view: 'staff' as const,
    ...shared,
    estimate: {
      ...shared.estimate,
      excluded: view.estimate.excluded.map(({ id, title, reason }) => ({
        id,
        title,
        reason,
        task: taskOf(id),
      })),
    },
    timeline: timeline.map((d) => ({
      ...decisionView(d),
      decidedByName: names.get(d.decidedByUserId) ?? null,
      previousLevel: d.previousLevel,
      change: d.change,
      evidence: decisionEvidence(d),
    })),
  }
}
