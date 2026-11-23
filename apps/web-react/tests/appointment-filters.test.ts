import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appointmentFilters } from '../src/pages/communication/appointment-rows.ts'

test('DOM-ILT-104: süzgeç seçenekleri sabittir: öğrenci yalnız kendi türlerini, öğretmen ve veli üç türü görür', () => {
  const labels = (audience: Parameters<typeof appointmentFilters>[0], key: string) =>
    appointmentFilters(audience)
      .find((field) => field.key === key)
      ?.options?.map((option) => option.value)
  assert.deepEqual(labels('teacher', 'status'), [
    'Bekliyor',
    'Onaylandı',
    'Reddedildi',
    'İptal',
    'Geri çekildi',
  ])
  assert.deepEqual(labels('teacher', 'type'), [
    'Bireysel etüt',
    'Veli görüşmesi',
    'Akademik danışmanlık',
  ])
  assert.deepEqual(labels('parent', 'type'), labels('teacher', 'type'))
  assert.deepEqual(labels('student', 'type'), ['Bireysel etüt', 'Akademik danışmanlık'])
})
