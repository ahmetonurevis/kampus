import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError, networkApiError } from '@kampus/api-client/errors.ts'
import { ASSESSMENT_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { runRequest } from '../src/api-result.ts'
import {
  FILE_TOO_LARGE_MESSAGE,
  fileFailure,
  isFieldFailure,
  planChanges,
} from '../src/assessment-feedback.ts'
import { collectionKeyPrefix } from '../src/collections.ts'
import {
  commandFeedback,
  commandHeaders,
  createCommandSession,
  runCommand,
  type CommandHeaders,
} from '../src/commands.ts'
import {
  addAvailabilitySlotRequest,
  ASSESSMENT_MESSAGES,
  confirmTutoringPlanRequest,
  evaluateOpticalRequest,
  EVALUATION_STALE_CODE,
  NOTHING_TO_CREATE_CODE,
  removeAvailabilitySlotRequest,
  saveOpticalProfileRequest,
  TUTORING_PLAN_STALE_CODE,
} from '../src/use-assessment-commands.ts'

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
      return new Response(
        JSON.stringify({
          data: {
            entity: { collection: 'opticalEvaluations', id: 'x' },
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

const profileBody = {
  examId: 'exam-7-1',
  title: 'Deneme profili',
  format: 'csv',
  identifier: 'number',
  headerLines: 1,
  studentStart: 1,
  studentLength: 7,
  bookletStart: 8,
  bookletLength: 1,
  answersStart: 9,
  answersLength: 12,
  keyCsv: 'booklet;question;subjectId;topic;answer\nA;1;math;Denklemler;B',
} as const

describe('optik ve etüt komutları', () => {
  test('değerlendirme kaydı önizlemenin özetini ve Idempotency-Key gönderir; If-Match gitmez', async () => {
    const { client, sent } = fakeClient()
    const digest = 'a'.repeat(64)
    await runRequest(() =>
      evaluateOpticalRequest(
        client,
        { profileId: 'optical-exam-7-1', text: 'student;booklet;answers', expectedDigest: digest },
        commandHeaders('key-12345', 3),
      ),
    )
    assert.equal(sent[0]?.path, '/api/v1/assessment/evaluate')
    assert.deepEqual(sent[0]?.body, {
      profileId: 'optical-exam-7-1',
      text: 'student;booklet;answers',
      expectedDigest: digest,
    })
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
  })

  test('profil oluşturma kimliksiz yola, güncelleme kimlikli yola ve If-Match ile gider', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      saveOpticalProfileRequest(client, { body: profileBody }, commandHeaders('key-1', 4)),
    )
    await runRequest(() =>
      saveOpticalProfileRequest(
        client,
        { recordId: 'optical-exam-7-1', version: 4, body: profileBody },
        commandHeaders('key-2', 4),
      ),
    )
    assert.equal(sent[0]?.path, '/api/v1/assessment/profile')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.equal(sent[1]?.path, '/api/v1/assessment/profile/optical-exam-7-1')
    assert.equal(sent[1]?.headers.get('if-match'), '"4"')
    assert.deepEqual(sent[1]?.body, profileBody)
  })

  test('plan onayı önizlemedeki planı gönderir', async () => {
    const { client, sent } = fakeClient()
    const body = {
      examId: 'exam-7-1',
      threshold: 70,
      fromDate: '2026-11-02',
      toDate: '2026-11-09',
      duration: 30,
      maxGroupSize: 6,
      branchId: '',
      subjectId: '',
      expectedPlan: '{"sessions":[]}',
    }
    await runRequest(() => confirmTutoringPlanRequest(client, body, commandHeaders('key-3')))
    assert.equal(sent[0]?.path, '/api/v1/assessment/plan')
    assert.deepEqual(sent[0]?.body, body)
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-3')
  })

  test('uygunluk saati eklenir ve sürümle kaldırılır', async () => {
    const { client, sent } = fakeClient()
    const slot = { teacherId: 't1', date: '2026-11-03T10:00:00.000Z', duration: 30 }
    await runRequest(() => addAvailabilitySlotRequest(client, slot, commandHeaders('key-4')))
    await runRequest(() =>
      removeAvailabilitySlotRequest(client, { slotId: 'slot-t1-0' }, commandHeaders('key-5', 2)),
    )
    assert.equal(sent[0]?.path, '/api/v1/assessment/slot')
    assert.deepEqual(sent[0]?.body, slot)
    assert.equal(sent[1]?.path, '/api/v1/assessment/slot-remove/slot-t1-0')
    assert.deepEqual(sent[1]?.body, {})
    assert.equal(sent[1]?.headers.get('if-match'), '"2"')
  })

  test('komutların tazeleyeceği koleksiyonlar core komut tablosundandır', () => {
    assert.ok(ASSESSMENT_COMMANDS.plan.collections.includes('tutorSessions'))
    assert.ok(ASSESSMENT_COMMANDS.evaluate.collections.includes('opticalEvaluations'))
    assert.deepEqual(collectionKeyPrefix('availability'), collectionKeyPrefix('availability'))
  })
})

describe('Idempotency-Key yaşam döngüsü', () => {
  function steps(replies: (() => unknown)[], keys: string[]) {
    return {
      execute: async (_variables: unknown, headers: CommandHeaders) => {
        keys.push(headers['idempotency-key'])
        const next = replies.shift()
        if (!next) throw new Error('beklenmeyen çağrı')
        return next()
      },
      refresh: async () => undefined,
      messages: ASSESSMENT_MESSAGES,
    }
  }

  test('ağ hatasında yeniden deneme aynı anahtarla gider; başarıdan sonra yeni eylem yeni anahtar alır', async () => {
    let counter = 0
    const session = createCommandSession(() => `key-${++counter}`)
    const keys: string[] = []
    const body = { profileId: 'p', text: 'a', expectedDigest: 'd' }
    const run = steps(
      [
        () => {
          throw networkApiError(new Error('koptu'))
        },
        () => 'tamam',
        () => 'tamam',
      ],
      keys,
    )
    const first = await runCommand(session, run, body)
    assert.equal(first.status, 'failed')
    assert.equal((await runCommand(session, run, body)).status, 'success')
    assert.equal((await runCommand(session, run, body)).status, 'success')
    assert.deepEqual(keys, ['key-1', 'key-1', 'key-2'])
  })

  test('bayat önizleme (409) kesin hatadır: yeniden önizlenen gövde yeni anahtar alır', async () => {
    let counter = 0
    const session = createCommandSession(() => `key-${++counter}`)
    const keys: string[] = []
    const run = steps(
      [
        () => {
          throw new ApiError({ status: 409, code: EVALUATION_STALE_CODE, message: 'x' })
        },
        () => 'tamam',
      ],
      keys,
    )
    await runCommand(session, run, { profileId: 'p', text: 'a', expectedDigest: 'd1' })
    await runCommand(session, run, { profileId: 'p', text: 'a', expectedDigest: 'd2' })
    assert.deepEqual(keys, ['key-1', 'key-2'])
  })
})

describe('hata iletileri', () => {
  test('bayat değerlendirme Türkçe "yeniden önizleyin" iletisine eşlenir ve tazeler', () => {
    const feedback = commandFeedback(
      new ApiError({ status: 409, code: EVALUATION_STALE_CODE, message: 'x' }),
      ASSESSMENT_MESSAGES,
    )
    assert.match(feedback.message ?? '', /Veri değişti.*yeniden önizleyip/)
    assert.equal(feedback.refresh, true)
  })

  test('bayat plan ve boş plan iletileri', () => {
    const stale = commandFeedback(
      new ApiError({ status: 409, code: TUTORING_PLAN_STALE_CODE, message: 'x' }),
      ASSESSMENT_MESSAGES,
    )
    assert.match(stale.message ?? '', /Etüt planı değişmiş/)
    const empty = commandFeedback(
      new ApiError({ status: 422, code: NOTHING_TO_CREATE_CODE, message: 'x' }),
      ASSESSMENT_MESSAGES,
    )
    assert.match(empty.message ?? '', /yeni etüt kalmadı/)
    assert.equal(empty.refresh, false)
  })

  test('dosya hatası satır numarasını alan iletisine taşır', () => {
    const error = new ApiError({
      status: 422,
      code: 'optical_student_unmatched',
      message: 'Ham ileti',
      issues: [
        {
          path: ['text', 'line', 7],
          code: 'optical_student_unmatched',
          message: '7. satırdaki öğrenci tekil eşleşmedi: 99.',
        },
      ],
    })
    assert.deepEqual(fileFailure(error, 'text'), {
      field: 'text',
      line: 7,
      message: '7. satırdaki öğrenci tekil eşleşmedi: 99.',
    })
    // Ileti satırı içermiyorsa başa eklenir.
    const bare = new ApiError({
      status: 422,
      code: 'csv_column_count',
      message: 'x',
      issues: [
        { path: ['keyCsv', 'line', 4], code: 'csv_column_count', message: 'Sütun sayısı hatalı.' },
      ],
    })
    assert.equal(fileFailure(bare, 'keyCsv')?.message, '4. satır: Sütun sayısı hatalı.')
    assert.equal(fileFailure(bare, 'text'), null)
  })

  test('1 MB aşımı (413) alan hatasıdır; diğer hatalar alan hatası değildir', () => {
    const large = new ApiError({ status: 413, code: 'payload_too_large', message: 'x' })
    assert.equal(fileFailure(large, 'text')?.message, FILE_TOO_LARGE_MESSAGE)
    assert.equal(isFieldFailure(large), true)
    assert.equal(isFieldFailure(new ApiError({ status: 422, code: 'a', message: 'x' })), true)
    assert.equal(isFieldFailure(new ApiError({ status: 409, code: 'a', message: 'x' })), false)
    assert.equal(isFieldFailure(new ApiError({ status: 400, code: 'a', message: 'x' })), false)
    const invalid = new ApiError({
      status: 400,
      code: 'validation_error',
      message: 'x',
      issues: [{ path: ['threshold'], code: 'too_small', message: 'Eşik en az 1 olmalı.' }],
    })
    assert.equal(isFieldFailure(invalid), true)
    assert.equal(fileFailure(new ApiError({ status: 500, code: 'a', message: 'x' }), 'text'), null)
  })

  test('bayat plan farkı eklenen, kalkan ve değişen etütlere ayrılır', () => {
    const error = new ApiError({
      status: 409,
      code: TUTORING_PLAN_STALE_CODE,
      message: 'x',
      issues: [
        { path: ['current', 'sessions', 0], code: 'plan_session_added', message: 'Yeni A.' },
        { path: ['expected', 'sessions', 1], code: 'plan_session_removed', message: 'Kalktı B.' },
        {
          path: ['current', 'sessions', 2],
          code: 'plan_session_students_changed',
          message: 'Değişti C.',
        },
        { path: ['unresolved'], code: 'plan_unresolved_changed', message: 'Grup sayısı.' },
      ],
    })
    assert.deepEqual(planChanges(error), {
      added: ['Yeni A.'],
      removed: ['Kalktı B.'],
      changed: ['Değişti C.'],
      other: ['Grup sayısı.'],
    })
  })
})
