import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import { commandFeedback, commandHeaders } from '../src/commands.ts'
import { fetchFileUrl, fileLabel } from '../src/files.ts'
import {
  archiveHomeworkRequest,
  createHomeworkRequest,
  fetchAllHomework,
  gradeSubmissionCommand,
  gradeSubmissionRequest,
  HOMEWORK_CHANGED_MESSAGE,
  HOMEWORK_INVALIDATES,
  HOMEWORK_MESSAGES,
  homeworkErrorField,
  homeworkListKey,
  homeworkListParams,
  homeworkStale,
  isHomeworkVersionConflict,
  SUBMISSION_CHANGED_MESSAGE,
  submitHomeworkBody,
  submitHomeworkRequest,
  updateHomeworkRequest,
} from '../src/homework.ts'

// IST-095 (DOM-AKD-070…074): ödev istekleri, If-Match / Idempotency-Key, süzgeçler, hata
// metinleri ve alanları.

interface Sent {
  method: string
  path: string
  search: URLSearchParams
  headers: Headers
  body: unknown
}

function fakeClient(reply: (sent: Sent) => Response) {
  const sent: Sent[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const text = await request.text()
      const url = new URL(request.url)
      const item = {
        method: request.method,
        path: url.pathname,
        search: url.searchParams,
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      }
      sent.push(item)
      return reply(item)
    },
  })
  return { client, sent }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const HW = 'hw-test-1'
const homework = (overrides: Record<string, unknown> = {}) => ({
  id: HW,
  version: 3,
  classId: 'c1',
  subjectId: 'math',
  subject: 'Matematik',
  teacherId: 't1',
  title: 'Kesirler',
  description: 'Sayfa 12',
  dueDate: '2026-12-01T20:59:00.000Z',
  allowLate: true,
  status: 'open',
  createdAt: '2026-11-01T06:00:00.000Z',
  updatedAt: '2026-11-01T06:00:00.000Z',
  ...overrides,
})
const submission = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub-test-1',
  version: 2,
  homeworkId: HW,
  studentId: 's1',
  note: 'Çözdüm',
  fileIds: [],
  fileName: '',
  submittedAt: '2026-11-02T06:00:00.000Z',
  late: false,
  score: null,
  feedback: '',
  gradedAt: null,
  updatedAt: '2026-11-02T06:00:00.000Z',
  ...overrides,
})
const error = (status: number, code: string, path?: (string | number)[]) =>
  new ApiError({
    status,
    code,
    message: 'Sunucu mesajı.',
    ...(path ? { issues: [{ path: path.map(String), code, message: 'x' }] } : {}),
  })

describe('ödev istekleri (IST-095)', () => {
  test('ödev verme Idempotency-Key taşır, If-Match göndermez (DOM-AKD-070)', async () => {
    const { client, sent } = fakeClient(() => json(201, { data: homework() }))
    const body = {
      classId: 'c1',
      subjectId: 'math',
      title: 'Kesirler',
      description: 'Sayfa 12',
      dueDate: '2026-12-01T23:59:00+03:00',
      allowLate: false,
    }
    await runRequest(() => createHomeworkRequest(client, body, commandHeaders('key-12345', 9)))
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/homework')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, body)
  })

  test('düzenleme ve arşiv ödevin sürümünü If-Match ile gönderir (DOM-AKD-071)', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: homework() }))
    const headers = commandHeaders('key-12345', 3)
    await runRequest(() =>
      updateHomeworkRequest(
        client,
        { homeworkId: HW, version: 3, body: { title: 'Yeni' } },
        headers,
      ),
    )
    await runRequest(() => archiveHomeworkRequest(client, { homeworkId: HW, version: 3 }, headers))
    assert.deepEqual(
      sent.map((item) => `${item.method} ${item.path}`),
      [`PATCH /api/v1/homework/${HW}`, `DELETE /api/v1/homework/${HW}`],
    )
    assert.ok(sent.every((item) => item.headers.get('if-match') === '"3"'))
    assert.ok(sent.every((item) => item.headers.get('idempotency-key') === 'key-12345'))
    assert.equal(sent[1]?.body, undefined)
  })

  test('teslim If-Match taşımaz; puanlama teslimin sürümünü gönderir (DOM-AKD-072, DOM-AKD-073)', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: submission() }))
    await runRequest(() =>
      submitHomeworkRequest(
        client,
        { homeworkId: HW, body: { note: 'Çözdüm', fileIds: ['f1'] } },
        commandHeaders('key-1'),
      ),
    )
    await runRequest(() =>
      gradeSubmissionRequest(
        client,
        {
          homeworkId: HW,
          submissionId: 'sub-test-1',
          version: 2,
          body: { score: 85, feedback: 'Güzel' },
        },
        commandHeaders('key-2', 2),
      ),
    )
    assert.equal(sent[0]?.path, `/api/v1/homework/${HW}/submissions`)
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-1')
    assert.deepEqual(sent[0]?.body, { note: 'Çözdüm', fileIds: ['f1'] })
    assert.equal(sent[1]?.path, `/api/v1/homework/${HW}/submissions/sub-test-1/grade`)
    assert.equal(sent[1]?.headers.get('if-match'), '"2"')
    assert.deepEqual(sent[1]?.body, { score: 85, feedback: 'Güzel' })
  })

  test('sürümsüz düzenleme, arşiv ve puanlama istek atmaz', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: homework() }))
    const missing = (caught: unknown) =>
      caught instanceof ApiError && caught.code === 'if_match_missing'
    await assert.rejects(
      () =>
        runRequest(() =>
          archiveHomeworkRequest(client, { homeworkId: HW, version: 3 }, commandHeaders('k')),
        ),
      missing,
    )
    await assert.rejects(
      () =>
        runRequest(() =>
          gradeSubmissionRequest(
            client,
            {
              homeworkId: HW,
              submissionId: 's',
              version: 1,
              body: { score: 1, feedback: 'ab' },
            },
            commandHeaders('k'),
          ),
        ),
      missing,
    )
    assert.equal(sent.length, 0)
  })

  test('teslim gövdesi boş notu ve boş dosya listesini göndermez', () => {
    assert.deepEqual(submitHomeworkBody({ note: '  ', fileIds: ['f1', 'f2'] }), {
      fileIds: ['f1', 'f2'],
    })
    assert.deepEqual(submitHomeworkBody({ note: ' Çözdüm ', fileIds: [] }), { note: 'Çözdüm' })
  })

  test('boş süzgeç ve `all` durumu gönderilmez; anahtar süzgeç sırasından bağımsızdır', () => {
    assert.deepEqual(homeworkListParams({ classId: '', subjectId: 'math', status: 'all' }), {
      subjectId: 'math',
    })
    assert.deepEqual(homeworkListParams({ status: 'open', page: 2, pageSize: 25 }), {
      status: 'open',
      page: 2,
      pageSize: 25,
    })
    assert.deepEqual(
      homeworkListKey({ subjectId: 'math', classId: 'c1' }),
      homeworkListKey({ classId: 'c1', subjectId: 'math' }),
    )
  })

  test('sınıfın bütün ödevleri sayfa sayfa ve süzgeçle okunur', async () => {
    const { client, sent } = fakeClient((item) => {
      const page = Number(item.search.get('page'))
      const rows =
        page === 1
          ? Array.from({ length: 100 }, (_, i) => ({
              ...homework({ id: `hw${i}` }),
              submissionCounts: { submitted: 0, graded: 0, late: 0 },
            }))
          : [{ ...homework(), submissionCounts: { submitted: 1, graded: 1, late: 0 } }]
      return json(200, { data: rows, meta: { page, pageSize: 100, total: 101 } })
    })
    const rows = await fetchAllHomework(client, { classId: 'c1' })
    assert.equal(rows.length, 101)
    assert.equal(sent.length, 2)
    assert.ok(sent.every((item) => item.search.get('classId') === 'c1'))
  })

  test('ödev yazması genel ödev ve teslim koleksiyonlarını da tazeler', () => {
    assert.deepEqual(
      HOMEWORK_INVALIDATES.map((key) => [...key]),
      [['homework'], ['collections', 'homework'], ['collections', 'submissions']],
    )
  })

  test('dosya bağlantısı istenince imzalı adres döner; adsız dosya sıra numarasıyla görünür', async () => {
    const { client, sent } = fakeClient(() =>
      json(200, {
        data: {
          url: 'https://api.kampus.test/x',
          expiresAt: '2026-11-02T06:05:00Z',
          listening: null,
        },
      }),
    )
    const link = await fetchFileUrl(client, 'file-1')
    assert.equal(link.url, 'https://api.kampus.test/x')
    assert.equal(sent[0]?.path, '/api/v1/files/file-1/url')
    assert.equal(fileLabel({ originalName: null }, 1), 'Dosya 2')
    assert.equal(fileLabel({ originalName: 'odev.pdf' }, 0), 'odev.pdf')
  })
})

describe('ödev hata metinleri ve alanları (DOM-AKD-070…073)', () => {
  const cases: [string, number, string][] = [
    ['homework_due_in_past', 422, 'geçmişte olamaz'],
    ['homework_has_submissions', 409, 'arşivlenemez'],
    ['homework_closed', 422, 'süresi doldu'],
    ['submission_graded', 409, 'değiştirilemez'],
    ['file_not_ready', 422, 'güvenlik denetiminden'],
    ['homework_not_owner', 403, 'öğretmeni değilsiniz'],
    ['version_conflict', 409, HOMEWORK_CHANGED_MESSAGE],
  ]
  for (const [code, status, expected] of cases)
    test(`${code} Türkçe mesaja eşlenir`, () => {
      const feedback = commandFeedback(error(status, code), HOMEWORK_MESSAGES)
      assert.ok(feedback.message?.includes(expected), feedback.message ?? 'mesaj yok')
    })

  test('puanlamada sürüm çakışması teslimin değiştiğini söyler', () => {
    const feedback = commandFeedback(
      error(409, 'version_conflict'),
      gradeSubmissionCommand.messages,
    )
    assert.equal(feedback.message, SUBMISSION_CHANGED_MESSAGE)
  })

  test('kural hataları formdaki alana bağlanır', () => {
    assert.equal(homeworkErrorField(error(422, 'homework_due_in_past'), 'homework'), 'dueDate')
    assert.equal(
      homeworkErrorField(error(422, 'homework_subject_required'), 'homework'),
      'subjectId',
    )
    assert.equal(
      homeworkErrorField(error(422, 'homework_teacher_unavailable'), 'homework'),
      'subjectId',
    )
    assert.equal(homeworkErrorField(error(422, 'record_inactive'), 'homework'), 'classId')
    assert.equal(homeworkErrorField(error(422, 'file_not_ready'), 'submit'), 'fileIds')
    assert.equal(homeworkErrorField(error(409, 'file_already_attached'), 'submit'), 'fileIds')
    assert.equal(
      homeworkErrorField(error(400, 'validation_failed', ['fileIds', 2]), 'submit'),
      'fileIds',
    )
    assert.equal(homeworkErrorField(error(400, 'validation_failed', ['score']), 'grade'), 'score')
    // Alan o formda yoksa toast: ödev formunda dosya alanı yoktur.
    assert.equal(homeworkErrorField(error(422, 'file_not_ready'), 'homework'), undefined)
    assert.equal(
      homeworkErrorField(error(403, 'homework_not_owner', ['title']), 'homework'),
      undefined,
    )
    assert.equal(homeworkErrorField(error(404, 'not_found'), 'grade'), undefined)
  })

  test('kayıt artık işleme kapalıysa hata formun içine yazılır', () => {
    assert.equal(homeworkErrorField(error(422, 'homework_closed'), 'submit'), 'root.server')
    assert.equal(homeworkErrorField(error(409, 'submission_graded'), 'submit'), 'root.server')
    assert.equal(
      homeworkErrorField(error(409, 'homework_has_submissions'), 'homework'),
      'root.server',
    )
  })

  test('404, sürüm çakışması, puanlanmış teslim ve kapanmış ödev ekranı tazeler', () => {
    assert.equal(homeworkStale(error(404, 'not_found')), true)
    assert.equal(homeworkStale(error(409, 'version_conflict')), true)
    assert.equal(homeworkStale(error(409, 'submission_graded')), true)
    assert.equal(homeworkStale(error(409, 'homework_has_submissions')), true)
    assert.equal(homeworkStale(error(422, 'homework_closed')), true)
    assert.equal(homeworkStale(error(422, 'homework_due_in_past')), false)
    assert.equal(homeworkStale(error(422, 'file_not_ready')), false)
    assert.equal(isHomeworkVersionConflict(error(409, 'version_conflict')), true)
    assert.equal(isHomeworkVersionConflict(error(409, 'submission_graded')), false)
  })
})
