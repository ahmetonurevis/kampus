import assert from 'node:assert/strict'
import test from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  applyEOzelMarks,
  eOzelAttendanceItems,
  eOzelCourseEndItems,
  eOzelCsv,
  eOzelFeeItems,
  eOzelFilterSchema,
  eOzelKey,
  eOzelLearnerItems,
  eOzelMarkSchema,
  learnerSourceId,
  maskIdentityNumber,
  planEOzelMark,
  selectEOzelItems,
  type EOzelItem,
} from '../packages/school-core/src/lib/finance-e-ozel.ts'

const IDENTITIES = new Map([
  [
    's1',
    {
      kind: 'tc',
      number: '10000000146',
      birthDate: '2010-03-04',
      createdAt: new Date('2026-09-01T21:30:00.000Z'),
    },
  ],
])

const payment = (overrides: Partial<Parameters<typeof eOzelFeeItems>[0][number]> = {}) => ({
  id: 'p1',
  studentId: 's1',
  studentName: 'Deniz Yılmaz',
  amountCents: 150_000,
  method: 'Banka havalesi',
  reference: 'TR-1',
  paidAt: new Date('2026-10-05T09:00:00.000Z'),
  receiptYear: 2026,
  receiptNumber: 12,
  reversedAt: null,
  mebbisRecordedAt: null,
  mebbisRecordedByUserId: null,
  version: 3,
  ...overrides,
})

const learnerItem = (name: string, id: string): EOzelItem =>
  eOzelLearnerItems([{ id, name }], new Map())[0] as EOzelItem

test('IST-085 DOM-KAY-015: kursiyer satırı maskeli kimlik taşır, tam numara çıkmaz', () => {
  const [row] = eOzelLearnerItems([{ id: 's1', name: 'Deniz Yılmaz', isActive: true }], IDENTITIES)
  assert.equal(row?.kind, 'learner')
  assert.equal(row?.learner?.maskedIdentity, '*******0146')
  assert.equal(row?.learner?.birthDate, '2010-03-04')
  assert.equal(row?.learner?.status, 'active')
  // Kesin kayıt günü Europe/Istanbul: 21.30Z ertesi güne düşer.
  assert.equal(row?.date, '2026-09-02')
  assert.equal(JSON.stringify(row).includes('10000000146'), false)
  assert.equal(maskIdentityNumber('10000000146'), '*******0146')
})

test('IST-085: kimliği olmayan kursiyer listede kalır, günü boştur', () => {
  const [row] = eOzelLearnerItems([{ id: 's2', name: 'Ece Yılmaz' }], IDENTITIES)
  assert.equal(row?.date, null)
  assert.equal(row?.learner?.maskedIdentity, null)
})

test('IST-085: ayrılan kursiyer "kayıt iptal" olarak ayrı işlenmemiş satırdır', () => {
  assert.equal(learnerSourceId({ id: 's1' }), 's1')
  assert.equal(learnerSourceId({ id: 's1', isActive: false }), 's1:cancelled')
  const [row] = eOzelLearnerItems([{ id: 's1', name: 'Deniz', isActive: false }], IDENTITIES)
  assert.equal(row?.learner?.status, 'cancelled')
  const marked = applyEOzelMarks(
    [row as EOzelItem],
    new Map([
      [
        eOzelKey('learner', 's1'),
        { recordedAt: '2026-09-02T09:00:00.000Z', recordedByUserId: 'u1', version: 2 },
      ],
    ]),
  )
  assert.equal(marked[0]?.recordedAt, null, 'aktif kaydın işareti iptal satırına geçmez')
})

test('DOM-FIN-032: ücret satırı tahsilatın MEBBİS işaretini ve sürümünü taşır; iptal listeye girmez', () => {
  const [open, marked, reversed] = [
    payment(),
    payment({
      id: 'p2',
      mebbisRecordedAt: new Date('2026-10-06T09:00:00.000Z'),
      mebbisRecordedByUserId: 'u1',
      version: 4,
    }),
    payment({ id: 'p3', reversedAt: new Date('2026-10-06T09:00:00.000Z') }),
  ]
  const items = eOzelFeeItems([open, marked, reversed])
  assert.deepEqual(
    items.map((item) => item.sourceId),
    ['p1', 'p2'],
  )
  assert.deepEqual(items[0]?.fee, {
    amountCents: 150_000,
    receipt: '2026-12',
    method: 'Banka havalesi',
    reference: 'TR-1',
  })
  assert.equal(items[0]?.version, 3)
  assert.equal(items[1]?.recordedAt, '2026-10-06T09:00:00.000Z')
  assert.equal(items[1]?.recordedByUserId, 'u1')
  // Ücretin işareti tablodan gelmez: aynı anahtar satırı ezmez.
  const applied = applyEOzelMarks(
    items,
    new Map([
      [
        eOzelKey('fee', 'p1'),
        { recordedAt: '2026-01-01T00:00:00.000Z', recordedByUserId: 'x', version: 9 },
      ],
    ]),
  )
  assert.equal(applied[0]?.recordedAt, null)
  assert.equal(applied[0]?.version, 3)
})

test('DOM-DIL-060 DOM-DIL-061: yalnız gelmedi ve özürlü devamsızlık satır olur; geç katılmış sayılır', () => {
  const items = eOzelAttendanceItems({
    names: new Map([['s1', 'Deniz Yılmaz']]),
    lessonHours: [
      {
        id: 'h1',
        learnerId: 's1',
        lessonHourId: 'ders-1',
        status: 'absent',
        excused: true,
        recordedAt: new Date('2026-10-05T09:00:00.000Z'),
        groupName: 'B1 Akşam',
        courseName: 'Genel İngilizce',
      },
      {
        id: 'h2',
        learnerId: 's1',
        lessonHourId: 'ders-2',
        status: 'late',
        excused: false,
        recordedAt: new Date('2026-10-05T09:00:00.000Z'),
        groupName: 'B1 Akşam',
        courseName: 'Genel İngilizce',
      },
    ],
    days: [
      { id: 'd1', studentId: 's1', date: '2026-10-01', status: 'absent', className: 'TYT-1' },
      { id: 'd2', studentId: 's1', date: '2026-10-02', status: 'excused', className: 'TYT-1' },
      { id: 'd3', studentId: 's1', date: '2026-10-03', status: 'late', className: 'TYT-1' },
      { id: 'd4', studentId: 's9', date: '2026-10-04', status: 'present', className: null },
    ],
  })
  assert.deepEqual(
    items.map((item) => [item.sourceId, item.attendance?.excused]),
    [
      ['h1', true],
      ['d1', false],
      ['d2', true],
    ],
  )
  assert.equal(items[0]?.attendance?.lessonHourId, 'ders-1')
  assert.equal(items[1]?.attendance?.groupName, 'TYT-1')
  assert.equal(items[1]?.attendance?.lessonHourId, null)
})

test('DOM-DIL-070: kurs sonu satırı kararı ve varsa MEBBİS belge numarasını gösterir', () => {
  const [row] = eOzelCourseEndItems({
    names: new Map([['s1', 'Deniz Yılmaz']]),
    decisions: [
      {
        id: 'd1',
        learnerId: 's1',
        outcome: 'incomplete_attendance',
        decidedAt: new Date('2026-10-01T09:00:00.000Z'),
        reviewedAt: new Date('2026-10-03T09:00:00.000Z'),
        groupName: 'B1 Akşam',
        courseName: 'Genel İngilizce',
        certificateNumber: null,
      },
    ],
  })
  assert.equal(row?.kind, 'course_end')
  assert.equal(row?.date, '2026-10-03')
  assert.equal(row?.courseEnd?.outcome, 'incomplete_attendance')
})

test('IST-085: varsayılan süzgeç işlenmemişleri verir; tür, durum, gün ve arama süzer', () => {
  const pending = learnerItem('Şule Öztürk', 's1')
  const recorded = {
    ...learnerItem('Ali Çelik', 's2'),
    recordedAt: '2026-10-05T09:00:00.000Z',
    recordedByUserId: 'u1',
    version: 2,
  }
  const fee = eOzelFeeItems([payment()])[0] as EOzelItem
  const all = [pending, recorded, fee]
  assert.deepEqual(
    selectEOzelItems(all, {}).map((item) => item.sourceId),
    ['p1', 's1'],
    'en yeni gün önce, günü olmayan sonda',
  )
  assert.deepEqual(
    selectEOzelItems(all, { status: 'recorded' }).map((item) => item.sourceId),
    ['s2'],
  )
  assert.equal(selectEOzelItems(all, { status: 'all' }).length, 3)
  assert.deepEqual(
    selectEOzelItems(all, { kind: 'fee' }).map((item) => item.sourceId),
    ['p1'],
  )
  assert.deepEqual(
    selectEOzelItems(all, { q: 'sule ozturk' }).map((item) => item.sourceId),
    ['s1'],
    'Türkçe harf ve büyük/küçük harf duyarsız',
  )
  assert.deepEqual(
    selectEOzelItems(all, { q: 'TR-1' }).map((item) => item.sourceId),
    ['p1'],
  )
  assert.deepEqual(
    selectEOzelItems(all, { dateFrom: '2026-10-05', dateTo: '2026-10-05' }).map(
      (item) => item.sourceId,
    ),
    ['p1'],
    'günü olmayan satır gün süzgecine takılır',
  )
  assert.equal(selectEOzelItems(all, { dateTo: '2026-10-04' }).length, 0)
  assert.equal(all[0], pending, 'girdi dizisi değişmez')
})

test('IST-085: süzgeç şeması varsayılanı uygular, ters aralığı ve bilinmeyen alanı reddeder', () => {
  assert.equal(eOzelFilterSchema.parse({}).status, 'pending')
  assert.equal(eOzelFilterSchema.safeParse({ kind: 'other' }).success, false)
  assert.equal(eOzelFilterSchema.safeParse({ institutionId: 'b' }).success, false)
  assert.equal(
    eOzelFilterSchema.safeParse({ dateFrom: '2026-10-02', dateTo: '2026-10-01' }).success,
    false,
  )
  assert.equal(eOzelMarkSchema.safeParse({ recorded: 'evet' }).success, false)
  assert.equal(eOzelMarkSchema.safeParse({ recorded: true, recordedBy: 'u' }).success, false)
})

test('IST-085: işlenmiş satır yeniden işlenmez, işlenmemiş satırın işareti kaldırılmaz', () => {
  const fresh = { recordedAt: null }
  const done = { recordedAt: '2026-10-05T09:00:00.000Z' }
  assert.deepEqual(planEOzelMark({ recorded: true, current: fresh }), { recorded: true })
  assert.deepEqual(planEOzelMark({ recorded: false, current: done }), { recorded: false })
  assert.throws(
    () => planEOzelMark({ recorded: true, current: done }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === 'e_ozel_already_recorded' &&
      error.kind === 'conflict',
  )
  assert.throws(
    () => planEOzelMark({ recorded: false, current: fresh }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === 'e_ozel_not_recorded' &&
      error.kind === 'conflict',
  )
})

test('IST-085: CSV formül kaçışlıdır, tutar sayıdır, tam kimlik yazılmaz', () => {
  const [learner] = eOzelLearnerItems([{ id: 's1', name: '=HYPERLINK("x")' }], IDENTITIES)
  const [fee] = eOzelFeeItems([payment({ reference: '+90-KOD', studentName: '@ad' })])
  const csv = eOzelCsv(
    [
      learner as EOzelItem,
      { ...(fee as EOzelItem), recordedAt: '2026-10-05T09:00:00.000Z', recordedByUserId: 'u1' },
    ],
    new Map([['u1', '-Selin Kaya']]),
  )
  assert.equal(csv.includes('10000000146'), false)
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`))
  assert.ok(csv.includes(`"'+90-KOD"`))
  assert.ok(csv.includes(`"'@ad"`))
  assert.ok(csv.includes(`"'-Selin Kaya"`))
  assert.ok(csv.includes(';1500,00;'), 'tutar kaçılmaz')
  const [header, ...rows] = csv.split('\r\n')
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.split(';').length, header?.split(';').length)
  assert.equal(eOzelCsv([]).split('\r\n').length, 1, 'boş liste yalnız başlıktır')
})

test('IST-085: CSV devamsızlık ve kurs sonu sütunlarını doldurur', () => {
  const absence = eOzelAttendanceItems({
    names: new Map(),
    lessonHours: [],
    days: [{ id: 'd1', studentId: 's1', date: '2026-10-01', status: 'excused', className: 'A' }],
  })
  const end = eOzelCourseEndItems({
    names: new Map(),
    decisions: [
      {
        id: 'c1',
        learnerId: 's1',
        outcome: 'passed',
        decidedAt: '2026-10-01T09:00:00.000Z',
        reviewedAt: null,
        groupName: 'B1',
        courseName: 'Genel',
        certificateNumber: 'B-77',
      },
    ],
  })
  const csv = eOzelCsv([...absence, ...end])
  assert.ok(csv.includes('"Evet"'))
  assert.ok(csv.includes('"Geçti"'))
  assert.ok(csv.includes('"B-77"'))
  assert.ok(csv.includes('"İşlenmedi"'))
})
