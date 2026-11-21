import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  allocateClubSeats,
  allocationDigest,
  clubSelectionConfirmSchema,
  clubSelectionPeriodCreateSchema,
  clubSelectionPeriodUpdateSchema,
  clubSelectionPhase,
  clubSelectionPreferenceSchema,
  clubSelectionTermLabel,
  gradeEligible,
  lotteryOrder,
  planClubSelectionConfirm,
  planClubSelectionDraw,
  planClubSelectionPeriod,
  planClubSelectionPeriodUpdate,
  planClubSelectionPreference,
  seededRandom,
  waitlistView,
  type AllocationInput,
  type StoredPeriodFields,
} from '../packages/school-core/src/lib/finance-club-selection.ts'

/** Kulüp tercihi ve kontenjanlı dağıtım kuralları (DOM-FIN-150; ON-169; K-505…K-507). */

const C1 = '00000000-0000-4000-8000-000000000001'
const C2 = '00000000-0000-4000-8000-000000000002'
const C3 = '00000000-0000-4000-8000-000000000003'

function rejects(fn: () => unknown, code: string, kind: 'rule' | 'conflict' = 'rule') {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

const periodInput = {
  name: ' Güz kulüp tercihi ',
  academicYear: 2026,
  openDate: '2026-10-01',
  closeDate: '2026-10-10',
  clubIds: [C1, C2, C3],
  maxChoices: 3,
}

const stored: StoredPeriodFields & {
  openDate: string
  closeDate: string
  drawn: boolean
  confirmed: boolean
} = {
  name: 'Güz kulüp tercihi',
  academicYear: 2026,
  term: null,
  openDate: '2026-10-01',
  closeDate: '2026-10-10',
  clubIds: [C1, C2, C3],
  maxChoices: 3,
  seatsPerStudent: 1,
  gradeLevels: [],
  drawn: false,
  confirmed: false,
}

describe('DOM-FIN-150: tercih dönemi (K-505)', () => {
  test('şema varsayılanları, sıra ve sınır denetimleri', () => {
    const parsed = clubSelectionPeriodCreateSchema.parse(periodInput)
    assert.equal(parsed.name, 'Güz kulüp tercihi')
    assert.equal(parsed.seatsPerStudent, 1)
    assert.equal(parsed.term, null)
    assert.deepEqual(parsed.gradeLevels, [])
    const issues = (input: unknown) =>
      clubSelectionPeriodCreateSchema.safeParse(input).error?.issues.map((issue) => issue.path[0])
    assert.deepEqual(issues({ ...periodInput, closeDate: '2026-09-30' }), ['closeDate'])
    assert.deepEqual(issues({ ...periodInput, maxChoices: 4 }), ['maxChoices'])
    assert.deepEqual(issues({ ...periodInput, maxChoices: 2, seatsPerStudent: 3 }), [
      'seatsPerStudent',
    ])
    assert.deepEqual(issues({ ...periodInput, clubIds: [C1, C1, C2] }), ['clubIds'])
    assert.deepEqual(issues({ ...periodInput, gradeLevels: [5, 5] }), ['gradeLevels'])
    assert.deepEqual(issues({ ...periodInput, gradeLevels: [13] }), ['gradeLevels'])
    assert.deepEqual(issues({ ...periodInput, term: 3 }), ['term'])
    assert.deepEqual(issues({ ...periodInput, institutionId: 'x' }), [undefined])
    assert.equal(clubSelectionPeriodUpdateSchema.safeParse({}).success, false)
    assert.equal(clubSelectionConfirmSchema.safeParse({ digest: 'abc' }).success, false)
    assert.equal(clubSelectionConfirmSchema.safeParse({ digest: '0123456789abcd' }).success, true)
  })

  test('aşama Europe/Istanbul gününe göre; kura ve onay tarihten önce gelir', () => {
    const period = {
      openDate: '2026-10-01',
      closeDate: '2026-10-10',
      drawn: false,
      confirmed: false,
    }
    assert.equal(clubSelectionPhase(period, '2026-09-30'), 'upcoming')
    assert.equal(clubSelectionPhase(period, '2026-10-01'), 'open')
    assert.equal(clubSelectionPhase(period, '2026-10-10'), 'open')
    assert.equal(clubSelectionPhase(period, '2026-10-11'), 'closed')
    assert.equal(clubSelectionPhase({ ...period, drawn: true }, '2026-10-11'), 'drawn')
    assert.equal(
      clubSelectionPhase({ ...period, drawn: true, confirmed: true }, '2026-10-11'),
      'confirmed',
    )
  })

  test('yeni dönem: bulunmayan kulüp ve geçmiş kapanış 422', () => {
    const fields = clubSelectionPeriodCreateSchema.parse(periodInput)
    planClubSelectionPeriod(fields, { today: '2026-10-05', missingClubIds: [] })
    rejects(
      () => planClubSelectionPeriod(fields, { today: '2026-10-05', missingClubIds: [C2] }),
      'club_selection_club_not_found',
    )
    rejects(
      () => planClubSelectionPeriod(fields, { today: '2026-10-11', missingClubIds: [] }),
      'club_selection_closes_past',
    )
  })

  test('düzenleme: tercih varsa yalnız ad ve tarih; kura sonrası kilitli; değişiklik yoksa 422', () => {
    const checks = { today: '2026-10-05', hasPreferences: false, missingClubIds: [] }
    const plan = planClubSelectionPeriodUpdate(
      stored,
      { maxChoices: 2, gradeLevels: [5, 6] },
      checks,
    )
    assert.deepEqual(plan.changed, ['maxChoices', 'gradeLevels'])
    // Aynı kulüpler başka sırayla gönderilirse değişiklik sayılmaz.
    rejects(
      () => planClubSelectionPeriodUpdate(stored, { clubIds: [C3, C2, C1] }, checks),
      'club_selection_unchanged',
    )
    rejects(
      () =>
        planClubSelectionPeriodUpdate(
          stored,
          { maxChoices: 2 },
          { ...checks, hasPreferences: true },
        ),
      'club_selection_has_preferences',
    )
    const dates = planClubSelectionPeriodUpdate(
      stored,
      { closeDate: '2026-10-12', name: 'Yeni ad' },
      { ...checks, hasPreferences: true },
    )
    assert.deepEqual(dates.changed.sort(), ['closeDate', 'name'])
    rejects(
      () => planClubSelectionPeriodUpdate({ ...stored, drawn: true }, { name: 'X Y' }, checks),
      'club_selection_locked',
    )
    rejects(
      () => planClubSelectionPeriodUpdate(stored, { closeDate: '2026-10-04' }, checks),
      'club_selection_closes_past',
    )
    rejects(
      () => planClubSelectionPeriodUpdate(stored, { openDate: '2026-10-11' }, checks),
      'club_selection_date_order',
    )
    rejects(
      () => planClubSelectionPeriodUpdate(stored, { clubIds: [C1, C2] }, checks),
      'club_selection_choices_over_clubs',
    )
    rejects(
      () => planClubSelectionPeriodUpdate(stored, { seatsPerStudent: 4 }, checks),
      'club_selection_seats_over_choices',
    )
    rejects(
      () =>
        planClubSelectionPeriodUpdate(
          stored,
          { clubIds: [C1, C2, C3, C1.replace('1', '9')] },
          {
            ...checks,
            missingClubIds: ['x'],
          },
        ),
      'club_selection_club_not_found',
    )
  })
})

describe('DOM-FIN-150: tercih girişi (K-505)', () => {
  const open = { today: '2026-10-05', student: { active: true }, grade: 7, hasPreference: false }
  const parse = (choices: string[]) =>
    clubSelectionPreferenceSchema.parse({ studentId: 's1', choices })

  test('açık dönemde sıralı tercih yazılır, boş liste geri çeker', () => {
    assert.equal(planClubSelectionPreference(stored, parse([C2, C1]), open), 'replace')
    assert.equal(
      planClubSelectionPreference(stored, parse([]), { ...open, hasPreference: true }),
      'withdraw',
    )
    rejects(
      () => planClubSelectionPreference(stored, parse([]), open),
      'club_selection_no_preference',
    )
    assert.equal(
      clubSelectionPreferenceSchema.safeParse({ studentId: 's1', choices: [C1, C1] }).success,
      false,
    )
  })

  test('dönem açık değilse, öğrenci etkin değilse, düzey dışındaysa ya da tercih geçersizse 422', () => {
    for (const today of ['2026-09-30', '2026-10-11'])
      rejects(
        () => planClubSelectionPreference(stored, parse([C1]), { ...open, today }),
        'club_selection_not_open',
      )
    rejects(
      () => planClubSelectionPreference({ ...stored, drawn: true }, parse([C1]), open),
      'club_selection_not_open',
    )
    rejects(
      () => planClubSelectionPreference(stored, parse([C1]), { ...open, student: null }),
      'club_selection_student_not_found',
    )
    rejects(
      () =>
        planClubSelectionPreference(stored, parse([C1]), { ...open, student: { active: false } }),
      'club_selection_student_inactive',
    )
    const graded = { ...stored, gradeLevels: [5, 6] }
    rejects(
      () => planClubSelectionPreference(graded, parse([C1]), open),
      'club_selection_grade_excluded',
    )
    assert.equal(planClubSelectionPreference(graded, parse([C1]), { ...open, grade: 6 }), 'replace')
    rejects(
      () => planClubSelectionPreference({ ...stored, maxChoices: 1 }, parse([C1, C2]), open),
      'club_selection_too_many_choices',
    )
    rejects(
      () => planClubSelectionPreference({ ...stored, clubIds: [C1, C2] }, parse([C1, C3]), open),
      'club_selection_club_not_in_period',
    )
  })

  test('sınıf düzeyi süzgeci', () => {
    assert.equal(gradeEligible([], undefined), true)
    assert.equal(gradeEligible([7], 7), true)
    assert.equal(gradeEligible([7], 8), false)
    assert.equal(gradeEligible([7], undefined), false)
  })
})

describe('DOM-FIN-150: tohumlu kura ve seri diktatörlük (K-506)', () => {
  test('aynı tohum aynı sırayı verir; girdi sırası etkisiz; farklı tohum farklı sıra', () => {
    const random = seededRandom('tohum')
    const values = [random(), random(), random()]
    const again = seededRandom('tohum')
    assert.deepEqual([again(), again(), again()], values)
    assert.ok(values.every((value) => value >= 0 && value < 1))
    const ids = Array.from({ length: 20 }, (_, index) => `s${String(index + 1)}`)
    const first = lotteryOrder(ids, 'a')
    assert.deepEqual(lotteryOrder([...ids].reverse(), 'a'), first)
    assert.deepEqual([...first].sort(), [...ids].sort())
    assert.notDeepEqual(lotteryOrder(ids, 'b'), first)
  })

  const base: AllocationInput = {
    seed: 'kura-1',
    seatsPerStudent: 1,
    clubs: [
      { id: C1, capacity: 2, memberStudentIds: [] },
      { id: C2, capacity: 1, memberStudentIds: [] },
      { id: C3, capacity: 5, memberStudentIds: [] },
    ],
    preferences: [
      { studentId: 's1', choices: [C1, C2] },
      { studentId: 's2', choices: [C1, C2] },
      { studentId: 's3', choices: [C1, C2] },
      { studentId: 's4', choices: [C1, C2] },
    ],
  }

  test('kura sırasında herkes boş yeri olan en yüksek tercihine yerleşir; kontenjan aşılmaz', () => {
    const result = allocateClubSeats(base)
    assert.equal(result.order.length, 4)
    const [first, second, third, fourth] = result.order
    const club = (studentId: string | undefined) =>
      result.assignments.find((row) => row.studentId === studentId)?.clubId
    assert.equal(club(first), C1)
    assert.equal(club(second), C1)
    assert.equal(club(third), C2)
    assert.equal(club(fourth), undefined)
    assert.deepEqual(
      result.clubs.map((row) => [row.assigned, row.seatsAfter]),
      [
        [2, 0],
        [1, 0],
        [0, 5],
      ],
    )
    // Yerleşemeyen tek öğrenci iki tercihinin de yedek listesinde birinci sıradadır.
    assert.deepEqual(
      result.waitlist.map((row) => [row.clubId, row.studentId, row.rank, row.position]),
      [
        [C1, fourth, 1, 1],
        [C2, fourth, 2, 1],
      ],
    )
    assert.deepEqual(allocateClubSeats(base), result)
    assert.equal(allocationDigest(allocateClubSeats(base)), allocationDigest(result))
    assert.match(allocationDigest(result), /^[0-9a-f]{14}$/)
  })

  test('zaten üye olan öğrenci aynı kulübe yeniden atanmaz; üyeler kontenjandan düşer', () => {
    const result = allocateClubSeats({
      ...base,
      clubs: [
        { id: C1, capacity: 2, memberStudentIds: ['s1', 'x'] },
        { id: C2, capacity: 1, memberStudentIds: [] },
      ],
      preferences: [
        { studentId: 's1', choices: [C1] },
        { studentId: 's2', choices: [C1, C2] },
      ],
    })
    assert.deepEqual(
      result.assignments.map((row) => [row.studentId, row.clubId, row.rank]),
      [['s2', C2, 2]],
    )
    const s1 = result.students.find((row) => row.studentId === 's1')
    assert.deepEqual([s1?.wanted, s1?.assigned], [0, 0])
    assert.equal(
      result.waitlist.some((row) => row.studentId === 's1'),
      false,
    )
    // s2 yerleşti; ilk tercihinin yedeğine girmez (yedek yalnız yerleşemeyenler içindir).
    assert.equal(result.waitlist.length, 0)
    assert.equal(result.clubs[0]?.seatsBefore, 0)
  })

  test('çok kulüplü dağıtımda turlar yılan sırasıyla döner; dönem dışı ve yinelenen tercih yok sayılır', () => {
    const input: AllocationInput = {
      seed: 'yilan',
      seatsPerStudent: 2,
      clubs: [
        { id: C1, capacity: 1, memberStudentIds: [] },
        { id: C2, capacity: 1, memberStudentIds: [] },
        { id: C3, capacity: 1, memberStudentIds: [] },
      ],
      preferences: [
        { studentId: 'a', choices: [C1, C2, C3, 'dis', C1] },
        { studentId: 'b', choices: [C1, C2, C3] },
      ],
    }
    const result = allocateClubSeats(input)
    const [first, second] = result.order
    const rows = result.assignments.map((row) => [row.studentId, row.clubId, row.round])
    // 1. tur: ilk C1, ikinci C2; 2. tur ters sırayla: ikinci C3, ilk boş kulüp bulamaz.
    assert.deepEqual(rows, [
      [first, C1, 1],
      [second, C2, 1],
      [second, C3, 2],
    ])
    const firstRow = result.students.find((row) => row.studentId === first)
    assert.deepEqual([firstRow?.wanted, firstRow?.assigned], [2, 1])
    assert.deepEqual(
      result.waitlist.map((row) => [row.clubId, row.studentId, row.rank]),
      [
        [C2, first, 2],
        [C3, first, 3],
      ],
    )
  })

  test('yedek listesi tercih sırası, sonra kura sırasıyla dizilir; tercihsiz dağıtım boş', () => {
    const result = allocateClubSeats({
      seed: 'yedek',
      seatsPerStudent: 1,
      clubs: [
        { id: C1, capacity: 0, memberStudentIds: [] },
        { id: C2, capacity: 0, memberStudentIds: [] },
      ],
      preferences: [
        { studentId: 'p', choices: [C2, C1] },
        { studentId: 'q', choices: [C1] },
        { studentId: 'r', choices: [C1] },
      ],
    })
    const c1 = result.waitlist.filter((row) => row.clubId === C1)
    assert.equal(c1.at(-1)?.studentId, 'p')
    const qr = c1.slice(0, 2).map((row) => row.studentId)
    assert.deepEqual(
      qr,
      result.order.filter((id) => id !== 'p'),
    )
    assert.deepEqual(
      c1.map((row) => row.position),
      [1, 2, 3],
    )
    const empty = allocateClubSeats({ seed: 'x', seatsPerStudent: 1, clubs: [], preferences: [] })
    assert.deepEqual(empty.assignments, [])
    assert.equal(allocationDigest(empty).length, 14)
  })
})

describe('DOM-FIN-150: kura, onay ve yedek önerisi (K-506, K-507)', () => {
  const closed = { openDate: '2026-10-01', closeDate: '2026-10-10', drawn: false, confirmed: false }
  const today = '2026-10-11'

  test('kura yalnız kapanmış dönemde bir kez çekilir', () => {
    planClubSelectionDraw(closed, { today, preferenceCount: 3 })
    rejects(
      () => planClubSelectionDraw(closed, { today: '2026-10-10', preferenceCount: 3 }),
      'club_selection_still_open',
    )
    rejects(
      () => planClubSelectionDraw(closed, { today, preferenceCount: 0 }),
      'club_selection_no_preferences',
    )
    rejects(
      () => planClubSelectionDraw({ ...closed, drawn: true }, { today, preferenceCount: 3 }),
      'club_selection_already_drawn',
      'conflict',
    )
    rejects(
      () =>
        planClubSelectionDraw(
          { ...closed, drawn: true, confirmed: true },
          { today, preferenceCount: 3 },
        ),
      'club_selection_already_confirmed',
      'conflict',
    )
  })

  test('onay kura ister, özet tutmalı, ikinci onay 409', () => {
    const drawn = { ...closed, drawn: true }
    planClubSelectionConfirm(drawn, { today, digest: 'a', currentDigest: 'a' })
    rejects(
      () => planClubSelectionConfirm(closed, { today, digest: 'a', currentDigest: 'a' }),
      'club_selection_not_drawn',
    )
    rejects(
      () => planClubSelectionConfirm(drawn, { today, digest: 'a', currentDigest: 'b' }),
      'club_selection_preview_stale',
      'conflict',
    )
    rejects(
      () =>
        planClubSelectionConfirm(
          { ...drawn, confirmed: true },
          { today, digest: 'a', currentDigest: 'a' },
        ),
      'club_selection_already_confirmed',
      'conflict',
    )
  })

  test('yer açılınca ilk bekleyen yedek önerilir; üye olan ve kaydı etkin olmayan atlanır', () => {
    const entries = [
      { studentId: 'c', position: 3 },
      { studentId: 'a', position: 1 },
      { studentId: 'b', position: 2 },
    ]
    const view = waitlistView(entries, {
      memberStudentIds: new Set(['a']),
      activeStudentIds: new Set(['a', 'c']),
      freeSeats: 1,
    })
    assert.deepEqual(
      view.rows.map((row) => [row.studentId, row.status]),
      [
        ['a', 'joined'],
        ['b', 'inactive'],
        ['c', 'waiting'],
      ],
    )
    assert.equal(view.suggestedStudentId, 'c')
    const full = waitlistView(entries, {
      memberStudentIds: new Set(),
      activeStudentIds: new Set(['a']),
      freeSeats: 0,
    })
    assert.equal(full.suggestedStudentId, null)
  })

  test('dönem etiketi', () => {
    assert.equal(clubSelectionTermLabel(2026, null), '2026–2027')
    assert.equal(clubSelectionTermLabel(2026, 2), '2026–2027 · 2. dönem')
  })
})
