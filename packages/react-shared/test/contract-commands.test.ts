import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from '../src/api-result.ts'
import { collectionKeyPrefix } from '../src/collections.ts'
import {
  commandHeaders,
  createCommandSession,
  IF_MATCH_MISSING_CODE,
  invalidateInstitutionQueries,
  runCommand,
} from '../src/commands.ts'
import { institutionKey } from '../src/query-keys.ts'
import {
  amendContractRequest,
  approveContractRequest,
  cancelContractAmendmentRequest,
  CONTRACT_CHANGED_MESSAGE,
  CONTRACT_INVALIDATES,
  CONTRACT_MESSAGES,
  setContractSignatoryRequest,
  type ContractTarget,
} from '../src/use-contract-commands.ts'

interface Sent {
  method: string
  path: string
  headers: Headers
  body: unknown
}

const RESULT = {
  data: {
    entity: { collection: 'contracts', id: 'contract-s1' },
    changes: { inserted: 0, updated: 1, archived: 0, restored: 0 },
    records: [{ collection: 'contracts', id: 'contract-s1', version: 3, change: 'update' }],
  },
}

/** Gerçek istemci + sahte fetch: giden istek kaydedilir, yanıt sabittir. */
function fakeClient(status = 200, payload: unknown = RESULT) {
  const sent: Sent[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const text = await request.text()
      sent.push({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      })
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { client, sent }
}

const target = { contractId: 'contract-s1', version: 2 }

describe('sözleşme komutları', () => {
  test('IST-092: imza yetkilisi, onay, ek protokol ve iptal alt yollara anahtar ve If-Match ile gider', async () => {
    const { client, sent } = fakeClient()
    const headers = commandHeaders('key-12345', 2)
    const signatory = { name: 'Test Kurucu', role: 'founder' as const }
    const amend = {
      reason: 'Taksit sayısı değişti',
      installmentCount: 4,
      firstDueDate: '2026-10-05',
    }
    const cancel = { reason: 'Veli vazgeçti' }
    await runRequest(() =>
      setContractSignatoryRequest(client, { ...target, body: signatory }, headers),
    )
    await runRequest(() => approveContractRequest(client, target, headers))
    await runRequest(() => amendContractRequest(client, { ...target, body: amend }, headers))
    await runRequest(() =>
      cancelContractAmendmentRequest(client, { ...target, body: cancel }, headers),
    )
    assert.deepEqual(
      sent.map((item) => `${item.method} ${item.path}`),
      [
        'POST /api/v1/finance/contracts/contract-s1/signatory',
        'POST /api/v1/finance/contracts/contract-s1/approve',
        'POST /api/v1/finance/contracts/contract-s1/amendments',
        'POST /api/v1/finance/contracts/contract-s1/cancel-amendment',
      ],
    )
    for (const item of sent) {
      assert.equal(item.headers.get('if-match'), '"2"')
      assert.equal(item.headers.get('idempotency-key'), 'key-12345')
    }
    assert.deepEqual(sent[0]?.body, signatory)
    // DOM-FIN-010: onay gövdesi yalnız kabuldür; biçimi sunucu rolden belirler.
    assert.deepEqual(sent[1]?.body, { accepted: true })
    assert.deepEqual(sent[2]?.body, amend)
    assert.deepEqual(sent[3]?.body, cancel)
  })

  test('IST-092: okunan sürüm yoksa sözleşme komutlarının isteği atılmaz', async () => {
    const { client, sent } = fakeClient()
    const headers = commandHeaders('key-12345')
    const missing = (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === IF_MATCH_MISSING_CODE
    await assert.rejects(
      runRequest(() => approveContractRequest(client, target, headers)),
      missing,
    )
    await assert.rejects(
      runRequest(() =>
        setContractSignatoryRequest(
          client,
          { ...target, body: { name: 'Test Kurucu', role: 'founder' } },
          headers,
        ),
      ),
      missing,
    )
    assert.equal(sent.length, 0)
  })

  test('DOM-FIN-010: sürüm çakışması (409) sözleşme ve taksitleri tazeler, Türkçe mesaj verir', async () => {
    const { client } = fakeClient(409, {
      code: 'version_conflict',
      message: 'Kayıt değişti.',
      requestId: 'r1',
    })
    const queryClient = new QueryClient()
    const refreshed: (readonly unknown[])[] = []
    const errors: string[] = []
    const outcome = await runCommand(
      createCommandSession(() => 'key-67890'),
      {
        execute: (input: ContractTarget, headers) =>
          runRequest(() => approveContractRequest(client, input, headers)),
        version: (input) => input.version,
        refresh: async () => {
          refreshed.push(...CONTRACT_INVALIDATES)
          await invalidateInstitutionQueries(queryClient, 'kurum-1', CONTRACT_INVALIDATES)
        },
        messages: CONTRACT_MESSAGES,
      },
      target,
      { notifyError: (message) => errors.push(message) },
    )
    assert.equal(outcome.status, 'failed')
    assert.deepEqual(errors, [CONTRACT_CHANGED_MESSAGE])
    assert.deepEqual(refreshed, [
      collectionKeyPrefix('contracts'),
      collectionKeyPrefix('invoices'),
      ['payments'],
    ])
  })

  test('IST-092: tazeleme önekleri etkin kurumla geçersiz kılınır', async () => {
    const queryClient = new QueryClient()
    const contracts = institutionKey('kurum-1', ...collectionKeyPrefix('contracts'), 'list', {})
    const other = institutionKey('kurum-2', ...collectionKeyPrefix('contracts'), 'list', {})
    queryClient.setQueryData(contracts, 1)
    queryClient.setQueryData(other, 1)
    await invalidateInstitutionQueries(queryClient, 'kurum-1', CONTRACT_INVALIDATES)
    assert.equal(queryClient.getQueryState(contracts)?.isInvalidated, true)
    assert.equal(queryClient.getQueryState(other)?.isInvalidated, false)
  })
})
