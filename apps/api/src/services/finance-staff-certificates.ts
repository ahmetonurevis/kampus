import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { WAGE_TYPES, wageOn, type WageType } from '@kampus/school-core/lib/finance-pay-rates.ts'
import {
  planStaffCertificate,
  planStaffCertificateCancel,
  staffCertificateInputSchema,
} from '@kampus/school-core/lib/finance-staff-certificates.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { isStaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from '../db/client.ts'
import { loadStaffPayRates } from '../db/finance-pay-rates.ts'
import {
  cancelStaffCertificate,
  findCertificateStaff,
  findStaffCertificate,
  findUserName,
  insertStaffCertificate,
  lastCertificateFacts,
  listCertificateStaff,
  listStaffCertificates,
  type StaffCertificateQuery,
  type StoredStaffCertificate,
} from '../db/finance-staff-certificates.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { institutions } from '../db/schema/auth.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Personel çalışma ve hizmet belgesi (DOM-FIN-106; ON-175). Kural core
 * `lib/finance-staff-certificates.ts`'tedir; servis kurum kilidi altında üyeliği, düzenleme günündeki
 * ana ücreti (DOM-FIN-099) ve kurum adını yükler, içeriği dondurarak tek transaction'da yazar
 * (K-341). T.C. kimlik no ve ücret yalnız belge ucunda döner; her belge okuması aynı transaction'da
 * `finance.staff_certificate.read` denetimine düşer (K-343). Rol ve modül denetimi rotadadır.
 */

const ENTITY = 'staff_certificates'
const READ_ACTION = 'finance.staff_certificate.read'

/** Liste görünümü: T.C. kimlik no ve ücret tutarı yoktur (K-343). */
export function staffCertificateView(certificate: StoredStaffCertificate) {
  return {
    id: certificate.id,
    membershipId: certificate.membershipId,
    kind: certificate.kind,
    certificateYear: certificate.certificateYear,
    certificateNumber: certificate.certificateNumber,
    staffName: certificate.staffName,
    position: certificate.position,
    hireDate: certificate.hireDate,
    exitDate: certificate.exitDate,
    addressee: certificate.addressee,
    includesWage: certificate.wageAmountCents !== null,
    hasIdentityNumber: certificate.identityNumber !== null,
    issuedByName: certificate.issuedByName,
    createdAt: certificate.createdAt,
    cancelledAt: certificate.cancelledAt,
    cancelReason: certificate.cancelReason,
    version: certificate.version,
  }
}

export async function listStaffCertificatesFor(ctx: ServiceContext, query: StaffCertificateQuery) {
  const { items, total } = await listStaffCertificates(ctx.db, ctx.institutionId, query)
  return { items: items.map(staffCertificateView), total }
}

/**
 * Belge formunun personel seçimi: ad, rol, etkin mi, ayrılış günü önerisi (pasifleştirme günü,
 * Europe/Istanbul) ve son belgedeki görev ile işe giriş günü (K-340).
 */
export async function listCertificateStaffFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined },
) {
  const { items, total } = await listCertificateStaff(ctx.db, ctx.institutionId, query)
  const facts = await lastCertificateFacts(
    ctx.db,
    ctx.institutionId,
    items.map((item) => item.membershipId),
  )
  return {
    items: items.map(({ deactivatedAt, ...member }) => ({
      ...member,
      leftDate: deactivatedAt === null ? null : dayKey(new Date(deactivatedAt)),
      lastPosition: facts.get(member.membershipId)?.position ?? null,
      lastHireDate: facts.get(member.membershipId)?.hireDate ?? null,
    })),
    total,
  }
}

/**
 * Belge içeriği (PDF verisi): dondurulmuş alanların tamamı, T.C. kimlik no ve ücret dahil. Okuma
 * aynı transaction'da denetime yazılır (alan adları; K-343); denetim yazılamazsa yanıt dönmez.
 */
export async function staffCertificateDocumentFor(ctx: ServiceContext, id: string) {
  return ctx.db.transaction(async (tx) => {
    const certificate = await findStaffCertificate(tx, ctx.institutionId, id)
    if (certificate === null) throw new NotFoundError()
    await tx.insert(auditLog).values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: READ_ACTION,
      entityType: ENTITY,
      entityId: id,
      // kvkk: değer değil, dönen kişisel alanların adı.
      changes: {
        fields: [
          'staffName',
          ...(certificate.identityNumber === null ? [] : ['identityNumber']),
          ...(certificate.wageAmountCents === null ? [] : ['wageAmountCents']),
        ],
      },
      createdAt: ctx.now,
    })
    return {
      ...staffCertificateView(certificate),
      institutionName: certificate.institutionName,
      identityNumber: certificate.identityNumber,
      wageRateType: certificate.wageRateType,
      wageAmountCents: certificate.wageAmountCents,
      currency: 'TRY' as const,
    }
  })
}

const isWageType = (value: string): value is WageType =>
  (WAGE_TYPES as readonly string[]).includes(value)

/** Düzenleme günündeki ana ücret (DOM-FIN-099); yoksa `null`. */
async function wageToday(tx: Database, ctx: ServiceContext, membershipId: string) {
  const rates = await loadStaffPayRates(tx, ctx.institutionId, [membershipId])
  const wage = wageOn(rates, dayKey(ctx.now))
  return wage === null || !isWageType(wage.rateType)
    ? null
    : { rateType: wage.rateType, amountCents: wage.amountCents }
}

async function institutionNameOf(tx: Database, institutionId: string): Promise<string> {
  const [row] = await tx
    .select({ name: institutions.name })
    .from(institutions)
    .where(eq(institutions.id, institutionId))
    .limit(1)
  if (row === undefined) throw new NotFoundError()
  return row.name
}

async function certificateBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findStaffCertificate(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('staff certificate was not written')
  return staffCertificateView(saved)
}

/**
 * Yeni belge (K-340…K-342). Numara kurum kilidi altında yılın sıradaki numarasıdır; içerik (kurum
 * adı, personel adı, ücret, düzenleyen) bu anda kopyalanır. `Idempotency-Key` rotada zorunludur:
 * çift gönderim ikinci numara kesmez. 201.
 */
export function createStaffCertificateCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_certificate.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = staffCertificateInputSchema.parse(input)
        const { membershipId } = parsed
        const member = await findCertificateStaff(tx, ctx.institutionId, membershipId)
        const wage =
          member !== null && isStaffRole(member.role)
            ? await wageToday(tx, ctx, membershipId)
            : null
        const [institutionName, issuedByName] = await Promise.all([
          institutionNameOf(tx, ctx.institutionId),
          findUserName(tx, ctx.actor.userId),
        ])
        return {
          run: () => ({
            membershipId,
            content: planStaffCertificate(parsed, { staff: member, wage, today: dayKey(ctx.now) }),
            institutionName,
            issuedByName: issuedByName ?? '—',
          }),
        }
      },
      after: async (tx, plan) => {
        await insertStaffCertificate(tx, ctx.institutionId, {
          id,
          membershipId: plan.membershipId,
          content: plan.content,
          certificateYear: Number(dayKey(ctx.now).slice(0, 4)),
          institutionName: plan.institutionName,
          issuedByUserId: ctx.actor.userId,
          issuedByName: plan.issuedByName,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'finance.staff_certificate.create',
          entity,
          Object.entries(plan.content)
            .filter(([, value]) => value !== null)
            .map(([key]) => key),
        )
        body = { data: await certificateBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** İptal (K-341): gerekçeyle; belge silinmez, numara yeniden kullanılmaz. Gerekçe denetime yazılmaz. */
export function cancelStaffCertificateCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_certificate.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const certificate = await findStaffCertificate(tx, ctx.institutionId, id)
        if (certificate === null) throw new NotFoundError()
        if (certificate.version !== expectedVersion) throw new ConflictError()
        return { run: () => planStaffCertificateCancel(certificate, input) }
      },
      after: async (tx, parsed) => {
        const saved = await cancelStaffCertificate(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          reason: parsed.reason,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staff_certificate.cancel', entity, [
          'cancelledAt',
          'cancelReason',
        ])
        body = { data: await certificateBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
