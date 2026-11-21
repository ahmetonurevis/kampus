import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { defaultNotificationPreferences } from '@kampus/school-core/lib/notification-preferences.ts'

import { commandFeedback } from '../src/commands.ts'
import {
  NOTIFICATION_PREFERENCES_MESSAGES,
  channelCell,
  clearChildOverrides,
  effectiveChannels,
  hasChildOverrides,
  isChannelLocked,
  isDirty,
  lockedTopicNote,
  notificationPreferencesFormSchema,
  setChannel,
  toForm,
  toPatch,
  toggleChannel,
  type NotificationPreferencesRecord,
} from '../src/notification-preferences-model.ts'
import { ApiError } from '@kampus/api-client/errors.ts'
import { notificationPreferencesKey } from '../src/query-keys.ts'
import {
  notificationPreferencesRequest,
  patchNotificationPreferencesRequest,
} from '../src/use-notification-preferences.ts'

const record = (): NotificationPreferencesRecord => ({
  preferences: defaultNotificationPreferences(),
  version: 3,
})

describe('kanal kilidi', () => {
  test('uygulama içi her konuda, anlık bildirim zorunlu konuda kilitli', () => {
    assert.equal(isChannelLocked('homework', 'in_app'), true)
    assert.equal(isChannelLocked('homework', 'push'), false)
    assert.equal(isChannelLocked('attendance', 'push'), true)
    assert.equal(isChannelLocked('attendance', 'email'), false)
    assert.equal(lockedTopicNote('attendance'), 'Bu bildirim kapatılamaz')
    assert.equal(lockedTopicNote('homework'), null)
  })

  test('hücre etiketi konu ve kanalı söyler, kilitli hücre işaretlidir', () => {
    const form = toForm(record())
    const cell = channelCell(form, 'homework', 'email', null, 'Ödev ve sınav')
    assert.equal(cell.label, 'Ödev ve sınav — e-posta')
    assert.equal(cell.checked, false)
    const locked = channelCell(form, 'attendance', 'in_app', null, 'Devamsızlık')
    assert.equal(locked.checked, true)
    assert.equal(locked.locked, true)
  })

  test('kilitli kanal kapatılamaz, sıra sabittir', () => {
    assert.deepEqual(toggleChannel(['in_app', 'push'], 'attendance', 'push', false), [
      'in_app',
      'push',
    ])
    assert.deepEqual(toggleChannel(['in_app'], 'homework', 'sms', true), ['in_app', 'sms'])
    assert.deepEqual(toggleChannel(['in_app', 'email', 'sms'], 'homework', 'email', false), [
      'in_app',
      'sms',
    ])
  })
})

describe('form ve kapsam', () => {
  test('toForm kopya alır', () => {
    const saved = record()
    const form = toForm(saved)
    form.topics.homework.push('sms')
    assert.deepEqual(saved.preferences.topics.homework, ['in_app', 'push'])
  })

  test('çocuk kapsamı genel tercihi değiştirmez, genel tercihi izler ve temizlenir', () => {
    let form = toForm(record())
    assert.deepEqual(effectiveChannels(form, 'grade', 'c1'), ['in_app', 'push'])
    form = setChannel(form, 'grade', 'push', false, 'c1')
    assert.deepEqual(form.topics.grade, ['in_app', 'push'])
    assert.deepEqual(effectiveChannels(form, 'grade', 'c1'), ['in_app'])
    assert.deepEqual(effectiveChannels(form, 'grade', 'c2'), ['in_app', 'push'])
    assert.equal(hasChildOverrides(form, 'c1'), true)
    form = clearChildOverrides(form, 'c1')
    assert.equal(hasChildOverrides(form, 'c1'), false)
  })

  test('form şeması zorunlu tabanı alana yazar', () => {
    const form = toForm(record())
    form.topics.attendance = ['in_app']
    const result = notificationPreferencesFormSchema.safeParse(form)
    assert.equal(result.success, false)
    assert.deepEqual(result.error?.issues[0]?.path, ['topics', 'attendance'])
    form.topics.attendance = ['in_app', 'push']
    form.quietHours = { enabled: true, start: '22:00', end: '22:00' }
    const quiet = notificationPreferencesFormSchema.safeParse(form)
    assert.deepEqual(quiet.error?.issues[0]?.path, ['quietHours', 'end'])
  })
})

describe('kayıt gövdesi', () => {
  test('değişmeyen form boş gövde (yalnız sürüm) üretir', () => {
    const saved = record()
    assert.deepEqual(toPatch(toForm(saved), saved, true), { version: 3 })
    assert.equal(isDirty(toForm(saved), saved, true), false)
  })

  test('yalnız değişen konu ve sessiz saat gider', () => {
    const saved = record()
    let form = toForm(saved)
    form = setChannel(form, 'homework', 'email', true, null)
    form = { ...form, quietHours: { enabled: false, start: '21:00', end: '08:00' } }
    assert.deepEqual(toPatch(form, saved, false), {
      version: 3,
      topics: { homework: ['in_app', 'push', 'email'] },
      quietHours: { enabled: false, start: '21:00', end: '08:00' },
    })
    assert.equal(isDirty(form, saved, false), true)
  })

  test('çocuk kırılımı yalnız veli için gider, boş kayıt atılır', () => {
    const saved = record()
    let form = toForm(saved)
    form = setChannel(form, 'grade', 'push', false, 'c1')
    form = { ...form, children: { ...form.children, c2: {} } }
    assert.deepEqual(toPatch(form, saved, true).children, { c1: { grade: ['in_app'] } })
    assert.equal('children' in toPatch(form, saved, false), false)
  })
})

describe('istek ve hata', () => {
  test('uçlar ve anahtar', async () => {
    const calls: Request[] = []
    const client = createKampusClient({
      baseUrl: 'http://localhost',
      credentials: 'include',
      requestId: () => undefined,
      fetch: async (input) => {
        calls.push(input as Request)
        return Response.json({ data: { preferences: {}, version: 1 } })
      },
    })
    await notificationPreferencesRequest(client)
    await patchNotificationPreferencesRequest(client, { version: 1 })
    assert.equal(calls[0]?.method, 'GET')
    assert.equal(calls[1]?.method, 'PATCH')
    assert.ok(new URL(calls[1]!.url).pathname.endsWith('/api/v1/notification-preferences'))
    assert.deepEqual(await calls[1]!.clone().json(), { version: 1 })
    assert.equal(calls[1]!.headers.get('if-match'), null)
    assert.deepEqual(notificationPreferencesKey(), ['notification-preferences'])
  })

  test('409 sürüm çakışması tazeler ve Türkçe söyler', () => {
    const error = new ApiError({
      status: 409,
      code: 'version_conflict',
      message: 'x',
      issues: [],
    })
    const feedback = commandFeedback(error, NOTIFICATION_PREFERENCES_MESSAGES)
    assert.equal(feedback.refresh, true)
    assert.equal(feedback.message, 'Tercihleriniz başka bir yerde değişti, güncel hâli yüklendi.')
  })
})
