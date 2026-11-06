import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import {
  importInstallmentsRequest,
  importIssuesOf,
  importStudentsRequest,
  INSTALLMENT_IMPORT_INVALIDATES,
  isImportFileError,
  isImportRowsError,
  STUDENT_IMPORT_INVALIDATES,
} from '../src/enrollment-imports.ts'

// IST-007 (ON-060, ON-061): pilot aktarımı istekleri ve hata ayrımı.

function fakeClient() {
  const sent: { url: string; key: string | null; body: string }[] = []
  const client = createKampusClient({
    baseUrl: 'http://api.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      sent.push({
        url: new URL(request.url).pathname,
        key: request.headers.get('idempotency-key'),
        body: await request.text(),
      })
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { client, sent }
}

describe('pilot aktarımı istekleri (IST-007)', () => {
  test('öğrenci ve taksit doğru uca, anahtar başlıkta, dosya gövdede gider', async () => {
    const { client, sent } = fakeClient()
    const body = { fileBase64: 'QUJD', dryRun: true }
    await importStudentsRequest(client, body, { 'idempotency-key': 'k-1' })
    await importInstallmentsRequest(client, body, { 'idempotency-key': 'k-2' })
    assert.deepEqual(
      sent.map((item) => [item.url, item.key]),
      [
        ['/api/v1/prospects/student-imports', 'k-1'],
        ['/api/v1/finance/installment-imports', 'k-2'],
      ],
    )
    assert.deepEqual(JSON.parse(sent[0]?.body ?? ''), body)
  })

  test('yazma sonrası ilgili koleksiyonlar tazelenir', () => {
    assert.ok(STUDENT_IMPORT_INVALIDATES.some((key) => key.includes('students')))
    assert.ok(STUDENT_IMPORT_INVALIDATES.some((key) => key.includes('parents')))
    assert.ok(INSTALLMENT_IMPORT_INVALIDATES.some((key) => key.includes('invoices')))
  })
})

describe('pilot aktarımı hataları (IST-007)', () => {
  const error = (status: number, code: string, issues = [] as ApiError['issues']) =>
    new ApiError({ status, code, message: 'x', issues })

  test('dosya düzeyindeki sorun ayrılır', () => {
    assert.equal(isImportFileError(error(422, 'csv_too_many_rows')), true)
    assert.equal(isImportFileError(error(422, 'import_file_legacy_excel')), true)
    assert.equal(isImportFileError(error(422, 'student_import_invalid')), false)
    assert.equal(isImportFileError(error(400, 'csv_too_many_rows')), false)
  })

  test('satır hataları önizleme satırlarına çevrilir, başka hata null', () => {
    assert.equal(isImportRowsError(error(422, 'installment_import_invalid')), true)
    assert.equal(importIssuesOf(error(422, 'csv_empty')), null)
    assert.deepEqual(
      importIssuesOf(
        error(422, 'student_import_invalid', [
          {
            path: ['rows', 3, 'className'],
            code: 'class_not_found',
            message: '3. satır: Bu sınıf bulunamadı.',
          },
          { path: ['rows', 4], code: 'extra_cells', message: '4. satır: Fazla hücre.' },
          { path: ['other'], code: 'x', message: 'y' },
        ]),
      ),
      [
        { line: 3, field: 'className', code: 'class_not_found', message: 'Bu sınıf bulunamadı.' },
        { line: 4, field: null, code: 'extra_cells', message: 'Fazla hücre.' },
      ],
    )
  })
})
