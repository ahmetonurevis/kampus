import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { ApiError } from '../packages/api-client/src/errors.ts'
import { invoiceRow } from '../packages/react-shared/src/finance-model.ts'
import type { CollectionRow } from '../packages/react-shared/src/collections.ts'
import { ALREADY_PAID_MESSAGE } from '../packages/react-shared/src/use-payment-commands.ts'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import { EMPTY_LIST_STATE } from '../apps/mobile/src/api/list-state.ts'
import { FINANCE_STAFF_SCREEN } from '../apps/mobile/src/api/finance-screen.ts'
import {
  canOpenFinanceStaff,
  canReversePayment,
  checkPaymentForm,
  financeTotalRows,
  FUTURE_PAID_DATE_MESSAGE,
  invoiceFacts,
  invoiceListItem,
  invoiceListQuery,
  isReversedRange,
  mebbisActionLabel,
  NO_PAYMENT_FILTERS,
  openAmount,
  paymentCommandFailure,
  paymentFacts,
  paymentDuplicateKey,
  paymentFailure,
  paymentFormDefaults,
  paymentListItem,
  paymentListQuery,
  paymentMethodsFor,
  readPaymentFilters,
  reverseReasonError,
  writePaymentFilters,
  type PaymentFormInput,
  type PaymentRecord,
} from '../apps/mobile/src/api/finance-staff.ts'
import { screenRegistryIssues } from '../apps/mobile/src/api/pages.ts'
import { SCREEN_REGISTRY, type ScreenEntry } from '../apps/mobile/src/api/screen-registry.ts'

const seed = createSeed(new Date('2026-09-01T09:00:00Z'))
const open = seed.invoices.find((item) => !item.paidAt)!
const TODAY = '2026-09-10'
const rowOf = (record: State['invoices'][number]): CollectionRow<State['invoices'][number]> => ({
  id: record.id,
  version: 2,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
  archivedAt: null,
  record,
  joined: { studentName: 'Deniz Yılmaz', studentNumber: '101', className: '9-A' },
})
const invoice = invoiceRow(rowOf({ ...open, amount: 100_000, paidCents: 0 }), TODAY)
const form: PaymentFormInput = {
  amount: '1000,00',
  method: 'Banka havalesi',
  reference: 'DEK-1',
  paidDate: TODAY,
  bankAccountId: 'hesap-1',
}
const payment: PaymentRecord = {
  id: 'pay-1',
  studentId: 's1',
  studentName: 'Deniz Yılmaz',
  amountCents: 100_000,
  creditCents: 0,
  method: 'Banka havalesi',
  reference: 'DEK-1',
  paidAt: '2026-09-05T09:00:00.000Z',
  receiptYear: 2026,
  receiptNumber: 7,
  reversedAt: null,
  reversalReason: null,
  bankAccountLabel: 'Ziraat · 1234',
  mebbisRecordedAt: null,
  version: 4,
  allocations: [{ invoiceId: open.id, amountCents: 100_000 }],
}
const apiError = (status: number, code: string, message = 'Sunucu iletisi') =>
  new ApiError({ status, code, message })

describe('ON-123 mobil yönetici finans ve ön büro tahsilat takibi', () => {
  test('ON-123 ekran yalnız yönetici ve ön büroya, finans modülü açıkken açılır', () => {
    for (const role of ['yonetici', 'onburo'] as const) {
      assert.equal(canOpenFinanceStaff({ role, modules: {} }), true, role)
      assert.equal(canOpenFinanceStaff({ role, modules: { finance: false } }), false, role)
    }
    // Öğrenci ödemeleri telefonda gösterilmez; veli finansı ayrı ekrandır.
    for (const role of ['ogrenci', 'veli', 'ogretmen'] as const)
      assert.equal(canOpenFinanceStaff({ role, modules: {} }), false, role)
  })

  test('ON-123 kayıt satırı kurallara uyar: öğrenciye ödeme ekranı yok, iki rolde iki yol', () => {
    const entries: readonly ScreenEntry[] = [...SCREEN_REGISTRY, FINANCE_STAFF_SCREEN]
    // Satır kayda eklendiğinde aynı ekran iki kez sayılmasın.
    const unique = entries.filter(
      (entry, at) => entries.findIndex((item) => item.screen === entry.screen) === at,
    )
    assert.deepEqual(screenRegistryIssues(unique), [])
    assert.deepEqual(
      FINANCE_STAFF_SCREEN.pages.map((page) => `${page.role}/${page.path}`),
      ['yonetici/finans', 'onburo/tahsilat-takip'],
    )
    const leaked = screenRegistryIssues([
      {
        screen: 'FinanceStudent',
        getComponent: FINANCE_STAFF_SCREEN.getComponent,
        pages: [{ role: 'ogrenci', path: 'odemelerim' }],
      },
    ])
    assert.ok(leaked.some((issue) => /öğrenci ödemeleri/.test(issue)))
  })

  test('ON-123 kayıt satırı var olan ve varsayılan bileşen veren ekran dosyasını yükler', () => {
    const path = /require\('(\.\/screens\/[\w-]+\.tsx)'\)\.default/.exec(
      FINANCE_STAFF_SCREEN.getComponent.toString(),
    )?.[1]
    assert.ok(path)
    const url = new URL(`../apps/mobile/src/api/${path}`, import.meta.url)
    assert.ok(existsSync(url))
    assert.match(readFileSync(url, 'utf8'), /^export default function FinanceStaff\(/m)
  })

  test('DOM-FIN-030 toplamlar sunucudan gelen kuruşu yazar, istemcide hesaplanmaz', () => {
    const rows = financeTotalRows({
      totalCents: 300_000,
      paidCents: 100_000,
      remainingCents: 200_000,
      overdueCents: 50_000,
    })
    assert.deepEqual(
      rows.map(([label]) => label),
      ['Toplam eğitim bedeli', 'Tahsil edilen', 'Kalan bakiye', 'Gecikmiş tutar'],
    )
    assert.match(rows[3]?.[1] ?? '', /500,00/)
  })

  test('DOM-FIN-014 açılış aktarımı tahsil edilen tutardan ayrı satırdır', () => {
    const rows = financeTotalRows({
      totalCents: 300_000,
      paidCents: 100_000,
      openingImportCents: 40_000,
      remainingCents: 200_000,
      overdueCents: 0,
    })
    assert.deepEqual(rows[1]?.[0], 'Tahsil edilen')
    assert.match(rows[1]?.[1] ?? '', /600,00/)
    assert.deepEqual(rows[2]?.[0], 'Açılış aktarımı')
    assert.match(rows[2]?.[1] ?? '', /400,00/)
  })

  test('ON-123 taksit sorgusu vadeye göre sıralar, durumu etiketle, aramayı iki harften süzer', () => {
    const base = { ...EMPTY_LIST_STATE, index: 2, search: 'x', filter: 'gecikmis' }
    assert.deepEqual(invoiceListQuery(base, 'x'), {
      page: 3,
      pageSize: 10,
      sort: ['dueDate', 'id'],
      filters: { status: 'Gecikmiş' },
    })
    assert.equal(invoiceListQuery({ ...base, filter: '' }, 'De').q, 'De')
    assert.equal(invoiceListQuery({ ...base, filter: 'uydurma' }, '').filters, undefined)
  })

  test('ON-123 taksit satırı ve ayrıntısı öğrenci, taksit ve tahsilat durumunu yazar', () => {
    const item = invoiceListItem(invoice)
    assert.equal(item.title, 'Deniz Yılmaz')
    assert.match(item.label, /ayrıntıyı aç$/)
    const facts = new Map(invoiceFacts(invoice))
    assert.equal(facts.get('Tahsilat tarihi'), 'Henüz tahsil edilmedi')
    assert.equal(facts.get('Okul numarası'), '101')
    assert.equal(facts.get('Ödeme yöntemi'), '—')
  })

  test('DOM-FIN-030 başlangıç tutarı taksitin kalanıdır, kalan eksiye düşmez', () => {
    const values = paymentFormDefaults(invoice, 25_000, false, [{ id: 'hesap-1' }], TODAY)
    assert.equal(values.amount, '750,00')
    assert.equal(values.method, 'Banka havalesi')
    assert.equal(values.bankAccountId, 'hesap-1')
    assert.equal(values.paidDate, TODAY)
    assert.equal(openAmount(invoice, 200_000), 0)
  })

  test('DOM-FIN-032 nakit yalnız kurum ayarı açıksa sunulur', () => {
    assert.equal(paymentMethodsFor(false).includes('Nakit'), false)
    assert.equal(paymentMethodsFor(true).includes('Nakit'), true)
    assert.ok(paymentMethodsFor(false).includes('Senet'))
  })

  test('DOM-FIN-032 form core şemasıyla denetlenir, geçerliyse web ile aynı gövde kurulur', () => {
    const check = checkPaymentForm(invoice, form, TODAY)
    assert.equal(check.ok, true)
    if (check.ok)
      assert.deepEqual(check.body, {
        studentId: invoice.studentId,
        invoiceId: invoice.id,
        amountCents: 100_000,
        method: 'Banka havalesi',
        reference: 'DEK-1',
        bankAccountId: 'hesap-1',
      })
  })

  test('DOM-FIN-032 referanssız banka ödemesi ve geçersiz tutar istek atmadan reddedilir', () => {
    const noReference = checkPaymentForm(invoice, { ...form, reference: '' }, TODAY)
    assert.equal(noReference.ok, false)
    if (!noReference.ok) assert.match(noReference.errors.reference ?? '', /referans/i)
    const badAmount = checkPaymentForm(invoice, { ...form, amount: 'on lira' }, TODAY)
    assert.equal(badAmount.ok, false)
    if (!badAmount.ok) assert.match(badAmount.errors.amount ?? '', /Tutarı/)
    const cash = checkPaymentForm(invoice, { ...form, method: 'Nakit', reference: '' }, TODAY)
    assert.equal(cash.ok, true)
  })

  test('DOM-FIN-032 ileri tarihli ödeme reddedilir; geçmiş gün gövdede gider', () => {
    const future = checkPaymentForm(invoice, { ...form, paidDate: '2026-09-11' }, TODAY)
    assert.equal(future.ok, false)
    if (!future.ok) assert.equal(future.errors.paidDate, FUTURE_PAID_DATE_MESSAGE)
    const past = checkPaymentForm(invoice, { ...form, paidDate: '2026-09-01' }, TODAY)
    assert.equal(past.ok, true)
    if (past.ok) assert.equal(past.body.paidDate, '2026-09-01')
  })

  test('DOM-FIN-030 mükerrer ödeme formu kapatır, kullanılmış referans alanda kalır', () => {
    const paid = paymentFailure(apiError(409, 'invoice_already_paid'))
    assert.equal(paid.alreadyPaid, true)
    assert.equal(paid.message, ALREADY_PAID_MESSAGE)
    assert.equal(paid.uncertain, false)
    const used = paymentFailure(apiError(409, 'payment_reference_used'), {
      reference: 'Bu işlem referansı daha önce kaydedilmiş.',
    })
    assert.equal(used.alreadyPaid, false)
    assert.equal(used.errors.reference, 'Bu işlem referansı daha önce kaydedilmiş.')
    assert.equal(used.message, null)
  })

  test('DOM-FIN-069, K-121 olası mükerrer uyarıdır: mesaj korunur, form kilitlenmez; yöntem/tutar/gün değişince anahtar değişir (ON-332)', () => {
    const message =
      'Bu kişiye aynı gün aynı tutarda banka ekstresinden onaylanmış bir havale tahsilatı var.'
    const failure = paymentFailure(apiError(409, 'bank_match_possible_duplicate', message))
    assert.equal(failure.possibleDuplicate, true)
    assert.equal(failure.message, message)
    assert.equal(failure.uncertain, false)
    assert.equal(failure.alreadyPaid, false)
    assert.equal(paymentFailure(apiError(409, 'payment_reference_used')).possibleDuplicate, false)
    const values = {
      method: 'Banka havalesi' as const,
      amount: '24.500,00',
      paidDate: '2026-10-01',
    }
    const key = paymentDuplicateKey(values)
    assert.equal(paymentDuplicateKey({ ...values, amount: ' 24.500,00 ' }), key)
    assert.notEqual(paymentDuplicateKey({ ...values, amount: '100' }), key)
    assert.notEqual(paymentDuplicateKey({ ...values, method: 'Kredi kartı' }), key)
    assert.notEqual(paymentDuplicateKey({ ...values, paidDate: '2026-10-02' }), key)
  })

  test('DOM-FIN-030 ağ ve 5xx belirsizdir: form kilitlenir, tutar alanına yazılan hata eşlenir', () => {
    assert.equal(paymentFailure(apiError(503, 'server_error')).uncertain, true)
    assert.equal(paymentFailure(apiError(409, 'idempotency_in_progress')).uncertain, true)
    assert.equal(paymentFailure(apiError(422, 'validation_error')).uncertain, false)
    const failure = paymentFailure(apiError(422, 'validation_error'), {
      amountCents: 'Tutar sıfırdan büyük olmalıdır.',
      studentId: 'Öğrenci bulunamadı.',
    })
    assert.equal(failure.errors.amount, 'Tutar sıfırdan büyük olmalıdır.')
    // Formda karşılığı olmayan alan kaybolmaz, genel mesaj olur.
    assert.equal(failure.message, 'Öğrenci bulunamadı.')
  })

  test('ON-118 süzgeçler tek metne yazılır ve geri okunur; boşken metin boştur', () => {
    assert.equal(writePaymentFilters(NO_PAYMENT_FILTERS), '')
    assert.deepEqual(readPaymentFilters(''), NO_PAYMENT_FILTERS)
    const filters = {
      method: 'Kredi kartı' as const,
      mebbisPending: true,
      from: '2026-09-01',
      to: '2026-09-30',
    }
    assert.deepEqual(readPaymentFilters(writePaymentFilters(filters)), filters)
    assert.equal(readPaymentFilters('uydurma|x||').method, '')
  })

  test('ON-118 tahsilat sorgusu süzgeçleri gönderir, ters aralığı göndermez', () => {
    const filter = writePaymentFilters({
      method: 'Senet',
      mebbisPending: true,
      from: '2026-09-01',
      to: '2026-09-30',
    })
    assert.deepEqual(paymentListQuery({ ...EMPTY_LIST_STATE, index: 1, filter }, 'Ay'), {
      page: 2,
      pageSize: 10,
      q: 'Ay',
      mebbis: 'pending',
      method: 'Senet',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    })
    const reversed = { ...NO_PAYMENT_FILTERS, from: '2026-09-30', to: '2026-09-01' }
    assert.equal(isReversedRange(reversed), true)
    const query = paymentListQuery(
      { ...EMPTY_LIST_STATE, filter: writePaymentFilters(reversed) },
      'A',
    )
    assert.deepEqual(query, { page: 1, pageSize: 10 })
  })

  test('DOM-FIN-033 tahsilat iptalini yalnız yönetici görür, gerekçe core şemasıyla denetlenir', () => {
    assert.equal(canReversePayment('yonetici'), true)
    assert.equal(canReversePayment('onburo'), false)
    assert.match(reverseReasonError('kısa') ?? '', /en az 5/)
    assert.equal(reverseReasonError('Yanlış öğrenciye işlendi'), null)
  })

  test('DOM-FIN-033 iptal edilen tahsilat durumu ve gerekçesiyle kalır, MEBBİS satırı boşalır', () => {
    const reversed = {
      ...payment,
      reversedAt: '2026-09-06T09:00:00.000Z',
      reversalReason: 'Yanlış öğrenci',
      mebbisRecordedAt: '2026-09-05T10:00:00.000Z',
    }
    const facts = new Map(paymentFacts(reversed))
    assert.equal(facts.get('Durum'), 'İptal edildi')
    assert.equal(facts.get('İptal gerekçesi'), 'Yanlış öğrenci')
    assert.equal(facts.get('MEBBİS'), '—')
    assert.equal(paymentListItem(reversed).status, 'İptal edildi')
    assert.equal(new Map(paymentFacts(payment)).has('İptal tarihi'), false)
  })

  test('DOM-FIN-032 MEBBİS işareti takip amaçlıdır; düğme metni duruma göre değişir', () => {
    assert.match(mebbisActionLabel(payment), /işlendi/)
    assert.equal(
      mebbisActionLabel({ mebbisRecordedAt: '2026-09-05T10:00:00.000Z' }),
      'İşareti kaldır',
    )
    assert.equal(new Map(paymentFacts(payment)).get('MEBBİS'), 'İşlenmedi')
  })

  test('DOM-FIN-030 taksit aşımı iade alacağı satırı yalnız varsa görünür', () => {
    assert.equal(new Map(paymentFacts(payment)).has('İade alacağı'), false)
    assert.ok(new Map(paymentFacts({ ...payment, creditCents: 500 })).has('İade alacağı'))
  })

  test('DOM-FIN-033 iptal çakışması formu kapatır, belirsiz sonuç kapatmaz', () => {
    const conflict = paymentCommandFailure(apiError(409, 'version_conflict'))
    assert.equal(conflict.conflict, true)
    assert.match(conflict.message ?? '', /Liste güncellendi/)
    const uncertain = paymentCommandFailure(apiError(500, 'server_error'))
    assert.equal(uncertain.conflict, false)
    assert.equal(uncertain.uncertain, true)
    const inProgress = paymentCommandFailure(apiError(409, 'idempotency_in_progress'))
    assert.equal(inProgress.conflict, false)
  })

  test('ON-323, ON-123: taksit ve tahsilat listeleri tazelenirken önceki sayfa soluk ve meşgul, tazeleme duyurulur', () => {
    // Kayıt Yenileme ve veli taksit listesiyle (ON-321, ON-322) aynı karar ve gösterge.
    for (const [file, pending] of [
      ['finance-invoices.tsx', 'Taksitler güncelleniyor…'],
      ['finance-payments.tsx', 'Tahsilatlar güncelleniyor…'],
    ] as const) {
      const url = new URL(`../apps/mobile/src/api/screens/${file}`, import.meta.url)
      const source = readFileSync(url, 'utf8')
      assert.match(source, /const refreshing = listRefreshing\(list\)/, file)
      assert.match(source, /accessibilityState=\{\{ busy: refreshing \}\}/, file)
      assert.match(source, /opacity: refreshing \? /, file)
      assert.match(source, /accessibilityLiveRegion="polite"/, file)
      assert.ok(source.includes(`'${pending}'`), file)
    }
  })
})
