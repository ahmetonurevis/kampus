import { randomUUID } from 'node:crypto'

import { planCopy } from '@kampus/school-core/content/copy.ts'
import {
  planDraftUpdate,
  planNewResource,
  planNewVersion,
  planResourceRemoval,
  planVersionTransition,
  versionData,
  type ContentActor,
  type Lineage,
  type ResourceAction,
  type ResourceContent,
  type ResourceVersion,
  type ResourceVersionData,
} from '@kampus/school-core/content/resource.ts'
import {
  canReadVersion,
  planShareChange,
  type ShareTargetsInput,
} from '@kampus/school-core/content/visibility.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'

import type { Database } from '../db/client.ts'
import {
  asCoreVersion,
  findResource,
  listContainerVersions,
  listPassageContainerVersions,
  listCopies,
  listResourceVersions,
  loadItemVersionRefs,
  loadVersionPairs,
  type StoredResource,
  type StoredResourceVersion,
} from '../db/resources.ts'
import {
  insertNewResource,
  insertNewVersion,
  removeResourceRows,
  replaceShares,
  updateDraft,
  updateResourceRow,
  updateVersionMeta,
} from '../db/resource-writes.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, ForbiddenError, NotFoundError, RuleViolationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { readScope, readSource } from './read-scope.ts'
import {
  attachVersionFiles,
  detachDroppedFiles,
  loadVersionFileRows,
  planFiles,
} from './resource-files.ts'
import { contentReader, fullVersion, loadVersionFiles, staffResource } from './resources.ts'

/**
 * İçerik havuzu yazma uçlarının servisi (ADR 0004 karar 3; docs/domain/kaynak-platformu.md). Her
 * işlem `runCommand` ile tek transaction'dadır: kurum kilidi, isteğe bağlı `Idempotency-Key`,
 * tablolardan yükleme (`load`), core planı (`run`, saf), yazma ve `audit_log` (`after`). Kural
 * core `content/*`'tadır; burada yalnız yükleme, sürüm denetimi ve yazma vardır.
 *
 * Kişinin içerik görünümü (`contentReader`) ve öğretim kapsamı transaction'dan önce okunur: PGlite
 * tek bağlantılıdır ve kapsam okuması `ctx.db`'yi kullanır.
 */

interface Staff {
  actor: ContentActor
  institutionType: InstitutionType
}

async function staffOf(ctx: ServiceContext): Promise<Staff> {
  const reader = await contentReader(ctx)
  if (reader.viewer.kind !== 'staff') throw new ForbiddenError()
  return { actor: reader.viewer.actor, institutionType: reader.institutionType }
}

/** Yazma sonucu: güncel kaynak (personel görünümü) ve işlemin sürümü. */
interface WriteOutcome {
  resourceId: string
  versionId: string | null
  /** Denetim kaydındaki değişen alan adları (değer yok). */
  fields: string[]
  extra?: Record<string, unknown>
}

interface CommandSpec<P> {
  action: string
  resourceId: string
  status: 200 | 201
  /** Kurum kilidinden sonra okur ve core planını döndüren saf adımı kurar. */
  load: (tx: Database) => Promise<() => P>
  write: (tx: Database, plan: P) => Promise<WriteOutcome>
}

function command<P>(
  ctx: ServiceContext,
  spec: CommandSpec<P>,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  return runCommand<P>(
    ctx,
    {
      action: spec.action,
      collections: [],
      entity: { type: 'resource', id: spec.resourceId },
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
          entityType: 'resource',
          entityId: outcome.resourceId,
          changes: { fields: outcome.fields },
          createdAt: ctx.now,
        })
        out.body = { data: await readBack(tx, ctx, outcome) }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('resource command was not written')
      return { statusCode: spec.status, body: out.body }
    },
    idempotency,
  )
}

async function readBack(tx: Database, ctx: ServiceContext, outcome: WriteOutcome) {
  const resource = await findResource(tx, ctx.institutionId, outcome.resourceId)
  if (!resource) throw new Error('resource disappeared after write')
  const [version] =
    outcome.versionId === null
      ? []
      : await listResourceVersions(tx, ctx.institutionId, outcome.resourceId, [outcome.versionId])
  const files = await loadVersionFiles(tx, ctx.institutionId, version ? [version] : [])
  return {
    resource: staffResource(resource),
    ...(outcome.versionId === null
      ? {}
      : { version: version ? fullVersion(version, files) : null }),
    ...outcome.extra,
  }
}

// --- Yükleme ------------------------------------------------------------------------------

interface Target {
  resource: StoredResource
  versions: StoredResourceVersion[]
}

const readable = (
  staff: Staff,
  resource: StoredResource,
  version: StoredResourceVersion,
  now: Date,
) =>
  canReadVersion(
    { kind: 'staff', actor: staff.actor },
    { institutionType: staff.institutionType, resource, version: asCoreVersion(version), now },
  )

/** Kaynak ve bütün sürümleri; kişinin okuyabildiği sürümü yoksa kaynak yok sayılır (404). */
async function loadTarget(
  tx: Database,
  ctx: ServiceContext,
  staff: Staff,
  resourceId: string,
): Promise<Target> {
  const resource = await findResource(tx, ctx.institutionId, resourceId)
  if (!resource) throw new NotFoundError()
  const versions = await listResourceVersions(tx, ctx.institutionId, resourceId)
  if (!versions.some((version) => readable(staff, resource, version, ctx.now)))
    throw new NotFoundError()
  return { resource, versions }
}

/** Okunabilir tek sürüm; yoksa 404 (varlığı sızmaz). */
function readableVersion(
  ctx: ServiceContext,
  staff: Staff,
  target: Target,
  versionId: string,
): StoredResourceVersion {
  const version = target.versions.find((item) => item.id === versionId)
  if (!version || !readable(staff, target.resource, version, ctx.now)) throw new NotFoundError()
  return version
}

/**
 * Kaynağın sürümlerine etkin bağı olan dosyalar (DOM-KYN-006): yeni sürüm ve taslak bunları yeniden
 * bağlamadan taşır ya da eski sürümden geri ekler (core `planVersionFiles` `kept`).
 */
function resourceFileIds(versions: readonly StoredResourceVersion[]): string[] {
  return [...new Set(versions.flatMap((version) => version.fileIds))]
}

/** `If-Match` ile gelen satır sürümü tutmazsa 409 `version_conflict`. */
function assertExpected(version: number, expected: number | null) {
  if (expected !== null && version !== expected) throw new ConflictError()
}

/**
 * Quiz ve alıştırma setinin soruları kurumda bulunmalı ve kişi onları okuyabilmeli (DOM-KYN-013);
 * yoksa 422 `quiz_item_missing`. Sorunun türü, durumu ve etiketi yayımda (`publicationIssues`)
 * denetlenir.
 */
async function assertItemsReadable(
  tx: Database,
  ctx: ServiceContext,
  staff: Staff,
  content: ResourceContent,
) {
  if (content.type !== 'quiz' && content.type !== 'exercise_set') return
  const pairs = await loadVersionPairs(
    tx,
    ctx.institutionId,
    content.items.map((item) => item.questionVersionId),
  )
  const passageId = content.passageVersionId
  const passage =
    passageId === null
      ? null
      : (await loadVersionPairs(tx, ctx.institutionId, [passageId])).get(passageId)
  // Okuma-anlama etkinliğinin parçası (IST-042): kurumda bulunmalı ve kişi okuyabilmeli; türü ve
  // durumu yayımda (`publicationIssues`) denetlenir.
  if (
    passageId !== null &&
    !(passage && readable(staff, passage.resource, passage.version, ctx.now))
  )
    throw new RuleViolationError('passage_missing', 'Seçilen okuma parçası bulunamadı.', {
      issues: [
        {
          path: ['content', 'passageVersionId'],
          code: 'passage_missing',
          message: 'Seçilen okuma parçası bulunamadı.',
        },
      ],
    })
  const issues = content.items.flatMap((item, index) => {
    const pair = pairs.get(item.questionVersionId)
    return pair && readable(staff, pair.resource, pair.version, ctx.now)
      ? []
      : [
          {
            path: ['content', 'items', index, 'questionVersionId'],
            code: 'quiz_item_missing',
            message: 'Seçilen soru bulunamadı.',
          },
        ]
  })
  if (issues.length > 0)
    throw new RuleViolationError('quiz_item_missing', 'Seçilen soru bulunamadı.', { issues })
}

/** Yayım denetiminin soru sürümleri ve okuma parçası (DOM-KYN-013; IST-042). */
async function itemRefs(tx: Database, ctx: ServiceContext, version: StoredResourceVersion) {
  const content = version.content
  const list = content && (content.type === 'quiz' || content.type === 'exercise_set')
  const ids = list ? content.items.map((item) => item.questionVersionId) : []
  const passageId = list ? content.passageVersionId : null
  const refs = await loadItemVersionRefs(
    tx,
    ctx.institutionId,
    passageId === null ? ids : [...ids, passageId],
  )
  return {
    itemVersions: refs,
    passageVersion: passageId === null ? undefined : refs.get(passageId),
  }
}

/** Kopyada miras alınan menşe: türetildiği sürümün lisansı ve kaynak gösterimleri (DOM-KYN-050). */
async function lineageOf(
  tx: Database,
  ctx: ServiceContext,
  resource: StoredResource,
): Promise<Lineage | undefined> {
  // TODO(F3b-library): kütüphane kopyasının menşesi `platform_resource_versions` gelince okunur.
  if (resource.derivedFromVersionId === null) return undefined
  const pairs = await loadVersionPairs(tx, ctx.institutionId, [resource.derivedFromVersionId])
  const source = pairs.get(resource.derivedFromVersionId)
  return source
    ? { license: source.version.license, attributions: source.version.attributions }
    : undefined
}

// --- Oluşturma, taslak, yeni sürüm --------------------------------------------------------

/** Yeni kaynak ve ilk taslak (DOM-KYN-001): sahip ve yazar işlemi yapan kişi, kapsam `Yalnız ben`. */
export async function createResource(
  ctx: ServiceContext,
  input: ResourceVersionData,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const staff = await staffOf(ctx)
  const ids = { resourceId: randomUUID(), versionId: randomUUID() }
  return command(
    ctx,
    {
      action: 'resource.create',
      resourceId: ids.resourceId,
      status: 201,
      load: async (tx) => {
        await assertItemsReadable(tx, ctx, staff, input.content)
        const files = await loadVersionFileRows(
          tx,
          ctx.institutionId,
          [input.content],
          input.fileIds,
        )
        return () => {
          const plan = planNewResource({ actor: staff.actor, input, ids, now: ctx.now })
          const { fileIds, attach } = planFiles(ctx, {
            content: plan.version.content,
            fileIds: plan.version.fileIds,
            files,
            kept: [],
          })
          return { ...plan, version: { ...plan.version, fileIds }, attach }
        }
      },
      write: async (tx, plan) => {
        await insertNewResource(tx, ctx.institutionId, plan.resource, plan.version, ctx.now)
        await attachVersionFiles(tx, ctx, ids.versionId, plan.attach)
        return {
          resourceId: ids.resourceId,
          versionId: ids.versionId,
          fields: ['title', 'content', ...(plan.version.fileIds.length > 0 ? ['fileIds'] : [])],
        }
      },
    },
    idempotency,
  )
}

/** Taslak alanları; verilmeyen alan sürümdeki değeriyle kalır (`tags` bütün olarak değişir). */
export type DraftPatch = Partial<
  Pick<
    ResourceVersionData,
    'title' | 'content' | 'answerKey' | 'tags' | 'license' | 'attributions' | 'fileIds'
  >
>

/**
 * Taslağı düzenler (DOM-KYN-030, 032): yalnız yazar, yalnız taslak/reddedilmiş ve hiç
 * yayımlanmamış sürümde; reddedilen sürüm taslağa döner. Kopyada miras menşe korunur (DOM-KYN-050).
 * `If-Match` sürüm satırının `rowVersion`'ıdır.
 */
export async function updateDraftVersion(
  ctx: ServiceContext,
  input: { resourceId: string; versionId: string; patch: DraftPatch; expectedVersion: number },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const staff = await staffOf(ctx)
  return command(
    ctx,
    {
      action: 'resource.draft_update',
      resourceId: input.resourceId,
      status: 200,
      load: async (tx) => {
        const target = await loadTarget(tx, ctx, staff, input.resourceId)
        const version = readableVersion(ctx, staff, target, input.versionId)
        assertExpected(version.rowVersion, input.expectedVersion)
        // Kaldırılan sürüm `version_immutable` ile reddedilir; içerik yer tutucusu yazılmaz.
        const merged: ResourceVersionData = {
          ...versionData(asCoreVersion(version)),
          ...input.patch,
        }
        if (input.patch.content) await assertItemsReadable(tx, ctx, staff, input.patch.content)
        // İçerik ya da dosya listesi değişince dosyalar yeniden denetlenir; kaynağın sürümlerine
        // zaten bağlı olanlar (`kept`: taslağınkiler ve eski sürümden geri eklenenler) yeniden
        // bağlanmaz, yalnız silinmiş olmadıkları denetlenir.
        const filesChanged = input.patch.content !== undefined || input.patch.fileIds !== undefined
        const files = filesChanged
          ? await loadVersionFileRows(tx, ctx.institutionId, [merged.content], merged.fileIds)
          : []
        const lineage = await lineageOf(tx, ctx, target.resource)
        return () => {
          const draft = planDraftUpdate({
            actor: staff.actor,
            resource: target.resource,
            version: asCoreVersion(version),
            input: merged,
            lineage,
          })
          const plan = filesChanged
            ? planFiles(ctx, {
                content: draft.data.content,
                fileIds: draft.data.fileIds,
                files,
                kept: resourceFileIds(target.versions),
              })
            : { fileIds: draft.data.fileIds, attach: [] }
          return {
            version,
            ...draft,
            data: { ...draft.data, fileIds: plan.fileIds },
            attach: plan.attach,
          }
        }
      },
      write: async (tx, plan) => {
        const next: ResourceVersion = {
          ...asCoreVersion(plan.version),
          ...plan.data,
          status: plan.status,
        }
        await updateDraft(tx, ctx.institutionId, next, plan.version.rowVersion, ctx.now)
        await attachVersionFiles(tx, ctx, input.versionId, plan.attach)
        await detachDroppedFiles(
          tx,
          ctx,
          input.versionId,
          plan.version.fileIds.filter((fileId) => !plan.data.fileIds.includes(fileId)),
        )
        return {
          resourceId: input.resourceId,
          versionId: input.versionId,
          fields: [
            ...Object.keys(input.patch),
            ...(plan.version.status === 'draft' ? [] : ['status']),
          ],
        }
      },
    },
    idempotency,
  )
}

/** Yayındaki (yoksa son) sürümden yeni taslak açar (DOM-KYN-032); açık sürüm varken 409. */
export async function openNewVersion(
  ctx: ServiceContext,
  input: { resourceId: string; fileIds?: readonly string[] | undefined },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const { resourceId } = input
  const staff = await staffOf(ctx)
  const versionId = randomUUID()
  return command(
    ctx,
    {
      action: 'resource.version_create',
      resourceId,
      status: 201,
      load: async (tx) => {
        const target = await loadTarget(tx, ctx, staff, resourceId)
        const requested = input.fileIds
        // Temel sürüm core'da seçilir; satırlar bütün sürümlerin dosyalarıyla birlikte okunur
        // (liste verilmese de temel sürümün dosyaları denetlenir).
        const kept = resourceFileIds(target.versions)
        const files = await loadVersionFileRows(
          tx,
          ctx.institutionId,
          target.versions.map((version) => version.content),
          [...(requested ?? []), ...kept],
        )
        return () => {
          const base = planNewVersion({
            actor: staff.actor,
            institutionType: staff.institutionType,
            resource: target.resource,
            versions: target.versions.map(asCoreVersion),
            versionId,
            now: ctx.now,
          })
          // Dosya listesi verilmezse temel sürümün listesi kalır; silinmiş dosya taşınmaz (422).
          // Aynı kaynağın eski sürümündeki dosya yeniden bağlanmadan geri eklenir (DOM-KYN-006).
          const plan = planFiles(ctx, {
            content: base.content,
            fileIds: requested ?? base.fileIds,
            files,
            kept,
          })
          return {
            reopens: target.resource.archivedAt !== null,
            version: { ...base, fileIds: plan.fileIds },
            attach: plan.attach,
          }
        }
      },
      write: async (tx, { reopens, version, attach }) => {
        await insertNewVersion(tx, ctx.institutionId, version, ctx.now)
        await attachVersionFiles(tx, ctx, versionId, attach)
        // Bütün sürümleri arşivli kaynak yeni sürümle yeniden açılır (R8: `resources.archived_at`).
        // Arşivli değilse kaynak satırına dokunulmaz: satır sürümü artmaz, eldeki `If-Match` geçerli kalır.
        if (reopens)
          await updateResourceRow(
            tx,
            ctx.institutionId,
            resourceId,
            null,
            { archivedAt: null },
            ctx.now,
          )
        return {
          resourceId,
          versionId,
          fields: [
            'versionNumber',
            ...(input.fileIds === undefined ? [] : ['fileIds']),
            ...(reopens ? ['archivedAt'] : []),
          ],
        }
      },
    },
    idempotency,
  )
}

// --- Durum geçişleri ----------------------------------------------------------------------

/**
 * Sürüm durum geçişi (DOM-KYN-025, 030, 031, 032). Yayımda önceki yayın sürümü aynı transaction'da
 * arşivlenir ve kaynağın güncel sürümü değişir. Kaynağın bütün sürümleri arşivlenince kaynak da
 * arşivlenir (`resources.archived_at`).
 */
export async function transitionVersion(
  ctx: ServiceContext,
  input: {
    resourceId: string
    versionId: string
    action: ResourceAction
    reason?: string | undefined
    expectedVersion: number | null
  },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const staff = await staffOf(ctx)
  return command(
    ctx,
    {
      action: `resource.${input.action}`,
      resourceId: input.resourceId,
      status: 200,
      load: async (tx) => {
        const target = await loadTarget(tx, ctx, staff, input.resourceId)
        const version = readableVersion(ctx, staff, target, input.versionId)
        assertExpected(version.rowVersion, input.expectedVersion)
        const { itemVersions, passageVersion } = await itemRefs(tx, ctx, version)
        return () => ({
          target,
          version,
          transition: planVersionTransition({
            action: input.action,
            actor: staff.actor,
            institutionType: staff.institutionType,
            resource: target.resource,
            version: asCoreVersion(version),
            now: ctx.now,
            reason: input.reason,
            itemVersions,
            passageVersion,
          }),
        })
      },
      write: async (tx, { target, version, transition }) => {
        await updateVersionMeta(
          tx,
          ctx.institutionId,
          version.id,
          version.rowVersion,
          transition.versionChanges,
          ctx.now,
        )
        // Core önceki sürümü durumdan bağımsız bildirir; zaten arşivli sürüme (ör. sahibi arşivlemiş,
        // `currentVersionId` değişmemiş) dokunulmaz: asıl arşiv tarihi ve satır sürümü korunur.
        const superseded = target.versions.find(
          (item) => item.id === transition.supersededVersionId && item.status === 'published',
        )
        if (superseded)
          await updateVersionMeta(
            tx,
            ctx.institutionId,
            superseded.id,
            superseded.rowVersion,
            { status: 'archived', archivedAt: ctx.now.toISOString() },
            ctx.now,
          )
        const statuses = target.versions.map((item) =>
          item.id === version.id
            ? transition.status
            : item.id === superseded?.id
              ? 'archived'
              : item.status,
        )
        const allArchived = statuses.every((status) => status === 'archived')
        const resourceChanges = {
          ...transition.resourceChanges,
          ...(allArchived ? { archivedAt: ctx.now } : {}),
        }
        if (Object.keys(resourceChanges).length > 0)
          await updateResourceRow(
            tx,
            ctx.institutionId,
            input.resourceId,
            null,
            resourceChanges,
            ctx.now,
          )
        return {
          resourceId: input.resourceId,
          versionId: version.id,
          fields: [...Object.keys(transition.versionChanges), ...Object.keys(resourceChanges)],
        }
      },
    },
    idempotency,
  )
}

// --- Kaldırma, paylaşım, kopya ------------------------------------------------------------

/**
 * Kaynağı kaldırır (DOM-KYN-025, 051): yalnız yönetici, gerekçeyle. Bütün sürümlerin içeriği ve
 * cevap anahtarı silinir; başlık, menşe, gerekçe ve tarih kalır. Kaynak arşivlenir. Yanıt
 * etkilenen kopyaları ve soruyu içeren quiz sürümlerini listeler.
 */
export async function removeResource(
  ctx: ServiceContext,
  input: { resourceId: string; reason: string; expectedVersion: number | null },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const staff = await staffOf(ctx)
  return command(
    ctx,
    {
      action: 'resource.remove',
      resourceId: input.resourceId,
      status: 200,
      load: async (tx) => {
        const target = await loadTarget(tx, ctx, staff, input.resourceId)
        assertExpected(target.resource.rowVersion, input.expectedVersion)
        const versionIds = target.versions.map((version) => version.id)
        const [copies, itemContainers, passageContainers] = await Promise.all([
          listCopies(tx, ctx.institutionId, versionIds),
          listContainerVersions(tx, ctx.institutionId, versionIds),
          target.resource.contentType === 'reading_passage'
            ? listPassageContainerVersions(tx, ctx.institutionId, versionIds)
            : [],
        ])
        const containers = [...itemContainers, ...passageContainers]
        return () => ({
          target,
          plan: planResourceRemoval({
            actor: staff.actor,
            resource: target.resource,
            versions: target.versions.map(asCoreVersion),
            copies,
            containers,
            reason: input.reason,
            now: ctx.now,
          }),
        })
      },
      write: async (tx, { target, plan }) => {
        // TODO(kaynak-dosya-imhasi): `plan.fileIds` hesaplanır ama dosyalar imha edilmez. Okuma
        // kuralında kaldırma aşağı yayılır (sabah kararları 36 ve 39): bu kaynağın ve ondan türeyen
        // kopyaların sürümleri, atanmış görevler dahil dosya açmaz; ata ve kardeş kopyalar açık
        // kalır. Bağ satırları silinmez, böylece karar geri alınabilir. Kaldırma nedeni (telif /
        // kişisel veri) saklanmaz, iki neden aynı davranır. İmha işi yalnız açık kalan bağı (ata
        // veya kardeş kopya) olmayan dosyanın nesnesini siler ve satırı `deleted` yapar; bağları
        // silmez. Kararın geri alınması imhadan önce olmalıdır (DOM-KYN-006, DOM-KYN-051).
        await removeResourceRows(
          tx,
          ctx.institutionId,
          input.resourceId,
          target.versions,
          plan.versionChanges,
          ctx.now,
        )
        return {
          resourceId: input.resourceId,
          versionId: null,
          fields: ['status', 'content', 'answerKey', 'removedAt', 'removalReason', 'archivedAt'],
          extra: {
            versionIds: plan.versionIds,
            affectedCopyIds: plan.affectedCopyIds,
            affectedContainerVersionIds: plan.affectedContainerVersionIds,
          },
        }
      },
    },
    idempotency,
  )
}

/**
 * Paylaşım kapsamını ve hedeflerini değiştirir (DOM-KYN-021, 031, 040). Öğretmen yalnız ders
 * verdiği sınıf ve öğrencilerle paylaşır; yöneticinin seçtiği kimlikler kurumda bulunmalıdır.
 */
export async function shareResource(
  ctx: ServiceContext,
  input: { resourceId: string; targets: ShareTargetsInput; expectedVersion: number | null },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const staff = await staffOf(ctx)
  // TODO(scope-in-tx): öğretim kapsamı (atamalar) ve kurum kimlikleri kurum kilidinden ÖNCE okunur;
  // PGlite tek bağlantılı olduğundan bu okuma transaction içinde `ctx.db` ile yapılamaz. Atama
  // kaldırılırken eşzamanlı paylaşım bayat kapsamla geçebilir (docs/muhendislik/api-tasarimi.md,
  // "Bilinen sınırlamalar"). Kapsam okuması transaction'a taşınabilince kilitten sonra okunmalı.
  const [scope, source] = await Promise.all([readScope(ctx), readSource(ctx)])
  const known = {
    studentIds: new Set(source.students.map((student) => student.id)),
    classIds: new Set(source.classes.map((item) => item.id)),
  }
  return command(
    ctx,
    {
      action: 'resource.share',
      resourceId: input.resourceId,
      status: 200,
      load: async (tx) => {
        const target = await loadTarget(tx, ctx, staff, input.resourceId)
        assertExpected(target.resource.rowVersion, input.expectedVersion)
        const current = target.versions.find((v) => v.id === target.resource.currentVersionId)
        return () => {
          const plan = planShareChange({
            actor: staff.actor,
            institutionType: staff.institutionType,
            resource: target.resource,
            currentVersion: current ? asCoreVersion(current) : null,
            targets: input.targets,
            teaching: { studentIds: scope.studentIds, classIds: scope.classIds },
          })
          const issues = [
            ...plan.sharedStudentIds
              .map((id, index) => ({ id, index, field: 'studentIds', set: known.studentIds }))
              .concat(
                plan.sharedClassIds.map((id, index) => ({
                  id,
                  index,
                  field: 'classIds',
                  set: known.classIds,
                })),
              )
              .filter(({ id, set }) => !set.has(id))
              .map(({ index, field }) => ({
                path: [field, index],
                code: 'share_target_not_found',
                message: 'Seçilen kayıt bulunamadı.',
              })),
          ]
          if (issues.length > 0)
            throw new RuleViolationError('share_target_not_found', 'Seçilen kayıt bulunamadı.', {
              issues,
            })
          return plan
        }
      },
      write: async (tx, plan) => {
        await updateResourceRow(
          tx,
          ctx.institutionId,
          input.resourceId,
          null,
          { shareScope: plan.shareScope },
          ctx.now,
        )
        await replaceShares(tx, ctx.institutionId, input.resourceId, plan, ctx.now)
        return {
          resourceId: input.resourceId,
          versionId: null,
          fields: ['shareScope', 'sharedStudentIds', 'sharedClassIds'],
        }
      },
    },
    idempotency,
  )
}

/**
 * Yayındaki güncel sürümü yeni kaynağa kopyalar (DOM-KYN-050): sahibi kopyalayan, kapsam `Yalnız
 * ben`, `Taslak`; türetildiği sürüm bağı, lisans ve kaynak gösterimleri miras alınır.
 */
export async function copyResource(
  ctx: ServiceContext,
  resourceId: string,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const staff = await staffOf(ctx)
  const ids = { resourceId: randomUUID(), versionId: randomUUID() }
  return command(
    ctx,
    {
      action: 'resource.copy',
      resourceId: ids.resourceId,
      status: 201,
      load: async (tx) => {
        const target = await loadTarget(tx, ctx, staff, resourceId)
        // Güncel yayın sürümü yoksa son sürüm core'a verilir: görülemiyorsa 404, değilse 409.
        const source =
          target.versions.find((v) => v.id === target.resource.currentVersionId) ??
          target.versions.at(-1)
        if (!source) throw new NotFoundError()
        return () =>
          planCopy({
            actor: staff.actor,
            institutionType: staff.institutionType,
            source: {
              origin: 'institution',
              resource: target.resource,
              version: asCoreVersion(source),
            },
            ids,
            now: ctx.now,
          })
      },
      write: async (tx, plan) => {
        await insertNewResource(tx, ctx.institutionId, plan.resource, plan.version, ctx.now)
        return {
          resourceId: ids.resourceId,
          versionId: ids.versionId,
          fields: ['derivedFromVersionId', 'license', 'attributions'],
        }
      },
    },
    idempotency,
  )
}
