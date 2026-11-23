import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  consentEventLabel,
  consentRows,
  recentConsentEvents,
} from '../src/pages/crm/prospect-consent.ts'

const AT = '2026-10-07T10:00:00.000Z'

test('DOM-KAY-004: onay satırları üç kanalı sırayla gösterir; kaydı olmayan eski aday onaysızdır', () => {
  const rows = consentRows({ email: 'aday@kampus.example' })
  assert.deepEqual(
    rows.map((row) => [row.channel, row.label, row.granted, row.at, row.blocked]),
    [
      ['sms', 'SMS', false, null, null],
      ['email', 'E-posta', false, null, null],
      ['call', 'Arama', false, null, null],
    ],
  )
})

test('DOM-KAY-004: verilen onay anıyla gösterilir; e-postasız adayda e-posta onayı engellenir ama geri alma engellenmez', () => {
  const noEmail = consentRows({
    email: '  ',
    marketingConsent: {
      sms: { granted: true, at: AT },
      email: { granted: false, at: AT },
      call: { granted: false, at: AT },
    },
  })
  assert.equal(noEmail[0]?.granted, true)
  assert.equal(noEmail[0]?.at, AT)
  assert.equal(noEmail[1]?.blocked, 'E-posta onayı için adayın e-posta adresi gerekir.')
  assert.equal(noEmail[0]?.blocked, null)
  // Onay zaten varsa e-postasız olsa da geri alınabilir.
  const granted = consentRows({
    marketingConsent: {
      sms: { granted: false, at: AT },
      email: { granted: true, at: AT },
      call: { granted: false, at: AT },
    },
  })
  assert.equal(granted[1]?.blocked, null)
})

test('DOM-KAY-004: son olaylar en yeni üstte ve sınırlıdır; olay metni kanalı ve kararı söyler', () => {
  const by = { role: 'onburo' as const, userId: 'u1' }
  const events = Array.from({ length: 7 }, (_, index) => ({
    channel: 'sms' as const,
    granted: index % 2 === 0,
    at: `2026-10-0${index + 1}T10:00:00.000Z`,
    by,
  }))
  const recent = recentConsentEvents(events)
  assert.equal(recent.length, 5)
  assert.equal(recent[0]?.at, '2026-10-07T10:00:00.000Z')
  assert.deepEqual(recentConsentEvents(undefined), [])
  assert.equal(consentEventLabel({ channel: 'email', granted: true }), 'E-posta onayı verildi')
  assert.equal(consentEventLabel({ channel: 'call', granted: false }), 'Arama onayı geri alındı')
})
