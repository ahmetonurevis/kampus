import { randomUUID } from 'node:crypto'

import {
  assertCandidateInterviewPlan,
  averagePercent,
  candidateEvaluationInputSchema,
  candidateEvaluationScore,
  candidateInterviewCreateSchema,
  candidateInterviewEmptySchema,
  candidateInterviewSummary,
  candidateInterviewUpdateSchema,
  interviewFormKind,
  planCandidateEvaluation,
  planCandidateInterviewCancel,
  planCandidateInterviewComplete,
  planCandidateInterviewUpdate,
  planInterviewTemplate,
  planInterviewTemplateArchive,
  planInterviewTemplateUpdate,
  planInterviewTemplateVersion,
  type CandidateInterviewForm,
} from '@kampus/school-core/lib/finance-candidate-interviews.ts'

import type { Database } from '../db/client.ts'
import {
  archiveInterviewTemplate,
  findCandidateInterview,
  findInterviewTemplate,
  insertCandidateInterview,
  insertInterviewTemplate,
  insertInterviewTemplateVersion,
  interviewCountsByVersion,
  listApplicationInterviews,
  listAssignedInterviews,
  listEvaluations,
  listInterviewTemplates,
  submitEvaluation,
  updateInterviewTemplateVersion,
  updatePlannedInterview,
  type InterviewTemplateQuery,
  type StoredCandidateInterview,
  type StoredEvaluation,
  type StoredInterviewForm,
  type StoredInterviewTemplate,
} from '../db/finance-candidate-interviews.ts'
import { findJobApplication } from '../db/finance-job-postings.ts'
import {
  findObservationMember,
  findObservationTemplate,
} from '../db/finance-lesson-observations.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Aday değerlendirme ve mülakat (DOM-FIN-138; ON-178; K-469…K-471). Kural core
 * `lib/finance-candidate-interviews.ts`'tedir; servis kurum kilidi altında başvuruyu (ON-177),
 * formu (mülakat formu ya da örnek derste ON-206 gözlem formu sürümü), üyelikleri ve
 * değerlendirmeyi yükler, tek transaction'da yazar ve denetime alan adlarını yazar (aday verisi,
 * not ve puan yazılmaz). Puan saklanmaz; her yanıtta form sürümünden hesaplanır. Başvurudaki
 * mülakatları yalnız yönetici görür; değerlendirici kendi listesinde yalnız kendi formunu görür.
 * Rol ve modül denetimi rotadadır.
 */

const TEMPLATE_ENTITY = 'interview_templates'
const INTERVIEW_ENTITY = 'candidate_interviews'
const EVALUATION_ENTITY = 'candidate_interview_evaluations'

function only<T>(items: readonly T[]): T {
  const [item] = items
  if (item === undefined) throw new Error('view row was not built')
  return item
}

// --- Şablon --------------------------------------------------------------------------------------

function templateView(template: StoredInterviewTemplate, usedCount: number) {
  return { ...template, interviewCount: usedCount, used: usedCount > 0 }
}

async function templateViews(db: Database, ctx: ServiceContext, items: StoredInterviewTemplate[]) {
  const counts = await interviewCountsByVersion(
    db,
    ctx.institutionId,
    items.map((item) => item.versionId),
  )
  return items.map((item) => templateView(item, counts.get(item.versionId) ?? 0))
}

export async function listInterviewTemplatesFor(
  ctx: ServiceContext,
  query: InterviewTemplateQuery,
) {
  const { items, total } = await listInterviewTemplates(ctx.db, ctx.institutionId, query)
  return { items: await templateViews(ctx.db, ctx, items), total }
}

async function templateBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findInterviewTemplate(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('interview template was not written')
  return { data: only(await templateViews(tx, ctx, [saved])) }
}

/** Yeni mülakat formu, sürüm 1 (K-470). `Idempotency-Key` rotada zorunlu. 201. */
export function createInterviewTemplateCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: TEMPLATE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.interview_template.create',
      collections: [],
      entity,
      load: () => Promise.resolve({ run: () => planInterviewTemplate(input) }),
      after: async (tx, plan) => {
        await insertInterviewTemplate(tx, ctx.institutionId, {
          id,
          versionId: randomUUID(),
          ...plan,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.interview_template.create', entity, [
          'name',
          'scaleMax',
          'criteria',
        ])
        body = await templateBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function loadTemplateForWrite(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
) {
  const template = await findInterviewTemplate(tx, ctx.institutionId, id)
  if (template === null) throw new NotFoundError()
  if (template.version !== expectedVersion) throw new ConflictError()
  const counts = await interviewCountsByVersion(tx, ctx.institutionId, [template.versionId])
  return {
    template,
    facts: {
      archived: template.archivedAt !== null,
      used: (counts.get(template.versionId) ?? 0) > 0,
    },
  }
}

/** Kullanılmamış son sürümün düzeltmesi (K-470); kullanılmış sürüm 409. `If-Match` zorunlu. */
export function updateInterviewTemplateCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TEMPLATE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.interview_template.update',
      collections: [],
      entity,
      load: async (tx) => {
        const { template, facts } = await loadTemplateForWrite(tx, ctx, id, expectedVersion)
        return {
          run: () => ({
            versionId: template.versionId,
            patch: planInterviewTemplateUpdate(facts, input),
          }),
        }
      },
      after: async (tx, plan) => {
        const saved = await updateInterviewTemplateVersion(tx, ctx.institutionId, {
          id,
          versionId: plan.versionId,
          expectedVersion,
          patch: plan.patch,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.interview_template.update',
          entity,
          Object.keys(plan.patch),
        )
        body = await templateBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Yeni sürüm (K-470): önceki sürümler ve değerlendirmeleri değişmez. */
export function createInterviewTemplateVersionCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TEMPLATE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.interview_template.version',
      collections: [],
      entity,
      load: async (tx) => {
        const { template, facts } = await loadTemplateForWrite(tx, ctx, id, expectedVersion)
        return {
          run: () => ({
            versionNumber: template.versionNumber + 1,
            ...planInterviewTemplateVersion(facts, input),
          }),
        }
      },
      after: async (tx, plan) => {
        const saved = await insertInterviewTemplateVersion(tx, ctx.institutionId, {
          id,
          versionId: randomUUID(),
          expectedVersion,
          ...plan,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.interview_template.version', entity, [
          'versionNumber',
          'name',
          'scaleMax',
          'criteria',
        ])
        body = await templateBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Arşiv (K-470): yeni mülakatta seçilmez; eski mülakatlar sürümüyle okunur. */
export function archiveInterviewTemplateCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TEMPLATE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.interview_template.archive',
      collections: [],
      entity,
      load: async (tx) => {
        candidateInterviewEmptySchema.parse(input)
        const { facts } = await loadTemplateForWrite(tx, ctx, id, expectedVersion)
        return { run: () => planInterviewTemplateArchive(facts) }
      },
      after: async (tx) => {
        const saved = await archiveInterviewTemplate(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.interview_template.archive', entity, ['archivedAt'])
        body = await templateBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Görünüm -------------------------------------------------------------------------------------

const coreForm = (form: StoredInterviewForm): CandidateInterviewForm =>
  form.kind === 'interview'
    ? { kind: 'interview', scaleMax: form.scaleMax, criteria: form.criteria }
    : { kind: 'observation', criteria: form.criteria }

function formView(form: StoredInterviewForm) {
  return {
    kind: form.kind,
    templateId: form.templateId,
    versionId: form.versionId,
    versionNumber: form.versionNumber,
    name: form.name,
    scaleMin: form.kind === 'interview' ? 1 : 0,
    scaleMax: form.kind === 'interview' ? form.scaleMax : 5,
    criteria: form.criteria.map((criterion) => ({
      id: criterion.id,
      title: criterion.title,
      description: criterion.description,
      weight: criterion.weight,
      levels: 'levels' in criterion ? criterion.levels : [],
    })),
  }
}

function evaluationView(
  evaluation: StoredEvaluation,
  form: CandidateInterviewForm,
  ctx: ServiceContext,
) {
  return {
    id: evaluation.id,
    evaluatorMembershipId: evaluation.evaluatorMembershipId,
    evaluatorName: evaluation.evaluatorName,
    mine: evaluation.evaluatorMembershipId === ctx.actor.membershipId,
    submittedAt: evaluation.submittedAt,
    ratings: evaluation.ratings,
    generalNote: evaluation.generalNote,
    score: evaluation.ratings === null ? null : candidateEvaluationScore(form, evaluation.ratings),
  }
}

const submittedPercents = (evaluations: readonly { score: { percent: number } | null }[]) =>
  evaluations.flatMap((evaluation) => (evaluation.score === null ? [] : [evaluation.score.percent]))

function interviewView(
  interview: StoredCandidateInterview,
  evaluations: readonly StoredEvaluation[],
  ctx: ServiceContext,
) {
  const form = coreForm(interview.form)
  const rows = evaluations
    .filter((evaluation) => evaluation.candidateInterviewId === interview.id)
    .map((evaluation) => evaluationView(evaluation, form, ctx))
  const percents = submittedPercents(rows)
  return {
    id: interview.id,
    jobApplicationId: interview.jobApplicationId,
    type: interview.type,
    scheduledAt: interview.scheduledAt,
    location: interview.location,
    meetingUrl: interview.meetingUrl,
    status: interview.status,
    completedAt: interview.completedAt,
    cancelledAt: interview.cancelledAt,
    form: formView(interview.form),
    evaluatorCount: rows.length,
    submittedCount: percents.length,
    averagePercent: averagePercent(percents),
    evaluations: rows,
    createdAt: interview.createdAt,
    updatedAt: interview.updatedAt,
    version: interview.version,
  }
}

async function applicationInterviews(db: Database, ctx: ServiceContext, applicationId: string) {
  const interviews = await listApplicationInterviews(db, ctx.institutionId, applicationId)
  const evaluations = await listEvaluations(
    db,
    ctx.institutionId,
    interviews.map((interview) => interview.id),
  )
  const views = interviews.map((interview) => interviewView(interview, evaluations, ctx))
  const summary = candidateInterviewSummary(
    views.map((view) => ({
      type: view.type,
      status: view.status,
      submittedPercents: submittedPercents(view.evaluations),
    })),
  )
  return { interviews: views, summary }
}

/** Başvuru ayrıntısındaki mülakat özeti (K-469); başvuru servisi çağırır. */
export async function interviewSummaryFor(
  db: Database,
  ctx: ServiceContext,
  applicationId: string,
) {
  return (await applicationInterviews(db, ctx, applicationId)).summary
}

// --- Okuma ---------------------------------------------------------------------------------------

/** Başvurunun mülakatları, değerlendirmeleri ve özeti; başka kurumun başvurusu 404. */
export async function listApplicationInterviewsFor(ctx: ServiceContext, applicationId: string) {
  const application = await findJobApplication(ctx.db, ctx.institutionId, applicationId)
  if (application === null) throw new NotFoundError()
  return applicationInterviews(ctx.db, ctx, applicationId)
}

/** Değerlendiricinin mülakatları (K-470): yalnız kendi değerlendirme satırı döner. */
export async function listAssignedInterviewsFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; pending: boolean },
) {
  const { items, total } = await listAssignedInterviews(ctx.db, ctx.institutionId, {
    ...query,
    membershipId: ctx.actor.membershipId,
  })
  const evaluations = (
    await listEvaluations(
      ctx.db,
      ctx.institutionId,
      items.map((item) => item.interview.id),
    )
  ).filter((evaluation) => evaluation.evaluatorMembershipId === ctx.actor.membershipId)
  return {
    items: items.map((item) => {
      const view = interviewView(item.interview, evaluations, ctx)
      return {
        id: view.id,
        jobApplicationId: view.jobApplicationId,
        candidateName: item.candidateName,
        postingTitle: item.postingTitle,
        type: view.type,
        scheduledAt: view.scheduledAt,
        location: view.location,
        meetingUrl: view.meetingUrl,
        status: view.status,
        form: view.form,
        evaluation: only(view.evaluations),
      }
    }),
    total,
  }
}

// --- Mülakat yazma -------------------------------------------------------------------------------

/** Yanıt gövdesi; yönetici olmayan değerlendirici yalnız kendi satırını görür (K-470). */
async function interviewBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findCandidateInterview(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('candidate interview was not written')
  const evaluations = (await listEvaluations(tx, ctx.institutionId, [id])).filter(
    (evaluation) =>
      ctx.actor.role === 'yonetici' || evaluation.evaluatorMembershipId === ctx.actor.membershipId,
  )
  return { data: interviewView(saved, evaluations, ctx) }
}

/** Formun son sürümü (tür örnek dersse gözlem formu); kurumda yoksa `null`. */
async function formTemplate(
  tx: Database,
  ctx: ServiceContext,
  kind: ReturnType<typeof interviewFormKind>,
  templateId: string,
) {
  const template =
    kind === 'observation'
      ? await findObservationTemplate(tx, ctx.institutionId, templateId)
      : await findInterviewTemplate(tx, ctx.institutionId, templateId)
  return template === null
    ? null
    : { archived: template.archivedAt !== null, versionId: template.versionId }
}

/**
 * Mülakat planı (K-469): başvuru "mülakat" aşamasında, form arşivlenmemiş, değerlendiriciler
 * kurumun etkin yönetici ya da öğretmeni. Değerlendirici başına satır açılır. `Idempotency-Key`
 * rotada zorunlu. 201.
 */
export function createCandidateInterviewCommand(
  ctx: ServiceContext,
  applicationId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: INTERVIEW_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.candidate_interview.create',
      collections: [],
      entity,
      load: async (tx) => {
        const application = await findJobApplication(tx, ctx.institutionId, applicationId)
        if (application === null) throw new NotFoundError()
        const parsed = candidateInterviewCreateSchema.parse(input)
        const kind = interviewFormKind(parsed.type)
        const [template, evaluators] = await Promise.all([
          formTemplate(tx, ctx, kind, parsed.templateId),
          Promise.all(
            parsed.evaluatorMembershipIds.map((membershipId) =>
              findObservationMember(tx, ctx.institutionId, membershipId),
            ),
          ),
        ])
        return {
          run: () => {
            assertCandidateInterviewPlan({ application, template, evaluators })
            const versionId = template?.versionId ?? ''
            return {
              parsed,
              interviewTemplateVersionId: kind === 'interview' ? versionId : null,
              observationTemplateVersionId: kind === 'observation' ? versionId : null,
            }
          },
        }
      },
      after: async (tx, plan) => {
        const { parsed } = plan
        await insertCandidateInterview(tx, ctx.institutionId, {
          id,
          jobApplicationId: applicationId,
          type: parsed.type,
          scheduledAt: new Date(parsed.scheduledAt),
          location: parsed.location,
          meetingUrl: parsed.meetingUrl,
          interviewTemplateVersionId: plan.interviewTemplateVersionId,
          observationTemplateVersionId: plan.observationTemplateVersionId,
          evaluators: parsed.evaluatorMembershipIds.map((membershipId) => ({
            id: randomUUID(),
            membershipId,
          })),
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.candidate_interview.create', entity, [
          'jobApplicationId',
          'type',
          'scheduledAt',
          ...(parsed.location === null ? [] : ['location']),
          ...(parsed.meetingUrl === null ? [] : ['meetingUrl']),
          'templateVersionId',
          'evaluatorMembershipIds',
        ])
        body = await interviewBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function loadInterviewForWrite(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
) {
  const interview = await findCandidateInterview(tx, ctx.institutionId, id)
  if (interview === null) throw new NotFoundError()
  if (interview.version !== expectedVersion) throw new ConflictError()
  const application = await findJobApplication(tx, ctx.institutionId, interview.jobApplicationId)
  if (application === null) throw new NotFoundError()
  return { interview, application }
}

/** Planlı mülakatın düzeltmesi (K-469): an, yer, bağlantı. `If-Match` mülakat sürümü. */
export function updateCandidateInterviewCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: INTERVIEW_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.candidate_interview.update',
      collections: [],
      entity,
      load: async (tx) => {
        const { interview, application } = await loadInterviewForWrite(tx, ctx, id, expectedVersion)
        const parsed = candidateInterviewUpdateSchema.parse(input)
        return { run: () => planCandidateInterviewUpdate(interview, application, parsed) }
      },
      after: async (tx, plan) => {
        const saved = await updatePlannedInterview(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { ...plan.next, scheduledAt: new Date(plan.next.scheduledAt) },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.candidate_interview.update', entity, plan.changed)
        body = await interviewBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** "Yapıldı" (K-469): mülakat anı geldiyse; değerlendiriciler formu bundan sonra gönderir. */
export function completeCandidateInterviewCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: INTERVIEW_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.candidate_interview.complete',
      collections: [],
      entity,
      load: async (tx) => {
        candidateInterviewEmptySchema.parse(input)
        const { interview, application } = await loadInterviewForWrite(tx, ctx, id, expectedVersion)
        return { run: () => planCandidateInterviewComplete(interview, application, ctx.now) }
      },
      after: async (tx) => {
        const saved = await updatePlannedInterview(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: {
            status: 'completed',
            completedAt: ctx.now,
            completedByUserId: ctx.actor.userId,
          },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.candidate_interview.complete', entity, [
          'status',
          'completedAt',
        ])
        body = await interviewBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** İptal (K-469): yalnız planlı mülakat. */
export function cancelCandidateInterviewCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: INTERVIEW_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.candidate_interview.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        candidateInterviewEmptySchema.parse(input)
        const { interview } = await loadInterviewForWrite(tx, ctx, id, expectedVersion)
        return { run: () => planCandidateInterviewCancel(interview) }
      },
      after: async (tx) => {
        const saved = await updatePlannedInterview(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: {
            status: 'cancelled',
            cancelledAt: ctx.now,
            cancelledByUserId: ctx.actor.userId,
          },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.candidate_interview.cancel', entity, [
          'status',
          'cancelledAt',
        ])
        body = await interviewBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Değerlendirme -------------------------------------------------------------------------------

/**
 * Değerlendirme gönderimi (K-470): isteği yapan kendi formunu bir kez gönderir; puan sunucuda
 * hesaplanır. Öğretmen değerlendirici değilse mülakat yokmuş gibi 404; değerlendirici olmayan
 * yönetici 422. Notlar ve puanlar denetime yazılmaz. `Idempotency-Key` rotada zorunlu.
 */
export function submitCandidateEvaluationCommand(
  ctx: ServiceContext,
  interviewId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: INTERVIEW_ENTITY, id: interviewId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.candidate_interview.evaluate',
      collections: [],
      entity,
      load: async (tx) => {
        const interview = await findCandidateInterview(tx, ctx.institutionId, interviewId)
        if (interview === null) throw new NotFoundError()
        const [evaluations, application] = await Promise.all([
          listEvaluations(tx, ctx.institutionId, [interviewId]),
          findJobApplication(tx, ctx.institutionId, interview.jobApplicationId),
        ])
        const own =
          evaluations.find(
            (evaluation) => evaluation.evaluatorMembershipId === ctx.actor.membershipId,
          ) ?? null
        if (application === null || (own === null && ctx.actor.role !== 'yonetici'))
          throw new NotFoundError()
        const parsed = candidateEvaluationInputSchema.parse(input)
        return {
          run: () => ({
            own,
            generalNote: parsed.generalNote,
            ...planCandidateEvaluation(
              {
                interview,
                application,
                evaluation: own,
                form: coreForm(interview.form),
              },
              parsed,
            ),
          }),
        }
      },
      after: async (tx, plan) => {
        if (plan.own === null) throw new Error('evaluation row was checked in run')
        const saved = await submitEvaluation(tx, ctx.institutionId, {
          id: plan.own.id,
          expectedVersion: plan.own.version,
          ratings: plan.ratings,
          generalNote: plan.generalNote,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.candidate_interview.evaluate',
          { type: EVALUATION_ENTITY, id: plan.own.id },
          ['ratings', 'generalNote', 'submittedAt'],
        )
        body = await interviewBody(tx, ctx, interviewId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
