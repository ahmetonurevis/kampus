import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultNotificationPreferences } from '@kampus/school-core/lib/notification-preferences.ts'
import { setChannel } from '@kampus/react-shared/notification-preferences-model.ts'
import {
  CHANNEL_COLUMNS,
  DELIVERY_NOTE,
  GENERAL_SCOPE,
  preferenceRows,
  scopeOptions,
} from '../src/pages/settings/notification-preference-rows.ts'

test('sütunlar sabit sırada ve Türkçe', () => {
  assert.deepEqual(
    CHANNEL_COLUMNS.map((column) => column.label),
    ['Uygulama içi', 'Anlık bildirim', 'E-posta', 'SMS'],
  )
})

test('her konu bir satır, uygulama içi her yerde kilitli ve işaretli', () => {
  const rows = preferenceRows(defaultNotificationPreferences(), null)
  assert.equal(rows.length, 10)
  for (const row of rows) {
    const inApp = row.cells.find((cell) => cell.channel === 'in_app')
    assert.equal(inApp?.locked, true)
    assert.equal(inApp?.checked, true)
  }
  const homework = rows.find((row) => row.topic === 'homework')
  assert.equal(homework?.label, 'Ödev ve sınav')
  assert.equal(homework?.note, null)
  assert.equal(homework?.cells[2]?.label, 'Ödev ve sınav — e-posta')
})

test('zorunlu konuda taban kanallar kilitli ve açıklamalı', () => {
  const row = preferenceRows(defaultNotificationPreferences(), null).find(
    (item) => item.topic === 'attendance',
  )
  assert.equal(row?.note, 'Bu bildirim kapatılamaz')
  assert.deepEqual(
    row?.cells.map((cell) => cell.locked),
    [true, true, false, false],
  )
})

test('çocuk kapsamı çocuğa özel tercihi gösterir', () => {
  const form = setChannel(defaultNotificationPreferences(), 'grade', 'push', false, 'c1')
  const own = preferenceRows(form, 'c1').find((row) => row.topic === 'grade')
  const general = preferenceRows(form, null).find((row) => row.topic === 'grade')
  assert.equal(own?.cells[1]?.checked, false)
  assert.equal(general?.cells[1]?.checked, true)
})

test('kapsam seçenekleri adsız çocuğu atar', () => {
  const options = scopeOptions([{ id: 'a', name: 'Deniz Yılmaz' }, { id: 'b' }])
  assert.deepEqual(
    options.map((option) => option.value),
    [GENERAL_SCOPE, 'a'],
  )
})

test('teslim notu yanıltıcı söz vermez', () => {
  assert.match(DELIVERY_NOTE, /kurumunuz bu kanalları açtığında/)
})
