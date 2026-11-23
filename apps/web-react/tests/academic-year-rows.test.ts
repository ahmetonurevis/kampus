import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import type { AcademicYear } from '@kampus/react-shared/academic-years.ts'
import {
  activationDescription,
  activationPlan,
  closeBlockedReason,
  closeDescription,
  createDefaults,
  dayHint,
  dayLabel,
  parsePanelTarget,
  rangeLabel,
  termDefaults,
  termEditPanelValue,
  termNewPanelValue,
  termRow,
  termSchema,
  todayKey,
  updateDefaults,
  yearCreateSchema,
  yearPanelValue,
  yearRow,
  yearUpdateSchema,
  type YearRow,
} from '../src/pages/settings/academic-year-rows.ts'

// IST-011 (DOM-YTK-063…066): eğitim yılı ayar ekranının saf mantığı.

const TERM_A = '11111111-1111-4111-8111-111111111111'
const TERM_B = '22222222-2222-4222-8222-222222222222'

function year(overrides: Partial<AcademicYear> = {}): AcademicYear {
  return {
    startYear: 2026,
    name: '2026–2027',
    startDate: '2026-09-01',
    endDate: '2027-08-31',
    isActive: false,
    status: 'planned',
    activatedAt: null,
    closedAt: null,
    rowVersion: 3,
    updatedAt: '2026-11-02T08:00:00.000Z',
    terms: [
      { id: TERM_A, name: '1. Dönem', sequence: 1, startDate: '2026-09-14', endDate: '2027-01-22' },
      { id: TERM_B, name: '2. Dönem', sequence: 2, startDate: '2027-02-08', endDate: '2027-06-18' },
    ],
    ...overrides,
  }
}

const planned = (startYear: number, terms: AcademicYear['terms'] = year().terms): YearRow =>
  yearRow(
    year({
      startYear,
      name: `${startYear}–${startYear + 1}`,
      startDate: `${startYear}-09-01`,
      endDate: `${startYear + 1}-08-31`,
      terms,
    }),
  )
const active = (startYear: number): YearRow =>
  yearRow(
    year({
      startYear,
      name: `${startYear}–${startYear + 1}`,
      startDate: `${startYear}-09-01`,
      endDate: `${startYear + 1}-08-31`,
      status: 'active',
      isActive: true,
    }),
  )

describe('gün gösterimi (Europe/Istanbul)', () => {
  test('gün öğlen UTC ile biçimlenir, saat dilimi günü kaydırmaz', () => {
    assert.equal(dayLabel('2027-09-01'), '1 Eyl 2027')
    assert.equal(dayLabel('2027-01-01'), '1 Oca 2027')
    assert.equal(dayLabel('2027-12-31'), '31 Ara 2027')
    assert.equal(dayLabel(''), '—')
    assert.equal(rangeLabel('2026-09-01', '2027-08-31'), '1 Eyl 2026 – 31 Ağu 2027')
  })

  test('tarih alanı ipucu uzun gün adı verir, geçersiz değerde yoktur', () => {
    assert.equal(dayHint('2027-09-01'), '1 Eylül 2027 Çarşamba')
    assert.equal(dayHint(''), undefined)
    assert.equal(dayHint(undefined), undefined)
    assert.equal(dayHint('2027-9-1'), undefined)
  })

  test('bugün İstanbul gününe göre hesaplanır (UTC gece yarısından sonra ertesi gün)', () => {
    assert.equal(todayKey(new Date('2026-12-31T21:30:00.000Z')), '2027-01-01')
    assert.equal(todayKey(new Date('2026-12-31T20:30:00.000Z')), '2026-12-31')
  })
})

describe('yıl satırı', () => {
  test('planlı yıl düzenlenir ve etkinleştirilir, kapatılmaz', () => {
    const row = yearRow(year())
    assert.equal(row.statusLabel, 'Planlandı')
    assert.equal(row.tone, 'amber')
    assert.deepEqual(
      [row.canEdit, row.canActivate, row.canClose, row.isActive],
      [true, true, false, false],
    )
    assert.equal(row.version, 3)
    assert.equal(row.rangeLabel, '1 Eyl 2026 – 31 Ağu 2027')
  })

  test('etkin yıl düzenlenir ve kapatılır, yeniden etkinleştirilmez', () => {
    const row = active(2026)
    assert.equal(row.statusLabel, 'Etkin')
    assert.equal(row.tone, 'green')
    assert.deepEqual(
      [row.canEdit, row.canActivate, row.canClose, row.isActive],
      [true, false, true, true],
    )
  })

  test('kapanmış yıl salt okunurdur (409 academic_year_closed)', () => {
    const row = yearRow(year({ status: 'closed', closedAt: '2027-09-01T00:00:00.000Z' }))
    assert.equal(row.statusLabel, 'Kapandı')
    assert.deepEqual([row.canEdit, row.canActivate, row.canClose], [false, false, false])
  })

  test('dönemler sunucu sırasıyla ve kimlikli gelir; kimliksiz dönem (öğrenci yanıtı) alınmaz', () => {
    const row = yearRow(
      year({
        terms: [
          { name: 'Gizli', sequence: 1, startDate: '2026-09-14', endDate: '2027-01-22' },
          ...year().terms,
        ],
      }),
    )
    assert.deepEqual(
      row.terms.map((term) => [term.sequence, term.name, term.rangeLabel]),
      [
        [1, '1. Dönem', '14 Eyl 2026 – 22 Oca 2027'],
        [2, '2. Dönem', '8 Şub 2027 – 18 Haz 2027'],
      ],
    )
    assert.equal(
      termRow({ name: 'x', sequence: 1, startDate: '2026-09-01', endDate: '2026-09-02' }),
      null,
    )
  })

  test('sürümsüz yanıt (öğrenci) durumu etkinlikten çıkarır, sürüm null kalır', () => {
    const row = yearRow({ ...year(), status: undefined, rowVersion: undefined, isActive: true })
    assert.equal(row.status, 'active')
    assert.equal(row.version, null)
  })
})

describe('etkinleştirme onayı (DOM-YTK-065)', () => {
  const rows = [planned(2027), active(2026)]

  test('önceki etkin yıl adıyla kapanacak olarak bildirilir ve geri alınamaz uyarısı yazılır', () => {
    const plan = activationPlan(rows, 2027, 'school', '2027-08-01')
    assert.ok(plan)
    assert.equal(plan.closing?.name, '2026–2027')
    assert.equal(plan.tooEarly, false)
    const text = activationDescription(plan)
    assert.match(text, /2026–2027 eğitim yılı kapanacak/)
    assert.match(text, /geri alınamaz/)
  })

  test('başlangıçtan 60 günden önce erken sayılır, en erken gün hesaplanır', () => {
    const early = activationPlan(rows, 2027, 'school', '2026-11-02')
    assert.equal(early?.tooEarly, true)
    assert.equal(early?.earliestDay, '2027-07-03')
    assert.equal(activationPlan(rows, 2027, 'school', '2027-07-03')?.tooEarly, false)
    assert.equal(activationPlan(rows, 2027, 'school', '2027-07-02')?.tooEarly, true)
  })

  test('etkin yıl yoksa kapanacak yıl yoktur', () => {
    const plan = activationPlan([planned(2027)], 2027, 'school', '2027-08-01')
    assert.equal(plan?.closing, null)
    assert.match(activationDescription(plan!), /kurumun etkin yılı olur/)
  })

  test('okulda dönemsiz yıl etkinleştirilemez, dil okulunda dönem isteğe bağlıdır', () => {
    const bare = [planned(2027, [])]
    assert.equal(activationPlan(bare, 2027, 'school', '2027-08-01')?.needsTerms, true)
    assert.equal(activationPlan(bare, 2027, 'language_school', '2027-08-01')?.needsTerms, false)
  })

  test('listede olmayan yıl için plan yoktur', () => {
    assert.equal(activationPlan(rows, 2030, 'school', '2027-08-01'), null)
  })
})

describe('kapatma (DOM-YTK-066)', () => {
  test('son günden önce neden gösterilir, son günden itibaren engel yoktur', () => {
    const row = active(2026)
    assert.match(
      closeBlockedReason(row, '2027-03-01') ?? '',
      /31 Ağu 2027 gününden önce kapatılamaz/,
    )
    assert.equal(closeBlockedReason(row, '2027-08-31'), null)
    assert.equal(closeBlockedReason(row, '2027-09-05'), null)
  })

  test('onay metni geri alınamaz ve yeniden açılamaz der', () => {
    const text = closeDescription(active(2026))
    assert.match(text, /2026–2027 eğitim yılı kapanır/)
    assert.match(text, /yeniden açılamaz/)
    assert.match(text, /geri alınamaz/)
  })
})

describe('formlar', () => {
  test('yeni yıl varsayılanı son yılı izler ve 1 Eylül – 31 Ağustos gelir', () => {
    assert.deepEqual(createDefaults([active(2026)], '2026-11-02'), {
      startYear: 2027,
      startDate: '2027-09-01',
      endDate: '2028-08-31',
    })
    assert.equal(createDefaults([], '2026-11-02').startYear, 2026)
    assert.equal(createDefaults([planned(2028), active(2026)], '2026-11-02').startYear, 2029)
  })

  test('yıl oluşturma şeması core kurallarıyla Türkçe mesaj verir', () => {
    assert.equal(
      yearCreateSchema.safeParse({
        startYear: Number.NaN,
        startDate: '2027-09-01',
        endDate: '2028-08-31',
      }).error?.issues[0]?.message,
      'Başlangıç yılını yazın (ör. 2027).',
    )
    assert.equal(
      yearCreateSchema.safeParse({
        startYear: 1990,
        startDate: '2027-09-01',
        endDate: '2028-08-31',
      }).error?.issues[0]?.message,
      'Başlangıç yılı en az 2000 olmalı.',
    )
    assert.equal(
      yearCreateSchema.safeParse({ startYear: 2027, startDate: '', endDate: '2028-08-31' }).error
        ?.issues[0]?.message,
      'Başlangıç günü geçerli bir gün olmalı (YYYY-AA-GG).',
    )
    const ok = yearCreateSchema.parse({
      startYear: 2027,
      startDate: '2027-09-01',
      endDate: '2028-08-31',
    })
    assert.deepEqual(ok, { startYear: 2027, startDate: '2027-09-01', endDate: '2028-08-31' })
  })

  test('yıl oluşturma gövdesinde dönem yoktur (katı şema)', () => {
    const parsed = yearCreateSchema.safeParse({
      startYear: 2027,
      startDate: '2027-09-01',
      endDate: '2028-08-31',
      terms: [],
    })
    assert.equal(parsed.success, false)
  })

  test('yıl düzenleme varsayılanı yılın günleridir, şema günleri YYYY-AA-GG ister', () => {
    assert.deepEqual(updateDefaults(planned(2027)), {
      startDate: '2027-09-01',
      endDate: '2028-08-31',
    })
    assert.equal(
      yearUpdateSchema.safeParse({ startDate: '', endDate: '2028-08-31' }).success,
      false,
    )
  })

  test('dönem şeması ad ve günleri doğrular; varsayılan yılın aralığıdır', () => {
    const row = planned(2027)
    assert.deepEqual(termDefaults(row), {
      name: '',
      startDate: '2027-09-01',
      endDate: '2028-08-31',
    })
    assert.deepEqual(termDefaults(row, row.terms[0]), {
      name: '1. Dönem',
      startDate: '2026-09-14',
      endDate: '2027-01-22',
    })
    assert.equal(
      termSchema.safeParse({ name: ' ', startDate: '2027-09-14', endDate: '2028-01-22' }).error
        ?.issues[0]?.message,
      'Dönem adını yazın.',
    )
    assert.equal(
      termSchema.safeParse({ name: 'Güz', startDate: '2027-09-14', endDate: '2028-01-22' }).success,
      true,
    )
  })
})

describe('sağ panel adresi', () => {
  test('değerler panel hedefine çözülür', () => {
    assert.deepEqual(parsePanelTarget('yeni'), { kind: 'year-new' })
    assert.deepEqual(parsePanelTarget(yearPanelValue(2027)), { kind: 'year-edit', startYear: 2027 })
    assert.deepEqual(parsePanelTarget(termNewPanelValue(2027)), {
      kind: 'term-new',
      startYear: 2027,
    })
    assert.deepEqual(parsePanelTarget(termEditPanelValue(2027, TERM_A)), {
      kind: 'term-edit',
      startYear: 2027,
      termId: TERM_A,
    })
  })

  test('tanınmayan değer paneli açmaz', () => {
    for (const value of ['', 'x', '27', '2027:yil', '2027:donem:', '2027:donem:a:b', '20271'])
      assert.equal(parsePanelTarget(value), null, value)
  })
})

describe('sekme kaydı', () => {
  const sections = readFileSync(
    new URL('../src/pages/settings/settings-sections.tsx', import.meta.url),
    'utf8',
  )
  const entry = sections.slice(
    sections.indexOf("id: 'academic-year'"),
    sections.indexOf("id: 'activity'"),
  )

  test('Eğitim yılı sekmesi yalnız yöneticide, modüle bağlı değil (platform yeteneği)', () => {
    assert.match(entry, /label: 'Eğitim yılı'/)
    assert.match(entry, /param: 'egitim-yili'/)
    assert.match(entry, /roles: \['yonetici'\]/)
    assert.doesNotMatch(entry, /module:/)
  })

  test('sekme Onur bloğunun dışındadır', () => {
    const onur = sections.slice(
      sections.indexOf('// Onur: kayıt ve finans\n'),
      sections.indexOf('// Onur: kayıt ve finans sonu'),
    )
    assert.doesNotMatch(onur, /AcademicYear/)
  })
})
