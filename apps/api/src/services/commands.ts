import { eq } from 'drizzle-orm'
import type { z } from 'zod'

import type { State } from '@kampus/school-core/data/seed.ts'
import { runAssessment } from '@kampus/school-core/lib/assessment-automation.ts'
import { requireAuthorized, type WriteAction } from '@kampus/school-core/lib/authorize.ts'
import {
  recordAttendance,
  type attendanceInputSchema,
  type MakeId,
  type Session,
} from '@kampus/school-core/lib/domain.ts'
import {
  archiveRecord,
  createClass,
  restoreRecord,
  saveBranch,
  saveTeacher,
  updateBranch,
  updateClass,
  updateTeacher,
  type ArchiveKind,
} from '@kampus/school-core/lib/school-management.ts'
import { assertRenewalWithinTariff } from '@kampus/school-core/lib/enrollment.ts'
import { recordGrade, updateGrade } from '@kampus/school-core/lib/grades.ts'
import {
  runWorkflow,
  workflowSchemas,
  type WorkflowCommand,
} from '@kampus/school-core/lib/school-workflows.ts'
import type { Actor } from '@kampus/school-core/lib/scope.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import {
  ASSESSMENT_COMMANDS,
  OPERATION_COMMANDS,
  WORKFLOW_COMMANDS,
  type CommandSpec,
} from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import { findPublishedTariff } from '../db/fee-tariffs.ts'
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
 * `payInvoice`, `recordAttendance`, `archiveRecord`, `restoreRecord`, kampüs/öğretmen/sınıf
 * kaydı) işlem çalıştırıcıyla
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

export interface Environment {
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
 * transaction'ında (`tx`) çağırır (`OperationRequest.load`). İletişim komutları da kullanır
 * (`services/communication.ts`).
 */
export async function environment(
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
  const session: Session = { role: ctx.actor.role, links, userId: ctx.actor.userId }
  if (childId !== undefined) session.childId = childId
  // Yalnız komutun okuduğu skalerler verilir (core `scalars`); okunmayan alan görünümde yoktur.
  const scalars: Partial<Pick<State, ScalarStateKey>> = {}
  if (spec.scalars.includes('modules')) scalars.modules = institution?.modules ?? {}
  const academicYear = settings[0]?.academicYear
  if (spec.scalars.includes('academicYear') && academicYear !== undefined)
    scalars.academicYear = academicYear
  return {
    session,
    actor: { role: ctx.actor.role, links, userId: ctx.actor.userId },
    institutionType: institution?.type ?? 'school',
    scalars,
  }
}

export type Entity = { collection: CollectionName; id: string } | null

export function execute(
  ctx: ServiceContext,
  request: OperationRequest<Entity>,
  options: CommandOptions,
  statusCode = 200,
): Promise<CommandResponse> {
  return runCommand(
    ctx,
    request,
    (outcome) => commandBody(outcome.result, outcome.changes, statusCode),
    options.idempotency,
  )
}

export function auditEntity(fallback: string) {
  return (entity: Entity) =>
    entity ? { type: entity.collection, id: entity.id } : { type: 'workflow', id: fallback }
}

/** Core denetim girdisinden işlemin konusu (yalnız işlem içinde yaşar, yazılmaz). */
export function auditedEntity(state: State, command: string): Entity {
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

/** Yenilemenin hedef yılı; biçim hatasını iş akışının kendi doğrulaması raporlar. */
function renewalYear(input: unknown): number | null {
  const parsed = workflowSchemas.renewal.safeParse(input)
  return parsed.success ? parsed.data.year : null
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
        const { session, scalars, institutionType } = await environment(
          tx,
          ctx,
          WORKFLOW_COMMANDS[command],
          workflow.childId,
        )
        const year = command === 'renewal' ? renewalYear(input) : null
        const tariff = year === null ? null : await findPublishedTariff(tx, ctx.institutionId, year)
        return {
          scalars,
          run: (state, { now, makeId }) => {
            if (command === 'renewal')
              assertRenewalWithinTariff(state, input, tariff, institutionType)
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
 * Sınıfın günlük yoklaması (`recordAttendance`): aynı öğrenci ve gün için tek kayıt güncellenir,
 * yinelenmez. Yetki core `attendance.record`'dur: öğretmen ders verdiği sınıfta aynı gün,
 * yönetici yalnız gerekçeyle (DOM-YTK-022, DOM-AKD-035). Durumu değişen öğrencinin eski durumu,
 * gerekçe, düzelten kullanıcı ve zaman kaydın `corrections` geçmişine yazılır; denetim kaydına
 * içerik değil alan adı düşer. Girdi rotada core `attendanceInputSchema` ile çözümlenmiştir.
 */
export async function recordAttendanceCommand(
  ctx: ServiceContext,
  classId: string,
  input: z.output<typeof attendanceInputSchema>,
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
            recordAttendance(state, classId, date, input.marks, now, {
              reason: input.reason,
              by: ctx.actor.userId,
            })
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

const SAVE_ACTION = {
  branch: 'branch.save',
  teacher: 'teacher.save',
  class: 'class.save',
} as const satisfies Record<ArchiveKind, WriteAction>

/** Core kaydetme işlemi: `recordId` yoksa oluşturur, varsa kısmi gövdeyle düzenler. */
function saveRecord(
  state: State,
  kind: ArchiveKind,
  recordId: string | null,
  input: unknown,
  makeId: MakeId,
  now: string,
): string {
  switch (kind) {
    case 'branch':
      return recordId === null
        ? saveBranch(state, input, makeId)
        : updateBranch(state, recordId, input, makeId)
    case 'teacher':
      return recordId === null
        ? saveTeacher(state, input, makeId, null, now)
        : updateTeacher(state, recordId, input, makeId, now)
    case 'class':
      return recordId === null
        ? createClass(state, input, makeId, now)
        : updateClass(state, recordId, input, makeId, now)
    default:
      return kind satisfies never
  }
}

/**
 * Kampüs/öğretmen/sınıf kaydı (core `saveBranch`, `saveTeacher`, `createClass`; düzenlemede
 * `updateBranch`, `updateTeacher`, `updateClass`). Yetki core `branch.save`/`teacher.save`/
 * `class.save`: yalnız yönetici (DOM-YTK-001). Kontenjan, branş, derslik ve program çakışması
 * kuralları core'dadır. Oluşturma 201 döner; düzenlemede `If-Match` kaydın okunan sürümüdür
 * (rota zorunlu tutar). Öğretmen kaydı hesap açmaz: hesap ve `membership_links` kurum üyeleri
 * ucunun işidir.
 */
export async function saveRecordCommand(
  ctx: ServiceContext,
  kind: ArchiveKind,
  recordId: string | null,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const collection = ARCHIVE_TARGET[kind]
  const action = SAVE_ACTION[kind]
  const spec = OPERATION_COMMANDS[action]
  return execute(
    ctx,
    {
      action: `${collection}.${recordId === null ? 'create' : 'update'}`,
      collections: spec.collections,
      ...(recordId !== null && options.expectedVersion !== null
        ? { expectedVersions: [{ collection, id: recordId, version: options.expectedVersion }] }
        : {}),
      // Yeni kaydın kimliği işlem çalışınca belli olur.
      entity: recordId === null ? auditEntity(collection) : { type: collection, id: recordId },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        return {
          scalars,
          run: (state, { now, makeId }): Entity => {
            requireAuthorized(actor, action, {}, state, { now, institutionType })
            return { collection, id: saveRecord(state, kind, recordId, input, makeId, now) }
          },
        }
      },
    },
    options,
    recordId === null ? 201 : 200,
  )
}

/**
 * Resmî not girişi (core `recordGrade`, DOM-AKD-004). Yetki core'dadır (`grade.record`): yalnız
 * öğrencinin sınıfında o dersin atanmış öğretmeni (DOM-AKD-054); dil okulunda resmî not yoktur
 * (422 `official_grades_school_only`). Aynı gün aynı türde ikinci not 409 `grade_duplicate`;
 * ağ tekrarına karşı `Idempotency-Key` zorunludur. Başarı 201.
 */
export async function recordGradeCommand(
  ctx: ServiceContext,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const spec = OPERATION_COMMANDS['grade.record']
  return execute(
    ctx,
    {
      action: 'grade.record',
      collections: spec.collections,
      // Yeni notun kimliği işlem çalışınca belli olur.
      entity: auditEntity('grades'),
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        return {
          scalars,
          run: (state, { now, makeId }) => {
            const grade = recordGrade(state, actor, input, makeId, now, { institutionType })
            return { collection: 'grades', id: grade.id }
          },
        }
      },
    },
    options,
    201,
  )
}

/**
 * Not puanını gerekçeyle düzeltir (core `updateGrade`, DOM-AKD-051): eski puan düzeltme
 * geçmişinde kalır. Yetki core'dadır (`grade.update`): atanmış ders öğretmeni veya gerekçeyle
 * yönetici; aktörün göremediği not 404. `If-Match` notun okunan sürümüdür.
 */
export async function updateGradeCommand(
  ctx: ServiceContext,
  gradeId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const spec = OPERATION_COMMANDS['grade.update']
  return execute(
    ctx,
    {
      action: 'grade.update',
      collections: spec.collections,
      ...(options.expectedVersion !== null
        ? {
            expectedVersions: [
              { collection: 'grades', id: gradeId, version: options.expectedVersion },
            ],
          }
        : {}),
      entity: { type: 'grades', id: gradeId },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        return {
          scalars,
          run: (state, { now }) => {
            updateGrade(state, actor, gradeId, input, now, { institutionType })
            return { collection: 'grades', id: gradeId }
          },
        }
      },
    },
    options,
  )
}
