import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { commandFeedback, createCommandSession, runCommand } from '../src/commands.ts'
import {
  HEALTH_PROFILE_MESSAGES,
  canEditHealthProfile,
  healthFormValues,
  healthPanelMode,
  healthProfileFormSchema,
  healthSectionState,
  healthViewSections,
  normalizeHealthForm,
  toHealthPatch,
  type HealthFullData,
  type HealthProfileData,
} from '../src/health-profile-model.ts'
import { healthProfileKey } from '../src/query-keys.ts'
import { healthProfileRequest, patchHealthProfileRequest } from '../src/use-health-profile.ts'

// OG-090: sağlık ve acil bilgi ekranı modeli (DOM-ILT-035; okuma denetimi DOM-YTK-052).
const full = (over: Partial<HealthFullData['profile']> = {}): HealthFullData => ({
  level: 'full',
  version: 4,
  profile: {
    allergies: [{ name: 'Fıstık', severity: 'severe' }],
    chronicConditions: [{ name: 'Astım' }],
    medications: [{ name: 'Ventolin', schedule: 'gerektiğinde', atSchool: true }],
    supportNeeds: [{ name: 'Asansör' }],
    emergencyInstructions: 'Oto-enjektör çantada.',
    legalBasis: 'explicit_consent',
    updatedAt: '2026-11-01T08:00:00.000Z',
    ...over,
  },
})

const emergency: HealthProfileData = {
  level: 'emergency',
  profile: {
    allergies: [{ name: 'Fıstık', severity: 'severe' }],
    emergencyInstructions: 'Oto-enjektör çantada.',
  },
}

const apiError = (status: number, code: string) =>
  new ApiError({ status, code, message: 'x', issues: [] })

describe('DOM-ILT-035: acil görünüm', () => {
  test('acil düzey yalnız alerji ve acil talimat bölümlerini gösterir', () => {
    const sections = healthViewSections(emergency)
    assert.deepEqual(
      sections.map((section) => section.key),
      ['allergies', 'emergencyInstructions'],
    )
    const text = JSON.stringify(sections)
    assert.ok(text.includes('Fıstık'))
    assert.ok(!text.includes('Astım'))
    assert.ok(!text.includes('Ventolin'))
    assert.ok(!text.includes('Asansör'))
  })

  test('acil düzey yazma yetkisi olsa da salt okunur kısa karttır', () => {
    assert.equal(healthPanelMode(emergency, true), 'emergency')
    assert.equal(healthPanelMode(emergency, false), 'emergency')
  })

  test('ağır alerji acil vurgulu, şiddet Türkçe etiketlidir', () => {
    const [allergies] = healthViewSections(emergency)
    assert.equal(allergies?.items[0]?.urgent, true)
    assert.equal(allergies?.items[0]?.detail, 'Ağır (anafilaksi riski)')
  })
})

describe('DOM-ILT-035: tam görünüm ve düzenleme yetkisi', () => {
  test('tam görünüm bütün bölümleri gösterir', () => {
    assert.deepEqual(
      healthViewSections(full()).map((section) => section.key),
      ['allergies', 'chronicConditions', 'medications', 'supportNeeds', 'emergencyInstructions'],
    )
  })

  test('boş liste kayıtlı bilgi yok metniyle çizilir', () => {
    const sections = healthViewSections(full({ chronicConditions: [], emergencyInstructions: '' }))
    assert.equal(sections[1]?.items.length, 0)
    assert.equal(sections[1]?.empty, 'Kayıtlı bilgi yok.')
    assert.equal(sections[4]?.items.length, 0)
  })

  test('form yalnız yazma yetkisinde açılır: yönetici, veli, öğrenci', () => {
    for (const role of ['yonetici', 'veli', 'ogrenci'])
      assert.equal(canEditHealthProfile(role), true)
    for (const role of ['ogretmen', 'onburo']) assert.equal(canEditHealthProfile(role), false)
    assert.equal(healthPanelMode(full(), true), 'editable')
    assert.equal(healthPanelMode(full(), false), 'readonly')
  })
})

describe('DOM-ILT-035: 403 ve 404 bölümü gizler', () => {
  test('403 ve 404 hata göstermeden gizlenir', () => {
    assert.equal(
      healthSectionState({
        data: undefined,
        error: apiError(403, 'health_profile_forbidden'),
        isPending: false,
      }),
      'hidden',
    )
    assert.equal(
      healthSectionState({
        data: undefined,
        error: apiError(404, 'student_not_found'),
        isPending: false,
      }),
      'hidden',
    )
  })

  test('başka hata yeniden denemeyle gösterilir; yükleme ve hazır durumu', () => {
    assert.equal(
      healthSectionState({ data: undefined, error: apiError(500, 'internal'), isPending: false }),
      'error',
    )
    assert.equal(healthSectionState({ data: undefined, error: null, isPending: true }), 'loading')
    assert.equal(
      healthSectionState({ data: { data: full() }, error: null, isPending: false }),
      'ready',
    )
  })
})

describe('DOM-ILT-035: form ve kısmi PATCH', () => {
  test('form değeri kayıttan kopya alır ve sürümü taşır', () => {
    const saved = full()
    const form = healthFormValues(saved)
    form.allergies?.push({ name: 'Süt', severity: 'mild' })
    assert.equal(saved.profile.allergies.length, 1)
    assert.equal(form.version, 4)
    assert.equal(form.legalBasis, 'explicit_consent')
  })

  test('değişiklik yoksa istek gövdesi yoktur', () => {
    const saved = full()
    assert.equal(toHealthPatch(healthFormValues(saved), saved), null)
  })

  test('yalnız değişen alanlar ve version gönderilir', () => {
    const saved = full()
    const form = healthFormValues(saved)
    form.emergencyInstructions = 'Okul hemşiresini arayın.'
    assert.deepEqual(toHealthPatch(form, saved), {
      version: 4,
      emergencyInstructions: 'Okul hemşiresini arayın.',
    })
  })

  test('boş kullanım düzeni değişiklik sayılmaz ve gönderilmez', () => {
    const saved = full({ medications: [{ name: 'Vitamin', atSchool: false }] })
    const form = healthFormValues(saved)
    assert.equal(form.medications?.[0]?.schedule, '')
    assert.equal(toHealthPatch(form, saved), null)
    assert.deepEqual(normalizeHealthForm(form).medications, [{ name: 'Vitamin', atSchool: false }])
  })

  test('liste boşaltmak boş liste gönderir; dayanak değişimi gönderilir', () => {
    const saved = full()
    const form = healthFormValues(saved)
    form.allergies = []
    form.legalBasis = 'vital_interest'
    assert.deepEqual(toHealthPatch(form, saved), {
      version: 4,
      allergies: [],
      legalBasis: 'vital_interest',
    })
  })

  test('kayıt yokken yalnız dayanak seçmek istek üretmez, içerik girilince hepsi gider', () => {
    const empty = full({
      allergies: [],
      chronicConditions: [],
      medications: [],
      supportNeeds: [],
      emergencyInstructions: '',
      legalBasis: null,
      updatedAt: null,
    })
    const form = healthFormValues({ ...empty, version: 1 })
    form.legalBasis = 'explicit_consent'
    assert.equal(toHealthPatch(form, { ...empty, version: 1 }), null)
    form.chronicConditions = [{ name: 'Astım' }]
    assert.deepEqual(toHealthPatch(form, { ...empty, version: 1 }), {
      version: 1,
      chronicConditions: [{ name: 'Astım' }],
      legalBasis: 'explicit_consent',
    })
  })

  test('form şeması core kısmi şemasını uygular; kayıt yokken dayanak zorunludur', () => {
    const saved = full()
    const ok = healthProfileFormSchema(true).safeParse(normalizeHealthForm(healthFormValues(saved)))
    assert.equal(ok.success, true)
    const blankName = {
      ...healthFormValues(saved),
      allergies: [{ name: ' ', severity: 'mild' as const }],
    }
    assert.equal(healthProfileFormSchema(true).safeParse(blankName).success, false)
    const noBasis = { ...healthFormValues(saved), legalBasis: undefined }
    const result = healthProfileFormSchema(false).safeParse(noBasis)
    assert.equal(result.success, false)
    assert.equal(
      result.error?.issues.some((issue) => issue.path[0] === 'legalBasis'),
      true,
    )
    assert.equal(healthProfileFormSchema(true).safeParse(noBasis).success, true)
  })
})

describe('DOM-ILT-035: istek ve hata geri bildirimi', () => {
  test('GET ve PATCH aynı uç yoluna gider; PATCH gövdesinde version vardır', async () => {
    const calls: Request[] = []
    const client = createKampusClient({
      baseUrl: 'http://localhost',
      credentials: 'include',
      requestId: () => undefined,
      fetch: async (input: string | Request | URL) => {
        calls.push(input as Request)
        return Response.json({ data: {} })
      },
    })
    await healthProfileRequest(client, 's 1')
    await patchHealthProfileRequest(client, 's 1', { version: 4, emergencyInstructions: 'x' })
    assert.equal(calls[0]?.method, 'GET')
    assert.equal(calls[1]?.method, 'PATCH')
    assert.ok(new URL(calls[1]!.url).pathname.endsWith('/api/v1/students/s%201/health-profile'))
    assert.deepEqual(await calls[1]!.clone().json(), { version: 4, emergencyInstructions: 'x' })
    assert.equal(calls[1]!.headers.get('if-match'), null)
    assert.deepEqual(healthProfileKey('s-1'), ['health-profile', 's-1'])
  })

  test('409 sürüm çakışması profili yeniden yükletir ve Türkçe söyler', async () => {
    const error = apiError(409, 'version_conflict')
    const feedback = commandFeedback(error, HEALTH_PROFILE_MESSAGES)
    assert.equal(feedback.refresh, true)
    assert.equal(feedback.message, 'Sağlık bilgisi başka bir yerde değişti, güncel hâli yüklendi.')

    let refreshed = 0
    let notified: string | null = null
    const outcome = await runCommand(
      createCommandSession(),
      {
        execute: () => Promise.reject(error),
        refresh: async () => {
          refreshed += 1
        },
        messages: HEALTH_PROFILE_MESSAGES,
        exclusive: true,
      },
      { version: 4 },
      {
        notifyError: (message) => {
          notified = message
        },
      },
    )
    assert.equal(outcome.status, 'failed')
    assert.equal(refreshed, 1)
    assert.equal(notified, 'Sağlık bilgisi başka bir yerde değişti, güncel hâli yüklendi.')
  })

  test('403 yazma reddi Türkçe toast olur ve sorguyu yenilemez', () => {
    const feedback = commandFeedback(
      apiError(403, 'health_profile_write_forbidden'),
      HEALTH_PROFILE_MESSAGES,
    )
    assert.equal(feedback.refresh, false)
    assert.equal(feedback.message, 'Sağlık ve acil bilgiyi değiştirme yetkiniz yok.')
  })
})
