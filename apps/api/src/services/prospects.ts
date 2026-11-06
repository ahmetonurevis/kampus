import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { State } from '@kampus/school-core/data/seed.ts'
import { requireAuthorized } from '@kampus/school-core/lib/authorize.ts'
import type { Participant } from '@kampus/school-core/lib/communication.ts'
import {
  enrollProspectSchema,
  enrollProspectWithTariff,
  findParentMatches,
} from '@kampus/school-core/lib/enrollment.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { planGuardianLink } from '@kampus/school-core/lib/guardianship.ts'
import {
  addProspectNote,
  changeProspectStage,
  createProspect,
  scheduleProspectMeeting,
  recordTrialResult,
  revertProspectStage,
  setProspectMarketingConsent,
  updateProspectDetails,
  scheduleTrialLesson,
  type ProspectOptions,
} from '@kampus/school-core/lib/prospects.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import type { CollectionName } from '../db/collections.ts'
import { findParentAccount, linkChildToAccount, loadParentBonds } from '../db/enrollment-bonds.ts'
import {
  countScholarshipAwards,
  findScholarshipProgram,
  insertScholarshipAward,
} from '../db/finance-scholarships.ts'
import { findReferralReward } from '../db/finance-referrals.ts'
import { findRecord, loadRecords } from '../db/records.ts'
import { users } from '../db/schema/auth.ts'
import { institutionSettings } from '../db/schema/institution-settings.ts'
import {
  findStudentIdentity,
  insertStudentIdentity,
  findIdentityHolder,
} from '../db/student-identities.ts'
import { insertGuardianLink } from '../db/student-guardians.ts'
import { archiveStudentIdentity } from '../db/withdrawals.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { notify } from './notify.ts'
import { commandBody } from './command-result.ts'
import { environment, type CommandOptions } from './commands.ts'
import { loadEffectiveTariff, withTariffCarryOver } from './fee-tariffs.ts'
import { settleEnrollmentReferral } from './finance-referrals.ts'
import { auditWork } from './task-work.ts'
import {
  runCommand,
  type CommandResponse,
  type LoadScope,
  type OperationTools,
  FINANCE_TABLE_STORES,
} from './operation-runner.ts'

/**
 * Aday/CRM servisi (docs/domain/kayit-ve-crm.md DOM-KAY-001…013, DOM-KAY-030…035; deneme dersi
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
  | 'prospect.create'
  | 'prospect.stage'
  | 'prospect.stageRevert'
  | 'prospect.consent'
  | 'prospect.update'
  | 'prospect.note'
  | 'prospect.meeting'
  | 'prospect.trial'
  | 'prospect.trialResult'
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

/**
 * Kesin kayıtta yalnız eklenen koleksiyonlar: `applyEnrollment` taksitleri ve sözleşmeyi okumaz,
 * yalnız ekler. Kurumun bütün faturaları her kayıtta yüklenmez; yeni kayıtlar koleksiyonun sonuna
 * eklenir. Öğrenciler (kontenjan, kardeş indirimi) ve veliler bütünüyle yüklenir.
 */
const APPEND_ONLY: LoadScope = { ids: [] }

/**
 * Adayı kesin kayda alır: tutar yayımlanmış tarifeden hesaplanır; öğrenci, veli, taksit, sözleşme,
 * aday aşaması ve kimlik satırı tek transaction'da yazılır (DOM-FIN-002, DOM-KAY-001, -011, -012,
 * -035). Kontenjan ve kimlik tekilliği kurum kilidi altında denetlenir. 201; konu öğrencidir.
 */
export function enrollProspectCommand(
  ctx: ServiceContext,
  prospectId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const spec = OPERATION_COMMANDS['prospect.enroll']
  const { identity, scholarshipProgramId, guardian, referralRewardId } =
    enrollProspectSchema.parse(input)
  // Seçilen mevcut velinin bağları: kısıtlı ya da velayetsiz veli kesin kayıtta bağlanamaz
  // (core `parent_not_guardian`; DOM-ILT-070, -074).
  const existingParentId =
    guardian !== null && 'existingParentId' in guardian ? guardian.existingParentId : null
  // Yükleme kurum kilidi altında okur, kayıt sonrası yazma (`after`) aynı işlemde kullanır.
  let parentAccountId: string | null = null
  let tariffCarriedOverFromYear: number | null = null
  return runCommand(
    ctx,
    {
      action: 'prospect.enroll',
      collections: spec.collections,
      stores: FINANCE_TABLE_STORES,
      loadScope: { invoices: APPEND_ONLY, contracts: APPEND_ONLY },
      ...(options.expectedVersion !== null
        ? {
            expectedVersions: [
              { collection: COLLECTION, id: prospectId, version: options.expectedVersion },
            ],
          }
        : {}),
      entity: (result: { student: { id: string } }) => ({
        type: 'students',
        id: result.student.id,
      }),
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        const [settings] = await tx
          .select({ academicYear: institutionSettings.academicYear })
          .from(institutionSettings)
          .where(eq(institutionSettings.institutionId, ctx.institutionId))
          .limit(1)
        const academicYear = settings?.academicYear ?? Number(dayKey(ctx.now).slice(0, 4))
        // Süresinde ilan yoksa önceki yılın tarifesi geçerli kalır (DOM-FIN-002, K-11).
        const effective = await loadEffectiveTariff(tx, ctx, academicYear, institutionType)
        tariffCarriedOverFromYear = effective?.carriedOverFromYear ?? null
        const identityHolderId = await findIdentityHolder(tx, ctx.institutionId, identity.number)
        const guardianBonds =
          existingParentId === null
            ? []
            : await loadParentBonds(tx, ctx.institutionId, [existingParentId])
        // Veli kaydının hesabı varsa yeni çocuk aynı hesaba bağlanır (DOM-KAY-013, ON-128).
        parentAccountId =
          existingParentId === null
            ? null
            : await findParentAccount(tx, ctx.institutionId, existingParentId)
        // Kontenjan kurum kilidi altında sayılır: iki eşzamanlı kayıt son yeri birlikte alamaz.
        const [scholarshipProgram, scholarshipAwardedCount] =
          scholarshipProgramId === undefined
            ? [null, 0]
            : [
                await findScholarshipProgram(tx, ctx.institutionId, scholarshipProgramId),
                await countScholarshipAwards(tx, ctx.institutionId, scholarshipProgramId),
              ]
        const referralReward =
          referralRewardId === undefined
            ? null
            : await findReferralReward(tx, ctx.institutionId, referralRewardId)
        return {
          scalars,
          run: (state, { now, makeId }) => {
            requireAuthorized(actor, 'prospect.enroll', {}, state, { now, institutionType })
            return enrollProspectWithTariff(state, prospectId, input, makeId, now, {
              institutionType,
              tariff: effective?.tariff ?? null,
              academicYear,
              identityHolderId,
              approvedByUserId: ctx.actor.userId,
              canApproveCapException: ctx.actor.role === 'yonetici',
              today: dayKey(ctx.now),
              scholarshipProgram,
              scholarshipAwardedCount,
              referralReward,
              guardianBonds,
            })
          },
        }
      },
      after: async (tx, result) => {
        if (result.supersededStudentId !== null)
          await archiveStudentIdentity(tx, ctx.institutionId, result.supersededStudentId, ctx.now)
        await insertStudentIdentity(tx, ctx.institutionId, {
          studentId: result.student.id,
          academicYear: result.academicYear,
          kind: result.identity.kind,
          number: result.identity.number,
          birthDate: result.identity.birthDate,
          now: ctx.now,
        })
        if (result.scholarshipAward !== null) {
          const awardId = randomUUID()
          await insertScholarshipAward(tx, ctx.institutionId, {
            id: awardId,
            programId: result.scholarshipAward.programId,
            studentId: result.student.id,
            academicYear: result.academicYear,
            amountCents: result.scholarshipAward.amountCents,
            awardedByUserId: ctx.actor.userId,
            now: ctx.now,
          })
          await auditWork(
            tx,
            ctx,
            'scholarship.award',
            { type: 'scholarship_awards', id: awardId },
            ['programId', 'studentId', 'amountCents'],
          )
        }
        await settleEnrollmentReferral(tx, ctx, result)
        // Veli–öğrenci bağı: veli velayet sahibi ve ödeyici olarak kurulur (DOM-ILT-070, -074);
        // yetişkin kursiyerin kendisi veli değildir, bağ yazılmaz. Kuralı core `planGuardianLink`
        // verir; yeni öğrencinin başka bağı olmadığı için değişmezler boş kümeye uygulanır.
        if (result.guardianBond !== null) {
          // Hesap yalnız mevcut veli kaydından gelir; yeni veli kaydının hesabı henüz yoktur.
          const accountId =
            result.guardianBond.parentId === existingParentId ? parentAccountId : null
          const draft = planGuardianLink({
            studentId: result.student.id,
            links: [],
            account: accountId === null ? null : { role: 'veli' },
            input: {
              parentId: result.guardianBond.parentId,
              ...(accountId === null ? {} : { membershipId: accountId }),
              relationship: result.guardianBond.relationship,
              custody: 'full',
              isPayer: result.guardianBond.isPayer,
            },
          })
          const linkId = randomUUID()
          await insertGuardianLink(tx, ctx.institutionId, { id: linkId, ...draft }, ctx.now)
          await auditWork(
            tx,
            ctx,
            'guardian.link',
            { type: 'student_guardian', id: linkId },
            Object.keys(draft),
          )
          if (accountId !== null)
            await linkChildToAccount(tx, ctx.institutionId, accountId, result.student.id, ctx.now)
        }
        // Kitleyi kimlik kaydındaki doğum tarihi belirler: 18 altında veli, yetişkinde kursiyer.
        await notify(tx, ctx, {
          type: 'enrollment_completed',
          recipients: { studentIds: [result.student.id] },
          data: { studentId: result.student.id },
        })
      },
    },
    (outcome) =>
      withTariffCarryOver(
        commandBody(
          { collection: 'students', id: outcome.result.student.id },
          outcome.changes,
          201,
        ),
        tariffCarriedOverFromYear,
      ),
    options.idempotency,
  )
}

const PARENT_MATCH = z.object({
  id: z.string(),
  name: z.string(),
  studentIds: z.array(z.string()),
  phone: z.string().optional(),
  // Yetişkin kursiyerin kendi satırını ve eski yer tutucuyu ayırmak için (`isNotGuardian`).
  email: z.string().optional(),
  relationship: z.string().optional(),
})
const STUDENT_MATCH = z.object({ id: z.string(), phone: z.string().optional() })
const PROSPECT_MATCH = z.object({
  // Kardeş adayın kesin kayıtta bağlandığı veli için (`siblingOfId`, DOM-KAY-031).
  id: z.string(),
  siblingOfId: z.string().optional(),
  studentId: z.string().nullable().optional(),
  phone: z.string().optional(),
  minor: z.boolean().optional(),
})

/**
 * Adayın telefonuyla ya da kardeş adayının kesin kaydıyla eşleşen veliler; ön büroya öneridir,
 * birleştirmez (DOM-KAY-013).
 */
export async function guardianMatchesFor(ctx: ServiceContext, prospectId: string) {
  const prospect = await findRecord(ctx.db, ctx.institutionId, 'prospects', prospectId)
  if (prospect === null) throw new NotFoundError()
  const phone = typeof prospect.data.phone === 'string' ? prospect.data.phone : ''
  const rows = await loadRecords(ctx.db, ctx.institutionId, ['parents', 'students', 'prospects'])
  const only = <T>(collection: CollectionName, schema: z.ZodType<T>): T[] =>
    rows.flatMap((row) => {
      if (row.collection !== collection) return []
      const parsed = schema.safeParse(row.data)
      return parsed.success ? [parsed.data] : []
    })
  const state = {
    parents: only('parents', PARENT_MATCH),
    students: only('students', STUDENT_MATCH),
    prospects: only('prospects', PROSPECT_MATCH),
  }
  // Önce eşleşenler bulunur, bağlar yalnız onlar için okunur; bir öğrencisinde velayetsiz ya da
  // iletişim kısıtlı veli önerilmez (DOM-ILT-070, -073, -074).
  const candidates = findParentMatches(state, phone, { prospectId })
  if (candidates.length === 0) return candidates
  const bonds = await loadParentBonds(
    ctx.db,
    ctx.institutionId,
    candidates.map((match) => match.parentId),
  )
  return findParentMatches(state, phone, { prospectId, bonds })
}

const IDENTITY_READ_FIELDS = ['kind', 'maskedNumber', 'birthDate', 'academicYear']

/**
 * Kimlik yalnız personele ve maskeli döner (guvenlik-kvkk.md Ç sınıfı). Her başarılı okuma aynı
 * transaction'da denetime yazılır (`student_identity.read`, ON-063; DOM-YTK-052): kimi, hangi
 * öğrencinin kimliğine baktı. Denetime numara ve doğum tarihi değil, dönen alanların adları gider;
 * denetim yazılamazsa yanıt dönmez.
 */
export async function studentIdentityFor(ctx: ServiceContext, studentId: string) {
  return ctx.db.transaction(async (tx) => {
    const row = await findStudentIdentity(tx, ctx.institutionId, studentId)
    if (row === null) throw new NotFoundError()
    await auditWork(
      tx,
      ctx,
      'student_identity.read',
      { type: 'students', id: studentId },
      IDENTITY_READ_FIELDS,
    )
    return {
      kind: row.kind,
      maskedNumber: `*******${row.number.slice(-4)}`,
      birthDate: row.birthDate,
      academicYear: row.academicYear,
    }
  })
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

/** Öğretmen deneme dersinin sonucunu yazar (DOM-DIL-031). 200. */
export function recordTrialResultCommand(
  ctx: ServiceContext,
  prospectId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'prospect.trialResult',
      subjectId: prospectId,
      run: (state, by, { now }, prospectOptions) => {
        recordTrialResult(state, by, prospectId, input, now, prospectOptions)
        return { id: prospectId, statusCode: 200 }
      },
    },
    options,
  )
}

/** Yönetici yanlışlıkla ileri alınan aşamayı gerekçeyle geri alır (DOM-KAY-030). 200. */
export function revertProspectStageCommand(
  ctx: ServiceContext,
  prospectId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'prospect.stageRevert',
      subjectId: prospectId,
      run: (state, by, { now }, prospectOptions) => {
        revertProspectStage(state, by, prospectId, input, now, prospectOptions)
        return { id: prospectId, statusCode: 200 }
      },
    },
    options,
  )
}

/** Adayın kanal bazlı ticari ileti onayını verir ya da geri alır (DOM-KAY-004). 200. */
export function setMarketingConsentCommand(
  ctx: ServiceContext,
  prospectId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'prospect.consent',
      subjectId: prospectId,
      run: (state, by, { now }, prospectOptions) => {
        setProspectMarketingConsent(state, by, prospectId, input, now, prospectOptions)
        return { id: prospectId, statusCode: 200 }
      },
    },
    options,
  )
}

/** Aday bilgisini düzeltir: ad, telefon, e-posta, ilgi, veli adı (DOM-KAY-003). 200. */
export function updateProspectDetailsCommand(
  ctx: ServiceContext,
  prospectId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return execute(
    ctx,
    {
      action: 'prospect.update',
      subjectId: prospectId,
      run: (state, by, { now }, prospectOptions) => {
        updateProspectDetails(state, by, prospectId, input, now, prospectOptions)
        return { id: prospectId, statusCode: 200 }
      },
    },
    options,
  )
}
