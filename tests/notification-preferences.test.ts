import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyNotificationPreferencesPatch,
  channelsFor,
  defaultNotificationPreferences,
  deliveryDecision,
  effectiveQuietHours,
  isMandatoryTopic,
  isQuietNow,
  notificationPreferencesPatchSchema,
  notificationPreferencesSchema,
  quietWithin,
  validateNotificationPreferences,
} from '../packages/school-core/src/lib/notification-preferences.ts'
import { isDomainError } from './support/domain-error.ts'

// 2026-11-04 Europe/Istanbul (UTC+3): 22:30 yerel = 19:30Z; 12:00 yerel = 09:00Z; 07:59 yerel = 04:59Z
const night = new Date('2026-11-04T19:30:00Z')
const noon = new Date('2026-11-04T09:00:00Z')

describe('DOM-ILT-020 kanal ve konu tercihi', () => {
  test('varsayılan tercih şemaya uyar ve doğrulanır', () => {
    const defaults = defaultNotificationPreferences()
    assert.deepEqual(notificationPreferencesSchema.parse(defaults), defaults)
    assert.deepEqual(validateNotificationPreferences(defaults), defaults)
    assert.deepEqual(defaults.quietHours, { enabled: true, start: '21:00', end: '08:00' })
  })

  test('kullanıcı konu başına kanal seçer; sıra normalize edilir', () => {
    const next = applyNotificationPreferencesPatch(defaultNotificationPreferences(), {
      topics: { grade: ['sms', 'in_app', 'email', 'sms'] },
    })
    assert.deepEqual(next.topics.grade, ['in_app', 'email', 'sms'])
    assert.deepEqual(next.topics.payment, ['in_app', 'push'])
  })

  test('zorunlu konuda anlık bildirim kapatılamaz, ek kanal eklenebilir', () => {
    assert.equal(isMandatoryTopic('attendance'), true)
    assert.equal(isMandatoryTopic('grade'), false)
    assert.throws(
      () =>
        applyNotificationPreferencesPatch(defaultNotificationPreferences(), {
          topics: { attendance: ['in_app'] },
        }),
      isDomainError('notification_channel_required'),
    )
    const ok = applyNotificationPreferencesPatch(defaultNotificationPreferences(), {
      topics: { attendance: ['in_app', 'push', 'sms'] },
    })
    assert.deepEqual(ok.topics.attendance, ['in_app', 'push', 'sms'])
  })

  test('uygulama içi kanal hiçbir konuda kapatılamaz', () => {
    assert.throws(
      () =>
        applyNotificationPreferencesPatch(defaultNotificationPreferences(), {
          topics: { bulletin: [] },
        }),
      isDomainError('notification_channel_required'),
    )
  })

  test('çocuk kırılımı genel tercihin yerine geçer ve zorunlu tabanı korur', () => {
    const next = applyNotificationPreferencesPatch(defaultNotificationPreferences(), {
      children: { deniz: { grade: ['in_app', 'email'] } },
    })
    assert.deepEqual(channelsFor(next, 'grade', 'deniz'), ['in_app', 'email'])
    assert.deepEqual(channelsFor(next, 'grade', 'ece'), ['in_app', 'push'])
    assert.throws(
      () =>
        applyNotificationPreferencesPatch(next, {
          children: { deniz: { attendance: ['in_app'] } },
        }),
      isDomainError('notification_channel_required'),
    )
  })

  test('bilinmeyen konu ve kanal şemada reddedilir', () => {
    assert.equal(
      notificationPreferencesPatchSchema.safeParse({ topics: { yok: ['in_app'] } }).success,
      false,
    )
    assert.equal(
      notificationPreferencesPatchSchema.safeParse({ topics: { grade: ['fax'] } }).success,
      false,
    )
  })
})

describe('DOM-ILT-021 sessiz saatler', () => {
  const quiet = { enabled: true, start: '21:00', end: '08:00' }

  test('gece yarısını aşan aralık', () => {
    assert.equal(isQuietNow(quiet, night), true)
    assert.equal(isQuietNow(quiet, noon), false)
    assert.equal(isQuietNow(quiet, new Date('2026-11-04T04:59:00Z')), true) // 07:59
    assert.equal(isQuietNow(quiet, new Date('2026-11-04T05:00:00Z')), false) // 08:00 bitiş hariç
    assert.equal(isQuietNow(quiet, new Date('2026-11-04T18:00:00Z')), true) // 21:00 başlangıç dahil
  })

  test('aynı gün içindeki aralık ve kapalı sessiz saat', () => {
    assert.equal(isQuietNow({ enabled: true, start: '12:00', end: '14:00' }, noon), true)
    assert.equal(isQuietNow({ ...quiet, enabled: false }, night), false)
  })

  test('başlangıç ve bitiş aynı olamaz; biçim HH:MM', () => {
    assert.throws(
      () =>
        applyNotificationPreferencesPatch(defaultNotificationPreferences(), {
          quietHours: { enabled: true, start: '10:00', end: '10:00' },
        }),
      isDomainError('quiet_hours_invalid'),
    )
    assert.equal(
      notificationPreferencesPatchSchema.safeParse({
        quietHours: { enabled: true, start: '25:00', end: '08:00' },
      }).success,
      false,
    )
  })

  test('kurum sınırı en geniş aralığı belirler', () => {
    const limit = { start: '20:00', end: '09:00' }
    assert.equal(quietWithin({ start: '21:00', end: '08:00' }, limit), true)
    assert.equal(quietWithin({ start: '19:00', end: '08:00' }, limit), false)
    assert.equal(quietWithin({ start: '21:00', end: '10:00' }, limit), false)
    const base = defaultNotificationPreferences()
    assert.throws(
      () =>
        applyNotificationPreferencesPatch(
          base,
          { quietHours: { enabled: true, start: '18:00', end: '08:00' } },
          limit,
        ),
      isDomainError('quiet_hours_over_limit'),
    )
    assert.deepEqual(effectiveQuietHours({ enabled: true, start: '18:00', end: '08:00' }, limit), {
      enabled: true,
      ...limit,
    })
  })
})

describe('teslim kararı', () => {
  const prefs = applyNotificationPreferencesPatch(defaultNotificationPreferences(), {
    topics: { homework: ['in_app', 'push', 'sms', 'email'] },
  })

  test('uygulama içi her zaman anında', () => {
    assert.equal(
      deliveryDecision({
        preferences: prefs,
        kind: 'feedback_released',
        channel: 'in_app',
        now: night,
      }),
      'send',
    )
  })

  test('sessiz saatte anlık ve SMS ertelenir, e-posta gider', () => {
    const base = { preferences: prefs, kind: 'feedback_released' as const }
    assert.equal(deliveryDecision({ ...base, channel: 'push', now: night }), 'defer')
    assert.equal(deliveryDecision({ ...base, channel: 'sms', now: night }), 'defer')
    assert.equal(deliveryDecision({ ...base, channel: 'email', now: night }), 'send')
    assert.equal(deliveryDecision({ ...base, channel: 'push', now: noon }), 'send')
  })

  test('seçilmeyen kanal gönderilmez', () => {
    assert.equal(
      deliveryDecision({
        preferences: defaultNotificationPreferences(),
        kind: 'feedback_released',
        channel: 'sms',
        now: noon,
      }),
      'skip',
    )
  })

  test('DOM-ILT-050 acil bildirim sessiz saati deler', () => {
    assert.equal(
      deliveryDecision({
        preferences: prefs,
        kind: 'feedback_released',
        channel: 'push',
        now: night,
        urgent: true,
      }),
      'send',
    )
  })

  test('zorunlu konuda anlık kanal tercihten bağımsız açıktır', () => {
    assert.equal(
      deliveryDecision({
        preferences: defaultNotificationPreferences(),
        kind: 'absence_recorded',
        channel: 'push',
        now: noon,
      }),
      'send',
    )
  })

  test('çocuğa göre ayrılan tercih uygulanır', () => {
    const child = applyNotificationPreferencesPatch(defaultNotificationPreferences(), {
      children: { deniz: { homework: ['in_app'] } },
    })
    const input = {
      preferences: child,
      kind: 'feedback_released' as const,
      channel: 'push' as const,
      now: noon,
    }
    assert.equal(deliveryDecision({ ...input, studentId: 'deniz' }), 'skip')
    assert.equal(deliveryDecision({ ...input, studentId: 'ece' }), 'send')
  })
})
