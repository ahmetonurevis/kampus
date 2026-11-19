import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import {
  applyConsentGrant,
  applyPaidActivityBulkJoin,
  applyWaitlistPromotions,
  bulkJoinStudents,
  compareRosterRows,
  paidActivityRosterCsv,
  planConsentSync,
  planConsentWithdrawal,
  planManualConsent,
  promotionCandidates,
  rosterConsentText,
  rosterStatusText,
  type RosterRow,
} from '../packages/school-core/src/lib/finance-paid-activity-participants.ts'
import {
  applyParticipationCancel,
  applyPaidActivityJoin,
  claimSeat,
  PAID_ACTIVITY_WAITLIST_MAX,
  paidActivitySchema,
  participationPaymentStatus,
  planPaidActivityUpdate,
  retainedOnCancel,
  type PaidActivityTerms,
} from '../packages/school-core/src/lib/finance-paid-activities.ts'
import { isDomainError } from './support/domain-error.ts'

// Gezi katılımcı yönetimi (DOM-FIN-112; ON-156; K-369…K-371): yedek listesi, veli izni, toplu
// katılım ve katılım listesi. Ücret ve iade kuralları DOM-FIN-098 testlerindedir.

const TODAY = '2026-10-06'
const SEED = createSeed(new Date(`${TODAY}T09:00:00.000Z`))
const C1 = SEED.students.filter((item) => item.classId === 'c1')
const [FIRST, SECOND] = C1
const FIRST_ID = FIRST?.id ?? ''
const SECOND_ID = SECOND?.id ?? ''

const terms = (overrides: Partial<PaidActivityTerms> = {}): PaidActivityTerms => ({
  status: 'open',
  name: 'Kapadokya gezisi',
  activityDate: '2026-10-20',
  feeCents: 150_000,
  joinDeadline: '2026-10-10',
  cancelDeadline: '2026-10-12',
  capacity: 2,
  lateRefundRule: 'percent',
  lateRefundPercent: 50,
  lateCostCents: null,
  ...overrides,
})

let serial = 0
const makeId = (prefix: string) => `${prefix}-test-${String(++serial)}`

function freshState() {
  return {
    students: SEED.students.map((item) => ({ ...item })),
    classes: SEED.classes.map((item) => ({ ...item })),
    invoices: SEED.invoices.map((item) => ({ ...item })),
  }
}

const counts = (seatCount: number, waitlistCount = 0, nextWaitlistPosition = 1) => ({
  seatCount,
  waitlistCount,
  nextWaitlistPosition,
})

test('DOM-FIN-112, K-369: kontenjan doluysa katılım yedek sıra numarasıyla yazılır, taksit açılmaz', () => {
  const state = freshState()
  const before = state.invoices.length
  const plan = applyPaidActivityJoin(
    state,
    terms({ capacity: 1 }),
    { studentId: FIRST_ID },
    {
      today: TODAY,
      activeStudentIds: new Set(['s-asil']),
      counts: counts(1, 2, 7),
      makeId,
    },
  )
  assert.deepEqual(
    { ...plan },
    {
      studentId: FIRST_ID,
      status: 'waitlisted',
      consentStatus: 'not_required',
      invoiceId: null,
      feeCents: 150_000,
      waitlistPosition: 7,
    },
  )
  assert.equal(state.invoices.length, before)
  // Yedek listesi doluysa 409; State değişmez.
  assert.throws(
    () =>
      applyPaidActivityJoin(
        state,
        terms({ capacity: 1 }),
        { studentId: SECOND_ID },
        {
          today: TODAY,
          activeStudentIds: new Set(),
          counts: counts(1, PAID_ACTIVITY_WAITLIST_MAX, 900),
          makeId,
        },
      ),
    isDomainError('paid_activity_waitlist_full', 'conflict'),
  )
  assert.equal(state.invoices.length, before)
})

test('DOM-FIN-112, K-370: veli izni isteyen etkinlikte asil izin bekler, taksit açılmaz', () => {
  const state = freshState()
  const before = state.invoices.length
  const plan = applyPaidActivityJoin(
    state,
    terms({ requiresConsent: true }),
    { studentId: FIRST_ID },
    { today: TODAY, activeStudentIds: new Set(), counts: counts(0), makeId },
  )
  assert.equal(plan.status, 'awaiting_consent')
  assert.equal(plan.consentStatus, 'pending')
  assert.equal(plan.invoiceId, null)
  assert.equal(state.invoices.length, before)
  // İzin bekleyen yer tutar: sayaç yerinde artar.
  const seats = counts(1)
  assert.deepEqual(claimSeat({ capacity: 2, requiresConsent: true }, seats), {
    status: 'awaiting_consent',
    waitlistPosition: null,
  })
  assert.equal(seats.seatCount, 2)
  assert.deepEqual(claimSeat({ capacity: 2 }, seats), { status: 'waitlisted', waitlistPosition: 1 })
})

test('DOM-FIN-112, K-370: izin formu yalnız izin isteyen etkinliğe bağlanır', () => {
  const input = {
    name: 'Müze',
    kind: 'trip',
    activityDate: '2026-10-20',
    feeCents: 1000,
    joinDeadline: '2026-10-10',
    cancelDeadline: '2026-10-10',
    capacity: 2,
    lateRefundRule: 'percent',
    lateRefundPercent: 0,
    lateCostCents: null,
  }
  const parsed = paidActivitySchema.parse(input)
  assert.equal(parsed.requiresConsent, false)
  assert.equal(parsed.permissionFormId, null)
  assert.deepEqual(
    paidActivitySchema
      .safeParse({ ...input, permissionFormId: 'form-1' })
      .error?.issues.map((issue) => issue.path.join('.')),
    ['permissionFormId'],
  )
  assert.equal(
    paidActivitySchema.parse({ ...input, requiresConsent: true, permissionFormId: 'form-1' })
      .permissionFormId,
    'form-1',
  )
  const activity = { ...terms(), externalRef: null }
  assert.throws(
    () => planPaidActivityUpdate(activity, { permissionFormId: 'form-1' }, { activeCount: 0 }),
    isDomainError('paid_activity_consent_not_required'),
  )
  const linked = planPaidActivityUpdate(
    { ...activity, requiresConsent: true, permissionFormId: null },
    { permissionFormId: 'form-1' },
    { activeCount: 0 },
  )
  assert.deepEqual(linked.changed, ['permissionFormId'])
  assert.throws(
    () =>
      planPaidActivityUpdate(
        { ...activity, requiresConsent: true, permissionFormId: 'form-1' },
        { permissionFormId: 'form-1' },
        { activeCount: 0 },
      ),
    isDomainError('paid_activity_unchanged'),
  )
})

test('DOM-FIN-112, K-369: yer açılınca en küçük numaralı yedek asile geçer, taksiti o anda açılır', () => {
  const waitlisted = [
    { id: 'p3', studentId: SECOND_ID, waitlistPosition: 3, consentStatus: 'not_required' as const },
    { id: 'p2', studentId: FIRST_ID, waitlistPosition: 2, consentStatus: 'not_required' as const },
  ]
  // Son katılım günü geçtiyse vade bugündür.
  const today = '2026-10-15'
  const state = freshState()
  const promotions = applyWaitlistPromotions(
    state,
    terms(),
    { seatCount: 1, waitlisted },
    { today, makeId },
  )
  assert.equal(promotions.length, 1)
  assert.equal(promotions[0]?.participantId, 'p2')
  assert.equal(promotions[0]?.status, 'active')
  const invoice = state.invoices.find((item) => item.id === promotions[0]?.invoiceId)
  assert.equal(invoice?.dueDate, `${today}T09:00:00.000Z`)
  assert.equal(invoice?.studentId, FIRST_ID)
  assert.equal(invoice?.feeKind, 'activity')
  // İzin bekleyen yedek izin bekleyen asil olur, taksit açılmaz; izinli yedeğin taksiti açılır.
  const consented = applyWaitlistPromotions(
    freshState(),
    terms({ requiresConsent: true }),
    {
      seatCount: 0,
      waitlisted: [
        { ...waitlisted[1]!, consentStatus: 'pending' },
        { ...waitlisted[0]!, consentStatus: 'granted' },
      ],
    },
    { today: TODAY, makeId },
  )
  assert.deepEqual(
    consented.map((item) => [item.participantId, item.status, item.invoiceId === null]),
    [
      ['p2', 'awaiting_consent', true],
      ['p3', 'active', false],
    ],
  )
  // İptal edilmiş ya da günü geçmiş etkinlikte geçiş yok; yer yoksa yok.
  assert.deepEqual(
    promotionCandidates(terms({ status: 'cancelled' }), { seatCount: 0, waitlisted }, TODAY),
    [],
  )
  assert.deepEqual(promotionCandidates(terms(), { seatCount: 0, waitlisted }, '2026-10-21'), [])
  assert.deepEqual(promotionCandidates(terms(), { seatCount: 2, waitlisted }, TODAY), [])
})

test('K-396, DOM-FIN-112: etkin olmayan (ayrılmış) öğrencinin yedeği atlanır, sıradaki asile geçer', () => {
  const waitlisted = [
    {
      id: 'p2',
      studentId: FIRST_ID,
      waitlistPosition: 2,
      consentStatus: 'not_required' as const,
      studentActive: false,
    },
    {
      id: 'p3',
      studentId: SECOND_ID,
      waitlistPosition: 3,
      consentStatus: 'not_required' as const,
      studentActive: true,
    },
  ]
  const state = freshState()
  const promotions = applyWaitlistPromotions(
    state,
    terms(),
    { seatCount: 1, waitlisted },
    { today: TODAY, makeId },
  )
  assert.deepEqual(
    promotions.map((item) => [item.participantId, item.studentId]),
    [['p3', SECOND_ID]],
  )
  assert.ok(
    !state.invoices.some((item) => item.studentId === FIRST_ID && item.feeKind === 'activity'),
    'ayrılmış öğrenciye etkinlik taksiti açılmaz',
  )
  // Bilgi verilmeyen yedek etkin sayılır; yalnız etkin olmayanlar kalırsa geçiş olmaz.
  assert.deepEqual(
    promotionCandidates(terms(), { seatCount: 0, waitlisted: [waitlisted[0]!] }, TODAY),
    [],
  )
  assert.deepEqual(
    promotionCandidates(
      terms(),
      { seatCount: 1, waitlisted: [{ waitlistPosition: 4 }, { waitlistPosition: 5 }] },
      TODAY,
    ).map((item) => item.waitlistPosition),
    [4],
  )
})

test('DOM-FIN-112, K-369: taksiti olmayan katılım (yedek, izin bekleyen) parasız iptal edilir', () => {
  const state = freshState()
  const before = structuredClone(state.invoices)
  const plan = applyParticipationCancel(
    state,
    terms(),
    { studentId: FIRST_ID, status: 'waitlisted', invoiceId: null, feeCents: 150_000 },
    { today: '2026-10-15', kind: 'participant', allocated: new Map(), makeId },
  )
  assert.deepEqual(plan, {
    cancelKind: 'participant',
    cancelledDate: '2026-10-15',
    paidCents: 0,
    retainedCents: 0,
    refundCents: 0,
    closedInvoiceId: null,
    debtInvoiceId: null,
  })
  assert.deepEqual(state.invoices, before)
  // İznin geri çekilmesi katılımcı iptali gibi K-302 kuralıyla kesilir.
  assert.equal(retainedOnCancel(terms(), '2026-10-15', 'consent'), 75_000)
  assert.equal(participationPaymentStatus(0, 0, false), 'not_billed')
})

test('DOM-FIN-112, K-370: izin kaydı izin bekleyen asilin taksitini açar; kurallara uymayan reddedilir', () => {
  const state = freshState()
  const grant = planManualConsent({ channel: 'paper', grantorName: ' Ayşe Yılmaz ' })
  assert.deepEqual(grant, { channel: 'paper', grantorName: 'Ayşe Yılmaz' })
  const plan = applyConsentGrant(
    state,
    terms({ requiresConsent: true }),
    { studentId: FIRST_ID, status: 'awaiting_consent', consentStatus: 'pending' },
    grant,
    { today: '2026-10-12', makeId },
  )
  assert.equal(plan.status, 'active')
  const invoice = state.invoices.find((item) => item.id === plan.invoiceId)
  assert.equal(invoice?.amount, 150_000)
  assert.equal(invoice?.dueDate, '2026-10-12T09:00:00.000Z')
  const waiting = applyConsentGrant(
    freshState(),
    terms({ requiresConsent: true }),
    { studentId: FIRST_ID, status: 'waitlisted', consentStatus: 'pending' },
    { channel: 'permission_form', grantorName: null },
    { today: TODAY, makeId },
  )
  assert.deepEqual(
    { status: waiting.status, invoiceId: waiting.invoiceId },
    {
      status: 'waitlisted',
      invoiceId: null,
    },
  )
  const reject = (
    activity: PaidActivityTerms,
    participation: Parameters<typeof applyConsentGrant>[2],
    code: string,
    kind = 'rule',
    today = TODAY,
  ) => {
    const fresh = freshState()
    const before = structuredClone(fresh.invoices)
    assert.throws(
      () => applyConsentGrant(fresh, activity, participation, grant, { today, makeId }),
      isDomainError(code, kind),
    )
    assert.deepEqual(fresh.invoices, before)
  }
  const pending = {
    studentId: FIRST_ID,
    status: 'awaiting_consent',
    consentStatus: 'pending',
  } as const
  reject(terms(), pending, 'paid_activity_consent_not_required')
  reject(
    terms({ requiresConsent: true, status: 'cancelled' }),
    pending,
    'paid_activity_cancelled',
    'conflict',
  )
  reject(
    terms({ requiresConsent: true }),
    { ...pending, status: 'cancelled' },
    'paid_activity_participation_cancelled',
    'conflict',
  )
  reject(
    terms({ requiresConsent: true }),
    { ...pending, status: 'active', consentStatus: 'granted' },
    'paid_activity_consent_recorded',
    'conflict',
  )
  reject(
    terms({ requiresConsent: true }),
    pending,
    'paid_activity_consent_closed',
    'rule',
    '2026-10-21',
  )
  assert.throws(() => planManualConsent({ channel: 'permission_form', grantorName: 'Ayşe' }))
  assert.throws(() => planManualConsent({ channel: 'paper', grantorName: 'A' }))
  assert.deepEqual(
    planConsentWithdrawal(
      terms({ requiresConsent: true }),
      { status: 'active' },
      { channel: 'phone' },
    ),
    { channel: 'phone' },
  )
  assert.throws(
    () => planConsentWithdrawal(terms(), { status: 'active' }, { channel: 'phone' }),
    isDomainError('paid_activity_consent_not_required'),
  )
  assert.throws(() =>
    planConsentWithdrawal(terms({ requiresConsent: true }), { status: 'active' }, { channel: 'x' }),
  )
})

test('DOM-FIN-112, K-370: formdan eşitleme onaylananın iznini alır, reddedeni iptale çıkarır', () => {
  const row = (
    id: string,
    studentId: string,
    consentStatus: 'pending' | 'granted',
    consentChannel: 'permission_form' | 'paper' | null,
    status: 'active' | 'awaiting_consent' | 'waitlisted' | 'cancelled' = 'awaiting_consent',
  ) => ({ id, studentId, status, consentStatus, consentChannel })
  const participants = [
    row('a', 's-a', 'pending', null),
    row('b', 's-b', 'pending', null),
    row('c', 's-c', 'granted', 'permission_form', 'active'),
    row('d', 's-d', 'granted', 'paper', 'active'),
    row('e', 's-e', 'pending', null, 'cancelled'),
    row('f', 's-f', 'granted', 'permission_form', 'active'),
  ]
  const plan = planConsentSync(
    participants,
    new Map([
      ['s-a', 'approved'],
      ['s-b', 'rejected'],
      ['s-c', 'rejected'],
      ['s-d', 'rejected'],
      ['s-e', 'approved'],
      // Karar düşmüş (DOM-ILT-032): alınmış izin kendiliğinden geri alınmaz.
      ['s-f', 'pending'],
    ] as const),
  )
  assert.deepEqual(
    plan.grant.map((item) => item.id),
    ['a'],
  )
  assert.deepEqual(
    plan.withdraw.map((item) => item.id),
    ['b', 'c'],
  )
})

test('DOM-FIN-112, K-371: toplu katılım sınıfın etkin öğrencilerini ada göre yazar, aşan kısım yedek', () => {
  const state = freshState()
  const ids = bulkJoinStudents(state, { classIds: ['c1'] })
  assert.equal(ids.length, C1.length)
  const names = ids.map((id) => C1.find((item) => item.id === id)?.name ?? '')
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b, 'tr')),
  )
  const existing = ids[0] ?? ''
  const before = state.invoices.length
  const plan = applyPaidActivityBulkJoin(
    state,
    terms({ capacity: 4 }),
    { classIds: ['c1'] },
    {
      today: TODAY,
      activeStudentIds: new Set([existing]),
      counts: counts(1, 0, 1),
      makeId,
    },
  )
  assert.deepEqual(plan.skippedStudentIds, [existing])
  assert.equal(plan.joined.length, C1.length - 1)
  assert.deepEqual(
    plan.joined.map((item) => item.status),
    plan.joined.map((_, index) => (index < 3 ? 'active' : 'waitlisted')),
  )
  assert.deepEqual(
    plan.joined.filter((item) => item.status === 'waitlisted').map((item) => item.waitlistPosition),
    plan.joined.slice(3).map((_, index) => index + 1),
  )
  assert.equal(state.invoices.length, before + 3)

  const reject = (input: unknown, code: string, kind = 'rule', today = TODAY) => {
    const fresh = freshState()
    const snapshot = structuredClone(fresh.invoices)
    assert.throws(
      () =>
        applyPaidActivityBulkJoin(fresh, terms(), input, {
          today,
          activeStudentIds: new Set(),
          counts: counts(0),
          makeId,
          institutionType: 'language_school',
        }),
      isDomainError(code, kind),
    )
    assert.deepEqual(fresh.invoices, snapshot)
  }
  reject({ classIds: ['yok'] }, 'paid_activity_class_not_found')
  reject({ classIds: ['c1'] }, 'paid_activity_join_closed', 'rule', '2026-10-11')
  const empty = freshState()
  for (const student of empty.students)
    if (student.classId === 'c2') Object.assign(student, { isActive: false })
  assert.throws(
    () => bulkJoinStudents(empty, { classIds: ['c2'] }),
    isDomainError('paid_activity_bulk_empty'),
  )
  assert.throws(() => bulkJoinStudents(freshState(), { classIds: [] }))
  assert.throws(() => bulkJoinStudents(freshState(), { classIds: ['c1', 'c1'] }))
  // Yedek listesi dolarsa hiçbiri yazılmaz.
  const full = freshState()
  const snapshot = structuredClone(full.invoices)
  assert.throws(
    () =>
      applyPaidActivityBulkJoin(
        full,
        terms({ capacity: 1 }),
        { classIds: ['c1'] },
        {
          today: TODAY,
          activeStudentIds: new Set(),
          counts: counts(0, PAID_ACTIVITY_WAITLIST_MAX - 1, 10),
          makeId,
        },
      ),
    isDomainError('paid_activity_waitlist_full', 'conflict'),
  )
  assert.deepEqual(full.invoices, snapshot)
})

test('DOM-FIN-112, K-371: katılım listesi CSV sırası, maskeli telefon ve formül kaçışı', () => {
  const base: RosterRow = {
    studentName: 'Deniz Yılmaz',
    className: '7-A',
    guardianPhoneMasked: '0532 *** ** 12',
    status: 'active',
    waitlistRank: null,
    consentStatus: 'granted',
    consentChannel: 'paper',
    paymentStatus: 'partial',
    amountCents: 150_000,
    collectedCents: 50_000,
  }
  const rows: RosterRow[] = [
    {
      ...base,
      studentName: 'Zeynep',
      status: 'waitlisted',
      waitlistRank: 2,
      paymentStatus: 'not_billed',
      amountCents: 0,
      collectedCents: 0,
    },
    {
      ...base,
      studentName: '=HYPERLINK("x")',
      status: 'awaiting_consent',
      consentStatus: 'pending',
      consentChannel: null,
    },
    { ...base, studentName: 'Ali', status: 'waitlisted', waitlistRank: 1 },
    base,
  ]
  const sorted = [...rows].sort(compareRosterRows).map((row) => row.studentName)
  assert.deepEqual(sorted, ['=HYPERLINK("x")', 'Deniz Yılmaz', 'Ali', 'Zeynep'])
  const csv = paidActivityRosterCsv(rows)
  const lines = csv.trimEnd().split('\r\n')
  assert.equal(lines.length, 5)
  assert.equal(
    lines[0],
    '"Sıra";"Öğrenci";"Sınıf";"Veli telefonu";"Katılım";"Veli izni";"Ödeme";"Tutar";"Alınan"',
  )
  assert.ok(
    lines[1]?.startsWith(
      `1;"'=HYPERLINK(""x"")";"7-A";"0532 *** ** 12";"İzin bekliyor";"İzin bekleniyor"`,
    ),
  )
  assert.equal(
    lines[2],
    '2;"Deniz Yılmaz";"7-A";"0532 *** ** 12";"Asil";"İzin alındı · Kâğıt izin dilekçesi";"Kısmi";1500,00;500,00',
  )
  assert.ok(lines[3]?.includes('"Yedek 1"'))
  assert.ok(lines[4]?.includes('"Yedek 2"') && lines[4].includes('"Taksit yok"'))
  assert.equal(rosterStatusText({ status: 'waitlisted', waitlistRank: null }), 'Yedek')
  assert.equal(
    rosterConsentText({ consentStatus: 'not_required', consentChannel: null }),
    'İzin gerekmiyor',
  )
})
