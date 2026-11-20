import { randomUUID } from 'node:crypto'

import {
  multiSourceFeedbackResult,
  multiSourceFeedbackSummary,
  planStaffFeedbackAssignment,
  planStaffFeedbackAssignmentRemove,
  planStaffFeedbackResponse,
  planStaffFeedbackSettings,
  planStaffFeedbackTemplate,
  planStaffFeedbackTemplateUpdate,
  planStaffFeedbackWithdraw,
  staffFeedbackAssignmentCreateSchema,
  staffFeedbackResponseSchema,
  staffFeedbackSettingsSchema,
  staffFeedbackTemplateInputSchema,
  type StaffFeedbackResult,
} from '@kampus/school-core/lib/finance-staff-feedback.ts'

import type { Database } from '../db/client.ts'
import { findPerformancePeriod, findPerformanceStaff } from '../db/finance-performance.ts'
import {
  archiveStaffFeedbackAssignment,
  findPeriodStaffFeedbackTemplate,
  findStaffFeedbackAssignment,
  findStaffFeedbackSubject,
  findStaffFeedbackTemplate,
  insertStaffFeedbackAssignment,
  insertStaffFeedbackTemplate,
  listStaffFeedbackAssignments,
  listStaffFeedbackSubjects,
  loadStaffFeedbackSettings,
  loadSubmittedStaffFeedback,
  recordStaffFeedbackResponse,
  saveStaffFeedbackSettings,
  staffFeedbackCounts,
  staffFeedbackPairExists,
  templateResponseCount,
  updateStaffFeedbackTemplate,
  withdrawStaffFeedbackResponse,
  type StaffFeedbackAssignmentQuery,
  type StaffFeedbackSubjectQuery,
  type StoredStaffFeedbackAssignment,
  type StoredStaffFeedbackTemplate,
} from '../db/finance-staff-feedback.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Çok kaynaklı geri bildirim (DOM-FIN-134; ON-212). Kural core `lib/finance-staff-feedback.ts`'tedir;
 * servis kurum kilidi altında dönemi, şablonu, atamayı ve personeli yükler, tek transaction'da
 * yazar ve denetime alan adlarını yazar (cevap ve gerekçe metni yazılmaz). Hiçbir uç tek bir
 * meslektaş yanıtını döndürmez: cevaplar yalnız `multiSourceFeedbackResult`'tan toplu çıkar ve
 * sonucun okunuşu aynı transaction'da `finance.staff_feedback_result.read` denetimine düşer
 * (K-459). Rol ve modül denetimi rotadadır.
 */

const SETTINGS_ENTITY = 'staff_feedback_settings'
const TEMPLATE_ENTITY = 'staff_feedback_templates'
const ASSIGNMENT_ENTITY = 'staff_feedback_assignments'
const RESULT_ACTION = 'finance.staff_feedback_result.read'

async function templateView(
  db: Database,
  ctx: ServiceContext,
  template: StoredStaffFeedbackTemplate,
) {
  const responseCount = await templateResponseCount(db, ctx.institutionId, template.id)
  return { ...template, responseCount, locked: responseCount > 0 }
}

async function loadPeriod(db: Database, ctx: ServiceContext, periodId: string) {
  const period = await findPerformancePeriod(db, ctx.institutionId, periodId)
  if (period === null) throw new NotFoundError()
  return period
}

/** Dönemin şablonu (yoksa boş), atanan/yanıtlanan oranı ve anonimlik eşiği. Başka kurum 404. */
export async function getStaffFeedbackOverview(ctx: ServiceContext, periodId: string) {
  const period = await loadPeriod(ctx.db, ctx, periodId)
  const [template, counts, settings] = await Promise.all([
    findPeriodStaffFeedbackTemplate(ctx.db, ctx.institutionId, periodId),
    staffFeedbackCounts(ctx.db, ctx.institutionId, periodId),
    loadStaffFeedbackSettings(ctx.db, ctx.institutionId),
  ])
  return {
    periodId,
    periodStatus: period.status,
    template: template === null ? null : await templateView(ctx.db, ctx, template),
    summary: multiSourceFeedbackSummary(counts),
    threshold: settings.peerAnonymityThreshold,
  }
}

/** Dönemin değerlendirilenleri ve atanan/yanıtlanan sayıları (K-458). Başka kurum 404. */
export async function listStaffFeedbackSubjectsFor(
  ctx: ServiceContext,
  periodId: string,
  query: StaffFeedbackSubjectQuery,
) {
  await loadPeriod(ctx.db, ctx, periodId)
  const { items, total } = await listStaffFeedbackSubjects(
    ctx.db,
    ctx.institutionId,
    periodId,
    query,
  )
  return {
    items: items.map(({ counts, ...row }) => {
      const summary = multiSourceFeedbackSummary(counts)
      return {
        ...row,
        assigned: summary.assigned,
        responded: summary.responded,
        manager: summary.byRelation.manager,
        peer: summary.byRelation.peer,
      }
    }),
    total,
  }
}

/** Atama satırı: değerlendirilen, değerlendiren, ilişki ve durum; cevap ve gerekçe yok (K-459). */
function assignmentView(assignment: StoredStaffFeedbackAssignment) {
  const { subjectUserId, ...rest } = assignment
  void subjectUserId // yalnız kural denetimi için yüklenir; istemciye dönmez
  return rest
}

/** Dönemin atamaları (süzgeç: değerlendirilen, ilişki, durum; ad araması). Başka kurum 404. */
export async function listStaffFeedbackAssignmentsFor(
  ctx: ServiceContext,
  periodId: string,
  query: StaffFeedbackAssignmentQuery,
) {
  await loadPeriod(ctx.db, ctx, periodId)
  const { items, total } = await listStaffFeedbackAssignments(
    ctx.db,
    ctx.institutionId,
    periodId,
    query,
  )
  return { items: items.map(assignmentView), total }
}

/**
 * Dönemin toplu sonuçları, değerlendirilen üyeliğine göre (K-459). Denetim yazmaz: çağıran
 * (sonuç ucu, performans raporu ON-220) okumayı kendi transaction'ında denetler. Meslektaş cevabı
 * yalnız `multiSourceFeedbackResult` üzerinden toplu çıkar. `subjectMembershipIds` verilmezse
 * değerlendireni atanmış her değerlendirilen döner. Dönem başka kurumdaysa boş harita.
 */
export async function loadStaffFeedbackResults(
  db: Database,
  institutionId: string,
  periodId: string,
  subjectMembershipIds?: readonly string[],
): Promise<Map<string, StaffFeedbackResult>> {
  const period = await findPerformancePeriod(db, institutionId, periodId)
  if (period === null) return new Map()
  const [template, settings, rows] = await Promise.all([
    findPeriodStaffFeedbackTemplate(db, institutionId, periodId),
    loadStaffFeedbackSettings(db, institutionId),
    loadSubmittedStaffFeedback(db, institutionId, periodId, subjectMembershipIds),
  ])
  const ids = subjectMembershipIds ?? [...new Set(rows.map((row) => row.subjectMembershipId))]
  return new Map(
    ids.map((id) => [
      id,
      multiSourceFeedbackResult({
        periodStatus: period.status,
        questions: template?.questions ?? null,
        threshold: settings.peerAnonymityThreshold,
        assignments: rows.filter((row) => row.subjectMembershipId === id),
      }),
    ]),
  )
}

/**
 * Değerlendirilenin toplu sonucu (K-459): yönetici yanıtları adıyla, meslektaş yanıtları yalnız
 * toplu ve eşik üstünde. Okuma aynı transaction'da denetime yazılır (alan adları, meslektaş sonucu
 * görünür mü); denetim yazılamazsa sonuç dönmez. Dönemde performans kaydı olmayan personel ve
 * başka kurum 404.
 */
export async function getStaffFeedbackResultFor(
  ctx: ServiceContext,
  periodId: string,
  membershipId: string,
) {
  return ctx.db.transaction(async (tx) => {
    const period = await loadPeriod(tx, ctx, periodId)
    const subject = await findStaffFeedbackSubject(tx, ctx.institutionId, periodId, membershipId)
    if (subject === null) throw new NotFoundError()
    const results = await loadStaffFeedbackResults(tx, ctx.institutionId, periodId, [membershipId])
    const result = results.get(membershipId)
    if (result === undefined) throw new Error('staff feedback result is missing')
    await tx.insert(auditLog).values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: RESULT_ACTION,
      entityType: 'memberships',
      entityId: membershipId,
      // kvkk: değer değil, dönen kişisel alanların adı; meslektaş toplamı yalnız görünürse.
      changes: {
        fields: result.peer.visible ? ['managerResponses', 'peerAggregate'] : ['managerResponses'],
      },
      createdAt: ctx.now,
    })
    return {
      periodId,
      periodStatus: period.status,
      membershipId,
      staffName: subject.staffName,
      staffRole: subject.staffRole,
      ...result,
    }
  })
}

// --- Ayar ----------------------------------------------------------------------------------------

export function staffFeedbackSettingsFor(ctx: ServiceContext) {
  return loadStaffFeedbackSettings(ctx.db, ctx.institutionId)
}

/** Anonimlik eşiği (K-459); `If-Match` ayar sürümü (hiç kaydedilmediyse 1). */
export function setStaffFeedbackSettingsCommand(
  ctx: ServiceContext,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SETTINGS_ENTITY, id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_feedback.settings',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = staffFeedbackSettingsSchema.parse(input)
        const current = await loadStaffFeedbackSettings(tx, ctx.institutionId)
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => planStaffFeedbackSettings(current, parsed) }
      },
      after: async (tx, next) => {
        const saved = await saveStaffFeedbackSettings(tx, ctx.institutionId, {
          ...next,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staff_feedback.settings', entity, [
          'peerAnonymityThreshold',
        ])
        body = { data: await loadStaffFeedbackSettings(tx, ctx.institutionId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Şablon --------------------------------------------------------------------------------------

async function templateBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findStaffFeedbackTemplate(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('staff feedback template was not written')
  return templateView(tx, ctx, saved)
}

/** Dönemin şablonunu açar (K-457). `Idempotency-Key` rotada zorunludur. 201. */
export function createStaffFeedbackTemplateCommand(
  ctx: ServiceContext,
  periodId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: TEMPLATE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_feedback_template.create',
      collections: [],
      entity,
      load: async (tx) => {
        const period = await loadPeriod(tx, ctx, periodId)
        const parsed = staffFeedbackTemplateInputSchema.parse(input)
        const exists =
          (await findPeriodStaffFeedbackTemplate(tx, ctx.institutionId, periodId)) !== null
        return { run: () => planStaffFeedbackTemplate(period, parsed, { exists }) }
      },
      after: async (tx, questions) => {
        await insertStaffFeedbackTemplate(tx, ctx.institutionId, {
          id,
          periodId,
          questions,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.staff_feedback_template.create', entity, [
          'periodId',
          'questions',
        ])
        body = { data: await templateBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Soruları düzeltir (K-457): yanıt girilmemiş, kapanmamış dönemde. */
export function updateStaffFeedbackTemplateCommand(
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
      action: 'finance.staff_feedback_template.update',
      collections: [],
      entity,
      load: async (tx) => {
        const template = await findStaffFeedbackTemplate(tx, ctx.institutionId, id)
        if (template === null) throw new NotFoundError()
        const period = await loadPeriod(tx, ctx, template.periodId)
        const parsed = staffFeedbackTemplateInputSchema.parse(input)
        if (template.version !== expectedVersion) throw new ConflictError()
        const responseCount = await templateResponseCount(tx, ctx.institutionId, id)
        return { run: () => planStaffFeedbackTemplateUpdate(period, parsed, { responseCount }) }
      },
      after: async (tx, questions) => {
        const saved = await updateStaffFeedbackTemplate(tx, ctx.institutionId, {
          id,
          expectedVersion,
          questions,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staff_feedback_template.update', entity, ['questions'])
        body = { data: await templateBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Atama ---------------------------------------------------------------------------------------

async function assignmentBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findStaffFeedbackAssignment(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('staff feedback assignment was not written')
  return assignmentView(saved)
}

/**
 * Değerlendiren atar (K-458). `Idempotency-Key` rotada zorunludur: çift gönderim ikinci atamayı
 * açmaz. Başka kurumun dönemi 404; başka kurumun üyeliği bulunamaz (422). 201.
 */
export function createStaffFeedbackAssignmentCommand(
  ctx: ServiceContext,
  periodId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ASSIGNMENT_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_feedback_assignment.create',
      collections: [],
      entity,
      load: async (tx) => {
        const period = await loadPeriod(tx, ctx, periodId)
        const parsed = staffFeedbackAssignmentCreateSchema.parse(input)
        const [subject, reviewer, duplicate] = await Promise.all([
          findStaffFeedbackSubject(tx, ctx.institutionId, periodId, parsed.subjectMembershipId),
          findPerformanceStaff(tx, ctx.institutionId, parsed.reviewerMembershipId),
          staffFeedbackPairExists(tx, ctx.institutionId, { periodId, ...parsed }),
        ])
        return {
          run: () => {
            planStaffFeedbackAssignment(parsed, {
              period,
              enrolled: subject !== null,
              reviewer,
              duplicate,
            })
            return parsed
          },
        }
      },
      after: async (tx, plan) => {
        await insertStaffFeedbackAssignment(tx, ctx.institutionId, {
          id,
          periodId,
          ...plan,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.staff_feedback_assignment.create', entity, [
          'subjectMembershipId',
          'reviewerMembershipId',
          'relation',
        ])
        body = { data: await assignmentBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function loadAssignment(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const assignment = await findStaffFeedbackAssignment(tx, ctx.institutionId, id)
  if (assignment === null) throw new NotFoundError()
  const period = await loadPeriod(tx, ctx, assignment.periodId)
  if (assignment.version !== version) throw new ConflictError()
  return { assignment, period }
}

/** Yanıtı girilmemiş atamayı kaldırır (arşiv; K-458). */
export function removeStaffFeedbackAssignmentCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ASSIGNMENT_ENTITY, id }
  return runCommand(
    ctx,
    {
      action: 'finance.staff_feedback_assignment.remove',
      collections: [],
      entity,
      load: async (tx) => {
        const loaded = await loadAssignment(tx, ctx, id, expectedVersion)
        return {
          run: () => planStaffFeedbackAssignmentRemove(loaded.assignment, loaded.period),
        }
      },
      after: async (tx) => {
        const saved = await archiveStaffFeedbackAssignment(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staff_feedback_assignment.remove', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

/**
 * Yanıtı değerlendiren adına girer (K-458): kanal ve cevaplar; zorunlu sorular cevaplı olmalı,
 * giriş yanıtı gönderir. Değerlendirilen yönetici kendisi hakkındaki yanıtı giremez. Cevaplar
 * denetime yazılmaz ve yanıtta dönmez (K-459).
 */
export function recordStaffFeedbackResponseCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ASSIGNMENT_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_feedback.respond',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = staffFeedbackResponseSchema.parse(input)
        const { assignment, period } = await loadAssignment(tx, ctx, id, expectedVersion)
        const template = await findPeriodStaffFeedbackTemplate(
          tx,
          ctx.institutionId,
          assignment.periodId,
        )
        return {
          run: () => ({
            templateId: template?.id ?? '',
            ...planStaffFeedbackResponse(assignment, parsed, {
              period,
              questions: template?.questions ?? null,
              subjectUserId: assignment.subjectUserId,
              actorUserId: ctx.actor.userId,
            }),
          }),
        }
      },
      after: async (tx, plan) => {
        const saved = await recordStaffFeedbackResponse(tx, ctx.institutionId, {
          id,
          expectedVersion,
          ...plan,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staff_feedback.respond', entity, [
          'status',
          'answers',
          'channel',
        ])
        body = { data: await assignmentBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Girilmiş yanıtı gerekçeyle geri alır (K-458): cevaplar silinir; gerekçe metni denetime yazılmaz. */
export function withdrawStaffFeedbackResponseCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ASSIGNMENT_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_feedback.withdraw',
      collections: [],
      entity,
      load: async (tx) => {
        const { assignment, period } = await loadAssignment(tx, ctx, id, expectedVersion)
        return { run: () => planStaffFeedbackWithdraw(assignment, period, input) }
      },
      after: async (tx, reason) => {
        const saved = await withdrawStaffFeedbackResponse(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          reason,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staff_feedback.withdraw', entity, [
          'status',
          'answers',
          'withdrawReason',
          'withdrawCount',
        ])
        body = { data: await assignmentBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
