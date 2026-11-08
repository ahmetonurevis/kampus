import { createHash, randomUUID } from 'node:crypto'

import {
  assertBankTransactionIgnored,
  assertBankTransactionOpen,
  assertNoPossibleDuplicate,
  bankIgnoreSchema,
  bankMatchDirectory,
  bankMatchSchema,
  bankPaymentReference,
  suggestBankMatches,
  type BankMatchDirectory,
  type BankMatchSuggestion,
} from '@kampus/school-core/lib/finance-bank-matching.ts'
import {
  BANK_STATEMENT_MESSAGES,
  bankStatementImportSchema,
  bankTransactionKeys,
  maskStatementText,
  parseBankStatement,
  planBankStatementImport,
  type BankImportPlan,
  type ParsedBankStatement,
} from '@kampus/school-core/lib/finance-bank-statement.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { openAmount, type RecordPaymentInput } from '@kampus/school-core/lib/payments.ts'

import type { Database } from '../db/client.ts'
import {
  findBankTransaction,
  identityNumbersOf,
  insertBankTransactions,
  knownFingerprints,
  listBankTransactions,
  markBankTransactionIgnored,
  markBankTransactionMatched,
  matchedTwinCount,
  referencesInUse,
  restoreBankTransaction,
  type BankTransactionQuery,
  type StoredBankTransaction,
} from '../db/finance-bank-transactions.ts'
import { allocatedTotals, listBankAccounts, type StoredBankAccount } from '../db/payments.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import type { Issue } from '../errors.ts'
import { AppError, ConflictError, NotFoundError, RuleViolationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { decodeImportFile } from './enrollment-import-file.ts'
import {
  FINANCE_TABLE_STORES,
  mapOperationError,
  runCommand,
  runReadOnly,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { recordPaymentOperation, type PaymentView } from './payments.ts'

/**
 * Banka hareketi eşleştirme (IST-115, ON-099; docs/domain/finans.md DOM-FIN-069). Kural core
 * `lib/finance-bank-statement.ts` ve `lib/finance-bank-matching.ts`'tedir. Rol ve modül rotadadır
 * (`BANK_MATCH_ROLES`, modül `finance`).
 *
 * - İçe aktarma: dosya sunucuda metne çözülür, saklanmaz; önizleme yazmaz, onay kurum kilidi
 *   altında hesabı ve parmak izlerini yeniden okur, hatalı satır varsa hiçbir hareket yazılmaz.
 * - Öneri: okuma tek görüntüden (öğrenci, veli, sözleşme, taksit, dağılım, kimlik) dizin kurar.
 * - Onay: hareket kurum kilidi altında yeniden okunur; tahsilat mevcut tahsilat kuralıyla
 *   (`recordPaymentOperation`; yöntem banka havalesi, hareketin hesabı ve günü) yazılır, hareket aynı
 *   transaction'da `matched` olur. Öneri kendiliğinden tahsilat olmaz.
 *
 * Açıklama, referans, karşı taraf ve tutar loglanmaz; denetime alan adları ve sayılar yazılır.
 */

const ENTITY = 'bank_transactions'
const BANK_TRANSFER = 'Banka havalesi'

const fingerprintOf = (key: string) => createHash('sha256').update(key).digest('hex')

async function audit(
  tx: Database,
  ctx: ServiceContext,
  action: string,
  entity: { type: string; id: string },
  changes: { fields: string[]; counts?: Record<string, number> },
) {
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action,
    entityType: entity.type,
    entityId: entity.id,
    changes,
    createdAt: ctx.now,
  })
}

// --- İçe aktarma ------------------------------------------------------------------------------

function parse(text: string, columns: unknown, today: string): ParsedBankStatement {
  try {
    const input = bankStatementImportSchema.shape.columns.parse(columns)
    return parseBankStatement(text, { columns: input, today })
  } catch (error) {
    throw mapOperationError(error)
  }
}

/** Kurumun arşivlenmemiş hesabı; yoksa ya da başka kurumunsa 422 (tahsilattaki gibi). */
function accountOf(accounts: readonly StoredBankAccount[], id: string): StoredBankAccount {
  const account = accounts.find((item) => item.id === id)
  if (account === undefined)
    throw new RuleViolationError('bank_account_invalid', 'Seçilen banka hesabı kullanılamıyor.', {
      issues: [
        {
          path: ['bankAccountId'],
          code: 'bank_account_invalid',
          message: 'Seçilen banka hesabı kullanılamıyor.',
        },
      ],
    })
  return account
}

async function planImport(
  db: Database,
  ctx: ServiceContext,
  parsed: ParsedBankStatement,
  bankAccountId: string,
): Promise<BankImportPlan & { fingerprints: Map<number, string> }> {
  const account = accountOf(await listBankAccounts(db, ctx.institutionId), bankAccountId)
  // MT940 hesabı başka hesapsa hareketler yanlış hesaba yazılmasın.
  if (parsed.accountIban !== null && parsed.accountIban !== account.iban)
    throw new RuleViolationError(
      'bank_statement_account_mismatch',
      BANK_STATEMENT_MESSAGES.bank_statement_account_mismatch,
    )
  const keys = bankTransactionKeys(account.id, parsed.lines)
  const fingerprints = new Map([...keys].map(([line, key]) => [line, fingerprintOf(key)]))
  const known = await knownFingerprints(db, ctx.institutionId, account.id, [
    ...fingerprints.values(),
  ])
  const plan = planBankStatementImport(parsed.lines, keys, (key) => known.has(fingerprintOf(key)))
  return { ...plan, fingerprints }
}

function importBody(parsed: ParsedBankStatement, plan: BankImportPlan, dryRun: boolean) {
  return {
    data: {
      dryRun,
      format: parsed.format,
      headers: parsed.headers,
      columns: parsed.columns,
      rowCount: plan.rows.length,
      readyCount: plan.counts.ready,
      skippedCount: plan.counts.skipped,
      outgoingCount: plan.counts.outgoing,
      ignoredCount: plan.counts.ignored,
      invalidCount: plan.counts.invalid,
      totalCents: plan.totalCents,
      // Kişisel veri yalnız önizlemede, maskeli döner; onay yanıtı saklanır, satır taşımaz.
      rows: dryRun ? plan.rows : [],
    },
  }
}

const rowIssues = (plan: BankImportPlan): Issue[] =>
  plan.rows.flatMap((row) =>
    row.issues.map((item) => ({
      path: ['rows', row.line, ...(item.field === null ? [] : [item.field])],
      code: item.code,
      message: `${String(row.line)}. satır: ${item.message}`,
    })),
  )

/**
 * Önizleme 200 ve satırlar; onay 201 ve sayılar. Hatalı satır varsa onay 422
 * `bank_statement_invalid` ve hiçbir yazma. Daha önce aktarılmış hareket atlanır (K-107).
 */
export async function importBankStatement(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const body = bankStatementImportSchema.parse(input)
  const today = dayKey(ctx.now)
  const parsed = parse(await decodeImportFile(body.fileBase64), body.columns, today)

  if (body.dryRun) {
    const plan = await planImport(ctx.db, ctx, parsed, body.bankAccountId)
    return { statusCode: 200, body: importBody(parsed, plan, true), replayed: false }
  }

  const batchId = randomUUID()
  let response: ReturnType<typeof importBody> | null = null
  return runCommand(
    ctx,
    {
      action: 'bank_statement.import',
      collections: [],
      entity: { type: 'bank_statement_import', id: batchId },
      load: async (tx) => {
        const plan = await planImport(tx, ctx, parsed, body.bankAccountId)
        return {
          run: () => {
            if (plan.counts.invalid > 0)
              throw new AppError(
                422,
                'bank_statement_invalid',
                BANK_STATEMENT_MESSAGES.bank_statement_invalid,
                { issues: rowIssues(plan) },
              )
            return plan
          },
        }
      },
      after: async (tx, plan) => {
        response = importBody(parsed, plan, false)
        if (plan.transactions.length === 0) return
        await insertBankTransactions(tx, ctx.institutionId, {
          bankAccountId: body.bankAccountId,
          sourceFormat: parsed.format,
          importBatchId: batchId,
          importedByUserId: ctx.actor.userId,
          now: ctx.now,
          rows: plan.transactions.map((item) => ({
            id: randomUUID(),
            bookingDate: item.bookingDate,
            amountCents: item.amountCents,
            statementDescription: item.description,
            counterpartyName: item.counterparty,
            bankReference: item.reference,
            balanceCents: item.balanceCents,
            fingerprint: plan.fingerprints.get(item.line) ?? '',
            sourceLine: item.line,
          })),
        })
        await audit(
          tx,
          ctx,
          'bank_statement.import',
          { type: 'bank_statement_import', id: batchId },
          {
            fields: ['bankAccountId', 'bookingDate', 'amountCents', 'statementDescription'],
            counts: {
              rows: plan.rows.length,
              imported: plan.counts.ready,
              skipped: plan.counts.skipped,
              outgoing: plan.counts.outgoing,
            },
          },
        )
      },
    },
    () => {
      if (response === null) throw new Error('bank statement import produced no body')
      return { statusCode: 201, body: response }
    },
    idempotency,
  )
}

// --- Okuma ve öneri ---------------------------------------------------------------------------

export interface BankTransactionView {
  id: string
  bankAccountId: string
  bankAccountLabel: string
  bookingDate: string
  amountCents: number
  /** Maskeli açıklama (K-112). */
  description: string
  counterparty: string | null
  reference: string | null
  balanceCents: number | null
  sourceFormat: StoredBankTransaction['sourceFormat']
  status: StoredBankTransaction['status']
  paymentId: string | null
  payment: StoredBankTransaction['payment']
  /** Referans eşleşmemiş harekette başka bir tahsilatta kullanılmış (elle girilmiş olabilir). */
  referenceInUse: boolean
  matchedAt: string | null
  ignoredAt: string | null
  ignoreReason: string | null
  importedAt: string
  version: number
}

function transactionView(row: StoredBankTransaction, referenceInUse = false): BankTransactionView {
  return {
    id: row.id,
    bankAccountId: row.bankAccountId,
    bankAccountLabel: row.bankAccountLabel,
    bookingDate: row.bookingDate,
    amountCents: row.amountCents,
    description: maskStatementText(row.statementDescription),
    counterparty: row.counterpartyName === null ? null : maskStatementText(row.counterpartyName),
    // Referans sütununa gönderen IBAN'ı ya da kimlik no da yazılabilir (K-122).
    reference: row.bankReference === null ? null : maskStatementText(row.bankReference),
    balanceCents: row.balanceCents,
    sourceFormat: row.sourceFormat,
    status: row.status,
    paymentId: row.paymentId,
    payment: row.payment,
    referenceInUse,
    matchedAt: row.matchedAt?.toISOString() ?? null,
    ignoredAt: row.ignoredAt?.toISOString() ?? null,
    ignoreReason: row.ignoreReason,
    importedAt: row.createdAt.toISOString(),
    version: row.version,
  }
}

const textOf = (data: unknown, key: string): string | null => {
  if (typeof data !== 'object' || data === null) return null
  const value: unknown = (data as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null
}

/**
 * Eşleştirme dizini tek görüntüden kurulur (`runReadOnly`): öğrenciler, veliler, sözleşmeler,
 * taksitler, dağılımlar ve kimlik numaraları. `use` aynı görüntüde çalışır.
 */
function withDirectory<R>(
  ctx: ServiceContext,
  use: (tx: Database) => Promise<(directory: BankMatchDirectory) => R>,
): Promise<R> {
  return runReadOnly(ctx, {
    action: 'bank_transaction.suggest',
    collections: ['students', 'parents', 'contracts', 'invoices'],
    stores: FINANCE_TABLE_STORES,
    load: async (tx) => {
      const [allocated, identities] = [
        await allocatedTotals(tx, ctx.institutionId),
        await identityNumbersOf(tx, ctx.institutionId),
      ]
      // Dizin core State'inden kurulur; `use`'un okuduğu hareketler de aynı görüntüdendir.
      const finish = await use(tx)
      return { run: (state) => finish(buildDirectory(state, allocated, identities)) }
    },
  })
}

function buildDirectory(
  state: {
    students: readonly unknown[]
    parents: readonly unknown[]
    contracts: readonly { id: string; studentId: string }[]
    invoices: readonly {
      id: string
      studentId: string
      installment: number
      dueDate: string
      amount: number
      paidAt?: string | null
    }[]
  },
  allocated: ReadonlyMap<string, number>,
  identities: ReadonlyMap<string, string>,
): BankMatchDirectory {
  return bankMatchDirectory({
    students: state.students.flatMap((student) => {
      const id = textOf(student, 'id')
      const name = textOf(student, 'name')
      return id === null || name === null
        ? []
        : [{ id, name, number: textOf(student, 'number'), nationalId: identities.get(id) ?? null }]
    }),
    guardians: state.parents.flatMap((parent) => {
      const name = textOf(parent, 'name')
      const ids: unknown =
        typeof parent === 'object' && parent !== null
          ? (parent as Record<string, unknown>).studentIds
          : null
      return name === null || !Array.isArray(ids)
        ? []
        : [{ name, studentIds: ids.filter((id): id is string => typeof id === 'string') }]
    }),
    contracts: state.contracts.map((contract) => ({
      id: contract.id,
      studentId: contract.studentId,
    })),
    invoices: state.invoices.map((invoice) => ({
      id: invoice.id,
      studentId: invoice.studentId,
      installment: invoice.installment,
      dueDate: invoice.dueDate,
      openCents: openAmount(
        { id: invoice.id, amount: invoice.amount, paidAt: invoice.paidAt ?? null },
        allocated,
      ),
    })),
  })
}

/**
 * Hareket listesi; eşleşmemiş satırda en iyi öneri (`suggestion`) ve kullanılmış referans işareti.
 * Liste sayfalıdır; öneri yalnız sayfadaki hareketler için hesaplanır.
 */
export async function listBankTransactionsFor(
  ctx: ServiceContext,
  query: BankTransactionQuery,
): Promise<{
  items: (BankTransactionView & { suggestion: BankMatchSuggestion | null })[]
  total: number
}> {
  return withDirectory(ctx, async (tx) => {
    const { items, total } = await listBankTransactions(tx, ctx.institutionId, query)
    const open = items.filter((item) => item.status === 'unmatched')
    const used = await referencesInUse(
      tx,
      ctx.institutionId,
      open.flatMap((item) => (item.bankReference === null ? [] : [item.bankReference])),
    )
    return (directory) => ({
      total,
      items: items.map((item) => ({
        ...transactionView(
          item,
          item.status === 'unmatched' &&
            item.bankReference !== null &&
            used.has(item.bankReference),
        ),
        suggestion:
          item.status === 'unmatched'
            ? (suggestBankMatches(
                directory,
                {
                  amountCents: item.amountCents,
                  description: item.statementDescription,
                  counterparty: item.counterpartyName,
                },
                { limit: 1 },
              )[0] ?? null)
            : null,
      })),
    })
  })
}

/** Tek hareketin öneri listesi (en çok 5); `studentId` verilirse yalnız o öğrencinin taksiti. */
export async function bankTransactionSuggestionsFor(
  ctx: ServiceContext,
  transactionId: string,
  studentId: string | undefined,
): Promise<{ transaction: BankTransactionView; suggestions: BankMatchSuggestion[] }> {
  return withDirectory(ctx, async (tx) => {
    const row = await findBankTransaction(tx, ctx.institutionId, transactionId)
    if (row === null) throw new NotFoundError()
    const used =
      row.status === 'unmatched' && row.bankReference !== null
        ? await referencesInUse(tx, ctx.institutionId, [row.bankReference])
        : new Set<string>()
    return (directory) => ({
      transaction: transactionView(row, used.size > 0),
      suggestions:
        row.status === 'unmatched'
          ? suggestBankMatches(
              directory,
              {
                amountCents: row.amountCents,
                description: row.statementDescription,
                counterparty: row.counterpartyName,
              },
              studentId === undefined ? {} : { onlyStudentId: studentId },
            )
          : [],
    })
  })
}

// --- Komutlar ---------------------------------------------------------------------------------

/** Hareketi kurum kilidi altında okur; yoksa 404, sürüm tutmazsa 409. */
async function lockedTransaction(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
): Promise<StoredBankTransaction> {
  const row = await findBankTransaction(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  if (row.version !== expectedVersion) throw new ConflictError()
  return row
}

async function viewOf(tx: Database, ctx: ServiceContext, id: string) {
  const row = await findBankTransaction(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return transactionView(row)
}

/**
 * Öneriyi ya da seçilen taksiti onaylar (DOM-FIN-069): tahsilat hareketin tamamıyla, banka
 * havalesi yöntemiyle, hareketin hesabına ve gününe yazılır; önce seçilen taksit, artanı en eski
 * vade, açık taksitleri aşanı iade alacağı (DOM-FIN-030, K-110). Kapalı gün 422 (DOM-FIN-036).
 * Hareket aynı transaction'da `matched` olur; ikinci onay 409. Aynı hesap, gün ve tutarda aynı
 * öğrenciye eşleşmiş başka hareket varsa `confirmDuplicate` olmadan 409 (K-121). 201.
 */
export async function matchBankTransactionCommand(
  ctx: ServiceContext,
  transactionId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const body = bankMatchSchema.parse(input)
  // Tutar, gün, hesap ve referans değişmez; tahsilat girdisi kilitten önce okunabilir. Durum ve
  // sürüm kilit altında yeniden denetlenir.
  const before = await findBankTransaction(ctx.db, ctx.institutionId, transactionId)
  if (before === null) throw new NotFoundError()
  const payment: RecordPaymentInput = {
    studentId: body.studentId,
    invoiceId: body.invoiceId,
    amountCents: before.amountCents,
    method: BANK_TRANSFER,
    reference: bankPaymentReference({
      reference: before.bankReference,
      fingerprint: before.fingerprint,
    }),
    paidDate: before.bookingDate,
    bankAccountId: before.bankAccountId,
  }
  let result: { transaction: BankTransactionView; payment: PaymentView } | null = null
  const { request, view } = recordPaymentOperation(ctx, payment, {
    load: async (tx) => {
      const row = await lockedTransaction(tx, ctx, transactionId, expectedVersion)
      // Kurum kilidi altında: eşzamanlı ikinci onay birincinin eşleşmesini görür (K-121).
      const twins = await matchedTwinCount(tx, ctx.institutionId, {
        id: row.id,
        bankAccountId: row.bankAccountId,
        bookingDate: row.bookingDate,
        amountCents: row.amountCents,
        studentId: body.studentId,
      })
      return () => {
        assertBankTransactionOpen(row.status)
        assertNoPossibleDuplicate(twins, body.confirmDuplicate === true)
      }
    },
    after: async (tx, stored) => {
      const marked = await markBankTransactionMatched(tx, ctx.institutionId, {
        id: transactionId,
        expectedVersion,
        paymentId: stored.id,
        userId: ctx.actor.userId,
        now: ctx.now,
      })
      if (marked === null) throw new ConflictError()
      await audit(
        tx,
        ctx,
        'bank_transaction.match',
        { type: ENTITY, id: transactionId },
        { fields: ['status', 'paymentId', 'matchedAt'] },
      )
      result = { transaction: await viewOf(tx, ctx, transactionId), payment: view() }
    },
  })
  return runCommand(
    ctx,
    request,
    () => {
      if (result === null) throw new Error('bank transaction was not matched')
      return { statusCode: 201, body: { data: result } }
    },
    idempotency,
  )
}

/** Gerekçeyle yoksayar (iade, kira, başka gelir); tahsilat yazılmaz (K-111). 200. */
export function ignoreBankTransactionCommand(
  ctx: ServiceContext,
  transactionId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const { ignoreReason } = bankIgnoreSchema.parse(input)
  let view: BankTransactionView | null = null
  return runCommand(
    ctx,
    {
      action: 'bank_transaction.ignore',
      collections: [],
      entity: { type: ENTITY, id: transactionId },
      load: async (tx) => {
        const row = await lockedTransaction(tx, ctx, transactionId, expectedVersion)
        return { run: () => assertBankTransactionOpen(row.status) }
      },
      after: async (tx) => {
        const marked = await markBankTransactionIgnored(tx, ctx.institutionId, {
          id: transactionId,
          expectedVersion,
          reason: ignoreReason,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (marked === null) throw new ConflictError()
        await audit(
          tx,
          ctx,
          'bank_transaction.ignore',
          { type: ENTITY, id: transactionId },
          { fields: ['status', 'ignoreReason'] },
        )
        view = await viewOf(tx, ctx, transactionId)
      },
    },
    () => {
      if (view === null) throw new Error('bank transaction was not ignored')
      return { statusCode: 200, body: { data: view } }
    },
    idempotency,
  )
}

/** Yoksaymayı geri alır; hareket yeniden eşleşmemiş olur. 200. */
export function restoreBankTransactionCommand(
  ctx: ServiceContext,
  transactionId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let view: BankTransactionView | null = null
  return runCommand(
    ctx,
    {
      action: 'bank_transaction.restore',
      collections: [],
      entity: { type: ENTITY, id: transactionId },
      load: async (tx) => {
        const row = await lockedTransaction(tx, ctx, transactionId, expectedVersion)
        return { run: () => assertBankTransactionIgnored(row.status) }
      },
      after: async (tx) => {
        const restored = await restoreBankTransaction(tx, ctx.institutionId, {
          id: transactionId,
          expectedVersion,
          now: ctx.now,
        })
        if (restored === null) throw new ConflictError()
        await audit(
          tx,
          ctx,
          'bank_transaction.restore',
          { type: ENTITY, id: transactionId },
          { fields: ['status', 'ignoreReason'] },
        )
        view = await viewOf(tx, ctx, transactionId)
      },
    },
    () => {
      if (view === null) throw new Error('bank transaction was not restored')
      return { statusCode: 200, body: { data: view } }
    },
    idempotency,
  )
}
