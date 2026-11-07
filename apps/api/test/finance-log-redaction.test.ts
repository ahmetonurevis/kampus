import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { Database } from '../src/db/client.ts'
import { buildTestApp, createTestDatabase } from './support/app.ts'

/**
 * Kayıt ve finans uçlarının serbest metin ve kişisel alanları logda gizlenir (guvenlik-kvkk.md
 * §13, `REDACTED_PATHS`). Uygulamanın gerçek logger yapılandırması kullanılır; gövde zaten
 * loglanmaz, bu test bir gün loglanırsa da açığa çıkmadığını sabitler.
 */
describe('guvenlik-kvkk: kayıt ve finans alanları logda gizlenir', () => {
  let db: Database
  let close: () => Promise<void>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
  })
  after(async () => {
    await close()
  })

  test('DOM-DIL-051, DOM-FIN-036, DOM-FIN-040, DOM-KAY-009: gerekçe, imza yetkilisi ve veli adı üst düzeyde ve iç içe yazılmaz', async () => {
    const logs: string[] = []
    const texts = {
      usedHoursReason: 'Gizli-kullanilan-saat-gerekcesi',
      extendReason: 'Gizli-uzatma-gerekcesi',
      bodyReason: 'Gizli-govde-gerekcesi',
      amendmentReason: 'Gizli-ek-protokol-gerekcesi',
      reversalReason: 'Gizli-ters-kayit-gerekcesi',
      reopenReason: 'Gizli-yeniden-acma-gerekcesi',
      payerDecisionReason: 'Gizli-odeyici-karari-gerekcesi',
      signatoryName: 'Gizli Imza Yetkilisi',
      rowSignatoryName: 'Gizli Satir Yetkilisi',
      guardianName: 'Gizli Yeni Veli',
      bodyGuardianName: 'Gizli Govdedeki Veli',
      guardianPhone: '05559990779',
    }
    const app = await buildTestApp(db, {
      logs,
      extend(instance) {
        instance.post('/api/v1/test-finance-redaction', { schema: { hide: true } }, (request) => {
          request.log.info({ reason: texts.usedHoursReason, usedHours: 12 }, 'saat düzeltme')
          request.log.info({ body: { reason: texts.bodyReason } }, 'gövde gerekçesi')
          return { data: null }
        })
      },
    })
    try {
      const response = await app.inject({ method: 'POST', url: '/api/v1/test-finance-redaction' })
      assert.equal(response.statusCode, 200, response.body)
      app.log.info({ audit: { action: 'package.extend', reason: texts.extendReason } }, 'uzatma')
      app.log.info(
        {
          contract: { amendmentReason: texts.amendmentReason },
          payment: { reversalReason: texts.reversalReason },
          closing: { reopenReason: texts.reopenReason },
          payerDecision: { payer: 'student', reason: texts.payerDecisionReason },
        },
        'finans gerekçeleri',
      )
      app.log.info(
        { signatoryName: texts.signatoryName, row: { signatoryName: texts.rowSignatoryName } },
        'imza yetkilisi',
      )
      app.log.info(
        {
          guardian: { name: texts.guardianName, phone: texts.guardianPhone },
          body: { guardian: { kind: 'new', name: texts.bodyGuardianName } },
        },
        'kesin kayıt velisi',
      )
      const lines = logs.join('').split('\n').filter(Boolean)
      for (const message of [
        'saat düzeltme',
        'gövde gerekçesi',
        'uzatma',
        'finans gerekçeleri',
        'imza yetkilisi',
        'kesin kayıt velisi',
      ])
        assert.ok(
          lines.some((line) => line.includes(`"msg":"${message}"`)),
          `log satırı yok: ${message}`,
        )
      const text = lines.join('\n')
      for (const [field, value] of Object.entries(texts))
        assert.equal(text.includes(value), false, `logda: ${field}`)
      assert.ok(text.includes('[gizli]'))
      // Gizleme yalnız hassas alanı örter; saat ve satış eylemi logda kalır.
      assert.ok(text.includes('"usedHours":12'))
      assert.ok(text.includes('"action":"package.extend"'))
    } finally {
      await app.close()
    }
  })
})
