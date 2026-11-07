import assert from 'node:assert/strict'
import test from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  applyEOzelMarks,
  eOzelAttendanceItems,
  eOzelChangeNote,
  eOzelCourseEndItems,
  eOzelCsv,
  eOzelFeeItems,
  eOzelFilterSchema,
  eOzelFingerprint,
  eOzelKey,
  eOzelLearnerItems,
  eOzelMarkedIds,
  eOzelMarkSchema,
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
      version: 1,
    },
  ],
])

/** Testte özet girdinin kendisidir: girdide ne olduğu da böyle görülür. */
const digest = (canonical: string) => canonical
const markAs = (item: EOzelItem, version = 2) =>
  new Map([
    [
      eOzelKey(item.kind, item.sourceId),
      {
        recordedAt: '2026-10-05T09:00:00.000Z',
        recordedByUserId: 'u1',
        version,
        fingerprint: eOzelFingerprint(item, digest),
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
  mebbisFingerprint: null,
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

test('IST-085: işlenmemiş ayrılan kursiyer "Kayıt iptal" bilgisiyle işlenmemiş kalır', () => {
  const [row] = eOzelLearnerItems([{ id: 's1', name: 'Deniz', isActive: false }], IDENTITIES)
  assert.equal(row?.sourceId, 's1')
  assert.equal(row?.learner?.status, 'cancelled')
  const [applied] = applyEOzelMarks([row as EOzelItem], new Map(), digest)
  assert.equal(applied?.recordStatus, 'pending')
})

test('IST-085: işlenmiş kursiyer ayrılınca ya da kimliği değişince satır düzeltilmeli olur, ad özete girmez', () => {
  const active = eOzelLearnerItems([{ id: 's1', name: 'Deniz' }], IDENTITIES)
  const marks = markAs(active[0] as EOzelItem)
  assert.equal(applyEOzelMarks(active, marks, digest)[0]?.recordStatus, 'recorded')

  const cancelled = eOzelLearnerItems([{ id: 's1', name: 'Deniz', isActive: false }], IDENTITIES)
  const [changed] = applyEOzelMarks(cancelled, marks, digest)
  assert.equal(changed?.recordStatus, 'needs_correction')
  assert.equal(changed?.sourceRemoved, false)
  assert.equal(eOzelChangeNote(changed as EOzelItem), 'Kayıt durumu ya da kimlik bilgisi değişti')

  const corrected = new Map([
    [
      's1',
      { ...(IDENTITIES.get('s1') as NonNullable<ReturnType<typeof IDENTITIES.get>>), version: 2 },
    ],
  ])
  const identityChanged = eOzelLearnerItems([{ id: 's1', name: 'Deniz' }], corrected)
  assert.equal(applyEOzelMarks(identityChanged, marks, digest)[0]?.recordStatus, 'needs_correction')

  const renamed = eOzelLearnerItems([{ id: 's1', name: 'Deniz Kaya' }], IDENTITIES)
  assert.equal(applyEOzelMarks(renamed, marks, digest)[0]?.recordStatus, 'recorded')
})

test('IST-085: parmak izi girdisinde kimlik numarası, doğum tarihi, ad ve havale referansı yok', () => {
  const [learner] = eOzelLearnerItems([{ id: 's1', name: 'Deniz Yılmaz' }], IDENTITIES)
  const [fee] = eOzelFeeItems([payment()])
  const canonical = [learner, fee].map((item) => eOzelFingerprint(item as EOzelItem, digest)).join()
  for (const value of ['10000000146', '0146', '2010-03-04', 'Deniz', 'TR-1'])
    assert.equal(canonical.includes(value), false, value)
})

test('DOM-YTK-040: crm kapalıyken kimlik satırda boştur, özet değişmez ve satır düzeltilmeli olmaz', () => {
  const open = eOzelLearnerItems([{ id: 's1', name: 'Deniz' }], IDENTITIES)
  const closed = eOzelLearnerItems([{ id: 's1', name: 'Deniz' }], IDENTITIES, {
    showIdentity: false,
  })
  assert.equal(closed[0]?.learner?.maskedIdentity, null)
  assert.equal(closed[0]?.learner?.birthDate, null)
  assert.equal(closed[0]?.date, null)
  const marks = markAs(open[0] as EOzelItem)
  assert.equal(applyEOzelMarks(closed, marks, digest)[0]?.recordStatus, 'recorded')
})

test('IST-085: geri alınan işaret işlenmemiştir; işaretli kimlikler yalnız işareti duranlardır', () => {
  const [row] = eOzelLearnerItems([{ id: 's1', name: 'Deniz' }], IDENTITIES)
  const undone = new Map([
    [
      eOzelKey('learner', 's1'),
      { recordedAt: null, recordedByUserId: null, version: 3, fingerprint: null },
    ],
  ])
  const [applied] = applyEOzelMarks([row as EOzelItem], undone, digest)
  assert.equal(applied?.recordStatus, 'pending')
  assert.equal(applied?.version, 3)
  assert.deepEqual([...eOzelMarkedIds(undone, 'learner')], [])
  const marked = markAs(row as EOzelItem)
  assert.deepEqual([...eOzelMarkedIds(marked, 'learner')], ['s1'])
  assert.deepEqual([...eOzelMarkedIds(marked, 'attendance')], [])
})

test('DOM-FIN-033: işaretliyken iptal edilen tahsilat listede kalır, düzeltilmeli olur; düzeltme yeniden işaretle kapanır', () => {
  const recordedAt = new Date('2026-10-06T09:00:00.000Z')
  const [marked] = eOzelFeeItems([payment()])
  const fingerprint = eOzelFingerprint(marked as EOzelItem, digest)
  const stored = {
    mebbisRecordedAt: recordedAt,
    mebbisRecordedByUserId: 'u1',
    mebbisFingerprint: fingerprint,
  }
  const live = eOzelFeeItems([payment(stored)])
  assert.equal(applyEOzelMarks(live, new Map(), digest)[0]?.recordStatus, 'recorded')

  const reversed = eOzelFeeItems([payment({ ...stored, reversedAt: recordedAt })])
  const [row] = applyEOzelMarks(reversed, new Map(), digest)
  assert.equal(row?.recordStatus, 'needs_correction')
  assert.equal(row?.sourceRemoved, true)
  assert.equal(eOzelChangeNote(row as EOzelItem), 'Tahsilat iptal edildi')

  const corrected = eOzelFeeItems([
    payment({
      ...stored,
      reversedAt: recordedAt,
      mebbisFingerprint: eOzelFingerprint(row as EOzelItem, digest),
    }),
  ])
  const [closed] = applyEOzelMarks(corrected, new Map(), digest)
  assert.equal(closed?.recordStatus, 'recorded')
  assert.equal(eOzelChangeNote(closed as EOzelItem), 'Tahsilat iptal edildi')
})

test('DOM-FIN-032: MEBBİS ucundan işaretlenen tahsilatta özet yoktur, yalnız iptal düzeltme ister', () => {
  const marked = {
    mebbisRecordedAt: new Date('2026-10-06T09:00:00.000Z'),
    mebbisRecordedByUserId: 'u1',
  }
  assert.equal(
    applyEOzelMarks(eOzelFeeItems([payment(marked)]), new Map(), digest)[0]?.recordStatus,
    'recorded',
  )
  assert.equal(
    applyEOzelMarks(
      eOzelFeeItems([payment({ ...marked, reversedAt: marked.mebbisRecordedAt })]),
      new Map(),
      digest,
    )[0]?.recordStatus,
    'needs_correction',
  )
})

test('DOM-FIN-032: ücret satırı tahsilatın MEBBİS işaretini ve sürümünü taşır; işlenmemiş iptal listeye girmez', () => {
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
        {
          recordedAt: '2026-01-01T00:00:00.000Z',
          recordedByUserId: 'x',
          version: 9,
          fingerprint: 'x',
        },
      ],
    ]),
    digest,
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

test('IST-085 DOM-DIL-060: yoklama düzeltilince işaretli satır düzeltilmeli kalır, işaretsiz satır düşer', () => {
  const day = {
    id: 'd1',
    studentId: 's1',
    date: '2026-10-01',
    status: 'absent',
    className: 'TYT-1',
  }
  const hour = {
    id: 'h1',
    learnerId: 's1',
    lessonHourId: 'ders-1',
    status: 'absent',
    excused: false,
    recordedAt: new Date('2026-10-05T09:00:00.000Z'),
    groupName: 'B1 Akşam',
    courseName: 'Genel İngilizce',
  }
  const names = new Map([['s1', 'Deniz Yılmaz']])
  const [hourRow, dayRow] = eOzelAttendanceItems({ names, lessonHours: [hour], days: [day] })
  const marks = new Map([...markAs(hourRow as EOzelItem), ...markAs(dayRow as EOzelItem)])
  const marked = eOzelMarkedIds(marks, 'attendance')
  const statusOf = (lessonHours: (typeof hour)[], days: (typeof day & { archived?: boolean })[]) =>
    applyEOzelMarks(eOzelAttendanceItems({ names, lessonHours, days, marked }), marks, digest).map(
      (row) => [row.sourceId, row.recordStatus, row.sourceRemoved],
    )

  assert.deepEqual(statusOf([hour], [day]), [
    ['h1', 'recorded', false],
    ['d1', 'recorded', false],
  ])
  assert.deepEqual(
    statusOf([{ ...hour, status: 'present' }], [{ ...day, status: 'present' }]),
    [
      ['h1', 'needs_correction', true],
      ['d1', 'needs_correction', true],
    ],
    'devamsızlık kalktı',
  )
  assert.deepEqual(
    statusOf([{ ...hour, excused: true }], [{ ...day, status: 'excused' }]),
    [
      ['h1', 'needs_correction', false],
      ['d1', 'needs_correction', false],
    ],
    'özür eklendi, satır devamsızlık olarak kalır',
  )
  assert.deepEqual(
    statusOf([], [{ ...day, archived: true }]),
    [['d1', 'needs_correction', true]],
    'arşivlenen yoklama',
  )
  assert.deepEqual(
    eOzelAttendanceItems({
      names,
      lessonHours: [{ ...hour, status: 'present' }],
      days: [{ ...day, status: 'present' }],
    }),
    [],
    'işaretsiz kaynak devamsızlık değilse satır üretmez',
  )
  const removed = applyEOzelMarks(
    eOzelAttendanceItems({ names, lessonHours: [], days: [{ ...day, status: 'present' }], marked }),
    marks,
    digest,
  )[0]
  assert.equal(eOzelChangeNote(removed as EOzelItem), 'Yoklama düzeltildi, devamsızlık kalktı')
  const changed = applyEOzelMarks(
    eOzelAttendanceItems({ names, lessonHours: [], days: [{ ...day, status: 'excused' }], marked }),
    marks,
    digest,
  )[0]
  assert.equal(eOzelChangeNote(changed as EOzelItem), 'Yoklama bilgisi değişti')
})

test('IST-085 DOM-DIL-070: kur sonu satırı kayda bağlıdır, onaylı düzeltme sonucu değiştirince düzeltilmeli olur', () => {
  const decision = {
    enrollmentId: 'e1',
    learnerId: 's1',
    outcome: 'repeat' as const,
    decidedAt: '2026-10-01T09:00:00.000Z',
    reviewedAt: null,
    groupName: 'B1',
    courseName: 'Genel',
    certificateNumber: null,
  }
  const names = new Map([['s1', 'Deniz']])
  const first = eOzelCourseEndItems({ names, decisions: [decision] })
  assert.equal(first[0]?.sourceId, 'e1')
  const marks = markAs(first[0] as EOzelItem)
  const same = eOzelCourseEndItems({
    names,
    decisions: [{ ...decision, certificateNumber: 'B-77' }],
  })
  assert.equal(
    applyEOzelMarks(same, marks, digest)[0]?.recordStatus,
    'recorded',
    'belge numarası düzeltme istemez',
  )
  const corrected = eOzelCourseEndItems({
    names,
    decisions: [{ ...decision, outcome: 'passed' }],
  })
  const [row] = applyEOzelMarks(corrected, marks, digest)
  assert.equal(row?.recordStatus, 'needs_correction')
  assert.equal(row?.sourceRemoved, false)
  assert.equal(eOzelChangeNote(row as EOzelItem), 'Kur sonu kararı değişti')
})

test('DOM-DIL-070: kurs sonu satırı kararı ve varsa MEBBİS belge numarasını gösterir', () => {
  const [row] = eOzelCourseEndItems({
    names: new Map([['s1', 'Deniz Yılmaz']]),
    decisions: [
      {
        enrollmentId: 'e1',
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

test('IST-085: varsayılan süzgeç düzeltilmeli satırı da verir; ayrı süzgeçle yalnız o seçilir, işlendi süzgecine girmez', () => {
  const pending = learnerItem('Şule Öztürk', 's1')
  const correction: EOzelItem = {
    ...learnerItem('Ali Çelik', 's2'),
    recordedAt: '2026-10-05T09:00:00.000Z',
    recordedByUserId: 'u1',
    recordStatus: 'needs_correction',
  }
  const recorded: EOzelItem = {
    ...learnerItem('Can Er', 's3'),
    recordedAt: '2026-10-05T09:00:00.000Z',
    recordedByUserId: 'u1',
    recordStatus: 'recorded',
  }
  const ids = (status?: 'needs_correction' | 'recorded' | 'all') =>
    selectEOzelItems([pending, correction, recorded], status ? { status } : {}).map(
      (item) => item.sourceId,
    )
  assert.deepEqual(ids(), ['s2', 's1'])
  assert.deepEqual(ids('needs_correction'), ['s2'])
  assert.deepEqual(ids('recorded'), ['s3'])
  assert.equal(ids('all').length, 3)
  assert.equal(eOzelFilterSchema.parse({ status: 'needs_correction' }).status, 'needs_correction')
})

test('IST-085: varsayılan süzgeç işlenmemişleri verir; tür, durum, gün ve arama süzer', () => {
  const pending = learnerItem('Şule Öztürk', 's1')
  const recorded: EOzelItem = {
    ...learnerItem('Ali Çelik', 's2'),
    recordedAt: '2026-10-05T09:00:00.000Z',
    recordedByUserId: 'u1',
    recordStatus: 'recorded',
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

test('IST-085: düzeltilmeli satır yeniden işaretlenir; kaynağı kalkmış satırın işareti kaldırılamaz', () => {
  const live = { recordStatus: 'needs_correction', sourceRemoved: false } as const
  const removed = { recordStatus: 'needs_correction', sourceRemoved: true } as const
  assert.deepEqual(planEOzelMark({ recorded: true, current: live }), { recorded: true })
  assert.deepEqual(planEOzelMark({ recorded: false, current: live }), { recorded: false })
  assert.deepEqual(planEOzelMark({ recorded: true, current: removed }), { recorded: true })
  const sourceRemoved = (error: unknown) =>
    error instanceof DomainError &&
    error.code === 'e_ozel_source_removed' &&
    error.kind === 'conflict'
  assert.throws(() => planEOzelMark({ recorded: false, current: removed }), sourceRemoved)
  assert.throws(
    () =>
      planEOzelMark({
        recorded: false,
        current: { recordStatus: 'recorded', sourceRemoved: true },
      }),
    sourceRemoved,
    'düzeltmesi yapılmış satır da açılmaz',
  )
})

test('IST-085: işlenmiş satır yeniden işlenmez, işlenmemiş satırın işareti kaldırılmaz', () => {
  const fresh = { recordStatus: 'pending', sourceRemoved: false } as const
  const done = { recordStatus: 'recorded', sourceRemoved: false } as const
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

test('IST-085: CSV düzeltilmeli durumu ve kaynakta ne değiştiğini gösterir', () => {
  const [fee] = eOzelFeeItems([
    payment({
      mebbisRecordedAt: '2026-10-06T09:00:00.000Z',
      mebbisRecordedByUserId: 'u1',
      reversedAt: '2026-10-07T09:00:00.000Z',
    }),
  ])
  const [row] = applyEOzelMarks([fee as EOzelItem], new Map(), digest)
  const csv = eOzelCsv([row as EOzelItem])
  assert.ok(csv.includes('"Kaynakta değişiklik"'))
  assert.ok(csv.includes(`"e-Özel'de düzeltilmeli"`))
  assert.ok(csv.includes('"Tahsilat iptal edildi"'))
  const [header, line] = csv.split('\r\n')
  assert.equal(line?.split(';').length, header?.split(';').length)
})

test('IST-085: değişikliği olmayan satırda açıklama yoktur; her tür kendi metnini verir', () => {
  const current = { recordStatus: 'recorded', sourceRemoved: false } as const
  for (const kind of ['learner', 'fee', 'attendance', 'course_end'] as const)
    assert.equal(eOzelChangeNote({ kind, ...current }), null)
  assert.equal(
    eOzelChangeNote({ kind: 'fee', recordStatus: 'needs_correction', sourceRemoved: false }),
    'Tahsilat bilgisi değişti',
  )
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
        enrollmentId: 'e1',
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
