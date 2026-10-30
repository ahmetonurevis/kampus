import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import { commandFeedback, commandHeaders } from '../src/commands.ts'
import {
  archiveRecordRequest,
  MANAGEMENT_MESSAGES,
  RECORD_CHANGED_MESSAGE,
  restoreRecordRequest,
  saveBranchRequest,
  saveClassRequest,
  saveTeacherRequest,
  transferredCounts,
} from '../src/use-management-commands.ts'

interface Sent {
  method: string
  path: string
  search: string
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
      const url = new URL(request.url)
      sent.push({
        method: request.method,
        path: url.pathname,
        search: url.search,
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      })
      return new Response(
        JSON.stringify({
          data: {
            entity: { collection: 'branches', id: 'b1' },
            changes: { inserted: 1, updated: 0, archived: 0, restored: 0 },
            records: [],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    },
  })
  return { client, sent }
}

const branch = { name: 'Çamlıca Kampüsü', address: 'Çamlıca Mah. 1. Sk. No: 2' }
const teacher = {
  name: 'Ayla Demir',
  email: 'ayla@kampus.example',
  phone: '05551112233',
  subjectId: 'math',
  branchId: 'b1',
}
const schoolClass = {
  grade: 7,
  section: 'D',
  branchId: 'b1',
  teacherId: 't1',
  capacity: 24,
  room: '209',
  subjectTeachers: { math: 't1' },
}

describe('kampüs, öğretmen ve sınıf kaydetme', () => {
  test('oluşturma POST gönderir ve If-Match taşımaz (DOM-YTK-001)', async () => {
    const { client, sent } = fakeClient()
    const headers = commandHeaders('key-12345', null)
    await runRequest(() => saveBranchRequest(client, { body: branch }, headers))
    await runRequest(() => saveTeacherRequest(client, { body: teacher }, headers))
    await runRequest(() => saveClassRequest(client, { body: schoolClass }, headers))
    assert.deepEqual(
      sent.map((item) => `${item.method} ${item.path}`),
      ['POST /api/v1/branches', 'POST /api/v1/teachers', 'POST /api/v1/classes'],
    )
    for (const item of sent) {
      assert.equal(item.headers.get('idempotency-key'), 'key-12345')
      assert.equal(item.headers.get('if-match'), null)
    }
    assert.deepEqual(sent[2]?.body, schoolClass)
  })

  test('düzenleme PATCH ile gider ve okunan sürümü If-Match olarak taşır', async () => {
    const { client, sent } = fakeClient()
    const headers = commandHeaders('key-12345', 4)
    await runRequest(() =>
      saveBranchRequest(client, { recordId: 'b1', version: 4, body: branch }, headers),
    )
    await runRequest(() =>
      saveTeacherRequest(client, { recordId: 't1', version: 4, body: teacher }, headers),
    )
    await runRequest(() =>
      saveClassRequest(client, { recordId: 'c1', version: 4, body: schoolClass }, headers),
    )
    assert.deepEqual(
      sent.map((item) => `${item.method} ${item.path}`),
      ['PATCH /api/v1/branches/b1', 'PATCH /api/v1/teachers/t1', 'PATCH /api/v1/classes/c1'],
    )
    for (const item of sent) assert.equal(item.headers.get('if-match'), '"4"')
  })
})

describe('arşivleme ve geri alma', () => {
  test('arşiv DELETE gönderir; aktarım hedefi sorguya yalnız doluysa girer', async () => {
    const { client, sent } = fakeClient()
    const headers = commandHeaders('key-12345')
    await runRequest(() =>
      archiveRecordRequest(client, 'class', { recordId: 'c1', replacementId: 'c2' }, headers),
    )
    await runRequest(() => archiveRecordRequest(client, 'teacher', { recordId: 't1' }, headers))
    await runRequest(() => archiveRecordRequest(client, 'branch', { recordId: 'b1' }, headers))
    assert.deepEqual(
      sent.map((item) => `${item.method} ${item.path}${item.search}`),
      [
        'DELETE /api/v1/classes/c1?replacementId=c2',
        'DELETE /api/v1/teachers/t1',
        'DELETE /api/v1/branches/b1',
      ],
    )
  })

  test('geri alma kimlikli restore ucuna POST gönderir', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      restoreRecordRequest(client, 'teacher', { recordId: 't1' }, commandHeaders('key-12345')),
    )
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/teachers/t1/restore')
  })

  test('aktarılan kayıtlar koleksiyona göre sayılır; konu kayıt sayılmaz', () => {
    const counts = transferredCounts({
      entity: { collection: 'classes', id: 'c1' },
      records: [
        { collection: 'classes', id: 'c1', change: 'archive' },
        { collection: 'students', id: 's1', change: 'update' },
        { collection: 'students', id: 's2', change: 'update' },
        { collection: 'schedule', id: 'l1', change: 'update' },
        { collection: 'students', id: 's3', change: 'insert' },
      ],
    })
    assert.deepEqual(counts, { students: 2, schedule: 1 })
  })
})

describe('hata geri bildirimi', () => {
  test('sürüm çakışması Türkçe mesaj verir ve tazelemeyi ister', () => {
    const feedback = commandFeedback(
      new ApiError({ status: 409, code: 'version_conflict', message: 'x' }),
      MANAGEMENT_MESSAGES,
    )
    assert.equal(feedback.message, RECORD_CHANGED_MESSAGE)
    assert.equal(feedback.refresh, true)
  })

  test('DOM-YTK-001: 422 core alan yolu kendiliğinden alana yazılmaz (fieldFor açık tercihtir)', () => {
    const feedback = commandFeedback(
      new ApiError({
        status: 422,
        code: 'subject_teacher_required',
        message: 'Matematik dersi için uygun branş öğretmeni seçin.',
        issues: [
          {
            path: ['subjectTeachers', 'math'],
            code: 'subject_teacher_required',
            message: 'Matematik dersi için uygun branş öğretmeni seçin.',
          },
        ],
      }),
      MANAGEMENT_MESSAGES,
    )
    assert.deepEqual(feedback.fieldIssues, [])
    assert.equal(feedback.message, 'Matematik dersi için uygun branş öğretmeni seçin.')
  })
})
