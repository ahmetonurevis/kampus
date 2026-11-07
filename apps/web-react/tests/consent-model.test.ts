import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ConsentPurpose } from '@kampus/school-core/lib/consent-purposes.ts'
import {
  ACCOUNT_PURPOSES,
  ADULT_SELF_INFO,
  GUARDIAN_GIVES_INFO,
  MINOR_ACCOUNT_INFO,
  STUDENT_PURPOSES,
  allGranted,
  canActOnConsent,
  choiceFor,
  choose,
  choosable,
  clearChoice,
  grantorInfo,
  isComplete,
  isObjectable,
  isStale,
  purposeNeedsStudent,
  purposeStep,
  stepKey,
  stepState,
  submitPlan,
  type PurposeSource,
} from '../src/components/consent/consent-model.ts'

// IST-017, DOM-YTK-057…062: rıza adımı modeli.
const ready = { state: 'ready', textId: 'tx-1' } as const
const base = (over: Partial<PurposeSource> = {}): PurposeSource => ({
  purpose: 'photo_video_sharing',
  actor: 'veli',
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
  const one = choose({}, 'photo_video_sharing', 'tx-1', 'granted')
  assert.equal(isComplete(steps, one), false)
  const both = choose(one, 'photo_video_print', 'tx-2', 'declined')
  // Metni olmayan amaç tamamlanmayı engellemez.
  assert.equal(isComplete(steps, both), true)
  // Karar bekleyen hiç yoksa (metni yok, rızayı başkası verir) form ilerleyebilir.
  assert.equal(isComplete([purposeStep(base({ text: { state: 'missing' } }))], {}), true)
  // Yüklenen ya da okunamayan amaç varken tamam değildir.
  assert.equal(isComplete([...steps, purposeStep(base({ status: undefined }))], both), false)
  assert.equal(isComplete([...steps, purposeStep(base({ text: { state: 'error' } }))], both), false)
})

test('DOM-YTK-058: gönderim planı yalnız onayları textId ile yazar; "onaylamıyorum" kayıt yazmaz', () => {
  const steps = [
    purposeStep(base()),
    purposeStep(base({ purpose: 'photo_video_print', text: { state: 'ready', textId: 'tx-2' } })),
  ]
  const choices = choose(
    choose({}, 'photo_video_sharing', 'tx-1', 'granted'),
    'photo_video_print',
    'tx-2',
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
    choose({}, 'photo_video_sharing', 'tx-1', 'granted'),
    'photo_video_print',
    'tx-2',
    'granted',
  )
  assert.deepEqual(clearChoice(choices, 'photo_video_sharing'), {
    photo_video_print: { textId: 'tx-2', choice: 'granted' },
  })
  // Girdi değişmez.
  assert.deepEqual(Object.keys(choices), ['photo_video_sharing', 'photo_video_print'])
})

test('DOM-YTK-060: metin sessizce tazelenince eski sürüme verilen seçim düşer ve yeniden sorulur', () => {
  const choices = choose({}, 'photo_video_sharing', 'tx-1', 'granted')
  const before = [purposeStep(base())]
  assert.equal(choiceFor(before[0]!, choices), 'granted')
  assert.equal(isComplete(before, choices), true)
  // Başka sekmede yeni sürüm yayımlandı; metin sorgusu tx-9 ile tazelendi.
  const after = [purposeStep(base({ text: { state: 'ready', textId: 'tx-9' } }))]
  assert.equal(choiceFor(after[0]!, choices), undefined)
  assert.equal(isStale(after[0]!, choices), true)
  assert.equal(isComplete(after, choices), false)
  // Okunmayan metne rıza gönderilmez.
  assert.deepEqual(submitPlan(after, choices), { grant: [], declined: [] })
  assert.deepEqual(stepState(true, after, choices).choices, {})
  // Yeni metne verilen karar geçerlidir.
  const again = choose(choices, 'photo_video_sharing', 'tx-9', 'granted')
  assert.equal(isStale(after[0]!, again), false)
  assert.deepEqual(submitPlan(after, again).grant, [
    { purpose: 'photo_video_sharing', textId: 'tx-9' },
  ])
})

test('DOM-YTK-057: rızayı başkası veriyorsa form yerine bilgi; kimin verdiği sunucunun grantor sonucudur', () => {
  const status = (
    grantor: 'self' | 'guardian' | null,
    purpose: ConsentPurpose = 'photo_video_sharing',
  ) => [{ purpose, valid: false, grantor }]
  // 18 yaş altı öğrenci: rızayı veli verir.
  assert.deepEqual(purposeStep(base({ actor: 'ogrenci', status: status('guardian') })), {
    purpose: 'photo_video_sharing',
    kind: 'other-grantor',
    info: GUARDIAN_GIVES_INFO,
  })
  // 18 yaşını doldurmuş çocuğun velisi: öğrenci kendisi verir.
  assert.deepEqual(purposeStep(base({ actor: 'veli', status: status('self') })), {
    purpose: 'photo_video_sharing',
    kind: 'other-grantor',
    info: ADULT_SELF_INFO,
  })
  // Eski yanıtta grantor yoksa karar sunucuya bırakılır.
  assert.equal(grantorInfo('ogrenci', 'photo_video_sharing', undefined), null)
  // Verebilecek kişiye form.
  assert.equal(purposeStep(base({ actor: 'veli', status: status('guardian') })).kind, 'choose')
  assert.equal(purposeStep(base({ actor: 'ogrenci', status: status('self') })).kind, 'choose')
  // Hesap amacı: hesap sahibi verir; 18 yaş altı öğrenci hesabında alınmaz.
  const promo = (actor: 'veli' | 'ogrenci', grantor: 'self' | null) =>
    purposeStep(
      base({
        actor,
        purpose: 'promotional_messages',
        studentId: undefined,
        status: status(grantor, 'promotional_messages'),
      }),
    )
  assert.equal(promo('veli', 'self').kind, 'choose')
  assert.equal(promo('ogrenci', 'self').kind, 'choose')
  assert.deepEqual(promo('ogrenci', null), {
    purpose: 'promotional_messages',
    kind: 'other-grantor',
    info: MINOR_ACCOUNT_INFO,
  })
  // Geçerli rıza bilgiden önce gelir: öğrenci velisinin verdiği rızayı "verilmiş" görür.
  assert.equal(
    purposeStep(
      base({
        actor: 'ogrenci',
        status: [{ purpose: 'photo_video_sharing', valid: true, grantor: 'guardian' }],
      }),
    ).kind,
    'valid',
  )
  // Rızayı başkası veriyorsa adım beklemez; form ilerleyebilir.
  assert.equal(
    isComplete([purposeStep(base({ actor: 'ogrenci', status: status('guardian') }))], {}),
    true,
  )
})

test('IST-017: onChange sözleşmesi — durum seçimleri, tamamlanmayı ve amaç durumlarını verir', () => {
  const steps = [
    purposeStep(base()),
    purposeStep(
      base({
        purpose: 'photo_video_print',
        status: [{ purpose: 'photo_video_print', valid: true }],
      }),
    ),
  ]
  // Açılışta: seçim yok, tamam değil.
  assert.deepEqual(stepState(true, steps, {}), {
    actionable: true,
    complete: false,
    choices: {},
    steps: { photo_video_sharing: 'choose', photo_video_print: 'valid' },
  })
  const chosen = choose({}, 'photo_video_sharing', 'tx-1', 'declined')
  assert.deepEqual(stepState(true, steps, chosen), {
    actionable: true,
    complete: true,
    choices: { photo_video_sharing: 'declined' },
    steps: { photo_video_sharing: 'choose', photo_video_print: 'valid' },
  })
  // Personel: adım tamamlanmaz, çağıran atlar.
  assert.deepEqual(stepState(false, [], {}), {
    actionable: false,
    complete: false,
    choices: {},
    steps: {},
  })
})

test('IST-017: onComplete sözleşmesi — bütün amaçlar zaten geçerliyse adım kendiliğinden biter', () => {
  const valid = (purpose: 'photo_video_sharing' | 'photo_video_print') =>
    purposeStep(base({ purpose, status: [{ purpose, valid: true }] }))
  const steps = [valid('photo_video_sharing'), valid('photo_video_print')]
  assert.equal(allGranted(steps), true)
  assert.equal(stepState(true, steps, {}).complete, true)
  // Biri karar bekliyorsa ya da yükleniyorsa kendiliğinden bitmez.
  assert.equal(allGranted([valid('photo_video_sharing'), purposeStep(base())]), false)
  assert.equal(
    allGranted([valid('photo_video_sharing'), purposeStep(base({ status: undefined }))]),
    false,
  )
  assert.equal(allGranted([]), false)
})

test('IST-017: öğrenci ya da amaç listesi değişince adımın kimliği değişir, seçimler sıfırlanır', () => {
  const purposes = ['photo_video_sharing', 'photo_video_print'] as const
  assert.equal(stepKey('s1', purposes), stepKey('s1', [...purposes]))
  assert.notEqual(stepKey('s1', purposes), stepKey('s2', purposes))
  assert.notEqual(stepKey('s1', purposes), stepKey('s1', ['photo_video_sharing']))
  assert.notEqual(
    stepKey(undefined, ['promotional_messages']),
    stepKey('s1', ['promotional_messages']),
  )
})
