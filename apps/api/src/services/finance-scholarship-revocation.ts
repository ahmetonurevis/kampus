import { randomUUID } from 'node:crypto'

import { requireAuthorized } from '@kampus/school-core/lib/authorize.ts'
import { contractPayerIsGuardian } from '@kampus/school-core/lib/finance-notifications.ts'
import {
  endScholarship,
  quoteScholarshipEnd,
  type PriorScholarshipEnd,
  type ScholarshipEndKind,
} from '@kampus/school-core/lib/finance-scholarship-revocation.ts'
import type { CommandSpec } from '@kampus/school-core/modules/command-builders.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import {
  findScholarshipAward,
  insertScholarshipEnd,
  listScholarshipEnds,
  scholarshipProgramName,
  touchScholarshipAward,
  type StoredScholarshipAward,
  type StoredScholarshipEnd,
} from '../db/finance-scholarships.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { environment } from './commands.ts'
import { releaseAwardFundAllocations } from './finance-scholarship-funds.ts'
import { notify } from './notify.ts'
import {
  FINANCE_TABLE_STORES,
  runCommand,
  runReadOnly,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { studentFinanceScope } from './payments.ts'
import { auditWork } from './task-work.ts'

/**
 * Burs kesmesi ve gerçek dışı beyanla iptal ile geri isteme servisi (DOM-FIN-025; IST-105; ON-283;
 * K-264…K-267). Hesap ve yazma core `lib/finance-scholarship-revocation.ts`'tedir; taksitler
 * öğrencinin sözleşme ve taksitleri yüklenerek kurum kilidi altında, kesme kaydı, atama sürümü, fon
 * payının bırakılması, denetim ve bildirimle aynı transaction'da yazılır. Gerekçe açıklaması
 * loglanmaz, denetime alan adları düşer, komut yanıtına ve idempotency kaydına girmez.
 */

const BASE = OPERATION_COMMANDS['scholarship.manage']
const SPEC: CommandSpec = { ...BASE, collections: [...BASE.collections, 'contracts', 'invoices'] }
const ENDS = 'scholarship_terminations'

export type ScholarshipEndView = Omit<
  StoredScholarshipEnd,
  'institutionId' | 'archivedAt' | 'updatedAt' | 'version' | 'decidedByUserId' | 'createdAt'
> & { createdAt: string }

const view = (row: StoredScholarshipEnd): ScholarshipEndView => ({
  id: row.id,
  awardId: row.awardId,
  contractId: row.contractId,
  kind: row.kind,
  reason: row.reason,
  note: row.note,
  effectiveDate: row.effectiveDate,
  keptCents: row.keptCents,
  reinstatedCents: row.reinstatedCents,
  principalCents: row.principalCents,
  interestCents: row.interestCents,
  clawbackDueDate: row.clawbackDueDate,
  invoiceIds: row.invoiceIds,
  lines: row.lines,
  createdAt: row.createdAt.toISOString(),
})

const priorOf = (rows: readonly StoredScholarshipEnd[]): PriorScholarshipEnd[] =>
  rows.map((row) => ({
    kind: row.kind,
    effectiveDate: row.effectiveDate,
    invoiceIds: row.invoiceIds,
  }))

async function awardOf(db: Database, ctx: ServiceContext, awardId: string) {
  const award = await findScholarshipAward(db, ctx.institutionId, awardId)
  if (award === null) throw new NotFoundError()
  return award
}

/** Öğrenci kimliği atamada değişmez; yükleme kurum kilidinden önce öğrenciye daraltılır. */
const scopeOf = (award: StoredScholarshipAward) => ({
  contracts: studentFinanceScope(award.studentId),
  invoices: studentFinanceScope(award.studentId),
})

/** Kesme ya da iptalin hesabını yazmadan gösterir. Yalnız yönetici (route). */
export async function quoteScholarshipEndFor(ctx: ServiceContext, awardId: string, input: unknown) {
  const award = await awardOf(ctx.db, ctx, awardId)
  return runReadOnly(ctx, {
    action: 'scholarship.end.quote',
    collections: SPEC.collections,
    stores: FINANCE_TABLE_STORES,
    loadScope: scopeOf(award),
    load: async (tx) => {
      const { institutionType, scalars } = await environment(tx, ctx, SPEC)
      const prior = priorOf(await listScholarshipEnds(tx, ctx.institutionId, [awardId]))
      return {
        scalars,
        run: (state, { now }) =>
          quoteScholarshipEnd(state, award, input, { now, prior, institutionType }),
      }
    },
  })
}

/** Atamanın kesme ve iptal kayıtları, program adıyla (geri isteme yazısı). */
export async function scholarshipEndsFor(ctx: ServiceContext, awardId: string) {
  const award = await awardOf(ctx.db, ctx, awardId)
  const [ends, programName] = await Promise.all([
    listScholarshipEnds(ctx.db, ctx.institutionId, [awardId]),
    scholarshipProgramName(ctx.db, ctx.institutionId, award.programId),
  ])
  return { award, programName: programName ?? '', ends: ends.map(view) }
}

/**
 * Bursu keser (`terminate`) ya da gerçek dışı beyanla iptal edip geri ister (`revoke`). 201.
 * `If-Match` atamanın sürümüdür; önizlemedeki toplam `confirmedCents` ile gelir.
 */
export async function endScholarshipCommand(
  ctx: ServiceContext,
  awardId: string,
  kind: ScholarshipEndKind,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const award = await awardOf(ctx.db, ctx, awardId)
  const id = randomUUID()
  let body: unknown
  return runCommand(
    ctx,
    {
      action: `scholarship.${kind}`,
      collections: SPEC.collections,
      stores: FINANCE_TABLE_STORES,
      loadScope: scopeOf(award),
      entity: { type: ENDS, id },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, SPEC)
        const row = await awardOf(tx, ctx, awardId)
        if (row.version !== expectedVersion) throw new ConflictError()
        const prior = priorOf(await listScholarshipEnds(tx, ctx.institutionId, [awardId]))
        return {
          scalars,
          run: (state, { now, makeId }) => {
            requireAuthorized(actor, 'scholarship.manage', {}, state, { now, institutionType })
            const result = endScholarship(state, row, kind, input, {
              now,
              makeId,
              prior,
              institutionType,
            })
            const contract = state.contracts.find((item) => item.id === result.quote.contractId)
            return { ...result, payerIsGuardian: contractPayerIsGuardian(contract ?? {}) }
          },
        }
      },
      after: async (tx, result) => {
        const { quote } = result
        await insertScholarshipEnd(tx, ctx.institutionId, {
          id,
          awardId,
          contractId: quote.contractId,
          kind,
          reason: result.reason,
          note: result.note,
          effectiveDate: quote.effectiveDate,
          keptCents: quote.keptCents,
          reinstatedCents: quote.reinstatedCents,
          principalCents: quote.principalCents,
          interestCents: quote.interestCents,
          clawbackDueDate: quote.clawbackDueDate,
          invoiceIds: result.invoiceIds,
          lines: quote.lines,
          decidedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (
          !(await touchScholarshipAward(tx, ctx.institutionId, {
            id: awardId,
            expectedVersion,
            now: ctx.now,
          }))
        )
          throw new ConflictError()
        await auditWork(tx, ctx, `scholarship.${kind}`, { type: ENDS, id }, [
          'awardId',
          'reason',
          'note',
          'effectiveDate',
          'reinstatedCents',
          'principalCents',
          'interestCents',
          'invoiceIds',
        ])
        // Fon payı kalan bursa iner: kesmede önceki dönemin bursu, iptalde sıfır (K-119).
        await releaseAwardFundAllocations(
          tx,
          ctx,
          [{ awardId, keepCents: quote.keptCents }],
          kind === 'terminate' ? 'scholarship_terminated' : 'scholarship_revoked',
        )
        await notify(tx, ctx, {
          type: 'scholarship_ended',
          recipients: {
            studentIds: [award.studentId],
            minor: new Map([[award.studentId, result.payerIsGuardian]]),
          },
          data: { awardId },
          dedupeKey: id,
        })
        const [saved] = (await listScholarshipEnds(tx, ctx.institutionId, [awardId])).filter(
          (item) => item.id === id,
        )
        if (saved === undefined) throw new NotFoundError()
        // Gerekçe açıklaması yanıta ve idempotency kaydına girmez; ayrıntı okumasındadır.
        body = {
          data: Object.fromEntries(Object.entries(view(saved)).filter(([key]) => key !== 'note')),
        }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}
