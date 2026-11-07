// Veli finans görünümünün saf satırları (ON-078; IST-107, DOM-FIN-030, -033, -052, -054): bakiye
// özeti, seçili çocuğun taksitleri, tahsilatları (dekont numarasıyla) ve cari ekstresi. API yanıtı
// girer, ekran satırı çıkar; tutarlar kuruş girer ve `money()` ile yazılır, günler Europe/Istanbul
// (`dateLabel`). Bakiye ve ekstre sunucuda core `studentBalance`/`studentStatement` ile hesaplanır,
// burada yeniden hesaplanmaz. Kapsam (velayetli, kısıtsız ya da ödeyici veli) sunucudadır.
import type { operations } from '@kampus/api-client/schema.d.ts'
import { statementLineLabel } from '@kampus/school-core/lib/finance-statement.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { isOpeningImport, OPENING_IMPORT_METHOD } from '@kampus/school-core/lib/payments.ts'

import type { InvoiceRow } from './finance-model.ts'

type Json<O extends keyof operations> = operations[O] extends {
  responses: { 200: { content: { 'application/json': { data: infer D } } } }
}
  ? D
  : never

export type StudentBalanceView = Json<'getStudentBalance'>
export type StudentStatementView = Json<'getStudentStatement'>
export type StatementLineView = StudentStatementView['lines'][number]
export type FamilyPayment = Json<'listPayments'>[number]

export type FactRow = readonly [label: string, value: string]

const day = (value: string) => dateLabel(value, { year: 'numeric' })

/**
 * Bakiye özeti (`GET /finance/students/:id/balance`). Kısmi ödemede yalnız kalan kısım borçtur;
 * dosyadan aktarılan geçmiş ödeme borcu kapatır ama tahsilat değildir, ayrı satırda yazılır
 * (DOM-FIN-014). Gecikmiş taksit sayısı tutarın yanında durur.
 */
export function balanceSummaryRows(
  balance: Pick<
    StudentBalanceView,
    | 'totalCents'
    | 'paidCents'
    | 'openingImportCents'
    | 'openCents'
    | 'overdueCents'
    | 'overdueCount'
  >,
): FactRow[] {
  const opening = balance.openingImportCents
  return [
    ['Toplam eğitim bedeli', money(balance.totalCents)],
    ['Ödenen', money(balance.paidCents - opening)],
    ...(opening > 0 ? [['Açılış aktarımı', money(opening)] as const] : []),
    ['Kalan bakiye', money(balance.openCents)],
    [
      'Gecikmiş tutar',
      balance.overdueCount > 0
        ? `${money(balance.overdueCents)} · ${String(balance.overdueCount)} taksit`
        : money(balance.overdueCents),
    ],
  ]
}

/** Sıradaki açık taksit (bugün ya da sonrası); yoksa ödenmemiş taksit kalmamış ya da hepsi gecikmiştir. */
export function nextDueText(balance: Pick<StudentBalanceView, 'nextDue'>): string | null {
  const next = balance.nextDue
  return next ? `${day(next.date)} · ${money(next.amountCents)}` : null
}

/** Taksitin bugün açık kalan kısmı (kuruş): ödenmişte 0, kısmi ödemede kalan kısım. */
export function invoiceOpenCents(row: Pick<InvoiceRow, 'amount' | 'paidAt' | 'paidCents'>) {
  return row.paidAt ? 0 : Math.max(row.amount - row.paidCents, 0)
}

export type FamilyListItem = {
  title: string
  subtitle: string
  amount: string
  status: string
  /** Ekran okuyucu etiketi; dokununca ayrıntı açılır. */
  label: string
}

/** Seçili çocuğun taksit satırı; öğrenci adı yazılmaz (ödeyici velide boş gelir). */
export function familyInvoiceItem(row: InvoiceRow): FamilyListItem {
  const installment = `${String(row.installment)}. taksit`
  const open = invoiceOpenCents(row)
  const partial = !row.paidAt && row.paidCents > 0
  return {
    title: installment,
    subtitle: `Vade ${day(row.dueDate)}${partial ? ` · Kalan ${money(open)}` : ''}`,
    amount: money(row.amount),
    status: row.status,
    label: `${installment}, ${money(row.amount)}, ${row.status}, ayrıntıyı aç`,
  }
}

/** Taksit ayrıntısı: tutar, ödenen ve kalan kısım, vade, ödeme günü ve yöntemi. */
export function familyInvoiceFacts(row: InvoiceRow): FactRow[] {
  const opening = isOpeningImport(row)
  const paid = row.paidAt ? row.amount : Math.min(row.paidCents, row.amount)
  return [
    ['Taksit', `${String(row.installment)}. taksit`],
    ['Taksit tutarı', money(row.amount)],
    ['Ödenen', money(paid)],
    ['Kalan tutar', money(invoiceOpenCents(row))],
    ['Durum', row.status],
    ['Vade tarihi', day(row.dueDate)],
    [opening ? 'Ödeme tarihi' : 'Tahsilat tarihi', row.paidAt ? day(row.paidAt) : '—'],
    ['Ödeme yöntemi', row.paidAt ? (opening ? OPENING_IMPORT_METHOD : (row.method ?? '—')) : '—'],
  ]
}

/** Dekont numarası (yıl-sıra; DOM-FIN-050), ekstre satırı ve dekont belgesiyle aynı biçim. */
export const receiptNumber = (payment: Pick<FamilyPayment, 'receiptYear' | 'receiptNumber'>) =>
  `${String(payment.receiptYear)}-${String(payment.receiptNumber)}`

export const familyPaymentStatus = (payment: Pick<FamilyPayment, 'reversedAt'>) =>
  payment.reversedAt === null ? 'Geçerli' : 'İptal edildi'

/** Tahsilat (dekont) satırı. İptal edilen tahsilat silinmez, durumuyla listede kalır (DOM-FIN-033). */
export function familyPaymentItem(payment: FamilyPayment): FamilyListItem {
  const number = receiptNumber(payment)
  const status = familyPaymentStatus(payment)
  return {
    title: `Dekont ${number}`,
    subtitle: `${day(payment.paidAt)} · ${payment.method}`,
    amount: money(payment.amountCents),
    status,
    label: `${number} numaralı dekont, ${money(payment.amountCents)}, ${day(payment.paidAt)}, ${status}, ayrıntıyı aç`,
  }
}

/**
 * Tahsilat ayrıntısı. İptal gerekçesi ve MEBBİS bilgisi veliye dönmez (sunucu `null` verir), satırı
 * da yoktur. Taksite dağıtılmayan kısım iade alacağıdır.
 */
export function familyPaymentFacts(payment: FamilyPayment): FactRow[] {
  return [
    ['Dekont no', receiptNumber(payment)],
    ['Tutar', money(payment.amountCents)],
    ...(payment.creditCents > 0 ? [['İade alacağı', money(payment.creditCents)] as const] : []),
    ['Ödeme tarihi', day(payment.paidAt)],
    ['Yöntem', payment.method],
    ['İşlem referansı', payment.reference ?? '—'],
    ['Durum', familyPaymentStatus(payment)],
    ...(payment.reversedAt !== null ? [['İptal tarihi', day(payment.reversedAt)] as const] : []),
  ]
}

/** Tahsilat süzgeci: geçerli ya da iptal edilmiş; boş değer hepsidir. */
export const FAMILY_PAYMENT_FILTERS = [
  { value: 'valid', label: 'Geçerli' },
  { value: 'reversed', label: 'İptal edildi' },
] as const

export function filterFamilyPayments<P extends Pick<FamilyPayment, 'reversedAt'>>(
  payments: readonly P[],
  filter: string,
): P[] {
  if (filter === 'valid') return payments.filter((payment) => payment.reversedAt === null)
  if (filter === 'reversed') return payments.filter((payment) => payment.reversedAt !== null)
  return [...payments]
}

export type StatementItem = {
  key: string
  date: string
  label: string
  /** Satırın hareketi: "Borç 1.000,00 ₺" ya da "Alacak 500,00 ₺". */
  movement: string
  balance: string
}

const signed = (line: Pick<StatementLineView, 'debitCents' | 'creditCents'>) =>
  line.debitCents > 0
    ? `Borç ${money(line.debitCents)}`
    : line.creditCents > 0
      ? `Alacak ${money(line.creditCents)}`
      : '—'

/** Hesap hareketleri tarih sırasıyla, yürüyen bakiyeyle (web tablosu ve PDF ile aynı açıklama). */
export function statementItems(lines: readonly StatementLineView[]): StatementItem[] {
  return lines.map((line, index) => ({
    key: String(index),
    date: day(line.date),
    label: statementLineLabel(line),
    movement: signed(line),
    balance: money(line.balanceCents),
  }))
}

/** Ekstre toplamları: borç ve alacak toplamı, bugünkü kalan bakiye. */
export function statementTotalRows(
  statement: Pick<StudentStatementView, 'debitTotalCents' | 'creditTotalCents' | 'openCents'>,
): FactRow[] {
  return [
    ['Borç toplamı', money(statement.debitTotalCents)],
    ['Alacak toplamı', money(statement.creditTotalCents)],
    ['Kalan bakiye', money(statement.openCents)],
  ]
}

/** Ekstrenin açıklama notları (web `StudentStatementSection` ile aynı metin). */
export function statementNotes(
  statement: Pick<StudentStatementView, 'unappliedCents' | 'openingImportCents'>,
): string[] {
  const notes: string[] = []
  if (statement.unappliedCents > 0)
    notes.push(
      `Taksitlere dağıtılmayan ${money(statement.unappliedCents)} iade alacağıdır; kalan tutardan düşülmemiştir.`,
    )
  if (statement.openingImportCents > 0)
    notes.push(
      `Ödenen tutarın ${money(statement.openingImportCents)} kısmı açılış aktarımıdır: önceki kayıtlardan aktarılmıştır, Kampüs tahsilatı ve dekontu yoktur.`,
    )
  return notes
}
