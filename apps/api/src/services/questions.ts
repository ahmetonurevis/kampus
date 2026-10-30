import type { State } from '@kampus/school-core/data/seed.ts'
import type { Participant } from '@kampus/school-core/lib/communication.ts'
import { answerQuestion, askQuestion, withdrawQuestion } from '@kampus/school-core/lib/questions.ts'
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
 * Öğretmenime Sor servisi (docs/domain/iletisim-ve-veli.md DOM-ILT-090…093). Kurallar, rol ve
 * kapsam core'dadır (`lib/questions.ts`, `requireAuthorized`); burada yalnız gereken kayıtların
 * yüklenmesi ve işlemin tek transaction'da çalıştırılması vardır.
 *
 * Kurumun bütün soruları kurum kilidi altında yüklenmez (`loadScope`): soru açılırken hiçbir soru,
 * yanıt ve geri çekmede yalnız hedef soru yüklenir. Soru ve yanıt metni loglanmaz; denetim kaydına
 * yalnız değişen alan adları yazılır (işlem çalıştırıcı).
 */

type QuestionAction = 'question.ask' | 'question.answer' | 'question.withdraw'
type Outcome = { id: string; statusCode: number }

interface QuestionRun {
  action: QuestionAction
  /** İşlemin konusu olan soru; `If-Match` bu kaydın sürümüyle karşılaştırılır. */
  subjectId: string | null
  run: (
    state: State,
    by: Participant,
    tools: OperationTools,
    options: { institutionType: InstitutionType },
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
        return {
          scalars,
          run: (state, tools) => command.run(state, by, tools, { institutionType }),
        }
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

/** Öğrenci kendi sınıfının ders öğretmenine soru gönderir (DOM-ILT-090). 201. */
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
      run: (state, by, { now, makeId }, { institutionType }) => {
        const created = askQuestion(state, by, input, makeId, now, { institutionType })
        return { id: created.id, statusCode: 201 }
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
