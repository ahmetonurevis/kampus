import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { normalizeImportIdentity } from '@kampus/school-core/lib/enrollment-import-cells.ts'
import {
  applyInstallmentImport,
  INSTALLMENT_IMPORT_MESSAGES,
  parseInstallmentImport,
  planInstallmentImport,
  type InstallmentImportPlan,
  type InstallmentImportRow,
} from '@kampus/school-core/lib/finance-installment-import.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import type { CollectionName } from '../db/collections.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { institutionSettings } from '../db/schema/institution-settings.ts'
import { findIdentityHolders } from '../db/student-identities.ts'
import { AppError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { decodeImportFile } from './enrollment-import-file.ts'
import { importIssueToEnvelope } from './enrollment-import.ts'
import {
  FINANCE_TABLE_STORES,
  mapOperationError,
  runCommand,
  runReadOnly,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { loadActorAdmin } from './staff-accounts.ts'

/**
 * Pilot verisi aktarımı: taksitler (IST-007, ON-061; DOM-FIN-001, -010, -011, -012; ADR 0010 cevap
 * 3). Taksit ve sözleşme tablodan yüklenir ve tabloya yazılır (`FINANCE_TABLE_STORES`); kural core
 * `planInstallmentImport`'tur. Önizleme yazmaz, kurum kilidi almaz; onay aynı denetimi kurum kilidi
 * altında yeniden yapar, bir satır hatalıysa hiçbir şey yazılmaz (422 `installment_import_invalid`).
 * Taksitler bütünüyle yüklenir (`loadScope` yok): mükerrer ve sözleşme toplamı denetimi öğrencinin
 * bütün taksitlerine bakar, öğrenciler de dosyadan çözülür; aktarım nadir yapılır.
 *
 * Geçmiş ödeme `payments`'a yazılmaz, kasa ve dönem tahsilatı değişmez; `paid_at` önbelleğindedir
 * (ADR 0010 karar 5), yöntemi `opening_import`'tur (DOM-FIN-014). Dosya saklanmaz; içerik ve tutar loglanmaz, denetime yalnız alan adları ve
 * sayılar yazılır; saklanan yanıt satır taşımaz.
 */

const IMPORT_ACTION = 'invoice.import'
const COLLECTIONS: readonly CollectionName[] = ['students', 'invoices', 'contracts']

function parseRows(text: string): InstallmentImportRow[] {
  try {
    return parseInstallmentImport(text)
  } catch (error) {
    throw mapOperationError(error)
  }
}

async function loadContext(
  tx: Database,
  ctx: ServiceContext,
  rows: readonly InstallmentImportRow[],
) {
  await loadActorAdmin(tx, ctx)
  const today = dayKey(ctx.now)
  const [identityHolders, settings] = await Promise.all([
    findIdentityHolders(
      tx,
      ctx.institutionId,
      rows.map((row) => normalizeImportIdentity(row.identityNumber)).filter(Boolean),
    ),
    tx
      .select({ academicYear: institutionSettings.academicYear })
      .from(institutionSettings)
      .where(eq(institutionSettings.institutionId, ctx.institutionId))
      .limit(1),
  ])
  return {
    today,
    academicYear: settings[0]?.academicYear ?? Number(today.slice(0, 4)),
    identityHolders,
  }
}

function resultBody(rowCount: number, plan: InstallmentImportPlan, dryRun: boolean) {
  const count = (status: InstallmentImportPlan['rows'][number]['status']) =>
    plan.rows.filter((row) => row.status === status).length
  return {
    data: {
      dryRun,
      rowCount,
      readyCount: count('ready'),
      skippedCount: count('skipped'),
      invalidCount: count('invalid'),
      linkedCount: plan.installments.filter((item) => item.contractId !== null).length,
      totalCents: plan.totalCents,
      paidCents: plan.paidCents,
      // Kişisel veri yalnız önizlemede, maskeli döner; onay yanıtı saklanır, satır taşımaz.
      rows: dryRun ? plan.rows : [],
    },
  }
}

/**
 * Önizleme 200 ve satırlar; onay 201, hatalı dosyada 422 `installment_import_invalid` ve hiçbir
 * yazma. Dosya düzeyindeki sorun (başlık, satır sınırı, okunamayan dosya) iki yolda da 422.
 */
export async function importInstallments(
  ctx: ServiceContext,
  input: { fileBase64: string; dryRun: boolean },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const rows = parseRows(await decodeImportFile(input.fileBase64))

  if (input.dryRun) {
    const plan = await runReadOnly(ctx, {
      action: IMPORT_ACTION,
      collections: COLLECTIONS,
      stores: FINANCE_TABLE_STORES,
      load: async (tx) => {
        const context = await loadContext(tx, ctx, rows)
        return { run: (state) => planInstallmentImport(state, rows, context) }
      },
    })
    return { statusCode: 200, body: resultBody(rows.length, plan, true), replayed: false }
  }

  const batchId = randomUUID()
  let body: ReturnType<typeof resultBody> | null = null
  return runCommand(
    ctx,
    {
      action: IMPORT_ACTION,
      // Çalıştırıcının farktan yazdığı satır yan kayıttır; sayılı asıl satır `after`'dadır.
      auditAction: `${IMPORT_ACTION}.records`,
      collections: COLLECTIONS,
      stores: FINANCE_TABLE_STORES,
      entity: { type: 'invoice_import', id: batchId },
      load: async (tx) => {
        const context = await loadContext(tx, ctx, rows)
        return {
          run: (state, { makeId }) => {
            const plan = planInstallmentImport(state, rows, context)
            if (plan.issues.length > 0)
              throw new AppError(
                422,
                'installment_import_invalid',
                INSTALLMENT_IMPORT_MESSAGES.installment_import_invalid,
                { issues: plan.issues.map(importIssueToEnvelope) },
              )
            body = resultBody(rows.length, plan, false)
            return applyInstallmentImport(state, plan.installments, makeId)
          },
        }
      },
      after: async (tx, applied) => {
        if (applied.created === 0) return
        await tx.insert(auditLog).values({
          institutionId: ctx.institutionId,
          actorUserId: ctx.actor.userId,
          actorRole: ctx.actor.role,
          action: IMPORT_ACTION,
          entityType: 'invoice_import',
          entityId: batchId,
          changes: {
            fields: ['invoices', 'contract_invoices'],
            counts: { rows: rows.length, invoices: applied.created, linked: applied.linked },
          },
          createdAt: ctx.now,
        })
      },
    },
    () => {
      if (body === null) throw new Error('installment import produced no body')
      return { statusCode: 201, body }
    },
    idempotency,
  )
}
