import test from 'node:test'
import assert from 'node:assert/strict'
import { FINANCE_NOTIFICATION_TYPES } from '../packages/school-core/src/lib/finance-notifications.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  INSTALLMENT_DUE_SOON_DAYS,
  installmentReminders,
  manualInstallmentReminder,
  scanReminderKey,
} from '../packages/school-core/src/lib/installment-reminders.ts'
import {
  notificationAudiences,
  notificationEnabled,
  notificationSubject,
  notificationTitle,
} from '../packages/school-core/src/lib/notifications.ts'

/**
 * Vade ve gecikme hatırlatması kuralı (IST-109; docs/domain/finans.md DOM-FIN-034, DOM-FIN-035).
 * "Bugün" 2026-10-06 (Europe/Istanbul).
 */

const NOW = '2026-10-06T09:00:00.000Z'
const invoice = (id: string, dueDate: string, extra: Record<string, unknown> = {}) => ({
  id,
  studentId: 's1',
  amount: 10_000,
  paidAt: null,
  dueDate,
  ...extra,
})
const decide = (
  invoices: readonly unknown[],
  allocated: ReadonlyMap<string, number> = new Map(),
  now: string = NOW,
) => installmentReminders(invoices, allocated, now)

test('IST-109: vade öncesi hatırlatma yalnız pencerede, gecikme vade gününden sonraki ilk günden başlar', () => {
  assert.equal(INSTALLMENT_DUE_SOON_DAYS, 3)
  const { reminders, invalid } = decide([
    invoice('far', '2026-10-10T09:00:00.000Z'),
    invoice('edge', '2026-10-09T09:00:00.000Z'),
    invoice('today', '2026-10-06T09:00:00.000Z'),
    invoice('late', '2026-10-05T09:00:00.000Z'),
    invoice('old', '2025-01-01'),
  ])
  assert.equal(invalid, 0)
  assert.deepEqual(
    reminders.map((item) => [item.invoiceId, item.type, item.dedupeKey]),
    [
      ['edge', 'installment_due', 'edge:2026-10-09'],
      ['today', 'installment_due', 'today:2026-10-06'],
      ['late', 'installment_overdue', 'late:2026-10-05'],
      ['old', 'installment_overdue', 'old:2025-01-01'],
    ],
  )
})

test('IST-109: ödenmiş taksit hatırlatılmaz; kısmi ödenmiş taksit açıktır, dağıtımla kapanan hatırlatılmaz', () => {
  const due = '2026-10-07T09:00:00.000Z'
  const { reminders } = decide(
    [
      invoice('paid', due, { paidAt: NOW }),
      invoice('partial', due),
      invoice('settled', due),
      invoice('over', due),
    ],
    new Map([
      ['partial', 9_999],
      ['settled', 10_000],
      ['over', 12_000],
    ]),
  )
  assert.deepEqual(
    reminders.map((item) => item.invoiceId),
    ['partial'],
  )
})

test('DOM-FIN-034: vade günü Europe/Istanbul takvimiyle değerlendirilir', () => {
  // 21:30Z İstanbul'da ertesi gündür: 5 Ekim 21:30Z vade günü 6 Ekim, 6 Ekim için gecikmiş değildir.
  const at = decide([invoice('edge', '2026-10-05T21:30:00.000Z')]).reminders[0]
  assert.equal(at?.type, 'installment_due')
  assert.equal(at?.dedupeKey, 'edge:2026-10-06')
  // İstanbul'da 7 Ekim başladı (21:30Z), taksit artık gecikmiştir.
  const late = decide(
    [invoice('edge', '2026-10-05T21:30:00.000Z')],
    new Map(),
    '2026-10-06T21:30:00.000Z',
  )
  assert.equal(late.reminders[0]?.type, 'installment_overdue')
})

test('DOM-FIN-035: aynı taksit için bir günde en çok bir hatırlatma; vade öncesi ve gecikme kesişmez', () => {
  for (let offset = -5; offset <= 5; offset += 1) {
    const now = new Date(Date.parse(NOW) + offset * 86_400_000).toISOString()
    assert.ok(decide([invoice('one', NOW)], new Map(), now).reminders.length <= 1)
  }
})

test('IST-109: biçimi bozuk taksit taramayı durdurmaz, atlanır ve sayılır', () => {
  const { reminders, invalid } = decide([
    invoice('bad-date', 'dün'),
    { id: 'no-student', amount: 1, dueDate: NOW },
    invoice('no-amount', NOW, { amount: 'bin' }),
    null,
    invoice('good', NOW),
  ])
  assert.equal(invalid, 4)
  assert.deepEqual(
    reminders.map((item) => item.invoiceId),
    ['good'],
  )
})

test('DOM-ILT-023: finans bildirim verisi yalnız kimlik alır; başlıkta tutar ve vade yoktur', () => {
  for (const [type, spec] of Object.entries(FINANCE_NOTIFICATION_TYPES)) {
    assert.equal(spec.category, 'service', type)
    assert.equal(spec.topic, 'payment', type)
    assert.equal(spec.module, 'finance', type)
    assert.throws(() => notificationSubject(type, { amountCents: 100 }))
    assert.throws(() => notificationSubject(type, { iban: 'TR33', reference: 'R1' }))
    for (const title of Object.values(spec.titles))
      assert.doesNotMatch(title, /\d|₺|IBAN|referans/i, type)
  }
  const { subject } = notificationSubject('installment_overdue', { invoiceId: 'inv-1' })
  assert.deepEqual(subject, { type: 'invoices', id: 'inv-1' })
  assert.throws(() =>
    notificationSubject('installment_due', { invoiceId: 'inv-1', amountCents: 100 }),
  )
  assert.equal(
    notificationTitle({ kind: 'installment_overdue', audience: 'parent' }, 'Deniz Yılmaz'),
    'Deniz için taksit vadesi geçti.',
  )
})

test('IST-106, IST-110: tahsilat ve iade bildirimi yalnız kendi kimliğini taşır; tutar, referans ve IBAN reddedilir', () => {
  assert.deepEqual(notificationSubject('payment_received', { paymentId: 'pay-1' }).subject, {
    type: 'payments',
    id: 'pay-1',
  })
  assert.deepEqual(notificationSubject('refund_paid', { withdrawalId: 'wd-1' }).subject, {
    type: 'student_withdrawals',
    id: 'wd-1',
  })
  assert.throws(() =>
    notificationSubject('payment_received', { paymentId: 'pay-1', reference: 'R1' }),
  )
  assert.throws(() => notificationSubject('payment_received', { paymentId: 'pay-1', amount: 1 }))
  assert.throws(() => notificationSubject('refund_paid', { withdrawalId: 'wd-1', iban: 'TR33' }))
  assert.equal(
    notificationTitle({ kind: 'payment_received', audience: 'parent' }, 'Deniz Yılmaz'),
    'Deniz için ödeme alındı.',
  )
  assert.equal(
    notificationTitle({ kind: 'refund_paid', audience: 'student' }, 'Deniz'),
    'İaden ödendi.',
  )
})

test('DOM-FIN-052: 18 yaş altında veliye, yetişkin kursiyerde kendisine; finans ve iletişim modülü açıkken üretilir', () => {
  assert.deepEqual(notificationAudiences('installment_due', true), ['parent'])
  assert.deepEqual(notificationAudiences('installment_due', false), ['student'])
  assert.equal(notificationEnabled('installment_due', { finance: true, communication: true }), true)
  assert.equal(
    notificationEnabled('installment_due', { finance: false, communication: true }),
    false,
  )
  assert.equal(
    notificationEnabled('installment_due', { finance: true, communication: false }),
    false,
  )
})

const OVERDUE_DAY = '2026-10-05T09:00:00.000Z'
const manual = (
  extra: Record<string, unknown> = {},
  allocated: ReadonlyMap<string, number> = new Map(),
  scanSentAt: string | null = null,
) =>
  manualInstallmentReminder(
    { ...invoice('inv-a', OVERDUE_DAY), ...extra },
    allocated,
    NOW,
    scanSentAt,
  )
const rejectedWith = (code: string) => (error: unknown) =>
  error instanceof DomainError && error.code === code && error.kind === 'rule'

test('DOM-FIN-035, ON-113: gecikmiş taksitte elle hatırlatma gecikme bildirimi ve bugünün anahtarını verir', () => {
  assert.deepEqual(manual(), {
    reminder: {
      type: 'installment_overdue',
      invoiceId: 'inv-a',
      studentId: 's1',
      dedupeKey: 'inv-a:manual:2026-10-06',
    },
    reminderAt: NOW,
  })
})

test('DOM-FIN-035, ON-113: kısmi ödenmiş gecikmiş taksit hatırlatılır, tam ödenmiş 422', () => {
  assert.notEqual(manual({}, new Map([['inv-a', 4_000]])).reminder, null)
  assert.throws(
    () => manual({}, new Map([['inv-a', 10_000]])),
    rejectedWith('invoice_already_paid'),
  )
  assert.throws(() => manual({ paidAt: NOW }), rejectedWith('invoice_already_paid'))
})

test('DOM-FIN-035, ON-113: vadesi bugün ya da ileride olan taksit elle hatırlatılamaz (422)', () => {
  for (const dueDate of ['2026-10-06T20:59:00.000Z', '2026-10-20T09:00:00.000Z'])
    assert.throws(() => manual({ dueDate }), rejectedWith('invoice_not_overdue'))
})

test('DOM-FIN-035, ON-113: aynı gün ikinci elle hatırlatma ve taramanın gönderdiği gün bildirim yazmaz', () => {
  const earlier = '2026-10-06T06:00:00.000Z'
  assert.deepEqual(manual({ reminderAt: earlier }), { reminder: null, reminderAt: earlier })
  assert.deepEqual(manual({}, new Map(), earlier), { reminder: null, reminderAt: earlier })
})

test('DOM-FIN-035, ON-113: önceki gün hatırlatılan ya da taranan taksit bugün yeniden hatırlatılır', () => {
  const yesterday = '2026-10-05T06:00:00.000Z'
  assert.equal(manual({ reminderAt: yesterday }).reminderAt, NOW)
  assert.equal(manual({}, new Map(), yesterday).reminderAt, NOW)
})

test('DOM-FIN-035, ON-113: tarama bugün elle hatırlatılan taksiti atlar, ertesi gün gönderir', () => {
  const reminded = invoice('inv-a', OVERDUE_DAY, { reminderAt: '2026-10-06T07:00:00.000Z' })
  assert.deepEqual(decide([reminded]).reminders, [])
  const { reminders } = decide([reminded], new Map(), '2026-10-07T09:00:00.000Z')
  assert.deepEqual(reminders[0]?.dedupeKey, scanReminderKey({ id: 'inv-a', dueDate: OVERDUE_DAY }))
})
