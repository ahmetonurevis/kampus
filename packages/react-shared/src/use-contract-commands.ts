import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'

// Sözleşme onayı ve ek protokol komutları (`POST /finance/contracts/:id/{signatory,approve,
// amendments,cancel-amendment}`; core `contract.sign` `contract.approve` `contract.amend`; IST-092,
// docs/domain/finans.md DOM-FIN-010, -012, -051). Okuma genel koleksiyon kancalarındadır
// (`contracts`). Her komut `Idempotency-Key` ve konunun okunan sürümünü `If-Match` olarak taşır,
// sürüm yoksa istek atılmaz (`requireIfMatch`): onaylanan belge ödeyicinin gördüğü sürümdür. Onay
// taze oturum ister (403 `reauthentication_required`); ekran parolayı `useReauthRetry` ile sorar.
// Hepsi `exclusive`: yollu `issues` (`name`, `role`, `reason`, `firstDueDate`, `discounts`) yalnız
// form alanında görünür, yolsuz hata tek toast olur.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type ContractSignatoryBody = JsonBody<'setContractSignatory'>
export type AmendContractBody = JsonBody<'amendContract'>
export type CancelContractAmendmentBody = JsonBody<'cancelContractAmendment'>

/** Komutun konusu: sözleşme sürümünün kimliği ve okunan kayıt sürümü. */
export interface ContractTarget {
  contractId: string
  version: number
}
export type SetContractSignatoryInput = ContractTarget & { body: ContractSignatoryBody }
export type AmendContractInput = ContractTarget & { body: AmendContractBody }
export type CancelContractAmendmentInput = ContractTarget & { body: CancelContractAmendmentBody }

export const CONTRACT_CHANGED_MESSAGE =
  'Sözleşme başka biri tarafından değiştirildi. Güncel sürüm yüklendi.'

export const CONTRACT_MESSAGES = {
  version_conflict: CONTRACT_CHANGED_MESSAGE,
  contract_already_approved: 'Sözleşme zaten onaylanmış. Güncel durum yüklendi.',
} as const satisfies CommandMessages

/**
 * Onay, ek protokol onayında yeni planı taksitlere geçirir; tahsilat toplamları da (`payments`
 * öneki) tazelenir. Liste ve panel aynı öneklerle birlikte güncellenir.
 */
export const CONTRACT_INVALIDATES = [
  collectionKeyPrefix('contracts'),
  collectionKeyPrefix('invoices'),
  ['payments'],
] as const

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function setContractSignatoryRequest(
  client: KampusClient,
  input: SetContractSignatoryInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/finance/contracts/{contractId}/signatory', {
    params: { path: { contractId: input.contractId }, header: versioned(headers) },
    body: input.body,
  })
}

/** Gövde yalnız kabuldür; biçimi (elektronik/ıslak imza) sunucu oturumun rolünden belirler. */
export function approveContractRequest(
  client: KampusClient,
  input: ContractTarget,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/finance/contracts/{contractId}/approve', {
    params: { path: { contractId: input.contractId }, header: versioned(headers) },
    body: { accepted: true },
  })
}

/** `version` önceki (onaylı) sürümündür; yanıtın konusu (`entity`) yeni ek protokoldür. */
export function amendContractRequest(
  client: KampusClient,
  input: AmendContractInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/finance/contracts/{contractId}/amendments', {
    params: { path: { contractId: input.contractId }, header: versioned(headers) },
    body: input.body,
  })
}

export function cancelContractAmendmentRequest(
  client: KampusClient,
  input: CancelContractAmendmentInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/finance/contracts/{contractId}/cancel-amendment', {
    params: { path: { contractId: input.contractId }, header: versioned(headers) },
    body: input.body,
  })
}

const contractCommand = <TInput extends ContractTarget>() => ({
  invalidates: CONTRACT_INVALIDATES,
  version: (input: TInput) => input.version,
  messages: CONTRACT_MESSAGES,
  exclusive: true,
})

export function useSetContractSignatory() {
  return useApiCommand({
    request: setContractSignatoryRequest,
    ...contractCommand<SetContractSignatoryInput>(),
  })
}

export function useApproveContract() {
  return useApiCommand({ request: approveContractRequest, ...contractCommand<ContractTarget>() })
}

export function useAmendContract() {
  return useApiCommand({ request: amendContractRequest, ...contractCommand<AmendContractInput>() })
}

export function useCancelContractAmendment() {
  return useApiCommand({
    request: cancelContractAmendmentRequest,
    ...contractCommand<CancelContractAmendmentInput>(),
  })
}
