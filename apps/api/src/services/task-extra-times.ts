import {
  canManageExtraTime,
  currentExtraTime,
  extraTimeVersion,
  planExtraTime,
  type ExtraTimeChange,
  type ExtraTimeInput,
  type ExtraTimeRow,
} from '@kampus/school-core/skills/extra-time.ts'

import type { Database } from '../db/client.ts'
import {
  findAssignment,
  insertExtraTime,
  loadAttempts,
  type StoredAssignment,
  type StoredExtraTime,
} from '../db/skills.ts'
import { ForbiddenError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { readSource } from './read-scope.ts'
import { loadLearnerNames } from './task-learner-names.ts'
import { targetedLearners, viewerOf, visible, type Viewer } from './task-assignments.ts'
import { auditWork } from './task-work.ts'

/**
 * Bireysel ek süre uçları (OG-248; docs/domain/beceri-gelisimi.md DOM-BEC-043; yetki-ve-kapsam.md
 * DOM-YTK-028). Kural core `skills/extra-time.ts`'tedir; burada kapsam, sıra ve tek transaction
 * vardır. Ek süre atama × kursiyer düzeyindedir; kayıtlar değişmez, her değişiklik yeni satırdır
 * (`task_extra_times`), sürüm son kaydın sıra numarasıdır.
 *
 * Kim görür: atamayı gören personel (yönetici; atayan öğretmen; atamayı kapsamındaki sınıf ya da
 * öğrenci hedefi yüzünden gören öğretmen). Atayan ve yönetici atamanın bütün hedeflenen
 * kursiyerlerini, atayan olmayan öğretmen yalnız kapsamındaki kursiyerleri görür. Kim yazar: yalnız
 * atayan öğretmen ve yönetici (core `canManageExtraTime`). Öğrenci ve veli bu uçları kullanamaz
 * (rota 403); kursiyer yalnız denemesindeki ek dakikayı ve bitiş anını görür, gerekçeyi görmez.
 *
 * Sıra (api-tasarimi §6): kapsam dışı ya da olmayan atama 404 → atayan olmayan öğretmen 403 →
 * kursiyer atamanın hedefinde değil 404 → sürüm 409 → core kuralı 422.
 *
 * KVKK: gerekçe kategoridir, serbest metin yoktur; kategori ve dakika loglanmaz, denetime yalnız
 * alan adları yazılır (`task_extra_time.grant|change|remove`).
 */

const ENTITY = 'task_extra_time'

const laterOf = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b)

/**
 * Bir kursiyerin ek süre satırı: güncel ek süre, sürüm ve kayıt geçmişi (yeniden eskiye).
 * Gerekçe kategorisi (`reason`, kvkk: Ç) yalnız yazma yetkisi olanlara (atayan öğretmen ve
 * yönetici) döner; yalnız okuyan öğretmen satırı ve dakikayı görür, gerekçe alanı hiç yer almaz.
 */
function learnerRow(
  learnerId: string,
  rows: readonly ExtraTimeRow[],
  names: ReadonlyMap<string, string>,
  withReason: boolean,
) {
  const current = currentExtraTime(rows)
  const entry = (row: ExtraTimeRow) => ({
    sequence: row.sequence,
    minutes: row.minutes,
    ...(withReason ? { reason: row.reason } : {}),
    grantedAt: row.grantedAt,
    grantedByUserId: row.grantedByUserId,
  })
  return {
    learnerId,
    learnerName: names.get(learnerId) ?? null,
    current:
      current === null
        ? null
        : {
            minutes: current.minutes,
            ...(withReason ? { reason: current.reason ?? 'other' } : {}),
            grantedAt: current.grantedAt,
            grantedByUserId: current.grantedByUserId,
          },
    version: extraTimeVersion(rows),
    history: [...rows].sort((a, b) => b.sequence - a.sequence).map(entry),
  }
}

type StaffViewer = Exclude<Viewer, { kind: 'learner' }>

function staffViewer(viewer: Viewer): StaffViewer {
  if (viewer.kind === 'learner') throw new ForbiddenError()
  return viewer
}

/** Atamanın kursiyerleri (güncel hedefler ve ek süre kaydı olanlar), kişinin kapsamıyla. */
async function learnersOf(ctx: ServiceContext, viewer: StaffViewer, assignment: StoredAssignment) {
  const source = await readSource(ctx)
  const classOf = new Map(source.students.map((student) => [student.id, student.classId]))
  const targeted = new Set(targetedLearners(classOf, assignment))
  const all = [
    ...new Set([...targeted, ...assignment.extraTimes.map((extra) => extra.learnerId)]),
  ].sort()
  const manages = canManageExtraTime(ctx.actor, assignment)
  const shown = all.filter(
    (id) => manages || (viewer.kind === 'teacher' && viewer.studentIds.has(id)),
  )
  return { targeted, shown }
}

function rowsOf(assignment: StoredAssignment, learnerId: string): StoredExtraTime[] {
  return assignment.extraTimes.filter((extra) => extra.learnerId === learnerId)
}

/** Görünür atama; değilse 404 (olmayan, başka kurumun, arşivli ya da kapsam dışı). */
async function visibleAssignment(
  db: Database,
  ctx: ServiceContext,
  viewer: StaffViewer,
  assignmentId: string,
): Promise<StoredAssignment> {
  const assignment = await findAssignment(db, ctx.institutionId, assignmentId)
  if (!assignment || assignment.archivedAt !== null || !visible(viewer, assignment))
    throw new NotFoundError()
  return assignment
}

/**
 * Atamanın kursiyer başına ek süresi ve kayıt geçmişi (DOM-BEC-043). Süresiz atamada kursiyerler
 * ek süresiz döner (`timeLimitMinutes: null`, `canManage` yine yetkiyi söyler).
 */
export async function listTaskExtraTimes(ctx: ServiceContext, assignmentId: string) {
  const viewer = staffViewer(await viewerOf(ctx))
  const assignment = await visibleAssignment(ctx.db, ctx, viewer, assignmentId)
  const { shown } = await learnersOf(ctx, viewer, assignment)
  const names = await loadLearnerNames(ctx, viewer, shown)
  const canManage = canManageExtraTime(ctx.actor, assignment)
  return {
    assignmentId: assignment.id,
    timeLimitMinutes: assignment.timeLimitMinutes,
    canManage,
    learners: shown.map((id) => learnerRow(id, rowsOf(assignment, id), names, canManage)),
  }
}

export type ExtraTimeCommand =
  | { kind: 'grant'; assignmentId: string; learnerId: string; input: ExtraTimeInput }
  | {
      kind: 'change'
      assignmentId: string
      learnerId: string
      input: ExtraTimeInput
      expectedVersion: number
    }
  | { kind: 'remove'; assignmentId: string; learnerId: string; expectedVersion: number }

const ACTIONS = {
  grant: 'task_extra_time.grant',
  change: 'task_extra_time.change',
  remove: 'task_extra_time.remove',
} as const

function changeOf(command: ExtraTimeCommand): ExtraTimeChange {
  switch (command.kind) {
    case 'grant':
      return { kind: 'grant', input: command.input }
    case 'change':
      return { kind: 'change', input: command.input, expectedVersion: command.expectedVersion }
    case 'remove':
      return { kind: 'remove', expectedVersion: command.expectedVersion }
    default:
      return command satisfies never
  }
}

/**
 * Ek süre verme, değiştirme ya da kaldırma (core `planExtraTime`). Tek transaction'da kurum kilidi
 * altında yeni kayıt ve denetim satırı yazılır; hata hiçbir şey yazmaz. Yanıt kursiyerin güncel
 * ek süre satırıdır. Verme 201, değiştirme ve kaldırma 200. Kayıt saati kilitten sonra `clock`tan
 * okunur ve son kaydın saatinin gerisine inmez (core `planExtraTime`): kilit kuyruğunda bekleyen
 * istek bitmiş bir denemeyi eski saatle yeniden açamaz.
 */
export async function writeTaskExtraTime(
  ctx: ServiceContext,
  command: ExtraTimeCommand,
  idempotency: IdempotencyRequest | null,
  clock: () => Date = () => ctx.now,
): Promise<CommandResponse> {
  const viewer = staffViewer(await viewerOf(ctx))
  const out: { body?: unknown } = {}
  type Write = { assignment: StoredAssignment; plan: ReturnType<typeof planExtraTime> }
  return runCommand<Write>(
    ctx,
    {
      action: ACTIONS[command.kind],
      collections: [],
      entity: { type: ENTITY, id: command.assignmentId },
      load: async (tx) => {
        const assignment = await visibleAssignment(tx, ctx, viewer, command.assignmentId)
        // Atayan olmayan öğretmen ek süreyi okur, yazamaz (403; kapsamdan sonra).
        if (!canManageExtraTime(ctx.actor, assignment)) throw new ForbiddenError()
        const [{ targeted }, attempts, modules] = await Promise.all([
          learnersOf({ ...ctx, db: tx }, viewer, assignment),
          loadAttempts(tx, ctx.institutionId, assignment.id, command.learnerId),
          getInstitutionModules(tx, ctx.institutionId),
        ])
        return {
          // Kayıt saati kurum kilidi alındıktan sonra okunur: kilit kuyruğunda bekleyen isteğin
          // `ctx.now`'ı eskimiş olabilir. Core ayrıca son kaydın saatinin gerisine inmez.
          run: () => ({
            assignment,
            plan: planExtraTime({
              actor: ctx.actor,
              modules: modules?.modules ?? {},
              assignment,
              learnerTargeted: targeted.has(command.learnerId),
              rows: rowsOf(assignment, command.learnerId),
              attempts,
              change: changeOf(command),
              now: laterOf(ctx.now, clock()),
            }),
          }),
        }
      },
      after: async (tx, { assignment, plan }) => {
        await insertExtraTime(
          tx,
          ctx.institutionId,
          {
            assignmentId: assignment.id,
            learnerId: command.learnerId,
            grantedByUserId: ctx.actor.userId,
            ...plan,
          },
          ctx.now,
        )
        await auditWork(
          tx,
          ctx,
          ACTIONS[command.kind],
          { type: ENTITY, id: assignment.id },
          command.kind === 'remove' ? ['minutes'] : ['learnerId', 'minutes', 'reason'],
        )
        const rows: ExtraTimeRow[] = [
          ...rowsOf(assignment, command.learnerId),
          { ...plan, grantedByUserId: ctx.actor.userId },
        ]
        const names = await loadLearnerNames({ ...ctx, db: tx }, viewer, [command.learnerId])
        // Yazma yetkisi load'da doğrulandı: yazan her zaman gerekçeyi görür.
        out.body = { data: learnerRow(command.learnerId, rows, names, true) }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('task extra time was not written')
      return { statusCode: command.kind === 'grant' ? 201 : 200, body: out.body }
    },
    idempotency,
  )
}
