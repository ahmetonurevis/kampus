import assert from 'node:assert/strict'
import test from 'node:test'

import { learnerWords } from '../packages/school-core/src/lib/enrollment-learner.ts'

test('DOM-KAY-012: okulda kayıtlı kişi öğrencidir; tür bilinmiyorsa okul sayılır', () => {
  for (const words of [learnerWords('school'), learnerWords()]) {
    assert.deepEqual(words, {
      title: 'Öğrenci',
      noun: 'öğrenci',
      plural: 'öğrenciler',
      genitive: 'öğrencinin',
      titleGenitive: 'Öğrencinin',
      dative: 'öğrenciye',
      titleDative: 'Öğrenciye',
      accusative: 'öğrenciyi',
    })
  }
})

test('DOM-KAY-012, ADR 0008: dil okulu ve kursta kayıtlı kişi kursiyerdir; ekler ünsüzle yazılır', () => {
  assert.deepEqual(learnerWords('language_school'), {
    title: 'Kursiyer',
    noun: 'kursiyer',
    plural: 'kursiyerler',
    genitive: 'kursiyerin',
    titleGenitive: 'Kursiyerin',
    dative: 'kursiyere',
    titleDative: 'Kursiyere',
    accusative: 'kursiyeri',
  })
})
