import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  HEALTH_ACCESS_REASON_CODES,
  HEALTH_ACCESS_REASON_LABELS,
  HEALTH_ACCESS_REASON_TTL_MS,
  healthAccessActionLabel,
  healthAccessReasonHeaders,
  healthAccessReasonRequired,
  healthAccessReasonSchema,
  healthAccessReasonText,
  parseHealthAccessReasonHeaders,
  rememberedReasonValid,
} from '../packages/school-core/src/lib/finance-health-access.ts'

/** Sağlık verisi okuma gerekçesi kuralları (DOM-FIN-156; ON-164; K-523…K-525). */

const NOW = Date.parse('2026-10-06T09:00:00Z')

describe('DOM-FIN-156: sağlık verisi okuma gerekçesi', () => {
  test('DOM-FIN-156: kodlu gerekçe açıklamasız, "diğer" 5–200 karakter açıklamayla geçerli (K-523)', () => {
    for (const code of HEALTH_ACCESS_REASON_CODES.filter((item) => item !== 'other'))
      assert.deepEqual(healthAccessReasonSchema.parse({ code }), { code, note: null })
    assert.deepEqual(healthAccessReasonSchema.parse({ code: 'first_aid', note: '   ' }), {
      code: 'first_aid',
      note: null,
    })
    assert.deepEqual(healthAccessReasonSchema.parse({ code: 'other', note: '  Okul hekimi  ' }), {
      code: 'other',
      note: 'Okul hekimi',
    })
    assert.equal(
      healthAccessReasonSchema.safeParse({ code: 'other', note: 'x'.repeat(200) }).success,
      true,
    )
  })

  test('DOM-FIN-156: bilinmeyen kod, eksik ya da sınır dışı açıklama ve kodlu gerekçede açıklama reddedilir (K-523)', () => {
    const issue = (input: unknown) => {
      const result = healthAccessReasonSchema.safeParse(input)
      assert.equal(result.success, false)
      return result.error?.issues[0]
    }
    assert.deepEqual(issue({ code: 'curiosity' })?.path, ['code'])
    assert.equal(issue({})?.message, 'Erişim gerekçesini seçin.')
    assert.deepEqual(issue({ code: 'other' })?.path, ['note'])
    assert.deepEqual(issue({ code: 'other', note: 'abcd' })?.path, ['note'])
    assert.deepEqual(issue({ code: 'other', note: 'x'.repeat(201) })?.path, ['note'])
    assert.equal(
      issue({ code: 'emergency', note: 'ek açıklama' })?.message,
      'Açıklama yalnız "Diğer" gerekçede yazılır.',
    )
  })

  test('DOM-FIN-156: başlıklar gidiş-dönüşte aynı gerekçeyi verir; açıklama yüzde kodludur', () => {
    const reason = { code: 'other' as const, note: 'Şikâyet incelemesi: öğün' }
    const headers = healthAccessReasonHeaders(reason)
    assert.equal(headers['x-access-reason'], 'other')
    assert.match(headers['x-access-reason-note'] ?? '', /^[\x20-\x7e]+$/)
    assert.deepEqual(
      parseHealthAccessReasonHeaders({
        code: headers['x-access-reason'],
        note: headers['x-access-reason-note'],
      }),
      { ok: true, reason },
    )
    assert.deepEqual(healthAccessReasonHeaders({ code: 'emergency', note: null }), {
      'x-access-reason': 'emergency',
    })
  })

  test('DOM-FIN-156: başlık çözümü eksikte required, bozukta invalid döner', () => {
    const failure = (code: string | string[] | undefined, note?: string | string[]) => {
      const parsed = parseHealthAccessReasonHeaders({ code, note })
      assert.equal(parsed.ok, false)
      return parsed.ok ? null : parsed
    }
    assert.equal(failure(undefined)?.code, 'health_access_reason_required')
    assert.equal(failure('  ')?.code, 'health_access_reason_required')
    assert.deepEqual(failure(['first_aid', 'emergency'])?.issues[0]?.path, ['x-access-reason'])
    assert.deepEqual(failure('other', ['a', 'b'])?.issues[0]?.path, ['x-access-reason-note'])
    assert.equal(failure('other', '%E0%A4%A')?.issues[0]?.message, 'Açıklama okunamadı.')
    assert.equal(failure('curiosity')?.code, 'health_access_reason_invalid')
    assert.deepEqual(failure('other', 'abc')?.issues[0]?.path, ['x-access-reason-note'])
    assert.deepEqual(parseHealthAccessReasonHeaders({ code: [' first_aid '], note: undefined }), {
      ok: true,
      reason: { code: 'first_aid', note: null },
    })
  })

  test('DOM-FIN-156: personelden gerekçe istenir; veli ve öğrenciden istenmez', () => {
    for (const role of ['yonetici', 'onburo', 'ogretmen'] as const)
      assert.equal(healthAccessReasonRequired(role), true)
    for (const role of ['veli', 'ogrenci'] as const)
      assert.equal(healthAccessReasonRequired(role), false)
  })

  test('DOM-FIN-156: seçilen gerekçe 15 dakika geçerli; saat geri giderse geçersiz (K-525)', () => {
    const entry = { reason: { code: 'first_aid' as const, note: null }, chosenAt: NOW }
    assert.equal(rememberedReasonValid(undefined, NOW), false)
    assert.equal(rememberedReasonValid(entry, NOW), true)
    assert.equal(rememberedReasonValid(entry, NOW + HEALTH_ACCESS_REASON_TTL_MS - 1), true)
    assert.equal(rememberedReasonValid(entry, NOW + HEALTH_ACCESS_REASON_TTL_MS), false)
    assert.equal(rememberedReasonValid(entry, NOW - 1), false)
  })

  test('DOM-FIN-156: gerekçe ve kayıt türü metinleri', () => {
    assert.equal(healthAccessReasonText({ code: 'guardian_meeting', note: null }), 'Veli görüşmesi')
    assert.equal(
      healthAccessReasonText({ code: 'other', note: 'Okul hekimi' }),
      'Diğer: Okul hekimi',
    )
    assert.equal(Object.keys(HEALTH_ACCESS_REASON_LABELS).length, HEALTH_ACCESS_REASON_CODES.length)
    assert.equal(healthAccessActionLabel('finance.incident.read'), 'Kaza tutanağı')
    assert.equal(
      healthAccessActionLabel('finance.infirmary.schedule_read'),
      'İlaç uygulama listesi',
    )
    assert.equal(healthAccessActionLabel('toString'), 'Sağlık kaydı')
  })
})
