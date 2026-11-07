import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import {
  applyStudentImport,
  parseStudentImport,
  planStudentImport,
  STUDENT_IMPORT_MESSAGES,
  type AppliedStudent,
  type StudentImportPlan,
  type StudentImportRow,
} from '@kampus/school-core/lib/enrollment-import.ts'
import {
  normalizeImportIdentity,
  type ImportIssue,
} from '@kampus/school-core/lib/enrollment-import-cells.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { planGuardianLink } from '@kampus/school-core/lib/guardianship.ts'

import type { Database } from '../db/client.ts'
import type { CollectionName } from '../db/collections.ts'
import {
  findParentAccount,
  linkChildToAccount,
  loadInstitutionParentBonds,
} from '../db/enrollment-bonds.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { institutionSettings } from '../db/schema/institution-settings.ts'
import { insertGuardianLink } from '../db/student-guardians.ts'
import { findIdentityHolders, insertStudentIdentity } from '../db/student-identities.ts'
import { AppError, type Issue } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { decodeImportFile } from './enrollment-import-file.ts'
import { getInstitutionModules } from './modules.ts'
import {
  mapOperationError,
  runCommand,
  runReadOnly,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { loadActorAdmin } from './staff-accounts.ts'

/**
 * Pilot verisi aktarımı: öğrenci ve veli (IST-007, ON-060; DOM-KAY-010, -012, -013). Dosya core
 * ile ayrıştırılır; kural core `planStudentImport`'tur. Önizleme yazmaz, kurum kilidi almaz, tek
 * görüntüden okur (`runReadOnly`). Onay aynı denetimi kurum kilidi altında yeniden yapar; bir satır
 * hatalıysa hiçbir şey yazılmaz (422 `student_import_invalid`). Öğrenci, veli, kimlik ve veli bağı
 * tek transaction'dadır, `Idempotency-Key` aynı transaction'da saklanır.
 *
 * KVKK: dosya saklanmaz, içerik loglanmaz. Denetime yalnız alan adları ve sayılar yazılır; saklanan
 * yanıt (idempotency) kişisel veri taşımaz, satırlar yalnız önizleme yanıtında maskeli döner.
 * Kesin kayıttan farkı: geçmiş kayıt aktarıldığı için bildirim gitmez, sözleşme ve taksit açılmaz.
 */

const IMPORT_ACTION = 'student.import'
const COLLECTIONS: readonly CollectionName[] = [
  'students',
  'parents',
  'classes',
  'branches',
  'renewals',
  'prospects',
]

function parseRows(text: string): StudentImportRow[] {
  try {
    return parseStudentImport(text)
  } catch (error) {
    throw mapOperationError(error)
  }
}

/** Satır sorunu → hata zarfı maddesi: yol `['rows', satır, alan]` (satırın bütününde alan yok). */
export function importIssueToEnvelope(issue: ImportIssue): Issue {
  return {
    path: ['rows', issue.line, ...(issue.field === null ? [] : [issue.field])],
    code: issue.code,
    message: `${issue.line}. satır: ${issue.message}`,
  }
}

async function loadContext(tx: Database, ctx: ServiceContext, rows: readonly StudentImportRow[]) {
  await loadActorAdmin(tx, ctx)
  const [institution, identityHolders, bonds, settings] = await Promise.all([
    getInstitutionModules(tx, ctx.institutionId),
    findIdentityHolders(
      tx,
      ctx.institutionId,
      rows.map((row) => normalizeImportIdentity(row.identityNumber)).filter(Boolean),
    ),
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
      institutionType: institution?.type ?? ('school' as const),
      today,
      now: ctx.now.toISOString(),
      identityHolders,
      bonds,
    },
    academicYear: settings[0]?.academicYear ?? Number(today.slice(0, 4)),
  }
}

function resultBody(rowCount: number, plan: StudentImportPlan, dryRun: boolean) {
  const count = (status: StudentImportPlan['rows'][number]['status']) =>
    plan.rows.filter((row) => row.status === status).length
  return {
    data: {
      dryRun,
      rowCount,
      readyCount: count('ready'),
      skippedCount: count('skipped'),
      invalidCount: count('invalid'),
      newGuardianCount: plan.newGuardianCount,
      existingGuardianCount: plan.existingGuardianCount,
      // Kişisel veri yalnız önizlemede, maskeli döner; onay yanıtı saklanır, satır taşımaz.
      rows: dryRun ? plan.rows : [],
    },
  }
}

/** Kimlik ve veli bağı satırları, hesaplı velinin yeni çocuğu (DOM-KAY-013, ON-128), denetim. */
async function writeSideRecords(
  tx: Database,
  ctx: ServiceContext,
  applied: readonly AppliedStudent[],
  academicYear: number,
  batchId: string,
  rowCount: number,
) {
  const accounts = new Map<string, string | null>()
  let bondCount = 0
  for (const item of applied) {
    await insertStudentIdentity(tx, ctx.institutionId, {
      studentId: item.studentId,
      academicYear,
      kind: item.identity.kind,
      number: item.identity.number,
      birthDate: item.identity.birthDate,
      now: ctx.now,
    })
    if (item.bond === null) continue
    const { parentId, relationship, existing } = item.bond
    let accountId: string | null = null
    if (existing) {
      accountId = accounts.has(parentId)
        ? (accounts.get(parentId) ?? null)
        : await findParentAccount(tx, ctx.institutionId, parentId)
      accounts.set(parentId, accountId)
    }
    // Yeni öğrencinin başka bağı yoktur; değişmezler boş kümeye uygulanır (kesin kayıtla aynı).
    const draft = planGuardianLink({
      studentId: item.studentId,
      links: [],
      account: accountId === null ? null : { role: 'veli' },
      input: {
        parentId,
        ...(accountId === null ? {} : { membershipId: accountId }),
        relationship,
        custody: 'full',
        isPayer: true,
      },
    })
    await insertGuardianLink(tx, ctx.institutionId, { id: randomUUID(), ...draft }, ctx.now)
    bondCount += 1
    if (accountId !== null)
      await linkChildToAccount(tx, ctx.institutionId, accountId, item.studentId, ctx.now)
  }
  if (applied.length === 0) return
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: IMPORT_ACTION,
    entityType: 'student_import',
    entityId: batchId,
    changes: {
      fields: [
        'students',
        'parents',
        'student_identities.identity_number',
        'student_identities.birth_date',
        'student_guardians',
      ],
      counts: { rows: rowCount, students: applied.length, guardianLinks: bondCount },
    },
    createdAt: ctx.now,
  })
}

/**
 * Önizleme 200 ve satırlar; onay 201, hatalı dosyada 422 `student_import_invalid` ve hiçbir yazma.
 * Dosya düzeyindeki sorun (başlık, satır sınırı, okunamayan dosya) iki yolda da 422.
 */
export async function importStudents(
  ctx: ServiceContext,
  input: { fileBase64: string; dryRun: boolean },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const rows = parseRows(await decodeImportFile(input.fileBase64))

  if (input.dryRun) {
    const plan = await runReadOnly(ctx, {
      action: IMPORT_ACTION,
      collections: COLLECTIONS,
      load: async (tx) => {
        const context = await loadContext(tx, ctx, rows)
        return { run: (state) => planStudentImport(state, rows, context.plan) }
      },
    })
    return { statusCode: 200, body: resultBody(rows.length, plan, true), replayed: false }
  }

  const batchId = randomUUID()
  let academicYear = 0
  let body: ReturnType<typeof resultBody> | null = null
  return runCommand(
    ctx,
    {
      action: IMPORT_ACTION,
      // Çalıştırıcının farktan yazdığı satır yan kayıttır; sayılı asıl satır `after`'dadır.
      auditAction: `${IMPORT_ACTION}.records`,
      collections: COLLECTIONS,
      entity: { type: 'student_import', id: batchId },
      load: async (tx) => {
        const context = await loadContext(tx, ctx, rows)
        academicYear = context.academicYear
        return {
          run: (state, { makeId, now }) => {
            const plan = planStudentImport(state, rows, context.plan)
            if (plan.issues.length > 0)
              throw new AppError(
                422,
                'student_import_invalid',
                STUDENT_IMPORT_MESSAGES.student_import_invalid,
                { issues: plan.issues.map(importIssueToEnvelope) },
              )
            body = resultBody(rows.length, plan, false)
            return applyStudentImport(state, plan.students, makeId, now)
          },
        }
      },
      after: (tx, applied) =>
        writeSideRecords(tx, ctx, applied, academicYear, batchId, rows.length),
    },
    () => {
      if (body === null) throw new Error('student import produced no body')
      return { statusCode: 201, body }
    },
    idempotency,
  )
}
