import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bellLabel,
  notificationAction,
  notificationBellVisible,
  notificationHref,
  notificationTime,
  unreadBadgeText,
} from '../src/layout/notification-model.ts'
import { moduleKeys, type ModuleState } from '../src/lib/navigation.ts'

// IST-065, DOM-ILT-020: bildirim zili modeli.
const allOpen: ModuleState = Object.fromEntries(moduleKeys().map((key) => [key, true]))

test('IST-065: rozet 0 ve bilinmeyen sayıda yok, 99 sınırında 99+ yazar', () => {
  assert.equal(unreadBadgeText(undefined), null)
  assert.equal(unreadBadgeText(0), null)
  assert.equal(unreadBadgeText(1), '1')
  assert.equal(unreadBadgeText(99), '99')
  assert.equal(unreadBadgeText(100), '99+')
  assert.equal(unreadBadgeText(4000), '99+')
})

test('IST-065: zilin erişilebilir adı okunmamış sayısını taşır', () => {
  assert.equal(bellLabel(undefined), 'Bildirimler')
  assert.equal(bellLabel(0), 'Bildirimler')
  assert.equal(bellLabel(3), 'Bildirimler, 3 okunmamış')
  assert.equal(bellLabel(250), "Bildirimler, 99'dan fazla okunmamış")
})

test('IST-065: zil yalnız alıcı rolde ve communication modülü açıkken görünür', () => {
  assert.equal(notificationBellVisible('veli', allOpen), true)
  assert.equal(notificationBellVisible('ogrenci', allOpen), true)
  assert.equal(notificationBellVisible('veli', { ...allOpen, communication: false }), false)
  assert.equal(notificationBellVisible('veli', {}), false)
  assert.equal(notificationBellVisible('yonetici', allOpen), false)
})

test('IST-065: bildirim konuya göre rolün sayfasına gider, modül kapalıysa yönlenmez', () => {
  assert.equal(notificationHref('ogrenci', 'homework', allOpen), '/ogrenci/odevler')
  assert.equal(notificationHref('veli', 'homework', allOpen), '/veli/akademik-takip')
  assert.equal(notificationHref('ogrenci', 'homework', { ...allOpen, learning: false }), null)
  // Kayıt bildirimi için hedef sayfa yoktur: yalnız okundu işaretlenir.
  assert.equal(notificationHref('veli', 'enrollment', allOpen), null)
})

test('IST-065: okunmamış bildirime basınca okundu yazılır, okunmuşa yazılmaz', () => {
  const unread = notificationAction('ogrenci', { topic: 'homework', readAt: null }, allOpen)
  assert.deepEqual(unread, { markRead: true, href: '/ogrenci/odevler' })
  const read = notificationAction(
    'ogrenci',
    { topic: 'homework', readAt: '2026-11-02T10:00:00.000Z' },
    allOpen,
  )
  assert.equal(read.markRead, false)
  assert.deepEqual(notificationAction('veli', { topic: 'enrollment', readAt: null }, allOpen), {
    markRead: true,
    href: null,
  })
})

test('IST-065: zaman Europe/Istanbul gösterilir, başka yılda yıl yazılır', () => {
  const now = new Date('2026-11-02T12:00:00Z')
  assert.match(notificationTime('2026-11-02T11:05:00Z', now), /^2 Kas 14:05$/)
  assert.match(notificationTime('2025-12-31T20:30:00Z', now), /2025/)
  assert.equal(notificationTime('bozuk', now), '—')
})
