import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { KampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'
import { studentDisplayName, studentPaidCents } from '../src/lib/pdf/document-state.ts'
import { statementFilename } from '../src/lib/pdf/templates/finance-statement.ts'
import { DOCUMENT_TITLES, documentFilename } from '../src/lib/pdf/templates/shared.ts'

type Call = { path: string; params: Record<string, string> }

function fakeClient(reply: () => unknown): { client: KampusClient; calls: Call[] } {
  const calls: Call[] = []
  const client = {
    GET: async (path: string, init: { params: { path: Record<string, string> } }) => {
      calls.push({ path, params: init.params.path })
      return reply()
    },
  } as unknown as KampusClient
  return { client, calls }
}

const ok = (body: unknown) => () => ({ data: body, response: new Response(null, { status: 200 }) })
const fails = (status: number) => () => {
  throw new ApiError({
    status,
    code: status === 500 ? 'internal_error' : 'forbidden',
    message: 'x',
  })
}

test('taahhütname tahsil edilen tutarı sunucu bakiyesinden alır (kısmi ödeme dahil)', async () => {
  const { client, calls } = fakeClient(
    ok({ data: { studentId: 's1', totalCents: 90_000, paidCents: 37_500 } }),
  )
  assert.equal(await studentPaidCents(client, 's1'), 37_500)
  assert.deepEqual(calls, [
    { path: '/api/v1/finance/students/{studentId}/balance', params: { studentId: 's1' } },
  ])
})

test('bakiye okunamazsa (403/404) tutar boş kalır, şablon core hesabına düşer', async () => {
  for (const status of [403, 404]) {
    const { client } = fakeClient(fails(status))
    assert.equal(await studentPaidCents(client, 's1'), undefined)
  }
})

test('bakiyedeki başka hata belgeyi engeller', async () => {
  const { client } = fakeClient(fails(500))
  await assert.rejects(studentPaidCents(client, 's1'), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 500)
    return true
  })
})

test('cari ekstre başlığı öğrenci kaydının adını yazar', async () => {
  const { client, calls } = fakeClient(
    ok({ data: { id: 's1', record: { id: 's1', name: 'Deniz Yılmaz' } } }),
  )
  assert.equal(await studentDisplayName(client, 's1'), 'Deniz Yılmaz')
  assert.deepEqual(calls, [
    { path: '/api/v1/collections/{collection}/{id}', params: { collection: 'students', id: 's1' } },
  ])
})

test('öğrenci kaydı okunamazsa ekstre başlığı "—" yazar; başka hata belgeyi engeller', async () => {
  for (const status of [403, 404]) {
    const { client } = fakeClient(fails(status))
    assert.equal(await studentDisplayName(client, 's1'), '—')
  }
  const { client } = fakeClient(fails(500))
  await assert.rejects(studentDisplayName(client, 's1'), ApiError)
})

test('cari ekstre önizleme başlığı ve dosya adı ekstre indirmesiyle aynıdır', () => {
  assert.equal(DOCUMENT_TITLES['student-statement'], 'Cari ekstre')
  assert.equal(documentFilename('student-statement', 's1'), statementFilename('s1'))
  assert.equal(documentFilename('student-statement', 'a/b c'), 'cari-ekstre-a-b-c.pdf')
})
