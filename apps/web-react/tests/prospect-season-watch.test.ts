import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SEASON_FOLLOW_UP_REASONS } from '@kampus/school-core/lib/prospect-season-watch.ts'
import {
  followUpLabel,
  followUpSince,
  followUpTone,
  meetingTitle,
  SEASON_DAY_OPTIONS,
  seasonDays,
  trialResultNote,
  windowText,
} from '../src/pages/crm/prospect-season-watch.ts'

// Kayıt sezonu nöbeti ekranı yardımcıları (DOM-KAY-037, ON-077).

test('DOM-KAY-037: pencere adresten okunur; varsayılan 7 gün ve seçenek dışı değer adrese yazılmaz', () => {
  assert.deepEqual(
    SEASON_DAY_OPTIONS.map((option) => option.value),
    [1, 3, 7, 14],
  )
  assert.equal(seasonDays('1'), 1)
  assert.equal(seasonDays('14'), 14)
  assert.equal(seasonDays('7'), undefined)
  assert.equal(seasonDays('5'), undefined)
  assert.equal(seasonDays('abc'), undefined)
  assert.equal(seasonDays(null), undefined)
})

test('DOM-KAY-037: takip nedeninin etiketi, tonu ve dayanak metni', () => {
  assert.deepEqual(
    SEASON_FOLLOW_UP_REASONS.map((reason) => [followUpLabel(reason), followUpTone(reason)]),
    [
      ['İlk temas bekliyor', 'red'],
      ['Görüşme sonucu bekleniyor', 'red'],
      ['Deneme sonrası takip', 'red'],
      ['Temas kesildi', 'amber'],
    ],
  )
  assert.equal(
    followUpSince({ reason: 'first_contact', sinceDate: '2026-10-03', days: 3 }),
    'Açılış: 3 Eki 2026 · 3 gün önce',
  )
  assert.equal(
    followUpSince({ reason: 'meeting_outcome', sinceDate: '2026-10-05', days: 1 }),
    'Görüşme: 5 Eki 2026 · 1 gün önce',
  )
  assert.equal(
    followUpSince({ reason: 'trial_outcome', sinceDate: '2026-10-06', days: 0 }),
    'Deneme dersi: 6 Eki 2026 · bugün',
  )
  assert.equal(
    followUpSince({ reason: 'stale', sinceDate: '2026-09-26', days: 10 }),
    'Son işlem: 26 Eyl 2026 · 10 gün önce',
  )
  assert.equal(trialResultNote(false), 'Öğretmen sonucu bekleniyor')
  assert.equal(trialResultNote(true), null)
  assert.equal(trialResultNote(null), null)
})

test('DOM-KAY-037: pencere açıklaması ve görüşme başlığı kurum türüne göre', () => {
  assert.equal(
    windowText({ from: '2026-10-06', to: '2026-10-12', days: 7 }),
    '6 Eki 2026 – 12 Eki 2026 · 7 gün',
  )
  assert.equal(
    windowText({ from: '2026-10-06', to: '2026-10-06', days: 1 }),
    '6 Eki 2026 · yalnız bugün',
  )
  assert.equal(meetingTitle('school'), 'Tanışma görüşmeleri')
  assert.equal(meetingTitle('language_school'), 'Seviye tespiti görüşmeleri')
})
