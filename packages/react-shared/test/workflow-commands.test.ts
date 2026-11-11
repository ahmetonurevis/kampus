import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'
import { WORKFLOW_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { runRequest } from '../src/api-result.ts'
import { collectionKeyPrefix, isUnreadableCollectionError } from '../src/collections.ts'
import {
  createCommandSession,
  invalidateInstitutionQueries,
  runCommand,
  type CommandHeaders,
} from '../src/commands.ts'
import { institutionKey } from '../src/query-keys.ts'
import { VERSION_CONFLICT_MESSAGE } from '../src/use-workflow-command.ts'
import {
  postWorkflowCommand,
  requireWorkflowCommand,
  workflowCommandPath,
  workflowInvalidates,
  workflowVersion,
  type WorkflowCommand,
  type WorkflowCommandInput,
} from '../src/workflow-commands.ts'

interface SentRequest {
  method: string
  url: URL
  headers: Headers
  body: unknown
}

/** Gerçek istemci + sahte fetch: istek kaydedilir, yanıtlar sırayla verilir. */
function workflowClient(replies: (() => Response | Error)[]) {
  const sent: SentRequest[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const text = await request.text()
      sent.push({
        method: request.method,
        url: new URL(request.url),
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      })
      const reply = replies.shift()
      if (!reply) throw new Error('beklenmeyen istek')
      const result = reply()
      if (result instanceof Error) throw result
      return result
    },
  })
  const execute =
    (command: WorkflowCommand) => (input: WorkflowCommandInput, headers: CommandHeaders) =>
      runRequest(() => postWorkflowCommand(client, command, input, headers))
  return { sent, execute }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const ok = (collection = 'mealMenus', id = 'meal-1') =>
  json(200, {
    data: {
      entity: { collection, id },
      changes: { inserted: 1, updated: 0, archived: 0, restored: 0 },
      records: [{ collection, id, version: 1, change: 'insert' }],
    },
  })

const conflict = () =>
  json(409, { code: 'version_conflict', message: 'Sürüm tutmadı.', requestId: 'r1' })

const invalid = () =>
  json(400, {
    code: 'validation_failed',
    message: 'Formda düzeltilmesi gereken alanlar var.',
    issues: [{ path: ['title'], code: 'too_small', message: 'En az iki karakter girin.' }],
    requestId: 'r2',
  })

function steps(execute: ReturnType<ReturnType<typeof workflowClient>['execute']>) {
  let refreshed = 0
  return {
    execute,
    version: workflowVersion,
    messages: { version_conflict: VERSION_CONFLICT_MESSAGE },
    refresh: async () => {
      refreshed += 1
    },
    refreshed: () => refreshed,
  }
}

describe('workflowCommandPath', () => {
  test('kimliksiz komut oluşturma yolu, kimlikli komut şablon yolu', () => {
    assert.equal(workflowCommandPath('meal'), '/api/v1/workflows/meal')
    assert.equal(workflowCommandPath('meal', 'm1'), '/api/v1/workflows/meal/{recordId}')
    assert.equal(
      workflowCommandPath('goal-review', 'g1'),
      '/api/v1/workflows/goal-review/{recordId}',
    )
  })
})

describe('workflowInvalidates', () => {
  test('komutun core tablosundaki bütün koleksiyonlarını tazeler', () => {
    const prefixes = workflowInvalidates('goal')
    assert.deepEqual(
      prefixes,
      WORKFLOW_COMMANDS.goal.collections.map((collection) => collectionKeyPrefix(collection)),
    )
    assert.ok(prefixes.some((prefix) => prefix[1] === 'studentGoals'))
    // Kulüp oluşturma kapsam kaynağı olan `clubs`'ı yazar; o da tazelenir.
    assert.ok(workflowInvalidates('club').some((prefix) => prefix[1] === 'clubs'))
  })

  test('yalnız etkin kurumun ilgili sorgularını geçersiz kılar', async () => {
    const queryClient = new QueryClient()
    const meals = institutionKey('inst-a', ...collectionKeyPrefix('mealMenus'), 'list', {})
    const other = institutionKey('inst-b', ...collectionKeyPrefix('mealMenus'), 'list', {})
    const grades = institutionKey('inst-a', ...collectionKeyPrefix('grades'), 'list', {})
    for (const key of [meals, other, grades]) queryClient.setQueryData(key, [])
    await invalidateInstitutionQueries(queryClient, 'inst-a', workflowInvalidates('meal'))
    const invalidated = (key: readonly unknown[]) =>
      queryClient.getQueryState(key)?.isInvalidated ?? false
    assert.equal(invalidated(meals), true)
    assert.equal(invalidated(other), false)
    assert.equal(invalidated(grades), false)
  })
})

describe('workflowVersion', () => {
  test('sürüm yalnız konusu olan komutta gönderilir', () => {
    assert.equal(workflowVersion({ recordId: 'm1', version: 3, body: {} }), 3)
    assert.equal(workflowVersion({ recordId: 'm1', body: {} }), null)
    assert.equal(workflowVersion({ version: 3, body: {} }), null)
  })
})

describe('requireWorkflowCommand', () => {
  test('bilinen komutu döndürür, bilinmeyeni ve yerleşik özellikleri reddeder', () => {
    assert.equal(requireWorkflowCommand('goal'), 'goal')
    assert.throws(() => requireWorkflowCommand('optik'))
    assert.throws(() => requireWorkflowCommand('toString'))
  })
})

describe('isUnreadableCollectionError', () => {
  test('403 ve 404 yardımcı koleksiyonu boş sayar; ağ ve 5xx sayılmaz', () => {
    const error = (status: number, code: string) => new ApiError({ status, code, message: 'x' })
    assert.equal(isUnreadableCollectionError(error(403, 'forbidden')), true)
    assert.equal(isUnreadableCollectionError(error(403, 'module_disabled')), true)
    assert.equal(isUnreadableCollectionError(error(404, 'not_found')), true)
    assert.equal(isUnreadableCollectionError(error(500, 'internal_error')), false)
    assert.equal(isUnreadableCollectionError(error(0, 'network_error')), false)
    assert.equal(isUnreadableCollectionError(new Error('x')), false)
  })
})

describe('postWorkflowCommand + runCommand', () => {
  test('oluşturma: kimliksiz yol, ham gövde, Idempotency-Key, If-Match yok', async () => {
    const { sent, execute } = workflowClient([() => ok()])
    const body = { branchId: 'b1', date: '2026-11-02', title: 'Mercimek çorbası' }
    const outcome = await runCommand(createCommandSession(), steps(execute('meal')), {
      body,
      version: 4,
    })
    assert.equal(outcome.status, 'success')
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.url.pathname, '/api/v1/workflows/meal')
    assert.deepEqual(sent[0]?.body, body)
    assert.ok(sent[0]?.headers.get('idempotency-key'))
    assert.equal(sent[0]?.headers.get('if-match'), null)
  })

  test('düzenleme: konu kimliği yolda, okunan sürüm If-Match ile', async () => {
    const { sent, execute } = workflowClient([() => ok()])
    await runCommand(createCommandSession(), steps(execute('meal')), {
      recordId: 'meal-1',
      version: 4,
      body: { title: 'Sebze çorbası' },
    })
    assert.equal(sent[0]?.url.pathname, '/api/v1/workflows/meal/meal-1')
    assert.equal(sent[0]?.headers.get('if-match'), '"4"')
  })

  test('veli: seçili çocuk ?childId= ile gider', async () => {
    const { sent, execute } = workflowClient([() => ok('schoolEvents', 'event-1')])
    await runCommand(createCommandSession(), steps(execute('consent')), {
      recordId: 'event-1',
      childId: 's2',
      body: { decision: 'Onaylandı' },
    })
    assert.equal(sent[0]?.url.pathname, '/api/v1/workflows/consent/event-1')
    assert.equal(sent[0]?.url.searchParams.get('childId'), 's2')
  })

  test('çift tıklama: ikinci gönderim istek atmaz', async () => {
    const { sent, execute } = workflowClient([() => ok()])
    const session = createCommandSession()
    const run = steps(execute('meal'))
    const input = { body: { title: 'Menü' } }
    const [first, second] = await Promise.all([
      runCommand(session, run, input),
      runCommand(session, run, input),
    ])
    assert.equal(first.status, 'success')
    assert.equal(second.status, 'busy')
    assert.equal(sent.length, 1)
  })

  test('ağ hatasından sonra aynı gövde aynı anahtarla yeniden gönderilir', async () => {
    const { sent, execute } = workflowClient([() => new TypeError('fetch failed'), () => ok()])
    const session = createCommandSession()
    const run = steps(execute('renewal'))
    const input = { body: { studentId: 's1', mode: 'renew' } }
    assert.equal((await runCommand(session, run, input)).status, 'failed')
    assert.equal((await runCommand(session, run, input)).status, 'success')
    assert.equal(sent[0]?.headers.get('idempotency-key'), sent[1]?.headers.get('idempotency-key'))
  })

  test('409 sürüm çakışması: sorgular tazelenir, Türkçe mesaj bildirilir', async () => {
    const { execute } = workflowClient([conflict])
    const run = steps(execute('meal'))
    const toasts: string[] = []
    const outcome = await runCommand(
      createCommandSession(),
      run,
      { recordId: 'meal-1', version: 1, body: {} },
      { notifyError: (message) => toasts.push(message) },
    )
    assert.equal(outcome.status, 'failed')
    assert.equal(run.refreshed(), 1)
    assert.deepEqual(toasts, [VERSION_CONFLICT_MESSAGE])
  })

  test('alan hataları setError ile forma yazılır', async () => {
    const { execute } = workflowClient([invalid])
    const fields: [string, string][] = []
    await runCommand(
      createCommandSession(),
      steps(execute('meal')),
      { body: {} },
      {
        setError: (name, error) => fields.push([name, error.message]),
        notifyError: () => undefined,
      },
    )
    assert.deepEqual(fields, [['title', 'En az iki karakter girin.']])
  })
})
