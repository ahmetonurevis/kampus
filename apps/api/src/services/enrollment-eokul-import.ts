import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'

import {
  applyEokulImport,
  EOKUL_FIELDS,
  EOKUL_IMPORT_MESSAGES,
  planEokulImport,
  readEokulTable,
  suggestEokulMapping,
  type EokulField,
  type EokulImportApplied,
  type EokulImportOptions,
  type EokulImportPlan,
  type EokulMapping,
  type EokulTable,
  type eokulImportInputSchema,
} from '@kampus/school-core/lib/enrollment-eokul-import.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import type { CollectionName } from '../db/collections.ts'
import { loadInstitutionParentBonds } from '../db/enrollment-bonds.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { memberships } from '../db/schema/auth.ts'
import { institutionSettings } from '../db/schema/institution-settings.ts'
import { insertStudentIdentity, loadInstitutionIdentities } from '../db/student-identities.ts'
import { AppError, ForbiddenError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { importIssueToEnvelope, writeImportedStudentLinks } from './enrollment-import.ts'
import { decodeImportFile } from './enrollment-import-file.ts'
import { getInstitutionModules } from './modules.ts'
import {
  mapOperationError,
  runCommand,
  runReadOnly,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'

/**
 * e-Okul öğrenci listesinden içe aktarım (IST-134, ON-062; DOM-KAY-042). Dosya sunucuda çözülür
 * (CSV ya da `.xlsx`; pilot aktarımıyla aynı okuyucu), sütunlar önerilen ya da kullanıcının verdiği
 * eşlemeyle okunur, kural core `planEokulImport`'tur. Önizleme yazmaz, kurum kilidi almaz, tek
 * görüntüden okur (`runReadOnly`). Onay yalnız seçilen satırları kurum kilidi altında yeniden
 * doğrular; seçilen bir satır hatalıysa hiçbir şey yazılmaz (422 `eokul_import_invalid`). Öğrenci,
 * veli, kimlik ve veli bağı tek transaction'dadır, `Idempotency-Key` aynı transaction'da saklanır.
 *
 * KVKK: dosya saklanmaz, içerik ve kimlik numarası loglanmaz. Denetime yalnız alan adları ve sayılar
 * yazılır; onay yanıtı (idempotency ile saklanır) satır taşımaz, önizleme satırları maskelidir.
 */

const IMPORT_ACTION = 'student.eokul_import'
const COLLECTIONS: readonly CollectionName[] = [
  'students',
  'parents',
  'classes',
  'branches',
  'renewals',
  'prospects',
]
/** Aktarımı yapabilen roller (K-279); rol ve pasiflik kurum kilidi altında yeniden doğrulanır. */
export const EOKUL_IMPORT_ROLES = ['yonetici', 'onburo'] as const

type EokulImportBody = z.output<typeof eokulImportInputSchema>

function readTable(text: string): EokulTable {
  try {
    return readEokulTable(text)
  } catch (error) {
    throw mapOperationError(error)
  }
}

/** Rol değişikliği ya da devre dışı bırakma önizleme ile onay arasında olabilir. */
async function assertActor(tx: Database, ctx: ServiceContext): Promise<void> {
  const [row] = await tx
    .select({ role: memberships.role, deactivatedAt: memberships.deactivatedAt })
    .from(memberships)
    .where(
      and(
        eq(memberships.institutionId, ctx.institutionId),
        eq(memberships.id, ctx.actor.membershipId),
        eq(memberships.userId, ctx.actor.userId),
      ),
    )
    .limit(1)
  const allowed: readonly string[] = EOKUL_IMPORT_ROLES
  if (row === undefined || row.deactivatedAt !== null || !allowed.includes(row.role))
    throw new ForbiddenError()
}

async function loadContext(tx: Database, ctx: ServiceContext) {
  await assertActor(tx, ctx)
  const [identities, bonds, settings] = await Promise.all([
    loadInstitutionIdentities(tx, ctx.institutionId),
    loadInstitutionParentBonds(tx, ctx.institutionId),
    tx
      .select({ academicYear: institutionSettings.academicYear })
      .from(institutionSettings)
      .where(eq(institutionSettings.institutionId, ctx.institutionId))
      .limit(1),
  ])
  const today = dayKey(ctx.now)
  return {
    plan: {
      institutionType: 'school' as const,
      today,
      now: ctx.now.toISOString(),
      identities,
      bonds,
    },
    academicYear: settings[0]?.academicYear ?? Number(today.slice(0, 4)),
  }
}

/** Yanıtta eşleme her alanı taşır: eşlenmemiş alan `null`. */
const fullMapping = (mapping: EokulMapping) =>
  Object.fromEntries(EOKUL_FIELDS.map((field) => [field, mapping[field] ?? null])) as Record<
    EokulField,
    number | null
  >

function resultBody(
  table: EokulTable,
  suggested: EokulMapping,
  mapping: EokulMapping,
  plan: EokulImportPlan,
  dryRun: boolean,
) {
  const count = (status: EokulImportPlan['rows'][number]['status']) =>
    plan.rows.filter((row) => row.status === status).length
  return {
    data: {
      dryRun,
      headerLine: table.headerLine,
      headers: table.headers.map((label, index) => ({ index, label })),
      suggestedMapping: fullMapping(suggested),
      mapping: fullMapping(mapping),
      mappingIssues: plan.mappingIssues,
      fileRowCount: table.rows.length,
      rowCount: plan.rows.length,
      newCount: count('new'),
      updateCount: count('update'),
      unchangedCount: count('unchanged'),
      invalidCount: count('invalid'),
      newGuardianCount: plan.newGuardianCount,
      existingGuardianCount: plan.existingGuardianCount,
      // Kişisel veri yalnız önizlemede, maskeli döner; onay yanıtı saklanır, satır taşımaz.
      rows: dryRun ? plan.rows : [],
    },
  }
}

/** Yeni öğrencilerin kimlik ve veli bağı, mevcut öğrenciye eklenen kimlik ve denetim kaydı. */
async function writeSideRecords(
  tx: Database,
  ctx: ServiceContext,
  applied: EokulImportApplied,
  academicYear: number,
  batchId: string,
  counts: { rows: number; unchanged: number },
) {
  const guardianLinks = await writeImportedStudentLinks(tx, ctx, applied.created, academicYear)
  for (const identity of applied.identities)
    await insertStudentIdentity(tx, ctx.institutionId, {
      studentId: identity.studentId,
      academicYear,
      kind: 'tc',
      number: identity.number,
      birthDate: identity.birthDate,
      now: ctx.now,
    })
  if (applied.created.length === 0 && applied.updatedCount === 0) return
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: IMPORT_ACTION,
    entityType: 'student_import',
    entityId: batchId,
    changes: {
      fields: [
        'students.name',
        'students.number',
        'students.classId',
        'parents',
        'student_identities.identity_number',
        'student_identities.birth_date',
        'student_guardians',
      ],
      counts: {
        rows: counts.rows,
        created: applied.created.length,
        updated: applied.updatedCount,
        unchanged: counts.unchanged,
        identities: applied.created.length + applied.identities.length,
        guardianLinks,
      },
    },
    createdAt: ctx.now,
  })
}

function rejectPlan(plan: EokulImportPlan): void {
  if (plan.mappingIssues.length > 0)
    throw new AppError(422, 'eokul_mapping_invalid', EOKUL_IMPORT_MESSAGES.eokul_mapping_invalid, {
      issues: plan.mappingIssues.map((issue) => ({
        path: ['mapping', issue.field],
        code: issue.code,
        message: issue.message,
      })),
    })
  if (plan.issues.length > 0)
    throw new AppError(422, 'eokul_import_invalid', EOKUL_IMPORT_MESSAGES.eokul_import_invalid, {
      issues: plan.issues.map(importIssueToEnvelope),
    })
}

/**
 * Önizleme 200 (eşleme sorunu da 200 ve `mappingIssues`); onay 201. Onayda eşleme sorunu 422
 * `eokul_mapping_invalid`, seçilen satır hatası 422 `eokul_import_invalid`. Okul dışındaki kurum
 * türünde uç yoktur (404): e-Okul okulların sistemidir, kurslar e-Özel'dedir.
 */
export async function importEokulStudents(
  ctx: ServiceContext,
  input: EokulImportBody,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
  if (institution === null || institution.type !== 'school') throw new NotFoundError()
  const table = readTable(await decodeImportFile(input.fileBase64))
  const suggested = suggestEokulMapping(table.headers)
  const mapping = input.mapping ?? suggested
  const options: EokulImportOptions = {
    mapping,
    branchId: input.branchId,
    fallbackClassId: input.fallbackClassId,
    lines: input.dryRun ? undefined : input.lines,
  }

  if (input.dryRun) {
    const plan = await runReadOnly(ctx, {
      action: IMPORT_ACTION,
      collections: COLLECTIONS,
      load: async (tx) => {
        const context = await loadContext(tx, ctx)
        return { run: (state) => planEokulImport(state, table, context.plan, options) }
      },
    })
    return {
      statusCode: 200,
      body: resultBody(table, suggested, mapping, plan, true),
      replayed: false,
    }
  }

  const batchId = randomUUID()
  let academicYear = 0
  let body: ReturnType<typeof resultBody> | null = null
  let unchanged = 0
  return runCommand(
    ctx,
    {
      action: IMPORT_ACTION,
      // Çalıştırıcının farktan yazdığı satır yan kayıttır; sayılı asıl satır `after`'dadır.
      auditAction: `${IMPORT_ACTION}.records`,
      collections: COLLECTIONS,
      entity: { type: 'student_import', id: batchId },
      load: async (tx) => {
        const context = await loadContext(tx, ctx)
        academicYear = context.academicYear
        return {
          run: (state, { makeId, now }) => {
            const plan = planEokulImport(state, table, context.plan, options)
            rejectPlan(plan)
            body = resultBody(table, suggested, mapping, plan, false)
            unchanged = body.data.unchangedCount
            return applyEokulImport(state, plan, makeId, now)
          },
        }
      },
      after: (tx, applied) =>
        writeSideRecords(tx, ctx, applied, academicYear, batchId, {
          rows: input.lines?.length ?? 0,
          unchanged,
        }),
    },
    () => {
      if (body === null) throw new Error('eokul import produced no body')
      return { statusCode: 201, body }
    },
    idempotency,
  )
}
