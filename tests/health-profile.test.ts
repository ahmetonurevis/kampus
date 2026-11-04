import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  canWriteHealthProfile,
  changedHealthFields,
  emergencyView,
  healthAccessFor,
  healthProfileContentSchema,
  parseHealthProfileInput,
  requireHealthRead,
  requireHealthWrite,
  type HealthAccessInput,
  type HealthActor,
} from '../packages/school-core/src/lib/health-profile.ts'
import { isDomainError } from './support/domain-error.ts'

const ZodError = { name: 'ZodError' }
const NOW = '2026-11-04T09:00:00.000Z'
/** 18. yaş günü İstanbul'da 2026-11-05: `NOW` anında 17 yaşında. */
const MINOR_BIRTH = '2008-11-05'
/** 18. yaş günü 2026-11-04: `NOW` anında 18 yaşında. */
const ADULT_BIRTH = '2008-11-04'

const custodial = { custody: 'full', contactRestricted: false } as const
const joint = { custody: 'joint', contactRestricted: false } as const
const noCustody = { custody: 'none', contactRestricted: false } as const
const restricted = { custody: 'none', contactRestricted: true } as const
/** Velayetli ama iletişimi kısıtlı (mahkeme kararı vb.): kısıt velayeti ezer (DOM-ILT-070). */
const custodialRestricted = { custody: 'full', contactRestricted: true } as const

function input(actor: HealthActor, birthDate: string | undefined = MINOR_BIRTH): HealthAccessInput {
  return {
    actor,
    learner: birthDate === undefined ? {} : { birthDate },
    institutionType: 'school',
    now: NOW,
  }
}

describe('healthAccessFor ve canWriteHealthProfile (IST-020, DOM-ILT-035)', () => {
  const cases: [string, HealthActor, string | undefined, 'full' | 'emergency' | 'none', boolean][] =
    [
      ['yönetici tam okur ve yazar', { role: 'yonetici' }, MINOR_BIRTH, 'full', true],
      ['ön büro erişemez', { role: 'onburo' }, MINOR_BIRTH, 'none', false],
      [
        'rehber öğretmen tam okur, yazamaz',
        { role: 'ogretmen', homeroom: true, teachesClass: true },
        MINOR_BIRTH,
        'full',
        false,
      ],
      [
        'sınıfa derse giren öğretmen yalnız acil bilgiyi okur',
        { role: 'ogretmen', homeroom: false, teachesClass: true },
        MINOR_BIRTH,
        'emergency',
        false,
      ],
      [
        'başka sınıfın öğretmeni erişemez',
        { role: 'ogretmen', homeroom: false, teachesClass: false },
        MINOR_BIRTH,
        'none',
        false,
      ],
      [
        'velayetli kısıtsız veli tam okur ve yazar',
        { role: 'veli', bonds: [custodial] },
        MINOR_BIRTH,
        'full',
        true,
      ],
      [
        'ortak velayetli veli okur ve yazar',
        { role: 'veli', bonds: [joint] },
        MINOR_BIRTH,
        'full',
        true,
      ],
      [
        'velayetsiz veli erişemez',
        { role: 'veli', bonds: [noCustody] },
        MINOR_BIRTH,
        'none',
        false,
      ],
      ['kısıtlı veli erişemez', { role: 'veli', bonds: [restricted] }, MINOR_BIRTH, 'none', false],
      [
        'velayetli ama iletişimi kısıtlı veli erişemez',
        { role: 'veli', bonds: [custodialRestricted] },
        MINOR_BIRTH,
        'none',
        false,
      ],
      ['bağı olmayan veli erişemez', { role: 'veli', bonds: [] }, MINOR_BIRTH, 'none', false],
      [
        'yetişkin öğrencinin velisi erişemez',
        { role: 'veli', bonds: [custodial] },
        ADULT_BIRTH,
        'none',
        false,
      ],
      [
        'reşit olmayan öğrenci kendisi erişemez',
        { role: 'ogrenci', self: true },
        MINOR_BIRTH,
        'none',
        false,
      ],
      [
        '18 yaşındaki öğrenci kendisi okur ve yazar',
        { role: 'ogrenci', self: true },
        ADULT_BIRTH,
        'full',
        true,
      ],
      [
        'doğum tarihi bilinmeyen öğrenci 18 altı sayılır',
        { role: 'ogrenci', self: true },
        undefined,
        'none',
        false,
      ],
      ['başka öğrenci erişemez', { role: 'ogrenci', self: false }, ADULT_BIRTH, 'none', false],
    ]
  for (const [name, actor, birthDate, access, write] of cases)
    test(`DOM-ILT-035: ${name}`, () => {
      assert.equal(healthAccessFor(input(actor, birthDate)), access)
      assert.equal(canWriteHealthProfile(input(actor, birthDate)), write)
    })

  test('DOM-ILT-035: 18 yaş sınırı Europe/Istanbul gününe göre `now` ile', () => {
    const self: HealthActor = { role: 'ogrenci', self: true }
    // 2026-11-04 21:00 UTC İstanbul'da 5 Kasım 00:00: MINOR_BIRTH doğumlu 18 yaşına girer.
    const before = { ...input(self), now: '2026-11-04T20:59:59.000Z' }
    const after = { ...input(self), now: '2026-11-04T21:00:00.000Z' }
    assert.equal(healthAccessFor(before), 'none')
    assert.equal(healthAccessFor(after), 'full')
    const parent: HealthActor = { role: 'veli', bonds: [custodial] }
    assert.equal(healthAccessFor({ ...before, actor: parent }), 'full')
    assert.equal(healthAccessFor({ ...after, actor: parent }), 'none')
  })

  test('DOM-ILT-035: dil okulunda yetişkin seçilen kursiyer doğum tarihi olmadan kendisi okur', () => {
    const facts: HealthAccessInput = {
      actor: { role: 'ogrenci', self: true },
      learner: { prospectMinor: false },
      institutionType: 'language_school',
      now: NOW,
    }
    assert.equal(healthAccessFor(facts), 'full')
    assert.equal(healthAccessFor({ ...facts, institutionType: 'school' }), 'none')
  })
})

describe('requireHealthRead ve requireHealthWrite', () => {
  test('DOM-ILT-035: erişim düzeyini döndürür', () => {
    assert.equal(requireHealthRead(input({ role: 'yonetici' })), 'full')
    assert.equal(
      requireHealthRead(input({ role: 'ogretmen', homeroom: false, teachesClass: true })),
      'emergency',
    )
    assert.doesNotThrow(() => requireHealthWrite(input({ role: 'veli', bonds: [custodial] })))
  })

  test('DOM-ILT-035: kapsam dışı öğrenci 404, yetkisiz rol 403', () => {
    assert.throws(
      () => requireHealthRead(input({ role: 'ogretmen', homeroom: false, teachesClass: false })),
      isDomainError('student_not_found', 'not_found'),
    )
    assert.throws(
      () => requireHealthRead(input({ role: 'veli', bonds: [restricted] })),
      isDomainError('student_not_found', 'not_found'),
    )
    for (const write of [requireHealthRead, requireHealthWrite])
      assert.throws(
        () => write(input({ role: 'veli', bonds: [custodialRestricted] })),
        isDomainError('student_not_found', 'not_found'),
      )
    assert.throws(
      () => requireHealthRead(input({ role: 'ogrenci', self: false })),
      isDomainError('student_not_found', 'not_found'),
    )
    assert.throws(
      () => requireHealthRead(input({ role: 'onburo' })),
      isDomainError('health_profile_forbidden', 'forbidden'),
    )
    assert.throws(
      () => requireHealthRead(input({ role: 'ogrenci', self: true })),
      isDomainError('health_profile_forbidden', 'forbidden'),
    )
    assert.throws(
      () => requireHealthWrite(input({ role: 'ogretmen', homeroom: true, teachesClass: true })),
      isDomainError('health_profile_write_forbidden', 'forbidden'),
    )
    assert.throws(
      () => requireHealthWrite(input({ role: 'veli', bonds: [] })),
      isDomainError('student_not_found', 'not_found'),
    )
  })
})

describe('sağlık bilgisi şeması (DOM-ILT-035)', () => {
  const validContent = {
    allergies: [{ name: ' Fıstık ', severity: 'severe' }],
    chronicConditions: [{ name: 'Astım' }],
    medications: [{ name: 'Salbutamol', schedule: 'gerektiğinde', atSchool: true }],
    supportNeeds: [{ name: 'Asansör' }],
    emergencyInstructions: 'Adrenalin oto-enjektörü çantada.',
  }
  const valid = { ...validContent, legalBasis: 'explicit_consent', version: 1 }

  test('DOM-ILT-035: geçerli girdi kırpılır ve varsayılanlar doldurulur', () => {
    const parsed = parseHealthProfileInput(valid)
    assert.equal(parsed.allergies[0]?.name, 'Fıstık')
    const minimal = parseHealthProfileInput({ legalBasis: 'vital_interest', version: 3 })
    assert.deepEqual(minimal.allergies, [])
    assert.equal(minimal.emergencyInstructions, '')
    assert.equal(
      parseHealthProfileInput({ ...valid, medications: [{ name: 'X' }] }).medications[0]?.atSchool,
      false,
    )
  })

  test('DOM-ILT-035: doğrulama hataları', () => {
    const bad: unknown[] = [
      { ...valid, legalBasis: 'meşru_menfaat' },
      { ...valid, legalBasis: undefined },
      { ...valid, version: 0 },
      { ...valid, allergies: [{ name: '', severity: 'mild' }] },
      { ...valid, allergies: [{ name: 'Fıstık', severity: 'çok' }] },
      { ...valid, allergies: [{ name: 'x'.repeat(81), severity: 'mild' }] },
      {
        ...valid,
        allergies: [
          { name: 'Fıstık', severity: 'mild' },
          { name: 'FISTIK', severity: 'severe' },
        ],
      },
      { ...valid, supportNeeds: Array.from({ length: 21 }, (_, i) => ({ name: `İhtiyaç ${i}` })) },
      { ...valid, emergencyInstructions: 'x'.repeat(501) },
      // Serbest not alanı yok (en az veri).
      { ...valid, notes: 'Ailede kalp hastalığı var' },
      { ...valid, allergies: [{ name: 'Fıstık', severity: 'mild', detail: 'uzun açıklama' }] },
    ]
    for (const value of bad) assert.throws(() => parseHealthProfileInput(value), ZodError)
  })

  test('DOM-ILT-035: acil görünüm yalnız alerji ve acil talimatı taşır', () => {
    const content = healthProfileContentSchema.parse(validContent)
    assert.deepEqual(emergencyView(content), {
      allergies: [{ name: 'Fıstık', severity: 'severe' }],
      emergencyInstructions: 'Adrenalin oto-enjektörü çantada.',
    })
  })

  test('DOM-YTK-052: denetime yalnız değişen alan adları gider', () => {
    const before = healthProfileContentSchema.parse(validContent)
    const after = { ...before, emergencyInstructions: 'Yeni talimat' }
    assert.deepEqual(changedHealthFields(before, after), ['emergencyInstructions'])
    assert.deepEqual(changedHealthFields(null, after), [
      'allergies',
      'chronicConditions',
      'medications',
      'supportNeeds',
      'emergencyInstructions',
    ])
  })
})
