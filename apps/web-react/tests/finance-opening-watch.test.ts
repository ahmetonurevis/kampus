import assert from 'node:assert/strict'
import { test } from 'node:test'
import { learnerWords } from '@kampus/school-core/lib/enrollment-learner.ts'
import { OPENING_CHANGE_KINDS } from '@kampus/school-core/lib/finance-opening-watch.ts'
import {
  changeKindLabel,
  classColumnLabel,
  emptyText,
  financeViewSearch,
  termIdOf,
  windowOptions,
  withdrawnNote,
  YEAR_WINDOW,
  yearLabel,
  yearOptions,
} from '../src/pages/finance/finance-opening-watch.ts'

// Açılış nöbeti ekranı yardımcıları (DOM-FIN-061, ON-095).

test('DOM-FIN-061: pencere seçenekleri yıl açılışı ve dönemlerdir; dönem kimliği geri okunur', () => {
  const options = windowOptions([{ id: 't1', name: 'Güz' }])
  assert.deepEqual(options, [
    { value: YEAR_WINDOW, label: 'Eğitim yılı açılışı' },
    { value: 'donem:t1', label: 'Dönem: Güz' },
  ])
  assert.equal(termIdOf('donem:t1'), 't1')
  assert.equal(termIdOf(YEAR_WINDOW), undefined)
})

test('DOM-FIN-061: yıl seçenekleri etkin yılın çevresi ve adresteki yıl', () => {
  assert.deepEqual(yearOptions(2026, 2026), [2025, 2026, 2027])
  assert.deepEqual(yearOptions(2026, 2030), [2025, 2026, 2027, 2030])
  assert.equal(yearLabel(2026), '2026–2027')
})

test('DOM-FIN-061: bağlantılar finans sayfasının mevcut görünümlerine gider', () => {
  assert.equal(financeViewSearch('', { durum: 'gecikmis' }), '?durum=gecikmis')
  assert.equal(financeViewSearch('ayrilis', { iade: 'pending' }), '?gorunum=ayrilis&iade=pending')
  assert.equal(
    financeViewSearch('sozlesmeler', { sozlesme: 'k 1' }),
    '?gorunum=sozlesmeler&sozlesme=k+1',
  )
  assert.equal(financeViewSearch(''), '?')
})

test('DOM-FIN-061, DOM-KAY-012: okulda öğrenci ve sınıf, dil okulunda kursiyer ve grup', () => {
  assert.equal(classColumnLabel('school'), 'Sınıf')
  assert.equal(classColumnLabel(undefined), 'Sınıf')
  assert.equal(classColumnLabel('language_school'), 'Grup')
  assert.equal(
    emptyText(learnerWords('language_school'), 'iadesi bekleyen'),
    'Bu açılışta iadesi bekleyen kursiyer yok.',
  )
  assert.equal(
    emptyText(learnerWords('school'), 'iadesi bekleyen'),
    'Bu açılışta iadesi bekleyen öğrenci yok.',
  )
})

test('DOM-FIN-061: her kayıt olayının etiketi var; yenilemesiz ayrılış notu', () => {
  assert.deepEqual(OPENING_CHANGE_KINDS.map(changeKindLabel), [
    'Kesin kayıt',
    'Yenileme planı',
    'Dönem geçişi',
    'Mezuniyet',
    'Ayrılış',
  ])
  assert.equal(withdrawnNote(true), 'Yenilemeden ayrıldı')
  assert.equal(withdrawnNote(false), null)
})
