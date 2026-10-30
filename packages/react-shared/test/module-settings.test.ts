import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import {
  commandFeedback,
  commandHeaders,
  runCommand,
  createCommandSession,
} from '../src/commands.ts'
import {
  MODULE_CONFLICT_MESSAGE,
  MODULE_MESSAGES,
  MODULE_SETTINGS_KEY,
  MODULE_UNCHANGED_MESSAGE,
  moduleChangedMessage,
  moduleRows,
  moduleToggleRequest,
  type ModuleSettings,
} from '../src/module-settings.ts'
import { institutionKey } from '../src/query-keys.ts'

const settings: ModuleSettings = {
  version: 3,
  modules: [
    { key: 'finance', enabled: true },
    { key: 'meals', enabled: false },
    { key: 'yeni-modul', enabled: true },
  ],
}

describe('moduleRows', () => {
  test('sunucunun modüllerini core kataloğuyla birleştirir; katalogda olmayanı atlar', () => {
    const rows = moduleRows(settings)
    assert.deepEqual(
      rows.map((row) => [row.key, row.enabled]),
      [
        ['finance', true],
        ['meals', false],
      ],
    )
    assert.equal(rows[0]?.title, 'Finans & Tahsilat')
    assert.ok(rows[1]?.description.length)
  })

  test('boş liste boş satır verir', () => {
    assert.deepEqual(moduleRows({ version: 1, modules: [] }), [])
  })
})

describe('mesajlar', () => {
  test('eşzamanlı değişiklik Türkçe "başkası değiştirdi" mesajı verir ve tazelemeyi ister', () => {
    const conflict = new ApiError({ status: 409, code: 'version_conflict', message: 'Sunucu' })
    const feedback = commandFeedback(conflict, MODULE_MESSAGES)
    assert.equal(feedback.message, MODULE_CONFLICT_MESSAGE)
    assert.match(MODULE_CONFLICT_MESSAGE, /başka biri değiştirdi/)
    assert.equal(feedback.refresh, true)
  })

  test('durum zaten aynıysa module_unchanged mesajı gösterilir', () => {
    const unchanged = new ApiError({ status: 409, code: 'module_unchanged', message: 'Sunucu' })
    assert.equal(commandFeedback(unchanged, MODULE_MESSAGES).message, MODULE_UNCHANGED_MESSAGE)
  })

  test('başarı bildirimi açma ve kapatmayı ayırır', () => {
    assert.equal(moduleChangedMessage('Yemek Menüsü', false), 'Yemek Menüsü modülü kapatıldı.')
    assert.equal(moduleChangedMessage('Yemek Menüsü', true), 'Yemek Menüsü modülü açıldı.')
  })

  test('sorgu anahtarı etkin kurumla başlar', () => {
    assert.deepEqual(institutionKey('k1', ...MODULE_SETTINGS_KEY), [
      'inst',
      'k1',
      'module-settings',
    ])
  })
})

describe('moduleToggleRequest', () => {
  interface Sent {
    method: string
    path: string
    headers: Headers
    body: unknown
  }

  function client(reply: () => Response) {
    const sent: Sent[] = []
    const kampus = createKampusClient({
      baseUrl: 'https://api.kampus.test',
      credentials: 'include',
      requestId: () => undefined,
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input)
        sent.push({
          method: request.method,
          path: new URL(request.url).pathname,
          headers: request.headers,
          body: await request.json(),
        })
        return reply()
      },
    })
    return { kampus, sent }
  }

  const change = {
    moduleKey: 'meals',
    enabled: false,
    enabledModules: { meals: false },
    version: 4,
  }
  const ok = () => new Response(JSON.stringify({ data: change }), { status: 200 })

  test('PATCH gövdesi, If-Match ve Idempotency-Key başlıklarını gönderir', async () => {
    const { kampus, sent } = client(ok)
    const result = await runRequest(() =>
      moduleToggleRequest(
        kampus,
        { moduleKey: 'meals', enabled: false, version: 3 },
        commandHeaders('anahtar-12345', 3),
      ),
    )
    assert.deepEqual(result.data, change)
    assert.equal(sent.length, 1)
    assert.equal(sent[0]?.method, 'PATCH')
    assert.equal(sent[0]?.path, '/api/v1/modules/meals')
    assert.deepEqual(sent[0]?.body, { enabled: false })
    assert.equal(sent[0]?.headers.get('if-match'), '"3"')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'anahtar-12345')
  })

  test('409 çakışmada sonuç başarısızdır, mesaj Türkçedir ve tazeleme yapılır', async () => {
    const { kampus } = client(
      () =>
        new Response(
          JSON.stringify({ code: 'version_conflict', message: 'Sunucu', requestId: 'r1' }),
          { status: 409 },
        ),
    )
    let refreshed = 0
    const outcome = await runCommand(
      createCommandSession(() => 'anahtar-12345'),
      {
        execute: (input: { version: number }, headers) =>
          runRequest(() =>
            moduleToggleRequest(
              kampus,
              { moduleKey: 'meals', enabled: false, version: input.version },
              headers,
            ),
          ),
        version: (input) => input.version,
        refresh: async () => {
          refreshed += 1
        },
        messages: MODULE_MESSAGES,
      },
      { version: 3 },
      {
        notifyError: (message) => {
          assert.equal(message, MODULE_CONFLICT_MESSAGE)
        },
      },
    )
    assert.equal(outcome.status, 'failed')
    assert.equal(refreshed, 1)
  })
})
