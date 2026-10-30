import type { State } from '@kampus/school-core/data/seed.ts'
import type { Participant } from '@kampus/school-core/lib/communication.ts'
import {
  notifyAbsence,
  notifyAbsenceSchema,
  openRequest,
  updateRequest,
} from '@kampus/school-core/lib/requests.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { CollectionName } from '../db/collections.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { commandBody } from './command-result.ts'
import { environment, type CommandOptions } from './commands.ts'
import {
  runCommand,
  type CommandResponse,
  type LoadScope,
  type OperationTools,
} from './operation-runner.ts'

/**
 * Veli talebi ve izin/mazeret bildirimi servisi (docs/domain/iletisim-ve-veli.md DOM-ILT-053,
 * DOM-ILT-080). Kurallar, rol ve kapsam core'dadır (`lib/requests.ts`, `requireAuthorized`);
 * burada yalnız gereken kayıtların yüklenmesi ve işlemin tek transaction'da çalıştırılması vardır.
 *
 * Kurumun bütün talepleri ve bildirimleri kurum kilidi altında yüklenmez (`loadScope`): talep
 * açılırken hiçbir talep, güncellenirken yalnız hedef talep, bildirimde yalnız aynı öğrencinin
 * bildirimleri (örtüşme denetimi) yüklenir. Talep ve mazeret metni loglanmaz; denetim kaydına
 * yalnız değişen alan adları yazılır (işlem çalıştırıcı).
 */

type RequestAction = 'request.open' | 'request.update' | 'absence.notify'
type Entity = { collection: CollectionName; id: string }
type Outcome = { entity: Entity; statusCode: number }

interface RequestRun {
  action: RequestAction
  /** İşlemin konusu; `If-Match` bu kaydın sürümüyle karşılaştırılır. */
  subject: Entity | null
  loadScope: Partial<Record<CollectionName, LoadScope>>
  run: (
    state: State,
    by: Participant,
    tools: OperationTools,
    options: { institutionType: InstitutionType },
  ) => Outcome
}

function execute(
  ctx: ServiceContext,
  command: RequestRun,
  options: CommandOptions,
): Promise<CommandResponse> {
  const spec = OPERATION_COMMANDS[command.action]
  return runCommand(
    ctx,
    {
      action: command.action,
      collections: spec.collections,
      loadScope: command.loadScope,
      ...(command.subject && options.expectedVersion !== null
        ? { expectedVersions: [{ ...command.subject, version: options.expectedVersion }] }
        : {}),
      entity: (outcome: Outcome) => ({ type: outcome.entity.collection, id: outcome.entity.id }),
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        const by: Participant = { ...actor, userId: ctx.actor.userId }
        return {
          scalars,
          run: (state, tools) => command.run(state, by, tools, { institutionType }),
        }
      },
    },
    (outcome) => commandBody(outcome.result.entity, outcome.changes, outcome.result.statusCode),
    options.idempotency,
  )
}

const requestEntity = (id: string): Entity => ({ collection: 'requests', id })
const NONE: LoadScope = { ids: [] }

/** Veli bağlı çocuğu için talep açar (DOM-ILT-080, DOM-YTK-025). 201. */
export function openRequestCommand(
  ctx: ServiceContext,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'request.open',
      subject: null,
      loadScope: { requests: NONE },
      run: (state, by, { now, makeId }, { institutionType }) => {
        const created = openRequest(state, by, input, makeId, now, { institutionType })
        return { entity: requestEntity(created.id), statusCode: 201 }
      },
    },
    options,
  )
}

/** Ön büro/yönetici talebin durumunu, birimini değiştirir, yanıt ekler (DOM-ILT-080). */
export function updateRequestCommand(
  ctx: ServiceContext,
  requestId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'request.update',
      subject: requestEntity(requestId),
      loadScope: { requests: { ids: [requestId] } },
      run: (state, by, { now, makeId }, { institutionType }) => {
        updateRequest(state, by, requestId, input, makeId, now, { institutionType })
        return { entity: requestEntity(requestId), statusCode: 200 }
      },
    },
    options,
  )
}

/**
 * Veli izin/mazeret bildirir (DOM-ILT-053). Örtüşme yalnız aynı öğrencinin bildirimlerine
 * bakar; geçersiz gövde core'da 400 olur, o durumda hiçbir bildirim yüklenmez. 201.
 */
export function notifyAbsenceCommand(
  ctx: ServiceContext,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const parsed = notifyAbsenceSchema.safeParse(input)
  return execute(
    ctx,
    {
      action: 'absence.notify',
      subject: null,
      loadScope: {
        absences: parsed.success
          ? { match: [{ field: 'studentId', values: [parsed.data.studentId] }] }
          : NONE,
      },
      run: (state, by, { now, makeId }, { institutionType }) => {
        const notice = notifyAbsence(state, by, input, makeId, now, { institutionType })
        return { entity: { collection: 'absences', id: notice.id }, statusCode: 201 }
      },
    },
    options,
  )
}
