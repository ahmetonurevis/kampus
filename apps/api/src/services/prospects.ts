import { eq } from 'drizzle-orm'

import type { State } from '@kampus/school-core/data/seed.ts'
import { requireAuthorized } from '@kampus/school-core/lib/authorize.ts'
import type { Participant } from '@kampus/school-core/lib/communication.ts'
import { enrollProspect, type EnrollmentInput } from '@kampus/school-core/lib/domain.ts'
import {
  addProspectNote,
  changeProspectStage,
  createProspect,
  scheduleProspectMeeting,
  scheduleTrialLesson,
  type ProspectOptions,
} from '@kampus/school-core/lib/prospects.ts'
import { notifyStudentEvent } from '@kampus/school-core/lib/notifications.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import type { CollectionName } from '../db/collections.ts'
import { users } from '../db/schema/auth.ts'
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
 * Aday/CRM servisi (docs/domain/kayit-ve-crm.md DOM-KAY-001…011, DOM-KAY-030…035; deneme dersi
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
 *
 * Kesin kayıt (`prospect.enroll`, DOM-KAY-001, -011, -035) öğrenci, veli, taksitler, sözleşme ve
 * adayın `Kayıt oldu` durumunu aynı transaction'da yazar. Core `enrollProspect` yetkiyi kendisi
 * denetlemediği için işlemden önce `requireAuthorized` çalışır.
 */

type ProspectAction =
  | 'prospect.create'
  | 'prospect.stage'
  | 'prospect.note'
  | 'prospect.meeting'
  | 'prospect.trial'
  | 'prospect.enroll'
type Outcome = {
  /** İşlemin konusu olan aday; denetim kaydı ona bağlanır. */
  id: string
  statusCode: number
  /** Yanıtın konusu (`entity`) adaydan başkaysa: kesin kayıtta oluşturulan öğrenci. */
  created?: { collection: CollectionName; id: string }
  /** Yanıt verisine eklenen alanlar (kesin kayıtta `contractId`). */
  extra?: Record<string, string>
}

interface ProspectRun {
  action: ProspectAction
  /** İşlemin konusu olan aday; `If-Match` bu kaydın sürümüyle karşılaştırılır. */
  subjectId: string | null
  /** Not yazarının gösterilen adı oturum kullanıcısından okunur (DOM-KAY-032). */
  needsAuthorName?: boolean
  /** Koleksiyon başına kısmi yükleme; verilmeyen koleksiyon bütünüyle yüklenir. */
  loadScope?: Partial<Record<CollectionName, LoadScope>>
  run: (state: State, by: Participant, tools: OperationTools, options: ProspectOptions) => Outcome
}

const COLLECTION: CollectionName = 'prospects'

/**
 * Oturum kullanıcısının gösterilen adı; gövdeden okunmaz (D16b API notu). Oturum açık olduğu için
 * kullanıcı satırı vardır; yoksa bu bir programlama/veri bütünlüğü hatasıdır: boş yazarla not
 * yazılmaz, düz `Error` 500 olur ve ayrıntı yalnız logda kalır (kullanıcıya gitmez).
 */
async function sessionUserName(tx: Database, userId: string): Promise<string> {
  const [row] = await tx
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (row === undefined)
    throw new Error('Oturum kullanıcısı bulunamadı: not yazarının adı okunamıyor.')
  return row.name
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
      ...(command.loadScope === undefined ? {} : { loadScope: command.loadScope }),
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
        outcome.result.created ?? { collection: COLLECTION, id: outcome.result.id },
        outcome.changes,
        outcome.result.statusCode,
        outcome.result.extra,
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

/**
 * Kesin kayıtta yalnız eklenen koleksiyonlar: core `enrollProspect` taksitleri ve sözleşmeyi
 * okumaz, yalnız ekler. Kurumun bütün faturalarını yüklemek gereksizdir; yeni kayıtlar
 * koleksiyonun sonuna eklenir. Veliler bütünüyle yüklenir: kardeş kaydında mevcut veliye bağlanır
 * (DOM-KAY-013).
 */
const APPEND_ONLY: LoadScope = { ids: [] }

/** Kesin kayıt gövdesi (rota şeması `enrollProspectBodySchema` doğrulamıştır); tutar kuruş. */
export type EnrollProspectInput = Omit<EnrollmentInput, 'prospectId'>

/**
 * Adayı kesin kayda alır: öğrenci, veli, taksitler ve sözleşme yazılır, aday `Kayıt oldu` olur
 * (DOM-KAY-001, DOM-KAY-003, DOM-KAY-011, DOM-KAY-012, DOM-KAY-013, DOM-KAY-035). Yetki core
 * `prospect.enroll` (yönetici, ön büro; modül `crm`) işlemden önce açıkça denetlenir; `finance`
 * modülü rotada ayrıca istenir. Kapalı veya kayıtlı aday 409 (`prospect_closed`,
 * `prospect_already_enrolled`); aynı adayı eşzamanlı iki istek kayda alırsa kurum kilidi altında
 * ikincisi 409 alır (`test:pg`). Gövdede aday kimliği yoktur; yol parametresinden eklenir. 201,
 * yanıtın konusu yeni öğrencidir, yanıt sözleşme kimliğini (`contractId`) de taşır; denetim kaydı
 * adaya bağlanır. İletişim modülü açıksa `enrollment_completed` bildirimi aynı transaction'da
 * eklenir (18 yaş altında veliye, yetişkinde kursiyere; core `lib/notifications.ts`). Tutar
 * kuruştur ve core'a olduğu gibi geçer. Kimlik no ve doğum tarihi loglanmaz (`REDACTED_PATHS`);
 * denetim kaydına yalnız alan adları yazılır.
 */
export function enrollProspectCommand(
  ctx: ServiceContext,
  prospectId: string,
  input: EnrollProspectInput,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'prospect.enroll',
      subjectId: prospectId,
      loadScope: { invoices: APPEND_ONLY, contracts: APPEND_ONLY, notifications: APPEND_ONLY },
      run: (state, by, { now, makeId }, { institutionType }) => {
        requireAuthorized(by, 'prospect.enroll', {}, state, {
          now,
          ...(institutionType === undefined ? {} : { institutionType }),
        })
        const { student, contract, minor } = enrollProspect(
          state,
          { ...input, prospectId },
          makeId,
          now,
          institutionType === undefined ? {} : { institutionType },
        )
        // Uygulama içi bildirim (F6a): 18 yaş altında veliye, yetişkinde kursiyere; iletişim
        // modülü kapalıysa bildirim merkezi yoktur, üretilmez. Aynı transaction'da yazılır.
        if (state.modules.communication === true)
          notifyStudentEvent(
            state,
            { kind: 'enrollment_completed', studentId: student.id, subjectId: student.id, minor },
            makeId,
            now,
          )
        return {
          id: prospectId,
          statusCode: 201,
          created: { collection: 'students', id: student.id },
          extra: { contractId: contract.id },
        }
      },
    },
    options,
  )
}
