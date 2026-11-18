import { randomUUID } from 'node:crypto'

import {
  effectiveLeaveTypes,
  leaveEntitlement,
  leaveProfileSchema,
  leaveProfileUpdateSchema,
  leaveRecordCancelSchema,
  leaveRecordSchema,
  leaveTypeCreateSchema,
  leaveTypeUpdateSchema,
  planLeaveProfile,
  planLeaveProfileUpdate,
  planLeaveRecord,
  planLeaveTypeCreate,
  planLeaveTypeUpdate,
  seniorityStartOf,
  type LeaveType,
} from '@kampus/school-core/lib/finance-staff-leave.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { isStaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from '../db/client.ts'
import { findStaffMember, listStaffMembers, type StaffQuery } from '../db/finance-pay-rates.ts'
import {
  cancelLeaveRecord,
  deactivationTimes,
  findLeaveProfile,
  findLeaveRecord,
  firstAnnualLeaveDate,
  insertLeaveProfile,
  insertLeaveRecord,
  insertLeaveType,
  loadLeaveProfiles,
  loadLeaveRecords,
  loadStoredLeaveTypes,
  updateLeaveProfile,
  updateLeaveType,
  type StoredLeaveProfile,
  type StoredLeaveRecord,
} from '../db/finance-staff-leave.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Personel izin türleri, profili ve kullanılmış izin (DOM-FIN-109; ON-181). Kural core
 * `lib/finance-staff-leave.ts`'tedir; servis kurum kilidi altında yükler ve aynı transaction'da
 * yazar. Denetim kaydına alan adları yazılır; doğum günü, not ve gerekçe değeri yazılmaz. Rol ve
 * modül denetimi rotadadır (yalnız yönetici).
 */

const TYPE_ENTITY = 'staff_leave_types'
const PROFILE_ENTITY = 'staff_leave_profiles'
const RECORD_ENTITY = 'staff_leave_records'

/** Kurumda geçerli türler (varsayılan + kurum ayarı + ek türler). */
async function typesOf(db: Database, institutionId: string): Promise<LeaveType[]> {
  return effectiveLeaveTypes(await loadStoredLeaveTypes(db, institutionId))
}

/** Yanıt görünümü: kilit listesi yanıt şemasına kopyalanır. */
const typeView = (type: LeaveType) => ({ ...type, locked: [...type.locked] })

export async function listLeaveTypesFor(ctx: ServiceContext) {
  return (await typesOf(ctx.db, ctx.institutionId)).map(typeView)
}

const profileView = (profile: StoredLeaveProfile) => ({
  seniorityStartDate: profile.seniorityStartDate,
  birthDate: profile.birthDate,
  openingBalance: profile.openingBalance,
  version: profile.version,
})

/** Hizmetin bittiği gün: pasifleştirilme günü (Europe/Istanbul); etkin personelde `null`. */
const endDayOf = (ends: Map<string, Date>, membershipId: string) => {
  const end = ends.get(membershipId)
  return end === undefined ? null : dayKey(end)
}

/**
 * Personel listesi ve `day` günündeki yıllık izin özeti: kıdem başlangıcı, hizmet yılı, son ve
 * sonraki hak ediş, hak edilen, kullanılan, devreden ve kalan. Profili olmayan personelde özet boş.
 */
export async function listLeaveStaffFor(
  ctx: ServiceContext,
  query: StaffQuery & { day?: string | undefined },
) {
  const day = query.day ?? dayKey(ctx.now)
  return ctx.db.transaction(async (tx) => {
    const { items, total } = await listStaffMembers(tx, ctx.institutionId, query)
    const ids = items.map((item) => item.membershipId)
    const [profiles, records, ends] = await Promise.all([
      loadLeaveProfiles(tx, ctx.institutionId, ids),
      loadLeaveRecords(tx, ctx.institutionId, ids),
      deactivationTimes(tx, ctx.institutionId, ids),
    ])
    const profileOf = new Map(profiles.map((profile) => [profile.membershipId, profile]))
    const recordsOf = new Map<string, StoredLeaveRecord[]>()
    for (const record of records)
      recordsOf.set(record.membershipId, [...(recordsOf.get(record.membershipId) ?? []), record])
    const rows = items.map((member) => {
      const profile = profileOf.get(member.membershipId) ?? null
      const own = recordsOf.get(member.membershipId) ?? []
      if (profile === null)
        return { ...member, seniorityStartDate: null, summary: null, recordCount: own.length }
      const result = leaveEntitlement(profile, own, day, endDayOf(ends, member.membershipId))
      const latest = result.accruals.at(-1) ?? null
      return {
        ...member,
        seniorityStartDate: profile.seniorityStartDate,
        summary: {
          serviceYears: result.serviceYears,
          lastAccrualDate: latest?.date ?? null,
          annualDays: latest?.days ?? null,
          nextAccrualDate: result.next?.date ?? null,
          nextAccrualDays: result.next?.days ?? null,
          entitledDays: result.entitledDays,
          usedDays: result.usedDays,
          carriedOverDays: result.carriedOverDays,
          balanceDays: result.balanceDays,
          balanceAfterPlannedDays: result.balanceAfterPlannedDays,
        },
        recordCount: own.length,
      }
    })
    return { items: rows, total, day }
  })
}

/** Personel üyeliği: yoksa ya da personel değilse (öğrenci, veli) 404. */
async function staffOf(db: Database, ctx: ServiceContext, membershipId: string) {
  const member = await findStaffMember(db, ctx.institutionId, membershipId)
  if (member === null || !isStaffRole(member.role)) throw new NotFoundError()
  return member
}

/** Personelin izin profili, hak ediş dökümü (yıl yıl), bakiye ve kullanılmış izin kayıtları. */
export async function getLeaveStaffFor(
  ctx: ServiceContext,
  membershipId: string,
  day: string | undefined,
) {
  const on = day ?? dayKey(ctx.now)
  return ctx.db.transaction(async (tx) => {
    const member = await staffOf(tx, ctx, membershipId)
    const [profile, records, ends] = await Promise.all([
      findLeaveProfile(tx, ctx.institutionId, membershipId),
      loadLeaveRecords(tx, ctx.institutionId, [membershipId]),
      deactivationTimes(tx, ctx.institutionId, [membershipId]),
    ])
    return {
      ...member,
      date: on,
      employmentEndDate: endDayOf(ends, membershipId),
      profile: profile === null ? null : profileView(profile),
      entitlement:
        profile === null
          ? null
          : leaveEntitlement(profile, records, on, endDayOf(ends, membershipId)),
      records,
    }
  })
}

/**
 * Kıdem başlangıcı ortak kaynağı (öneri; ON-175 personel belgesi, ON-341 kıdem hesaplayıcısı):
 * personelin izin profilindeki kıdem başlangıcı ya da `null`. Yalnız okur; denetim yazmaz.
 */
export async function seniorityStartFor(
  ctx: Pick<ServiceContext, 'db' | 'institutionId'>,
  membershipId: string,
): Promise<string | null> {
  return seniorityStartOf(await findLeaveProfile(ctx.db, ctx.institutionId, membershipId))
}

// --- Tür ayarı -----------------------------------------------------------------------------------

/** Kurumun ek türü (K-361). 201. */
export function createLeaveTypeCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const code = `custom_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const entity = { type: TYPE_ENTITY, id: code }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_leave_type.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = leaveTypeCreateSchema.parse(input)
        const types = await typesOf(tx, ctx.institutionId)
        return {
          run: () => {
            planLeaveTypeCreate(parsed, types)
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        await insertLeaveType(tx, ctx.institutionId, {
          code,
          ...parsed,
          isActive: true,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.staff_leave_type.create', entity, Object.keys(parsed))
        body = { data: await typeBody(tx, ctx, code) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function typeBody(tx: Database, ctx: ServiceContext, code: string) {
  const type = (await typesOf(tx, ctx.institutionId)).find((item) => item.code === code)
  if (type === undefined) throw new NotFoundError()
  return typeView(type)
}

/**
 * Tür ayarı (K-361). Varsayılan türün ilk ayarı `If-Match: "1"` ile 2 sürümlü satır açar;
 * sonrakiler satırın sürümünü ister. Kilitli alan, yasal gün ve tekil ad core'da denetlenir.
 */
export function updateLeaveTypeCommand(
  ctx: ServiceContext,
  code: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TYPE_ENTITY, id: code }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_leave_type.update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = leaveTypeUpdateSchema.parse(input)
        const stored = await loadStoredLeaveTypes(tx, ctx.institutionId)
        const types = effectiveLeaveTypes(stored)
        const type = types.find((item) => item.code === code)
        if (type === undefined) throw new NotFoundError()
        if (type.version !== expectedVersion) throw new ConflictError()
        const saved = stored.some((row) => row.code === code)
        return {
          run: () => ({ parsed, saved, next: planLeaveTypeUpdate(type, parsed, types) }),
        }
      },
      after: async (tx, { parsed, saved, next }) => {
        const write = { ...next, userId: ctx.actor.userId, now: ctx.now }
        if (!saved)
          await insertLeaveType(tx, ctx.institutionId, { ...write, version: expectedVersion + 1 })
        else if (!(await updateLeaveType(tx, ctx.institutionId, { ...write, expectedVersion })))
          throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.staff_leave_type.update',
          entity,
          Object.keys(parsed).filter((key) => parsed[key as keyof typeof parsed] !== undefined),
        )
        body = { data: await typeBody(tx, ctx, code) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Profil --------------------------------------------------------------------------------------

async function profileBody(tx: Database, ctx: ServiceContext, membershipId: string) {
  const profile = await findLeaveProfile(tx, ctx.institutionId, membershipId)
  if (profile === null) throw new NotFoundError()
  return { membershipId, ...profileView(profile) }
}

/** Denetim kaydına yalnız alan adları (doğum günü değeri yazılmaz). */
const profileFields = (input: Record<string, unknown>) =>
  Object.keys(input).filter((key) => key !== 'membershipId' && input[key] !== undefined)

/** İzin profili açma (K-360). 201. */
export function createLeaveProfileCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let body: unknown
  const target = leaveProfileSchema.safeParse(input).data?.membershipId ?? 'unknown'
  return runCommand(
    ctx,
    {
      action: 'finance.staff_leave_profile.create',
      collections: [],
      entity: { type: PROFILE_ENTITY, id: target },
      load: async (tx) => {
        const parsed = leaveProfileSchema.parse(input)
        const staff = await findStaffMember(tx, ctx.institutionId, parsed.membershipId)
        const exists = (await findLeaveProfile(tx, ctx.institutionId, parsed.membershipId)) !== null
        return {
          run: () => ({
            parsed,
            profile: planLeaveProfile(parsed, { staff, exists, today: dayKey(ctx.now) }),
          }),
        }
      },
      after: async (tx, { parsed, profile }) => {
        await insertLeaveProfile(tx, ctx.institutionId, {
          membershipId: parsed.membershipId,
          profile,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'finance.staff_leave_profile.create',
          { type: PROFILE_ENTITY, id: parsed.membershipId },
          profileFields(parsed),
        )
        body = { data: await profileBody(tx, ctx, parsed.membershipId) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** İzin profili düzeltmesi (K-360); `If-Match` profil sürümü. */
export function updateLeaveProfileCommand(
  ctx: ServiceContext,
  membershipId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PROFILE_ENTITY, id: membershipId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_leave_profile.update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = leaveProfileUpdateSchema.parse(input)
        const member = await staffOf(tx, ctx, membershipId)
        const current = await findLeaveProfile(tx, ctx.institutionId, membershipId)
        if (current === null) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        const firstAnnualRecord = await firstAnnualLeaveDate(tx, ctx.institutionId, membershipId)
        return {
          run: () => ({
            parsed,
            profile: planLeaveProfileUpdate(current, parsed, {
              staff: member,
              today: dayKey(ctx.now),
              firstAnnualRecord,
            }),
          }),
        }
      },
      after: async (tx, { parsed, profile }) => {
        const saved = await updateLeaveProfile(tx, ctx.institutionId, {
          membershipId,
          profile,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.staff_leave_profile.update',
          entity,
          profileFields(parsed),
        )
        body = { data: await profileBody(tx, ctx, membershipId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Kullanılmış izin ----------------------------------------------------------------------------

async function recordBody(tx: Database, ctx: ServiceContext, id: string) {
  const record = await findLeaveRecord(tx, ctx.institutionId, id)
  if (record === null) throw new NotFoundError()
  return record
}

/** Kullanılmış izin kaydı (K-362). `Idempotency-Key` zorunlu. 201. */
export function createLeaveRecordCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: RECORD_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_leave_record.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = leaveRecordSchema.parse(input)
        const staff = await findStaffMember(tx, ctx.institutionId, parsed.membershipId)
        const types = await typesOf(tx, ctx.institutionId)
        const profile = await findLeaveProfile(tx, ctx.institutionId, parsed.membershipId)
        const records = await loadLeaveRecords(tx, ctx.institutionId, [parsed.membershipId])
        const type = types.find((item) => item.code === parsed.typeCode) ?? null
        return {
          run: () => ({
            parsed,
            snapshot: planLeaveRecord(parsed, { staff, type, profile, records }),
          }),
        }
      },
      after: async (tx, { parsed, snapshot }) => {
        await insertLeaveRecord(tx, ctx.institutionId, {
          id,
          ...parsed,
          ...snapshot,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'finance.staff_leave_record.create',
          entity,
          Object.keys(parsed).filter((key) => parsed[key as keyof typeof parsed] !== null),
        )
        body = { data: await recordBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Kaydı gerekçeyle iptal (K-362); `If-Match` kayıt sürümü. */
export function cancelLeaveRecordCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: RECORD_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_leave_record.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = leaveRecordCancelSchema.parse(input)
        const record = await findLeaveRecord(tx, ctx.institutionId, id)
        if (record === null) throw new NotFoundError()
        if (record.version !== expectedVersion) throw new ConflictError()
        return { run: () => parsed }
      },
      after: async (tx, parsed) => {
        const saved = await cancelLeaveRecord(tx, ctx.institutionId, {
          id,
          expectedVersion,
          reason: parsed.reason,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staff_leave_record.cancel', entity, [
          'archivedAt',
          'cancelReason',
        ])
        body = { data: { id } }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
