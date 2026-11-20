import { randomUUID } from 'node:crypto'

import {
  assertJobApplication,
  assertJobApplicationAnonymization,
  assertNoDuplicateApplication,
  FINANCE_JOB_POSTING_MANAGE_ROLES,
  jobApplicationAnonymizationInputSchema,
  jobApplicationInputSchema,
  jobApplicationSettingsSchema,
  jobApplicationStageInputSchema,
  jobApplicationUpdateSchema,
  jobPostingInputSchema,
  jobPostingStatusInputSchema,
  planJobApplicationSettings,
  planJobApplicationStage,
  planJobApplicationUpdate,
  planJobPostingStatus,
  planJobPostingUpdate,
  retentionDueOn,
  type AnonymizationTarget,
  type JobApplicationStage,
  type JobPostingFields,
} from '@kampus/school-core/lib/finance-job-postings.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  anonymizeJobApplication,
  countApplicationsByPosting,
  findDuplicateApplication,
  findJobApplication,
  findJobPosting,
  insertJobApplication,
  insertJobPosting,
  insertStageChange,
  jobApplicationReadable,
  latestApplicationReceivedOn,
  listJobApplications,
  listJobPostings,
  listRetentionDueApplications,
  listStageChanges,
  loadJobApplicationSettings,
  loadJobApplicationsByIds,
  saveJobApplicationSettings,
  updateJobApplication,
  updateJobPosting,
  type JobApplicationQuery,
  type JobPostingQuery,
  type JobPostingWrite,
  type StoredJobApplication,
  type StoredJobPosting,
} from '../db/finance-job-postings.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { scheduleDocumentPurge } from './enrollment-document-links.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile } from './files.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * İş ilanı ve başvuru havuzu (DOM-FIN-128; ON-177; K-439…K-441). Kural core
 * `lib/finance-job-postings.ts`'tedir; servis kurum kilidi altında ilanı, başvuruyu ve ayarı
 * yükler, tek transaction'da yazar, denetime alan adlarını düşer (aday verisi ve not yazılmaz).
 * Özgeçmiş platform dosya altyapısındadır (amaç `document`, bağ türü `job_application`); bağlantıyı
 * yalnız yönetici, anonimleştirilmemiş başvuruda `GET /files/:id/url` ile alır. Anonimleştirmede
 * dosyanın saklama sonu ana çekilir; nesneyi platformun saklama sonu imhası (`files.purge-expired`)
 * siler, yeni periyodik iş yoktur. Rol ve modül denetimi rotadadır.
 */

const POSTING = 'job_postings'
const APPLICATION = 'job_applications'
const SETTINGS = 'job_application_settings'

/** Anonimleştirmede temizlenen alanlar (K-441); denetime alan adı olarak yazılır. */
const ANONYMIZED_FIELDS = [
  'candidateName',
  'email',
  'phone',
  'note',
  'cvFileId',
  'anonymizedAt',
  'anonymizationReason',
]

defineFileAttachment('job_application', {
  purposes: ['document'],
  canRead: async (tx, ctx, applicationId) => {
    if (!(FINANCE_JOB_POSTING_MANAGE_ROLES as readonly string[]).includes(ctx.actor.role))
      return false
    const institution = await getInstitutionModules(tx, ctx.institutionId)
    return (
      institution?.modules.finance === true &&
      jobApplicationReadable(tx, ctx.institutionId, applicationId)
    )
  },
})

// --- Görünüm -------------------------------------------------------------------------------------

function postingView(
  posting: StoredJobPosting,
  counts: Partial<Record<JobApplicationStage, number>>,
  today: string,
) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  const open = (['new', 'screening', 'interview', 'offer'] as const).reduce(
    (sum, stage) => sum + (counts[stage] ?? 0),
    0,
  )
  return {
    ...posting,
    deadlinePassed: posting.status === 'published' && posting.deadlineOn < today,
    applicationCount: total,
    openApplicationCount: open,
    hiredCount: counts.hired ?? 0,
  }
}

async function postingViews(db: Database, ctx: ServiceContext, postings: StoredJobPosting[]) {
  const counts = await countApplicationsByPosting(
    db,
    ctx.institutionId,
    postings.map((posting) => posting.id),
  )
  const today = dayKey(ctx.now)
  return postings.map((posting) => postingView(posting, counts.get(posting.id) ?? {}, today))
}

const retentionOf = (application: StoredJobApplication, retentionMonths: number) =>
  retentionDueOn(
    {
      stage: application.stage,
      stageChangedOn: application.stageChangedOn,
      postingClosedOn: application.postingClosedOn,
      anonymizedAt: application.anonymizedAt,
    },
    retentionMonths,
  )

/** Liste satırı: iletişim ve not taşımaz (K-440). */
function applicationRow(application: StoredJobApplication, retentionMonths: number) {
  return {
    id: application.id,
    jobPostingId: application.jobPostingId,
    postingTitle: application.postingTitle,
    candidateName: application.candidateName,
    channel: application.channel,
    receivedOn: application.receivedOn,
    stage: application.stage,
    stageChangedOn: application.stageChangedOn,
    hasCv: application.cvFileId !== null,
    anonymized: application.anonymizedAt !== null,
    retentionDueOn: retentionOf(application, retentionMonths),
    version: application.version,
  }
}

async function applicationDetail(db: Database, ctx: ServiceContext, id: string) {
  const application = await findJobApplication(db, ctx.institutionId, id)
  if (application === null) throw new NotFoundError()
  const [history, settings] = await Promise.all([
    listStageChanges(db, ctx.institutionId, id),
    loadJobApplicationSettings(db, ctx.institutionId),
  ])
  return {
    ...applicationRow(application, settings.retentionMonths),
    email: application.email,
    phone: application.phone,
    cvFileId: application.cvFileId,
    privacyNoticeVersion: application.privacyNoticeVersion,
    privacyNoticeShownOn: application.privacyNoticeShownOn,
    note: application.note,
    postingStatus: application.postingStatus,
    anonymizedAt: application.anonymizedAt,
    anonymizationReason: application.anonymizationReason,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    history: history.map((change) => ({
      fromStage: change.fromStage,
      toStage: change.toStage,
      changedOn: change.changedOn,
      changedByUserId: change.changedByUserId,
    })),
  }
}

// --- Okuma ---------------------------------------------------------------------------------------

export async function listJobPostingsFor(ctx: ServiceContext, query: JobPostingQuery) {
  const { items, total } = await listJobPostings(ctx.db, ctx.institutionId, query)
  return { items: await postingViews(ctx.db, ctx, items), total }
}

export async function getJobPostingFor(ctx: ServiceContext, id: string) {
  const posting = await findJobPosting(ctx.db, ctx.institutionId, id)
  if (posting === null) throw new NotFoundError()
  const [view] = await postingViews(ctx.db, ctx, [posting])
  if (view === undefined) throw new NotFoundError()
  return view
}

export async function listJobApplicationsFor(ctx: ServiceContext, query: JobApplicationQuery) {
  const [{ items, total }, settings] = await Promise.all([
    listJobApplications(ctx.db, ctx.institutionId, query),
    loadJobApplicationSettings(ctx.db, ctx.institutionId),
  ])
  return { items: items.map((item) => applicationRow(item, settings.retentionMonths)), total }
}

export function getJobApplicationFor(ctx: ServiceContext, id: string) {
  return applicationDetail(ctx.db, ctx, id)
}

/** Saklama süresi dolan başvurular (K-441): süre sonu bugün ya da önce, en eski önce. */
export async function listRetentionDueFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number },
) {
  const settings = await loadJobApplicationSettings(ctx.db, ctx.institutionId)
  const { items, total } = await listRetentionDueApplications(ctx.db, ctx.institutionId, {
    ...query,
    retentionMonths: settings.retentionMonths,
    today: dayKey(ctx.now),
  })
  return {
    items: items.map((item) => ({
      ...applicationRow(item, settings.retentionMonths),
      retentionDueOn: item.retentionDueOn,
    })),
    total,
    retentionMonths: settings.retentionMonths,
  }
}

export function jobApplicationSettingsFor(ctx: ServiceContext) {
  return loadJobApplicationSettings(ctx.db, ctx.institutionId)
}

// --- İlan yazma ----------------------------------------------------------------------------------

const postingWrite = (input: JobPostingFields): JobPostingWrite => ({
  title: input.title,
  position: input.position,
  employmentType: input.employmentType,
  description: input.description,
  requirements: input.requirements,
  publishOn: input.publishOn,
  deadlineOn: input.deadlineOn,
})

async function postingBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findJobPosting(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('job posting was not written')
  const [view] = await postingViews(tx, ctx, [saved])
  return { data: view }
}

/** Yeni ilan taslak açılır (K-439). `Idempotency-Key` rotada zorunlu. 201. */
export function createJobPostingCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: POSTING, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.job_posting.create',
      collections: [],
      entity,
      load: () => {
        const write = postingWrite(jobPostingInputSchema.parse(input))
        return Promise.resolve({ run: () => write })
      },
      after: async (tx, write) => {
        await insertJobPosting(tx, ctx.institutionId, {
          ...write,
          id,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.job_posting.create', entity, [
          ...Object.keys(write).filter((key) => write[key as keyof JobPostingWrite] !== null),
          'status',
        ])
        body = await postingBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** İlan düzeltmesi (tam gövde, K-439); `If-Match` ilan sürümü. */
export function updateJobPostingCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: POSTING, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.job_posting.update',
      collections: [],
      entity,
      load: async (tx) => {
        const posting = await findJobPosting(tx, ctx.institutionId, id)
        if (posting === null) throw new NotFoundError()
        if (posting.version !== expectedVersion) throw new ConflictError()
        const parsed = jobPostingInputSchema.parse(input)
        const latestReceivedOn = await latestApplicationReceivedOn(tx, ctx.institutionId, id)
        return {
          run: () => ({
            write: postingWrite(parsed),
            changed: planJobPostingUpdate(posting, parsed, { latestReceivedOn }),
          }),
        }
      },
      after: async (tx, { write, changed }) => {
        const saved = await updateJobPosting(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: write,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.job_posting.update', entity, changed)
        body = await postingBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Yayımla ya da kapat (K-439); kapanış günü bugündür. `If-Match` ilan sürümü. */
export function changeJobPostingStatusCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: POSTING, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.job_posting.status',
      collections: [],
      entity,
      load: async (tx) => {
        const posting = await findJobPosting(tx, ctx.institutionId, id)
        if (posting === null) throw new NotFoundError()
        if (posting.version !== expectedVersion) throw new ConflictError()
        const { status } = jobPostingStatusInputSchema.parse(input)
        return { run: () => planJobPostingStatus(posting, status, dayKey(ctx.now)) }
      },
      after: async (tx, plan) => {
        const saved = await updateJobPosting(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: plan,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.job_posting.status',
          entity,
          plan.closedOn === null ? ['status'] : ['status', 'closedOn'],
        )
        body = await postingBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Başvuru yazma -------------------------------------------------------------------------------

/**
 * Başvuru kaydı (K-440): yönetici ya da ön büro girer; özgeçmiş bağlanır, aşama geçmişine ilk satır
 * yazılır. Denetime alan adları (aday verisi değil). `Idempotency-Key` rotada zorunlu. 201.
 */
export function createJobApplicationCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: APPLICATION, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.job_application.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = jobApplicationInputSchema.parse(input)
        const [posting, duplicate] = await Promise.all([
          findJobPosting(tx, ctx.institutionId, parsed.jobPostingId),
          findDuplicateApplication(tx, ctx.institutionId, parsed),
        ])
        return {
          run: () => {
            assertJobApplication(parsed, { posting, duplicate, today: dayKey(ctx.now) })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        if (parsed.cvFileId !== null)
          await attachFile(tx, ctx, {
            fileId: parsed.cvFileId,
            attachedType: 'job_application',
            attachedId: id,
            dataSubjectId: null,
          })
        await insertJobApplication(tx, ctx.institutionId, {
          id,
          ...parsed,
          recordedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await insertStageChange(tx, ctx.institutionId, {
          id: randomUUID(),
          jobApplicationId: id,
          fromStage: null,
          toStage: 'new',
          changedOn: parsed.receivedOn,
          changedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'finance.job_application.create',
          entity,
          Object.keys(parsed).filter((key) => parsed[key as keyof typeof parsed] !== null),
        )
        body = { data: await applicationDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Başvuru düzeltmesi: ad, iletişim, not; mükerrer iletişim 409. `If-Match` başvuru sürümü. */
export function updateJobApplicationCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: APPLICATION, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.job_application.update',
      collections: [],
      entity,
      load: async (tx) => {
        const application = await findJobApplication(tx, ctx.institutionId, id)
        if (application === null) throw new NotFoundError()
        if (application.version !== expectedVersion) throw new ConflictError()
        const parsed = jobApplicationUpdateSchema.parse(input)
        // Mükerrer denetimi yalnız değişen iletişim alanında (aynı değer kendisiyle çakışmaz).
        const changedValue = (field: 'email' | 'phone') =>
          parsed[field] === undefined || parsed[field] === application[field] ? null : parsed[field]
        const duplicate = await findDuplicateApplication(tx, ctx.institutionId, {
          jobPostingId: application.jobPostingId,
          email: changedValue('email'),
          phone: changedValue('phone'),
          exceptId: id,
        })
        return {
          run: () => {
            const plan = planJobApplicationUpdate(application, parsed)
            assertNoDuplicateApplication(duplicate)
            return plan
          },
        }
      },
      after: async (tx, plan) => {
        const saved = await updateJobApplication(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: plan.next,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.job_application.update', entity, plan.changed)
        body = { data: await applicationDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Aşama değişikliği (K-440): geçmişe satır yazılır. `If-Match` başvuru sürümü. */
export function changeJobApplicationStageCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: APPLICATION, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.job_application.stage',
      collections: [],
      entity,
      load: async (tx) => {
        const application = await findJobApplication(tx, ctx.institutionId, id)
        if (application === null) throw new NotFoundError()
        if (application.version !== expectedVersion) throw new ConflictError()
        const parsed = jobApplicationStageInputSchema.parse(input)
        return {
          run: () => ({
            from: application.stage,
            ...planJobApplicationStage(application, parsed, dayKey(ctx.now)),
          }),
        }
      },
      after: async (tx, plan) => {
        const saved = await updateJobApplication(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { stage: plan.stage, stageChangedOn: plan.changedOn },
        })
        if (!saved) throw new ConflictError()
        await insertStageChange(tx, ctx.institutionId, {
          id: randomUUID(),
          jobApplicationId: id,
          fromStage: plan.from,
          toStage: plan.stage,
          changedOn: plan.changedOn,
          changedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.job_application.stage', entity, [
          'stage',
          'stageChangedOn',
        ])
        body = { data: await applicationDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Saklama -------------------------------------------------------------------------------------

/**
 * Toplu anonimleştirme (K-441): seçilen başvuruların hepsi kurala uymalı, biri reddedilirse hiçbiri
 * değişmez. Ad sabit metne, iletişim ve not boşa, özgeçmiş bağı boşa çekilir; dosyanın saklama sonu
 * bu ana çekilir. Başvuru başına `finance.job_application.anonymize` denetimi. Taze oturum ve
 * `Idempotency-Key` rotada zorunlu.
 */
export function anonymizeJobApplicationsCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: APPLICATION, id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.job_application.anonymize',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = jobApplicationAnonymizationInputSchema.parse(input)
        const [rows, settings] = await Promise.all([
          loadJobApplicationsByIds(tx, ctx.institutionId, parsed.applicationIds),
          loadJobApplicationSettings(tx, ctx.institutionId),
        ])
        const found = new Map<string, AnonymizationTarget & { row: StoredJobApplication }>(
          rows.map((row) => [
            row.id,
            {
              id: row.id,
              stage: row.stage,
              stageChangedOn: row.stageChangedOn,
              postingClosedOn: row.postingClosedOn,
              anonymizedAt: row.anonymizedAt,
              row,
            },
          ]),
        )
        return {
          run: () => {
            assertJobApplicationAnonymization(parsed, found, {
              retentionMonths: settings.retentionMonths,
              today: dayKey(ctx.now),
            })
            return { parsed, found }
          },
        }
      },
      after: async (tx, { parsed, found }) => {
        let files = 0
        for (const applicationId of parsed.applicationIds) {
          const target = found.get(applicationId)
          if (target === undefined) throw new NotFoundError()
          if (target.row.cvFileId !== null) {
            await scheduleDocumentPurge(tx, ctx, target.row.cvFileId, ctx.now)
            files += 1
          }
          const saved = await anonymizeJobApplication(tx, ctx.institutionId, {
            id: applicationId,
            expectedVersion: target.row.version,
            reason: parsed.reason,
            now: ctx.now,
          })
          if (!saved) throw new ConflictError()
          await auditWork(
            tx,
            ctx,
            'finance.job_application.anonymize',
            { type: APPLICATION, id: applicationId },
            ANONYMIZED_FIELDS,
          )
        }
        body = {
          data: {
            anonymizedCount: parsed.applicationIds.length,
            cvFileCount: files,
            reason: parsed.reason,
          },
        }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Saklama ayarı (K-441): gönderilmeyen alan korunur; `If-Match` ayar sürümü (hiç yoksa 1). */
export function setJobApplicationSettingsCommand(
  ctx: ServiceContext,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SETTINGS, id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.job_application.settings',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = jobApplicationSettingsSchema.parse(input)
        const current = await loadJobApplicationSettings(tx, ctx.institutionId)
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => planJobApplicationSettings(current, parsed) }
      },
      after: async (tx, plan) => {
        const saved = await saveJobApplicationSettings(tx, ctx.institutionId, {
          ...plan.next,
          expectedVersion,
          now: ctx.now,
        })
        if (saved === null) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.job_application.settings', entity, plan.changed)
        body = { data: await loadJobApplicationSettings(tx, ctx.institutionId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
