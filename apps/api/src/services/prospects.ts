import { eq } from 'drizzle-orm'

import type { State } from '@kampus/school-core/data/seed.ts'
import type { Participant } from '@kampus/school-core/lib/communication.ts'
import {
  addProspectNote,
  changeProspectStage,
  createProspect,
  scheduleProspectMeeting,
  scheduleTrialLesson,
  type ProspectOptions,
} from '@kampus/school-core/lib/prospects.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import type { CollectionName } from '../db/collections.ts'
import { users } from '../db/schema/auth.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { commandBody } from './command-result.ts'
import { environment, type CommandOptions } from './commands.ts'
import { runCommand, type CommandResponse, type OperationTools } from './operation-runner.ts'

/**
 * Aday/CRM servisi (docs/domain/kayit-ve-crm.md DOM-KAY-001…009, DOM-KAY-030…034; deneme dersi
 * docs/domain/dil-okulu.md DOM-DIL-030). Kurallar, rol ve kurum türü core'dadır
 * (`lib/prospects.ts`, `requireAuthorized`); burada yalnız kayıtların yüklenmesi ve işlemin tek
 * transaction'da çalıştırılması vardır.
 *
 * Adaylar kısmi yüklenmez (`loadScope` yok): tekillik (DOM-KAY-002, -031), kardeş doğrulaması,
 * görüşme çakışması (DOM-KAY-033) ve deneme dersi katılımcı/kapasite sayımı (DOM-KAY-034) kurumun
 * bütün adaylarına bakar. Koleksiyon kurum kilidinden sonra yüklenir; aynı adayı eşzamanlı açan
 * iki istekten ikincisi ilkinin yazdığı adayı görür ve 409 `prospect_duplicate` alır (`test:pg`).
 * State yalnız etkin kurumun kayıtlarını taşır; kardeşin "aynı kurumda" şartı buna dayanır.
 *
 * Var olan adayı değiştiren komutlarda `If-Match` çalıştırıcının `expectedVersions` denetimine
 * verilir: olmayan veya başka kurumun adayı yanlış sürümde de 404, yetkili kullanıcı 409
 * `version_conflict` alır; servis sürümü kendisi denetlemez.
 *
 * Aday telefonu, e-postası, veli adı ve not metni loglanmaz; denetim kaydına yalnız değişen alan
 * adları yazılır. Mükerrer kayıt reddi (`prospect_duplicate`, `prospect_contact_shared`) eşleşen
 * adayın kimliğini taşımaz (core hatası yalnız kod, ileti ve alan yolu taşır).
 */

type ProspectAction =
  'prospect.create' | 'prospect.stage' | 'prospect.note' | 'prospect.meeting' | 'prospect.trial'
type Outcome = { id: string; statusCode: number }

interface ProspectRun {
  action: ProspectAction
  /** İşlemin konusu olan aday; `If-Match` bu kaydın sürümüyle karşılaştırılır. */
  subjectId: string | null
  /** Not yazarının gösterilen adı oturum kullanıcısından okunur (DOM-KAY-032). */
  needsAuthorName?: boolean
  run: (state: State, by: Participant, tools: OperationTools, options: ProspectOptions) => Outcome
}

const COLLECTION: CollectionName = 'prospects'

/** Oturum kullanıcısının gösterilen adı; gövdeden okunmaz (D16b API notu). */
async function sessionUserName(tx: Database, userId: string): Promise<string> {
  const [row] = await tx
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return row?.name ?? ''
}

function execute(
  ctx: ServiceContext,
  command: ProspectRun,
  options: CommandOptions,
): Promise<CommandResponse> {
  const spec = OPERATION_COMMANDS[command.action]
  return runCommand(
    ctx,
    {
      action: command.action,
      collections: spec.collections,
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
        const prospectOptions: ProspectOptions = { institutionType }
        if (command.needsAuthorName === true)
          prospectOptions.authorName = await sessionUserName(tx, ctx.actor.userId)
        return {
          scalars,
          run: (state, tools) => command.run(state, by, tools, prospectOptions),
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

/** Yeni aday açar (DOM-KAY-002, -003, -004, -007, -009). 201. */
export function createProspectCommand(
  ctx: ServiceContext,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'prospect.create',
      subjectId: null,
      run: (state, by, { now, makeId }, prospectOptions) => {
        const created = createProspect(state, by, input, makeId, now, prospectOptions)
        return { id: created.id, statusCode: 201 }
      },
    },
    options,
  )
}

/** Adayın aşamasını değiştirir; vazgeçme nedenli, yeniden açma tekillik denetimli (DOM-KAY-030). 200. */
export function changeProspectStageCommand(
  ctx: ServiceContext,
  prospectId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'prospect.stage',
      subjectId: prospectId,
      run: (state, by, { now }, prospectOptions) => {
        changeProspectStage(state, by, prospectId, input, now, prospectOptions)
        return { id: prospectId, statusCode: 200 }
      },
    },
    options,
  )
}

/** Aday kartına not ekler; yazar adı oturumdan (DOM-KAY-032). 201. */
export function addProspectNoteCommand(
  ctx: ServiceContext,
  prospectId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'prospect.note',
      subjectId: prospectId,
      needsAuthorName: true,
      run: (state, by, { now, makeId }, prospectOptions) => {
        addProspectNote(state, by, prospectId, input, makeId, now, prospectOptions)
        return { id: prospectId, statusCode: 201 }
      },
    },
    options,
  )
}

/** Tanışma görüşmesi planlar veya yeniden planlar (DOM-KAY-006, -033). 200. */
export function scheduleProspectMeetingCommand(
  ctx: ServiceContext,
  prospectId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'prospect.meeting',
      subjectId: prospectId,
      run: (state, by, { now }, prospectOptions) => {
        scheduleProspectMeeting(state, by, prospectId, input, now, prospectOptions)
        return { id: prospectId, statusCode: 200 }
      },
    },
    options,
  )
}

/** Dil okulunda deneme dersi planlar (DOM-DIL-030, DOM-KAY-034). 200. */
export function scheduleTrialLessonCommand(
  ctx: ServiceContext,
  prospectId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'prospect.trial',
      subjectId: prospectId,
      run: (state, by, { now }, prospectOptions) => {
        scheduleTrialLesson(state, by, prospectId, input, now, prospectOptions)
        return { id: prospectId, statusCode: 200 }
      },
    },
    options,
  )
}
