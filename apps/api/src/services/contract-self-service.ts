import { isCourse } from '@kampus/school-core/lib/enrollment.ts'
import {
  contractPlanSummary,
  learnerReadsOwnContracts,
  type ContractPlanSummary,
} from '@kampus/school-core/lib/contract-self-service.ts'
import { contractStatus, type ContractStatus } from '@kampus/school-core/lib/contract-status.ts'

import { parseContractRecord, type ContractRecord } from '../db/contract-store.ts'
import { loadFinanceRecords } from '../db/finance-mirror-store.ts'
import { parseInvoiceRecord } from '../db/invoice-store.ts'
import { AppError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { learnerFactsOf } from './learner-age.ts'
import { getInstitutionModules } from './modules.ts'
import { readScope } from './read-scope.ts'

/**
 * Yetişkin kursiyerin kendi sözleşmeleri (`GET /finance/students/:id/contracts`; IST-082,
 * docs/domain/finans.md DOM-FIN-059). Salt okunur: onay ve ek protokol bu uçta yoktur.
 *
 * Sıra kapsamı sızdırmaz: önce öğrencinin kendisi mi (core `scope.studentIds`, öğrenci bağlantısı),
 * sonra kurum türü; ikisi de değilse 404. Okulda uç yoktur (veli görür). Kursta 18 yaş altı
 * kursiyer kendi kaydındadır ama sözleşmenin tarafı velidir: 403 `adult_learner_only`; doğum tarihi
 * yalnız bu karar için okunur, yanıta ve loga girmez.
 */

export const ADULT_LEARNER_ONLY_MESSAGE =
  'Sözleşmeler velinizin hesabında görüntülenir; 18 yaşını doldurduğunuzda buradan da görebilirsiniz.'

export interface OwnContract {
  contract: ContractRecord
  status: ContractStatus
  plan: ContractPlanSummary
}

export async function listOwnContracts(
  ctx: ServiceContext,
  studentId: string,
): Promise<OwnContract[]> {
  const [scope, institution] = await Promise.all([
    readScope(ctx),
    getInstitutionModules(ctx.db, ctx.institutionId),
  ])
  if (!scope.studentIds.has(studentId)) throw new NotFoundError()
  const institutionType = institution?.type ?? 'school'
  if (!isCourse(institutionType)) throw new NotFoundError()
  const facts = (await learnerFactsOf(ctx.db, ctx.institutionId, [studentId])).get(studentId) ?? {}
  if (!learnerReadsOwnContracts(facts, { institutionType, now: ctx.now }))
    throw new AppError(403, 'adult_learner_only', ADULT_LEARNER_ONLY_MESSAGE)

  const ofStudent = {
    match: [{ kind: 'equals' as const, field: 'studentId', values: [studentId] }],
  }
  const contractRows = await loadFinanceRecords(ctx.db, ctx.institutionId, 'contracts', ofStudent)
  const invoiceRows = await loadFinanceRecords(ctx.db, ctx.institutionId, 'invoices', ofStudent)
  const contracts = contractRows.map((row) => parseContractRecord(row.data))
  const invoices = invoiceRows.map((row) => parseInvoiceRecord(row.data))
  return contracts
    .map((contract) => ({
      contract,
      status: contractStatus(contract, contracts),
      plan: contractPlanSummary(contract, contracts, invoices),
    }))
    .sort(
      (a, b) =>
        a.contract.date.localeCompare(b.contract.date) ||
        (a.contract.revision ?? 1) - (b.contract.revision ?? 1),
    )
}
