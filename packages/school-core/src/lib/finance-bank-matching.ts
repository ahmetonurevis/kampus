import { z } from 'zod'

import { requiredText } from './domain.ts'
import { DomainError } from './errors.ts'
import { foldStatementText } from './finance-bank-statement.ts'

/**
 * Banka hareketi eşleştirme önerisi (IST-115, ON-099; docs/domain/finans.md DOM-FIN-069). Gelen
 * havale/EFT açıklamasındaki öğrenci numarası, T.C. kimlik no (tamamı ya da son haneleri), sözleşme
 * kimliği, öğrenci ve veli adı ile tutarın açık taksite uyumu puanlanır; adaylar sıralı ve güven
 * düzeyiyle döner (K-108). Öneri hiçbir zaman kendiliğinden tahsilat olmaz: yetkili onaylar, tahsilat
 * mevcut tahsilat kuralıyla (`planPayment`, DOM-FIN-030…032) yazılır.
 *
 * Saf modüldür: dizin (`bankMatchDirectory`) bir kez kurulur, hareket başına yalnız açıklamadaki
 * sözcük ve rakamlarla indeks aranır (satır başına tam tarama yok). Kimlik numarası dizinde tam
 * durur ama hiçbir çıktıya yazılmaz; yalnız gerekçe kodu (`national_id`) döner.
 */

/** Eşleştirmeyi yönetici yapar; muhasebe rolü açılınca (OG-110, DOM-FIN-057) listeye girer (K-105). */
export const BANK_MATCH_ROLES = ['yonetici'] as const

export const BANK_TRANSACTION_STATUSES = ['unmatched', 'matched', 'ignored'] as const
export type BankTransactionStatus = (typeof BANK_TRANSACTION_STATUSES)[number]
export const BANK_TRANSACTION_STATUS_LABELS = {
  unmatched: 'Eşleşmedi',
  matched: 'Eşleşti',
  ignored: 'Yoksayıldı',
} as const satisfies Record<BankTransactionStatus, string>

export const BANK_MATCH_CONFIDENCES = ['high', 'medium', 'low'] as const
export type BankMatchConfidence = (typeof BANK_MATCH_CONFIDENCES)[number]
export const BANK_MATCH_CONFIDENCE_LABELS = {
  high: 'Yüksek',
  medium: 'Orta',
  low: 'Düşük',
} as const satisfies Record<BankMatchConfidence, string>

export const BANK_MATCH_REASONS = [
  'national_id',
  'national_id_suffix',
  'student_number',
  'contract',
  'student_name',
  'guardian_name',
  'surname',
  'amount_exact',
  'amount_multiple',
  'amount_partial',
  'amount_over',
] as const
export type BankMatchReason = (typeof BANK_MATCH_REASONS)[number]
export const BANK_MATCH_REASON_LABELS = {
  national_id: 'T.C. kimlik no',
  national_id_suffix: 'Kimlik no son haneleri',
  student_number: 'Öğrenci numarası',
  contract: 'Sözleşme no',
  student_name: 'Öğrenci adı',
  guardian_name: 'Veli adı',
  surname: 'Soyadı',
  amount_exact: 'Tutar taksite eşit',
  amount_multiple: 'Tutar birden çok taksite eşit',
  amount_partial: 'Kısmi ödeme',
  amount_over: 'Fazla ödeme',
} as const satisfies Record<BankMatchReason, string>

export const BANK_AMOUNT_FITS = ['exact', 'multiple', 'partial', 'over'] as const
export type BankAmountFit = (typeof BANK_AMOUNT_FITS)[number]

/** Puanlar (K-108); toplam 100'de kesilir. Kimlik sinyali yoksa öneri yalnız tutara dayanır. */
export const BANK_MATCH_POINTS = {
  national_id: 60,
  national_id_suffix_long: 45,
  national_id_suffix_short: 25,
  student_number: 50,
  contract: 50,
  student_name: 40,
  guardian_name: 30,
  surname: 10,
  amount_exact: 30,
  amount_multiple: 20,
  amount_partial: 5,
  amount_over: 5,
  amount_only: 30,
} as const
/** Yüksek güven: puan, kimlik sinyali ve ikinci öğrenciden fark. */
export const BANK_MATCH_HIGH_SCORE = 70
export const BANK_MATCH_HIGH_GAP = 15
export const BANK_MATCH_MEDIUM_SCORE = 40
export const BANK_MATCH_LIMIT = 5

const IDENTITY_REASONS: ReadonlySet<BankMatchReason> = new Set([
  'national_id',
  'national_id_suffix',
  'student_number',
  'contract',
  'student_name',
  'guardian_name',
])

// --- Gövde şemaları ---------------------------------------------------------------------------

/** Onay: hareket bu öğrencinin bu taksitine (önce o, artanı en eski vadeye) tahsil edilir. */
export const bankMatchSchema = z.strictObject({
  studentId: requiredText,
  invoiceId: requiredText,
})
export type BankMatchInput = z.input<typeof bankMatchSchema>

export const bankIgnoreSchema = z.strictObject({
  // kvkk: Ç — serbest metin; loglanmaz.
  ignoreReason: z
    .string()
    .trim()
    .min(3, 'Yoksayma gerekçesi en az 3 karakter olmalıdır.')
    .max(200, 'Yoksayma gerekçesi en fazla 200 karakter olabilir.'),
})
export type BankIgnoreInput = z.input<typeof bankIgnoreSchema>

// --- Durum geçişleri --------------------------------------------------------------------------

/** Yalnız eşleşmemiş gelen hareket eşleşir ya da yoksayılır; ikinci onay 409 (DOM-FIN-031). */
export function assertBankTransactionOpen(status: BankTransactionStatus): void {
  if (status === 'unmatched') return
  throw new DomainError(
    'bank_transaction_not_open',
    status === 'matched'
      ? 'Bu hareket zaten bir tahsilatla eşleşmiş.'
      : 'Bu hareket yoksayılmış; önce geri alın.',
    { kind: 'conflict' },
  )
}

/** Yoksayılan hareket geri alınır; eşleşme yalnız tahsilat iptaliyle açılır (K-111). */
export function assertBankTransactionIgnored(status: BankTransactionStatus): void {
  if (status === 'ignored') return
  throw new DomainError(
    'bank_transaction_not_ignored',
    status === 'matched'
      ? 'Eşleşmiş hareket tahsilat iptaliyle geri açılır.'
      : 'Bu hareket yoksayılmamış.',
    { kind: 'conflict' },
  )
}

/**
 * Tahsilatın işlem referansı (K-109): dosyadaki banka referansı; yoksa parmak izinden kurulan
 * `EKSTRE-…`. Referans kurumda tekildir (DOM-FIN-031): aynı havale elle de girilmişse onay 409
 * `payment_reference_used` alır.
 */
export function bankPaymentReference(transaction: {
  reference: string | null
  fingerprint: string
}): string {
  const reference = transaction.reference?.trim() ?? ''
  return reference.length >= 3
    ? reference.slice(0, 100)
    : `EKSTRE-${transaction.fingerprint.slice(0, 12).toUpperCase()}`
}

// --- Dizin ------------------------------------------------------------------------------------

export interface MatchStudentInput {
  id: string
  name: string
  number?: string | null | undefined
  // kvkk: Ç — yalnız dizinde karşılaştırılır, çıktıya yazılmaz.
  nationalId?: string | null | undefined
}
export interface MatchGuardianInput {
  name: string
  studentIds: readonly string[]
}
export interface MatchContractInput {
  id: string
  studentId: string
}
export interface MatchInvoiceInput {
  id: string
  studentId: string
  installment: number
  dueDate: string
  /** Kalan tutar (`openAmount`, DOM-FIN-030); sıfırsa taksit aday değildir. */
  openCents: number
}

interface DirectoryStudent {
  id: string
  name: string
  nameTokens: string[]
  surname: string
  nationalId: string | null
}

export interface BankMatchDirectory {
  students: ReadonlyMap<string, DirectoryStudent>
  openByStudent: ReadonlyMap<string, readonly MatchInvoiceInput[]>
  byNumber: ReadonlyMap<string, readonly string[]>
  byNationalId: ReadonlyMap<string, readonly string[]>
  /** Kimlik no son dört hanesi → öğrenciler. */
  byNationalSuffix: ReadonlyMap<string, readonly string[]>
  /** Ad sözcüğü → adında o sözcük geçen öğrenciler. */
  byNameToken: ReadonlyMap<string, readonly string[]>
  /** Veli adı sözcüğü → veli (sözcükler ve çocukları). */
  byGuardianToken: ReadonlyMap<string, readonly { tokens: string[]; studentIds: string[] }[]>
  /** Sıkıştırılmış sözleşme kimliğinin ilk 8 karakteri → sözleşmeler. */
  byContractPrefix: ReadonlyMap<string, readonly { compact: string; studentId: string }[]>
  /** Açık tutar → o tutarda açık taksitler (yalnız tutar eşleşmesi). */
  byOpenAmount: ReadonlyMap<number, readonly MatchInvoiceInput[]>
}

const CONTRACT_PREFIX = 8
const tokensOf = (value: string) =>
  foldStatementText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2)
const compactOf = (value: string) => foldStatementText(value).replace(/[^a-z0-9]/g, '')

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** Dizini bir kez kurar; açık taksiti olmayan öğrenci aday olmaz (tahsilat açık taksit ister). */
export function bankMatchDirectory(input: {
  students: readonly MatchStudentInput[]
  guardians: readonly MatchGuardianInput[]
  contracts: readonly MatchContractInput[]
  invoices: readonly MatchInvoiceInput[]
}): BankMatchDirectory {
  const openByStudent = new Map<string, MatchInvoiceInput[]>()
  const byOpenAmount = new Map<number, MatchInvoiceInput[]>()
  for (const invoice of input.invoices) {
    if (invoice.openCents <= 0) continue
    push(openByStudent, invoice.studentId, invoice)
    push(byOpenAmount, invoice.openCents, invoice)
  }
  const byDue = (a: MatchInvoiceInput, b: MatchInvoiceInput) =>
    a.dueDate.localeCompare(b.dueDate) || a.installment - b.installment
  for (const list of openByStudent.values()) list.sort(byDue)
  for (const list of byOpenAmount.values()) list.sort(byDue)

  const students = new Map<string, DirectoryStudent>()
  const byNumber = new Map<string, string[]>()
  const byNationalId = new Map<string, string[]>()
  const byNationalSuffix = new Map<string, string[]>()
  const byNameToken = new Map<string, string[]>()
  for (const student of input.students) {
    if (!openByStudent.has(student.id)) continue
    const nameTokens = tokensOf(student.name)
    const nationalId = student.nationalId?.replace(/\D/g, '') || null
    students.set(student.id, {
      id: student.id,
      name: student.name,
      nameTokens,
      surname: nameTokens.at(-1) ?? '',
      nationalId,
    })
    const number = student.number?.replace(/\D/g, '') ?? ''
    if (number.length >= 3) push(byNumber, number, student.id)
    if (nationalId !== null && nationalId.length >= 4) {
      push(byNationalId, nationalId, student.id)
      push(byNationalSuffix, nationalId.slice(-4), student.id)
    }
    for (const token of new Set(nameTokens)) push(byNameToken, token, student.id)
  }
  const byGuardianToken = new Map<string, { tokens: string[]; studentIds: string[] }[]>()
  for (const guardian of input.guardians) {
    const studentIds = guardian.studentIds.filter((id) => students.has(id))
    const tokens = tokensOf(guardian.name)
    if (studentIds.length === 0 || tokens.length < 2) continue
    const entry = { tokens, studentIds }
    for (const token of new Set(tokens)) push(byGuardianToken, token, entry)
  }
  const byContractPrefix = new Map<string, { compact: string; studentId: string }[]>()
  for (const contract of input.contracts) {
    const compact = compactOf(contract.id)
    if (compact.length < CONTRACT_PREFIX || !students.has(contract.studentId)) continue
    push(byContractPrefix, compact.slice(0, CONTRACT_PREFIX), {
      compact,
      studentId: contract.studentId,
    })
  }
  return {
    students,
    openByStudent,
    byNumber,
    byNationalId,
    byNationalSuffix,
    byNameToken,
    byGuardianToken,
    byContractPrefix,
    byOpenAmount,
  }
}

// --- Öneri ------------------------------------------------------------------------------------

export interface BankMatchSuggestion {
  studentId: string
  studentName: string
  invoiceId: string
  installment: number
  dueDate: string
  /** Önerilen taksitin kalanı. */
  openCents: number
  /** Öğrencinin bütün açık taksitlerinin kalanı. */
  studentOpenCents: number
  /** Açık taksitleri aşan, iade alacağı olacak kısım (DOM-FIN-030). */
  creditCents: number
  amountFit: BankAmountFit
  score: number
  confidence: BankMatchConfidence
  reasons: BankMatchReason[]
}

export interface BankMatchTransaction {
  amountCents: number
  description: string
  counterparty?: string | null | undefined
}

type Signals = { points: number; reasons: Set<BankMatchReason> }

function addSignal(
  found: Map<string, Signals>,
  studentId: string,
  reason: BankMatchReason,
  points: number,
) {
  const current = found.get(studentId) ?? { points: 0, reasons: new Set<BankMatchReason>() }
  if (current.reasons.has(reason)) return
  // Kimlik no tamamı varsa son hane sinyali ayrıca sayılmaz.
  if (reason === 'national_id_suffix' && current.reasons.has('national_id')) return
  current.reasons.add(reason)
  current.points += points
  found.set(studentId, current)
}

/** Açıklamadaki kimlik sinyalleri: öğrenci → puan ve gerekçe. */
function identitySignals(directory: BankMatchDirectory, text: string): Map<string, Signals> {
  const found = new Map<string, Signals>()
  const digitRuns = text.match(/\d+/g) ?? []
  for (const digits of new Set(digitRuns)) {
    for (const id of directory.byNationalId.get(digits) ?? [])
      addSignal(found, id, 'national_id', BANK_MATCH_POINTS.national_id)
    for (const id of directory.byNumber.get(digits) ?? [])
      addSignal(found, id, 'student_number', BANK_MATCH_POINTS.student_number)
    // Dört haneli 20xx açıklamada çoğunlukla yıldır ("EKIM 2026 TAKSIT"); son hane sayılmaz.
    const looksLikeYear = digits.length === 4 && digits.startsWith('20')
    if (digits.length >= 4 && digits.length <= 10 && !looksLikeYear)
      for (const id of directory.byNationalSuffix.get(digits.slice(-4)) ?? []) {
        const nationalId = directory.students.get(id)?.nationalId ?? ''
        if (!nationalId.endsWith(digits) || nationalId === digits) continue
        addSignal(
          found,
          id,
          'national_id_suffix',
          digits.length >= 6
            ? BANK_MATCH_POINTS.national_id_suffix_long
            : BANK_MATCH_POINTS.national_id_suffix_short,
        )
      }
  }
  const compact = compactOf(text)
  for (let at = 0; at + CONTRACT_PREFIX <= compact.length; at += 1)
    for (const contract of directory.byContractPrefix.get(
      compact.slice(at, at + CONTRACT_PREFIX),
    ) ?? [])
      if (compact.startsWith(contract.compact, at))
        addSignal(found, contract.studentId, 'contract', BANK_MATCH_POINTS.contract)
  const tokens = new Set(tokensOf(text))
  for (const token of tokens) {
    for (const id of directory.byNameToken.get(token) ?? []) {
      const student = directory.students.get(id)
      if (student && student.nameTokens.every((part) => tokens.has(part)))
        addSignal(found, id, 'student_name', BANK_MATCH_POINTS.student_name)
    }
    for (const guardian of directory.byGuardianToken.get(token) ?? [])
      if (guardian.tokens.every((part) => tokens.has(part)))
        for (const id of guardian.studentIds)
          addSignal(found, id, 'guardian_name', BANK_MATCH_POINTS.guardian_name)
  }
  // Soyadı tek başına aday açmaz (kardeşler, akrabalar); yalnız var olan adayı güçlendirir.
  for (const [id, signals] of found) {
    const student = directory.students.get(id)
    if (student && !signals.reasons.has('student_name') && tokens.has(student.surname))
      addSignal(found, id, 'surname', BANK_MATCH_POINTS.surname)
  }
  return found
}

/** Öğrencinin hangi taksiti önerilir ve tutar nasıl oturur. */
function invoiceFit(open: readonly MatchInvoiceInput[], amountCents: number) {
  const exact = open.find((invoice) => invoice.openCents === amountCents)
  const target = exact ?? open[0]
  if (target === undefined) return null
  const studentOpenCents = open.reduce((sum, invoice) => sum + invoice.openCents, 0)
  let fit: BankAmountFit
  if (exact) fit = 'exact'
  else if (amountCents < target.openCents) fit = 'partial'
  else {
    let running = 0
    fit = 'over'
    for (const invoice of open) {
      running += invoice.openCents
      if (running === amountCents) {
        fit = 'multiple'
        break
      }
      if (running > amountCents) break
    }
  }
  return {
    target,
    fit,
    studentOpenCents,
    creditCents: Math.max(amountCents - studentOpenCents, 0),
  }
}

const FIT_REASON = {
  exact: 'amount_exact',
  multiple: 'amount_multiple',
  partial: 'amount_partial',
  over: 'amount_over',
} as const satisfies Record<BankAmountFit, BankMatchReason>
const FIT_POINTS = {
  exact: BANK_MATCH_POINTS.amount_exact,
  multiple: BANK_MATCH_POINTS.amount_multiple,
  partial: BANK_MATCH_POINTS.amount_partial,
  over: BANK_MATCH_POINTS.amount_over,
} as const satisfies Record<BankAmountFit, number>

function suggestionFor(
  directory: BankMatchDirectory,
  studentId: string,
  amountCents: number,
  signals: Signals | null,
): (BankMatchSuggestion & { identity: boolean }) | null {
  const student = directory.students.get(studentId)
  const fitted = invoiceFit(directory.openByStudent.get(studentId) ?? [], amountCents)
  if (student === undefined || fitted === null) return null
  const reasons = [...(signals?.reasons ?? [])]
  const identity = reasons.some((reason) => IDENTITY_REASONS.has(reason))
  const points = identity
    ? (signals?.points ?? 0) + FIT_POINTS[fitted.fit]
    : BANK_MATCH_POINTS.amount_only
  reasons.push(FIT_REASON[fitted.fit])
  return {
    studentId,
    studentName: student.name,
    invoiceId: fitted.target.id,
    installment: fitted.target.installment,
    dueDate: fitted.target.dueDate.slice(0, 10),
    openCents: fitted.target.openCents,
    studentOpenCents: fitted.studentOpenCents,
    creditCents: fitted.creditCents,
    amountFit: fitted.fit,
    score: Math.min(points, 100),
    confidence: 'low',
    reasons: BANK_MATCH_REASONS.filter((reason) => reasons.includes(reason)),
    identity,
  }
}

/**
 * Hareket için sıralı öneriler (K-108). Kimlik sinyali olan öğrenciler adaydır; hiç yoksa açık
 * kalanı hareket tutarına eşit taksitler düşük güvenle önerilir. Öğrenci başına tek öneri: tutarı
 * eşit ilk açık taksit, yoksa en eski vadeli açık taksit. `onlyStudentId` verilirse yalnız o
 * öğrencinin önerisi döner (yetkili başka öğrenci seçti).
 */
export function suggestBankMatches(
  directory: BankMatchDirectory,
  transaction: BankMatchTransaction,
  options: { limit?: number; onlyStudentId?: string } = {},
): BankMatchSuggestion[] {
  const text = `${transaction.description} ${transaction.counterparty ?? ''}`
  const signals = identitySignals(directory, text)
  const limit = options.limit ?? BANK_MATCH_LIMIT
  let candidates: (BankMatchSuggestion & { identity: boolean })[]
  if (options.onlyStudentId !== undefined) {
    const one = suggestionFor(
      directory,
      options.onlyStudentId,
      transaction.amountCents,
      signals.get(options.onlyStudentId) ?? null,
    )
    candidates = one === null ? [] : [one]
  } else if (signals.size > 0) {
    candidates = [...signals].flatMap(
      ([id, found]) => suggestionFor(directory, id, transaction.amountCents, found) ?? [],
    )
  } else {
    const ids = [
      ...new Set(
        (directory.byOpenAmount.get(transaction.amountCents) ?? []).map((item) => item.studentId),
      ),
    ]
    candidates = ids.flatMap(
      (id) => suggestionFor(directory, id, transaction.amountCents, null) ?? [],
    )
  }
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.dueDate.localeCompare(b.dueDate) ||
      a.studentName.localeCompare(b.studentName, 'tr') ||
      a.studentId.localeCompare(b.studentId),
  )
  const [first, second] = candidates
  // Yüksek güven yalnız ilk adaya ve ikinci adaydan açıkça ayrıştığında verilir.
  const gap = second === undefined ? Infinity : (first?.score ?? 0) - second.score
  return candidates.slice(0, limit).map(({ identity, ...suggestion }, index) => {
    const confidence: BankMatchConfidence =
      identity &&
      index === 0 &&
      suggestion.score >= BANK_MATCH_HIGH_SCORE &&
      gap >= BANK_MATCH_HIGH_GAP
        ? 'high'
        : identity && suggestion.score >= BANK_MATCH_MEDIUM_SCORE
          ? 'medium'
          : 'low'
    return { ...suggestion, confidence }
  })
}
