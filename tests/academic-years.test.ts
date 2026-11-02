import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  academicYearName,
  academicYearView,
  activeAcademicYear,
  addOneYear,
  currentAcademicPeriod,
  defaultAcademicYearDates,
  isWithinPeriod,
  locateDay,
  orderedTerms,
  periodRange,
  planAcademicYearActivation,
  planAcademicYearClosure,
  planAcademicYearCreation,
  planAcademicYearUpdate,
  planTermCreation,
  planTermRemoval,
  planTermUpdate,
  termSequence,
  type AcademicYear,
} from '../packages/school-core/src/lib/academic-years.ts'
import { authorize, type AuthorizationSource } from '../packages/school-core/src/lib/authorize.ts'
import { OPERATION_COMMANDS } from '../packages/school-core/src/modules/commands.ts'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'
import {
  createAcademicYears,
  seedTermId,
} from '../packages/school-core/src/platform/seed-academic.ts'
import { isDomainError } from './support/domain-error.ts'

const ZodError = { name: 'ZodError' }
const NOW = '2026-10-06T09:00:00.000Z'

const year = (overrides: Partial<AcademicYear> = {}): AcademicYear => ({
  startYear: 2026,
  startDate: '2026-09-01',
  endDate: '2027-08-31',
  status: 'active',
  activatedAt: '2026-08-31T21:00:00.000Z',
  closedAt: null,
  terms: [
    { id: 'test-t2', name: '2. dönem', startDate: '2027-02-02', endDate: '2027-06-26' },
    { id: 'test-t1', name: '1. dönem', startDate: '2026-09-08', endDate: '2027-01-16' },
  ],
  ...overrides,
})
const planned2027 = (overrides: Partial<AcademicYear> = {}) =>
  year({
    startYear: 2027,
    startDate: '2027-09-01',
    endDate: '2028-08-31',
    status: 'planned',
    activatedAt: null,
    terms: [{ id: 'test-t3', name: 'Güz', startDate: '2027-09-10', endDate: '2028-01-20' }],
    ...overrides,
  })

/** İşlem girdisi değiştirmez: hata sonrası yıllar aynı kalır. */
function unchangedOnFailure(
  years: AcademicYear[],
  run: () => unknown,
  code: string,
  kind = 'rule',
) {
  const before = structuredClone(years)
  assert.throws(run, isDomainError(code, kind))
  assert.deepEqual(years, before)
}

let ids = 0
const makeTermId = () => `test-new-${(ids += 1)}`

describe('eğitim yılı tanımı (DOM-YTK-063)', () => {
  test('DOM-YTK-063 yıl başlangıç yılıyla tanımlanır; varsayılan 1 Eylül – 31 Ağustos, planlı açılır', () => {
    assert.equal(academicYearName(2026), '2026–2027')
    assert.deepEqual(defaultAcademicYearDates(2026), {
      startDate: '2026-09-01',
      endDate: '2027-08-31',
    })
    const created = planAcademicYearCreation({
      years: [year()],
      input: { startYear: 2027 },
      makeTermId,
    })
    assert.deepEqual(created, {
      startYear: 2027,
      startDate: '2027-09-01',
      endDate: '2028-08-31',
      status: 'planned',
      activatedAt: null,
      closedAt: null,
      terms: [],
    })
  })

  test('DOM-YTK-063 kurum aralığı değiştirir; ilk dönemler aynı işlemde eklenir', () => {
    const created = planAcademicYearCreation({
      years: [],
      input: {
        startYear: 2027,
        startDate: '2027-09-15',
        endDate: '2028-06-30',
        terms: [{ name: ' Güz ', startDate: '2027-09-15', endDate: '2028-01-20' }],
      },
      makeTermId: () => 'test-fixed',
    })
    assert.equal(created.startDate, '2027-09-15')
    assert.deepEqual(created.terms, [
      { id: 'test-fixed', name: 'Güz', startDate: '2027-09-15', endDate: '2028-01-20' },
    ])
  })

  test('DOM-YTK-063 aynı başlangıç yılı ikinci kez açılmaz, yıllar örtüşmez; girdi değişmez', () => {
    const years = [year()]
    unchangedOnFailure(
      years,
      () => planAcademicYearCreation({ years, input: { startYear: 2026 }, makeTermId }),
      'academic_year_exists',
      'conflict',
    )
    unchangedOnFailure(
      years,
      () =>
        planAcademicYearCreation({
          years,
          input: { startYear: 2027, startDate: '2027-08-15', endDate: '2028-08-14' },
          makeTermId,
        }),
      'academic_year_overlap',
    )
  })

  test('DOM-YTK-063 başlangıç yılında başlar, bitiş sonra gelir ve bir yılı geçmez', () => {
    const create = (input: Record<string, unknown>) => () =>
      planAcademicYearCreation({ years: [], input: { startYear: 2027, ...input }, makeTermId })
    assert.throws(
      create({ startDate: '2028-01-05' }),
      isDomainError('academic_year_start_mismatch'),
    )
    assert.throws(
      create({ startDate: '2027-09-01', endDate: '2027-09-01' }),
      isDomainError('academic_year_dates_invalid'),
    )
    assert.throws(
      create({ startDate: '2027-09-01', endDate: '2028-09-01' }),
      isDomainError('academic_year_too_long'),
    )
    assert.throws(create({ startDate: '2027-02-30' }), ZodError)
    assert.throws(create({ startYear: 1999 }), ZodError)
    assert.throws(create({ institutionId: 'baska' }), ZodError)
  })

  test('DOM-YTK-063 bir yıl sonrası ay sonunu aşmaz (veritabanı denetimiyle aynı)', () => {
    assert.equal(addOneYear('2026-09-01'), '2027-09-01')
    assert.equal(addOneYear('2028-02-29'), '2029-02-28')
    assert.equal(addOneYear('2027-02-28'), '2028-02-28')
  })

  test('DOM-YTK-063 tarih değişikliği dönemleri yılın içinde tutar; kapanmış yıl değişmez', () => {
    const years = [year()]
    assert.equal(
      planAcademicYearUpdate({ years, startYear: 2026, input: { endDate: '2027-07-31' } }).endDate,
      '2027-07-31',
    )
    unchangedOnFailure(
      years,
      () => planAcademicYearUpdate({ years, startYear: 2026, input: { endDate: '2027-05-31' } }),
      'academic_term_outside_year',
    )
    assert.throws(
      () => planAcademicYearUpdate({ years, startYear: 2026, input: {} }),
      ZodError,
      'boş değişiklik',
    )
    assert.throws(
      () => planAcademicYearUpdate({ years, startYear: 2030, input: { endDate: '2031-07-01' } }),
      isDomainError('academic_year_not_found', 'not_found'),
    )
    const closed = [year({ status: 'closed', closedAt: NOW })]
    unchangedOnFailure(
      closed,
      () =>
        planAcademicYearUpdate({
          years: closed,
          startYear: 2026,
          input: { endDate: '2027-07-31' },
        }),
      'academic_year_closed',
      'conflict',
    )
  })
})

describe('dönemler (DOM-YTK-064)', () => {
  test('DOM-YTK-064 sıra başlangıç gününden hesaplanır', () => {
    const subject = year()
    assert.deepEqual(
      orderedTerms(subject.terms).map((term) => term.id),
      ['test-t1', 'test-t2'],
    )
    assert.equal(termSequence(subject, 'test-t2'), 2)
    assert.equal(termSequence(subject, 'yok'), null)
  })

  test('DOM-YTK-064 dönem eklenir; örtüşen, yıl dışı, ters tarihli ve aynı adlı dönem reddedilir', () => {
    const years = [year()]
    const added = planTermCreation({
      years,
      startYear: 2026,
      termId: 'test-yaz',
      input: { name: 'Yaz okulu', startDate: '2027-07-01', endDate: '2027-07-31' },
    })
    assert.equal(added.term.id, 'test-yaz')
    assert.equal(termSequence(added.year, 'test-yaz'), 3)
    const add = (input: Record<string, unknown>) => () =>
      planTermCreation({ years, startYear: 2026, termId: 'test-x', input })
    unchangedOnFailure(
      years,
      add({ name: 'Ara', startDate: '2027-01-10', endDate: '2027-02-10' }),
      'academic_term_overlap',
    )
    unchangedOnFailure(
      years,
      add({ name: 'Taşan', startDate: '2027-08-01', endDate: '2027-09-10' }),
      'academic_term_outside_year',
    )
    unchangedOnFailure(
      years,
      add({ name: 'Ters', startDate: '2027-07-10', endDate: '2027-07-01' }),
      'academic_term_dates_invalid',
    )
    unchangedOnFailure(
      years,
      add({ name: '1. DÖNEM', startDate: '2027-07-01', endDate: '2027-07-31' }),
      'academic_term_name_exists',
      'conflict',
    )
    assert.throws(add({ name: '', startDate: '2027-07-01', endDate: '2027-07-31' }), ZodError)
  })

  test('DOM-YTK-064 bir yılda en çok 12 dönem', () => {
    const terms = Array.from({ length: 12 }, (_, index) => ({
      id: `test-m${index}`,
      name: `Modül ${index + 1}`,
      startDate: `2026-09-${String(index + 1).padStart(2, '0')}`,
      endDate: `2026-09-${String(index + 1).padStart(2, '0')}`,
    }))
    const years = [year({ terms })]
    unchangedOnFailure(
      years,
      () =>
        planTermCreation({
          years,
          startYear: 2026,
          termId: 'test-13',
          input: { name: 'Modül 13', startDate: '2026-10-01', endDate: '2026-10-02' },
        }),
      'academic_term_limit',
    )
  })

  test('DOM-YTK-064 dönem güncellenir ve kaldırılır; kapanmış yılda değişmez', () => {
    const years = [year()]
    const updated = planTermUpdate({
      years,
      startYear: 2026,
      termId: 'test-t2',
      input: { name: 'Bahar', endDate: '2027-06-19' },
    })
    assert.deepEqual(updated.term, {
      id: 'test-t2',
      name: 'Bahar',
      startDate: '2027-02-02',
      endDate: '2027-06-19',
    })
    unchangedOnFailure(
      years,
      () =>
        planTermUpdate({
          years,
          startYear: 2026,
          termId: 'test-t2',
          input: { startDate: '2027-01-10' },
        }),
      'academic_term_overlap',
    )
    assert.throws(
      () => planTermUpdate({ years, startYear: 2026, termId: 'yok', input: { name: 'X' } }),
      isDomainError('academic_term_not_found', 'not_found'),
    )
    const removed = planTermRemoval({
      years,
      startYear: 2026,
      termId: 'test-t1',
      institutionType: 'school',
    })
    assert.deepEqual(
      removed.year.terms.map((term) => term.id),
      ['test-t2'],
    )
    const closed = [year({ status: 'closed', closedAt: NOW })]
    for (const run of [
      () =>
        planTermCreation({
          years: closed,
          startYear: 2026,
          termId: 'x',
          input: { name: 'Yaz', startDate: '2027-07-01', endDate: '2027-07-02' },
        }),
      () =>
        planTermUpdate({ years: closed, startYear: 2026, termId: 'test-t1', input: { name: 'X' } }),
      () =>
        planTermRemoval({
          years: closed,
          startYear: 2026,
          termId: 'test-t1',
          institutionType: 'school',
        }),
    ])
      unchangedOnFailure(closed, run, 'academic_year_closed', 'conflict')
  })

  test('DOM-YTK-065 etkin okul yılının son dönemi kaldırılamaz; dil okulunda kaldırılır', () => {
    const single = [year({ terms: [year().terms[1]!] })]
    unchangedOnFailure(
      single,
      () =>
        planTermRemoval({
          years: single,
          startYear: 2026,
          termId: 'test-t1',
          institutionType: 'school',
        }),
      'academic_terms_required',
    )
    assert.deepEqual(
      planTermRemoval({
        years: single,
        startYear: 2026,
        termId: 'test-t1',
        institutionType: 'language_school',
      }).year.terms,
      [],
    )
    const planned = [planned2027()]
    assert.deepEqual(
      planTermRemoval({
        years: planned,
        startYear: 2027,
        termId: 'test-t3',
        institutionType: 'school',
      }).year.terms,
      [],
    )
  })
})

describe('etkin yıl ve yıl geçişi (DOM-YTK-065, DOM-YTK-066)', () => {
  test('DOM-YTK-065 etkinleştirme önceki etkin yılı aynı işlemde kapatır; tek etkin yıl kalır', () => {
    const years = [year(), planned2027()]
    const now = '2027-08-20T09:00:00.000Z'
    const result = planAcademicYearActivation({
      years,
      startYear: 2027,
      institutionType: 'school',
      now,
    })
    assert.equal(result.activated.status, 'active')
    assert.equal(result.activated.activatedAt, now)
    assert.equal(result.closed?.startYear, 2026)
    assert.equal(result.closed?.status, 'closed')
    assert.equal(result.closed?.closedAt, now)
    const after = [result.closed!, result.activated]
    assert.equal(after.filter((item) => item.status === 'active').length, 1)
    assert.equal(activeAcademicYear(after)?.startYear, 2027)
    assert.equal(activeAcademicYear([planned2027()]), null)
  })

  test('DOM-YTK-065 ilk etkinleştirmede kapanan yıl yok; dil okulunda dönemsiz yıl etkinleşir', () => {
    const years = [planned2027({ terms: [] })]
    assert.throws(
      () =>
        planAcademicYearActivation({
          years,
          startYear: 2027,
          institutionType: 'school',
          now: NOW,
        }),
      isDomainError('academic_terms_required'),
    )
    const result = planAcademicYearActivation({
      years,
      startYear: 2027,
      institutionType: 'language_school',
      now: NOW,
    })
    assert.equal(result.closed, null)
    assert.equal(result.activated.status, 'active')
  })

  test('DOM-YTK-065 etkin, kapanmış, bitmiş ya da eski yıl etkinleştirilmez; girdi değişmez', () => {
    const activate =
      (years: AcademicYear[], startYear: number, now = NOW) =>
      () =>
        planAcademicYearActivation({ years, startYear, institutionType: 'school', now })
    const years = [year(), planned2027()]
    unchangedOnFailure(years, activate(years, 2026), 'academic_year_already_active', 'conflict')
    const closed = [year({ status: 'closed', closedAt: NOW })]
    unchangedOnFailure(closed, activate(closed, 2026), 'academic_year_closed', 'conflict')
    const ended = [planned2027()]
    unchangedOnFailure(
      ended,
      activate(ended, 2027, '2028-09-01T09:00:00.000Z'),
      'academic_year_ended',
    )
    const order = [
      year({ status: 'planned', activatedAt: null }),
      planned2027({ status: 'active' }),
    ]
    unchangedOnFailure(order, activate(order, 2026), 'academic_year_activation_order')
    assert.throws(activate(years, 2031), isDomainError('academic_year_not_found', 'not_found'))
  })

  test('DOM-YTK-066 yalnız etkin yıl ve son gününde ya da sonra kapanır', () => {
    const years = [year(), planned2027()]
    const closed = planAcademicYearClosure({
      years,
      startYear: 2026,
      now: '2027-08-31T10:00:00.000Z',
    })
    assert.equal(closed.status, 'closed')
    assert.equal(closed.closedAt, '2027-08-31T10:00:00.000Z')
    unchangedOnFailure(
      years,
      () => planAcademicYearClosure({ years, startYear: 2026, now: NOW }),
      'academic_year_not_ended',
    )
    unchangedOnFailure(
      years,
      () => planAcademicYearClosure({ years, startYear: 2027, now: '2028-09-01T10:00:00.000Z' }),
      'academic_year_not_active',
    )
    const done = [year({ status: 'closed', closedAt: NOW })]
    unchangedOnFailure(
      done,
      () => planAcademicYearClosure({ years: done, startYear: 2026, now: '2027-09-01T10:00:00Z' }),
      'academic_year_closed',
      'conflict',
    )
  })
})

describe('gün, dönem ve rapor aralığı (DOM-YTK-067)', () => {
  const years = [year(), planned2027()]

  test('DOM-YTK-067 gün yılına ve dönemine düşer; tatil ve yıl dışı boş döner', () => {
    assert.equal(locateDay(years, '2026-10-06').term?.id, 'test-t1')
    assert.equal(locateDay(years, '2027-03-01').term?.id, 'test-t2')
    const holiday = locateDay(years, '2027-01-25')
    assert.equal(holiday.year?.startYear, 2026)
    assert.equal(holiday.term, null)
    assert.deepEqual(locateDay(years, '2020-01-01'), { year: null, term: null })
  })

  test('DOM-YTK-067 bugün Europe/Istanbul gününe göre; etkin yıl önce gelir', () => {
    // 2026-09-07 21:30 UTC İstanbul'da 8 Eylül'dür: birinci dönemin ilk günü.
    const current = currentAcademicPeriod(years, '2026-09-07T21:30:00.000Z')
    assert.equal(current.date, '2026-09-08')
    assert.equal(current.year?.startYear, 2026)
    assert.equal(current.term?.id, 'test-t1')
    // Etkin yıl bitti, yeni yıl henüz etkin değil: günü içeren planlı yıl.
    const next = currentAcademicPeriod(years, '2027-09-12T09:00:00.000Z')
    assert.equal(next.year?.startYear, 2027)
    assert.equal(next.term?.id, 'test-t3')
    // Hiçbir yıl günü içermiyor: etkin yıl, dönemsiz.
    const outside = currentAcademicPeriod([year()], '2030-01-01T09:00:00.000Z')
    assert.equal(outside.year?.startYear, 2026)
    assert.equal(outside.term, null)
    assert.deepEqual(currentAcademicPeriod([], NOW), { date: '2026-10-06', year: null, term: null })
  })

  test('IST-011 raporlar dönem ya da yıl aralığıyla süzülür', () => {
    const term = periodRange({ years, startYear: 2026, termId: 'test-t2' })
    assert.deepEqual(term, { startDate: '2027-02-02', endDate: '2027-06-26' })
    assert.deepEqual(periodRange({ years, startYear: 2026 }), {
      startDate: '2026-09-01',
      endDate: '2027-08-31',
    })
    assert.equal(isWithinPeriod(term, '2027-02-02'), true)
    assert.equal(isWithinPeriod(term, '2027-06-26T20:59:00.000Z'), true)
    assert.equal(isWithinPeriod(term, '2027-06-26T21:00:00.000Z'), false, 'İstanbul 27 Haziran')
    assert.throws(
      () => periodRange({ years, startYear: 2026, termId: 'yok' }),
      isDomainError('academic_term_not_found', 'not_found'),
    )
  })

  test('DOM-YTK-067 öğrenci ve veli yalnız ad, tarih ve etkinlik bilgisini görür', () => {
    const roles: Role[] = ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli']
    for (const role of roles) {
      const view = academicYearView(year(), role)
      assert.equal(view.name, '2026–2027')
      assert.equal(view.isActive, true)
      assert.deepEqual(
        view.terms.map((term) => [term.sequence, term.name]),
        [
          [1, '1. dönem'],
          [2, '2. dönem'],
        ],
      )
      const family = role === 'ogrenci' || role === 'veli'
      assert.equal('status' in view, !family, role)
      assert.equal('activatedAt' in view, !family, role)
      assert.equal('id' in view.terms[0]!, !family, role)
    }
  })
})

describe('yetki ve örnek veri (DOM-YTK-067, IST-011)', () => {
  const source: AuthorizationSource = {
    modules: {},
    students: [],
    classes: [],
    teachers: [],
    assignments: [],
    clubs: [],
    mockExams: [],
  }

  test('DOM-YTK-067 beş rol okur, yalnız yönetici yönetir; modül kapatılamaz', () => {
    assert.equal(OPERATION_COMMANDS['academicYear.read'].module, null)
    assert.equal(OPERATION_COMMANDS['academicYear.manage'].module, null)
    const roles: Role[] = ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli']
    for (const role of roles) {
      const actor = { role, links: [] }
      assert.equal(authorize(actor, 'academicYear.read', {}, source).allowed, true, role)
      assert.equal(
        authorize(actor, 'academicYear.manage', {}, source).allowed,
        role === 'yonetici',
        role,
      )
    }
  })

  test('IST-011 örnek okulun iki dönemli, dil okulunun dönemsiz etkin yılı deterministiktir', () => {
    const [school] = createAcademicYears(2026, 'school')
    assert.equal(school?.status, 'active')
    assert.deepEqual(
      school?.terms.map((term) => term.id),
      [seedTermId(2026, 1), seedTermId(2026, 2)],
    )
    assert.equal(seedTermId(2026, 1), '00000000-0000-4000-8000-000020260001')
    assert.deepEqual(createAcademicYears(2026, 'school'), createAcademicYears(2026, 'school'))
    const [language] = createAcademicYears(2026, 'language_school')
    assert.deepEqual(language?.terms, [])
    // Örnek yıl kendi kurallarından geçer: dönemler yılın içinde, örtüşmüyor.
    assert.doesNotThrow(() =>
      planAcademicYearUpdate({
        years: [school!],
        startYear: 2026,
        input: { startDate: school!.startDate },
      }),
    )
  })
})
