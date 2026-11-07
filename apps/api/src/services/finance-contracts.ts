import {
  amendContract,
  amendContractSchema,
  approveContract,
  cancelContractAmendment,
  setContractSignatory,
} from '@kampus/school-core/lib/contract-approval.ts'
import { requireAuthorized, type WriteAction } from '@kampus/school-core/lib/authorize.ts'
import { contractPayerIsGuardian } from '@kampus/school-core/lib/finance-notifications.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import type { CollectionName } from '../db/collections.ts'
import { findFeeTariff } from '../db/fee-tariffs.ts'
import { allocatedByInvoice } from '../db/payments.ts'
import { loadFinanceRecords } from '../db/finance-mirror-store.ts'
import { loadStudentGuardians } from '../db/student-guardians.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { commandBody } from './command-result.ts'
import { environment, type CommandOptions } from './commands.ts'
import { notify } from './notify.ts'
import {
  runCommand,
  type CommandResponse,
  type LoadScope,
  type OperationRun,
  FINANCE_TABLE_STORES,
} from './operation-runner.ts'

/**
 * Sözleşme onayı ve ek protokol servisi (IST-092; docs/domain/finans.md DOM-FIN-010, -012, -051).
 * Kural core `lib/contract-approval.ts`'tedir. Sözleşme ve öğrencinin taksitleri tek işlemde,
 * kurum kilidi altında yazılır; imza yetkilisi, ödeyici adı ve gerekçe loglanmaz, denetime yalnız
 * alan adları düşer. Onay isteği ve onay bildirimi (ON-044) aynı transaction'dadır: işlem geri
 * alınırsa bildirim de yoktur; idempotent tekrar işlemi çalıştırmadığı için ikinci bildirim yazmaz.
 */

const COLLECTION: CollectionName = 'contracts'
type ContractAction = Extract<WriteAction, `contract.${string}`>
/** İşlemin döndürdüğü sözleşme sürümü; bildirim kitlesi ödeyiciden seçilir. */
type ContractResult = { id: string; payer?: string | undefined }
type ContractNotice = 'contract_approval_requested' | 'contract_approved'

/**
 * Sözleşmenin öğrencisi: yükleme yalnız o öğrencinin sözleşme ve taksitleriyle sınırlanır. Öğrenci
 * kimliği sözleşmede değişmediği için kurum kilidinden önce okunabilir. Yok ya da başka kurum 404.
 */
async function studentOfContract(ctx: ServiceContext, contractId: string): Promise<string> {
  const [record] = await loadFinanceRecords(ctx.db, ctx.institutionId, COLLECTION, {
    ids: [contractId],
  })
  const studentId = record?.data.studentId
  if (typeof studentId !== 'string') throw new NotFoundError()
  return studentId
}

const ofStudent = (studentId: string): LoadScope => ({
  match: [{ kind: 'equals', field: 'studentId', values: [studentId] }],
})

/** Yüklenen koleksiyonlardan sözleşme ve taksitleri öğrenciye daraltır (`contract.sign` taksit okumaz). */
function loadScopeFor(action: ContractAction, studentId: string) {
  const scope = ofStudent(studentId)
  return action === 'contract.sign' ? { contracts: scope } : { contracts: scope, invoices: scope }
}

interface ContractCommand {
  action: ContractAction
  /** Denetim kaydının eylemi; verilmezse `action`. */
  auditAction?: string
  contractId: string
  studentId: string
  statusCode: number
  options: CommandOptions
  /** Kurum kilidi altında okunan girdilerle işlemi kurar. */
  prepare: (
    tx: Parameters<typeof environment>[0],
    actor: Awaited<ReturnType<typeof environment>>['actor'],
    institutionType: Awaited<ReturnType<typeof environment>>['institutionType'],
  ) => Promise<OperationRun<ContractResult>>
  /** Başarılı işlemin aynı transaction'da yazdığı bildirim. */
  notice?: ContractNotice
}

/**
 * Sözleşme bildirimi ödeyiciye (`contractPayerIsGuardian`): veli ödeyicide veli, yetişkin
 * kursiyerde kendisi. Anahtar sözleşme sürümünün kimliğidir: imza yetkilisi onaydan önce
 * düzeltilse de aynı sürüm için ikinci onay isteği yazılmaz; ek protokol yeni sürümdür, yeni
 * istek alır. Veri yalnız sözleşme kimliğidir (DOM-ILT-023).
 */
async function notifyPayer(
  tx: Database,
  ctx: ServiceContext,
  type: ContractNotice,
  studentId: string,
  contract: ContractResult,
): Promise<void> {
  await notify(tx, ctx, {
    type,
    recipients: {
      studentIds: [studentId],
      minor: new Map([[studentId, contractPayerIsGuardian(contract)]]),
    },
    data: { contractId: contract.id },
    dedupeKey: contract.id,
  })
}

function execute(ctx: ServiceContext, command: ContractCommand): Promise<CommandResponse> {
  const spec = OPERATION_COMMANDS[command.action]
  const { contractId, options, notice, studentId } = command
  return runCommand(
    ctx,
    {
      action: command.auditAction ?? command.action,
      collections: spec.collections,
      stores: FINANCE_TABLE_STORES,
      loadScope: loadScopeFor(command.action, studentId),
      ...(options.expectedVersion === null
        ? {}
        : {
            expectedVersions: [
              { collection: COLLECTION, id: contractId, version: options.expectedVersion },
            ],
          }),
      entity: (result: ContractResult) => ({ type: COLLECTION, id: result.id }),
      ...(notice === undefined
        ? {}
        : {
            after: (tx: Database, result: ContractResult) =>
              notifyPayer(tx, ctx, notice, studentId, result),
          }),
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        return { scalars, run: await command.prepare(tx, actor, institutionType) }
      },
    },
    (outcome) =>
      commandBody(
        { collection: COLLECTION, id: outcome.result.id },
        outcome.changes,
        command.statusCode,
      ),
    options.idempotency,
  )
}

/** İmza yetkilisini (kurucu ya da temsilci) işler; onaya kadar düzeltilebilir. 200. */
export async function setContractSignatoryCommand(
  ctx: ServiceContext,
  contractId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const studentId = await studentOfContract(ctx, contractId)
  return execute(ctx, {
    action: 'contract.sign',
    contractId,
    studentId,
    statusCode: 200,
    options,
    // İmza yetkilisi işlenince sözleşme ödeyici onayına açılır (DOM-FIN-010).
    notice: 'contract_approval_requested',
    prepare:
      async (_tx, actor, institutionType) =>
      (state, { now }) => {
        requireAuthorized(actor, 'contract.sign', {}, state, { now, institutionType })
        return setContractSignatory(state, contractId, input, { userId: ctx.actor.userId, now })
      },
  })
}

/**
 * Ödeyici onayını zamanıyla saklar, planı kopyalar; ek protokolde yeni plan taksitlere burada geçer
 * (DOM-FIN-010, -051). 200.
 */
export async function approveContractCommand(
  ctx: ServiceContext,
  contractId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const studentId = await studentOfContract(ctx, contractId)
  return execute(ctx, {
    action: 'contract.approve',
    contractId,
    studentId,
    statusCode: 200,
    options,
    notice: 'contract_approved',
    prepare: async (tx, actor, institutionType) => {
      const [guardians, allocated] = await Promise.all([
        loadStudentGuardians(tx, ctx.institutionId, studentId),
        allocatedByInvoice(tx, ctx.institutionId, studentId),
      ])
      return (state, { now, makeId }) => {
        requireAuthorized(actor, 'contract.approve', { studentId }, state, {
          now,
          institutionType,
        })
        return approveContract(state, contractId, input, {
          role: ctx.actor.role,
          userId: ctx.actor.userId,
          membershipId: ctx.actor.membershipId,
          guardians,
          allocated,
          now,
          makeId,
        })
      }
    },
  })
}

/**
 * Ek protokolü taslak olarak açar; önceki sürüm ve taksitler onaya kadar değişmez (DOM-FIN-010).
 * Yanıtın konusu yeni sürümdür. 201.
 */
export async function amendContractCommand(
  ctx: ServiceContext,
  contractId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  amendContractSchema.parse(input)
  const [source] = await loadFinanceRecords(ctx.db, ctx.institutionId, COLLECTION, {
    ids: [contractId],
  })
  const studentId = source?.data.studentId
  if (typeof studentId !== 'string') throw new NotFoundError()
  const tariffId = source?.data.tariffId
  return execute(ctx, {
    action: 'contract.amend',
    contractId,
    studentId,
    statusCode: 201,
    options,
    prepare: async (tx, actor, institutionType) => {
      const [tariff, allocated] = await Promise.all([
        // Ek protokolün taksit sayısı da tarifenin koşuluna bağlıdır (DOM-FIN-013).
        typeof tariffId === 'string' ? findFeeTariff(tx, ctx.institutionId, tariffId) : null,
        allocatedByInvoice(tx, ctx.institutionId, studentId),
      ])
      return (state, { now, makeId }) => {
        requireAuthorized(actor, 'contract.amend', {}, state, { now, institutionType })
        return amendContract(state, contractId, input, {
          tariff,
          canApproveCapException: ctx.actor.role === 'yonetici',
          allocated,
          userId: ctx.actor.userId,
          now,
          makeId,
        })
      }
    },
  })
}

/** Onaylanmamış ek protokolü gerekçeyle kapatır. 200. */
export async function cancelContractAmendmentCommand(
  ctx: ServiceContext,
  contractId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const studentId = await studentOfContract(ctx, contractId)
  return execute(ctx, {
    action: 'contract.amend',
    auditAction: 'contract.amendmentCancel',
    contractId,
    studentId,
    statusCode: 200,
    options,
    prepare:
      async (_tx, actor, institutionType) =>
      (state, { now }) => {
        requireAuthorized(actor, 'contract.amend', {}, state, { now, institutionType })
        return cancelContractAmendment(state, contractId, input, { userId: ctx.actor.userId, now })
      },
  })
}
