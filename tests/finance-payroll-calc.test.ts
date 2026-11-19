import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  PAYROLL_CALC_NOTE,
  grossForNet,
  incomeTaxUnits,
  monthlyIncomeTax,
  payrollCalcRow,
  payrollCalculation,
  payrollCalculationCsv,
  payrollCalculationFilename,
  payrollEarningLabel,
  payrollMonthParameters,
  payrollRunSaveSchema,
  payrollTaxCarryoverInputSchema,
  planPayrollRunSave,
  planPayrollTaxCarryover,
  unsavedPreviousMonths,
  type PayrollCalcRate,
  type PayrollPersonInput,
} from '../packages/school-core/src/lib/finance-payroll-calc.ts'
import {
  PAYROLL_PLATFORM_DEFAULTS,
  type PayrollInstitutionSet,
} from '../packages/school-core/src/lib/finance-payroll-parameters.ts'

/**
 * Bordro ön hesabı (DOM-FIN-115; ON-198; K-387…K-391). Beklenen değerler 2026 platform setiyle
 * (brüt asgari ücret 33.030,00 ₺; dilimler 190.000 / 400.000 / 1.500.000 / 5.300.000 ₺; SGK işçi
 * %14, işsizlik %1, işveren %20,75 − 5 puan, işsizlik işveren %2; damga binde 7,59; tavan 9 kat)
 * elle hesaplandı. Kaynak: GİB 2026 ücret gelir vergisi tarifesi (GVK md. 103), GVK md. 23/18 ve
 * DVK md. 9 asgari ücret istisnası, 5510 md. 81–82, 4447 md. 49. Aylık asgari ücret GV istisnası
 * 2026 için ocak–haziran 4.211,33 ₺, temmuz 4.537,75 ₺, ağustos–aralık 5.615,10 ₺; DV istisnası
 * 250,70 ₺ (GİB duyurusuyla **doğrulanmalı**, M-75). 2025 istisnası (ocak–temmuz 3.315,70 ₺,
 * ağustos 4.257,57 ₺) aynı yöntemle yeniden üretilir.
 */

const NO_SOURCES = { advances: [], garnishments: [], pensions: [] }
const member = { membershipId: 'm-1', name: 'Selin Kaya', role: 'ogretmen', active: true }

function wage(
  amountCents: number,
  startDate = '2026-01-01',
  rateType: PayrollCalcRate['rateType'] = 'monthly_gross',
  endDate: string | null = null,
): PayrollCalcRate {
  return {
    id: `w-${startDate}-${rateType}`,
    membershipId: member.membershipId,
    component: 'wage',
    rateType,
    amountCents,
    benefitForm: null,
    taxable: null,
    startDate,
    endDate,
  }
}

function person(rates: PayrollCalcRate[], overrides: Partial<PayrollPersonInput> = {}) {
  return {
    member,
    rates,
    missing: [],
    dates: null,
    lessonHours: [],
    adjustments: [],
    cumulativeIncomeTaxBaseBeforeCents: 0,
    unsavedPreviousMonths: [],
    medicalReportDays: 0,
    deductionSources: NO_SOURCES,
    ...overrides,
  } satisfies PayrollPersonInput
}

const row = (
  month: string,
  rates: PayrollCalcRate[],
  overrides: Partial<PayrollPersonInput> = {},
  sets: PayrollInstitutionSet[] = [],
) => payrollCalcRow(month, payrollMonthParameters(month, sets), person(rates, overrides))

const platform2026 = PAYROLL_PLATFORM_DEFAULTS.find((set) => set.id === 'platform-2026-01-01')
if (platform2026 === undefined) throw new Error('2026 platform seti yok')
const values2026 = (({ id, unverifiedFields, ...values }) => {
  void id
  void unverifiedFields
  return values
})(platform2026)
/** Varsayımsal yıl ortası artış: 1 Temmuz 2026'dan brüt asgari ücret 36.000,00 ₺ (kurum seti). */
const midYearSet: PayrollInstitutionSet = {
  ...values2026,
  id: 'set-2026-07',
  version: 1,
  effectiveFrom: '2026-07-01',
  minimumWageGrossCents: 3_600_000,
  source: 'Test: varsayımsal yıl ortası asgari ücret artışı',
}

describe('DOM-FIN-115: vergi yardımcıları', () => {
  test('DOM-FIN-115: dilim vergisi kümülatif farkla ve tek yuvarlamayla (K-390)', () => {
    const brackets = values2026.incomeTaxBrackets
    // 190.000 ₺ × %15 = 28.500 ₺ → kuruş × on binde bir.
    assert.equal(incomeTaxUnits(brackets, 19_000_000), 19_000_000 * 1500)
    // 127.500 → 255.000: 62.500 × %15 + 65.000 × %20 = 22.375 ₺.
    assert.equal(monthlyIncomeTax(brackets, 12_750_000, 12_750_000), 2_237_500)
    assert.equal(monthlyIncomeTax(brackets, 12_750_000, 0), 0)
    // 28.075,50 × %15 = 4.211,325 → yarım yukarı 4.211,33.
    assert.equal(monthlyIncomeTax(brackets, 0, 2_807_550), 421_133)
  })

  test('DOM-FIN-115: asgari ücret kümülatif matrahı aylara göre (K-388)', () => {
    assert.equal(payrollMonthParameters('2026-01', []).minimumWageBaseBeforeCents, 0)
    assert.equal(payrollMonthParameters('2026-07', []).minimumWageBaseBeforeCents, 16_845_300)
    // Yıl ortası değişimde temmuz öncesi eski asgari ücretle, ağustos öncesi temmuz yeniyle.
    const august = payrollMonthParameters('2026-08', [midYearSet])
    assert.equal(august.minimumWageBaseBeforeCents, 16_845_300 + 3_060_000)
    assert.equal(august.set.id, 'set-2026-07')
    assert.throws(
      () => payrollMonthParameters('2024-06', []),
      (error: unknown) =>
        error instanceof DomainError && error.code === 'payroll_parameters_missing',
    )
  })

  test('DOM-FIN-115: 2025 asgari ücret istisnası yayımlanan aylık tutarları üretir', () => {
    // GİB 2025: ocak–temmuz 3.315,70 ₺, ağustos 4.257,57 ₺ (doğrulanmalı, M-75).
    const january = row('2025-01', [wage(2_600_550, '2025-01-01')])
    assert.equal(january.incomeTaxExemptionCents, 331_570)
    assert.equal(january.incomeTaxPayableCents, 0)
    const august = row('2025-08', [wage(2_600_550, '2025-01-01')], {
      cumulativeIncomeTaxBaseBeforeCents: 7 * 2_210_468,
    })
    assert.equal(august.incomeTaxExemptionCents, 425_757)
    assert.equal(august.incomeTaxPayableCents, 0)
  })
})

describe('DOM-FIN-115: brütten nete', () => {
  test('DOM-FIN-115: asgari ücretli tam ay (2026 ocak)', () => {
    const result = row('2026-01', [wage(3_303_000)])
    assert.equal(result.complete, true)
    assert.equal(result.primDays, 30)
    assert.equal(result.grossCents, 3_303_000)
    assert.equal(result.sgkBaseCents, 3_303_000)
    assert.equal(result.sgkEmployeeCents, 462_420)
    assert.equal(result.unemploymentEmployeeCents, 33_030)
    assert.equal(result.incomeTaxBaseCents, 2_807_550)
    assert.equal(result.incomeTaxCents, 421_133)
    assert.equal(result.incomeTaxExemptionCents, 421_133)
    assert.equal(result.incomeTaxPayableCents, 0)
    assert.equal(result.stampTaxCents, 25_070)
    assert.equal(result.stampTaxExemptionCents, 25_070)
    assert.equal(result.stampTaxPayableCents, 0)
    // Net asgari ücret 28.075,50 ₺ (DOM-FIN-100 hesaplanan değeriyle aynı).
    assert.equal(result.netCents, 2_807_550)
    assert.equal(result.payableCents, 2_807_550)
    // İşveren: %15,75 → 5.202,225 → 5.202,23; işsizlik %2 → 660,60.
    assert.equal(result.sgkEmployerCents, 520_223)
    assert.equal(result.unemploymentEmployerCents, 66_060)
    assert.equal(result.employerCostCents, 3_889_283)
    assert.deepEqual(result.warnings, [])
  })

  test('DOM-FIN-115: asgari ücretli temmuz ve ağustosta istisna dilim atlar', () => {
    const july = row('2026-07', [wage(3_303_000)], {
      cumulativeIncomeTaxBaseBeforeCents: 6 * 2_807_550,
    })
    assert.equal(july.incomeTaxCents, 453_775)
    assert.equal(july.incomeTaxExemptionCents, 453_775)
    assert.equal(july.netCents, 2_807_550)
    const august = row('2026-08', [wage(3_303_000)], {
      cumulativeIncomeTaxBaseBeforeCents: 7 * 2_807_550,
    })
    assert.equal(august.incomeTaxExemptionCents, 561_510)
    assert.equal(august.incomeTaxPayableCents, 0)
  })

  test('DOM-FIN-115: dilim atlayan yüksek ücret kümülatif matrahla aylar boyu', () => {
    const rates = [wage(15_000_000)]
    const january = row('2026-01', rates)
    assert.equal(january.incomeTaxBaseCents, 12_750_000)
    assert.equal(january.incomeTaxCents, 1_912_500)
    assert.equal(january.incomeTaxPayableCents, 1_912_500 - 421_133)
    assert.equal(january.stampTaxPayableCents, 113_850 - 25_070)
    assert.equal(january.netCents, 11_169_853)
    const february = row('2026-02', rates, { cumulativeIncomeTaxBaseBeforeCents: 12_750_000 })
    assert.equal(february.incomeTaxCents, 2_237_500)
    assert.equal(february.netCents, 10_844_853)
    const march = row('2026-03', rates, { cumulativeIncomeTaxBaseBeforeCents: 25_500_000 })
    assert.equal(march.incomeTaxCents, 2_550_000)
    // Nisan: 382.500 → 510.000: 17.500 × %20 + 110.000 × %27 = 33.200 ₺.
    const april = row('2026-04', rates, { cumulativeIncomeTaxBaseBeforeCents: 38_250_000 })
    assert.equal(april.incomeTaxCents, 3_320_000)
    assert.equal(april.cumulativeIncomeTaxBaseBeforeCents, 38_250_000)
  })

  test('DOM-FIN-115: yıl ortası asgari ücret değişimi istisnayı yeni asgari ücretle hesaplar', () => {
    const july = row(
      '2026-07',
      [wage(3_600_000)],
      {
        cumulativeIncomeTaxBaseBeforeCents: 6 * 2_807_550,
      },
      [midYearSet],
    )
    // Asgari ücret matrahı 30.600 ₺; 168.453 → 199.053: 21.547 × %15 + 9.053 × %20 = 5.042,65.
    assert.equal(july.incomeTaxBaseCents, 3_060_000)
    assert.equal(july.incomeTaxCents, 504_265)
    assert.equal(july.incomeTaxExemptionCents, 504_265)
    assert.equal(july.stampTaxExemptionCents, 27_324)
    assert.equal(july.netCents, 3_060_000)
    assert.equal(july.sgkFloorCents, 3_600_000)
    // Eski ücretle kalan personel yeni tabana yükseltilir.
    const old = row('2026-07', [wage(3_303_000)], {}, [midYearSet])
    assert.equal(old.sgkBaseCents, 3_600_000)
    assert.ok(old.warnings.includes('below_floor'))
  })

  test('DOM-FIN-115: ay içi girişte gün oranı ve istisna gün oranlı', () => {
    const result = row('2026-03', [wage(6_000_000, '2026-03-16')])
    assert.equal(result.entryDate, '2026-03-16')
    assert.equal(result.primDays, 16)
    assert.equal(result.grossCents, 3_200_000)
    assert.equal(result.sgkFloorCents, 1_761_600)
    assert.equal(result.incomeTaxCents, 408_000)
    // Asgari ücret matrahı 28.075,50 × 16/30 = 14.973,60; şubat sonu kümülatifi 56.151 → %15.
    assert.equal(result.incomeTaxExemptionCents, 224_604)
    assert.equal(result.stampTaxExemptionCents, 13_371)
    assert.equal(result.netCents, 2_525_687)
    assert.ok(result.warnings.includes('entry_in_month'))
  })

  test('DOM-FIN-115: ay içi ücret değişiminde takvim günüyle ağırlıklandırılır', () => {
    const result = row('2026-04', [
      wage(6_000_000, '2026-01-01', 'monthly_gross', '2026-04-15'),
      wage(9_000_000, '2026-04-16'),
    ])
    // Nisan 30 gün: 15 gün 60.000, 15 gün 90.000 → 75.000.
    assert.equal(result.grossCents, 7_500_000)
    assert.equal(result.primDays, 30)
  })

  test('DOM-FIN-115: tavan aşımında SGK matrahı tavanda kesilir', () => {
    const result = row('2026-01', [wage(35_000_000)])
    assert.equal(result.sgkCeilingCents, 29_727_000)
    assert.equal(result.sgkBaseCents, 29_727_000)
    assert.equal(result.sgkEmployeeCents, 4_161_780)
    assert.equal(result.incomeTaxBaseCents, 30_540_950)
    assert.equal(result.incomeTaxCents, 5_158_190)
    assert.equal(result.netCents, 25_563_313)
    assert.equal(result.sgkEmployerCents, 4_682_003)
    assert.ok(result.warnings.includes('above_ceiling'))
  })

  test('DOM-FIN-115: icra kesintisi net ücretin dörtte biri, ödenecek netten düşer', () => {
    const result = row('2026-01', [wage(3_303_000)], {
      deductionSources: {
        advances: [
          {
            id: 'adv-1',
            amountCents: 300_000,
            installmentCount: 3,
            firstMonth: '2026-01',
            givenDate: '2025-12-20',
            status: 'active',
            closedFromMonth: null,
          },
        ],
        garnishments: [
          {
            id: 'icra-1',
            status: 'active',
            isAlimony: false,
            rateBasisPoints: 2500,
            remainingCents: 5_000_000,
            receivedDate: '2025-12-01',
            sequence: 1,
            closedDate: null,
          },
        ],
        pensions: [],
      },
    })
    assert.equal(result.netCents, 2_807_550)
    // Avans taksiti 1.000 ₺, icra 28.075,50 × %25 = 7.018,875 → aşağı 7.018,87 (K-315).
    assert.deepEqual(
      result.deductions.map((line) => [line.kind, line.amountCents, line.status]),
      [
        ['advance', 100_000, 'applied'],
        ['garnishment', 701_887, 'applied'],
      ],
    )
    assert.equal(result.deductionCents, 801_887)
    assert.equal(result.payableCents, 2_807_550 - 801_887)
  })

  test('DOM-FIN-115: BES matrahı SGK matrahıdır', () => {
    const result = row('2026-01', [wage(5_000_000)], {
      deductionSources: {
        advances: [],
        garnishments: [],
        pensions: [
          {
            id: 'bes-1',
            startDate: '2025-06-01',
            optOutDate: null,
            pauses: [],
            rateBasisPoints: 300,
          },
        ],
      },
    })
    assert.equal(result.deductions[0]?.amountCents, 150_000)
  })
})

describe('DOM-FIN-115: kalemler', () => {
  const benefit = (
    rateType: PayrollCalcRate['rateType'],
    amountCents: number,
    benefitForm: 'cash' | 'in_kind',
    taxable: boolean,
  ): PayrollCalcRate => ({
    id: `b-${rateType}`,
    membershipId: member.membershipId,
    component: 'benefit',
    rateType,
    amountCents,
    benefitForm,
    taxable,
    startDate: '2026-01-01',
    endDate: null,
  })
  const lessonRate: PayrollCalcRate = {
    id: 'l-extra',
    membershipId: member.membershipId,
    component: 'lesson',
    rateType: 'extra',
    amountCents: 25_000,
    benefitForm: null,
    taxable: null,
    startDate: '2026-01-01',
    endDate: null,
  }

  test('DOM-FIN-115: ek ders, nakdi ve ayni yan hak ile düzeltme matrahlara doğru girer (K-387)', () => {
    const result = row(
      '2026-01',
      [
        wage(4_000_000),
        lessonRate,
        benefit('meal', 300_000, 'cash', true),
        benefit('transport', 200_000, 'cash', false),
        benefit('service', 150_000, 'in_kind', false),
      ],
      {
        lessonHours: [
          { lessonType: 'extra', hours: 10 },
          { lessonType: 'duty', hours: 4 },
        ],
        adjustments: [
          { item: 'wage', amountCents: 50_000 },
          { item: 'deduction', amountCents: -20_000 },
        ],
      },
    )
    // Brüt: 40.000 + 2.500 ek ders + 3.000 + 2.000 nakdi yan hak + 500 düzeltme = 48.000 ₺.
    assert.equal(result.grossCents, 4_800_000)
    assert.equal(result.stampTaxBaseCents, 4_600_000)
    assert.equal(result.sgkBaseCents, 4_800_000)
    assert.equal(result.incomeTaxBaseCents, 4_600_000 - 672_000 - 48_000)
    assert.equal(result.inKindBenefitsCents, 150_000)
    assert.equal(result.netAdjustmentCents, -20_000)
    assert.equal(result.payableCents, result.netCents - 20_000)
    assert.equal(
      result.employerCostCents,
      4_800_000 + result.sgkEmployerCents + result.unemploymentEmployerCents + 150_000,
    )
    // Nöbet ücreti tanımı yok: saat eklenmez, uyarı.
    assert.ok(result.warnings.includes('lesson_rate_missing'))
    assert.deepEqual(result.earnings.map(payrollEarningLabel), [
      'Ana ücret · Aylık brüt',
      'Ek ders · Ek ders (10 saat)',
      'Yan hak · Yemek',
      'Yan hak · Yol (vergisiz)',
      'Düzeltme · Ana ücret',
    ])
  })

  test('DOM-FIN-115: eksik gün brütü düşürür; sağlık raporu günü fazlaysa uyarı', () => {
    const result = row('2026-01', [wage(6_000_000)], {
      missing: [{ days: 3, reasonCode: '21' }],
      medicalReportDays: 5,
    })
    assert.equal(result.primDays, 27)
    assert.equal(result.grossCents, 5_400_000)
    assert.ok(result.warnings.includes('medical_report_days'))
  })

  test('DOM-FIN-115: saatlik ücret hesaplanmaz, satır eksik ve toplama girmez', () => {
    const result = row('2026-01', [wage(50_000, '2026-01-01', 'hourly')])
    assert.equal(result.complete, false)
    assert.ok(result.warnings.includes('hourly_wage'))
  })

  test('DOM-FIN-115: düzeltmeler brütü eksiye indiremez', () => {
    const result = row('2026-01', [wage(3_303_000)], {
      adjustments: [{ item: 'other', amountCents: -4_000_000 }],
    })
    assert.equal(result.grossCents, 0)
    assert.ok(result.warnings.includes('negative_gross'))
  })
})

describe('DOM-FIN-115: netten brüte (K-389)', () => {
  test('DOM-FIN-115: net asgari ücret brüt asgari ücrete döner', () => {
    const result = row('2026-01', [wage(2_807_550, '2026-01-01', 'monthly_net')])
    assert.equal(result.grossCents, 3_303_000)
    assert.equal(result.netCents, 2_807_550)
    assert.equal(result.netDifferenceCents, 0)
    assert.equal(result.netTargetCents, 2_807_550)
    assert.ok(result.warnings.includes('net_wage'))
  })

  test('DOM-FIN-115: 40.000 ₺ net en küçük kuruş brüte döner', () => {
    const result = row('2026-01', [wage(4_000_000, '2026-01-01', 'monthly_net')])
    assert.equal(result.netCents, 4_000_000)
    assert.equal(result.grossCents, 4_970_972)
    // Bir kuruş eksik brüt hedefin altında kalır.
    const lower = row('2026-01', [wage(4_970_971)])
    assert.ok(lower.netCents < 4_000_000)
  })

  test('DOM-FIN-115: ek kalemler net hedefi değiştirmez, üstüne eklenir', () => {
    const result = row('2026-01', [wage(4_000_000, '2026-01-01', 'monthly_net')], {
      adjustments: [{ item: 'other', amountCents: 100_000 }],
    })
    assert.equal(result.grossCents, 4_970_972 + 100_000)
    assert.ok(result.netCents > 4_000_000)
  })

  test('DOM-FIN-115: ay içinde net ve brüt tanım birlikte', () => {
    const result = row('2026-04', [
      wage(6_000_000, '2026-01-01', 'monthly_gross', '2026-04-15'),
      wage(5_000_000, '2026-04-16', 'monthly_net'),
    ])
    assert.ok(result.warnings.includes('mixed_wage'))
    assert.equal(result.netTargetCents, 2_500_000)
    assert.ok(result.grossCents > 3_000_000)
  })

  test('DOM-FIN-115: hedef sıfırsa ters hesap yapılmaz', () => {
    const parameters = payrollMonthParameters('2026-01', [])
    const context = {
      values: parameters.set.values,
      primDays: 30,
      floorCents: 3_303_000,
      ceilingCents: 29_727_000,
      cumulativeBeforeCents: 0,
      incomeTaxExemptionLimitCents: 0,
      stampTaxExemptionLimitCents: 0,
    }
    assert.deepEqual(grossForNet(0, 0, context), { grossCents: 0, differenceCents: 0 })
  })
})

describe('DOM-FIN-115: ay listesi', () => {
  const rates = [wage(15_000_000)]
  const input = (
    month: string,
    overrides: Partial<Parameters<typeof payrollCalculation>[0]> = {},
  ) => ({
    month,
    parameters: payrollMonthParameters(month, []),
    members: [member, { membershipId: 'm-2', name: 'Ayşe Yılmaz', role: 'onburo', active: false }],
    rates,
    missing: [],
    dates: [],
    lessonHours: [],
    adjustments: [],
    savedBases: [],
    carryovers: [],
    medicalReportDays: new Map<string, number>(),
    deductionSources: new Map(),
    ...overrides,
  })

  test('DOM-FIN-115: kümülatif matrah kayıtlı önceki aylardan ve devirden (K-388)', () => {
    const march = payrollCalculation(
      input('2026-03', {
        savedBases: [
          { membershipId: 'm-1', month: '2026-01', incomeTaxBaseCents: 12_750_000 },
          { membershipId: 'm-1', month: '2026-02', incomeTaxBaseCents: 12_750_000 },
          // Önceki yıl ve sonraki ay kümülatife girmez.
          { membershipId: 'm-1', month: '2025-12', incomeTaxBaseCents: 99_000_000 },
          { membershipId: 'm-1', month: '2026-04', incomeTaxBaseCents: 99_000_000 },
        ],
      }),
    )
    assert.equal(march.rows.length, 1)
    assert.equal(march.rows[0]?.cumulativeIncomeTaxBaseBeforeCents, 25_500_000)
    assert.equal(march.rows[0]?.incomeTaxCents, 2_550_000)
    assert.deepEqual(march.rows[0]?.warnings, [])

    const carried = payrollCalculation(
      input('2026-01', {
        rates: [wage(5_000_000)],
        carryovers: [{ membershipId: 'm-1', incomeTaxBaseCents: 18_000_000 }],
      }),
    )
    // 180.000 → 222.500: 10.000 × %15 + 32.500 × %20 = 8.000 ₺.
    assert.equal(carried.rows[0]?.incomeTaxCents, 800_000)
  })

  test('DOM-FIN-115: kaydı olmayan önceki ay uyarısı', () => {
    const march = payrollCalculation(
      input('2026-03', {
        savedBases: [{ membershipId: 'm-1', month: '2026-01', incomeTaxBaseCents: 12_750_000 }],
      }),
    )
    assert.ok(march.rows[0]?.warnings.includes('previous_month_not_saved'))
    assert.deepEqual(unsavedPreviousMonths('2026-03', rates, new Set(['2026-01'])), ['2026-02'])
    assert.deepEqual(unsavedPreviousMonths('2026-01', rates, new Set()), [])
  })

  test('DOM-FIN-115: kapsam ve toplamlar; eksik satır toplama girmez', () => {
    const list = payrollCalculation(
      input('2026-01', {
        rates: [
          wage(3_303_000),
          { ...wage(50_000, '2026-01-01', 'hourly'), membershipId: 'm-2', id: 'h' },
        ],
      }),
    )
    assert.deepEqual(
      list.rows.map((item) => [item.name, item.complete]),
      [
        ['Ayşe Yılmaz', false],
        ['Selin Kaya', true],
      ],
    )
    assert.ok(list.rows[0]?.warnings.includes('staff_inactive'))
    assert.equal(list.totals.staffCount, 2)
    assert.equal(list.totals.completeCount, 1)
    assert.equal(list.totals.incompleteCount, 1)
    assert.equal(list.totals.grossCents, 3_303_000)
    assert.equal(list.totals.payableCents, 2_807_550)
    assert.equal(list.parameters.setId, 'platform-2026-01-01')
    assert.equal(list.parameters.unverified, true)
  })

  test('DOM-FIN-115: ücret tanımı olmayan personel yalnız ek ders ya da düzeltmeyle girer', () => {
    const list = payrollCalculation(
      input('2026-01', {
        rates: [],
        adjustments: [{ membershipId: 'm-2', item: 'wage', amountCents: 100_000 }],
      }),
    )
    assert.equal(list.rows.length, 1)
    assert.equal(list.rows[0]?.complete, false)
    assert.ok(list.rows[0]?.warnings.includes('no_wage'))
  })

  test('DOM-FIN-115: CSV toplam ve ilke notu taşır, formül kaçışlı', () => {
    const list = payrollCalculation(
      input('2026-01', {
        members: [{ ...member, name: '=HYPERLINK("x")' }],
        rates: [wage(3_303_000)],
      }),
    )
    const csv = payrollCalculationCsv(list)
    const lines = csv.split('\r\n')
    assert.equal(lines.length, 4)
    assert.ok(lines[0]?.startsWith('"Ad soyad";"Hesaplandı";"Prim günü";"Brüt"'))
    assert.ok(lines[1]?.startsWith(`"'=HYPERLINK`))
    assert.ok(lines[1]?.includes('28075,50'))
    assert.ok(lines[2]?.startsWith('"Toplam'))
    assert.ok(lines[3]?.includes(PAYROLL_CALC_NOTE.slice(0, 20)))
    assert.equal(payrollCalculationFilename('2026-01', false), 'bordro-hesabi-2026-01.csv')
    assert.equal(payrollCalculationFilename('2026-01', true), 'bordro-hesabi-2026-01-kayitli.csv')
  })
})

describe('DOM-FIN-115: kurallar ve şemalar', () => {
  test('DOM-FIN-115: kaydetme yarışı ve boş ay (K-391)', () => {
    const id = '7b8c1f7e-8a59-4c2a-9f0e-0b8d1c3b7e11'
    assert.doesNotThrow(() => planPayrollRunSave({ previousRunId: null }, null, 1))
    assert.doesNotThrow(() => planPayrollRunSave({ previousRunId: id }, { id }, 1))
    for (const [input, current] of [
      [{ previousRunId: null }, { id }],
      [{ previousRunId: id }, null],
    ] as const)
      assert.throws(
        () => planPayrollRunSave(input, current, 1),
        (error: unknown) =>
          error instanceof DomainError &&
          error.code === 'payroll_run_changed' &&
          error.kind === 'conflict',
      )
    assert.throws(
      () => planPayrollRunSave({ previousRunId: null }, null, 0),
      (error: unknown) => error instanceof DomainError && error.code === 'payroll_run_empty',
    )
    assert.equal(payrollRunSaveSchema.safeParse({ previousRunId: 'x' }).success, false)
    assert.equal(payrollRunSaveSchema.safeParse({}).success, false)
  })

  test('DOM-FIN-115: matrah devri kuralları ve şeması (K-388)', () => {
    const codeOf = (fn: () => void) => {
      try {
        fn()
      } catch (error) {
        return error instanceof DomainError ? error.code : 'other'
      }
      return null
    }
    assert.equal(
      codeOf(() => planPayrollTaxCarryover({ staff: null, exists: false })),
      'payroll_carryover_staff_not_found',
    )
    assert.equal(
      codeOf(() => planPayrollTaxCarryover({ staff: { role: 'veli' }, exists: false })),
      'payroll_carryover_not_staff',
    )
    assert.equal(
      codeOf(() => planPayrollTaxCarryover({ staff: { role: 'ogretmen' }, exists: true })),
      'payroll_carryover_exists',
    )
    assert.equal(
      codeOf(() => planPayrollTaxCarryover({ staff: { role: 'onburo' }, exists: false })),
      null,
    )
    const parsed = payrollTaxCarryoverInputSchema.parse({
      membershipId: ' m-1 ',
      year: 2026,
      incomeTaxBaseCents: 18_000_000,
      note: '  ',
    })
    assert.deepEqual(parsed, {
      membershipId: 'm-1',
      year: 2026,
      incomeTaxBaseCents: 18_000_000,
      note: null,
    })
    for (const bad of [
      { membershipId: 'm', year: 2019, incomeTaxBaseCents: 1 },
      { membershipId: 'm', year: 2026, incomeTaxBaseCents: 0 },
      { membershipId: 'm', year: 2026, incomeTaxBaseCents: 1.5 },
      { membershipId: 'm', year: 2026, incomeTaxBaseCents: 1, institutionId: 'x' },
      { membershipId: 'm', year: 2026, incomeTaxBaseCents: 1, note: 'x'.repeat(201) },
    ])
      assert.equal(payrollTaxCarryoverInputSchema.safeParse(bad).success, false)
  })
})
