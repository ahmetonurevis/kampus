import assert from 'node:assert/strict'
import { test } from 'node:test'
import { badgeTone } from '../src/lib/badge-tone.ts'

test('rozet tonu durum metninden çıkarılır', () => {
  assert.equal(badgeTone('Ödendi'), 'green')
  assert.equal(badgeTone('Gecikmiş'), 'red')
  assert.equal(badgeTone('Bekliyor'), 'amber')
  // Vue Badge.vue gibi büyük/küçük harfe duyarlıdır.
  assert.equal(badgeTone('Onay bekliyor'), 'purple')
  assert.equal(badgeTone('Yeni'), 'purple')
})

test('açık ton verilirse metin eşleşmesi yok sayılır', () => {
  assert.equal(badgeTone('Ödendi', 'gray'), 'gray')
})
