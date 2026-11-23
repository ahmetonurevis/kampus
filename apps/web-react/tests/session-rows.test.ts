import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { SessionListItem } from '@kampus/react-shared/account-security.ts'

import {
  formatSessionTime,
  revokeOthersConfirm,
  revokeSessionConfirm,
  sessionRow,
  sessionRows,
} from '../src/pages/account/session-rows.ts'

function item(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id: 'oturum-1',
    createdAt: '2026-11-01T07:30:00.000Z',
    updatedAt: '2026-11-03T09:05:00.000Z',
    expiresAt: '2026-11-17T09:05:00.000Z',
    device: 'Chrome · macOS',
    current: false,
    ...overrides,
  }
}

describe('Oturumlarım satırları (IST-025)', () => {
  test('IST-025: tarih Europe/Istanbul saatiyle, geçersizse boş gösterilir', () => {
    assert.match(formatSessionTime('2026-11-03T09:05:00.000Z'), /3 Kas 2026 12:05/)
    assert.equal(formatSessionTime('gecersiz'), '')
  })

  test('IST-025: satır cihaz özeti, son etkinlik ve açılış taşır; özet yoksa "Bilinmeyen cihaz"', () => {
    const row = sessionRow(item())
    assert.equal(row.device, 'Chrome · macOS')
    assert.match(row.detail, /^Son etkinlik 3 Kas 2026 12:05 · Açılış 1 Kas 2026 10:30$/)
    assert.match(row.revokeLabel, /^Bu oturumu kapat: Chrome · macOS, son etkinlik 3 Kas 2026/)
    assert.equal(sessionRow(item({ device: null })).device, 'Bilinmeyen cihaz')
  })

  test('IST-025: bu oturum başta, ötekiler son etkinliğe göre yeniden eskiye', () => {
    const rows = sessionRows([
      item({ id: 'eski', updatedAt: '2026-11-01T08:00:00.000Z' }),
      item({ id: 'bu', current: true, updatedAt: '2026-10-30T08:00:00.000Z' }),
      item({ id: 'yeni', updatedAt: '2026-11-02T08:00:00.000Z' }),
    ])
    assert.deepEqual(
      rows.map((row) => [row.id, row.current]),
      [
        ['bu', true],
        ['yeni', false],
        ['eski', false],
      ],
    )
  })

  test('IST-025: satırda IP ya da belirteç alanı yoktur', () => {
    const row = sessionRow({ ...item(), ...{ ipAddress: '203.0.113.9', token: 'gizli' } })
    assert.deepEqual(Object.keys(row).sort(), ['current', 'detail', 'device', 'id', 'revokeLabel'])
    assert.equal(JSON.stringify(row).includes('203.0.113'), false)
  })

  test('IST-025: onay pencereleri ne kapanacağını söyler', () => {
    const one = revokeSessionConfirm(sessionRow(item({ device: 'Safari · iOS' })))
    assert.equal(one.title, 'Bu oturum kapatılsın mı?')
    assert.match(one.description, /^Safari · iOS \(son etkinlik .+\) cihazındaki oturum kapanır/)
    assert.equal(one.action, 'Bu oturumu kapat')
    const others = revokeOthersConfirm(2)
    assert.equal(others.title, 'Diğer tüm oturumlar kapatılsın mı?')
    assert.match(others.description, /Bu cihaz dışındaki 2 oturum kapanır/)
    assert.equal(others.action, 'Diğer tüm oturumları kapat')
  })
})
