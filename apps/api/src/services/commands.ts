import { eq } from 'drizzle-orm'

import type { State } from '@kampus/school-core/data/seed.ts'
import { runAssessment } from '@kampus/school-core/lib/assessment-automation.ts'
import { requireAuthorized } from '@kampus/school-core/lib/authorize.ts'
import { payInvoice, recordAttendance, type Session } from '@kampus/school-core/lib/domain.ts'
import {
  archiveRecord,
  restoreRecord,
  type ArchiveKind,
} from '@kampus/school-core/lib/school-management.ts'
import { runWorkflow, type WorkflowCommand } from '@kampus/school-core/lib/school-workflows.ts'
import type { Actor } from '@kampus/school-core/lib/scope.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import {
  ASSESSMENT_COMMANDS,
  OPERATION_COMMANDS,
  WORKFLOW_COMMANDS,
  type CommandSpec,
} from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import { isRecordCollection, type CollectionName, type ScalarStateKey } from '../db/collections.ts'
import { institutionSettings } from '../db/schema/institution-settings.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { commandBody } from './command-result.ts'
import { listMembershipLinks } from './memberships.ts'
import { getInstitutionModules } from './modules.ts'
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
 * (`links`) verilir ve core kişiye göre kapsamı (`scopeFor`) kendisi hesaplar. Yetkiyi kendisi
 * denetlemeyen temel işlemlerden (ödeme, yoklama, arşiv) önce core `requireAuthorized` çalışır
 * (DOM-YTK-001); eylemin yükleyeceği koleksiyonlar core komut tablosundandır
 * (`OPERATION_COMMANDS`).
 *
 * Komutun modülü, yükleyeceği koleksiyonlar ve skaler State alanları core komut tablosundandır
 * (`modules/commands.ts`: `WORKFLOW_COMMANDS`, `ASSESSMENT_COMMANDS`, `OPERATION_COMMANDS`);
 * API kendi kopyasını tutmaz. Core denetim listesi (`audit`) tabloda yoktur; işlem çalıştırıcı
 * onu her zaman boş verir. Eksik koleksiyon sessizce boş görünmez; işlem çalıştırıcı 500 ile durur.
 */

/** Uç seçenekleri: istek anahtarı, `If-Match` sürümü ve velinin seçili çocuğu. */
export interface CommandOptions {
  idempotency: IdempotencyRequest | null
  /** `If-Match`: işlemin konusu olan kaydın okunan sürümü. */
  expectedVersion: number | null
}

interface Environment {
  session: Session
  /** Core yetki aktörü (`requireAuthorized`): oturum rolü ve üyelik bağlantıları. */
  actor: Actor
  institutionType: InstitutionType
  scalars: Partial<Pick<State, ScalarStateKey>>
}

/**
 * Core oturumu ve skaler State alanları: bağlantılar `membership_links`'ten, modüller kurumdan,
 * eğitim yılı `institution_settings`'ten. Ayar satırı yoksa `academicYear` verilmez; onu okuyan
 * işlem (yenileme) 500 ile durur. İşlem çalıştırıcı bunu kurum kilidinden sonra, işlemin
 * transaction'ında (`tx`) çağırır (`OperationRequest.load`).
 */
async function environment(
  tx: Database,
  ctx: ServiceContext,
  spec: CommandSpec,
  childId?: string,
): Promise<Environment> {
  const [links, institution, settings] = await Promise.all([
    listMembershipLinks(tx, ctx.institutionId, ctx.actor.membershipId),
    getInstitutionModules(tx, ctx.institutionId),
    tx
      .select({ academicYear: institutionSettings.academicYear })
      .from(institutionSettings)
      .where(eq(institutionSettings.institutionId, ctx.institutionId))
      .limit(1),
  ])
  const session: Session = { role: ctx.actor.role, links }
  if (childId !== undefined) session.childId = childId
  // Yalnız komutun okuduğu skalerler verilir (core `scalars`); okunmayan alan görünümde yoktur.
  const scalars: Partial<Pick<State, ScalarStateKey>> = {}
  if (spec.scalars.includes('modules')) scalars.modules = institution?.modules ?? {}
  const academicYear = settings[0]?.academicYear
  if (spec.scalars.includes('academicYear') && academicYear !== undefined)
    scalars.academicYear = academicYear
  return {
    session,
    actor: { role: ctx.actor.role, links },
    institutionType: institution?.type ?? 'school',
    scalars,
  }
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
  const id = entry?.record_id
  if (collection === undefined || id === undefined || !isRecordCollection(collection)) return null
  return id === command ? null : { collection, id }
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
  const { command, input, recordId } = workflow
  return execute(
    ctx,
    {
      action: `workflow.${command}`,
      collections: WORKFLOW_COMMANDS[command].collections,
      ...(recordId !== undefined && options.expectedVersion !== null
        ? { expectedRecordVersion: { id: recordId, version: options.expectedVersion } }
        : {}),
      entity: auditEntity(recordId ?? command),
      load: async (tx) => {
        const { session, scalars } = await environment(
          tx,
          ctx,
          WORKFLOW_COMMANDS[command],
          workflow.childId,
        )
        return {
          scalars,
          run: (state, { now, makeId }) => {
            runWorkflow(state, session, command, input, makeId, recordId, now)
            return auditedEntity(state, command)
          },
        }
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
  return execute(
    ctx,
    {
      action: `tutoring.${command}`,
      collections: ASSESSMENT_COMMANDS[command].collections,
      ...(recordId !== undefined && options.expectedVersion !== null
        ? {
            expectedVersions: [
              { collection: 'tutorSessions', id: recordId, version: options.expectedVersion },
            ],
          }
        : {}),
      entity: auditEntity(recordId ?? command),
      load: async (tx) => {
        const { session, scalars } = await environment(tx, ctx, ASSESSMENT_COMMANDS[command])
        return {
          scalars,
          run: (state, { now, makeId }) => {
            runAssessment(state, session, command, input, makeId, recordId ?? '', now)
            return recordId === undefined ? null : { collection: 'tutorSessions', id: recordId }
          },
        }
      },
    },
    options,
  )
}

/**
 * Taksit ödemesi (tahsilat kaydı). Yetki core `invoice.pay`'dir: yalnız yönetici ve ön büro
 * (DOM-FIN-052). Aynı ödeme iki kez işlenmez (core `invoice_already_paid` 409).
 * TODO(payment-provider): velinin çevrim içi ödemesi (`invoice.payOnline`) ödeme sağlayıcısı
 * seçilince ayrı uçla bağlanır; o zamana kadar uç yoktur.
 */
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
      collections: OPERATION_COMMANDS['invoice.pay'].collections,
      ...(options.expectedVersion !== null
        ? {
            expectedVersions: [
              { collection: 'invoices', id: invoiceId, version: options.expectedVersion },
            ],
          }
        : {}),
      entity: { type: 'invoices', id: invoiceId },
      load: async (tx) => {
        const spec = OPERATION_COMMANDS['invoice.pay']
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        return {
          scalars,
          run: (state, { now }) => {
            // Olmayan taksitte hedef boştur: yetki reddi kayıt aramasından önce döner.
            const studentId = state.invoices.find((item) => item.id === invoiceId)?.studentId ?? ''
            requireAuthorized(actor, 'invoice.pay', { studentId }, state, { now, institutionType })
            payInvoice(state, invoiceId, method, now)
            return { collection: 'invoices', id: invoiceId }
          },
        }
      },
    },
    options,
  )
}

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export interface AttendanceInput {
  /** Yoklama günü (`YYYY-MM-DD`). */
  date: string
  marks: Readonly<Record<string, AttendanceStatus>>
  /** Yönetici düzeltmesinin gerekçesi (DOM-AKD-035); öğretmenin aynı gün yoklamasında gerekmez. */
  reason?: string | undefined
}

/**
 * Sınıfın günlük yoklaması (`recordAttendance`): aynı öğrenci ve gün için tek kayıt güncellenir,
 * yinelenmez. Yetki core `attendance.record`'dur: öğretmen ders verdiği sınıfta aynı gün,
 * yönetici yalnız gerekçeyle (DOM-YTK-022, DOM-AKD-035). Gerekçe bugün yalnız yetki kararına
 * girer; denetim kaydına içerik yazılmaz.
 * TODO(core-attendance-history): core düzeltme geçmişini (eski/yeni değer, gerekçe) saklayınca
 * gerekçe işleme de verilir.
 */
export async function recordAttendanceCommand(
  ctx: ServiceContext,
  classId: string,
  input: AttendanceInput,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'attendance.record',
      collections: OPERATION_COMMANDS['attendance.record'].collections,
      // İşlemin konusu sınıftır: `If-Match` sınıf kaydının okunan sürümüyle karşılaştırılır.
      ...(options.expectedVersion !== null
        ? {
            expectedVersions: [
              { collection: 'classes', id: classId, version: options.expectedVersion },
            ],
          }
        : {}),
      entity: { type: 'classes', id: classId },
      load: async (tx) => {
        const spec = OPERATION_COMMANDS['attendance.record']
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        return {
          scalars,
          run: (state, { now }) => {
            // Gün Europe/Istanbul günüdür; 09:00Z o günün öğlesidir (istemcilerle aynı biçim).
            const date = `${input.date}T09:00:00.000Z`
            const reason = input.reason === undefined ? {} : { reason: input.reason }
            requireAuthorized(actor, 'attendance.record', { classId, date, ...reason }, state, {
              now,
              institutionType,
            })
            if (!state.classes.some((item) => item.id === classId)) throw new NotFoundError()
            // Gelecek gün uygulamanın saatine göre denetlenir (`ctx.now`), gerçek saate göre değil.
            recordAttendance(state, classId, date, input.marks, now)
            return { collection: 'classes', id: classId }
          },
        }
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
  const action = verb === 'archive' ? 'record.archive' : 'record.restore'
  return execute(
    ctx,
    {
      action: `${collection}.${verb}`,
      collections: OPERATION_COMMANDS[action].collections,
      ...(options.expectedVersion !== null
        ? { expectedVersions: [{ collection, id: recordId, version: options.expectedVersion }] }
        : {}),
      entity: { type: collection, id: recordId },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(
          tx,
          ctx,
          OPERATION_COMMANDS[action],
        )
        return {
          scalars,
          run: (state, { now }) => {
            // Kampüs, sınıf ve kadro yönetimi yalnız yöneticidedir (core `record.*`, DOM-YTK-020).
            requireAuthorized(actor, action, { kind }, state, { now, institutionType })
            run(state, now)
            return { collection, id: recordId }
          },
        }
      },
    },
    options,
  )
}
