import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ACCOUNT_PURPOSES,
  STUDENT_PURPOSES,
  canActOnConsent,
  choose,
  choosable,
  clearChoice,
  isComplete,
  isObjectable,
  purposeNeedsStudent,
  purposeStep,
  submitPlan,
  type PurposeSource,
} from '../src/components/consent/consent-model.ts'

// IST-017, DOM-YTK-057…062: rıza adımı modeli.
const ready = { state: 'ready', textId: 'tx-1' } as const
const base = (over: Partial<PurposeSource> = {}): PurposeSource => ({
  purpose: 'photo_video_sharing',
  text: ready,
  status: [{ purpose: 'photo_video_sharing', valid: false }],
  studentId: 's1',
  ...over,
})

test('DOM-YTK-057: yalnız veli ve öğrenci rıza verir; personel ve oturumsuz veremez', () => {
  assert.equal(canActOnConsent('veli'), true)
  assert.equal(canActOnConsent('ogrenci'), true)
  for (const role of ['yonetici', 'onburo', 'ogretmen'] as const)
    assert.equal(canActOnConsent(role), false)
  assert.equal(canActOnConsent(undefined), false)
  assert.equal(canActOnConsent(null), false)
})

test('IST-017: amaçlar veri sahibine göre ayrılır; itiraz yalnız fotoğraf/video amaçlarında', () => {
  assert.deepEqual(ACCOUNT_PURPOSES, ['promotional_messages'])
  assert.ok(STUDENT_PURPOSES.includes('speaking_recording'))
  assert.ok(!STUDENT_PURPOSES.includes('promotional_messages'))
  assert.equal(purposeNeedsStudent('photo_video_print'), true)
  assert.equal(purposeNeedsStudent('promotional_messages'), false)
  assert.equal(isObjectable('photo_video_website'), true)
  assert.equal(isObjectable('speaking_recording'), false)
})

test('DOM-YTK-061: amaç durumu geçerlilik, öğrenci, metin ve veri durumundan çıkar', () => {
  assert.equal(purposeStep(base()).kind, 'choose')
  assert.deepEqual(purposeStep(base()), {
    purpose: 'photo_video_sharing',
    kind: 'choose',
    textId: 'tx-1',
  })
  // Geçerli rızası olan amaç karar beklemez (mükerrer rıza 409 olurdu).
  assert.equal(
    purposeStep(base({ status: [{ purpose: 'photo_video_sharing', valid: true }] })).kind,
    'valid',
  )
  // Başka amacın geçerliliği bu amacı etkilemez.
  assert.equal(
    purposeStep(base({ status: [{ purpose: 'photo_video_print', valid: true }] })).kind,
    'choose',
  )
  assert.equal(purposeStep(base({ studentId: undefined })).kind, 'needs-student')
  // Hesap amacı öğrencisiz de istenir.
  assert.equal(
    purposeStep(base({ purpose: 'promotional_messages', studentId: undefined })).kind,
    'choose',
  )
  assert.equal(purposeStep(base({ status: undefined })).kind, 'loading')
  assert.equal(purposeStep(base({ text: { state: 'loading' } })).kind, 'loading')
  assert.equal(purposeStep(base({ text: { state: 'missing' } })).kind, 'no-text')
  assert.equal(purposeStep(base({ text: { state: 'error' } })).kind, 'error')
})

test('DOM-YTK-058: rıza varsayılan değildir; seçim yoksa tamam değil, tüm karar bekleyenler seçilince tamam', () => {
  const steps = [
    purposeStep(base()),
    purposeStep(base({ purpose: 'photo_video_print', text: { state: 'ready', textId: 'tx-2' } })),
    purposeStep(base({ purpose: 'speaking_recording', text: { state: 'missing' } })),
  ]
  assert.equal(choosable(steps).length, 2)
  assert.equal(isComplete(steps, {}), false)
  const one = choose({}, 'photo_video_sharing', 'granted')
  assert.equal(isComplete(steps, one), false)
  const both = choose(one, 'photo_video_print', 'declined')
  // Metni olmayan amaç tamamlanmayı engellemez.
  assert.equal(isComplete(steps, both), true)
  // Karar bekleyen hiç yoksa adım tamamlanacak bir şey içermez.
  assert.equal(isComplete([purposeStep(base({ text: { state: 'missing' } }))], {}), false)
})

test('DOM-YTK-058: gönderim planı yalnız onayları textId ile yazar; "onaylamıyorum" kayıt yazmaz', () => {
  const steps = [
    purposeStep(base()),
    purposeStep(base({ purpose: 'photo_video_print', text: { state: 'ready', textId: 'tx-2' } })),
  ]
  const choices = choose(
    choose({}, 'photo_video_sharing', 'granted'),
    'photo_video_print',
    'declined',
  )
  assert.deepEqual(submitPlan(steps, choices), {
    grant: [{ purpose: 'photo_video_sharing', textId: 'tx-1' }],
    declined: ['photo_video_print'],
  })
  assert.deepEqual(submitPlan(steps, {}), { grant: [], declined: [] })
})

test('DOM-YTK-060: metin güncellenince eski karar silinir, diğer amaçların kararı kalır', () => {
  const choices = choose(
    choose({}, 'photo_video_sharing', 'granted'),
    'photo_video_print',
    'granted',
  )
  assert.deepEqual(clearChoice(choices, 'photo_video_sharing'), { photo_video_print: 'granted' })
  // Girdi değişmez.
  assert.deepEqual(choices, { photo_video_sharing: 'granted', photo_video_print: 'granted' })
})
