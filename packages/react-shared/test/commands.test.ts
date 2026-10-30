import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import { collectionKeyPrefix } from '../src/collections.ts'
import {
  commandFeedback,
  commandHeaders,
  createCommandSession,
  createIdempotencyTracker,
  invalidateInstitutionQueries,
  keepsIdempotencyKey,
  newIdempotencyKey,
  reportCommandError,
  routeCommandErrors,
  runCommand,
  stableFingerprint,
  type CommandHeaders,
  type CommandSteps,
} from '../src/commands.ts'
import { institutionKey } from '../src/query-keys.ts'
import type { PayInvoiceInput } from '../src/use-invoice-commands.ts'

// Sunucunun kabul ettiği anahtar biçimi (apps/api `IDEMPOTENCY_KEY_PATTERN`).
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

const apiError = (status: number, code: string, message = 'Sunucu mesajı.') =>
  new ApiError({ status, code, message })
const network = () => apiError(0, 'network_error')

function counter(prefix = 'key') {
  let next = 0
  return () => `${prefix}-${(next += 1)}`
}

describe('newIdempotencyKey', () => {
  test('UUID üretir; her çağrı farklıdır ve sunucu biçimine uyar', () => {
    const first = newIdempotencyKey()
    assert.match(first, KEY_PATTERN)
    assert.notEqual(first, newIdempotencyKey())
  })

  test('randomUUID yoksa (güvensiz bağlam) getRandomValues ile 32 hane üretir', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    const real = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: (bytes: Uint8Array) => real.getRandomValues(bytes) },
    })
    try {
      assert.match(newIdempotencyKey(), /^[0-9a-f]{32}$/)
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original)
    }
  })

  test('hiç güvenli üreteç yoksa açıkça hata verir', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined })
    try {
      assert.throws(() => newIdempotencyKey(), /rastgele/)
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original)
    }
  })
})

describe('stableFingerprint', () => {
  test('anahtar sırasından bağımsızdır, değer farkını yakalar', () => {
    assert.equal(
      stableFingerprint({ invoiceId: 'i1', method: 'Nakit', extra: { b: 1, a: 2 } }),
      stableFingerprint({ extra: { a: 2, b: 1 }, method: 'Nakit', invoiceId: 'i1' }),
    )
    assert.notEqual(
      stableFingerprint({ invoiceId: 'i1', method: 'Nakit' }),
      stableFingerprint({ invoiceId: 'i1', method: 'Kredi kartı' }),
    )
    assert.equal(stableFingerprint([2, 1]), '[2,1]')
  })

  test('gövdesiz komut boş özet verir', () => {
    assert.equal(stableFingerprint(undefined), '')
  })
})

describe('keepsIdempotencyKey', () => {
  test('ağ hatası, 5xx ve işlenmekte olan istek anahtarı korur', () => {
    for (const error of [network(), apiError(500, 'internal_error'), apiError(503, 'unavailable')])
      assert.equal(keepsIdempotencyKey(error), true, error.code)
    assert.equal(keepsIdempotencyKey(apiError(409, 'idempotency_in_progress')), true)
  })

  test('kesin sonuçlu hatalar ve ApiError olmayanlar anahtarı bırakır', () => {
    for (const error of [
      apiError(400, 'validation_failed'),
      apiError(403, 'forbidden'),
      apiError(409, 'invoice_already_paid'),
      apiError(422, 'idempotency_key_reused'),
    ])
      assert.equal(keepsIdempotencyKey(error), false, error.code)
    assert.equal(keepsIdempotencyKey(new TypeError('x')), false)
  })
})

describe('createIdempotencyTracker', () => {
  test('ağ hatasından sonra aynı gövdenin yeniden gönderimi aynı anahtarı kullanır', () => {
    const tracker = createIdempotencyTracker(counter())
    assert.equal(tracker.keyFor('a'), 'key-1')
    tracker.fail(network())
    assert.equal(tracker.keyFor('a'), 'key-1')
  })

  test('başarıdan sonra yeni eylem yeni anahtar alır', () => {
    const tracker = createIdempotencyTracker(counter())
    tracker.keyFor('a')
    tracker.succeed()
    assert.equal(tracker.keyFor('a'), 'key-2')
  })

  test('kesin hatadan sonra yeni anahtar; gövde değişirse belirsiz hatada bile yeni anahtar', () => {
    const tracker = createIdempotencyTracker(counter())
    tracker.keyFor('a')
    tracker.fail(apiError(409, 'invoice_already_paid'))
    assert.equal(tracker.keyFor('a'), 'key-2')
    tracker.fail(network())
    assert.equal(tracker.keyFor('b'), 'key-3')
  })
})

describe('commandHeaders', () => {
  test('anahtar her zaman, If-Match yalnız sürüm verilince', () => {
    assert.deepEqual(commandHeaders('k1'), { 'idempotency-key': 'k1' })
    assert.deepEqual(commandHeaders('k1', null), { 'idempotency-key': 'k1' })
    assert.deepEqual(commandHeaders('k1', 4), { 'idempotency-key': 'k1', 'if-match': '"4"' })
  })
})

describe('commandFeedback ve reportCommandError', () => {
  test('401 bildirim üretmez (oturum katmanı yönlendirir)', () => {
    assert.equal(commandFeedback(apiError(401, 'unauthenticated')).message, null)
  })

  test('koda özgü mesaj sunucu mesajının yerine geçer; 409 sorguları tazeletir', () => {
    const feedback = commandFeedback(apiError(409, 'invoice_already_paid'), {
      invoice_already_paid: 'Zaten ödenmiş.',
    })
    assert.equal(feedback.message, 'Zaten ödenmiş.')
    assert.equal(feedback.refresh, true)
    assert.equal(commandFeedback(apiError(409, 'idempotency_in_progress')).refresh, false)
    assert.equal(commandFeedback(apiError(422, 'rule')).refresh, false)
  })

  test('alan maddeleri setError ile, mesaj toast ile gider', () => {
    const error = new ApiError({
      status: 400,
      code: 'validation_failed',
      message: 'Formda düzeltilmesi gereken alanlar var.',
      issues: [
        { path: ['method'], code: 'too_small', message: 'Ödeme yöntemini seçin.' },
        { path: [], code: 'custom', message: 'Genel.' },
      ],
    })
    const fields: [string, string][] = []
    const toasts: string[] = []
    reportCommandError(error, commandFeedback(error), {
      setError: (name, { message }) => fields.push([name, message]),
      notifyError: (message) => toasts.push(message),
    })
    // Yolsuz madde alana yazılmaz; form düzeyi mesaj toast'tır.
    assert.deepEqual(fields, [['method', 'Ödeme yöntemini seçin.']])
    assert.deepEqual(toasts, ['Formda düzeltilmesi gereken alanlar var.'])
  })

  test('bildirim yoksa mesaj formun root.server alanına yazılır', () => {
    const error = apiError(403, 'forbidden', 'Bu işlem için yetkiniz yok.')
    const fields: [string, string][] = []
    reportCommandError(error, commandFeedback(error), {
      setError: (name, { message }) => fields.push([name, message]),
    })
    assert.deepEqual(fields, [['root.server', 'Bu işlem için yetkiniz yok.']])
  })
})

describe('routeCommandErrors', () => {
  const route = (error: ApiError, routes: Parameters<typeof routeCommandErrors>[1]) => {
    const fields: [string, string][] = []
    const toasts: string[] = []
    const targets = routeCommandErrors(
      {
        setError: (name, { message }) => fields.push([name, message]),
        notifyError: (message) => toasts.push(message),
      },
      routes,
    )
    reportCommandError(error, commandFeedback(error), targets)
    return { fields, toasts }
  }

  test('alana bağlanan kod yalnız alan altında görünür, toast çıkmaz', () => {
    const error = apiError(409, 'branch_name_taken', 'Bu kampüs adı kullanılıyor.')
    const { fields, toasts } = route(error, {
      fieldFor: (error) => (error.code === 'branch_name_taken' ? 'name' : undefined),
    })
    assert.deepEqual(fields, [['name', 'Bu kampüs adı kullanılıyor.']])
    assert.deepEqual(toasts, [])
  })

  test('formun kendi bildirdiği hata toast üretmez; bağlanmayan hata yalnız toast olur', () => {
    const conflict = apiError(409, 'version_conflict', 'Kayıt değişti.')
    const silent = route(conflict, { silent: (error) => error.code === 'version_conflict' })
    assert.deepEqual(silent, { fields: [], toasts: [] })

    const other = apiError(500, 'internal', 'Beklenmeyen hata.')
    const result = route(other, { fieldFor: () => undefined })
    assert.deepEqual(result, { fields: [], toasts: ['Beklenmeyen hata.'] })
  })

  test('bildirim yoksa mesaj root.server alanında kalır', () => {
    const error = apiError(403, 'forbidden', 'Yetkiniz yok.')
    const fields: [string, string][] = []
    const targets = routeCommandErrors(
      { setError: (name, { message }) => fields.push([name, message]) },
      { fieldFor: () => 'name' },
    )
    reportCommandError(error, commandFeedback(error), targets)
    assert.deepEqual(fields, [['root.server', 'Yetkiniz yok.']])
  })
})

describe('invalidateInstitutionQueries', () => {
  test('yalnız etkin kurumun önekli sorgularını geçersiz kılar', async () => {
    const queryClient = new QueryClient()
    const own = institutionKey('inst-a', ...collectionKeyPrefix('invoices'), 'list', {})
    const item = institutionKey('inst-a', ...collectionKeyPrefix('invoices'), 'item', 'i1')
    const other = institutionKey('inst-b', ...collectionKeyPrefix('invoices'), 'list', {})
    const students = institutionKey('inst-a', ...collectionKeyPrefix('students'), 'list', {})
    for (const key of [own, item, other, students]) queryClient.setQueryData(key, [])

    await invalidateInstitutionQueries(queryClient, 'inst-a', [collectionKeyPrefix('invoices')])

    const invalidated = (key: readonly unknown[]) =>
      queryClient.getQueryState(key)?.isInvalidated ?? false
    assert.equal(invalidated(own), true)
    assert.equal(invalidated(item), true)
    assert.equal(invalidated(other), false)
    assert.equal(invalidated(students), false)
  })
})

/** Gerçek istemci + sahte fetch: gönderilen başlıklar kaydedilir, yanıtlar sırayla verilir. */
function payClient(replies: (() => Response | Error)[]) {
  const sent: Headers[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      sent.push(request.headers)
      const reply = replies.shift()
      if (!reply) throw new Error('beklenmeyen istek')
      const result = reply()
      if (result instanceof Error) throw result
      return result
    },
  })
  const execute = (input: PayInvoiceInput, header: CommandHeaders) =>
    runRequest(() =>
      client.POST('/api/v1/invoices/{invoiceId}/pay', {
        params: { path: { invoiceId: input.invoiceId }, header },
        body: { method: input.method },
      }),
    )
  return { sent, execute }
}

const ok = () =>
  new Response(
    JSON.stringify({
      data: {
        entity: { collection: 'invoices', id: 'i1' },
        changes: { inserted: 0, updated: 1, archived: 0, restored: 0 },
        records: [{ collection: 'invoices', id: 'i1', version: 2, change: 'update' }],
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

const conflict = () =>
  new Response(
    JSON.stringify({
      code: 'invoice_already_paid',
      message: 'Bu taksit zaten ödenmiş.',
      requestId: 'r1',
    }),
    { status: 409, headers: { 'content-type': 'application/json' } },
  )

function steps<TVariables, TData>(
  execute: CommandSteps<TVariables, TData>['execute'],
  extra: Partial<CommandSteps<TVariables, TData>> = {},
): CommandSteps<TVariables, TData> & { refreshed: () => number } {
  let refreshed = 0
  return {
    execute,
    refresh: async () => {
      refreshed += 1
    },
    refreshed: () => refreshed,
    ...extra,
  }
}

describe('runCommand', () => {
  const payment: PayInvoiceInput = { invoiceId: 'i1', method: 'Nakit' }

  test('ağ hatasından sonra yeniden gönderim aynı Idempotency-Key ile gider', async () => {
    const { sent, execute } = payClient([() => new TypeError('fetch failed'), ok, ok])
    const session = createCommandSession(counter('uuid'))
    const toasts: string[] = []
    const run = steps(execute)

    const failed = await runCommand(session, run, payment, { notifyError: (m) => toasts.push(m) })
    assert.equal(failed.status, 'failed')
    assert.equal(toasts.length, 1, 'ağ hatası kullanıcıya bildirilir')

    const retried = await runCommand(session, run, payment)
    assert.equal(retried.status, 'success')
    if (retried.status === 'success') assert.equal(retried.data.data.records[0]?.version, 2)

    // Başarıdan sonraki eylem yeni anahtar alır.
    await runCommand(session, run, payment)
    assert.deepEqual(
      sent.map((headers) => headers.get('idempotency-key')),
      ['uuid-1', 'uuid-1', 'uuid-2'],
    )
    assert.equal(sent[0]?.get('if-match'), null)
  })

  test('sürüm verilirse If-Match gönderilir', async () => {
    const { sent, execute } = payClient([ok])
    await runCommand(createCommandSession(), steps(execute, { version: () => 7 }), payment)
    assert.equal(sent[0]?.get('if-match'), '"7"')
    assert.match(sent[0]?.get('idempotency-key') ?? '', KEY_PATTERN)
  })

  test('gönderim sürerken ikinci çağrı istek atmaz (çift tıklama)', async () => {
    let calls = 0
    let release: () => void = () => undefined
    const session = createCommandSession()
    const run = steps(async () => {
      calls += 1
      await new Promise<void>((resolve) => (release = resolve))
      return 'ok'
    })

    const first = runCommand(session, run, payment)
    const second = await runCommand(session, run, payment)
    assert.deepEqual(second, { status: 'busy' })
    release()
    assert.deepEqual(await first, { status: 'success', data: 'ok' })
    assert.equal(calls, 1)
    // Kilit sonuçtan sonra açılır.
    const third = runCommand(session, run, payment)
    release()
    assert.equal((await third).status, 'success')
    assert.equal(calls, 2)
  })

  test('409 mükerrer ödeme: sorgular tazelenir, Türkçe mesaj bildirilir, kilit açılır', async () => {
    const { execute } = payClient([conflict])
    const session = createCommandSession()
    const toasts: string[] = []
    const run = steps(execute, { messages: { invoice_already_paid: 'Liste güncellendi.' } })

    const outcome = await runCommand(session, run, payment, {
      notifyError: (message) => toasts.push(message),
    })

    assert.equal(outcome.status, 'failed')
    if (outcome.status === 'failed') assert.equal(outcome.error.code, 'invoice_already_paid')
    assert.equal(run.refreshed(), 1)
    assert.deepEqual(toasts, ['Liste güncellendi.'])
    assert.equal(session.locked, false)
  })

  test('ApiError olmayan hata genel Türkçe hataya çevrilir, tazeleme yapılmaz', async () => {
    const run = steps(async () => {
      throw new RangeError('programlama hatası')
    })
    const toasts: string[] = []
    const outcome = await runCommand(createCommandSession(), run, payment, {
      notifyError: (message) => toasts.push(message),
    })
    assert.equal(outcome.status, 'failed')
    if (outcome.status === 'failed') assert.equal(outcome.error.code, 'unexpected_error')
    assert.equal(run.refreshed(), 0)
    assert.deepEqual(toasts, ['Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.'])
  })
})
