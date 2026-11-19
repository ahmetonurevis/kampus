import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import {
  requiredStaffDocumentTypes,
  resolveStaffDocumentSettings,
  type StaffDocumentType,
} from '@kampus/school-core/lib/finance-staff-documents.ts'
import {
  buildOnboardingSteps,
  DEFAULT_ORIENTATION_STEPS,
  jobOfferAcceptSchema,
  jobOfferInputSchema,
  jobOfferRejectSchema,
  jobOfferSendSchema,
  jobOfferUpdateSchema,
  jobOfferWithdrawSchema,
  MEMBER_DEPENDENT_STEP_KINDS,
  onboardingLinkSchema,
  onboardingProgress,
  onboardingSettingsSchema,
  onboardingState,
  onboardingStepCompleteSchema,
  onboardingStepEvidence,
  onboardingStepUpdateSchema,
  planJobOffer,
  planJobOfferDecision,
  planJobOfferSend,
  planJobOfferUpdate,
  planJobOfferWithdraw,
  planOnboardingLink,
  planOnboardingStepComplete,
  planOnboardingStepReopen,
  planOnboardingStepUpdate,
  type OnboardingFacts,
  type OrientationStep,
} from '@kampus/school-core/lib/finance-staff-onboarding.ts'
import { teacherPermitSummary } from '@kampus/school-core/lib/finance-work-permits.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { isStaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from '../db/client.ts'
import { loadStaffPayRates } from '../db/finance-pay-rates.ts'
import { findUserName } from '../db/finance-staff-certificates.ts'
import { loadMemberDocuments, loadStaffDocumentSettings } from '../db/finance-staff-documents.ts'
import { findLeaveProfile } from '../db/finance-staff-leave.ts'
import {
  acceptedOffersOfMember,
  countOpenStaffAssets,
  findJobOffer,
  findOnboardingMember,
  insertJobOffer,
  insertOnboardingSteps,
  listJobOffers,
  listOnboardingStaff,
  loadOnboardingSettings,
  loadOnboardingSteps,
  saveOnboardingSettings,
  updateJobOffer,
  updateOnboardingStep,
  type JobOfferChanges,
  type JobOfferQuery,
  type StoredJobOffer,
  type StoredOnboardingStep,
} from '../db/finance-staff-onboarding.ts'
import { loadTeacherWorkPermits } from '../db/finance-work-permits.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { institutions } from '../db/schema/auth.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * İş teklifi ve işe başlama listesi (DOM-FIN-121; ON-179). Kural core
 * `lib/finance-staff-onboarding.ts`'tedir; servis kurum kilidi altında teklifi, adımları ve
 * adımların kaynaklarını (özlük belgesi, çalışma onayı, ücret tanımı, izin profili, zimmet) yükler,
 * yazmaları tek transaction'da yapar. Kaynak durumu ve listenin tamamlanması her okumada
 * hesaplanır (K-413, K-414). Hesap açılmaz: davetle (IST-007) açılmış üyelik bağlanır. Teklif
 * mektubu okuması denetime düşer. Denetim kaydına alan adları yazılır; aday verisi, ücret, not ve
 * gerekçe yazılmaz. Rol ve modül denetimi rotadadır.
 */

const OFFER_ENTITY = 'staff_job_offers'
const SETTINGS_ENTITY = 'staff_onboarding_settings'
const LETTER_READ_ACTION = 'finance.job_offer.letter_read'

// --- Görünümler ----------------------------------------------------------------------------------

const displayName = (offer: StoredJobOffer) => offer.memberName ?? offer.candidateName ?? '—'

function progressOf(offer: StoredJobOffer, steps: readonly StoredOnboardingStep[]) {
  const progress = onboardingProgress(steps)
  return {
    state: onboardingState(offer.status, progress.completed, offer.acceptedOn !== null),
    total: progress.total,
    done: progress.done,
    requiredTotal: progress.requiredTotal,
    requiredDone: progress.requiredDone,
    completedAt: progress.completedAt,
  }
}

/** Liste satırı: iletişim ve ücret yoktur (veri en aza indirilir). */
function offerRow(offer: StoredJobOffer, steps: readonly StoredOnboardingStep[]) {
  return {
    id: offer.id,
    name: displayName(offer),
    isStaff: offer.membershipId !== null,
    position: offer.position,
    staffRole: offer.staffRole,
    startDate: offer.startDate,
    status: offer.status,
    sentOn: offer.sentOn,
    acceptedOn: offer.acceptedOn,
    closedOn: offer.closedOn,
    onboarding: progressOf(offer, steps),
    version: offer.version,
  }
}

async function offerOf(db: Database, ctx: ServiceContext, id: string) {
  const offer = await findJobOffer(db, ctx.institutionId, id)
  if (offer === null) throw new NotFoundError()
  return offer
}

/** Bağlı personelin adım kaynakları (K-413). */
async function loadFacts(
  db: Database,
  ctx: ServiceContext,
  offer: StoredJobOffer,
): Promise<OnboardingFacts> {
  const base = {
    startDate: offer.startDate,
    wageType: offer.wageType,
    offeredAmountCents: offer.offeredAmountCents,
  }
  const membershipId = offer.membershipId
  if (membershipId === null)
    return {
      ...base,
      member: null,
      documentTypes: new Set(),
      workPermit: null,
      wage: null,
      seniorityStartDate: null,
      openAssetCount: 0,
    }
  const today = dayKey(ctx.now)
  const [member, documents, permits, rates, profile, openAssetCount] = await Promise.all([
    findOnboardingMember(db, ctx.institutionId, membershipId),
    loadMemberDocuments(db, ctx.institutionId, [membershipId], { currentOnly: true }),
    loadTeacherWorkPermits(db, ctx.institutionId, [membershipId]),
    loadStaffPayRates(db, ctx.institutionId, [membershipId]),
    findLeaveProfile(db, ctx.institutionId, membershipId),
    countOpenStaffAssets(db, ctx.institutionId, membershipId),
  ])
  // İşe başlama günü ya da sonrasında yürürlükteki ilk ana ücret (yuva sırası başlangıca göre).
  const wage =
    rates.find(
      (rate) =>
        rate.component === 'wage' && (rate.endDate === null || rate.endDate >= offer.startDate),
    ) ?? null
  return {
    ...base,
    member,
    documentTypes: new Set<StaffDocumentType>(documents.map((doc) => doc.documentType)),
    workPermit: teacherPermitSummary(permits, today).status,
    wage:
      wage === null
        ? null
        : { rateType: wage.rateType, amountCents: wage.amountCents, startDate: wage.startDate },
    seniorityStartDate: profile?.seniorityStartDate ?? null,
    openAssetCount,
  }
}

async function offerDetail(db: Database, ctx: ServiceContext, id: string) {
  const offer = await offerOf(db, ctx, id)
  const [steps, facts] = await Promise.all([
    loadOnboardingSteps(db, ctx.institutionId, [id]),
    loadFacts(db, ctx, offer),
  ])
  return {
    ...offerRow(offer, steps),
    membershipId: offer.membershipId,
    candidateName: offer.candidateName,
    candidateEmail: offer.candidateEmail,
    candidatePhone: offer.candidatePhone,
    wageType: offer.wageType,
    offeredAmountCents: offer.offeredAmountCents,
    currency: 'TRY' as const,
    respondBy: offer.respondBy,
    note: offer.note,
    closeReason: offer.closeReason,
    createdAt: offer.createdAt,
    member:
      facts.member === null || offer.membershipId === null
        ? null
        : {
            membershipId: offer.membershipId,
            name: offer.memberName ?? '—',
            role: facts.member.role,
            active: facts.member.active,
          },
    steps: steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      documentType: step.documentType,
      label: step.label,
      required: step.required,
      responsible:
        step.responsibleMembershipId === null
          ? null
          : { membershipId: step.responsibleMembershipId, name: step.responsibleName ?? '—' },
      dueDate: step.dueDate,
      completedOn: step.completedOn,
      completedAt: step.completedAt,
      note: step.note,
      evidence: onboardingStepEvidence(step, facts),
    })),
  }
}

// --- Okuma ---------------------------------------------------------------------------------------

export async function listJobOffersFor(ctx: ServiceContext, query: JobOfferQuery) {
  const { items, total } = await listJobOffers(ctx.db, ctx.institutionId, query)
  const steps = await loadOnboardingSteps(
    ctx.db,
    ctx.institutionId,
    items.map((item) => item.id),
  )
  const byOffer = new Map<string, StoredOnboardingStep[]>()
  for (const step of steps) byOffer.set(step.offerId, [...(byOffer.get(step.offerId) ?? []), step])
  return { items: items.map((item) => offerRow(item, byOffer.get(item.id) ?? [])), total }
}

export const getJobOfferFor = (ctx: ServiceContext, id: string) => offerDetail(ctx.db, ctx, id)

export async function getOnboardingSettingsFor(ctx: ServiceContext) {
  const stored = await loadOnboardingSettings(ctx.db, ctx.institutionId)
  return {
    orientationSteps: stored?.orientationSteps ?? DEFAULT_ORIENTATION_STEPS.map((s) => ({ ...s })),
    isDefault: stored === null,
    updatedAt: stored?.updatedAt ?? null,
    version: stored?.version ?? null,
  }
}

export async function listOnboardingStaffFor(ctx: ServiceContext) {
  const items = await listOnboardingStaff(ctx.db, ctx.institutionId)
  return items.flatMap(({ membershipId, name, role }) =>
    isStaffRole(role) ? [{ membershipId, name, role }] : [],
  )
}

async function institutionNameOf(db: Database, institutionId: string): Promise<string> {
  const [row] = await db
    .select({ name: institutions.name })
    .from(institutions)
    .where(eq(institutions.id, institutionId))
    .limit(1)
  if (row === undefined) throw new NotFoundError()
  return row.name
}

/**
 * Teklif mektubunun içeriği (PDF verisi; K-412): aday adı ve ücret döner, okuma aynı transaction'da
 * `finance.job_offer.letter_read` denetimine yazılır (alan adları); denetim yazılamazsa yanıt dönmez.
 */
export async function jobOfferLetterFor(ctx: ServiceContext, id: string) {
  return ctx.db.transaction(async (tx) => {
    const offer = await offerOf(tx, ctx, id)
    const [institutionName, issuedByName] = await Promise.all([
      institutionNameOf(tx, ctx.institutionId),
      findUserName(tx, ctx.actor.userId),
    ])
    await tx.insert(auditLog).values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: LETTER_READ_ACTION,
      entityType: OFFER_ENTITY,
      entityId: id,
      // kvkk: değer değil, dönen kişisel alanların adı.
      changes: { fields: ['candidateName', 'offeredAmountCents'] },
      createdAt: ctx.now,
    })
    return {
      id: offer.id,
      status: offer.status,
      institutionName,
      candidateName: displayName(offer),
      position: offer.position,
      staffRole: offer.staffRole,
      startDate: offer.startDate,
      wageType: offer.wageType,
      offeredAmountCents: offer.offeredAmountCents,
      currency: 'TRY' as const,
      respondBy: offer.respondBy,
      note: offer.note,
      sentOn: offer.sentOn,
      createdAt: offer.createdAt,
      issuedByName: issuedByName ?? '—',
      generatedAt: ctx.now.toISOString(),
    }
  })
}

// --- Komutlar ------------------------------------------------------------------------------------

/** Teklif bulunamazsa 404, sürüm tutmazsa 409. */
async function currentOf(tx: Database, ctx: ServiceContext, id: string, expectedVersion: number) {
  const current = await offerOf(tx, ctx, id)
  if (current.version !== expectedVersion) throw new ConflictError()
  return current
}

/** Sürümü artırır (adım değişikliği teklifin sürümüyle korunur); tutmazsa 409. */
async function saveOffer(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  changes: JobOfferChanges = {},
) {
  const saved = await updateJobOffer(tx, ctx.institutionId, {
    id,
    expectedVersion,
    changes,
    now: ctx.now,
  })
  if (!saved) throw new ConflictError()
}

/**
 * Teklif komutu: `load` kurum kilidi altında okur ve kuralı çalıştıran planı döndürür, `write`
 * planı yazar ve denetime gidecek alan adlarını verir; yanıt güncel ayrıntıdır.
 */
function command<P>(
  ctx: ServiceContext,
  spec: {
    action: string
    id: string
    load: (tx: Database) => Promise<() => P>
    write: (tx: Database, plan: P) => Promise<string[]>
    statusCode?: number
  },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: OFFER_ENTITY, id: spec.id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: spec.action,
      collections: [],
      entity,
      load: async (tx) => {
        const plan = await spec.load(tx)
        return { run: () => plan() }
      },
      after: async (tx, plan) => {
        const fields = await spec.write(tx, plan)
        await auditWork(tx, ctx, spec.action, entity, fields)
        body = { data: await offerDetail(tx, ctx, spec.id) }
      },
    },
    () => ({ statusCode: spec.statusCode ?? 200, body }),
    idempotency,
  )
}

/** Yeni teklif (K-412): taslak. `Idempotency-Key` rotada zorunlu. 201. */
export function createJobOfferCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  return command(
    ctx,
    {
      action: 'finance.job_offer.create',
      id,
      statusCode: 201,
      load: async (tx) => {
        const data = jobOfferInputSchema.parse(input)
        const member =
          data.membershipId === null
            ? null
            : await findOnboardingMember(tx, ctx.institutionId, data.membershipId)
        return () => {
          planJobOffer(data, member)
          return data
        }
      },
      write: async (tx, data) => {
        await insertJobOffer(tx, ctx.institutionId, {
          ...data,
          id,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        return Object.entries(data)
          .filter(([, value]) => value !== null)
          .map(([key]) => key)
      },
    },
    idempotency,
  )
}

/** Taslak düzeltmesi (K-412). */
export function updateJobOfferCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'finance.job_offer.update',
      id,
      load: async (tx) => {
        const current = await currentOf(tx, ctx, id, expectedVersion)
        const changes = jobOfferUpdateSchema.parse(input)
        return () => {
          const changed = planJobOfferUpdate(current, changes)
          const write: JobOfferChanges = {}
          for (const key of changed) Object.assign(write, { [key]: changes[key] ?? null })
          return { changed, write }
        }
      },
      write: async (tx, { changed, write }) => {
        await saveOffer(tx, ctx, id, expectedVersion, write)
        return changed
      },
    },
    idempotency,
  )
}

/** Gönderildi (K-412): Kampüs e-posta göndermez; gün işaretlenir. */
export function sendJobOfferCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'finance.job_offer.send',
      id,
      load: async (tx) => {
        const current = await currentOf(tx, ctx, id, expectedVersion)
        const data = jobOfferSendSchema.parse(input)
        return () => {
          planJobOfferSend(current, data, dayKey(ctx.now))
          return data
        }
      },
      write: async (tx, data) => {
        await saveOffer(tx, ctx, id, expectedVersion, { status: 'sent', sentOn: data.sentOn })
        return ['status', 'sentOn']
      },
    },
    idempotency,
  )
}

/** Hesaba bağlı olmayan oryantasyon ayarı (kurum ayarı ya da varsayılan). */
async function orientationOf(tx: Database, institutionId: string): Promise<OrientationStep[]> {
  const stored = await loadOnboardingSettings(tx, institutionId)
  return stored?.orientationSteps ?? DEFAULT_ORIENTATION_STEPS.map((step) => ({ ...step }))
}

/**
 * Kabul (K-412, K-413): işe başlama listesi aynı transaction'da açılır; özlük belgesi zorunlu
 * türleri ve oryantasyon adımları kabul anındaki kurum ayarından kopyalanır.
 */
export function acceptJobOfferCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'finance.job_offer.accept',
      id,
      load: async (tx) => {
        const current = await currentOf(tx, ctx, id, expectedVersion)
        const data = jobOfferAcceptSchema.parse(input)
        const [documentSettings, orientationSteps] = await Promise.all([
          loadStaffDocumentSettings(tx, ctx.institutionId),
          orientationOf(tx, ctx.institutionId),
        ])
        return () => {
          planJobOfferDecision(current, data, 'accept', dayKey(ctx.now))
          return {
            data,
            steps: buildOnboardingSteps({
              staffRole: current.staffRole,
              startDate: current.startDate,
              acceptedOn: data.decidedOn,
              membershipLinked: current.membershipId !== null,
              requiredDocumentTypes: requiredStaffDocumentTypes(
                resolveStaffDocumentSettings(documentSettings.stored),
              ),
              orientationSteps,
            }),
          }
        }
      },
      write: async (tx, { data, steps }) => {
        await saveOffer(tx, ctx, id, expectedVersion, {
          status: 'accepted',
          acceptedOn: data.decidedOn,
        })
        await insertOnboardingSteps(tx, ctx.institutionId, {
          offerId: id,
          steps,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        return ['status', 'acceptedOn', 'steps']
      },
    },
    idempotency,
  )
}

/** Ret (K-412): gerekçe isteğe bağlı, denetime yazılmaz. */
export function rejectJobOfferCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'finance.job_offer.reject',
      id,
      load: async (tx) => {
        const current = await currentOf(tx, ctx, id, expectedVersion)
        const data = jobOfferRejectSchema.parse(input)
        return () => {
          planJobOfferDecision(current, data, 'reject', dayKey(ctx.now))
          return data
        }
      },
      write: async (tx, data) => {
        await saveOffer(tx, ctx, id, expectedVersion, {
          status: 'rejected',
          closedOn: data.decidedOn,
          closeReason: data.reason,
        })
        return ['status', 'closedOn', ...(data.reason === null ? [] : ['closeReason'])]
      },
    },
    idempotency,
  )
}

/** Geri çekme (K-412): kabul edilmiş teklifte liste tamamlanmadıysa; liste kapanır. */
export function withdrawJobOfferCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'finance.job_offer.withdraw',
      id,
      load: async (tx) => {
        const current = await currentOf(tx, ctx, id, expectedVersion)
        const data = jobOfferWithdrawSchema.parse(input)
        const steps = await loadOnboardingSteps(tx, ctx.institutionId, [id])
        return () => {
          planJobOfferWithdraw(
            current,
            data,
            current.status === 'accepted' && onboardingProgress(steps).completed,
            dayKey(ctx.now),
          )
          return data
        }
      },
      write: async (tx, data) => {
        await saveOffer(tx, ctx, id, expectedVersion, {
          status: 'withdrawn',
          closedOn: data.decidedOn,
          closeReason: data.reason,
        })
        return ['status', 'closedOn', ...(data.reason === null ? [] : ['closeReason'])]
      },
    },
    idempotency,
  )
}

/** Başka kabul edilmiş ve listesi tamamlanmamış teklife bağlı mı. */
async function linkedElsewhere(
  tx: Database,
  institutionId: string,
  membershipId: string,
  offerId: string,
): Promise<boolean> {
  const others = await acceptedOffersOfMember(tx, institutionId, membershipId, offerId)
  if (others.length === 0) return false
  const steps = await loadOnboardingSteps(tx, institutionId, others)
  return others.some(
    (other) => !onboardingProgress(steps.filter((step) => step.offerId === other)).completed,
  )
}

/**
 * Hesap bağlama (K-413; IST-007): davetle açılmış personel üyeliği listeye bağlanır, hesap adımı
 * bugünle tamamlanır ve adayın iletişim bilgisi silinir (personel kaydı esastır).
 */
export function linkOnboardingAccountCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'finance.job_offer.link_account',
      id,
      load: async (tx) => {
        const current = await currentOf(tx, ctx, id, expectedVersion)
        const { membershipId } = onboardingLinkSchema.parse(input)
        const [member, steps, elsewhere] = await Promise.all([
          findOnboardingMember(tx, ctx.institutionId, membershipId),
          loadOnboardingSteps(tx, ctx.institutionId, [id]),
          linkedElsewhere(tx, ctx.institutionId, membershipId, id),
        ])
        return () => {
          planOnboardingLink(current, membershipId, {
            member,
            linkedElsewhere: elsewhere,
            dependentStepCompleted: steps.some(
              (step) =>
                (MEMBER_DEPENDENT_STEP_KINDS as readonly string[]).includes(step.kind) &&
                step.completedOn !== null,
            ),
          })
          return { membershipId, account: steps.find((step) => step.kind === 'account') ?? null }
        }
      },
      write: async (tx, { membershipId, account }) => {
        await saveOffer(tx, ctx, id, expectedVersion, {
          membershipId,
          candidateEmail: null,
          candidatePhone: null,
        })
        if (account !== null)
          await updateOnboardingStep(tx, ctx.institutionId, {
            offerId: id,
            stepId: account.id,
            changes: {
              completedOn: dayKey(ctx.now),
              completedAt: ctx.now,
              completedByUserId: ctx.actor.userId,
              note: null,
            },
            now: ctx.now,
          })
        return ['membershipId', 'candidateEmail', 'candidatePhone', 'steps.account']
      },
    },
    idempotency,
  )
}

async function stepOf(tx: Database, ctx: ServiceContext, offerId: string, stepId: string) {
  const steps = await loadOnboardingSteps(tx, ctx.institutionId, [offerId])
  const step = steps.find((item) => item.id === stepId)
  if (step === undefined) throw new NotFoundError()
  return step
}

/** Sorumlu ve son gün (K-414). */
export function updateOnboardingStepCommand(
  ctx: ServiceContext,
  id: string,
  stepId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'finance.onboarding_step.update',
      id,
      load: async (tx) => {
        const current = await currentOf(tx, ctx, id, expectedVersion)
        await stepOf(tx, ctx, id, stepId)
        const data = onboardingStepUpdateSchema.parse(input)
        const responsible =
          data.responsibleMembershipId === undefined || data.responsibleMembershipId === null
            ? null
            : await findOnboardingMember(tx, ctx.institutionId, data.responsibleMembershipId)
        return () => {
          planOnboardingStepUpdate(current, data, responsible)
          return data
        }
      },
      write: async (tx, data) => {
        await saveOffer(tx, ctx, id, expectedVersion)
        await updateOnboardingStep(tx, ctx.institutionId, {
          offerId: id,
          stepId,
          changes: {
            ...(data.responsibleMembershipId === undefined
              ? {}
              : { responsibleMembershipId: data.responsibleMembershipId }),
            ...(data.dueDate === undefined ? {} : { dueDate: data.dueDate }),
          },
          now: ctx.now,
        })
        return Object.keys(data).map((key) => `steps.${key}`)
      },
    },
    idempotency,
  )
}

/** Adımı tamamla (K-413, K-414): kaynak isteyen adımda kaynak kilit altında yeniden denetlenir. */
export function completeOnboardingStepCommand(
  ctx: ServiceContext,
  id: string,
  stepId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'finance.onboarding_step.complete',
      id,
      load: async (tx) => {
        const current = await currentOf(tx, ctx, id, expectedVersion)
        const step = await stepOf(tx, ctx, id, stepId)
        const data = onboardingStepCompleteSchema.parse(input)
        const facts = await loadFacts(tx, ctx, current)
        return () => {
          planOnboardingStepComplete(
            current,
            step,
            onboardingStepEvidence(step, facts),
            data,
            dayKey(ctx.now),
          )
          return data
        }
      },
      write: async (tx, data) => {
        await saveOffer(tx, ctx, id, expectedVersion)
        await updateOnboardingStep(tx, ctx.institutionId, {
          offerId: id,
          stepId,
          changes: {
            completedOn: data.completedOn,
            completedAt: ctx.now,
            completedByUserId: ctx.actor.userId,
            note: data.note,
          },
          now: ctx.now,
        })
        return ['steps.completedOn', ...(data.note === null ? [] : ['steps.note'])]
      },
    },
    idempotency,
  )
}

/** İşareti geri al (K-414). */
export function reopenOnboardingStepCommand(
  ctx: ServiceContext,
  id: string,
  stepId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'finance.onboarding_step.reopen',
      id,
      load: async (tx) => {
        const current = await currentOf(tx, ctx, id, expectedVersion)
        const step = await stepOf(tx, ctx, id, stepId)
        return () => {
          planOnboardingStepReopen(current, step)
          return null
        }
      },
      write: async (tx) => {
        await saveOffer(tx, ctx, id, expectedVersion)
        await updateOnboardingStep(tx, ctx.institutionId, {
          offerId: id,
          stepId,
          changes: { completedOn: null, completedAt: null, completedByUserId: null, note: null },
          now: ctx.now,
        })
        return ['steps.completedOn']
      },
    },
    idempotency,
  )
}

/**
 * Oryantasyon ayarı (K-413): bütünüyle yazılır. İlk yazma `If-Match` almaz (ayar varsa 409),
 * sonrakiler ayarın sürümünü ister. Açılmış listeler değişmez.
 */
export function updateOnboardingSettingsCommand(
  ctx: ServiceContext,
  input: unknown,
  expectedVersion: number | null,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SETTINGS_ENTITY, id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.onboarding_settings.update',
      collections: [],
      entity,
      load: async (tx) => {
        const stored = await loadOnboardingSettings(tx, ctx.institutionId)
        if ((stored?.version ?? null) !== expectedVersion) throw new ConflictError()
        const data = onboardingSettingsSchema.parse(input)
        return { run: () => data }
      },
      after: async (tx, data) => {
        const saved = await saveOnboardingSettings(tx, ctx.institutionId, {
          orientationSteps: data.orientationSteps,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.onboarding_settings.update', entity, ['orientationSteps'])
        body = { data: await getOnboardingSettingsFor({ ...ctx, db: tx }) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
