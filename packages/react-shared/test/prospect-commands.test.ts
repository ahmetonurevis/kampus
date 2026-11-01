import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from '../src/api-result.ts'
import { QueryClient } from '@tanstack/react-query'

import { collectionKeyPrefix } from '../src/collections.ts'
import {
  commandHeaders,
  createCommandSession,
  IF_MATCH_MISSING_CODE,
  IF_MATCH_MISSING_MESSAGE,
  invalidateInstitutionQueries,
  runCommand,
} from '../src/commands.ts'
import { institutionKey } from '../src/query-keys.ts'
import {
  addProspectNoteRequest,
  changeProspectStageRequest,
  createProspectRequest,
  ENROLL_MODULE_DISABLED_MESSAGE,
  ENROLL_PROSPECT_INVALIDATES,
  ENROLL_PROSPECT_MESSAGES,
  enrollProspectRequest,
  PROSPECT_CHANGED_MESSAGE,
  PROSPECT_INVALIDATES,
  PROSPECT_MESSAGES,
  scheduleProspectMeetingRequest,
  scheduleTrialLessonRequest,
  type AddProspectNoteInput,
  type EnrollProspectInput,
} from '../src/use-prospect-commands.ts'

interface Sent {
  method: string
  path: string
  headers: Headers
  body: unknown
}

/** Gerçek istemci + sahte fetch: giden istek kaydedilir, yanıt sabittir. */
function fakeClient(status = 200, payload?: unknown) {
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
        JSON.stringify(
          payload ?? {
            data: {
              entity: { collection: 'prospects', id: 'pr-1' },
              changes: { inserted: 1, updated: 0, archived: 0, restored: 0 },
              records: [],
            },
          },
        ),
        { status, headers: { 'content-type': 'application/json' } },
      )
    },
  })
  return { client, sent }
}

const prospect = {
  name: 'Test Aday',
  phone: '05559990001',
  branchId: 'b1',
  interest: '7. Sınıf · Ortaokul',
  source: 'Web sitesi' as const,
  guardianName: 'Test Veli',
  privacyNoticeVersion: 'aydinlatma-2026-1',
}

describe('aday komutları', () => {
  test('DOM-KAY-009: aday ekleme POST ile anahtar taşır, If-Match taşımaz', async () => {
    const { client, sent } = fakeClient(201)
    await runRequest(() => createProspectRequest(client, prospect, commandHeaders('key-12345', 3)))
    assert.equal(sent.length, 1)
    assert.equal(`${sent[0]?.method} ${sent[0]?.path}`, 'POST /api/v1/prospects')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, prospect)
  })

  test('DOM-KAY-030: aşama değişikliği PATCH ile okunan sürümü If-Match olarak taşır', async () => {
    const { client, sent } = fakeClient()
    const body = { stage: 'Vazgeçti' as const, lostReason: 'price' as const }
    await runRequest(() =>
      changeProspectStageRequest(
        client,
        { prospectId: 'pr 1', version: 4, body },
        commandHeaders('key-12345', 4),
      ),
    )
    assert.equal(`${sent[0]?.method} ${sent[0]?.path}`, 'PATCH /api/v1/prospects/pr%201')
    assert.equal(sent[0]?.headers.get('if-match'), '"4"')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.deepEqual(sent[0]?.body, body)
  })

  test('DOM-KAY-032, DOM-KAY-033, DOM-KAY-034: not, görüşme ve deneme dersi alt yollara If-Match ile gider', async () => {
    const { client, sent } = fakeClient()
    const headers = commandHeaders('key-12345', 2)
    await runRequest(() =>
      addProspectNoteRequest(
        client,
        { prospectId: 'pr1', version: 2, body: { text: 'Burs koşullarını sordu.' } },
        headers,
      ),
    )
    const meeting = { date: '2026-10-10T10:00:00.000Z', duration: 45, room: 'Görüşme odası' }
    await runRequest(() =>
      scheduleProspectMeetingRequest(
        client,
        { prospectId: 'pr1', version: 2, body: meeting },
        headers,
      ),
    )
    const trial = { lessonId: 'lesson-1', guardianConsent: true }
    await runRequest(() =>
      scheduleTrialLessonRequest(client, { prospectId: 'pr1', version: 2, body: trial }, headers),
    )
    assert.deepEqual(
      sent.map((item) => `${item.method} ${item.path}`),
      [
        'POST /api/v1/prospects/pr1/notes',
        'POST /api/v1/prospects/pr1/meetings',
        'POST /api/v1/prospects/pr1/trial-lessons',
      ],
    )
    for (const item of sent) assert.equal(item.headers.get('if-match'), '"2"')
    // Yazar adı gövdeden gönderilmez; sunucu oturumdan okur.
    assert.deepEqual(sent[0]?.body, { text: 'Burs koşullarını sordu.' })
    assert.deepEqual(sent[1]?.body, meeting)
    assert.deepEqual(sent[2]?.body, trial)
  })

  test('DOM-KAY-030…034: okunan sürüm yoksa değiştiren komutların isteği atılmaz', async () => {
    const { client, sent } = fakeClient()
    const missing = (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === IF_MATCH_MISSING_CODE
    const headers = commandHeaders('key-12345')
    const input = { prospectId: 'pr1', version: 1 }
    await assert.rejects(
      runRequest(() =>
        changeProspectStageRequest(
          client,
          { ...input, body: { stage: 'Teklif verildi' } },
          headers,
        ),
      ),
      missing,
    )
    await assert.rejects(
      runRequest(() =>
        addProspectNoteRequest(client, { ...input, body: { text: 'Not' } }, headers),
      ),
      missing,
    )
    await assert.rejects(
      runRequest(() =>
        scheduleProspectMeetingRequest(
          client,
          { ...input, body: { date: '2026-10-10T10:00:00.000Z', room: 'Oda 1' } },
          headers,
        ),
      ),
      missing,
    )
    await assert.rejects(
      runRequest(() =>
        scheduleTrialLessonRequest(client, { ...input, body: { lessonId: 'l1' } }, headers),
      ),
      missing,
    )
    assert.equal(sent.length, 0)
  })

  test('DOM-KAY-032: kanca yolu sürümü If-Match ve anahtarı başlık yapar', async () => {
    const { client, sent } = fakeClient(201)
    const outcome = await runCommand(
      createCommandSession(() => 'key-67890'),
      {
        execute: (input: AddProspectNoteInput, headers) =>
          runRequest(() => addProspectNoteRequest(client, input, headers)),
        version: (input) => input.version,
        refresh: async () => assert.fail('başarıda çakışma tazelemesi yok'),
        messages: PROSPECT_MESSAGES,
      },
      { prospectId: 'pr1', version: 7, body: { text: 'Telefonla arandı.' } },
      { notifyError: () => assert.fail('hata beklenmiyordu') },
    )
    assert.equal(outcome.status, 'success')
    assert.equal(sent[0]?.headers.get('if-match'), '"7"')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-67890')
  })

  test('başarıda ve çakışmada yalnız etkin kurumun aday sorguları geçersiz kılınır', async () => {
    const queryClient = new QueryClient()
    const list = institutionKey('inst-a', ...collectionKeyPrefix('prospects'), 'list', {})
    const other = institutionKey('inst-b', ...collectionKeyPrefix('prospects'), 'list', {})
    const students = institutionKey('inst-a', ...collectionKeyPrefix('students'), 'list', {})
    for (const key of [list, other, students]) queryClient.setQueryData(key, [])
    await invalidateInstitutionQueries(queryClient, 'inst-a', PROSPECT_INVALIDATES)
    const invalidated = (key: readonly unknown[]) =>
      queryClient.getQueryState(key)?.isInvalidated ?? false
    assert.equal(invalidated(list), true)
    assert.equal(invalidated(other), false)
    assert.equal(invalidated(students), false)
  })

  test('DOM-KAY-002: mükerrer aday reddi sunucunun Türkçe iletisiyle gösterilir; sürüm çakışması güncel kartı ister', async () => {
    const message =
      'Bu telefon veya e-postayla açık bir aday kaydı var; yeni temas için mevcut karta not ekleyin.'
    const { client } = fakeClient(409, {
      code: 'prospect_duplicate',
      message,
      issues: [{ path: ['phone'], code: 'prospect_duplicate', message }],
      requestId: 'req-1',
    })
    const notified: string[] = []
    let refreshed = 0
    const outcome = await runCommand(
      createCommandSession(() => 'key-24680'),
      {
        execute: (body: typeof prospect, headers) =>
          runRequest(() => createProspectRequest(client, body, headers)),
        // 409: liste eskimiş olabilir (başka kullanıcı aynı adayı açtı), sorgular tazelenir.
        refresh: async () => {
          refreshed += 1
        },
        messages: PROSPECT_MESSAGES,
      },
      prospect,
      { notifyError: (text) => notified.push(text) },
    )
    assert.equal(outcome.status, 'failed')
    assert.deepEqual(notified, [message])
    assert.equal(refreshed, 1)
    assert.equal(PROSPECT_MESSAGES.version_conflict, PROSPECT_CHANGED_MESSAGE)
    assert.notEqual(PROSPECT_CHANGED_MESSAGE, IF_MATCH_MISSING_MESSAGE)
  })
})

describe('kesin kayıt komutu', () => {
  const enrollment: EnrollProspectInput = {
    prospectId: 'pr 1',
    version: 3,
    body: { classId: 'c1', totalCents: 3_600_000, count: 3, startDate: '2026-11-15' },
  }
  const created = {
    data: {
      entity: { collection: 'students', id: 's-new' },
      changes: { inserted: 6, updated: 1, archived: 0, restored: 0 },
      records: [],
    },
  }
  /** Kanca yolu: `useEnrollProspect` ile aynı adımlar (`exclusive`, kesin kayıt iletileri). */
  function enrollCommand(
    client: ReturnType<typeof fakeClient>['client'],
    refresh = async () => {},
  ) {
    return {
      execute: (input: EnrollProspectInput, headers: Parameters<typeof enrollProspectRequest>[2]) =>
        runRequest(() => enrollProspectRequest(client, input, headers)),
      version: (input: EnrollProspectInput) => input.version,
      refresh,
      messages: ENROLL_PROSPECT_MESSAGES,
      exclusive: true,
    }
  }

  test('DOM-KAY-035, DOM-KAY-011: kesin kayıt alt yola If-Match ve Idempotency-Key ile, tutarı kuruş olarak gönderir', async () => {
    const { client, sent } = fakeClient(201, created)
    const outcome = await runCommand(
      createCommandSession(() => 'key-enroll-1'),
      enrollCommand(client, async () => assert.fail('başarıda çakışma tazelemesi yok')),
      enrollment,
      { notifyError: () => assert.fail('hata beklenmiyordu') },
    )
    assert.equal(outcome.status, 'success')
    assert.equal(sent.length, 1)
    assert.equal(`${sent[0]?.method} ${sent[0]?.path}`, 'POST /api/v1/prospects/pr%201/enroll')
    assert.equal(sent[0]?.headers.get('if-match'), '"3"')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-enroll-1')
    // Aday kimliği yalnız yolda; gövde kuruş tamsayıdır.
    assert.deepEqual(sent[0]?.body, enrollment.body)
  })

  test('DOM-KAY-035: okunan aday sürümü yoksa kesin kayıt isteği atılmaz', async () => {
    const { client, sent } = fakeClient(201, created)
    await assert.rejects(
      runRequest(() => enrollProspectRequest(client, enrollment, commandHeaders('key-12345'))),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === IF_MATCH_MISSING_CODE,
    )
    assert.equal(sent.length, 0)
  })

  test('DOM-YTK-040: crm veya finance kapalıyken 403 module_disabled modülleri adlandıran tek toast olur; alan ve tazeleme yok', async () => {
    const { client } = fakeClient(403, {
      code: 'module_disabled',
      message: 'Bu modül kurumunuzda kapalı.',
      requestId: 'req-1',
    })
    const notified: string[] = []
    const fields: string[] = []
    const outcome = await runCommand(
      createCommandSession(() => 'key-enroll-2'),
      enrollCommand(client, async () => assert.fail('403 tazeleme istemez')),
      enrollment,
      {
        notifyError: (text) => notified.push(text),
        setError: (name) => fields.push(name),
      },
    )
    assert.equal(outcome.status, 'failed')
    assert.deepEqual(notified, [ENROLL_MODULE_DISABLED_MESSAGE])
    assert.deepEqual(fields, [])
  })

  test('DOM-KAY-011: 100’ün katı olmayan tutarın 422 iletisi totalCents alanına yazılır, toast çıkmaz', async () => {
    const message = 'Tutar şimdilik tam lira olmalıdır; kuruşlu tutar girilemez.'
    const { client } = fakeClient(422, {
      code: 'amount_not_whole_lira',
      message,
      issues: [{ path: ['totalCents'], code: 'amount_not_whole_lira', message }],
      requestId: 'req-2',
    })
    const notified: string[] = []
    const fields: { name: string; type: string; message: string }[] = []
    const outcome = await runCommand(
      createCommandSession(() => 'key-enroll-3'),
      enrollCommand(client, async () => assert.fail('422 tazeleme istemez')),
      { ...enrollment, body: { ...enrollment.body, totalCents: 3_600_050 } },
      {
        notifyError: (text) => notified.push(text),
        setError: (name, error) => fields.push({ name, ...error }),
      },
    )
    assert.equal(outcome.status, 'failed')
    assert.deepEqual(fields, [{ name: 'totalCents', type: 'amount_not_whole_lira', message }])
    assert.deepEqual(notified, [])
  })

  test('DOM-KAY-035: 400 doğrulama maddeleri alanlara gider; yolsuz 409 kayıtlı aday tek toast ve tazeleme', async () => {
    const { client } = fakeClient(400, {
      code: 'validation_failed',
      message: 'Formda düzeltilmesi gereken alanlar var.',
      issues: [{ path: ['classId'], code: 'too_small', message: 'Sınıf seçin.' }],
      requestId: 'req-3',
    })
    const fields: string[] = []
    const notified: string[] = []
    await runCommand(
      createCommandSession(() => 'key-enroll-4'),
      enrollCommand(client),
      enrollment,
      {
        notifyError: (text) => notified.push(text),
        setError: (name) => fields.push(name),
      },
    )
    assert.deepEqual(fields, ['classId'])
    assert.deepEqual(notified, [])

    const already = 'Bu adayın kaydı zaten tamamlanmış.'
    const conflict = fakeClient(409, {
      code: 'prospect_already_enrolled',
      message: already,
      requestId: 'req-4',
    })
    const toasts: string[] = []
    let refreshed = 0
    const outcome = await runCommand(
      createCommandSession(() => 'key-enroll-5'),
      enrollCommand(conflict.client, async () => {
        refreshed += 1
      }),
      enrollment,
      { notifyError: (text) => toasts.push(text), setError: () => assert.fail('yolsuz hata') },
    )
    assert.equal(outcome.status, 'failed')
    assert.deepEqual(toasts, [already])
    assert.equal(refreshed, 1)
    assert.equal(ENROLL_PROSPECT_MESSAGES.version_conflict, PROSPECT_CHANGED_MESSAGE)
  })

  test('DOM-KAY-001: başarıda ve çakışmada etkin kurumun aday, öğrenci, veli ve finans sorguları geçersiz kılınır; başka kurum ve ilgisiz koleksiyon kalır', async () => {
    const queryClient = new QueryClient()
    const key = (institution: string, collection: string) =>
      institutionKey(institution, ...collectionKeyPrefix(collection), 'list', {})
    const touched = ['prospects', 'students', 'parents', 'invoices', 'contracts']
    const own = touched.map((collection) => key('inst-a', collection))
    const other = touched.map((collection) => key('inst-b', collection))
    const unrelated = key('inst-a', 'grades')
    for (const item of [...own, ...other, unrelated]) queryClient.setQueryData(item, [])
    await invalidateInstitutionQueries(queryClient, 'inst-a', ENROLL_PROSPECT_INVALIDATES)
    const invalidated = (item: readonly unknown[]) =>
      queryClient.getQueryState(item)?.isInvalidated ?? false
    assert.deepEqual(own.map(invalidated), [true, true, true, true, true])
    assert.deepEqual(other.map(invalidated), [false, false, false, false, false])
    assert.equal(invalidated(unrelated), false)
  })

  test('DOM-KAY-011: belirsiz hatadan sonra aynı kesin kayıt aynı Idempotency-Key ile yeniden gönderilir', async () => {
    const failing = fakeClient(503, {
      code: 'unavailable',
      message: 'Hizmet şu anda kullanılamıyor.',
      requestId: 'req-5',
    })
    let generated = 0
    const session = createCommandSession(() => `key-enroll-retry-${String(++generated)}`)
    await runCommand(session, enrollCommand(failing.client), enrollment, { notifyError: () => {} })
    const ok = fakeClient(201, created)
    const outcome = await runCommand(session, enrollCommand(ok.client), enrollment, {
      notifyError: () => assert.fail('hata beklenmiyordu'),
    })
    assert.equal(outcome.status, 'success')
    assert.equal(
      ok.sent[0]?.headers.get('idempotency-key'),
      failing.sent[0]?.headers.get('idempotency-key'),
    )
    assert.equal(generated, 1)
  })
})
