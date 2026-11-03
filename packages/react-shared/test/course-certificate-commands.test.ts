import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError, CLIENT_ERROR_CODES } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import {
  commandFeedback,
  commandHeaders,
  IF_MATCH_MISSING_CODE,
  invalidateInstitutionQueries,
} from '../src/commands.ts'
import { institutionKey, SESSION_KEY_ROOT } from '../src/query-keys.ts'
import {
  awaitingReplacement,
  cancelCertificateCommand,
  cancelCertificateRequest,
  CERTIFICATE_INVALIDATES,
  certificateErrorField,
  certificateStale,
  COURSE_CERTIFICATES_KEY,
  enrollmentCertificateState,
  fetchAllCertificates,
  issueCertificateCommand,
  issueCertificateRequest,
  isStaffCertificate,
  MEBBIS_CERTIFICATES_KEY,
  recordMebbisCommand,
  recordMebbisRequest,
  VERIFICATION_MESSAGES,
  verificationErrorMessage,
  verificationFormSchema,
  verificationKey,
  VERIFICATION_QUERY_FRESHNESS,
  verifyCertificateRequest,
  type CourseCertificate,
} from '../src/use-course-certificates.ts'

// Kurum başarı belgesi kancaları (OG-088; IST-081; DOM-DIL-080, 081, 082): yol, başlık, gövde,
// Türkçe hata metni, eskimiş belgenin tazelenmesi, kurum anahtarlı geçersiz kılma ve kimliksiz
// doğrulama.

interface Sent {
  method: string
  url: URL
  headers: Headers
  body: unknown
}

function fakeClient(status = 201, payload: unknown = { data: {} }) {
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
        url: new URL(request.url),
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

const CONTENT = {
  schemaVersion: 1 as const,
  title: 'Kurum başarı belgesi' as const,
  institutionName: 'Kampüs Dil Akademisi',
  learnerName: 'Deniz Yılmaz',
  courseId: 'course-b1',
  courseName: 'B1 Genel İngilizce',
  level: 'B1' as const,
  levelStatement: 'kurum değerlendirmesine göre CEFR B1 düzeyinde',
  totalHours: 120,
  attendance: { attendedHours: 110, totalHours: 120, permille: 916 },
  finalScore: 78,
  skills: [{ skill: 'reading' as const, score: 80 }],
  decisionId: 'dec-1',
  approvedAt: '2026-11-01T09:00:00.000Z',
}

function staff(id: string, overrides: Partial<Record<string, unknown>> = {}): CourseCertificate {
  return {
    id,
    number: `KB-2026-00000${id.slice(-1)}`,
    status: 'valid',
    verificationCode: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345',
    enrollmentId: 'enr-1',
    groupId: 'grp-1',
    learnerId: 'stu-1',
    courseId: 'course-b1',
    decisionId: 'dec-1',
    content: CONTENT,
    replacesCertificateId: null,
    issuedByUserId: 'u-1',
    issuedAt: '2026-11-02T09:00:00.000Z',
    cancelledByUserId: null,
    cancelledAt: null,
    cancellationReason: null,
    rowVersion: 1,
    ...overrides,
  } as CourseCertificate
}

describe('kurum başarı belgesi komutları', () => {
  test('DOM-DIL-081: düzenleme POST /course-certificates; Idempotency-Key taşır, If-Match taşımaz', async () => {
    const { client, sent } = fakeClient()
    const body = { decisionId: 'dec-1', replacesCertificateId: null }
    await runRequest(() => issueCertificateRequest(client, body, commandHeaders('key-issue')))
    assert.equal(sent.length, 1)
    const [request] = sent
    assert.equal(request?.method, 'POST')
    assert.equal(request?.url.pathname, '/api/v1/course-certificates')
    assert.equal(request?.headers.get('idempotency-key'), 'key-issue')
    assert.equal(request?.headers.get('if-match'), null)
    assert.deepEqual(request?.body, body)
  })

  test('DOM-DIL-082: yeniden düzenleme iptal edilen belgeyi replacesCertificateId ile gönderir', async () => {
    const { client, sent } = fakeClient()
    const body = { decisionId: 'dec-2', replacesCertificateId: 'cert-1' }
    await runRequest(() => issueCertificateRequest(client, body, commandHeaders('key-reissue')))
    assert.deepEqual(sent[0]?.body, body)
  })

  test('DOM-DIL-082: iptal okunan sürümü If-Match yapar, gerekçeyi gövdede taşır', async () => {
    const { client, sent } = fakeClient(200)
    await runRequest(() =>
      cancelCertificateRequest(
        client,
        { certificateId: 'cert 1', version: 4, body: { reason: 'Ad yanlış yazıldı' } },
        commandHeaders('key-cancel', 4),
      ),
    )
    assert.deepEqual(
      sent.map((s) => [s.method, s.url.pathname, s.headers.get('if-match'), s.body]),
      [
        [
          'POST',
          '/api/v1/course-certificates/cert%201/cancel',
          '"4"',
          { reason: 'Ad yanlış yazıldı' },
        ],
      ],
    )
    assert.equal(
      cancelCertificateCommand.version({ certificateId: 'x', version: 4, body: { reason: 'x' } }),
      4,
    )
  })

  test('DOM-DIL-082: okunan sürüm yoksa iptal isteği atılmaz', async () => {
    const { client, sent } = fakeClient()
    await assert.rejects(
      () =>
        runRequest(() =>
          cancelCertificateRequest(
            client,
            { certificateId: 'cert-1', version: 1, body: { reason: 'x' } },
            commandHeaders('key-cancel'),
          ),
        ),
      (error: unknown) => error instanceof ApiError && error.code === IF_MATCH_MISSING_CODE,
    )
    assert.equal(sent.length, 0)
  })

  test('DOM-DIL-080: MEBBİS işareti kararın yoluna belge no ve tarihi gönderir', async () => {
    const { client, sent } = fakeClient()
    const body = { certificateNumber: 'MEB-2026-77', issuedDate: '2026-11-02' }
    await runRequest(() =>
      recordMebbisRequest(client, { decisionId: 'dec-1', body }, commandHeaders('key-mebbis')),
    )
    assert.deepEqual(
      sent.map((s) => [s.method, s.url.pathname, s.headers.get('idempotency-key'), s.body]),
      [['POST', '/api/v1/progression-decisions/dec-1/mebbis-record', 'key-mebbis', body]],
    )
  })

  test('DOM-DIL-081, DOM-DIL-082: hata kodları Türkçe metne çevrilir; bilinmeyen kod sunucunun mesajıyla', () => {
    const feedback = (code: string, status = 422) =>
      commandFeedback(
        new ApiError({ status, code, message: 'Sunucu mesajı.' }),
        issueCertificateCommand.messages,
      ).message
    assert.match(feedback('certificate_cancel_first') ?? '', /Önce düzenlenmiş belge iptal/)
    assert.match(feedback('certificate_already_issued', 409) ?? '', /geçerli bir belgesi var/)
    assert.match(feedback('certificate_already_cancelled', 409) ?? '', /zaten iptal/)
    assert.match(feedback('certificate_replacement_required') ?? '', /Yeniden düzenle/)
    assert.match(feedback('certificate_not_eligible') ?? '', /hak kazanmadı/)
    assert.match(feedback('certificate_decision_pending') ?? '', /onay bekliyor/)
    assert.match(feedback('permission_denied', 403) ?? '', /yetkiniz yok/)
    assert.match(feedback('mebbis_already_recorded', 409) ?? '', /zaten işaretlendi/)
    assert.equal(feedback('unknown_code', 500), 'Sunucu mesajı.')
    assert.equal(cancelCertificateCommand.messages, issueCertificateCommand.messages)
    assert.equal(recordMebbisCommand.messages, issueCertificateCommand.messages)
  })

  test('DOM-DIL-080: ileri MEBBİS tarihi tarih alanına bağlanır; diğer kodlar toast', () => {
    const error = (code: string) => new ApiError({ status: 422, code, message: 'x' })
    assert.equal(certificateErrorField(error('mebbis_date_in_future')), 'issuedDate')
    assert.equal(certificateErrorField(error('certificate_already_issued')), undefined)
  })

  test('DOM-DIL-082: sürüm çakışması, kaybolan kayıt ve düzeltilen karar listeyi tazeler; 403 tazelemez', () => {
    const error = (status: number, code: string) => new ApiError({ status, code, message: 'x' })
    assert.equal(certificateStale(error(409, 'version_conflict')), true)
    assert.equal(certificateStale(error(404, 'not_found')), true)
    assert.equal(certificateStale(error(422, 'certificate_decision_superseded')), true)
    assert.equal(certificateStale(error(403, 'permission_denied')), false)
    assert.equal(certificateStale(error(409, 'certificate_already_issued')), false)
  })

  test('DOM-DIL-081: yazmalar belge listelerini ve MEBBİS listesini tazeler; başka kurum dokunulmaz', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const keys = {
      list: institutionKey('inst-a', COURSE_CERTIFICATES_KEY, 'list', { page: 1 }),
      mebbis: institutionKey('inst-a', MEBBIS_CERTIFICATES_KEY, 'grp-1'),
      groups: institutionKey('inst-a', 'language-groups', 'list', { page: 1 }),
      other: institutionKey('inst-b', COURSE_CERTIFICATES_KEY, 'list', { page: 1 }),
    }
    for (const command of [
      issueCertificateCommand,
      cancelCertificateCommand,
      recordMebbisCommand,
    ]) {
      for (const key of Object.values(keys))
        await queryClient.fetchQuery({ queryKey: key, queryFn: () => 'x', staleTime: Infinity })
      await invalidateInstitutionQueries(queryClient, 'inst-a', command.invalidates)
      assert.deepEqual(
        Object.entries(keys)
          .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated)
          .map(([name]) => name),
        ['list', 'mebbis'],
      )
      assert.equal(command.invalidates, CERTIFICATE_INVALIDATES)
      queryClient.clear()
    }
  })
})

describe('kurum başarı belgesi durumu', () => {
  test('DOM-DIL-082: personel belgesi rowVersion taşır; öğrenci belgesi taşımaz', () => {
    assert.equal(isStaffCertificate(staff('cert-1')), true)
    const learner = {
      id: 'cert-1',
      number: 'KB-2026-000001',
      status: 'valid',
      verificationCode: 'x',
      courseId: 'course-b1',
      content: CONTENT,
      issuedAt: '2026-11-02T09:00:00.000Z',
    } as CourseCertificate
    assert.equal(isStaffCertificate(learner), false)
  })

  test('DOM-DIL-082: iptal edilen ve yerine belge düzenlenmeyen belge yeniden düzenlenmeyi bekler', () => {
    const cancelled = staff('cert-1', { status: 'cancelled' })
    const replacement = staff('cert-2', { replacesCertificateId: 'cert-1' })
    assert.ok(isStaffCertificate(cancelled))
    assert.equal(awaitingReplacement(cancelled, [cancelled]), true)
    assert.equal(awaitingReplacement(cancelled, [cancelled, replacement]), false)
    const valid = staff('cert-3')
    assert.ok(isStaffCertificate(valid))
    assert.equal(awaitingReplacement(valid, [valid]), false)
  })

  test('DOM-DIL-082: kaydın belge durumu geçerli, yeniden düzenleme ya da belge yok', () => {
    const cancelled = staff('cert-1', { status: 'cancelled' })
    const replacement = staff('cert-2', { replacesCertificateId: 'cert-1' })
    const other = staff('cert-3', { enrollmentId: 'enr-2' })
    assert.equal(enrollmentCertificateState('enr-1', []).kind, 'none')
    assert.equal(enrollmentCertificateState('enr-1', [other]).kind, 'none')
    const replace = enrollmentCertificateState('enr-1', [cancelled, other])
    assert.equal(replace.kind, 'replace')
    assert.equal(replace.kind === 'replace' && replace.certificate.id, 'cert-1')
    const valid = enrollmentCertificateState('enr-1', [cancelled, replacement])
    assert.equal(valid.kind === 'valid' && valid.certificate.id, 'cert-2')
  })

  test('DOM-DIL-081: kurun bütün belgeleri 100lük sayfalarla toplanır, süzgeç korunur', async () => {
    const searches: string[] = []
    const client = createKampusClient({
      baseUrl: 'https://api.kampus.test',
      credentials: 'include',
      requestId: () => undefined,
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        searches.push(url.search)
        const page = Number(url.searchParams.get('page'))
        const count = page === 1 ? 100 : 5
        const data = Array.from({ length: count }, (_, i) => staff(`cert-${page}-${i}`))
        return new Response(JSON.stringify({ data, meta: { page, pageSize: 100, total: 105 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    const rows = await fetchAllCertificates(client, { courseId: 'course-b1' })
    assert.equal(rows.length, 105)
    assert.deepEqual(searches, [
      '?courseId=course-b1&page=1&pageSize=100',
      '?courseId=course-b1&page=2&pageSize=100',
    ])
  })
})

describe('kimliksiz belge doğrulama', () => {
  test('DOM-DIL-082: doğrulama GET /certificate-verifications/:code; kurum anahtarı taşımaz', async () => {
    const { client, sent } = fakeClient(200, {
      data: {
        status: 'cancelled',
        learnerInitials: 'D. Y.',
        courseName: 'B1',
        issuedDate: '2026-11-02',
        institutionName: 'Kampüs Dil Akademisi',
      },
    })
    const body = await runRequest(() =>
      verifyCertificateRequest(client, 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345'),
    )
    assert.equal(body.data.status, 'cancelled')
    assert.equal(
      sent[0]?.url.pathname,
      '/api/v1/certificate-verifications/ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345',
    )
    assert.equal(verificationKey('X')[0], SESSION_KEY_ROOT)
  })

  test('DOM-DIL-082: doğrulama sonucu önbellekte bayatlamaz, açılışta yeniden çekilir', () => {
    assert.deepEqual(VERIFICATION_QUERY_FRESHNESS, { staleTime: 0, refetchOnMount: 'always' })
  })

  test('DOM-DIL-082: 404 "Belge bulunamadı", 429 çok fazla deneme; teknik ayrıntı gösterilmez', () => {
    const error = (status: number, code: string) =>
      new ApiError({ status, code, message: 'Teknik ayrıntı' })
    assert.match(verificationErrorMessage(error(404, 'not_found')), /^Belge bulunamadı/)
    assert.equal(
      verificationErrorMessage(error(429, 'rate_limited')),
      VERIFICATION_MESSAGES.rateLimited,
    )
    assert.match(VERIFICATION_MESSAGES.rateLimited, /Çok fazla deneme/)
    assert.equal(
      verificationErrorMessage(error(0, CLIENT_ERROR_CODES.network)),
      VERIFICATION_MESSAGES.network,
    )
    assert.equal(
      verificationErrorMessage(error(500, 'internal')),
      VERIFICATION_MESSAGES.unavailable,
    )
  })

  test('DOM-DIL-082: doğrulama formu küçük harf, boşluk ve tiresiz kodu kabul eder, bozuk kodu reddeder', () => {
    assert.equal(
      verificationFormSchema.safeParse({ code: 'abcd efgh jkmn pqrs tvwx yz01 2345' }).success,
      true,
    )
    assert.equal(
      verificationFormSchema.safeParse({ code: 'ABCDEFGHJKMNPQRSTVWXYZ012345' }).success,
      true,
    )
    const short = verificationFormSchema.safeParse({ code: 'ABCD-1234' })
    assert.equal(short.success, false)
    assert.equal(short.error?.issues[0]?.message, VERIFICATION_MESSAGES.invalidCode)
    const empty = verificationFormSchema.safeParse({ code: '  ' })
    assert.equal(empty.error?.issues[0]?.message, 'Doğrulama kodunu girin.')
  })
})
