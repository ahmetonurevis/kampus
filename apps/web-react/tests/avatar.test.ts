import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AVATAR_TONE_COUNT, avatarTone, initials, normalizeName } from '../src/lib/avatar.ts'

test('avatar tonu Vue Avatar.vue ile aynı değeri üretir', () => {
  // Beklenen değerler Vue algoritmasıyla hesaplandı; renkler iki uygulamada aynı kalmalı.
  assert.equal(avatarTone('Deniz Yılmaz'), 2)
  assert.equal(avatarTone('Ayşe Yılmaz'), 4)
  assert.equal(avatarTone('Ece Yılmaz'), 0)
  assert.equal(avatarTone('Selin Kaya'), 3)
})

test('avatar tonu boşluk, büyük harf ve Unicode biçiminden bağımsızdır', () => {
  const tone = avatarTone('Ayşe Yılmaz')
  assert.equal(avatarTone('  AYŞE   YILMAZ '), tone)
  assert.equal(avatarTone('Ayşe Yılmaz'), tone)
  assert.equal(normalizeName('  İLKER  Işık '), 'ilker ışık')
})

test('avatar tonu her zaman aralıktadır ve boş adda çökmez', () => {
  for (const name of ['', ' ', 'a', 'Kampüs Dil Akademisi', 'Ğ'.repeat(200)]) {
    const tone = avatarTone(name)
    assert.ok(Number.isInteger(tone) && tone >= 0 && tone < AVATAR_TONE_COUNT, name)
  }
})

test('baş harfler ilk iki kelimeden alınır', () => {
  assert.equal(initials('Deniz Yılmaz'), 'DY')
  assert.equal(initials('Kampüs Dil Akademisi'), 'KD')
  assert.equal(initials(''), '')
})
