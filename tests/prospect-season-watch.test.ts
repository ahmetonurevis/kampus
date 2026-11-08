import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addDays,
  daysBetween,
  prospectSeasonWatch,
  SEASON_WATCH_ROW_LIMIT,
  seasonWatchQuerySchema,
  seasonWatchWindow,
  type SeasonLesson,
  type SeasonProspect,
  type SeasonWatchInput,
} from '../packages/school-core/src/lib/prospect-season-watch.ts'

// DOM-KAY-037 kayıt sezonu nöbeti (ON-077; IST-079, IST-091). Şu an 2026-10-06 12:00 Europe/Istanbul.
const NOW = '2026-10-06T09:00:00.000Z'
const WINDOW = seasonWatchWindow(NOW)

const prospect = (id: string, overrides: Partial<SeasonProspect> = {}): SeasonProspect => ({
  id,
  name: `Aday ${id}`,
  stage: 'İletişime geçildi',
  branchId: 'b1',
  createdAt: '2026-10-05T08:00:00.000Z',
  updatedAt: '2026-10-05T08:00:00.000Z',
  trialAt: null,
  meeting: null,
  trialLesson: null,
  lastNoteAt: null,
  ...overrides,
})
const meeting = (
  date: string,
  overrides: Partial<NonNullable<SeasonProspect['meeting']>> = {},
) => ({
  trialAt: date,
  meeting: { date, duration: 45, room: 'Oda 1', teacherId: 't1', ...overrides },
})
const lesson = (id: string, date: string, overrides: Partial<SeasonLesson> = {}): SeasonLesson => ({
  id,
  classId: 'c1',
  date,
  duration: 60,
  cancelledAt: null,
  ...overrides,
})
const trial = (lessonId: string, hasResult = false) => ({
  trialLesson: { lessonId, classId: 'c1', hasResult },
})

const watch = (overrides: Partial<SeasonWatchInput> = {}) =>
  prospectSeasonWatch({
    now: NOW,
    window: WINDOW,
    institutionType: 'school',
    prospects: [],
    lessons: [],
    branches: new Map([['b1', 'Merkez Kampüs']]),
    classes: new Map([['c1', 'A1 Sabah']]),
    teachers: new Map([['t1', 'Selin Kaya']]),
    ...overrides,
  })

test('DOM-KAY-037: pencere bugünden başlar, bugün dahil 7 gün; 1–14 gün seçilir (K-175)', () => {
  assert.deepEqual(WINDOW, { from: '2026-10-06', to: '2026-10-12', days: 7 })
  assert.deepEqual(seasonWatchWindow(NOW, 1), { from: '2026-10-06', to: '2026-10-06', days: 1 })
  // Istanbul günü: 21:30 UTC ertesi gündür.
  assert.equal(seasonWatchWindow('2026-10-06T21:30:00.000Z').from, '2026-10-07')
  assert.equal(seasonWatchQuerySchema.parse({ days: '14' }).days, 14)
  assert.equal(seasonWatchQuerySchema.parse({}).days, undefined)
  for (const query of [{ days: '0' }, { days: '15' }, { days: '1.5' }, { institutionId: 'x' }])
    assert.equal(seasonWatchQuerySchema.safeParse(query).success, false, JSON.stringify(query))
  assert.equal(addDays('2026-12-30', 3), '2027-01-02')
  assert.equal(daysBetween('2026-09-30', '2026-10-06'), 6)
})

test('DOM-KAY-037: penceredeki görüşmeler saat sırasıyla; kapalı aday, pencere dışı ve eski kayıt', () => {
  const result = watch({
    prospects: [
      prospect('later', { stage: 'Görüşme planlandı', ...meeting('2026-10-06T13:00:00.000Z') }),
      prospect('held', { stage: 'Görüşme planlandı', ...meeting('2026-10-06T06:00:00.000Z') }),
      // 00:30 Istanbul: bugün; pencerenin son gününün ertesi 00:30 dışarıda.
      prospect('midnight', {
        stage: 'Görüşme planlandı',
        ...meeting('2026-10-05T21:30:00.000Z', { teacherId: null }),
      }),
      prospect('last', { stage: 'Teklif verildi', ...meeting('2026-10-12T20:00:00.000Z') }),
      prospect('outside', { stage: 'Görüşme planlandı', ...meeting('2026-10-12T21:30:00.000Z') }),
      // Oda ve süresi saklanmamış eski görüşme: 30 dakika.
      prospect('legacy', { stage: 'Görüşme planlandı', trialAt: '2026-10-07T07:00:00.000Z' }),
      prospect('lost', { stage: 'Vazgeçti', ...meeting('2026-10-06T10:00:00.000Z') }),
      prospect('enrolled', { stage: 'Kayıt oldu', ...meeting('2026-10-06T11:00:00.000Z') }),
      prospect('unknown-branch', {
        stage: 'Görüşme planlandı',
        branchId: 'b9',
        ...meeting('2026-10-08T07:00:00.000Z', { teacherId: 't9' }),
      }),
    ],
  })
  assert.deepEqual(
    result.meetings.rows.map((row) => [row.prospectId, row.held]),
    [
      ['midnight', true],
      ['held', true],
      ['later', false],
      ['legacy', false],
      ['unknown-branch', false],
      ['last', false],
    ],
  )
  const held = result.meetings.rows.find((row) => row.prospectId === 'held')
  assert.deepEqual(held, {
    prospectId: 'held',
    name: 'Aday held',
    stage: 'Görüşme planlandı',
    branchName: 'Merkez Kampüs',
    date: '2026-10-06T06:00:00.000Z',
    duration: 45,
    room: 'Oda 1',
    teacherName: 'Selin Kaya',
    held: true,
  })
  const legacy = result.meetings.rows.find((row) => row.prospectId === 'legacy')
  assert.equal(legacy?.duration, 30)
  assert.equal(legacy?.room, null)
  assert.equal(legacy?.teacherName, null)
  const unknown = result.meetings.rows.find((row) => row.prospectId === 'unknown-branch')
  assert.equal(unknown?.branchName, null)
  assert.equal(unknown?.teacherName, null)
  assert.equal(result.summary.meetingsToday, 3)
  assert.equal(result.summary.meetingsInWindow, 6)
  assert.equal(result.meetings.total, 6)
})

test('DOM-KAY-037: deneme dersi yalnız dil okulunda; gün dersin güncel kaydından, iptal edilen ders girmez', () => {
  const prospects = [
    prospect('tr-today', { stage: 'Görüşme planlandı', ...trial('l1') }),
    prospect('tr-moved', { stage: 'Görüşme planlandı', ...trial('l2', true) }),
    prospect('tr-cancelled', { stage: 'Görüşme planlandı', ...trial('l3') }),
    prospect('tr-removed', { stage: 'Görüşme planlandı', ...trial('l-yok') }),
    prospect('tr-lost', { stage: 'Vazgeçti', ...trial('l1') }),
  ]
  const lessons = [
    lesson('l1', '2026-10-06T07:00:00.000Z'),
    // Ders programında ertelenmiş: güncel gün geçerlidir.
    lesson('l2', '2026-10-09T07:00:00.000Z', { classId: null }),
    lesson('l3', '2026-10-07T07:00:00.000Z', { cancelledAt: '2026-10-05T10:00:00.000Z' }),
  ]
  const school = watch({ prospects, lessons })
  assert.equal(school.trialsEnabled, false)
  assert.equal(school.trials.total, 0)
  assert.equal(school.summary.trialsInWindow, 0)

  const language = watch({ institutionType: 'language_school', prospects, lessons })
  assert.equal(language.trialsEnabled, true)
  assert.deepEqual(
    language.trials.rows.map((row) => [
      row.prospectId,
      row.date,
      row.groupName,
      row.held,
      row.resultRecorded,
    ]),
    [
      ['tr-today', '2026-10-06T07:00:00.000Z', 'A1 Sabah', true, false],
      // Dersin sınıfı yoksa adayın kaydındaki grup.
      ['tr-moved', '2026-10-09T07:00:00.000Z', 'A1 Sabah', false, true],
    ],
  )
  assert.equal(language.summary.trialsToday, 1)
  assert.equal(language.summary.trialsInWindow, 2)
})

test('DOM-KAY-037: ilk temas açılışın ertesi günü gecikir; bugün açılan sayılır ama gecikmez (K-176)', () => {
  const result = watch({
    prospects: [
      prospect('new-old', { stage: 'Yeni aday', createdAt: '2026-10-03T08:00:00.000Z' }),
      prospect('new-today', { stage: 'Yeni aday', createdAt: '2026-10-06T06:00:00.000Z' }),
      // Istanbul'da 6 Ekim 01:00: bugün açılmış sayılır.
      prospect('new-midnight', { stage: 'Yeni aday', createdAt: '2026-10-05T22:00:00.000Z' }),
      prospect('contacted', { createdAt: '2026-10-06T07:00:00.000Z' }),
      prospect('lost-today', { stage: 'Vazgeçti', createdAt: '2026-10-06T07:00:00.000Z' }),
    ],
  })
  assert.deepEqual(
    result.followUps.rows.map((row) => [row.prospectId, row.reason, row.sinceDate, row.days]),
    [['new-old', 'first_contact', '2026-10-03', 3]],
  )
  assert.equal(result.summary.newToday, 3)
})

test('DOM-KAY-037: görüşme sonrası not yoksa ertesi gün takip; not ya da ileri tarihli görüşme düşürür (K-178)', () => {
  const result = watch({
    prospects: [
      prospect('after', { stage: 'Görüşme planlandı', ...meeting('2026-10-04T07:00:00.000Z') }),
      prospect('noted', {
        stage: 'Görüşme planlandı',
        ...meeting('2026-10-04T07:00:00.000Z'),
        lastNoteAt: '2026-10-04T08:00:00.000Z',
      }),
      prospect('note-before', {
        stage: 'Görüşme planlandı',
        ...meeting('2026-10-04T07:00:00.000Z'),
        lastNoteAt: '2026-10-03T08:00:00.000Z',
      }),
      prospect('held-today', {
        stage: 'Görüşme planlandı',
        ...meeting('2026-10-06T06:00:00.000Z'),
      }),
      prospect('offered', { stage: 'Teklif verildi', ...meeting('2026-10-04T07:00:00.000Z') }),
      // Yeni aday gibi görünse de ileri tarihli görüşmesi var: takip yok.
      prospect('upcoming', {
        stage: 'Yeni aday',
        createdAt: '2026-09-01T08:00:00.000Z',
        updatedAt: '2026-09-01T08:00:00.000Z',
        ...meeting('2026-10-20T07:00:00.000Z'),
      }),
    ],
  })
  assert.deepEqual(
    result.followUps.rows.map((row) => [
      row.prospectId,
      row.reason,
      row.sinceDate,
      row.days,
      row.trialResultRecorded,
    ]),
    [
      ['after', 'meeting_outcome', '2026-10-04', 2, null],
      ['note-before', 'meeting_outcome', '2026-10-04', 2, null],
    ],
  )
})

test('DOM-KAY-037: dil okulunda deneme sonrası takip; sonraki olay geçerli, okulda deneme yok sayılır', () => {
  const prospects = [
    prospect('trial-after', { stage: 'Görüşme planlandı', ...trial('l1') }),
    prospect('trial-result', { stage: 'Görüşme planlandı', ...trial('l1', true) }),
    // Görüşme denemeden sonra: görüşme sonucu beklenir.
    prospect('both-meeting-last', {
      stage: 'Görüşme planlandı',
      ...meeting('2026-10-05T07:00:00.000Z'),
      ...trial('l1'),
    }),
    // Deneme görüşmeden sonra: deneme sonrası takip.
    prospect('both-trial-last', {
      stage: 'Görüşme planlandı',
      ...meeting('2026-10-01T07:00:00.000Z'),
      ...trial('l1'),
    }),
    // İptal edilen deneme yapılmamıştır.
    prospect('trial-cancelled', { stage: 'Görüşme planlandı', ...trial('l2') }),
    // İleri tarihli deneme takibi düşürür.
    prospect('trial-upcoming', {
      stage: 'Görüşme planlandı',
      updatedAt: '2026-09-01T08:00:00.000Z',
      createdAt: '2026-09-01T08:00:00.000Z',
      ...trial('l3'),
    }),
  ]
  const lessons = [
    lesson('l1', '2026-10-03T07:00:00.000Z'),
    lesson('l2', '2026-10-02T07:00:00.000Z', { cancelledAt: '2026-10-01T07:00:00.000Z' }),
    lesson('l3', '2026-10-08T07:00:00.000Z'),
  ]
  const language = watch({ institutionType: 'language_school', prospects, lessons })
  assert.deepEqual(
    language.followUps.rows.map((row) => [
      row.prospectId,
      row.reason,
      row.days,
      row.trialResultRecorded,
    ]),
    [
      ['both-trial-last', 'trial_outcome', 3, false],
      ['trial-after', 'trial_outcome', 3, false],
      ['trial-result', 'trial_outcome', 3, true],
      ['both-meeting-last', 'meeting_outcome', 1, null],
    ],
  )
  assert.equal(language.summary.followUpsByReason.trial_outcome, 3)
  assert.equal(language.summary.followUpsByReason.meeting_outcome, 1)

  // Okulda deneme kaydı (eski veri) yok sayılır: ileri tarihli deneme takibi düşürmez.
  const school = watch({ prospects, lessons })
  const reasons = new Map(school.followUps.rows.map((row) => [row.prospectId, row.reason]))
  assert.equal(reasons.get('trial-after'), undefined)
  assert.equal(reasons.get('both-meeting-last'), 'meeting_outcome')
  assert.equal(reasons.get('both-trial-last'), 'meeting_outcome')
  assert.equal(reasons.get('trial-upcoming'), 'stale')
})

test('DOM-KAY-037: son işlem 7 gün ve daha eskiyse temas kesildi; not, güncelleme ve yapılan görüşme sayılır (K-177)', () => {
  const old = { createdAt: '2026-09-20T08:00:00.000Z', updatedAt: '2026-09-28T08:00:00.000Z' }
  const result = watch({
    prospects: [
      prospect('stale-8', { stage: 'Teklif verildi', ...old }),
      prospect('stale-7', { ...old, updatedAt: '2026-09-29T08:00:00.000Z' }),
      prospect('fresh-6', { ...old, updatedAt: '2026-09-30T08:00:00.000Z' }),
      prospect('fresh-note', { ...old, lastNoteAt: '2026-10-02T08:00:00.000Z' }),
      // Görüşmesi 2 gün önce yapılmış, notu var: görüşme son işlem sayılır.
      prospect('fresh-meeting', {
        stage: 'Teklif verildi',
        ...old,
        ...meeting('2026-10-04T07:00:00.000Z'),
      }),
      prospect('no-dates', { createdAt: null, updatedAt: null }),
      prospect('bad-date', { createdAt: 'dün', updatedAt: null, stage: 'Yeni aday' }),
    ],
  })
  assert.deepEqual(
    result.followUps.rows.map((row) => [row.prospectId, row.reason, row.sinceDate, row.days]),
    [
      ['stale-8', 'stale', '2026-09-28', 8],
      ['stale-7', 'stale', '2026-09-29', 7],
    ],
  )
  assert.equal(result.summary.followUps, 2)
  assert.deepEqual(result.summary.followUpsByReason, {
    first_contact: 0,
    meeting_outcome: 0,
    trial_outcome: 0,
    stale: 2,
  })
})

test('DOM-KAY-037: takipler gecikmeye, sonra nedene ve ada göre; bölüm en çok 50 satır, toplam ayrı', () => {
  const many = Array.from({ length: SEASON_WATCH_ROW_LIMIT + 5 }, (_, i) =>
    prospect(`m${String(i).padStart(2, '0')}`, {
      stage: 'Görüşme planlandı',
      ...meeting(`2026-10-0${String(7 + (i % 3))}T07:00:00.000Z`),
    }),
  )
  const result = watch({
    prospects: [
      ...many,
      prospect('b-first', { stage: 'Yeni aday', createdAt: '2026-09-28T08:00:00.000Z' }),
      prospect('a-stale', {
        createdAt: '2026-09-20T08:00:00.000Z',
        updatedAt: '2026-09-28T08:00:00.000Z',
      }),
      prospect('c-first', { stage: 'Yeni aday', createdAt: '2026-10-01T08:00:00.000Z' }),
    ],
  })
  assert.equal(result.meetings.total, SEASON_WATCH_ROW_LIMIT + 5)
  assert.equal(result.meetings.rows.length, SEASON_WATCH_ROW_LIMIT)
  assert.equal(result.summary.meetingsInWindow, SEASON_WATCH_ROW_LIMIT + 5)
  assert.deepEqual(
    result.followUps.rows.map((row) => row.prospectId),
    ['b-first', 'a-stale', 'c-first'],
  )
  // Yanıt yalnız izinli alanları taşır (K-179).
  for (const row of result.followUps.rows)
    assert.deepEqual(Object.keys(row).sort(), [
      'branchName',
      'days',
      'name',
      'prospectId',
      'reason',
      'sinceDate',
      'stage',
      'trialResultRecorded',
    ])
})

test('DOM-KAY-037: girdi değişmez; aynı girdiyle iki okuma aynı sonucu verir', () => {
  const prospects = [
    prospect('p1', { stage: 'Görüşme planlandı', ...meeting('2026-10-04T07:00:00.000Z') }),
    prospect('p2', { stage: 'Yeni aday', createdAt: '2026-10-01T08:00:00.000Z' }),
  ]
  const before = structuredClone(prospects)
  const first = watch({ prospects })
  const second = watch({ prospects })
  assert.deepEqual(prospects, before)
  assert.deepEqual(first, second)
})
