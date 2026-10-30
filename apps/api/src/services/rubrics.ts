import { randomUUID } from 'node:crypto'

import { isContentStaff, type ContentActor } from '@kampus/school-core/content/resource.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import {
  canManageRubric,
  planNewRubricVersion,
  planRubricArchive,
  planRubricDraftUpdate,
  planRubricPublish,
  type RubricRecord,
  type RubricUsage,
  type RubricVersionData,
  type RubricVersionInput,
} from '@kampus/school-core/skills/rubric.ts'

import type { Database } from '../db/client.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import {
  applyRubricArchive,
  applyRubricPublish,
  findRubric,
  findRubricVersion,
  insertRubric,
  insertRubricVersion,
  listRubrics,
  loadRubricVersions,
  rubricUsageByVersion,
  updateRubricVersionDraft,
  type RubricListQuery,
  type StoredRubricVersion,
} from '../db/skills.ts'
import { ConflictError, ForbiddenError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'

/**
 * Rubrik kütüphanesi uçlarının servisi (ADR 0004 karar 7; docs/domain/beceri-gelisimi.md
 * DOM-BEC-020, 022; IST-048). Kural core `skills/rubric.ts`'tedir: okuma ve oluşturma içerik
 * personelinin (`isContentStaff`), düzenleme, yeni sürüm, yayım ve arşiv sahibin veya yöneticinin
 * (`canManageRubric`) işidir; kurum türüne uygunluk (`assertRubricFitsInstitution`) plan
 * fonksiyonlarının içindedir. Burada yalnız yükleme, sıra (kapsam → yetki → sürüm) ve yazma vardır.
 *
 * Her yazma `runCommand` ile tek transaction'dadır: kurum kilidi, isteğe bağlı `Idempotency-Key`,
 * kilitten sonra yükleme, core planı, depo yazması (`db/skills.ts`), `audit_log` (yalnız alan
 * adları) ve geri okuma. Rubrik başlığı, bant tanımları ve kriterler loglanmaz ve denetim kaydına
 * yazılmaz: kişisel veri olmaları beklenmez ama serbest metindir (guvenlik-kvkk; öğretmen bant
 * tanımına öğrenci adı yazabilir).
 */

const actorOf = (ctx: ServiceContext): ContentActor => ({
  role: ctx.actor.role,
  userId: ctx.actor.userId,
})

/** Rubrik kütüphanesini yalnız içerik personeli görür (yönetici, öğretmen); diğerleri 403. */
function staffActor(ctx: ServiceContext): ContentActor {
  if (!isContentStaff(ctx.actor.role)) throw new ForbiddenError()
  return actorOf(ctx)
}

async function institutionTypeOf(db: Database, ctx: ServiceContext): Promise<InstitutionType> {
  const institution = await getInstitutionModules(db, ctx.institutionId)
  if (!institution) throw new Error('institution disappeared during rubric command')
  return institution.type
}

// --- Yanıt biçimleri ----------------------------------------------------------------------

type StoredRubric = RubricRecord & { createdAt: string }

function rubricView(actor: ContentActor, rubric: StoredRubric) {
  return {
    id: rubric.id,
    ownerUserId: rubric.ownerUserId,
    createdAt: rubric.createdAt,
    canManage: canManageRubric(actor, rubric),
  }
}

function versionSummary(version: StoredRubricVersion) {
  return {
    id: version.id,
    rubricId: version.rubricId,
    versionNumber: version.versionNumber,
    status: version.status,
    title: version.title,
    kind: version.kind,
    skill: version.skill,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    publishedAt: version.publishedAt,
    archivedAt: version.archivedAt,
    rowVersion: version.rowVersion,
  }
}

const UNUSED: RubricUsage = { assignmentCount: 0, scoreCount: 0 }

function versionView(version: StoredRubricVersion, usage: RubricUsage = UNUSED) {
  return { ...versionSummary(version), criteria: version.criteria, usage }
}

// --- Okuma --------------------------------------------------------------------------------

/** Kurumun rubrikleri, baş sürümleriyle (IST-048). */
export async function listRubricLibrary(ctx: ServiceContext, query: RubricListQuery) {
  const actor = staffActor(ctx)
  const { rows, total } = await listRubrics(ctx.db, ctx.institutionId, query)
  return {
    total,
    items: rows.map((row) => ({
      rubric: rubricView(actor, row.rubric),
      head: versionSummary(row.head),
      publishedVersionId: row.publishedVersionId,
    })),
  }
}

/** Rubrik ve bütün sürümleri (arşivli dahil; DOM-BEC-022); yok veya başka kurumunsa 404. */
export async function getRubric(ctx: ServiceContext, rubricId: string) {
  const actor = staffActor(ctx)
  const rubric = await findRubric(ctx.db, ctx.institutionId, rubricId)
  if (!rubric) throw new NotFoundError()
  const versions = await loadRubricVersions(ctx.db, ctx.institutionId, rubricId)
  const usage = await rubricUsageByVersion(
    ctx.db,
    ctx.institutionId,
    versions.map((version) => version.id),
  )
  return {
    rubric: rubricView(actor, rubric),
    versions: versions.map((version) => versionView(version, usage.get(version.id))),
  }
}

// --- Yazma --------------------------------------------------------------------------------

interface WriteOutcome {
  versionId: string
  /** Denetim kaydındaki değişen alan adları (değer yok). */
  fields: string[]
}

interface CommandSpec<P> {
  action: string
  rubricId: string
  status: 200 | 201
  /** Kurum kilidinden sonra okur ve core planını döndüren saf adımı kurar. */
  load: (tx: Database) => Promise<() => P>
  write: (tx: Database, plan: P) => Promise<WriteOutcome>
}

function command<P>(
  ctx: ServiceContext,
  actor: ContentActor,
  spec: CommandSpec<P>,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  return runCommand<P>(
    ctx,
    {
      action: spec.action,
      collections: [],
      entity: { type: 'rubric', id: spec.rubricId },
      load: async (tx) => {
        const run = await spec.load(tx)
        return { run: () => run() }
      },
      after: async (tx, plan) => {
        const outcome = await spec.write(tx, plan)
        await tx.insert(auditLog).values({
          institutionId: ctx.institutionId,
          actorUserId: ctx.actor.userId,
          actorRole: ctx.actor.role,
          action: spec.action,
          entityType: 'rubric',
          entityId: spec.rubricId,
          changes: { fields: outcome.fields },
          createdAt: ctx.now,
        })
        out.body = { data: await readBack(tx, ctx, actor, spec.rubricId, outcome.versionId) }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('rubric command was not written')
      return { statusCode: spec.status, body: out.body }
    },
    idempotency,
  )
}

async function readBack(
  tx: Database,
  ctx: ServiceContext,
  actor: ContentActor,
  rubricId: string,
  versionId: string,
) {
  const rubric = await findRubric(tx, ctx.institutionId, rubricId)
  const version = await findRubricVersion(tx, ctx.institutionId, versionId)
  if (!rubric || !version) throw new Error('rubric disappeared after write')
  const usage = await rubricUsageByVersion(tx, ctx.institutionId, [versionId])
  return { rubric: rubricView(actor, rubric), version: versionView(version, usage.get(versionId)) }
}

interface Target {
  rubric: StoredRubric
  versions: StoredRubricVersion[]
  institutionType: InstitutionType
}

/** Rubrik ve bütün sürümleri, kurum kilidinden sonra; yok veya başka kurumunsa 404. */
async function loadTarget(tx: Database, ctx: ServiceContext, rubricId: string): Promise<Target> {
  const rubric = await findRubric(tx, ctx.institutionId, rubricId)
  if (!rubric) throw new NotFoundError()
  return {
    rubric,
    versions: await loadRubricVersions(tx, ctx.institutionId, rubricId),
    institutionType: await institutionTypeOf(tx, ctx),
  }
}

/** Rubriğin sürümü; başka rubriğin veya kurumun sürümü 404 (varlığı sızmaz). */
function versionOf(target: Target, versionId: string): StoredRubricVersion {
  const version = target.versions.find((item) => item.id === versionId)
  if (!version) throw new NotFoundError()
  return version
}

/**
 * Sıra (api-tasarimi.md §6): kapsam (404, yüklemede) → yetki (403) → sürüm (409) → core planı.
 * Görünür ama yetkisiz kişi yanlış sürümde de 403 alır; yetkili kişinin bayat görüntüsündeki iş
 * kuralı hatası 409 `version_conflict` olur (hiçbir şey yazılmaz).
 */
function guarded<P>(
  actor: ContentActor,
  rubric: RubricRecord,
  stale: boolean,
  plan: () => P,
): () => P {
  return () => {
    if (!canManageRubric(actor, rubric)) throw new ForbiddenError()
    if (stale) throw new ConflictError()
    return plan()
  }
}

/** Yeni rubrik ve ilk taslak sürüm (DOM-BEC-020, 022): sahibi oluşturan kişidir. */
export async function createRubric(
  ctx: ServiceContext,
  input: RubricVersionInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const actor = staffActor(ctx)
  const rubricId = randomUUID()
  const versionId = randomUUID()
  return command(
    ctx,
    actor,
    {
      action: 'rubric.create',
      rubricId,
      status: 201,
      load: async (tx) => {
        const institutionType = await institutionTypeOf(tx, ctx)
        return () =>
          planNewRubricVersion({ rubricId, versions: [], input, institutionType, now: ctx.now })
      },
      write: async (tx, plan) => {
        await insertRubric(
          tx,
          ctx.institutionId,
          { id: rubricId, ownerUserId: actor.userId },
          ctx.now,
        )
        await insertRubricVersion(
          tx,
          ctx.institutionId,
          { ...plan, id: versionId, publishedAt: null, archivedAt: null },
          ctx.now,
        )
        return { versionId, fields: ['title', 'kind', 'skill', 'criteria'] }
      },
    },
    idempotency,
  )
}

/** Yeni taslak sürüm (DOM-BEC-022): numara bir artar; açık taslak varken 409. */
export async function openRubricVersion(
  ctx: ServiceContext,
  rubricId: string,
  input: RubricVersionInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const actor = staffActor(ctx)
  const versionId = randomUUID()
  return command(
    ctx,
    actor,
    {
      action: 'rubric.version_create',
      rubricId,
      status: 201,
      load: async (tx) => {
        const target = await loadTarget(tx, ctx, rubricId)
        return guarded(actor, target.rubric, false, () =>
          planNewRubricVersion({
            rubricId,
            versions: target.versions,
            input,
            institutionType: target.institutionType,
            now: ctx.now,
          }),
        )
      },
      write: async (tx, plan) => {
        await insertRubricVersion(
          tx,
          ctx.institutionId,
          { ...plan, id: versionId, publishedAt: null, archivedAt: null },
          ctx.now,
        )
        return { versionId, fields: ['versionNumber', 'title', 'kind', 'skill', 'criteria'] }
      },
    },
    idempotency,
  )
}

/** Taslak alanları; verilmeyen alan sürümdeki değeriyle kalır (`criteria` bütün olarak). */
export type RubricDraftPatch = Partial<RubricVersionInput>

interface VersionCommand {
  rubricId: string
  versionId: string
  /** `If-Match`: sürüm satırının okunan `rowVersion`'ı. */
  expectedVersion: number
}

/**
 * Taslağı düzenler (DOM-BEC-022): yalnız kullanılmamış taslak; yayımlanmış, arşivli veya
 * kullanılmış sürüm 409 `rubric_version_immutable`.
 */
export async function updateRubricDraft(
  ctx: ServiceContext,
  input: VersionCommand & { patch: RubricDraftPatch },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const actor = staffActor(ctx)
  return command(
    ctx,
    actor,
    {
      action: 'rubric.draft_update',
      rubricId: input.rubricId,
      status: 200,
      load: async (tx) => {
        const target = await loadTarget(tx, ctx, input.rubricId)
        const version = versionOf(target, input.versionId)
        const usage = await rubricUsageByVersion(tx, ctx.institutionId, [version.id])
        const merged: RubricVersionInput = {
          title: version.title,
          kind: version.kind,
          skill: version.skill,
          criteria: version.criteria,
          ...input.patch,
        }
        return guarded(actor, target.rubric, version.rowVersion !== input.expectedVersion, () => ({
          version,
          data: planRubricDraftUpdate({
            version,
            usage: usage.get(version.id) ?? UNUSED,
            input: merged,
            institutionType: target.institutionType,
          }),
        }))
      },
      write: async (tx, plan: { version: StoredRubricVersion; data: RubricVersionData }) => {
        await updateRubricVersionDraft(
          tx,
          ctx.institutionId,
          plan.version.id,
          plan.version.rowVersion,
          plan.data,
          ctx.now,
        )
        return { versionId: plan.version.id, fields: Object.keys(input.patch) }
      },
    },
    idempotency,
  )
}

/**
 * Taslağı yayımlar (DOM-BEC-022): rubriğin önceki yayındaki sürümü aynı işlemde arşivlenir;
 * sabitlendiği atamalarda puanlanmaya devam eder. Taslak olmayan sürüm 409.
 */
export async function publishRubricVersion(
  ctx: ServiceContext,
  input: VersionCommand,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const actor = staffActor(ctx)
  return command(
    ctx,
    actor,
    {
      action: 'rubric.publish',
      rubricId: input.rubricId,
      status: 200,
      load: async (tx) => {
        const target = await loadTarget(tx, ctx, input.rubricId)
        const version = versionOf(target, input.versionId)
        return guarded(actor, target.rubric, version.rowVersion !== input.expectedVersion, () => ({
          version,
          versions: target.versions,
          plan: planRubricPublish({ version, versions: target.versions, now: ctx.now }),
        }))
      },
      write: async (tx, { version, versions, plan }) => {
        await applyRubricPublish(tx, ctx.institutionId, version, versions, plan, ctx.now)
        return {
          versionId: version.id,
          fields: [
            'status',
            'publishedAt',
            // Önceki yayındaki sürümün arşivi.
            ...(plan.archiveVersionIds.length > 0 ? ['archivedAt'] : []),
          ],
        }
      },
    },
    idempotency,
  )
}

/** Yayındaki sürümü arşivler (DOM-BEC-022); yayında olmayan sürüm 409. Arşiv geri alınmaz. */
export async function archiveRubricVersion(
  ctx: ServiceContext,
  input: VersionCommand,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const actor = staffActor(ctx)
  return command(
    ctx,
    actor,
    {
      action: 'rubric.archive',
      rubricId: input.rubricId,
      status: 200,
      load: async (tx) => {
        const target = await loadTarget(tx, ctx, input.rubricId)
        const version = versionOf(target, input.versionId)
        return guarded(actor, target.rubric, version.rowVersion !== input.expectedVersion, () => ({
          version,
          plan: planRubricArchive({ version, now: ctx.now }),
        }))
      },
      write: async (tx, { version, plan }) => {
        await applyRubricArchive(tx, ctx.institutionId, version, plan, ctx.now)
        return { versionId: version.id, fields: ['status', 'archivedAt'] }
      },
    },
    idempotency,
  )
}
