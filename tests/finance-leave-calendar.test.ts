import assert from 'node:assert/strict'
import test from 'node:test'

import {
  branchBusyDays,
  calendarAbsences,
  calendarEntryView,
  calendarRangeIssue,
  daysOf,
  DEFAULT_LEAVE_CALENDAR_SETTINGS,
  leaveCalendarAudience,
  leaveCalendarSettingsSchema,
  leaveConflicts,
  leaveConflictText,
  planLeaveCalendarSettings,
  type ConflictContext,
  type ConflictTarget,
  type LeaveAbsence,
} from '../packages/school-core/src/lib/finance-leave-calendar.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'

/**
 * İzin takvimi ve çakışma uyarıları (DOM-FIN-123; ON-183; K-420…K-422). Branş öğretmen kaydının
 * dersidir; m1 ve m2 matematik, m3 fen, m4 öğretmen değil.
 */

const absence = (
  id: string,
  membershipId: string,
  startDate: string,
  endDate: string,
  extra: Partial<LeaveAbsence> = {},
): LeaveAbsence => ({
  id,
  source: 'request',
  membershipId,
  name: `Personel ${membershipId}`,
  role: 'ogretmen',
  status: 'approved',
  kind: 'annual',
  typeLabel: 'Yıllık ücretli izin',
  startDate,
  endDate,
  ...extra,
})

const BRANCHES = new Map<string, string[]>([
  ['m1', ['mat']],
  ['m2', ['mat']],
  ['m3', ['fen']],
  ['m5', ['mat', 'fen']],
])

const context = (overrides: Partial<ConflictContext> = {}): ConflictContext => ({
  absences: [],
  branches: BRANCHES,
  subjectNames: new Map([
    ['mat', 'Matematik'],
    ['fen', 'Fen Bilimleri'],
  ]),
  settings: DEFAULT_LEAVE_CALENDAR_SETTINGS,
  teacherAbsences: new Map(),
  teacherNames: new Map([['t2', 'Murat Demir']]),
  ...overrides,
})

const target = (overrides: Partial<ConflictTarget> = {}): ConflictTarget => ({
  membershipId: 'm1',
  name: 'Selin Kaya',
  startDate: '2026-11-02',
  endDate: '2026-11-06',
  lessons: [],
  ...overrides,
})

test('DOM-FIN-123: ayar şeması eşik 2–20, sınav haftası aralığı ve çakışmasını denetler', () => {
  const ok = leaveCalendarSettingsSchema.parse({
    concurrentThreshold: 3,
    examWeeks: [
      { label: ' Final sınavları ', startDate: '2027-01-11', endDate: '2027-01-15' },
      { label: 'Ara sınavlar', startDate: '2026-11-09', endDate: '2026-11-13' },
    ],
  })
  assert.equal(ok.concurrentThreshold, 3)
  assert.deepEqual(
    ok.examWeeks?.map((week) => week.label),
    ['Ara sınavlar', 'Final sınavları'],
  )
  assert.equal(leaveCalendarSettingsSchema.safeParse({}).success, false)
  assert.equal(leaveCalendarSettingsSchema.safeParse({ concurrentThreshold: 1 }).success, false)
  assert.equal(leaveCalendarSettingsSchema.safeParse({ concurrentThreshold: 21 }).success, false)
  assert.equal(leaveCalendarSettingsSchema.safeParse({ concurrentThreshold: 2.5 }).success, false)
  const backwards = leaveCalendarSettingsSchema.safeParse({
    examWeeks: [{ label: 'Ara', startDate: '2026-11-13', endDate: '2026-11-09' }],
  })
  assert.equal(backwards.success, false)
  const long = leaveCalendarSettingsSchema.safeParse({
    examWeeks: [{ label: 'Uzun', startDate: '2026-11-01', endDate: '2026-12-15' }],
  })
  assert.equal(long.success, false)
  const clash = leaveCalendarSettingsSchema.safeParse({
    examWeeks: [
      { label: 'Ara', startDate: '2026-11-09', endDate: '2026-11-13' },
      { label: 'Telafi', startDate: '2026-11-13', endDate: '2026-11-16' },
    ],
  })
  assert.equal(clash.success, false)
  assert.match(clash.error?.issues[0]?.message ?? '', /Ara/)
  assert.equal(
    leaveCalendarSettingsSchema.safeParse({ examWeeks: [], extra: 1 }).success,
    false,
    'katı şema',
  )
})

test('DOM-FIN-123: ayar değişikliği gönderilmeyen alanı korur, değişiklik yoksa 422', () => {
  const week = { label: 'Ara sınavlar', startDate: '2026-11-09', endDate: '2026-11-13' }
  const first = planLeaveCalendarSettings(DEFAULT_LEAVE_CALENDAR_SETTINGS, { examWeeks: [week] })
  assert.deepEqual(first.next, { concurrentThreshold: 2, examWeeks: [week] })
  assert.deepEqual(first.changed, ['examWeeks'])
  const second = planLeaveCalendarSettings(first.next, { concurrentThreshold: 4 })
  assert.deepEqual(second.next, { concurrentThreshold: 4, examWeeks: [week] })
  assert.deepEqual(second.changed, ['concurrentThreshold'])
  assert.throws(
    () => planLeaveCalendarSettings(second.next, { concurrentThreshold: 4, examWeeks: [week] }),
    (error) => error instanceof DomainError && error.code === 'leave_calendar_settings_unchanged',
  )
  assert.deepEqual(
    planLeaveCalendarSettings(second.next, { examWeeks: [{ ...week, label: 'Yeni' }] }).changed,
    ['examWeeks'],
  )
})

test('DOM-FIN-123: yönetici tür adını, raporu yalnız "Raporlu" görür; ön büro türsüz', () => {
  assert.equal(leaveCalendarAudience('yonetici'), 'manager')
  assert.equal(leaveCalendarAudience('onburo'), 'front_desk')
  const annual = absence('r1', 'm1', '2026-11-02', '2026-11-03')
  const manager = calendarEntryView(annual, ['mat'], 'manager')
  assert.equal(manager.category, 'leave')
  assert.equal(manager.typeLabel, 'Yıllık ücretli izin')
  assert.deepEqual(manager.subjectIds, ['mat'])
  const sickRecord = absence('k1', 'm1', '2026-11-02', '2026-11-02', {
    source: 'record',
    kind: 'sick',
    typeLabel: 'Rapor',
  })
  assert.deepEqual(
    [
      calendarEntryView(sickRecord, [], 'manager').category,
      calendarEntryView(sickRecord, [], 'manager').typeLabel,
    ],
    ['sick', null],
  )
  const report = absence('s1', 'm2', '2026-11-02', '2026-11-04', {
    source: 'medical_report',
    kind: null,
    typeLabel: null,
  })
  assert.equal(calendarEntryView(report, [], 'manager').category, 'sick')
  const desk = calendarEntryView(annual, ['mat'], 'front_desk')
  assert.equal(desk.category, 'absent')
  assert.equal(desk.typeLabel, null)
  assert.equal(calendarEntryView(report, [], 'front_desk').category, 'absent')
})

test('DOM-FIN-123: talepten doğan kayıt takvimde talebiyle tek görünür', () => {
  const list = [
    absence('q1', 'm1', '2026-11-02', '2026-11-03'),
    absence('k1', 'm1', '2026-11-02', '2026-11-03', { source: 'record', requestId: 'q1' }),
    absence('k2', 'm2', '2026-11-02', '2026-11-03', { source: 'record', requestId: null }),
    absence('s1', 'm3', '2026-11-02', '2026-11-03', { source: 'medical_report', kind: null }),
  ]
  assert.deepEqual(
    calendarAbsences(list).map((item) => item.id),
    ['q1', 'k2', 's1'],
  )
})

test('DOM-FIN-123: branşta eşiğe ulaşan günler farklı personeli sayar', () => {
  assert.deepEqual(daysOf({ startDate: '2026-10-31', endDate: '2026-11-02' }), [
    '2026-10-31',
    '2026-11-01',
    '2026-11-02',
  ])
  const list = [
    absence('a', 'm1', '2026-11-02', '2026-11-04'),
    absence('b', 'm1', '2026-11-04', '2026-11-04', { source: 'medical_report' }),
    absence('c', 'm2', '2026-11-04', '2026-11-05', { status: 'pending' }),
    absence('d', 'm3', '2026-11-04', '2026-11-04'),
    absence('e', 'm4', '2026-11-04', '2026-11-04'),
  ]
  const busy = branchBusyDays(list, BRANCHES, { startDate: '2026-11-02', endDate: '2026-11-06' }, 2)
  assert.deepEqual(busy, [
    { day: '2026-11-04', subjectId: 'mat', count: 2, membershipIds: ['m1', 'm2'] },
  ])
  assert.deepEqual(
    branchBusyDays(list, BRANCHES, { startDate: '2026-11-02', endDate: '2026-11-06' }, 3),
    [],
  )
})

test('DOM-FIN-123: aynı branşta eşzamanlı izin uyarısı eşikle, diğer personelin adıyla', () => {
  const others = [
    absence('a', 'm2', '2026-11-04', '2026-11-10', { name: 'Murat Demir', status: 'pending' }),
    absence('b', 'm3', '2026-11-02', '2026-11-06', { name: 'Ayla Şen' }),
    absence('c', 'm1', '2026-11-20', '2026-11-21'),
  ]
  const conflicts = leaveConflicts(target(), context({ absences: others }))
  assert.deepEqual(conflicts, [
    {
      code: 'branch_concurrent',
      subjectId: 'mat',
      subjectName: 'Matematik',
      startDate: '2026-11-04',
      endDate: '2026-11-06',
      peak: 2,
      threshold: 2,
      staff: [{ membershipId: 'm2', name: 'Murat Demir' }],
    },
  ])
  assert.match(leaveConflictText(conflicts[0]!), /Matematik branşında .* Murat Demir\.$/)
  // Eşik 3: iki kişi uyarı değil.
  assert.deepEqual(
    leaveConflicts(
      target(),
      context({ absences: others, settings: { concurrentThreshold: 3, examWeeks: [] } }),
    ),
    [],
  )
  // Branşı olmayan personel (öğretmen kaydı yok) branş uyarısı almaz.
  assert.deepEqual(
    leaveConflicts(target({ membershipId: 'm4' }), context({ absences: others })),
    [],
  )
  // İki branşlı personel her branş için ayrı uyarı alır; adı bilinmeyen kaynak boş adla gelir.
  const both = leaveConflicts(target({ membershipId: 'm5' }), context({ absences: others }))
  assert.deepEqual(
    both.map((item) => (item.code === 'branch_concurrent' ? item.subjectId : item.code)),
    ['fen', 'mat'],
  )
})

test('DOM-FIN-123: sınav haftasına denk gelen izin ve yedeği izinli ders uyarılır', () => {
  const settings = {
    concurrentThreshold: 2,
    examWeeks: [
      { label: 'Ara sınavlar', startDate: '2026-11-06', endDate: '2026-11-12' },
      { label: 'Final', startDate: '2027-01-11', endDate: '2027-01-15' },
    ],
  }
  const lessons = [
    {
      lessonId: 'l1',
      startsAt: '2026-11-02T06:00:00.000Z',
      title: 'Matematik',
      substituteTeacherId: 't2',
    },
    {
      lessonId: 'l2',
      startsAt: '2026-11-03T06:00:00.000Z',
      title: 'Geometri',
      substituteTeacherId: 't2',
    },
    {
      lessonId: 'l3',
      startsAt: '2026-11-02T07:00:00.000Z',
      title: 'Fizik',
      substituteTeacherId: null,
    },
    {
      lessonId: 'l4',
      startsAt: '2026-11-02T08:00:00.000Z',
      title: 'Kimya',
      substituteTeacherId: 't9',
    },
  ]
  const conflicts = leaveConflicts(
    target({ lessons }),
    context({
      settings,
      teacherAbsences: new Map([
        ['t2', [{ startDate: '2026-11-02', endDate: '2026-11-02' }]],
        ['t9', [{ startDate: '2026-11-02', endDate: '2026-11-02' }]],
      ]),
    }),
  )
  assert.deepEqual(
    conflicts.map((item) => item.code),
    ['exam_week', 'substitute_on_leave', 'substitute_on_leave'],
  )
  assert.deepEqual(conflicts[0], {
    code: 'exam_week',
    label: 'Ara sınavlar',
    startDate: '2026-11-06',
    endDate: '2026-11-12',
  })
  assert.deepEqual(conflicts[1], {
    code: 'substitute_on_leave',
    lessonId: 'l1',
    startsAt: '2026-11-02T06:00:00.000Z',
    title: 'Matematik',
    teacherId: 't2',
    teacherName: 'Murat Demir',
  })
  assert.equal(conflicts[2]?.code === 'substitute_on_leave' && conflicts[2].teacherName, 't9')
  assert.match(leaveConflictText(conflicts[0]!), /^İzin sınav haftasına denk geliyor: Ara sınavlar/)
  assert.match(leaveConflictText(conflicts[1]!), /yedeği Murat Demir o gün izinli\.$/)
  // Gece yarısına yakın ders İstanbul gününe göre değerlendirilir (UTC 21.30 = ertesi gün).
  const late = leaveConflicts(
    target({
      lessons: [
        {
          lessonId: 'l9',
          startsAt: '2026-11-02T21:30:00.000Z',
          title: 'Etüt',
          substituteTeacherId: 't2',
        },
      ],
    }),
    context({
      teacherAbsences: new Map([['t2', [{ startDate: '2026-11-03', endDate: '2026-11-03' }]]]),
    }),
  )
  assert.equal(late.length, 1)
})

test('DOM-FIN-123: takvim aralığı en çok 62 gün, bitiş başlangıçtan önce olamaz', () => {
  assert.equal(calendarRangeIssue({ startDate: '2026-11-01', endDate: '2027-01-01' }), null)
  assert.match(
    calendarRangeIssue({ startDate: '2026-11-01', endDate: '2027-01-02' }) ?? '',
    /62 gün/,
  )
  assert.match(
    calendarRangeIssue({ startDate: '2026-11-02', endDate: '2026-11-01' }) ?? '',
    /önce olamaz/,
  )
})

test('DOM-FIN-123: tek günlük aralık metni tek gün yazar', () => {
  const text = leaveConflictText({
    code: 'exam_week',
    label: 'Yazılı',
    startDate: '2026-11-09',
    endDate: '2026-11-09',
  })
  assert.equal(text, 'İzin sınav haftasına denk geliyor: Yazılı (9 Kasım).')
  const lonely = leaveConflictText({
    code: 'branch_concurrent',
    subjectId: 'mat',
    subjectName: 'Matematik',
    startDate: '2026-11-09',
    endDate: '2026-11-10',
    peak: 2,
    threshold: 2,
    staff: [],
  })
  assert.equal(
    lonely,
    'Matematik branşında 9 Kasım – 10 Kasım arasında aynı gün en çok 2 personel izinli (eşik 2).',
  )
})
