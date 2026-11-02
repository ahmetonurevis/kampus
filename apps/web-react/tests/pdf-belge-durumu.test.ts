import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { KampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'
import { studentPaidCents } from '../src/lib/pdf/document-state.ts'

type Call = { path: string; studentId: string }

function fakeClient(reply: () => unknown): { client: KampusClient; calls: Call[] } {
  const calls: Call[] = []
  const client = {
    GET: async (path: string, init: { params: { path: { studentId: string } } }) => {
      calls.push({ path, studentId: init.params.path.studentId })
      return reply()
    },
  } as unknown as KampusClient
  return { client, calls }
}

test('taahhütname tahsil edilen tutarı sunucu bakiyesinden alır (kısmi ödeme dahil)', async () => {
  const { client, calls } = fakeClient(() => ({
    data: { data: { studentId: 's1', totalCents: 90_000, paidCents: 37_500 } },
    response: new Response(null, { status: 200 }),
  }))
  assert.equal(await studentPaidCents(client, 's1'), 37_500)
  assert.deepEqual(calls, [
    { path: '/api/v1/finance/students/{studentId}/balance', studentId: 's1' },
  ])
})

test('bakiye okunamazsa (403/404) tutar boş kalır, şablon core hesabına düşer', async () => {
  for (const status of [403, 404]) {
    const { client } = fakeClient(() => {
      throw new ApiError({ status, code: 'forbidden', message: 'Yetki yok.' })
    })
    assert.equal(await studentPaidCents(client, 's1'), undefined)
  }
})

test('bakiyedeki başka hata belgeyi engeller', async () => {
  const { client } = fakeClient(() => {
    throw new ApiError({ status: 500, code: 'internal_error', message: 'Hata.' })
  })
  await assert.rejects(studentPaidCents(client, 's1'), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 500)
    return true
  })
})
