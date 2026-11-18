import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SeveranceEstimateResult } from '@kampus/react-shared/use-finance-severance.ts'
import {
  SEVERANCE_ESTIMATE_NOTE,
  severanceEstimate,
  severanceWarningCodes,
  type SeveranceRequestInput,
} from '@kampus/school-core/lib/finance-severance.ts'
import {
  severanceBody,
  severanceDefaults,
  severanceFormField,
  severanceFormSchema,
  severanceSuggestionFields,
  type SeveranceFormValues,
} from '../src/pages/finance/finance-severance-form.ts'
import {
  SEVERANCE_ESTIMATE_TITLE,
  severanceEstimateDocument,
  severanceEstimateFilename,
} from '../src/lib/pdf/templates/finance-severance.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// ON-205 (DOM-FIN-094): kıdem ve ihbar hesaplayıcı form modeli ve tahmin PDF'i.

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-11-15T09:00:00.000Z'),
}

const values = (overrides: Partial<SeveranceFormValues> = {}): SeveranceFormValues => ({
  ...severanceDefaults('2025-06-30'),
  startDate: '2023-01-02',
  grossWage: '30.000,00',
  exitReason: 'employer_termination',
  ...overrides,
})

const fieldErrors = (input: SeveranceFormValues) => {
  const parsed = severanceFormSchema.safeParse(input)
  return parsed.success
    ? {}
    : Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]))
}

const result = (input: SeveranceRequestInput): SeveranceEstimateResult => {
  const estimate = severanceEstimate(input)
  return { ...estimate, warnings: severanceWarningCodes(estimate) }
}

test('DOM-FIN-094: form tutarı kuruşa, boş isteğe bağlı alanları varsayılana çevirir', () => {
  assert.deepEqual(fieldErrors(values()), {})
  assert.deepEqual(severanceBody(values()), {
    startDate: '2023-01-02',
    endDate: '2025-06-30',
    grossWageCents: 3_000_000,
    regularBenefitsCents: 0,
    exitReason: 'employer_termination',
    noticeGiven: false,
    cumulativeTaxBaseCents: null,
    membershipId: null,
  })
  assert.deepEqual(
    severanceBody(
      values({ regularBenefits: '2.500,50', cumulativeTaxBase: '0', noticeGiven: true }),
    ),
    {
      startDate: '2023-01-02',
      endDate: '2025-06-30',
      grossWageCents: 3_000_000,
      regularBenefitsCents: 250_050,
      exitReason: 'employer_termination',
      noticeGiven: true,
      cumulativeTaxBaseCents: 0,
      membershipId: null,
    },
  )
  assert.equal(severanceBody(values({ membershipId: 'm-1' })).membershipId, 'm-1')
})

test('DOM-FIN-094: personelin ücret önerisi forma dolar; öneri yoksa alanlara dokunulmaz (K-345)', () => {
  assert.deepEqual(
    severanceSuggestionFields({ grossWageCents: 6_000_000, regularBenefitsCents: 250_000 }),
    { grossWage: '60000,00', regularBenefits: '2500,00' },
  )
  assert.deepEqual(
    severanceSuggestionFields({ grossWageCents: 6_000_050, regularBenefitsCents: 0 }),
    { grossWage: '60000,50', regularBenefits: '' },
  )
  assert.equal(
    severanceSuggestionFields({ grossWageCents: null, regularBenefitsCents: null }),
    null,
  )
  // Doldurulan değer formdan geçer ve aynı kuruşa döner.
  const filled = values({ grossWage: '60000,00', regularBenefits: '2500,00', membershipId: 'm-1' })
  assert.deepEqual(fieldErrors(filled), {})
  assert.equal(severanceBody(filled).grossWageCents, 6_000_000)
  assert.equal(severanceBody(filled).regularBenefitsCents, 250_000)
  assert.equal(severanceFormField('membershipId'), 'membershipId')
})

test('DOM-FIN-094: form alan hataları ve core kuralları (gün sırası, tavan tablosu) alan mesajı olur', () => {
  assert.deepEqual(fieldErrors(values({ grossWage: '' })), {
    grossWage: 'Brüt ücreti 1.234,56 biçiminde, sıfırdan büyük girin (en fazla 10.000.000 ₺).',
  })
  assert.deepEqual(fieldErrors(values({ exitReason: '' })), {
    exitReason: 'Çıkış nedenini seçin.',
  })
  assert.deepEqual(fieldErrors(values({ startDate: '' })), {
    startDate: 'Geçerli bir tarih seçin.',
  })
  assert.equal(
    Object.keys(fieldErrors(values({ regularBenefits: 'abc' }))).join(),
    'regularBenefits',
  )
  assert.deepEqual(fieldErrors(values({ endDate: '2022-12-31' })), {
    endDate: 'Çıkış günü işe giriş gününden önce olamaz.',
  })
  assert.deepEqual(fieldErrors(values({ startDate: '2020-01-01', endDate: '2021-06-30' })), {
    endDate: 'Çıkış günü 2022 yılından önce olamaz; tavan tablosu 2022 ile başlar.',
  })
  assert.equal(severanceFormField('grossWageCents'), 'grossWage')
  assert.equal(severanceFormField('cumulativeTaxBaseCents'), 'cumulativeTaxBase')
  assert.equal(severanceFormField('institutionId'), undefined)
})

test('DOM-FIN-094: PDF dayanakları, dökümü, notları ve "tahmini hesap" uyarısını taşır; kişi adı yok', () => {
  const estimate = result({
    startDate: '2020-03-15',
    endDate: '2025-09-30',
    grossWageCents: 5_000_000,
    regularBenefitsCents: 500_000,
    exitReason: 'employer_termination',
  })
  const text = allTexts(severanceEstimateDocument(measurer, estimate, OPTIONS)).join('\n')
  for (const part of [
    'KIDEM VE İHBAR TAHMİNİ',
    SEVERANCE_ESTIMATE_TITLE,
    SEVERANCE_ESTIMATE_NOTE,
    'Akademi Özel Okulları',
    '5 yıl 6 ay 16 gün',
    '53.919,68 ₺',
    'Brüt tutar',
    '299.143,43 ₺',
    '102.666,67 ₺',
    'Net tutar',
    '383.360,36 ₺',
    'Ücret kaynağı',
    'Elle girildi',
    'Parametre kaynağı',
    'Platformun bordro parametresi',
    'binde 7,59',
  ])
    assert.ok(text.includes(part), part)
  assert.equal(severanceEstimateFilename(estimate), 'kidem-ihbar-tahmini-2025-09-30.pdf')

  const resigned = result({
    startDate: '2024-01-01',
    endDate: '2026-11-15',
    grossWageCents: 3_000_000,
    exitReason: 'resignation',
  })
  const notes = allTexts(severanceEstimateDocument(measurer, resigned, OPTIONS)).join('\n')
  for (const part of [
    'Notlar',
    'Kıdem: Bu çıkış nedeninde',
    'kıdem tavanı bordro parametrelerinde yok',
    'çalışan işverene öder',
  ])
    assert.ok(notes.includes(part), part)
})
