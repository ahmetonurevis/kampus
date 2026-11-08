import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, isNull } from 'drizzle-orm'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { supplierPayments } from '../../src/db/schema/finance-supplier-ledger.ts'
import {
  buildTestApp,
  createInstitution,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * Tedarikçi ödemesinin eşzamanlı yazımı (DOM-FIN-076; ON-143). PGlite tek bağlantılıdır; kurum
 * kilidi altında yeniden hesaplanan taksit kalanı yalnız gerçek PostgreSQL 16'da yarışır.
 */

const FINANCE = '/api/v1/finance'
type Json = Record<string, unknown>

describe('PostgreSQL 16: tedarikçi ödemesi eşzamanlılığı', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(cookie: string, url: string, payload: unknown) {
    return app.inject({
      method: 'POST',
      url,
      remoteAddress: '10.77.0.1',
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      payload: JSON.stringify(payload),
    })
  }
  function ok(response: Awaited<ReturnType<typeof call>>, status = 201): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }

  /** Kurum, tedarikçi, banka hesabı ve 1.000 TL'lik tek taksitli fatura. */
  async function tenant() {
    const created = await createInstitution(app)
    const admin = await signInAs(app, created.admin)
    const supplier = ok(
      await call(admin, `${FINANCE}/suppliers`, {
        name: 'Alfa Bilişim A.Ş.',
        type: 'company',
        taxNumber: '1234567890',
        taxOffice: 'Kadıköy',
        categories: ['it'],
      }),
    )
    const account = ok(
      await call(admin, '/api/v1/bank-accounts', {
        bankName: 'Örnek Bankası',
        iban: 'TR320010009999901234567890',
        accountHolder: 'Akademi Özel Okulları',
      }),
    )
    const invoice = ok(
      await call(admin, `${FINANCE}/supplier-invoices`, {
        supplierId: supplier.id,
        invoiceNumber: 'PG-1',
        invoiceDate: '2026-10-01',
        dueDate: '2026-10-31',
        amountCents: 100_000,
        amountIncludesVat: true,
        vatCents: 0,
      }),
    )
    const installment = (invoice.installments as Json[])[0] as Json
    return { id: created.id, admin, account, installment }
  }

  test('DOM-FIN-076: aynı taksite eşzamanlı ödemeler kalanı aşamaz; fazlası 422', async () => {
    const t = await tenant()
    const body = {
      installmentId: t.installment.id,
      paidDate: '2026-10-06',
      amountCents: 40_000,
      method: 'eft',
      bankAccountId: t.account.id,
    }
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => call(t.admin, `${FINANCE}/supplier-payments`, body)),
    )
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [201, 201, 422, 422])
    for (const response of responses.filter((item) => item.statusCode === 422))
      assert.equal(response.json().code, 'supplier_payment_exceeds_installment')
    const rows = await db
      .select()
      .from(supplierPayments)
      .where(and(eq(supplierPayments.institutionId, t.id), isNull(supplierPayments.cancelledAt)))
    assert.equal(
      rows.reduce((sum, row) => sum + row.amountCents, 0),
      80_000,
    )
  })
})
