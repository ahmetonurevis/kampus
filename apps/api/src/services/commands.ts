import { eq } from 'drizzle-orm'

import type { State } from '@kampus/school-core/data/seed.ts'
import { runAssessment } from '@kampus/school-core/lib/assessment-automation.ts'
import { payInvoice, recordAttendance, type Session } from '@kampus/school-core/lib/domain.ts'
import {
  archiveRecord,
  restoreRecord,
  type ArchiveKind,
} from '@kampus/school-core/lib/school-management.ts'
import { runWorkflow, type WorkflowCommand } from '@kampus/school-core/lib/school-workflows.ts'
import { SCOPE_SOURCE_COLLECTIONS, scopeFor } from '@kampus/school-core/lib/scope.ts'

import { isRecordCollection, type CollectionName, type ScalarStateKey } from '../db/collections.ts'
import { institutionSettings } from '../db/schema/institution-settings.ts'
import { ForbiddenError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { commandBody } from './command-result.ts'
import { listMembershipLinks } from './memberships.ts'
import { getEnabledModules } from './modules.ts'
import {
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
  type OperationRequest,
} from './operation-runner.ts'

/**
 * Yazma uçlarının servisi: school-core işlemlerini (`runWorkflow`, `runAssessment`,
 * `payInvoice`, `recordAttendance`, `archiveRecord`, `restoreRecord`) işlem çalıştırıcıyla
 * yürütür. Yetki ve kapsam core'un kuralıdır: oturum core'a üyelik bağlantılarıyla
 * (`links`) verilir ve core kişiye göre kapsamı (`scopeFor`) kendisi hesaplar. Core'da rol
 * denetimi olmayan işlemlerin (ödeme, yoklama, arşiv) rol listesi uçtadır (`routes/commands.ts`).
 *
 * Koleksiyon listeleri işlem dosyalarının okuduğu State anahtarlarıdır: işlem dosyası +
 * yardımcıları (`tutor-conflicts.ts`) + core kapsam kaynakları (`SCOPE_SOURCE_COLLECTIONS`,
 * velinin demo yolu için `parents`). Eksik koleksiyon sessizce boş görünmez; işlem çalıştırıcı
 * 500 ile durur ve testler bunu yakalar.
 * TODO(core-command-collections): core işlem başına okuduğu koleksiyonları dışa aktarınca
 * buradaki listeler oradan okunur.
 */

const SCOPE_COLLECTIONS: readonly CollectionName[] = [...SCOPE_SOURCE_COLLECTIONS, 'parents']
const TUTOR_CONFLICT_COLLECTIONS: readonly CollectionName[] = [
  'appointments',
  'classes',
  'schedule',
  'schoolEvents',
  'students',
  'tutorSessions',
]

const WORKFLOW_COLLECTIONS: readonly CollectionName[] = [
  ...SCOPE_COLLECTIONS,
  ...TUTOR_CONFLICT_COLLECTIONS,
  'branches',
  'clubAttendance',
  'clubMemberships',
  'contracts',
  'enrollmentHistory',
  'eventConsents',
  'guidanceCases',
  'invoices',
  'mealMenus',
  'mockExams',
  'mockResults',
  'renewals',
  'socialAchievements',
  'studentGoals',
  'studyTasks',
  'subjects',
  'transportAssignments',
  'transportRoutes',
]

const ASSESSMENT_COLLECTIONS: readonly CollectionName[] = [
  ...SCOPE_COLLECTIONS,
  ...TUTOR_CONFLICT_COLLECTIONS,
  'availability',
  'branches',
  'mockExams',
  'mockResults',
  'opticalEvaluations',
  'opticalProfiles',
  'subjects',
]

const ARCHIVE_COLLECTIONS: readonly CollectionName[] = [
  ...TUTOR_CONFLICT_COLLECTIONS,
  'assignments',
  'availability',
  'branches',
  'clubMemberships',
  'clubs',
  'contracts',
  'guidanceCases',
  'homework',
  'mealMenus',
  'prospects',
  'questions',
  'quizzes',
  'renewals',
  'studyTasks',
  'submissions',
  'teachers',
  'transportAssignments',
  'transportRoutes',
]

const ATTENDANCE_COLLECTIONS: readonly CollectionName[] = [...SCOPE_COLLECTIONS, 'attendance']

/** Uç seçenekleri: istek anahtarı, `If-Match` sürümü ve velinin seçili çocuğu. */
export interface CommandOptions {
  idempotency: IdempotencyRequest | null
  /** `If-Match`: işlemin konusu olan kaydın okunan sürümü. */
  expectedVersion: number | null
}

interface Environment {
  session: Session
  scalars: Partial<Pick<State, ScalarStateKey>>
}

/**
 * Core oturumu ve skaler State alanları: bağlantılar `membership_links`'ten, modüller kurumdan,
 * eğitim yılı `institution_settings`'ten. Ayar satırı yoksa `academicYear` verilmez; onu okuyan
 * işlem (yenileme) 500 ile durur.
 */
async function environment(ctx: ServiceContext, childId?: string): Promise<Environment> {
  const [links, modules, settings] = await Promise.all([
    listMembershipLinks(ctx.db, ctx.institutionId, ctx.actor.membershipId),
    getEnabledModules(ctx.db, ctx.institutionId),
    ctx.db
      .select({ academicYear: institutionSettings.academicYear })
      .from(institutionSettings)
      .where(eq(institutionSettings.institutionId, ctx.institutionId))
      .limit(1),
  ])
  const session: Session = { role: ctx.actor.role, links }
  if (childId !== undefined) session.childId = childId
  const scalars: Partial<Pick<State, ScalarStateKey>> = { modules: modules ?? {} }
  const academicYear = settings[0]?.academicYear
  if (academicYear !== undefined) scalars.academicYear = academicYear
  return { session, scalars }
}

type Entity = { collection: CollectionName; id: string } | null

function execute(
  ctx: ServiceContext,
  request: OperationRequest<Entity>,
  options: CommandOptions,
): Promise<CommandResponse> {
  return runCommand(
    ctx,
    request,
    (outcome) => commandBody(outcome.result, outcome.changes),
    options.idempotency,
  )
}

function auditEntity(fallback: string) {
  return (entity: Entity) =>
    entity ? { type: entity.collection, id: entity.id } : { type: 'workflow', id: fallback }
}

/** Core denetim girdisinden işlemin konusu (yalnız işlem içinde yaşar, yazılmaz). */
function auditedEntity(state: State, command: string): Entity {
  const entry = state.audit[0]
  const collection = entry?.table_name
  if (!entry || collection === undefined || !isRecordCollection(collection)) return null
  return entry.record_id === command ? null : { collection, id: entry.record_id }
}

export interface WorkflowInput {
  command: WorkflowCommand
  /** Ham gövde: core şemayı kendisi uygular (dönüşümler iki kez uygulanmasın). */
  input: unknown
  recordId: string | undefined
  childId: string | undefined
}

/** `runWorkflow` köprüsü (api-tasarimi.md §1 geçiş köprüsü). */
export async function executeWorkflowCommand(
  ctx: ServiceContext,
  workflow: WorkflowInput,
  options: CommandOptions,
): Promise<CommandResponse> {
  const { session, scalars } = await environment(ctx, workflow.childId)
  const { command, input, recordId } = workflow
  return execute(
    ctx,
    {
      action: `workflow.${command}`,
      collections: WORKFLOW_COLLECTIONS,
      scalars,
      ...(recordId !== undefined && options.expectedVersion !== null
        ? { expectedRecordVersion: { id: recordId, version: options.expectedVersion } }
        : {}),
      entity: auditEntity(recordId ?? command),
      run: (state, { now, makeId }) => {
        runWorkflow(state, session, command, input, makeId, recordId, now)
        return auditedEntity(state, command)
      },
    },
    options,
  )
}

export type TutoringCommand = 'plan' | 'cancel' | 'attendance'

/** Etüt işlemleri (`runAssessment`): plan onayı, iptal, yoklama. */
export async function executeTutoringCommand(
  ctx: ServiceContext,
  command: TutoringCommand,
  input: Readonly<Record<string, unknown>>,
  recordId: string | undefined,
  options: CommandOptions,
): Promise<CommandResponse> {
  const { session, scalars } = await environment(ctx)
  return execute(
    ctx,
    {
      action: `tutoring.${command}`,
      collections: ASSESSMENT_COLLECTIONS,
      scalars,
      ...(recordId !== undefined && options.expectedVersion !== null
        ? {
            expectedVersions: [
              { collection: 'tutorSessions', id: recordId, version: options.expectedVersion },
            ],
          }
        : {}),
      entity: auditEntity(recordId ?? command),
      run: (state, { now, makeId }) => {
        runAssessment(state, session, command, input, makeId, recordId ?? '', now)
        return recordId === undefined ? null : { collection: 'tutorSessions', id: recordId }
      },
    },
    options,
  )
}

/** Taksit ödemesi (DOM-FIN: aynı ödeme iki kez işlenmez; core `invoice_already_paid` 409). */
export async function payInvoiceCommand(
  ctx: ServiceContext,
  invoiceId: string,
  method: string,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'invoice.pay',
      collections: ['invoices'],
      ...(options.expectedVersion !== null
        ? {
            expectedVersions: [
              { collection: 'invoices', id: invoiceId, version: options.expectedVersion },
            ],
          }
        : {}),
      entity: { type: 'invoices', id: invoiceId },
      run: (state, { now }) => {
        payInvoice(state, invoiceId, method, now)
        return { collection: 'invoices', id: invoiceId }
      },
    },
    options,
  )
}

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

/**
 * Sınıfın günlük yoklaması (`recordAttendance`): aynı öğrenci ve gün için tek kayıt güncellenir,
 * yinelenmez. Core'da rol/kapsam denetimi yoktur: öğretmen yalnız core kapsamındaki
 * (`scopeFor(...).classIds`) sınıfta yoklama alır.
 * TODO(core-attendance-scope): core ders saati bazında yoklama yetkisini (DOM-YTK-022) verince
 * buradaki sınıf denetimi kalkar.
 */
export async function recordAttendanceCommand(
  ctx: ServiceContext,
  classId: string,
  date: string,
  marks: Readonly<Record<string, AttendanceStatus>>,
  options: CommandOptions,
): Promise<CommandResponse> {
  const { session, scalars } = await environment(ctx)
  return execute(
    ctx,
    {
      action: 'attendance.record',
      collections: ATTENDANCE_COLLECTIONS,
      scalars,
      entity: { type: 'classes', id: classId },
      run: (state) => {
        if (!state.classes.some((item) => item.id === classId)) throw new NotFoundError()
        if (session.role === 'ogretmen') {
          const scope = scopeFor(state, { role: session.role, links: session.links ?? [] })
          if (!scope.classIds.has(classId)) throw new ForbiddenError()
        }
        // Gün Europe/Istanbul günüdür; 09:00Z o günün öğlesidir (istemcilerle aynı biçim).
        recordAttendance(state, classId, `${date}T09:00:00.000Z`, marks)
        return { collection: 'classes', id: classId }
      },
    },
    options,
  )
}

const ARCHIVE_TARGET = {
  branch: 'branches',
  class: 'classes',
  teacher: 'teachers',
} as const satisfies Record<ArchiveKind, CollectionName>

/** Kampüs/sınıf/kadro arşivi; bağlı kayıtlar `replacementId`'ye aktarılır (core kuralı). */
export async function archiveCommand(
  ctx: ServiceContext,
  kind: ArchiveKind,
  recordId: string,
  replacementId: string,
  options: CommandOptions,
): Promise<CommandResponse> {
  return archiveOrRestore(ctx, kind, recordId, options, 'archive', (state, now) =>
    archiveRecord(state, kind, recordId, replacementId, now),
  )
}

/** Arşivden geri alma; aktarılan görevler otomatik geri taşınmaz (core kuralı). */
export async function restoreCommand(
  ctx: ServiceContext,
  kind: ArchiveKind,
  recordId: string,
  options: CommandOptions,
): Promise<CommandResponse> {
  return archiveOrRestore(ctx, kind, recordId, options, 'restore', (state) =>
    restoreRecord(state, kind, recordId),
  )
}

async function archiveOrRestore(
  ctx: ServiceContext,
  kind: ArchiveKind,
  recordId: string,
  options: CommandOptions,
  verb: 'archive' | 'restore',
  run: (state: State, now: string) => void,
): Promise<CommandResponse> {
  const collection = ARCHIVE_TARGET[kind]
  return execute(
    ctx,
    {
      action: `${collection}.${verb}`,
      collections: ARCHIVE_COLLECTIONS,
      ...(options.expectedVersion !== null
        ? { expectedVersions: [{ collection, id: recordId, version: options.expectedVersion }] }
        : {}),
      entity: { type: collection, id: recordId },
      run: (state, { now }) => {
        run(state, now)
        return { collection, id: recordId }
      },
    },
    options,
  )
}
