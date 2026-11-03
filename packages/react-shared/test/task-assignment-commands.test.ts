import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import {
  commandFeedback,
  commandHeaders,
  IF_MATCH_MISSING_CODE,
  invalidateInstitutionQueries,
  routeFeedback,
} from '../src/commands.ts'
import { institutionKey } from '../src/query-keys.ts'
import { RUBRICS_KEY } from '../src/use-rubrics.ts'
import {
  createTaskAssignmentCommand,
  createTaskAssignmentRequest,
  TASK_ASSIGNMENT_CHANGED_MESSAGE,
  TASK_ASSIGNMENT_INVALIDATES,
  TASK_ASSIGNMENT_LICENSE_EXPIRED_MESSAGE,
  TASK_ASSIGNMENT_MESSAGES,
  TASK_ASSIGNMENTS_KEY,
  updateTaskAssignmentCommand,
  updateTaskAssignmentRequest,
  type TaskAssignmentBody,
} from '../src/use-task-assignments.ts'

// Görev atama komutları (DOM-KYN-032, DOM-BEC-041, 042, 044; IST-034): başlıklar ve geçersiz kılma.

interface Sent {
  method: string
  path: string
  headers: Headers
  body: unknown
}

/** Gerçek istemci + sahte fetch: giden istek kaydedilir, yanıt sabittir. */
function fakeClient() {
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
      return new Response(JSON.stringify({ data: {} }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { client, sent }
}

const assignment: TaskAssignmentBody = {
  resourceVersionId: 'rv-1',
  settings: {
    deadline: { dueAt: '2026-10-20T20:59:00.000Z' },
    submission: { submissionKind: 'text', maxVersions: 3 },
    rubricVersionId: 'rubv-1',
  },
  targets: [{ kind: 'class', id: '9-A' }],
}

const isMissing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === IF_MATCH_MISSING_CODE

describe('görev atama komutları', () => {
  test('IST-034: oluşturma POST eder, Idempotency-Key taşır, If-Match taşımaz', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      createTaskAssignmentRequest(client, assignment, commandHeaders('key-12345', 4)),
    )
    assert.equal(`${sent[0]?.method} ${sent[0]?.path}`, 'POST /api/v1/task-assignments')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, assignment)
  })

  test('DOM-BEC-044: son teslim değişikliği PATCH ile okunan sürümü If-Match olarak taşır', async () => {
    const { client, sent } = fakeClient()
    const patch = { deadline: { dueAt: '2026-10-27T20:59:00.000Z', lateAcceptanceDays: 2 } }
    await runRequest(() =>
      updateTaskAssignmentRequest(
        client,
        { assignmentId: 'a 1', version: 3, patch },
        commandHeaders('key-12345', 3),
      ),
    )
    assert.equal(`${sent[0]?.method} ${sent[0]?.path}`, 'PATCH /api/v1/task-assignments/a%201')
    assert.equal(sent[0]?.headers.get('if-match'), '"3"')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.deepEqual(sent[0]?.body, patch)
  })

  test('DOM-BEC-044: okunan sürüm yoksa değişiklik isteği atılmaz', async () => {
    const { client, sent } = fakeClient()
    await assert.rejects(
      runRequest(() =>
        updateTaskAssignmentRequest(
          client,
          { assignmentId: 'a1', version: 1, patch: {} },
          commandHeaders('key-12345'),
        ),
      ),
      isMissing,
    )
    assert.equal(sent.length, 0)
  })

  test('IST-034: oluşturma ve değişiklik exclusive çalışır; değişiklik sürümü girdiden okur', () => {
    assert.equal(createTaskAssignmentCommand.exclusive, true)
    assert.equal(updateTaskAssignmentCommand.exclusive, true)
    assert.equal(
      updateTaskAssignmentCommand.version({ assignmentId: 'a', version: 7, patch: {} }),
      7,
    )
    assert.equal(createTaskAssignmentCommand.messages, TASK_ASSIGNMENT_MESSAGES)
    assert.equal(TASK_ASSIGNMENT_MESSAGES.version_conflict, TASK_ASSIGNMENT_CHANGED_MESSAGE)
    assert.equal(
      updateTaskAssignmentCommand.messages.version_conflict,
      TASK_ASSIGNMENT_CHANGED_MESSAGE,
    )
  })

  test('DOM-KYN-021: lisansı dolmuş içerik Türkçe mesajla bildirilir; sayfayı yenilemek önerilmez', () => {
    const error = new ApiError({
      status: 409,
      code: 'resource_license_expired',
      message: 'Bu içeriğin lisans süresi dolmuş; atanamaz.',
    })
    const feedback = commandFeedback(error, createTaskAssignmentCommand.messages)
    assert.equal(feedback.message, TASK_ASSIGNMENT_LICENSE_EXPIRED_MESSAGE)
    assert.match(feedback.message ?? '', /lisans süresi dolduğu için atanamaz/)
    assert.doesNotMatch(feedback.message ?? '', /yenile/i)
  })

  test('IST-045, DOM-BEC-005: kaydı olmayan dinleme görevine seçilen hak Türkçe mesajla bildirilir', () => {
    const error = new ApiError({
      status: 422,
      code: 'listening_plays_unavailable',
      message: 'Sunucu metni',
      issues: [
        {
          path: ['settings', 'listeningPlays'],
          code: 'listening_plays_unavailable',
          message: 'Sunucu metni',
        },
      ],
    })
    const feedback = commandFeedback(error, createTaskAssignmentCommand.messages)
    assert.match(feedback.message ?? '', /dinleme kaydına bağlı içerikte/)
    assert.match(feedback.message ?? '', /Sınırsız/)
  })

  test('IST-034: oluşturmada 404 sunucunun mesajı ve issues yoluyla gösterilir; "Görev bulunamadı." yalnız değişiklikte', () => {
    const missingTarget = new ApiError({
      status: 404,
      code: 'not_found',
      message: 'Seçilen hedef bulunamadı.',
      issues: [
        { path: ['targets', '1'], code: 'target_not_found', message: 'Seçilen hedef bulunamadı.' },
      ],
    })
    const created = commandFeedback(missingTarget, createTaskAssignmentCommand.messages)
    assert.equal(created.message, 'Seçilen hedef bulunamadı.')
    // Form varken yollu hata alana gider, toast çıkmaz (exclusive).
    const routed = routeFeedback(missingTarget, created, { exclusive: true, hasForm: true })
    assert.equal(routed.message, null)
    assert.deepEqual(
      routed.fieldIssues.map((issue) => [issue.name, issue.message]),
      [['targets.1', 'Seçilen hedef bulunamadı.']],
    )
    // Yolsuz 404 (görünmeyen içerik) sunucunun genel mesajıyla tek toast olur.
    const missingContent = new ApiError({
      status: 404,
      code: 'not_found',
      message: 'İstenen kayıt bulunamadı.',
    })
    assert.equal(
      routeFeedback(
        missingContent,
        commandFeedback(missingContent, createTaskAssignmentCommand.messages),
        { exclusive: true, hasForm: true },
      ).message,
      'İstenen kayıt bulunamadı.',
    )
    assert.equal(
      commandFeedback(missingContent, updateTaskAssignmentCommand.messages).message,
      'Görev bulunamadı.',
    )
  })

  test('DOM-BEC-024: ikinci puanlama başlamışken son tarih değişikliği Türkçe metinle reddedilir', () => {
    const started = new ApiError({
      status: 409,
      code: 'second_rating_started',
      message: 'Sunucu mesajı.',
    })
    assert.equal(
      commandFeedback(started, updateTaskAssignmentCommand.messages).message,
      'İkinci puanlama başladı; son teslim tarihi artık değiştirilemez.',
    )
  })

  test('IST-034: yazma sonrası etkin kurumun atama ve rubrik sorguları geçersiz kılınır', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const list = institutionKey('inst-a', TASK_ASSIGNMENTS_KEY, 'list', { page: 1 })
    const detail = institutionKey('inst-a', TASK_ASSIGNMENTS_KEY, 'detail', 'a1')
    const rubric = institutionKey('inst-a', RUBRICS_KEY, 'detail', 'r1')
    const otherInstitution = institutionKey('inst-b', TASK_ASSIGNMENTS_KEY, 'list', { page: 1 })
    const unrelated = institutionKey('inst-a', 'students', 'list')
    const keys = [list, detail, rubric, otherInstitution, unrelated]
    for (const key of keys)
      await queryClient.fetchQuery({ queryKey: key, queryFn: () => 'x', staleTime: Infinity })
    const invalidated = () => keys.map((key) => queryClient.getQueryState(key)?.isInvalidated)
    assert.deepEqual(invalidated(), [false, false, false, false, false])
    await invalidateInstitutionQueries(queryClient, 'inst-a', TASK_ASSIGNMENT_INVALIDATES)
    assert.deepEqual(invalidated(), [true, true, true, false, false])
    queryClient.clear()
  })
})
