import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, test } from 'node:test'

import { feeTariffs } from '../src/db/schema/fee-tariffs.ts'
import { FIXED_NOW } from './support/app.ts'
import {
  app,
  assertError,
  count,
  db,
  institution,
  post,
  useCommandsHarness,
} from './support/commands-harness.ts'
import { PLATFORM_IDEMPOTENT_ENDPOINTS } from './support/platform-idempotency.ts'

/**
 * Yazma uçlarının ortak testleri (api-tasarimi.md §1, §6, §7): Onur'un kayıt ve finans testleri
 * (`// Onur: kayıt ve finans` blokları) ve Idempotency-Key envanteri. Oğuzhan'ın uç testleri
 * `platform-commands.test.ts`'te, ortak donanım `support/commands-harness.ts`'tedir; Oğuzhan'ın
 * envanter girdileri `support/platform-idempotency.ts`'tedir (bir uç iki listede bulunamaz).
 */

// Onur: kayıt ve finans
/** Idempotency-Key başlığı zorunlu kayıt ve finans uçları (yeni satır bloğun sonuna). */
const ONUR_IDEMPOTENT_ENDPOINTS = [
  // Aday oluşturma (routes/prospects.ts; DOM-KAY-002).
  'POST /api/v1/prospects',
  // Kesin kayıt borç doğurur (routes/prospects.ts; DOM-KAY-035).
  'POST /api/v1/prospects/{prospectId}/enroll',
  // Tahsilat, iptal ve nakit ayarı (routes/payments.ts; DOM-FIN-031, DOM-FIN-033).
  'POST /api/v1/payments',
  'POST /api/v1/payments/{paymentId}/mebbis-record',
  'POST /api/v1/payments/{paymentId}/reverse',
  'PATCH /api/v1/payment-settings',
  'PATCH /api/v1/finance/export-profile',
  'POST /api/v1/bank-accounts',
  'DELETE /api/v1/bank-accounts/{bankAccountId}',
  // Ayrılış ve iade (routes/withdrawals.ts; DOM-FIN-041).
  'POST /api/v1/students/{studentId}/withdraw',
  'POST /api/v1/withdrawals/{withdrawalId}/pay-refund',
  // Sözleşme onayı ve ek protokol (routes/finance-contracts.ts; IST-092, DOM-FIN-010).
  'POST /api/v1/finance/contracts/{contractId}/signatory',
  'POST /api/v1/finance/contracts/{contractId}/approve',
  'POST /api/v1/finance/contracts/{contractId}/amendments',
  'POST /api/v1/finance/contracts/{contractId}/cancel-amendment',
]
// Onur: kayıt ve finans sonu

describe('yazma uçları', () => {
  useCommandsHarness()

  // Onur: kayıt ve finans
  describe('POST /workflows/renewal (DOM-FIN-002, -021)', () => {
    const body = {
      studentId: 's3',
      targetClassId: 'c1',
      year: 2027,
      mode: 'renew',
      total: 28_500,
      scholarship: 0,
      discount: 0,
      count: 8,
      startDate: '2026-11-15',
    }
    const renew = (cookie: string, input: unknown = body) =>
      post('/api/v1/workflows/renewal', cookie, input, { 'idempotency-key': randomUUID() })

    async function publishTuition(
      institutionId: string,
      academicYear: number,
      amountCents: number,
    ) {
      await db.insert(feeTariffs).values({
        institutionId,
        id: randomUUID(),
        academicYear,
        versionNumber: 1,
        status: 'published',
        items: [
          {
            kind: 'tuition',
            level: null,
            amountCents,
            unit: 'year',
            vatBasisPoints: 1000,
            vatEffectiveDate: '2026-01-01',
            announcedAmountCents: amountCents,
          },
        ],
        announcedDate: '2026-05-01',
        publishedByUserId: 'test',
        publishedAt: FIXED_NOW,
      })
    }

    test('hedef yılın tarifesi olmadan yenileme reddedilir, kayıt açılmaz', async () => {
      const a = await institution()
      await publishTuition(a.id, 2026, 2_850_000)
      const before = await count(a.id, 'renewals')
      assertError(await renew(a.adminCookie), 422, 'tariff_not_published')
      assert.equal(await count(a.id, 'renewals'), before)
    })

    test('ilanı veya indirim tavanını aşan yenileme reddedilir; tarifeye uyan açılır', async () => {
      const a = await institution()
      await publishTuition(a.id, 2027, 2_850_000)
      const before = await count(a.id, 'renewals')
      assertError(
        await renew(a.adminCookie, { ...body, total: 28_501 }),
        422,
        'renewal_above_tariff',
      )
      assertError(
        await renew(a.adminCookie, { ...body, discount: 14_251 }),
        422,
        'discount_cap_exceeded',
      )
      assert.equal(await count(a.id, 'renewals'), before)
      const created = await renew(a.adminCookie)
      assert.equal(created.statusCode, 200, created.body)
      assert.equal(await count(a.id, 'renewals'), before + 1)
    })

    test('başka kurumun tarifesi geçerli sayılmaz', async () => {
      const a = await institution()
      const other = await institution()
      await publishTuition(other.id, 2027, 2_850_000)
      assertError(await renew(a.adminCookie), 422, 'tariff_not_published')
    })
  })
  // Onur: kayıt ve finans sonu

  describe('Idempotency-Key envanteri', () => {
    test('OpenAPI: zorunlu Idempotency-Key uçlarında başlık required, diğerlerinde isteğe bağlı', () => {
      const document = app.swagger() as {
        paths: Record<string, Record<string, { parameters?: Record<string, unknown>[] }>>
      }
      const required: string[] = []
      for (const [path, methods] of Object.entries(document.paths))
        for (const [method, operation] of Object.entries(methods))
          for (const parameter of operation.parameters ?? [])
            if (parameter.in === 'header' && parameter.name === 'idempotency-key') {
              assert.equal('x-kampus-required-header' in (parameter.schema as object), false)
              if (parameter.required === true) required.push(`${method.toUpperCase()} ${path}`)
            }
      const expected = [...PLATFORM_IDEMPOTENT_ENDPOINTS, ...ONUR_IDEMPOTENT_ENDPOINTS]
      // Bir uç iki kaynakta bulunmaz; yinelenen satır envanteri sessizce şişirirdi.
      assert.equal(new Set(expected).size, expected.length, 'yinelenen envanter satırı')
      assert.deepEqual(required.sort(), expected.sort())
    })
  })
})
