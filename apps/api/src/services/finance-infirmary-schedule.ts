import { randomUUID } from 'node:crypto'

import {
  administrationHealthSchema,
  medicationScheduleSlots,
} from '@kampus/school-core/lib/finance-infirmary.ts'
import {
  administrationCorrectionSchema,
  correctionHealthSchema,
  doseSlotKey,
  doseState,
  effectiveAdministration,
  effectiveSkip,
  guardianDoseRange,
  istanbulInstant,
  medicationDoseSkipSchema,
  medicationSettingsSchema,
  planAdministrationCorrection,
  planDoseSkip,
  planMedicationSettings,
  planSkipCorrection,
  resolveDoseSlots,
  skipCorrectionSchema,
  skipHealthSchema,
  sortDoseChart,
  voidedRecordIds,
  type CorrectionHealth,
  type DoseCorrectionKind,
  type DoseCorrectionRef,
  type DoseRecordKind,
  type DoseSkipReason,
  type DoseSlotState,
  type DoseState,
} from '@kampus/school-core/lib/finance-infirmary-schedule.ts'

import type { HealthAccessReason } from '@kampus/school-core/lib/finance-health-access.ts'

import type { Database } from '../db/client.ts'
import { loadIncidentMembers } from '../db/finance-incidents.ts'
import { findConsent, listApprovedConsentsOn, type StoredConsent } from '../db/finance-infirmary.ts'
import {
  findDoseAdministration,
  findSkip,
  insertCorrection,
  insertSkip,
  loadCorrections,
  loadDoseAdministrations,
  loadMedicationSettings,
  loadSkips,
  memberUserNames,
  saveMedicationSettings,
  type DoseRecordFilter,
  type StoredCorrection,
  type StoredDoseAdministration,
  type StoredSkip,
} from '../db/finance-infirmary-schedule.ts'
import { loadRecords, loadRecordsByIds } from '../db/records.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { FieldBinding } from '../lib/field-crypto.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { administrationBinding, consentHealthOf, type InfirmaryDeps } from './finance-infirmary.ts'
import { recordHealthRead } from './finance-health-access.ts'
import { loadDoseSlots } from './finance-infirmary-schedule-slots.ts'
import { istanbulDayStart } from './list-filters.ts'
import { getInstitutionModules } from './modules.ts'
import {
  mapOperationError,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { readScope } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Günlük ilaç çizelgesi, atlama, düzeltme ve velinin doz geçmişi (DOM-FIN-152; ON-161; K-511…K-513).
 * Onay ve uygulama ON-101'dedir (`finance-infirmary.ts`); burada aynı talep ve uygulama satırları
 * okunur. Kural core `lib/finance-infirmary-schedule.ts`'tedir; servis kurum kilidi altında doz
 * saatinin kayıtlarını yükler, atlama gerekçesini ve düzeltme gerekçesini alan anahtarıyla şifreleyip
 * çözer ve tek transaction'da yazar. Sağlık ayrıntısı dönen her okuma aynı transaction'da denetime
 * alan adlarıyla düşer. Yoklama (Oğuzhan'ın `attendance` koleksiyonu) yalnız okunur; `academic`
 * modülü kapalıysa ya da o gün yoklama yoksa işaret boştur. Bildirim gönderilmez.
 */

const CONSENTS = 'infirmary_medication_consents'
const ADMINISTRATIONS = 'infirmary_medication_administrations'
const SKIPS = 'infirmary_medication_skips'
const CORRECTIONS = 'infirmary_medication_dose_corrections'
const SETTINGS = 'infirmary_medication_settings'

// --- Şifreleme -----------------------------------------------------------------------------------

const skipBinding = (
  institutionId: string,
  row: { id: string; consentId: string },
): FieldBinding => ({
  institutionId,
  table: SKIPS,
  column: 'health',
  rowKey: row.id,
  context: [row.consentId],
})

const correctionBinding = (
  institutionId: string,
  row: { id: string; targetId: string },
): FieldBinding => ({
  institutionId,
  table: CORRECTIONS,
  column: 'health',
  rowKey: row.id,
  context: [row.targetId],
})

function skipHealthOf(deps: InfirmaryDeps, institutionId: string, row: StoredSkip) {
  return skipHealthSchema.parse(
    JSON.parse(
      deps.cipher.decrypt(skipBinding(institutionId, row), {
        ciphertext: row.healthCiphertext,
        keyVersion: row.healthKeyVersion,
      }),
    ),
  )
}

function administrationHealthOf(
  deps: InfirmaryDeps,
  institutionId: string,
  row: StoredDoseAdministration,
) {
  return administrationHealthSchema.parse(
    JSON.parse(
      deps.cipher.decrypt(administrationBinding(institutionId, row), {
        ciphertext: row.healthCiphertext,
        keyVersion: row.healthKeyVersion,
      }),
    ),
  )
}

function correctionRefOf(
  deps: InfirmaryDeps,
  institutionId: string,
  row: StoredCorrection,
): DoseCorrectionRef & { correctedByUserId: string } {
  return {
    id: row.id,
    targetKind: row.targetKind,
    targetId: row.targetId,
    kind: row.kind,
    administeredAt: row.administeredAt,
    administeredByMembershipId: row.administeredByMembershipId,
    correctedByUserId: row.correctedByUserId,
    createdAt: row.createdAt,
    health: correctionHealthSchema.parse(
      JSON.parse(
        deps.cipher.decrypt(correctionBinding(institutionId, row), {
          ciphertext: row.healthCiphertext,
          keyVersion: row.healthKeyVersion,
        }),
      ),
    ),
  }
}

// --- Kayıt görünümü ------------------------------------------------------------------------------

export interface DoseCorrectionView {
  id: string
  kind: DoseCorrectionKind
  reason: string
  correctedByName: string | null
  createdAt: string
}

export interface DoseRecordView {
  kind: DoseRecordKind
  id: string
  consentId: string
  studentId: string
  doseDay: string
  scheduledTime: string
  voided: boolean
  corrected: boolean
  administeredAt: string | null
  administeredByMembershipId: string | null
  administeredByName: string | null
  dose: string | null
  skipReason: DoseSkipReason | null
  note: string | null
  recordedByName: string | null
  createdAt: string
  corrections: DoseCorrectionView[]
}

/**
 * Kayıtların etkin görünümü (K-513): düzeltmeler sırayla uygulanır, iptal edilen kayıt `voided`
 * döner; doz saatlerinin etkin sonucu da hesaplanır.
 */
async function doseRecordViews(
  db: Database,
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  administrations: readonly StoredDoseAdministration[],
  skips: readonly StoredSkip[],
): Promise<{ views: DoseRecordView[]; slots: Map<string, DoseSlotState> }> {
  const corrections = (
    await loadCorrections(db, ctx.institutionId, {
      administrationIds: administrations.map((row) => row.id),
      skipIds: skips.map((row) => row.id),
    })
  ).map((row) => correctionRefOf(deps, ctx.institutionId, row))
  const byTarget = new Map<string, typeof corrections>()
  for (const row of corrections)
    byTarget.set(row.targetId, [...(byTarget.get(row.targetId) ?? []), row])
  const [members, userNames] = await Promise.all([
    loadIncidentMembers(db, ctx.institutionId, [
      ...administrations.map((row) => row.administeredByMembershipId),
      ...corrections.flatMap((row) =>
        row.administeredByMembershipId === null ? [] : [row.administeredByMembershipId],
      ),
    ]),
    memberUserNames(db, ctx.institutionId, [
      ...administrations.map((row) => row.recordedByUserId),
      ...skips.map((row) => row.recordedByUserId),
      ...corrections.map((row) => row.correctedByUserId),
    ]),
  ])
  // Aynı anda yazılan kayıtlarda zincir sırası korunur: yerine geçen kayıt, yerine geçtiğinden sonra.
  const replaces = new Map(
    [...administrations, ...skips].map((row) => [row.id, row.replacesId] as const),
  )
  const depthOf = (id: string): number => {
    let depth = 0
    for (
      let current = replaces.get(id);
      current !== undefined && current !== null;
      current = replaces.get(current)
    )
      depth += 1
    return depth
  }
  const correctionViews = (rows: typeof corrections): DoseCorrectionView[] =>
    rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      reason: row.health.reason,
      correctedByName: userNames.get(row.correctedByUserId) ?? null,
      createdAt: row.createdAt,
    }))
  const views: DoseRecordView[] = [
    ...administrations.map((row) => {
      const own = byTarget.get(row.id) ?? []
      const health = administrationHealthOf(deps, ctx.institutionId, row)
      const value = effectiveAdministration(
        {
          administeredAt: row.administeredAt,
          administeredByMembershipId: row.administeredByMembershipId,
          note: health.note,
        },
        own,
      )
      return {
        kind: 'administration' as const,
        id: row.id,
        consentId: row.consentId,
        studentId: row.studentId,
        doseDay: row.doseDay,
        scheduledTime: row.scheduledTime,
        voided: value.voided,
        corrected: value.corrected,
        administeredAt: value.administeredAt,
        administeredByMembershipId: value.administeredByMembershipId,
        administeredByName: members.get(value.administeredByMembershipId)?.name ?? null,
        dose: health.dose,
        skipReason: null,
        note: value.note,
        recordedByName: userNames.get(row.recordedByUserId) ?? null,
        createdAt: row.createdAt,
        corrections: correctionViews(own),
      }
    }),
    ...skips.map((row) => {
      const own = byTarget.get(row.id) ?? []
      const value = effectiveSkip(skipHealthOf(deps, ctx.institutionId, row), own)
      return {
        kind: 'skip' as const,
        id: row.id,
        consentId: row.consentId,
        studentId: row.studentId,
        doseDay: row.doseDay,
        scheduledTime: row.scheduledTime,
        voided: value.voided,
        corrected: value.corrected,
        administeredAt: null,
        administeredByMembershipId: null,
        administeredByName: null,
        dose: null,
        skipReason: value.reason,
        note: value.note,
        recordedByName: userNames.get(row.recordedByUserId) ?? null,
        createdAt: row.createdAt,
        corrections: correctionViews(own),
      }
    }),
  ].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      depthOf(a.id) - depthOf(b.id) ||
      a.id.localeCompare(b.id),
  )
  const slots = resolveDoseSlots(
    [
      ...administrations.map((row) => ({ kind: 'administration' as const, ...row })),
      ...skips.map((row) => ({ kind: 'skip' as const, ...row })),
    ],
    voidedRecordIds(corrections),
  )
  return { views, slots }
}

async function loadRecordViews(
  db: Database,
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  filter: DoseRecordFilter,
) {
  const [administrations, skips] = await Promise.all([
    loadDoseAdministrations(db, ctx.institutionId, filter),
    loadSkips(db, ctx.institutionId, filter),
  ])
  return doseRecordViews(db, ctx, deps, administrations, skips)
}

async function studentNames(db: Database, ctx: ServiceContext, ids: readonly string[]) {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map<string, string | null>()
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'students', unique, {
    includeArchived: true,
  })
  return new Map(
    rows.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : null]),
  )
}

const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)

/**
 * O günün yoklaması (yalnız okunur): öğrenci yok ya da izinliyse `true`, geldiyse ya da geç
 * kaldıysa `false`; yoklama alınmadıysa ya da `academic` modülü kapalıysa kayıt yok (`null`).
 */
async function absencesOn(
  db: Database,
  ctx: ServiceContext,
  day: string,
  studentIds: readonly string[],
): Promise<Map<string, boolean>> {
  const absent = new Map<string, boolean>()
  const ids = [...new Set(studentIds)]
  if (ids.length === 0) return absent
  const modules = await getInstitutionModules(db, ctx.institutionId)
  if (modules?.modules.academic !== true) return absent
  const rows = await loadRecords(db, ctx.institutionId, ['attendance'], {
    match: [
      { kind: 'equals', field: 'studentId', values: ids },
      {
        kind: 'dayRange',
        field: 'date',
        fromDay: day,
        toDay: day,
        fromInstant: istanbulDayStart(day),
        toInstant: istanbulDayStart(nextDay(day)),
      },
    ],
  })
  for (const row of rows) {
    const studentId = row.data.studentId
    const status = row.data.status
    if (typeof studentId !== 'string' || typeof status !== 'string') continue
    const isAbsent = status === 'absent' || status === 'excused'
    absent.set(studentId, (absent.get(studentId) ?? false) || isAbsent)
  }
  return absent
}

// --- Çizelge -------------------------------------------------------------------------------------

export interface DoseChartItem {
  consentId: string
  consentVersion: number
  studentId: string
  studentName: string | null
  medicationName: string
  dose: string
  scheduledTime: string
  dueAt: string
  state: DoseState
  absent: boolean | null
  records: DoseRecordView[]
}

/**
 * Günlük ilaç çizelgesi (K-511): günü kapsayan onaylı taleplerin her doz saati; durum etkin
 * kayıttan ve gecikme payından türetilir, geciken dozlar üstte. Her talep
 * `finance.infirmary.chart_read` denetimine ve verildiyse gerekçesiyle sağlık erişim günlüğüne
 * düşer (DOM-FIN-156).
 */
export function getMedicationChartFor(
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  day: string,
  reason: HealthAccessReason | null,
) {
  return ctx.db.transaction(async (tx) => {
    const [consents, settings] = await Promise.all([
      listApprovedConsentsOn(tx, ctx.institutionId, day),
      loadMedicationSettings(tx, ctx.institutionId),
    ])
    const consentIds = consents.map((row) => row.id)
    const studentIds = consents.map((row) => row.studentId)
    const [{ views, slots }, names, absences] = await Promise.all([
      loadRecordViews(tx, ctx, deps, { consentIds, fromDay: day, toDay: day }),
      studentNames(tx, ctx, studentIds),
      absencesOn(tx, ctx, day, studentIds),
    ])
    const health = new Map(
      consents.map((row) => [row.id, consentHealthOf(deps, ctx.institutionId, row)]),
    )
    const items: DoseChartItem[] = medicationScheduleSlots(
      consents.map((row) => ({ ...row, times: row.doseTimes })),
      day,
    ).map(({ consent, scheduledTime }) => {
      const key = doseSlotKey(consent.id, day, scheduledTime)
      const dueAt = istanbulInstant(day, scheduledTime)
      const consentHealth = health.get(consent.id)
      return {
        consentId: consent.id,
        consentVersion: consent.version,
        studentId: consent.studentId,
        studentName: names.get(consent.studentId) ?? null,
        medicationName: consentHealth?.medicationName ?? '',
        dose: consentHealth?.dose ?? '',
        scheduledTime,
        dueAt,
        state: doseState(
          slots.get(key)?.active ?? null,
          dueAt,
          ctx.now,
          settings.lateToleranceMinutes,
        ),
        absent: absences.get(consent.studentId) ?? null,
        records: views.filter(
          (view) => doseSlotKey(view.consentId, view.doseDay, view.scheduledTime) === key,
        ),
      }
    })
    for (const row of consents)
      await recordHealthRead(tx, ctx, {
        action: 'finance.infirmary.chart_read',
        entity: { type: CONSENTS, id: row.id },
        fields: ['medicationName', 'dose', 'administrations', 'skips', 'corrections'],
        studentId: row.studentId,
        reason,
      })
    return {
      date: day,
      lateToleranceMinutes: settings.lateToleranceMinutes,
      items: sortDoseChart(items),
    }
  })
}

// --- Veli doz geçmişi ----------------------------------------------------------------------------

/** Velinin gördüğü sağlık alanları; okuma denetimine alan adları olarak yazılır. */
const GUARDIAN_DOSE_FIELDS = ['medicationName', 'dose', 'skipReason', 'note']

/**
 * Velinin doz geçmişi (K-512): kapsamındaki (velayetli ve kısıtsız bağ) çocuklarının uygulanan ve
 * atlanan dozları, gerekçe ve düzeltilmiş değerlerle; iptal edilen kayıt dönmez. En yeni gün önce.
 * Dönen her talep `finance.infirmary.guardian_dose_read` denetimine düşer.
 */
export async function listGuardianDosesFor(
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  query: {
    page: number
    pageSize: number
    studentId?: string | undefined
    from?: string | undefined
    to?: string | undefined
  },
) {
  let range: { from: string; to: string }
  try {
    range = guardianDoseRange(query, ctx.now)
  } catch (error) {
    throw mapOperationError(error)
  }
  const scope = await readScope(ctx)
  const children = [...scope.studentIds].filter(
    (id) => query.studentId === undefined || id === query.studentId,
  )
  return ctx.db.transaction(async (tx) => {
    const { views } = await loadRecordViews(tx, ctx, deps, {
      studentIds: children,
      fromDay: range.from,
      toDay: range.to,
    })
    const active = views
      .filter((view) => !view.voided)
      .sort(
        (a, b) =>
          b.doseDay.localeCompare(a.doseDay) ||
          b.scheduledTime.localeCompare(a.scheduledTime) ||
          a.id.localeCompare(b.id),
      )
    const page = active.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
    const consentIds = [...new Set(page.map((view) => view.consentId))]
    const consents = new Map<string, StoredConsent>()
    for (const id of consentIds) {
      const row = await findConsent(tx, ctx.institutionId, id)
      if (row !== null) consents.set(id, row)
    }
    const names = await studentNames(
      tx,
      ctx,
      page.map((view) => view.studentId),
    )
    const items = page.map((view) => {
      const consent = consents.get(view.consentId)
      return {
        id: view.id,
        kind: view.kind,
        consentId: view.consentId,
        studentId: view.studentId,
        studentName: names.get(view.studentId) ?? null,
        medicationName:
          consent === undefined
            ? null
            : consentHealthOf(deps, ctx.institutionId, consent).medicationName,
        doseDay: view.doseDay,
        scheduledTime: view.scheduledTime,
        administeredAt: view.administeredAt,
        administeredByName: view.administeredByName,
        dose: view.dose,
        skipReason: view.skipReason,
        note: view.note,
        corrected: view.corrected,
      }
    })
    for (const id of consentIds)
      await auditWork(
        tx,
        ctx,
        'finance.infirmary.guardian_dose_read',
        { type: CONSENTS, id },
        GUARDIAN_DOSE_FIELDS,
      )
    return { items, total: active.length }
  })
}

// --- Atlama --------------------------------------------------------------------------------------

async function recordView(
  tx: Database,
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  kind: DoseRecordKind,
  id: string,
): Promise<DoseRecordView> {
  const [administration, skip] = await Promise.all([
    kind === 'administration' ? findDoseAdministration(tx, ctx.institutionId, id) : null,
    kind === 'skip' ? findSkip(tx, ctx.institutionId, id) : null,
  ])
  const { views } = await doseRecordViews(
    tx,
    ctx,
    deps,
    administration === null ? [] : [administration],
    skip === null ? [] : [skip],
  )
  const [view] = views
  if (view === undefined) throw new NotFoundError()
  return view
}

/**
 * Atlama (K-512): onaylı talebin doz saati gerekçeyle atlanır; doz saatinin etkin sonucu varsa 409.
 * `Idempotency-Key` rotada zorunlu. 201.
 */
export function recordDoseSkipCommand(
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  consentId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: CONSENTS, id: consentId }
  const skipId = randomUUID()
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.infirmary.skip_create',
      collections: [],
      entity,
      load: async (tx) => {
        const row = await findConsent(tx, ctx.institutionId, consentId)
        if (row === null) throw new NotFoundError()
        const parsed = medicationDoseSkipSchema.parse(input)
        const slots = await loadDoseSlots(tx, ctx.institutionId, [consentId])
        return {
          run: () => ({
            row,
            parsed,
            plan: planDoseSkip(
              {
                status: row.status,
                startDate: row.startDate,
                endDate: row.endDate,
                times: row.doseTimes,
              },
              parsed,
              {
                now: ctx.now,
                slot: (day) => slots.get(doseSlotKey(consentId, day, parsed.scheduledTime)),
              },
            ),
          }),
        }
      },
      after: async (tx, { row, parsed, plan }) => {
        const health = deps.cipher.encrypt(
          skipBinding(ctx.institutionId, { id: skipId, consentId }),
          JSON.stringify(plan.health),
        )
        await insertSkip(tx, ctx.institutionId, {
          id: skipId,
          consentId,
          studentId: row.studentId,
          doseDay: plan.doseDay,
          scheduledTime: parsed.scheduledTime,
          replacesId: plan.replacesId,
          healthCiphertext: health.ciphertext,
          healthKeyVersion: health.keyVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.infirmary.skip_create', entity, [
          'scheduledTime',
          'doseDay',
          'reason',
          ...(plan.health.note === null ? [] : ['note']),
        ])
        body = { data: await recordView(tx, ctx, deps, 'skip', skipId) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

// --- Düzeltme ------------------------------------------------------------------------------------

async function correctionsOf(
  tx: Database,
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  kind: DoseRecordKind,
  id: string,
) {
  const rows = await loadCorrections(tx, ctx.institutionId, {
    administrationIds: kind === 'administration' ? [id] : [],
    skipIds: kind === 'skip' ? [id] : [],
  })
  return rows.map((row) => correctionRefOf(deps, ctx.institutionId, row))
}

async function writeCorrection(
  tx: Database,
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  input: {
    consentId: string
    targetKind: DoseRecordKind
    targetId: string
    kind: DoseCorrectionKind
    administeredAt: string | null
    administeredByMembershipId: string | null
    health: CorrectionHealth
    changed: string[]
  },
) {
  const id = randomUUID()
  const encrypted = deps.cipher.encrypt(
    correctionBinding(ctx.institutionId, { id, targetId: input.targetId }),
    JSON.stringify(input.health),
  )
  // İkinci iptali kısmi tekil indeks de reddeder (409 `conflict`); kilit altında core önce yakalar.
  await insertCorrection(tx, ctx.institutionId, {
    id,
    consentId: input.consentId,
    targetKind: input.targetKind,
    targetId: input.targetId,
    kind: input.kind,
    administeredAt: input.administeredAt,
    administeredByMembershipId: input.administeredByMembershipId,
    healthCiphertext: encrypted.ciphertext,
    healthKeyVersion: encrypted.keyVersion,
    userId: ctx.actor.userId,
    now: ctx.now,
  })
  await auditWork(
    tx,
    ctx,
    'finance.infirmary.correction_create',
    { type: input.targetKind === 'administration' ? ADMINISTRATIONS : SKIPS, id: input.targetId },
    ['kind', 'reason', ...input.changed],
  )
}

/**
 * Uygulama düzeltmesi ya da iptali (K-513): yalnız yönetici (rotada); kayıt silinmez, düzeltme
 * eklenir. Başka kurumun kaydı 404. `Idempotency-Key` rotada zorunlu. 201.
 */
export function correctAdministrationCommand(
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  administrationId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ADMINISTRATIONS, id: administrationId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.infirmary.correction_create',
      collections: [],
      entity,
      load: async (tx) => {
        const record = await findDoseAdministration(tx, ctx.institutionId, administrationId)
        if (record === null) throw new NotFoundError()
        const parsed = administrationCorrectionSchema.parse(input)
        const [corrections, members] = await Promise.all([
          correctionsOf(tx, ctx, deps, 'administration', administrationId),
          loadIncidentMembers(
            tx,
            ctx.institutionId,
            parsed.administeredByMembershipId === undefined
              ? []
              : [parsed.administeredByMembershipId],
          ),
        ])
        const health = administrationHealthOf(deps, ctx.institutionId, record)
        const current = effectiveAdministration(
          {
            administeredAt: record.administeredAt,
            administeredByMembershipId: record.administeredByMembershipId,
            note: health.note,
          },
          corrections,
        )
        return {
          run: () => ({
            record,
            parsed,
            plan: planAdministrationCorrection({ ...current, doseDay: record.doseDay }, parsed, {
              now: ctx.now,
              administeredBy:
                parsed.administeredByMembershipId === undefined
                  ? undefined
                  : (members.get(parsed.administeredByMembershipId) ?? null),
            }),
          }),
        }
      },
      after: async (tx, { record, parsed, plan }) => {
        await writeCorrection(tx, ctx, deps, {
          consentId: record.consentId,
          targetKind: 'administration',
          targetId: record.id,
          kind: parsed.kind,
          administeredAt: plan.administeredAt,
          administeredByMembershipId: plan.administeredByMembershipId,
          health: plan.health,
          changed: plan.changed,
        })
        body = { data: await recordView(tx, ctx, deps, 'administration', record.id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * Atlama düzeltmesi ya da iptali (K-513): yalnız yönetici (rotada); kayıt silinmez, düzeltme
 * eklenir. Başka kurumun kaydı 404. `Idempotency-Key` rotada zorunlu. 201.
 */
export function correctSkipCommand(
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  skipId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SKIPS, id: skipId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.infirmary.correction_create',
      collections: [],
      entity,
      load: async (tx) => {
        const record = await findSkip(tx, ctx.institutionId, skipId)
        if (record === null) throw new NotFoundError()
        const parsed = skipCorrectionSchema.parse(input)
        const corrections = await correctionsOf(tx, ctx, deps, 'skip', skipId)
        const current = effectiveSkip(skipHealthOf(deps, ctx.institutionId, record), corrections)
        return { run: () => ({ record, parsed, plan: planSkipCorrection(current, parsed) }) }
      },
      after: async (tx, { record, parsed, plan }) => {
        await writeCorrection(tx, ctx, deps, {
          consentId: record.consentId,
          targetKind: 'skip',
          targetId: record.id,
          kind: parsed.kind,
          administeredAt: null,
          administeredByMembershipId: null,
          health: plan.health,
          changed: plan.changed,
        })
        body = { data: await recordView(tx, ctx, deps, 'skip', record.id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

// --- Ayar ----------------------------------------------------------------------------------------

export function medicationSettingsFor(ctx: ServiceContext) {
  return loadMedicationSettings(ctx.db, ctx.institutionId)
}

/** Gecikme payı (K-511): yalnız yönetici (rotada); `If-Match` ayar sürümü (hiç kaydedilmediyse 1). */
export function setMedicationSettingsCommand(
  ctx: ServiceContext,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SETTINGS, id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.infirmary.settings_update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = medicationSettingsSchema.parse(input)
        const current = await loadMedicationSettings(tx, ctx.institutionId)
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => planMedicationSettings(current, parsed) }
      },
      after: async (tx, plan) => {
        const saved = await saveMedicationSettings(tx, ctx.institutionId, {
          ...plan.next,
          expectedVersion,
          now: ctx.now,
        })
        if (saved === null) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.infirmary.settings_update', entity, plan.changed)
        body = { data: await loadMedicationSettings(tx, ctx.institutionId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
