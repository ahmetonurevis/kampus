import type { State } from '@kampus/school-core/data/seed.ts'
import type { Participant } from '@kampus/school-core/lib/communication.ts'
import {
  ABSENCE_DOCUMENT_PURPOSE,
  approveAbsence,
  attachAbsenceDocuments,
  attachAbsenceDocumentsSchema,
  notifyAbsence,
  notifyAbsenceSchema,
  openRequest,
  rejectAbsence,
  rejectAbsenceSchema,
  updateRequest,
  type AbsenceFile,
} from '@kampus/school-core/lib/requests.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import type { CollectionName } from '../db/collections.ts'
import { findRecord } from '../db/records.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { commandBody } from './command-result.ts'
import { environment, type CommandOptions } from './commands.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile } from './files.ts'
import { notify } from './notify.ts'
import {
  runCommand,
  type CommandResponse,
  type LoadScope,
  type OperationTools,
} from './operation-runner.ts'
import { readScope } from './read-scope.ts'
import { usableFiles } from './task-submission-files.ts'

/**
 * Veli talebi ve izin/mazeret bildirimi servisi (docs/domain/iletisim-ve-veli.md DOM-ILT-053,
 * DOM-ILT-080). Kurallar, rol ve kapsam core'dadır (`lib/requests.ts`, `requireAuthorized`);
 * burada yalnız gereken kayıtların yüklenmesi ve işlemin tek transaction'da çalıştırılması vardır.
 *
 * Kurumun bütün talepleri ve bildirimleri kurum kilidi altında yüklenmez (`loadScope`): talep
 * açılırken hiçbir talep, güncellenirken yalnız hedef talep, bildirimde yalnız aynı öğrencinin
 * bildirimleri (örtüşme denetimi), belge eklemede, onayda ve redde yalnız hedef bildirim
 * yüklenir. Talep ve mazeret metni loglanmaz; denetim kaydına yalnız değişen alan adları yazılır
 * (işlem çalıştırıcı). Red gerekçesi kayda yazılmaz, denetim satırının `reason`'ına girer.
 *
 * Özür belgeleri (IST-072; ADR 0003 karar 5, 6) bildirimin yazıldığı transaction'da bildirime
 * bağlanır (`attached_type = 'absence'`): bağlanamayan belge bildirimi de geri alır. Bağlı belge
 * bildirimi okuyabilene açılır (yönetici, sınıf rehber öğretmeni, veli, öğrenci; core `absences`
 * kapsamı); her bağlantı denetim kaydına `file.access` olarak yazılır (sağlık verisi olabilir).
 * Karar (onay/red) veliye ve yetişkin kursiyere `absence_decided` bildirimiyle aynı
 * transaction'da bildirilir; sonuç ve gerekçe bildirimde yoktur (DOM-ILT-023).
 */

type RequestAction =
  | 'request.open'
  | 'request.update'
  | 'absence.notify'
  | 'absence.attach'
  | 'absence.approve'
  | 'absence.reject'
type Entity = { collection: CollectionName; id: string }
type Outcome = {
  entity: Entity
  statusCode: number
  /** Bildirime bu işlemde bağlanacak belgeler ve veri sahibi öğrenci. */
  attach?: { fileIds: readonly string[]; studentId: string }
  /** Kararı bildirilecek öğrenci (onay ve red). */
  decided?: { studentId: string }
}

/** Bildirime bağlanan dosyaların kayıt türü (ADR 0003 karar 5). */
export const ABSENCE_ATTACHMENT = 'absence'

interface RequestRun {
  action: RequestAction
  /** İşlemin konusu; `If-Match` bu kaydın sürümüyle karşılaştırılır. */
  subject: Entity | null
  loadScope: Partial<Record<CollectionName, LoadScope>>
  /** Kurum kilidinden sonra, aynı transaction'da okunan ek girdi (özür belgeleri). */
  prepare?: (tx: Database) => Promise<readonly AbsenceFile[]>
  /** Denetim satırının gerekçesi (`audit_log.reason`); loglanmaz. */
  auditReason?: string
  run: (
    state: State,
    by: Participant,
    tools: OperationTools,
    options: { institutionType: InstitutionType; files: readonly AbsenceFile[] },
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
      ...(command.auditReason === undefined ? {} : { auditReason: command.auditReason }),
      entity: (outcome: Outcome) => ({ type: outcome.entity.collection, id: outcome.entity.id }),
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        const by: Participant = { ...actor, userId: ctx.actor.userId }
        const files = (await command.prepare?.(tx)) ?? []
        return {
          scalars,
          run: (state, tools) => command.run(state, by, tools, { institutionType, files }),
        }
      },
      // Belge bağlama ve karar bildirimi işlemle aynı transaction'dadır: bağlanamayan belge
      // (başkasının, hazır olmayan, başka kayda bağlı) bildirimi de geri alır (422/409).
      // TODO(F3c2-retention): özür belgesinin saklama süresi kullanıcı kararı bekliyor (KVKK
      // md. 4, md. 7); karar gelene dek `retentionUntil` verilmez, dosya süresiz kalır.
      after: async (tx, outcome) => {
        if (outcome.attach)
          for (const fileId of outcome.attach.fileIds)
            await attachFile(tx, ctx, {
              fileId,
              attachedType: ABSENCE_ATTACHMENT,
              attachedId: outcome.entity.id,
              dataSubjectId: outcome.attach.studentId,
            })
        if (outcome.decided)
          await notify(tx, ctx, {
            type: 'absence_decided',
            recipients: { studentIds: [outcome.decided.studentId] },
            data: { absenceId: outcome.entity.id },
            dedupeKey: outcome.entity.id,
          })
      },
    },
    (outcome) => commandBody(outcome.result.entity, outcome.changes, outcome.result.statusCode),
    options.idempotency,
  )
}

const requestEntity = (id: string): Entity => ({ collection: 'requests', id })
const absenceEntity = (id: string): Entity => ({ collection: 'absences', id })
const NONE: LoadScope = { ids: [] }

/**
 * Gövdedeki belge kimliklerinden velinin kendi yüklediği, silinmemiş ve reddedilmemiş dosyalar
 * (core `AbsenceFile`). Başkasının ve başka kurumun dosyası listede yoktur; core bunu 422
 * `absence_document_unavailable` ile reddeder (varlık sızmaz).
 */
async function absenceFiles(
  tx: Database,
  ctx: ServiceContext,
  fileIds: readonly string[],
): Promise<AbsenceFile[]> {
  return fileIds.length === 0 ? [] : usableFiles(tx, ctx, fileIds)
}

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
 * bakar; geçersiz gövde core'da 400 olur, o durumda hiçbir bildirim yüklenmez. Özür belgeleri
 * (`fileIds`) aynı transaction'da bildirime bağlanır: hazır olmayan 422 `file_not_ready`, başka
 * kayda bağlı 409 `file_already_attached`; hiçbir kayıt değişmez. 201.
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
      prepare: (tx) => absenceFiles(tx, ctx, parsed.success ? (parsed.data.fileIds ?? []) : []),
      run: (state, by, { now, makeId }, { institutionType, files }) => {
        const notice = notifyAbsence(state, by, input, makeId, now, { institutionType, files })
        return {
          entity: absenceEntity(notice.id),
          statusCode: 201,
          attach: { fileIds: notice.fileIds ?? [], studentId: notice.studentId },
        }
      },
    },
    options,
  )
}

/**
 * Veli bildirimine sonradan özür belgesi ekler (DOM-ILT-053): karar verilmeden ve belge süresi
 * içinde, toplam en çok 3. Belgeler aynı transaction'da bağlanır. 200.
 */
export function attachAbsenceDocumentsCommand(
  ctx: ServiceContext,
  absenceId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const parsed = attachAbsenceDocumentsSchema.safeParse(input)
  return execute(
    ctx,
    {
      action: 'absence.attach',
      subject: absenceEntity(absenceId),
      loadScope: { absences: { ids: [absenceId] } },
      prepare: (tx) => absenceFiles(tx, ctx, parsed.success ? parsed.data.fileIds : []),
      run: (state, by, { now }, { institutionType, files }) => {
        const notice = attachAbsenceDocuments(state, by, absenceId, input, now, {
          institutionType,
          files,
        })
        return {
          entity: absenceEntity(absenceId),
          statusCode: 200,
          attach: {
            fileIds: parsed.success ? parsed.data.fileIds : [],
            studentId: notice.studentId,
          },
        }
      },
    },
    options,
  )
}

/** Yönetici bildirimi onaylar (DOM-ILT-053); günler yoklamada özürlü sayılır. 200. */
export function approveAbsenceCommand(
  ctx: ServiceContext,
  absenceId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'absence.approve',
      subject: absenceEntity(absenceId),
      loadScope: { absences: { ids: [absenceId] } },
      run: (state, by, { now }, { institutionType }) => {
        const notice = approveAbsence(state, by, absenceId, input, now, { institutionType })
        return {
          entity: absenceEntity(absenceId),
          statusCode: 200,
          decided: { studentId: notice.studentId },
        }
      },
    },
    options,
  )
}

/**
 * Yönetici bildirimi gerekçeyle reddeder (DOM-ILT-053); günler özürsüz kalır. Gerekçe yalnız
 * denetim satırına (`audit_log.reason`) yazılır. 200.
 */
export function rejectAbsenceCommand(
  ctx: ServiceContext,
  absenceId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const parsed = rejectAbsenceSchema.safeParse(input)
  return execute(
    ctx,
    {
      action: 'absence.reject',
      subject: absenceEntity(absenceId),
      loadScope: { absences: { ids: [absenceId] } },
      ...(parsed.success ? { auditReason: parsed.data.reason } : {}),
      run: (state, by, { now }, { institutionType }) => {
        const notice = rejectAbsence(state, by, absenceId, input, now, { institutionType })
        return {
          entity: absenceEntity(absenceId),
          statusCode: 200,
          decided: { studentId: notice.studentId },
        }
      },
    },
    options,
  )
}

/**
 * Bildirime bağlı özür belgesi, bildirimi okuyabilene açılır (ADR 0003 karar 6; DOM-ILT-053):
 * kural core `absences` kapsamındadır; ön büro, branş öğretmeni ve başka veli okuyamaz. PGlite
 * tek bağlantılıdır: kapsam işlemin bağlantısıyla (`tx`) okunur.
 */
defineFileAttachment(ABSENCE_ATTACHMENT, {
  purposes: [ABSENCE_DOCUMENT_PURPOSE],
  canRead: async (tx, ctx, absenceId) => {
    const scope = await readScope({ ...ctx, db: tx })
    if (!scope.access('absences').allowed) return false
    const row = await findRecord(tx, ctx.institutionId, 'absences', absenceId)
    return row !== null && scope.canRead('absences', row.data)
  },
})
