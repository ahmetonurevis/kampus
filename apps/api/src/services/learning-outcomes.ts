import {
  canManageLearningOutcomes,
  canReadLearningOutcomes,
  newOutcomeRefs,
  outcomeSelectionIssues,
  type LearningOutcomeInput,
  type OutcomeManager,
  type OutcomeRef,
} from '@kampus/school-core/content/outcomes.ts'
import {
  coordinatorScopeOf,
  NO_COORDINATOR_SCOPE,
} from '@kampus/school-core/lib/coordinator-duties.ts'

import type { Database } from '../db/client.ts'
import { activeDutiesOf } from '../db/coordinator-duties.ts'
import {
  archiveInstitutionOutcome,
  catalogRowsFor,
  findInstitutionOutcome,
  insertInstitutionOutcome,
  listLearningOutcomes,
  platformCodeExists,
  type LearningOutcomeQuery,
  type StoredLearningOutcome,
} from '../db/learning-outcomes.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RuleViolationError,
} from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'

/**
 * Kazanım kataloğu servisi (ADR 0004 karar 9; docs/domain/kaynak-platformu.md DOM-KYN-011;
 * IST-030, 031). Kural core `content/outcomes.ts`'tedir: okuma içerik personelinin
 * (`canReadLearningOutcomes`), kurum kazanımı ekleme ve arşivi yöneticinin ve dersin zümre
 * başkanının (`canManageLearningOutcomes`) işidir. Yazmalar `runCommand` ile tek transaction'da:
 * kurum kilidi, `Idempotency-Key`, yükleme, yazma ve `audit_log` (yalnız alan adları; kazanım adı
 * serbest metindir, loglanmaz).
 *
 * Kaynak yazımı (`resource-commands.ts`) yeni seçilen kazanımları `assertOutcomesSelectable` ile
 * denetler.
 */

const CODE_TAKEN = {
  code: 'learning_outcome_code_taken',
  message: 'Bu kazanım kodu kurumda ya da öğretim programında zaten kullanılıyor.',
} as const

export function outcomeView(row: StoredLearningOutcome) {
  return {
    source: row.source,
    code: row.code,
    name: row.name,
    subjectId: row.subjectId,
    gradeLevel: row.gradeLevel,
    programVersion: row.programVersion,
    archivedAt: row.archivedAt,
    rowVersion: row.rowVersion,
  }
}

/** Platform ve kurum kataloğu birleşik, sayfalı; arşivli kod yalnız `codes` ile istenirse döner. */
export async function listOutcomeCatalog(ctx: ServiceContext, query: LearningOutcomeQuery) {
  if (!canReadLearningOutcomes(ctx.actor.role)) throw new ForbiddenError()
  const { rows, total } = await listLearningOutcomes(ctx.db, ctx.institutionId, query)
  return { items: rows.map(outcomeView), total }
}

async function managerOf(tx: Database, ctx: ServiceContext): Promise<OutcomeManager> {
  if (ctx.actor.role !== 'ogretmen')
    return { role: ctx.actor.role, coordination: NO_COORDINATOR_SCOPE }
  const duties = await activeDutiesOf(tx, ctx.institutionId, ctx.actor.membershipId)
  return { role: ctx.actor.role, coordination: coordinatorScopeOf(duties) }
}

function command(
  ctx: ServiceContext,
  spec: {
    action: string
    code: string
    status: 200 | 201
    load: (tx: Database) => Promise<void>
    write: (tx: Database) => Promise<string[]>
  },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  return runCommand<null>(
    ctx,
    {
      action: spec.action,
      collections: [],
      entity: { type: 'learning_outcome', id: spec.code },
      load: async (tx) => {
        await spec.load(tx)
        return { run: () => null }
      },
      after: async (tx) => {
        const fields = await spec.write(tx)
        await tx.insert(auditLog).values({
          institutionId: ctx.institutionId,
          actorUserId: ctx.actor.userId,
          actorRole: ctx.actor.role,
          action: spec.action,
          entityType: 'learning_outcome',
          entityId: spec.code,
          changes: { fields },
          createdAt: ctx.now,
        })
        const row = await findInstitutionOutcome(tx, ctx.institutionId, spec.code)
        if (!row) throw new Error('learning outcome disappeared after write')
        out.body = { data: outcomeView(row) }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('learning outcome command was not written')
      return { statusCode: spec.status, body: out.body }
    },
    idempotency,
  )
}

/**
 * Kurum kazanımı ekler (DOM-KYN-011). Kod kurumda (arşivliler dahil) ve platform kataloğunda
 * kullanılmıyorsa yazılır; aksi 409 `learning_outcome_code_taken`. Yetki dersin kapsamına göredir
 * (403).
 */
export async function createInstitutionOutcome(
  ctx: ServiceContext,
  input: LearningOutcomeInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'learning_outcome.create',
      code: input.code,
      status: 201,
      load: async (tx) => {
        if (!canManageLearningOutcomes(await managerOf(tx, ctx), input.subjectId))
          throw new ForbiddenError()
        if (
          (await findInstitutionOutcome(tx, ctx.institutionId, input.code)) !== undefined ||
          (await platformCodeExists(tx, input.code))
        )
          throw new AppError(409, CODE_TAKEN.code, CODE_TAKEN.message)
      },
      write: async (tx) => {
        await insertInstitutionOutcome(
          tx,
          ctx.institutionId,
          { ...input, createdByUserId: ctx.actor.userId },
          ctx.now,
        )
        return ['code', 'name', 'subjectId', 'gradeLevel']
      },
    },
    idempotency,
  )
}

/**
 * Kurum kazanımını arşivler (DOM-KYN-011): yeni içerikte seçilemez, bağlı eski içerikte kalır.
 * Sıra: kapsam (404) → yetki (403) → sürüm (409); arşivli kod 409 `learning_outcome_archived`.
 */
export async function archiveOutcome(
  ctx: ServiceContext,
  input: { code: string; expectedVersion: number },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let current: StoredLearningOutcome | undefined
  return command(
    ctx,
    {
      action: 'learning_outcome.archive',
      code: input.code,
      status: 200,
      load: async (tx) => {
        current = await findInstitutionOutcome(tx, ctx.institutionId, input.code)
        if (!current) throw new NotFoundError()
        if (!canManageLearningOutcomes(await managerOf(tx, ctx), current.subjectId))
          throw new ForbiddenError()
        if (current.archivedAt !== null)
          throw new AppError(409, 'learning_outcome_archived', 'Bu kazanım zaten arşivlenmiş.')
        if (current.rowVersion !== input.expectedVersion) throw new ConflictError()
      },
      write: async (tx) => {
        await archiveInstitutionOutcome(
          tx,
          ctx.institutionId,
          input.code,
          input.expectedVersion,
          ctx.now,
        )
        return ['archivedAt']
      },
    },
    idempotency,
  )
}

/**
 * Kaynak sürümünün kazanım seçimi (DOM-KYN-011): `kept` dışındaki her kod katalogda bulunmalı ve
 * etkin olmalı; aksi 422, alan yolu `tags.outcomes.<sıra>.outcomeId`. Kurum kilidi altında,
 * çağıranın transaction'ında okunur.
 */
export async function assertOutcomesSelectable(
  tx: Database,
  institutionId: string,
  outcomes: readonly OutcomeRef[],
  kept: readonly OutcomeRef[],
): Promise<void> {
  const fresh = newOutcomeRefs(outcomes, kept)
  if (fresh.length === 0) return
  const catalog = await catalogRowsFor(tx, institutionId, fresh)
  const issues = outcomeSelectionIssues({ outcomes, kept, catalog })
  const first = issues[0]
  if (first) throw new RuleViolationError(first.code, first.message, { issues })
}
