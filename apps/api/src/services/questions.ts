import type { State } from '@kampus/school-core/data/seed.ts'
import type { Participant } from '@kampus/school-core/lib/communication.ts'
import {
  answerQuestion,
  askQuestion,
  askQuestionSchema,
  QUESTION_PHOTO_PURPOSE,
  withdrawQuestion,
  type QuestionFile,
} from '@kampus/school-core/lib/questions.ts'
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
import {
  runCommand,
  type CommandResponse,
  type LoadScope,
  type OperationTools,
} from './operation-runner.ts'
import { readScope } from './read-scope.ts'
import { usableFiles } from './task-submission-files.ts'

/**
 * Öğretmenime Sor servisi (docs/domain/iletisim-ve-veli.md DOM-ILT-090…093). Kurallar, rol ve
 * kapsam core'dadır (`lib/questions.ts`, `requireAuthorized`); burada yalnız gereken kayıtların
 * yüklenmesi ve işlemin tek transaction'da çalıştırılması vardır.
 *
 * Kurumun bütün soruları kurum kilidi altında yüklenmez (`loadScope`): soru açılırken hiçbir soru,
 * yanıt ve geri çekmede yalnız hedef soru yüklenir. Soru ve yanıt metni loglanmaz; denetim kaydına
 * yalnız değişen alan adları yazılır (işlem çalıştırıcı).
 *
 * Soru fotoğrafları (DOM-ILT-094; ADR 0003 karar 5, 6) sorunun yazıldığı transaction'da soruya
 * bağlanır (`attached_type = 'question'`). Bağlı fotoğraf soruyu okuyabilene açılır: öğrenci
 * kendisi, veli bağlı çocuğu, öğretmen kendisine atanan soru, yönetici tümü (core `questions`
 * kapsamı); başkasına 404. Dosya adı ve içerik loglanmaz, kayda yalnız kimlikler girer.
 */

type QuestionAction = 'question.ask' | 'question.answer' | 'question.withdraw'
type Outcome = {
  id: string
  statusCode: number
  /** Soruya bu işlemde bağlanacak fotoğraflar ve veri sahibi öğrenci. */
  attach?: { fileIds: readonly string[]; studentId: string }
}

/** Soruya bağlanan dosyaların kayıt türü (ADR 0003 karar 5). */
export const QUESTION_ATTACHMENT = 'question'

interface QuestionRun {
  action: QuestionAction
  /** İşlemin konusu olan soru; `If-Match` bu kaydın sürümüyle karşılaştırılır. */
  subjectId: string | null
  /** Kurum kilidinden sonra, aynı transaction'da okunan ek girdi (soru fotoğrafları). */
  prepare?: (tx: Database) => Promise<readonly QuestionFile[]>
  run: (
    state: State,
    by: Participant,
    tools: OperationTools,
    options: { institutionType: InstitutionType; files: readonly QuestionFile[] },
  ) => Outcome
}

const COLLECTION: CollectionName = 'questions'
const NONE: LoadScope = { ids: [] }

function execute(
  ctx: ServiceContext,
  command: QuestionRun,
  options: CommandOptions,
): Promise<CommandResponse> {
  const spec = OPERATION_COMMANDS[command.action]
  return runCommand(
    ctx,
    {
      action: command.action,
      collections: spec.collections,
      loadScope: { questions: command.subjectId === null ? NONE : { ids: [command.subjectId] } },
      ...(command.subjectId !== null && options.expectedVersion !== null
        ? {
            expectedVersions: [
              { collection: COLLECTION, id: command.subjectId, version: options.expectedVersion },
            ],
          }
        : {}),
      entity: (outcome: Outcome) => ({ type: COLLECTION, id: outcome.id }),
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        const by: Participant = { ...actor, userId: ctx.actor.userId }
        const files = (await command.prepare?.(tx)) ?? []
        return {
          scalars,
          run: (state, tools) => command.run(state, by, tools, { institutionType, files }),
        }
      },
      // Dosya bağlama işlemle aynı transaction'dadır: bağlanamayan fotoğraf (başkasının, hazır
      // olmayan, başka kayda bağlı) soruyu da geri alır (422/409, hiçbir kayıt değişmez).
      // TODO(F3c2-retention): öğrenci soru fotoğrafının saklama süresi kullanıcı kararı bekliyor
      // (KVKK md. 4); karar gelene dek `retentionUntil` verilmez, dosya süresiz kalır.
      after: async (tx, outcome) => {
        if (!outcome.attach) return
        for (const fileId of outcome.attach.fileIds)
          await attachFile(tx, ctx, {
            fileId,
            attachedType: QUESTION_ATTACHMENT,
            attachedId: outcome.id,
            dataSubjectId: outcome.attach.studentId,
          })
      },
    },
    (outcome) =>
      commandBody(
        { collection: COLLECTION, id: outcome.result.id },
        outcome.changes,
        outcome.result.statusCode,
      ),
    options.idempotency,
  )
}

/**
 * Gövdedeki fotoğraf kimliklerinden öğrencinin kendi yüklediği, silinmemiş ve reddedilmemiş
 * dosyalar (core `QuestionFile`). Başkasının ve başka kurumun dosyası listede yoktur; core bunu
 * 422 `question_photo_unavailable` ile reddeder (varlık sızmaz). Geçersiz gövde Zod'da kalır.
 */
async function questionFiles(
  tx: Database,
  ctx: ServiceContext,
  input: unknown,
): Promise<QuestionFile[]> {
  const parsed = askQuestionSchema.safeParse(input)
  const fileIds = parsed.success ? (parsed.data.fileIds ?? []) : []
  if (fileIds.length === 0) return []
  return usableFiles(tx, ctx, fileIds)
}

/**
 * Öğrenci kendi sınıfının ders öğretmenine soru gönderir (DOM-ILT-090). 201. Fotoğraflar
 * (DOM-ILT-094) aynı transaction'da soruya bağlanır: hazır olmayan 422 `file_not_ready`, başka
 * kayda bağlı 409 `file_already_attached`; hiçbir kayıt değişmez.
 */
export function askQuestionCommand(
  ctx: ServiceContext,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'question.ask',
      subjectId: null,
      prepare: (tx) => questionFiles(tx, ctx, input),
      run: (state, by, { now, makeId }, { institutionType, files }) => {
        const created = askQuestion(state, by, input, makeId, now, { institutionType, files })
        return {
          id: created.id,
          statusCode: 201,
          attach: { fileIds: created.fileIds ?? [], studentId: created.studentId },
        }
      },
    },
    options,
  )
}

/** Atanmış öğretmen yanıt veya ek yanıt yazar (DOM-ILT-092). 201. */
export function answerQuestionCommand(
  ctx: ServiceContext,
  questionId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'question.answer',
      subjectId: questionId,
      run: (state, by, { now, makeId }, { institutionType }) => {
        answerQuestion(state, by, questionId, input, makeId, now, { institutionType })
        return { id: questionId, statusCode: 201 }
      },
    },
    options,
  )
}

/** Öğrenci yanıtlanmamış sorusunu geri çeker (DOM-ILT-091). 200. */
export function withdrawQuestionCommand(
  ctx: ServiceContext,
  questionId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'question.withdraw',
      subjectId: questionId,
      run: (state, by, { now }, { institutionType }) => {
        withdrawQuestion(state, by, questionId, input, now, { institutionType })
        return { id: questionId, statusCode: 200 }
      },
    },
    options,
  )
}

/**
 * Soruya bağlı fotoğraf, soruyu okuyabilene açılır (ADR 0003 karar 6; DOM-ILT-093, DOM-ILT-094):
 * kural core `questions` kapsamındadır, ön büro ve başka öğrenci okuyamaz. PGlite tek
 * bağlantılıdır: kapsam işlemin bağlantısıyla (`tx`) okunur.
 */
defineFileAttachment(QUESTION_ATTACHMENT, {
  purposes: [QUESTION_PHOTO_PURPOSE],
  canRead: async (tx, ctx, questionId) => {
    const scope = await readScope({ ...ctx, db: tx })
    if (!scope.access(COLLECTION).allowed) return false
    const row = await findRecord(tx, ctx.institutionId, COLLECTION, questionId)
    return row !== null && scope.canRead(COLLECTION, row.data)
  },
})
