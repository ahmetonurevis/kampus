import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  ALL_DAY_SCHOOL_EVENT_KINDS,
  assertSchoolEventCancellable,
  assertSchoolEventPublishable,
  calendarRangeIssue,
  compareSchoolEvents,
  foldIcsLine,
  icsText,
  institutionHolidays,
  normalizeSchoolEvent,
  overlapsRange,
  planSchoolEventCreate,
  planSchoolEventUpdate,
  SCHOOL_EVENT_KIND_LABELS,
  SCHOOL_EVENT_KINDS,
  schoolCalendarIcs,
  schoolEventCancelSchema,
  schoolEventCreateSchema,
  schoolEventInstants,
  schoolEventIssues,
  schoolEventUpdateSchema,
  schoolEventVisibleTo,
  type SchoolEventFields,
} from '../packages/school-core/src/lib/finance-school-calendar.ts'

/**
 * Okul etkinlik takvimi kuralları (DOM-FIN-163; ON-090; IST-099; K-544…K-546). Bugün 2026-10-07.
 */

const TODAY = '2026-10-07'
const GROUP = '00000000-0000-4000-8000-000000000001'
const CHECKS = { classIds: new Set(['c1', 'c9']), groupIds: new Set([GROUP]) }

const base: SchoolEventFields = {
  title: 'Cumhuriyet Bayramı töreni',
  kind: 'ceremony',
  allDay: false,
  startDate: '2026-10-29',
  endDate: '2026-10-29',
  startTime: '09:30',
  endTime: '11:00',
  location: 'Okul bahçesi',
  description: null,
  audienceKind: 'institution',
  audienceIds: [],
}

function ruleCode(code: string) {
  return (error: unknown) => error instanceof DomainError && error.code === code
}

const issuesOf = (input: unknown) => {
  const result = schoolEventCreateSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
}

describe('DOM-FIN-163: etkinlik şeması ve normalleştirme (K-544)', () => {
  test('geçerli etkinlik; boş yer null, tüm günde saat düşer, tüm kurumda hedef boşalır', () => {
    const parsed = schoolEventCreateSchema.parse({
      ...base,
      allDay: true,
      kind: 'holiday',
      location: '  ',
      audienceIds: ['c1'],
    })
    const event = normalizeSchoolEvent(parsed)
    assert.equal(event.startTime, null)
    assert.equal(event.endTime, null)
    assert.equal(event.location, null)
    assert.deepEqual(event.audienceIds, [])
  })

  test('kademe sıralı ve tekil; sınıf alfabetik', () => {
    assert.deepEqual(
      normalizeSchoolEvent({ ...base, audienceKind: 'grade', audienceIds: ['10', '7', '10'] })
        .audienceIds,
      ['7', '10'],
    )
    assert.deepEqual(
      normalizeSchoolEvent({ ...base, audienceKind: 'class', audienceIds: ['c9', 'c1'] })
        .audienceIds,
      ['c1', 'c9'],
    )
  })

  test('bitiş başlangıçtan önce, 120 günü aşan, saatsiz ve ters saat 400', () => {
    assert.deepEqual(issuesOf({ ...base, endDate: '2026-10-28' }), ['endDate'])
    assert.deepEqual(issuesOf({ ...base, endDate: '2027-03-01' }), ['endDate'])
    assert.deepEqual(issuesOf({ ...base, startTime: null }), ['startTime'])
    assert.deepEqual(issuesOf({ ...base, endTime: undefined }), ['endTime'])
    assert.deepEqual(issuesOf({ ...base, endTime: '09:30' }), ['endTime'])
    assert.deepEqual(issuesOf({ ...base, startTime: '9:30' }), ['startTime'])
    // Çok günlükte bitiş saati başlangıçtan önce olabilir.
    assert.deepEqual(issuesOf({ ...base, endDate: '2026-10-30', endTime: '08:00' }), [])
  })

  test('tatil ve sınav haftası tüm gündür', () => {
    assert.deepEqual(ALL_DAY_SCHOOL_EVENT_KINDS, ['exam_week', 'holiday'])
    assert.deepEqual(issuesOf({ ...base, kind: 'holiday' }), ['allDay'])
    assert.deepEqual(issuesOf({ ...base, kind: 'exam_week', allDay: true }), [])
  })

  test('hedef: boş, geçersiz kademe ve grup reddedilir', () => {
    assert.deepEqual(issuesOf({ ...base, audienceKind: 'class', audienceIds: [] }), ['audienceIds'])
    assert.deepEqual(issuesOf({ ...base, audienceKind: 'grade', audienceIds: ['13'] }), [
      'audienceIds',
    ])
    assert.deepEqual(issuesOf({ ...base, audienceKind: 'grade', audienceIds: ['0'] }), [
      'audienceIds',
    ])
    assert.deepEqual(issuesOf({ ...base, audienceKind: 'group', audienceIds: ['g1'] }), [
      'audienceIds',
    ])
    assert.deepEqual(issuesOf({ ...base, audienceKind: 'grade', audienceIds: ['7', '12'] }), [])
    assert.deepEqual(issuesOf({ ...base, institutionId: 'x' }), [''])
  })

  test('bütün hâl kuralları: geçerli etkinlikte sorun yok, hatalar alan yoluyla', () => {
    assert.deepEqual(schoolEventIssues(base), [])
    assert.deepEqual(
      schoolEventIssues({ ...base, kind: 'exam_week', startTime: null }).map((issue) => issue.path),
      ['allDay', 'startTime'],
    )
  })

  test('türlerin Türkçe adı var', () => {
    for (const kind of SCHOOL_EVENT_KINDS) assert.ok(SCHOOL_EVENT_KIND_LABELS[kind].length > 0)
  })

  test('güncelleme şeması boş gövdeyi, iptal şeması kısa gerekçeyi reddeder', () => {
    assert.equal(schoolEventUpdateSchema.safeParse({}).success, false)
    assert.equal(schoolEventUpdateSchema.safeParse({ title: 'Yeni başlık' }).success, true)
    assert.equal(schoolEventCancelSchema.safeParse({ reason: 'kısa' }).success, false)
    assert.equal(
      schoolEventCancelSchema.safeParse({ reason: 'Hava muhalefeti nedeniyle' }).success,
      true,
    )
  })

  test('aralık: ters ve uzun aralık', () => {
    assert.equal(calendarRangeIssue('2026-10-01', '2026-10-31', 62), null)
    assert.match(calendarRangeIssue('2026-10-02', '2026-10-01', 62) ?? '', /önce/)
    assert.match(calendarRangeIssue('2026-10-01', '2026-12-31', 62) ?? '', /62/)
  })
})

describe('DOM-FIN-163: oluşturma, düzenleme, yayım ve iptal (K-544)', () => {
  test('oluşturma: sınıf ve grup kurumda olmalı', () => {
    const created = planSchoolEventCreate(
      schoolEventCreateSchema.parse({ ...base, audienceKind: 'class', audienceIds: ['c1'] }),
      CHECKS,
    )
    assert.deepEqual(created.audienceIds, ['c1'])
    assert.throws(
      () =>
        planSchoolEventCreate(
          schoolEventCreateSchema.parse({ ...base, audienceKind: 'class', audienceIds: ['c-yok'] }),
          CHECKS,
        ),
      ruleCode('school_event_audience_not_found'),
    )
    assert.throws(
      () =>
        planSchoolEventCreate(
          schoolEventCreateSchema.parse({
            ...base,
            audienceKind: 'group',
            audienceIds: ['00000000-0000-4000-8000-000000000009'],
          }),
          CHECKS,
        ),
      ruleCode('school_event_audience_not_found'),
    )
    const grade = planSchoolEventCreate(
      schoolEventCreateSchema.parse({ ...base, audienceKind: 'grade', audienceIds: ['7'] }),
      CHECKS,
    )
    assert.deepEqual(grade.audienceIds, ['7'])
  })

  test('düzenleme: birleşen sonuç doğrulanır, değişen alanlar döner', () => {
    const current = { ...base, status: 'published' as const }
    const plan = planSchoolEventUpdate(current, { title: 'Tören (güncel)', location: '' }, CHECKS)
    assert.deepEqual(plan.changed, ['title', 'location'])
    assert.equal(plan.values.location, null)
    // Tüm güne geçince saatler düşer.
    const allDay = planSchoolEventUpdate(current, { allDay: true }, CHECKS)
    assert.deepEqual(allDay.changed, ['allDay', 'startTime', 'endTime'])
    assert.throws(
      () => planSchoolEventUpdate(current, { kind: 'holiday' }, CHECKS),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === 'school_event_invalid' &&
        error.path?.[0] === 'allDay',
    )
    assert.throws(
      () => planSchoolEventUpdate(current, { title: base.title }, CHECKS),
      ruleCode('school_event_unchanged'),
    )
    assert.throws(
      () => planSchoolEventUpdate({ ...current, status: 'cancelled' }, { title: 'Yeni' }, CHECKS),
      ruleCode('school_event_cancelled'),
    )
  })

  test('düzenleme: yalnız hedef değişince hedef kurumda aranır', () => {
    const current = {
      ...base,
      status: 'draft' as const,
      audienceKind: 'class' as const,
      audienceIds: ['c-arsivli'],
    }
    // Hedef değişmedi: arşivlenmiş sınıf başlık düzeltmesini engellemez.
    assert.deepEqual(planSchoolEventUpdate(current, { title: 'Başka' }, CHECKS).changed, ['title'])
    assert.throws(
      () => planSchoolEventUpdate(current, { audienceIds: ['c-arsivli', 'c-yok'] }, CHECKS),
      ruleCode('school_event_audience_not_found'),
    )
    assert.deepEqual(
      planSchoolEventUpdate(current, { audienceIds: ['c9', 'c1'] }, CHECKS).values.audienceIds,
      ['c1', 'c9'],
    )
  })

  test('yayım yalnız taslakta; iptal bitmemiş ve iptal edilmemiş etkinlikte', () => {
    assert.doesNotThrow(() => assertSchoolEventPublishable('draft'))
    assert.throws(
      () => assertSchoolEventPublishable('published'),
      ruleCode('school_event_not_draft'),
    )
    assert.throws(
      () => assertSchoolEventPublishable('cancelled'),
      ruleCode('school_event_cancelled'),
    )
    assert.doesNotThrow(() =>
      assertSchoolEventCancellable({ status: 'draft', endDate: TODAY }, TODAY),
    )
    assert.throws(
      () => assertSchoolEventCancellable({ status: 'published', endDate: '2026-10-06' }, TODAY),
      ruleCode('school_event_ended'),
    )
    assert.throws(
      () => assertSchoolEventCancellable({ status: 'cancelled', endDate: '2026-12-01' }, TODAY),
      ruleCode('school_event_cancelled'),
    )
  })
})

describe('DOM-FIN-163: görünürlük ve tatil (K-544, K-545)', () => {
  const viewer = { grades: new Set([7]), classIds: new Set(['c1']), groupIds: new Set([GROUP]) }
  const event = (patch: Partial<Parameters<typeof schoolEventVisibleTo>[0]>) =>
    schoolEventVisibleTo(
      {
        status: 'published',
        publishedAt: '2026-10-01T09:00:00.000Z',
        audienceKind: 'institution',
        audienceIds: [],
        ...patch,
      },
      viewer,
    )

  test('taslak görünmez; yayımlandıktan sonra iptal edilen görünür, yayımsız iptal görünmez', () => {
    assert.equal(event({}), true)
    assert.equal(event({ status: 'draft', publishedAt: null }), false)
    assert.equal(event({ status: 'cancelled' }), true)
    assert.equal(event({ status: 'cancelled', publishedAt: null }), false)
  })

  test('veli/öğrenci: kendi kademesi, sınıfı ve grubu; başkası görünmez', () => {
    assert.equal(event({ audienceKind: 'grade', audienceIds: ['7', '8'] }), true)
    assert.equal(event({ audienceKind: 'grade', audienceIds: ['8'] }), false)
    assert.equal(event({ audienceKind: 'class', audienceIds: ['c1'] }), true)
    assert.equal(event({ audienceKind: 'class', audienceIds: ['c9'] }), false)
    assert.equal(event({ audienceKind: 'group', audienceIds: [GROUP] }), true)
    assert.equal(event({ audienceKind: 'group', audienceIds: ['başka'] }), false)
  })

  test('aralık kesişimi uçları kapsar', () => {
    const range = { startDate: '2026-10-29', endDate: '2026-10-31' }
    assert.equal(overlapsRange(range, '2026-10-31', '2026-11-05'), true)
    assert.equal(overlapsRange(range, '2026-10-01', '2026-10-29'), true)
    assert.equal(overlapsRange(range, '2026-11-01', '2026-11-05'), false)
  })

  test('kurum tatili: yayımlanmış, tüm kurum hedefli tatil (K-545)', () => {
    const holiday = {
      ...base,
      kind: 'holiday' as const,
      allDay: true,
      status: 'published' as const,
      title: 'Ara tatil',
      startDate: '2026-11-09',
      endDate: '2026-11-13',
    }
    const holidays = institutionHolidays([
      holiday,
      { ...holiday, title: 'Taslak tatil', status: 'draft' },
      { ...holiday, title: 'İptal tatil', status: 'cancelled' },
      { ...holiday, title: '7. sınıf tatili', audienceKind: 'grade', audienceIds: ['7'] },
      { ...holiday, title: 'Bayram', kind: 'ceremony' },
      { ...holiday, title: 'Cumhuriyet Bayramı', startDate: '2026-10-29', endDate: '2026-10-29' },
    ])
    assert.deepEqual(holidays, [
      { title: 'Cumhuriyet Bayramı', startDate: '2026-10-29', endDate: '2026-10-29' },
      { title: 'Ara tatil', startDate: '2026-11-09', endDate: '2026-11-13' },
    ])
  })

  test('sıra: gün, tüm gün önce, saat, başlık', () => {
    const list = [
      { ...base, title: 'B', startTime: '10:00' },
      { ...base, title: 'A', startTime: '10:00' },
      { ...base, title: 'Z', allDay: true, startTime: null },
      { ...base, title: 'C', startDate: '2026-10-28' },
    ].sort(compareSchoolEvents)
    assert.deepEqual(
      list.map((item) => item.title),
      ['C', 'Z', 'A', 'B'],
    )
  })

  test('anlar: tüm gün İstanbul gece yarısı, bitiş hariç; saatli İstanbul saati', () => {
    assert.deepEqual(
      schoolEventInstants({ ...base, allDay: true, startTime: null, endTime: null }),
      {
        startsAt: '2026-10-28T21:00:00.000Z',
        endsAt: '2026-10-29T21:00:00.000Z',
      },
    )
    assert.deepEqual(schoolEventInstants(base), {
      startsAt: '2026-10-29T06:30:00.000Z',
      endsAt: '2026-10-29T08:00:00.000Z',
    })
  })
})

describe('DOM-FIN-163: iCal dışa aktarımı (RFC 5545)', () => {
  const now = new Date('2026-10-07T09:00:00.000Z')

  test('kaçış ve katlama: çok baytlı karakter bölünmez', () => {
    assert.equal(icsText('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne')
    const folded = foldIcsLine(`SUMMARY:${'ğ'.repeat(60)}`)
    const lines = folded.split('\r\n')
    assert.ok(lines.length > 1)
    for (const line of lines) assert.ok(new TextEncoder().encode(line).length <= 75)
    assert.equal(
      lines.map((line, index) => (index === 0 ? line : line.slice(1))).join(''),
      `SUMMARY:${'ğ'.repeat(60)}`,
    )
  })

  test('tüm gün, saatli, uçsuz ve iptal edilmiş etkinlik', () => {
    const ics = schoolCalendarIcs({
      calendarName: 'Akademi; Okul Takvimi',
      now,
      events: [
        {
          uid: 'e1@kampus',
          summary: 'Ara tatil',
          category: 'Tatil',
          location: null,
          description: null,
          cancelled: false,
          sequence: 2,
          lastModifiedAt: '2026-10-01T09:00:00.000Z',
          timing: { allDay: true, startDate: '2026-11-09', endDate: '2026-11-13' },
        },
        {
          uid: 'e2@kampus',
          summary: 'Veli toplantısı',
          category: 'Veli toplantısı',
          location: 'Konferans salonu',
          description: 'İlk satır\nİkinci satır',
          cancelled: true,
          sequence: 3,
          lastModifiedAt: '2026-10-02T09:00:00.000Z',
          timing: {
            allDay: false,
            startsAt: '2026-10-15T15:00:00.000Z',
            endsAt: '2026-10-15T17:00:00.000Z',
          },
        },
        {
          uid: 't1@kampus',
          summary: 'Bilet: Yıl sonu gösterisi',
          category: 'Biletli etkinlik',
          location: null,
          description: null,
          cancelled: false,
          sequence: 1,
          lastModifiedAt: '2026-10-02T09:00:00.000Z',
          timing: { allDay: false, startsAt: '2026-12-15T16:00:00.000Z', endsAt: null },
        },
      ],
    })
    assert.ok(ics.endsWith('\r\n'))
    assert.ok(!/[^\r]\n/.test(ics), 'satır sonu CRLF')
    const lines = ics.split('\r\n')
    assert.equal(lines[0], 'BEGIN:VCALENDAR')
    assert.ok(lines.includes('X-WR-CALNAME:Akademi\\; Okul Takvimi'))
    assert.ok(lines.includes('DTSTAMP:20261007T090000Z'))
    assert.ok(lines.includes('DTSTART;VALUE=DATE:20261109'))
    assert.ok(lines.includes('DTEND;VALUE=DATE:20261114'))
    assert.ok(lines.includes('DTSTART:20261015T150000Z'))
    assert.ok(lines.includes('DTEND:20261015T170000Z'))
    assert.ok(lines.includes('DESCRIPTION:İlk satır\\nİkinci satır'))
    assert.ok(lines.includes('STATUS:CANCELLED'))
    assert.ok(lines.includes('SEQUENCE:3'))
    assert.equal(lines.filter((line) => line === 'BEGIN:VEVENT').length, 3)
    assert.equal(lines.filter((line) => line.startsWith('DTEND')).length, 2)
    assert.equal(lines.at(-2), 'END:VCALENDAR')
  })
})
