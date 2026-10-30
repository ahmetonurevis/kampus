import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import {
  appointmentSlotsKey,
  appointmentSlotsPrefix,
  bookableSlotsQueryOptions,
  fetchBookableSlots,
  type BookableSlot,
} from '../src/appointment-slots.ts'
import { invalidateInstitutionQueries } from '../src/commands.ts'
import { collectionKeyPrefix } from '../src/collections.ts'
import { institutionKey } from '../src/query-keys.ts'
import { APPOINTMENT_INVALIDATES } from '../src/use-appointment-commands.ts'

// Alınabilir randevu saatleri kancası (`useBookableSlots`, DOM-ILT-105).

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const slot = {
  slotId: 'slot-t1-0',
  teacherId: 't1',
  teacherName: 'Selin Kaya',
  startsAt: '2026-10-07T13:00:00.000Z',
  duration: 30,
  campusName: 'Kadıköy Kampüsü',
  subjectNames: ['Matematik'],
  available: true,
} satisfies BookableSlot
const full = { ...slot, slotId: 'slot-t2-0', teacherId: 't2', available: false }

function fakeClient(respond: (url: URL) => Response) {
  const urls: URL[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      urls.push(url)
      return respond(url)
    },
  })
  return { client, urls }
}

describe('appointmentSlotsKey', () => {
  test('DOM-ILT-105: etkin kurum, öğrenci ve aralık anahtardadır; boş aralık null', () => {
    assert.deepEqual(
      appointmentSlotsKey('inst-a', 's1', { from: '2026-10-06T00:00:00.000Z' }),
      institutionKey('inst-a', 'appointment-slots', 's1', {
        from: '2026-10-06T00:00:00.000Z',
        to: null,
      }),
    )
    assert.deepEqual(appointmentSlotsKey('inst-a', 's1'), appointmentSlotsKey('inst-a', 's1', {}))
    assert.deepEqual(
      appointmentSlotsKey('inst-a', 's1', { from: '', to: '' }),
      appointmentSlotsKey('inst-a', 's1'),
    )
    // Veli iki çocuğu için ayrı önbellek kullanır; kurumlar karışmaz.
    assert.notDeepEqual(appointmentSlotsKey('inst-a', 's1'), appointmentSlotsKey('inst-a', 's2'))
    assert.notDeepEqual(appointmentSlotsKey('inst-a', 's1'), appointmentSlotsKey('inst-b', 's1'))
    assert.deepEqual(appointmentSlotsKey('inst-a', 's1').slice(2, 3), [...appointmentSlotsPrefix()])
  })
})

describe('fetchBookableSlots', () => {
  test('DOM-ILT-105: GET /api/v1/appointments/slots; aralık yalnız verilirse gider', async () => {
    const { client, urls } = fakeClient(() => json(200, { data: [slot, full] }))
    assert.deepEqual(await fetchBookableSlots(client, 's1'), [slot, full])
    await fetchBookableSlots(client, 's2', {
      from: '2026-10-06T00:00:00.000Z',
      to: '2026-10-20T00:00:00.000Z',
    })
    assert.equal(urls.length, 2)
    assert.equal(urls[0]?.pathname, '/api/v1/appointments/slots')
    assert.deepEqual([...(urls[0]?.searchParams.keys() ?? [])], ['studentId'])
    assert.equal(urls[0]?.searchParams.get('studentId'), 's1')
    assert.equal(urls[1]?.searchParams.get('studentId'), 's2')
    assert.equal(urls[1]?.searchParams.get('from'), '2026-10-06T00:00:00.000Z')
    assert.equal(urls[1]?.searchParams.get('to'), '2026-10-20T00:00:00.000Z')
  })

  test('DOM-ILT-105: kapsam dışı öğrenci 404 ve aralık hatası 400 ApiError olur', async () => {
    const { client } = fakeClient((url) =>
      url.searchParams.has('to') && !url.searchParams.has('from')
        ? json(400, {
            code: 'validation_failed',
            message: 'Gönderilen bilgiler geçersiz.',
            issues: [{ path: ['from'], code: 'custom', message: 'Başlangıcı da verin.' }],
            requestId: 'r2',
          })
        : json(404, { code: 'not_found', message: 'Kayıt bulunamadı.', requestId: 'r1' }),
    )
    await assert.rejects(fetchBookableSlots(client, 's25'), (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 404)
      assert.equal(error.code, 'not_found')
      return true
    })
    await assert.rejects(
      fetchBookableSlots(client, 's1', { to: '2026-10-20T00:00:00.000Z' }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.status, 400)
        assert.equal(error.issues?.[0]?.path[0], 'from')
        return true
      },
    )
  })
})

describe('useBookableSlots sorgu seçenekleri', () => {
  test('DOM-ILT-105: her açılışta tazelenir; öğrenci veya kurum yokken ya da enabled false iken istek atılmaz', () => {
    const { client } = fakeClient(() => json(200, { data: [] }))
    const options = bookableSlotsQueryOptions(client, 'inst-a', 's1')
    assert.equal(options.staleTime, 0)
    assert.equal(options.enabled, true)
    assert.deepEqual(options.queryKey, appointmentSlotsKey('inst-a', 's1'))
    assert.equal(bookableSlotsQueryOptions(client, null, 's1').enabled, false)
    assert.equal(bookableSlotsQueryOptions(client, 'inst-a', null).enabled, false)
    assert.equal(bookableSlotsQueryOptions(client, 'inst-a', '').enabled, false)
    assert.equal(bookableSlotsQueryOptions(client, 'inst-a', 's1', {}, false).enabled, false)
  })

  test('DOM-ILT-105: randevu yazıldıktan sonra saat listeleri ve randevular geçersiz kılınır', async () => {
    const { client, urls } = fakeClient(() => json(200, { data: [slot] }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const deniz = bookableSlotsQueryOptions(client, 'inst-a', 's1')
    const ece = bookableSlotsQueryOptions(client, 'inst-a', 's2', {
      from: '2026-10-06T00:00:00.000Z',
    })
    const otherInstitution = bookableSlotsQueryOptions(client, 'inst-b', 's1')
    for (const options of [deniz, ece, otherInstitution])
      assert.deepEqual(await queryClient.fetchQuery({ ...options, staleTime: Infinity }), [slot])
    assert.equal(urls.length, 3)
    const invalidated = () =>
      [deniz, ece, otherInstitution].map(
        (options) => queryClient.getQueryState(options.queryKey)?.isInvalidated,
      )
    assert.deepEqual(invalidated(), [false, false, false])
    assert.deepEqual(APPOINTMENT_INVALIDATES, [
      collectionKeyPrefix('appointments'),
      appointmentSlotsPrefix(),
    ])
    await invalidateInstitutionQueries(queryClient, 'inst-a', APPOINTMENT_INVALIDATES)
    // Etkin kurumun bütün saat listeleri (her çocuk, her aralık) bayatlar; başka kurum değişmez.
    assert.deepEqual(invalidated(), [true, true, false])
    queryClient.clear()
  })
})
