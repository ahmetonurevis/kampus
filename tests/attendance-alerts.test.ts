import test from 'node:test'
import assert from 'node:assert/strict'
import {
  attendanceAlertKey,
  attendanceAlerts,
  attendanceSnapshots,
  type AttendanceSnapshot,
} from '../packages/school-core/src/lib/attendance-alerts.ts'
import {
  hiddenNotificationKinds,
  notificationAudiences,
  notificationEnabled,
  notificationSubject,
} from '../packages/school-core/src/lib/notifications.ts'
import { NOTIFICATION_TYPES } from '../packages/school-core/src/modules/notification-types.ts'

/**
 * Yoklamadan devamsızlık bildirimi kararı (OG-043, IST-072; DOM-ILT-052): tür tanımı, alıcı
 * kitlesi, modül bağı ve yoklama farkından üretilen bildirimler.
 */

const NOW = '2026-10-06T09:00:00.000Z'
const row = (overrides: Partial<AttendanceSnapshot> = {}): AttendanceSnapshot => ({
  id: 'att-s1-2026-10-06',
  studentId: 's1',
  status: 'present',
  corrections: 0,
  date: '2026-10-06T09:00:00.000Z',
  ...overrides,
})

test('DOM-ILT-052: devamsızlık türleri zorunlu hizmet bildirimidir ve akademik modüle bağlıdır', () => {
  for (const kind of ['absence_recorded', 'absence_corrected'] as const) {
    const spec = NOTIFICATION_TYPES[kind]
    assert.deepEqual(
      [spec.topic, spec.category, spec.mandatory, spec.module],
      ['attendance', 'service', true, 'academic'],
    )
  }
  const on = { communication: true, academic: true }
  assert.equal(notificationEnabled('absence_recorded', on), true)
  assert.equal(notificationEnabled('absence_recorded', { ...on, academic: false }), false)
  assert.equal(notificationEnabled('absence_corrected', { ...on, communication: false }), false)
  // DOM-YTK-040: akademik kapalıyken tür bildirim merkezinde gizlenir; mazeret kararı
  // (`absence_decided`, DOM-ILT-053) da akademik modüle bağlıdır.
  assert.deepEqual(
    hiddenNotificationKinds({
      communication: true,
      academic: false,
      learning: true,
      crm: true,
      finance: true,
    }),
    [
      'absence_recorded',
      'absence_corrected',
      'absence_decided',
      'attendance_threshold_warning',
      'attendance_threshold_exceeded',
    ],
  )
})

test('DOM-ILT-052: alıcı 18 yaş altında veli, yetişkin kursiyerde kendisidir; veri yalnız kayıt kimliği', () => {
  for (const kind of ['absence_recorded', 'absence_corrected'] as const) {
    assert.deepEqual(notificationAudiences(kind, true), ['parent'])
    assert.deepEqual(notificationAudiences(kind, false), ['student'])
    assert.deepEqual(notificationSubject(kind, { attendanceId: 'att-1' }).subject, {
      type: 'attendance',
      id: 'att-1',
    })
    // Neden, durum ya da mazeret bildirime girmez (DOM-ILT-023).
    for (const data of [{ attendanceId: 'att-1', reason: 'Raporlu' }, { status: 'absent' }, {}])
      assert.throws(() => notificationSubject(kind, data), /invalid notification data/)
  }
})

test('DOM-ILT-052: başlık gün, ders, neden ve mazeret söylemez; yalnız öğrencinin adını taşır', () => {
  for (const kind of ['absence_recorded', 'absence_corrected'] as const)
    for (const title of Object.values(NOTIFICATION_TYPES[kind].titles))
      assert.doesNotMatch(title, /bugün|ders|rapor|mazeret|sağlık|hasta/i)
  assert.equal(
    NOTIFICATION_TYPES.absence_recorded.titles.parent,
    '{öğrenci} yoklamada gelmedi olarak işaretlendi.',
  )
})

test('DOM-ILT-052: ilk yoklamada gelmedi işaretlenen öğrenci için bildirim üretilir; geldi işaretliler için üretilmez', () => {
  const alerts = attendanceAlerts(
    [],
    [row(), row({ id: 'att-s2', studentId: 's2', status: 'absent' })],
    NOW,
  )
  assert.deepEqual(alerts, [
    {
      type: 'absence_recorded',
      studentId: 's2',
      attendanceId: 'att-s2',
      dedupeKey: 'att-s2:0',
      origin: null,
    },
  ])
})

test('DOM-ILT-052: aynı durumu yeniden kaydetmek bildirim üretmez (yinelenmez)', () => {
  const absent = row({ status: 'absent' })
  assert.deepEqual(attendanceAlerts([absent], [absent], NOW), [])
  assert.deepEqual(attendanceAlerts([row()], [row()], NOW), [])
})

test('DOM-ILT-052: gelmedi başka duruma düzeltilince düzeltme, tekrar gelmedi olunca yeni bildirim; anahtarlar ayrıdır', () => {
  const absent = row({ status: 'absent' })
  const corrected = row({ status: 'present', corrections: 1 })
  const [fix] = attendanceAlerts([absent], [corrected], NOW)
  assert.deepEqual(fix, {
    type: 'absence_corrected',
    studentId: 's1',
    attendanceId: absent.id,
    dedupeKey: `${absent.id}:1`,
    origin: attendanceAlertKey(absent),
  })
  const again = row({ status: 'absent', corrections: 2 })
  const [recorded] = attendanceAlerts([corrected], [again], NOW)
  assert.equal(recorded?.type, 'absence_recorded')
  assert.equal(recorded?.dedupeKey, `${absent.id}:2`)
  assert.notEqual(recorded?.dedupeKey, attendanceAlertKey(absent))
  // Geldi → geç gibi gelmedi olmayan değişiklik bildirim üretmez.
  assert.deepEqual(attendanceAlerts([row()], [row({ status: 'late', corrections: 1 })], NOW), [])
})

test('DOM-ILT-052: geçmiş güne ilk kez yazılan gelmedi aynı gün bildirimi değildir; gün Europe/Istanbul günüdür', () => {
  const past = row({ status: 'absent', date: '2026-10-05T09:00:00.000Z' })
  assert.deepEqual(attendanceAlerts([], [past], NOW), [])
  // 21:30Z ertesi gün 00:30 İstanbul: o gün için yoklama "aynı gün" sayılır.
  const lateNight = '2026-10-06T21:30:00.000Z'
  assert.equal(
    attendanceAlerts([], [row({ status: 'absent', date: '2026-10-07T09:00:00.000Z' })], lateNight)
      .length,
    1,
  )
  assert.equal(attendanceAlerts([], [row({ status: 'absent' })], lateNight).length, 0)
})

test('DOM-ILT-052: anlık görüntü yalnız günün satırlarını, düzeltme sayısıyla alır', () => {
  const attendance = [
    {
      id: 'a1',
      studentId: 's1',
      classId: 'c1',
      date: '2026-10-06T09:00:00.000Z',
      status: 'absent' as const,
      reason: '',
      corrections: [
        { previousStatus: 'present', status: 'absent' as const, reason: '', by: 'u', at: NOW },
      ],
    },
    {
      id: 'a2',
      studentId: 's2',
      classId: 'c1',
      date: '2026-10-05T09:00:00.000Z',
      status: 'present' as const,
      reason: '',
    },
  ]
  assert.deepEqual(attendanceSnapshots({ attendance }, '2026-10-06T09:00:00.000Z'), [
    {
      id: 'a1',
      studentId: 's1',
      status: 'absent',
      corrections: 1,
      date: '2026-10-06T09:00:00.000Z',
    },
  ])
})
