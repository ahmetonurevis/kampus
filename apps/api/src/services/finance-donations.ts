import { randomUUID } from 'node:crypto'

import {
  donationCampaignProgress,
  donationSchema,
  donationsCsv,
  maskDonorIdentity,
  planDonation,
  planDonationCampaignClose,
  planDonationCampaignCreate,
  planDonationCampaignOpen,
  planDonationCampaignUpdate,
  planDonationCancel,
  planDonorCreate,
  planDonorUpdate,
  type DonationCampaignStatus,
  type DonationSettingsInput,
} from '@kampus/school-core/lib/finance-donations.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { bankAccountLabel } from '@kampus/school-core/lib/payments.ts'

import type { Database } from '../db/client.ts'
import {
  activeBankAccountIds,
  campaignDonationDays,
  cancelDonation,
  donationCampaignNames,
  donorIdentityTaken,
  findDonation,
  findDonationCampaign,
  findDonor,
  insertDonation,
  insertDonationCampaign,
  insertDonor,
  listCampaignDonations,
  listDonationCampaigns,
  listDonors,
  loadDonationSettings,
  saveDonationSettings,
  updateDonationCampaign,
  updateDonor,
  type CampaignTotals,
  type StoredDonation,
  type StoredDonationCampaign,
  type StoredDonor,
} from '../db/finance-donations.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Bağış kampanyası, bağışçı ve makbuz servisi (DOM-FIN-097; ON-258). Kural core
 * `lib/finance-donations.ts`'tedir. Her yazma kurum kilidi altında (`runCommand`) gereken satırları
 * okur, core'a karar verdirir ve aynı transaction'da yazar; makbuz numarası da bu kilit altında
 * verilir. Denetime alan adları düşer; ad, kimlik numarası, iletişim, not ve gerekçe loglanmaz.
 * Makbuz okuması (tam kimlik numarası) ve CSV dökümü ayrıca denetlenir (K-298).
 */

const CAMPAIGN = 'donation_campaigns'
const DONOR = 'donors'
const DONATION = 'donations'
const SETTINGS = 'donation_settings'

const accountLabel = (row: { bankName: string | null; bankIban: string | null }) =>
  row.bankName === null || row.bankIban === null
    ? null
    : bankAccountLabel({ bankName: row.bankName, iban: row.bankIban })

function campaignView(row: StoredDonationCampaign & CampaignTotals) {
  const { bankName, bankIban, ...rest } = row
  return {
    ...rest,
    bankAccountLabel: accountLabel({ bankName, bankIban }),
    ...donationCampaignProgress(row.targetCents, row.collectedCents),
  }
}

function donationView(row: StoredDonation) {
  const { bankName, bankIban, donorIdentityNumber, taxNotice, ...rest } = row
  return {
    ...rest,
    maskedIdentityNumber: maskDonorIdentity(donorIdentityNumber),
    bankAccountLabel: accountLabel({ bankName, bankIban }),
    hasTaxNotice: taxNotice !== null,
  }
}

async function studentNames(db: Database, ctx: ServiceContext, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, string | null>()
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'students', [...new Set(ids)], {
    includeArchived: true,
  })
  return new Map(
    rows.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : null]),
  )
}

function donorView(row: StoredDonor, names: ReadonlyMap<string, string | null>) {
  const { identityNumber, studentId, relation, ...rest } = row
  return {
    ...rest,
    maskedIdentityNumber: maskDonorIdentity(identityNumber),
    link:
      studentId === null || relation === null
        ? null
        : { studentId, relation, studentName: names.get(studentId) ?? null },
  }
}

// --- Kampanya ------------------------------------------------------------------------------------

export async function listDonationCampaignsFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    status?: DonationCampaignStatus | undefined
  },
) {
  const { items, total } = await listDonationCampaigns(ctx.db, ctx.institutionId, query)
  return { items: items.map(campaignView), total }
}

async function campaignOf(db: Database, ctx: ServiceContext, id: string) {
  const campaign = await findDonationCampaign(db, ctx.institutionId, id)
  if (campaign === null) throw new NotFoundError()
  return campaign
}

export const donationCampaignFor = async (ctx: ServiceContext, id: string) =>
  campaignView(await campaignOf(ctx.db, ctx, id))

/** Taslak kampanya açar; aynı ad 409. 201. */
export function createDonationCampaignCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: CAMPAIGN, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'donation_campaign.create',
      collections: [],
      entity,
      load: async (tx) => {
        const [taken, accounts] = await Promise.all([
          donationCampaignNames(tx, ctx.institutionId),
          activeBankAccountIds(tx, ctx.institutionId),
        ])
        return { run: () => planDonationCampaignCreate(input, { taken, accounts }) }
      },
      after: async (tx, plan) => {
        await insertDonationCampaign(tx, ctx.institutionId, {
          id,
          ...plan,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'donation_campaign.create', entity, Object.keys(plan))
        body = { data: campaignView(await campaignOf(tx, ctx, id)) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

type CampaignTransition = 'update' | 'open' | 'close'

/** Düzeltme, açma ve kapatma: sürüm `If-Match` ile, karar core'da (K-296). 200. */
export function changeDonationCampaignCommand(
  ctx: ServiceContext,
  campaignId: string,
  transition: CampaignTransition,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: CAMPAIGN, id: campaignId }
  const action = `donation_campaign.${transition}`
  let body: unknown
  return runCommand(
    ctx,
    {
      action,
      collections: [],
      entity,
      load: async (tx) => {
        const campaign = await campaignOf(tx, ctx, campaignId)
        if (campaign.version !== expectedVersion) throw new ConflictError()
        if (transition === 'open')
          return { run: () => (planDonationCampaignOpen(campaign, dayKey(ctx.now)), {}) }
        if (transition === 'close') return { run: () => (planDonationCampaignClose(campaign), {}) }
        const [taken, accounts, donationDays] = await Promise.all([
          donationCampaignNames(tx, ctx.institutionId),
          activeBankAccountIds(tx, ctx.institutionId),
          campaignDonationDays(tx, ctx.institutionId, campaignId),
        ])
        return {
          run: () => planDonationCampaignUpdate(campaign, input, { taken, accounts, donationDays }),
        }
      },
      after: async (tx, changes) => {
        const saved = await updateDonationCampaign(tx, ctx.institutionId, {
          id: campaignId,
          expectedVersion,
          changes,
          ...(transition === 'update'
            ? {}
            : {
                status: { to: transition === 'open' ? 'open' : 'closed', userId: ctx.actor.userId },
              }),
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          action,
          entity,
          transition === 'update' ? Object.keys(changes) : ['status'],
        )
        body = { data: campaignView(await campaignOf(tx, ctx, campaignId)) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Bağışçı -------------------------------------------------------------------------------------

export async function listDonorsFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined },
) {
  const { items, total } = await listDonors(ctx.db, ctx.institutionId, query)
  const names = await studentNames(
    ctx.db,
    ctx,
    items.flatMap((row) => (row.studentId === null ? [] : [row.studentId])),
  )
  return { items: items.map((row) => donorView(row, names)), total }
}

async function donorBody(tx: Database, ctx: ServiceContext, id: string) {
  const donor = await findDonor(tx, ctx.institutionId, id)
  if (donor === null) throw new NotFoundError()
  const names = await studentNames(tx, ctx, donor.studentId === null ? [] : [donor.studentId])
  return { data: donorView(donor, names) }
}

async function studentExists(tx: Database, ctx: ServiceContext, studentId: string | undefined) {
  if (studentId === undefined) return false
  const rows = await loadRecordsByIds(tx, ctx.institutionId, 'students', [studentId], {
    includeArchived: true,
  })
  return rows.length > 0
}

const linkStudent = (input: unknown): string | undefined => {
  if (typeof input !== 'object' || input === null) return undefined
  const link = (input as { link?: unknown }).link
  if (typeof link !== 'object' || link === null) return undefined
  const studentId = (link as { studentId?: unknown }).studentId
  return typeof studentId === 'string' ? studentId.trim() : undefined
}
const identityOf = (input: unknown): string | undefined => {
  if (typeof input !== 'object' || input === null) return undefined
  const value = (input as { identityNumber?: unknown }).identityNumber
  return typeof value === 'string' ? value.trim() : undefined
}

/** Bağışçı kaydı (K-298); kimlik numarası kurumda tekil (409), öğrenci bağı kurumdan (404). 201. */
export function createDonorCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: DONOR, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'donor.create',
      collections: [],
      entity,
      load: async (tx) => {
        const identityTaken = await donorIdentityTaken(tx, ctx.institutionId, identityOf(input))
        const exists = await studentExists(tx, ctx, linkStudent(input))
        return { run: () => planDonorCreate(input, { identityTaken, studentExists: exists }) }
      },
      after: async (tx, plan) => {
        const { kind, ...values } = plan
        await insertDonor(tx, ctx.institutionId, {
          id,
          kind,
          ...values,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'donor.create',
          entity,
          Object.entries(plan)
            .filter(([, value]) => value !== null)
            .map(([key]) => key),
        )
        body = await donorBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

export function updateDonorCommand(
  ctx: ServiceContext,
  donorId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: DONOR, id: donorId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'donor.update',
      collections: [],
      entity,
      load: async (tx) => {
        const donor = await findDonor(tx, ctx.institutionId, donorId)
        if (donor === null) throw new NotFoundError()
        if (donor.version !== expectedVersion) throw new ConflictError()
        const identityTaken = await donorIdentityTaken(
          tx,
          ctx.institutionId,
          identityOf(input),
          donorId,
        )
        const exists = await studentExists(tx, ctx, linkStudent(input))
        return {
          run: () => planDonorUpdate(donor, input, { identityTaken, studentExists: exists }),
        }
      },
      after: async (tx, changes) => {
        const saved = await updateDonor(tx, ctx.institutionId, {
          id: donorId,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'donor.update', entity, Object.keys(changes))
        body = await donorBody(tx, ctx, donorId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Bağış ---------------------------------------------------------------------------------------

export async function listCampaignDonationsFor(
  ctx: ServiceContext,
  campaignId: string,
  page: { page: number; pageSize: number },
) {
  await campaignOf(ctx.db, ctx, campaignId)
  const { items, total } = await listCampaignDonations(ctx.db, ctx.institutionId, campaignId, page)
  return { items: items.map(donationView), total }
}

/** Bağış dökümü CSV'si; bağışçı adı taşıdığı için denetime yazılır (rota taze oturum ister). */
export async function campaignDonationsCsvFor(ctx: ServiceContext, campaignId: string) {
  const campaign = await campaignOf(ctx.db, ctx, campaignId)
  const { items } = await listCampaignDonations(ctx.db, ctx.institutionId, campaignId)
  const csv = donationsCsv(campaign, items.map(donationView))
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.donation_export',
    entityType: CAMPAIGN,
    entityId: campaignId,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
  return csv
}

/**
 * Makbuz verisi: bağışçının tam kimlik numarası ve kopyalanmış vergi ibaresiyle. Tam numara yalnız
 * burada döner; okuma denetime yazılır (`finance.donation_receipt`, K-298).
 */
export async function donationReceiptFor(ctx: ServiceContext, donationId: string) {
  const donation = await findDonation(ctx.db, ctx.institutionId, donationId)
  if (donation === null) throw new NotFoundError()
  const campaign = await campaignOf(ctx.db, ctx, donation.campaignId)
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.donation_receipt',
    entityType: DONATION,
    entityId: donationId,
    changes: { fields: donation.donorIdentityNumber === null ? [] : ['donorIdentityNumber'] },
    createdAt: ctx.now,
  })
  return {
    ...donationView(donation),
    identityNumber: donation.donorIdentityNumber,
    taxNotice: donation.taxNotice,
    campaign: { id: campaign.id, name: campaign.name, purpose: campaign.purpose },
  }
}

const donorIdOf = (input: unknown): string | null => {
  if (typeof input !== 'object' || input === null) return null
  const value = (input as { donorId?: unknown }).donorId
  return typeof value === 'string' ? value : null
}

/**
 * Bağış ve makbuzu; para kaydıdır, `Idempotency-Key` rotada zorunludur. Makbuz numarası kurum
 * kilidi altında yılın sıradaki numarasıdır (K-297). 201.
 */
export function recordDonationCommand(
  ctx: ServiceContext,
  campaignId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: DONATION, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'donation.record',
      collections: [],
      entity,
      load: async (tx) => {
        const campaign = await campaignOf(tx, ctx, campaignId)
        // Geçersiz gövde yüklemeden önce 400 olur; plan aynı şemayla yeniden doğrular.
        donationSchema.parse(input)
        const donorId = donorIdOf(input)
        const donor = donorId === null ? null : await findDonor(tx, ctx.institutionId, donorId)
        if (donorId !== null && donor === null) throw new NotFoundError()
        const [accounts, settings] = await Promise.all([
          activeBankAccountIds(tx, ctx.institutionId),
          loadDonationSettings(tx, ctx.institutionId),
        ])
        return {
          run: () =>
            planDonation(campaign, donor, { accounts, settings, today: dayKey(ctx.now) }, input),
        }
      },
      after: async (tx, plan) => {
        await insertDonation(tx, ctx.institutionId, {
          id,
          campaignId,
          plan,
          receiptYear: Number(dayKey(ctx.now).slice(0, 4)),
          recordedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'donation.record',
          entity,
          Object.entries(plan)
            .filter(([, value]) => value !== null)
            .map(([key]) => key),
        )
        const saved = await findDonation(tx, ctx.institutionId, id)
        if (saved === null) throw new Error('donation was not written')
        body = { data: donationView(saved) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Bağış iptali: makbuz geçersizleşir, numara boşa çıkmaz; gerekçe yalnız tabloda (K-297). */
export function cancelDonationCommand(
  ctx: ServiceContext,
  donationId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: DONATION, id: donationId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'donation.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const donation = await findDonation(tx, ctx.institutionId, donationId)
        if (donation === null) throw new NotFoundError()
        if (donation.version !== expectedVersion) throw new ConflictError()
        return { run: () => planDonationCancel(donation, input) }
      },
      after: async (tx, plan) => {
        const saved = await cancelDonation(tx, ctx.institutionId, {
          id: donationId,
          expectedVersion,
          userId: ctx.actor.userId,
          reason: plan.reason,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'donation.cancel', entity, ['cancelledAt', 'cancelReason'])
        const row = await findDonation(tx, ctx.institutionId, donationId)
        if (row === null) throw new NotFoundError()
        body = { data: donationView(row) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Ayar ----------------------------------------------------------------------------------------

export const donationSettingsFor = (ctx: ServiceContext) =>
  loadDonationSettings(ctx.db, ctx.institutionId)

/** Vergi indirimi ibaresi ayarı (K-299); kesilmiş makbuzlar değişmez. */
export function setDonationSettingsCommand(
  ctx: ServiceContext,
  body: DonationSettingsInput & { taxNoticeText: string | null },
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SETTINGS, id: ctx.institutionId }
  let result: unknown
  return runCommand(
    ctx,
    {
      action: 'donation.settings',
      collections: [],
      entity,
      load: async (tx) => {
        const row = await loadDonationSettings(tx, ctx.institutionId)
        if (row.version !== expectedVersion) throw new ConflictError()
        return { run: () => body }
      },
      after: async (tx, input) => {
        const saved = await saveDonationSettings(tx, ctx.institutionId, {
          taxNoticeEnabled: input.taxNoticeEnabled,
          taxNoticeText: input.taxNoticeText,
          expectedVersion,
          now: ctx.now,
        })
        if (saved === null) throw new ConflictError()
        await auditWork(tx, ctx, 'donation.settings', entity, ['taxNoticeEnabled', 'taxNoticeText'])
        result = { data: saved }
      },
    },
    () => ({ statusCode: 200, body: result }),
    idempotency,
  )
}
