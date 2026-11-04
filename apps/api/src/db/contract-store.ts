import { and, asc, eq, inArray, isNull, max, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'

import {
  CONTRACT_APPROVAL_METHODS,
  SIGNATORY_ROLES,
} from '@kampus/school-core/lib/contract-status.ts'

import { ConflictError, withDatabaseErrors } from '../errors.ts'
import type { Database } from './client.ts'
import type { RecordData } from './collections.ts'
import {
  columnMatch,
  instantSchema,
  invoiceToColumns,
  programmingError,
  type InvoiceColumns,
  type StoreLoadOptions,
} from './invoice-store.ts'
import { POSITION_STEP } from './positions.ts'
import type { RecordFilter, RecordWrite, StoredRecord, WrittenRecord } from './records.ts'
import { contractInvoices } from './schema/contract-invoices.ts'
import { CONTRACT_PAYERS, contracts } from './schema/contracts.ts'
import { invoices } from './schema/invoices.ts'

/**
 * Sözleşme deposu (ADR 0010 karar 3, 7, 8; ON-046d): `contracts` + `contract_invoices` satırları ↔
 * core sözleşme kaydı (`State['contracts'][number]`), süzgeç çevirisi, yükleme ve iki koleksiyonun
 * bağımlılık sırasıyla yazılması (sözleşme → taksit → bağ). Henüz çalıştırıcıya bağlı değildir
 * (ON-046b); kaynak `records`'tır.
 *
 * Dönüşüm birebirdir: `invoiceIds` sırası `contract_invoices.position`'dır, alanı olmayan eski kayıt
 * `has_invoice_list = false`'tur. İlk sürümde core `revision` alanı yoktur (kolon 1).
 */

const idSchema = z.string().min(1).max(200)
const centsSchema = z.number().int().nonnegative()
/** jsonb kopyalarının öğeleri; core tipleriyle (`DiscountLine`, `ContractPlanLine`) aynı kapalı şekil. */
const amountLineSchema = z.strictObject({ kind: z.string().min(1), amountCents: z.number().int() })
const planLineSchema = z.strictObject({
  invoiceId: idSchema.nullable(),
  installment: z.number().int().positive(),
  amount: z.number().int(),
  dueDate: z.string(),
  feeKind: z.string().optional(),
})

const TERMS_FIELDS = [
  'tariffId',
  'tariffVersion',
  'grossCents',
  'netCents',
  'discounts',
  'extras',
  'approvedByUserId',
  'payer',
] as const

/** Saklanan core sözleşme kaydı; alan listesi kapalıdır. */
export const contractRecordSchema = z
  .strictObject({
    id: idSchema,
    studentId: idSchema,
    date: instantSchema,
    amount: centsSchema,
    title: z.string().min(1),
    classId: idSchema.optional(),
    academicYear: z.number().int().optional(),
    invoiceIds: z.array(idSchema).optional(),
    tariffId: z.uuid().optional(),
    tariffVersion: z.number().int().positive().optional(),
    grossCents: centsSchema.optional(),
    netCents: centsSchema.optional(),
    discounts: z.array(amountLineSchema).optional(),
    extras: z.array(amountLineSchema).optional(),
    approvedByUserId: idSchema.optional(),
    payer: z.enum(CONTRACT_PAYERS).optional(),
    scholarship: z.strictObject({ programId: z.uuid(), amountCents: centsSchema }).optional(),
    signatory: z
      .strictObject({
        name: z.string().min(1),
        role: z.enum(SIGNATORY_ROLES),
        recordedAt: instantSchema,
        recordedByUserId: idSchema,
      })
      .optional(),
    approval: z
      .strictObject({
        method: z.enum(CONTRACT_APPROVAL_METHODS),
        approvedAt: instantSchema,
        approvedByUserId: idSchema,
        payerName: z.string().min(1),
        plan: z.array(planLineSchema),
      })
      .optional(),
    revision: z.number().int().min(2).optional(),
    amendsContractId: idSchema.optional(),
    amendmentReason: z.string().optional(),
    proposedPlan: z
      .strictObject({
        kept: z.array(planLineSchema),
        replacedInvoiceIds: z.array(idSchema),
        added: z.array(planLineSchema),
      })
      .optional(),
    cancelledAt: instantSchema.optional(),
    cancelledByUserId: idSchema.optional(),
    cancelReason: z.string().min(1).optional(),
  })
  .refine((c) => new Set(c.invoiceIds).size === (c.invoiceIds?.length ?? 0), 'invoiceIds unique')
  .refine((c) => (c.revision === undefined) === (c.amendsContractId === undefined), 'revision')
  .refine((c) => {
    const filled = TERMS_FIELDS.filter((field) => c[field] !== undefined).length
    return filled === 0 || filled === TERMS_FIELDS.length
  }, 'terms group')
  .refine((c) => c.scholarship === undefined || c.tariffId !== undefined, 'scholarship terms')
  .refine(
    (c) =>
      (c.cancelledAt === undefined) === (c.cancelledByUserId === undefined) &&
      (c.cancelledAt === undefined) === (c.cancelReason === undefined),
    'cancel group',
  )
export type ContractRecord = z.infer<typeof contractRecordSchema>

export type ContractRow = typeof contracts.$inferSelect
export type ContractColumns = Omit<
  typeof contracts.$inferInsert,
  'institutionId' | 'position' | 'createdAt' | 'updatedAt' | 'archivedAt' | 'version' | 'currency'
>

export function parseContractRecord(data: RecordData): ContractRecord {
  const parsed = contractRecordSchema.safeParse(data)
  if (!parsed.success) throw programmingError('contract record does not match table', parsed.error)
  return parsed.data
}

/**
 * Core kaydı → satır kolonları ve taksit bağı. Kök ilk sürümde kendisi, ek protokolde önceki
 * sürümün köküdür; çağıran verir (`rootContractId`). `invoiceIds` yoksa `null` (eski kayıt).
 */
export function contractToColumns(
  data: RecordData,
  rootContractId: string,
): { columns: ContractColumns; invoiceIds: readonly string[] | null } {
  const contract = parseContractRecord(data)
  if ((contract.amendsContractId === undefined) !== (rootContractId === contract.id))
    throw programmingError('contract root does not match amendsContractId')
  const columns: ContractColumns = {
    id: contract.id,
    studentId: contract.studentId,
    rootContractId,
    amendsContractId: contract.amendsContractId ?? null,
    revision: contract.revision ?? 1,
    academicYear: contract.academicYear ?? null,
    classId: contract.classId ?? null,
    title: contract.title,
    contractAt: new Date(contract.date),
    amountCents: contract.amount,
    tariffId: contract.tariffId ?? null,
    tariffVersion: contract.tariffVersion ?? null,
    grossCents: contract.grossCents ?? null,
    netCents: contract.netCents ?? null,
    discounts: contract.discounts ?? null,
    extras: contract.extras ?? null,
    termsApprovedByUserId: contract.approvedByUserId ?? null,
    payer: contract.payer ?? null,
    scholarshipProgramId: contract.scholarship?.programId ?? null,
    scholarshipCents: contract.scholarship?.amountCents ?? null,
    signatoryName: contract.signatory?.name ?? null,
    signatoryRole: contract.signatory?.role ?? null,
    signatoryRecordedAt: contract.signatory ? new Date(contract.signatory.recordedAt) : null,
    signatoryRecordedByUserId: contract.signatory?.recordedByUserId ?? null,
    approvalMethod: contract.approval?.method ?? null,
    approvedAt: contract.approval ? new Date(contract.approval.approvedAt) : null,
    approvedByUserId: contract.approval?.approvedByUserId ?? null,
    approvalPayerName: contract.approval?.payerName ?? null,
    approvalPlan: (contract.approval?.plan ?? null) as ContractColumns['approvalPlan'],
    amendmentReason: contract.amendmentReason ?? null,
    proposedPlan: (contract.proposedPlan ?? null) as ContractColumns['proposedPlan'],
    cancelledAt: contract.cancelledAt === undefined ? null : new Date(contract.cancelledAt),
    cancelledByUserId: contract.cancelledByUserId ?? null,
    cancelReason: contract.cancelReason ?? null,
    hasInvoiceList: contract.invoiceIds !== undefined,
  }
  return { columns, invoiceIds: contract.invoiceIds ?? null }
}

/** Dolu kolonların hepsi ya da hiçbiri: kısıtla korunan grup yarım okunursa programlama hatasıdır. */
function group<T>(values: readonly unknown[], build: () => T): T | undefined {
  const filled = values.filter((value) => value !== null).length
  if (filled === 0) return undefined
  if (filled !== values.length) throw programmingError('contract column group is partial')
  return build()
}

const required = <T>(value: T | null): T => {
  if (value === null) throw programmingError('contract column group is partial')
  return value
}

/** Satır + sıralı bağ → core kaydı; boş kolon alanı hiç yazmaz. */
export function rowToContract(row: ContractRow, invoiceIds: readonly string[]): ContractRecord {
  const terms = group(
    [
      row.tariffId,
      row.tariffVersion,
      row.grossCents,
      row.netCents,
      row.discounts,
      row.extras,
      row.termsApprovedByUserId,
      row.payer,
    ],
    () => ({
      tariffId: required(row.tariffId),
      tariffVersion: required(row.tariffVersion),
      grossCents: required(row.grossCents),
      netCents: required(row.netCents),
      discounts: [...required(row.discounts)],
      extras: [...required(row.extras)],
      approvedByUserId: required(row.termsApprovedByUserId),
      payer: z.enum(CONTRACT_PAYERS).parse(row.payer),
    }),
  )
  const scholarship = group([row.scholarshipProgramId, row.scholarshipCents], () => ({
    programId: required(row.scholarshipProgramId),
    amountCents: required(row.scholarshipCents),
  }))
  const signatory = group(
    [row.signatoryName, row.signatoryRole, row.signatoryRecordedAt, row.signatoryRecordedByUserId],
    () => ({
      name: required(row.signatoryName),
      role: z.enum(SIGNATORY_ROLES).parse(row.signatoryRole),
      recordedAt: required(row.signatoryRecordedAt).toISOString(),
      recordedByUserId: required(row.signatoryRecordedByUserId),
    }),
  )
  const approval = group(
    [
      row.approvalMethod,
      row.approvedAt,
      row.approvedByUserId,
      row.approvalPayerName,
      row.approvalPlan,
    ],
    () => ({
      method: z.enum(CONTRACT_APPROVAL_METHODS).parse(row.approvalMethod),
      approvedAt: required(row.approvedAt).toISOString(),
      approvedByUserId: required(row.approvedByUserId),
      payerName: required(row.approvalPayerName),
      plan: [...required(row.approvalPlan)],
    }),
  )
  const cancel = group([row.cancelledAt, row.cancelledByUserId, row.cancelReason], () => ({
    cancelledAt: required(row.cancelledAt).toISOString(),
    cancelledByUserId: required(row.cancelledByUserId),
    cancelReason: required(row.cancelReason),
  }))
  return {
    id: row.id,
    studentId: row.studentId,
    date: row.contractAt.toISOString(),
    amount: row.amountCents,
    title: row.title,
    ...(row.classId === null ? {} : { classId: row.classId }),
    ...(row.academicYear === null ? {} : { academicYear: row.academicYear }),
    ...(row.hasInvoiceList ? { invoiceIds: [...invoiceIds] } : {}),
    ...terms,
    ...(scholarship === undefined ? {} : { scholarship }),
    ...(signatory === undefined ? {} : { signatory }),
    ...(approval === undefined ? {} : { approval }),
    ...(row.amendsContractId === null
      ? {}
      : { revision: row.revision, amendsContractId: row.amendsContractId }),
    ...(row.amendmentReason === null ? {} : { amendmentReason: row.amendmentReason }),
    ...(row.proposedPlan === null ? {} : { proposedPlan: row.proposedPlan }),
    ...cancel,
  }
}

const CONTRACT_FIELDS = {
  id: contracts.id,
  studentId: contracts.studentId,
  classId: contracts.classId,
  amendsContractId: contracts.amendsContractId,
}

/** `loadRecords` süzgecinin kolon koşulu; çevrilemeyen süzgeç programlama hatasıdır. */
export function contractFilter(filter: RecordFilter): SQL {
  switch (filter.kind) {
    case undefined:
    case 'in':
    case 'equals':
      return columnMatch('contracts', CONTRACT_FIELDS, filter)
    case 'any':
      return filter.matches.length === 0
        ? sql`false`
        : sql`(${sql.join(
            filter.matches.map((match) => columnMatch('contracts', CONTRACT_FIELDS, match)),
            sql` or `,
          )})`
    case 'invoiceStatus':
    case 'dayRange':
    case 'active':
    case 'set':
    case 'announcementStatus':
    case 'ownOrVia':
    case 'settled':
      throw programmingError(`untranslatable contracts filter: ${filter.kind}`)
    default:
      return filter satisfies never
  }
}

/** Sürümlerin canlı taksit bağları, `invoiceIds` sırasıyla. */
async function loadLinks(
  db: Database,
  institutionId: string,
  contractIds: readonly string[],
): Promise<Map<string, string[]>> {
  const links = new Map<string, string[]>()
  if (contractIds.length === 0) return links
  const rows = await db
    .select({ contractId: contractInvoices.contractId, invoiceId: contractInvoices.invoiceId })
    .from(contractInvoices)
    .where(
      and(
        eq(contractInvoices.institutionId, institutionId),
        inArray(contractInvoices.contractId, [...contractIds]),
        isNull(contractInvoices.archivedAt),
      ),
    )
    .orderBy(asc(contractInvoices.position), asc(contractInvoices.invoiceId))
  for (const row of rows)
    links.set(row.contractId, [...(links.get(row.contractId) ?? []), row.invoiceId])
  return links
}

export function contractToStored(row: ContractRow, invoiceIds: readonly string[]): StoredRecord {
  return {
    collection: 'contracts',
    id: row.id,
    data: rowToContract(row, invoiceIds),
    position: row.position,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  }
}

/** Kurumun sözleşme sürümleri, core dizisinin sırasıyla (`position`, kimlik). */
export async function loadContracts(
  db: Database,
  institutionId: string,
  options: StoreLoadOptions = {},
): Promise<StoredRecord[]> {
  if (options.ids?.length === 0) return []
  const filters: SQL[] = [eq(contracts.institutionId, institutionId)]
  if (!options.includeArchived) filters.push(isNull(contracts.archivedAt))
  if (options.ids) filters.push(inArray(contracts.id, [...options.ids]))
  for (const match of options.match ?? []) filters.push(contractFilter(match))
  const rows = await db
    .select()
    .from(contracts)
    .where(and(...filters))
    .orderBy(asc(contracts.position), asc(contracts.id))
  const links = await loadLinks(
    db,
    institutionId,
    rows.map((row) => row.id),
  )
  return rows.map((row) => contractToStored(row, links.get(row.id) ?? []))
}

type StoreWrite = RecordWrite & { collection: 'contracts' | 'invoices' }

function storeWrites(writes: readonly RecordWrite[]): StoreWrite[] {
  return writes.map((write) => {
    if (write.collection !== 'contracts' && write.collection !== 'invoices')
      throw programmingError(`collection is not table backed: ${write.collection}`)
    return write as StoreWrite
  })
}

async function nextContractPosition(tx: Database, institutionId: string): Promise<number> {
  const [row] = await tx
    .select({ last: max(contracts.position) })
    .from(contracts)
    .where(eq(contracts.institutionId, institutionId))
  const last = row?.last
  return last === null || last === undefined ? 0 : Number(last) + POSITION_STEP
}

async function nextInvoicePosition(tx: Database, institutionId: string): Promise<number> {
  const [row] = await tx
    .select({ last: max(invoices.position) })
    .from(invoices)
    .where(eq(invoices.institutionId, institutionId))
  const last = row?.last
  return last === null || last === undefined ? 0 : Number(last) + POSITION_STEP
}

/** Sürümlerin zincir kökleri: önce bu yazmada çözülenler, yoksa tablodan. */
async function rootsOf(
  tx: Database,
  institutionId: string,
  ids: readonly string[],
  known: ReadonlyMap<string, string>,
): Promise<Map<string, string>> {
  const roots = new Map(known)
  const missing = [...new Set(ids.filter((id) => !roots.has(id)))]
  if (missing.length > 0) {
    const rows = await tx
      .select({ id: contracts.id, root: contracts.rootContractId })
      .from(contracts)
      .where(and(eq(contracts.institutionId, institutionId), inArray(contracts.id, missing)))
    for (const row of rows) roots.set(row.id, row.root)
  }
  for (const id of ids)
    if (!roots.has(id)) throw programmingError(`contract ${id} is not in the contracts table`)
  return roots
}

const versionOf = (row: { version: number } | undefined) => {
  if (!row) throw new ConflictError()
  return row.version
}

/** Bağları `invoiceIds` dizisine eşitler: yeni bağ eklenir, düşen arşivlenir, geri gelen açılır. */
async function syncLinks(
  tx: Database,
  institutionId: string,
  contractId: string,
  invoiceIds: readonly string[],
  now: Date,
): Promise<void> {
  const existing = new Map(
    (
      await tx
        .select()
        .from(contractInvoices)
        .where(
          and(
            eq(contractInvoices.institutionId, institutionId),
            eq(contractInvoices.contractId, contractId),
          ),
        )
    ).map((row) => [row.invoiceId, row]),
  )
  const key = (invoiceId: string) =>
    and(
      eq(contractInvoices.institutionId, institutionId),
      eq(contractInvoices.contractId, contractId),
      eq(contractInvoices.invoiceId, invoiceId),
    )
  const bump = { version: sql`${contractInvoices.version} + 1`, updatedAt: now }
  for (const [position, invoiceId] of invoiceIds.entries()) {
    const link = existing.get(invoiceId)
    if (!link)
      await tx.insert(contractInvoices).values({
        institutionId,
        contractId,
        invoiceId,
        position,
        createdAt: now,
        updatedAt: now,
      })
    else if (link.archivedAt !== null || link.position !== position)
      await tx
        .update(contractInvoices)
        .set({ position, archivedAt: null, ...bump })
        .where(key(invoiceId))
  }
  const kept = new Set(invoiceIds)
  for (const link of existing.values())
    if (link.archivedAt === null && !kept.has(link.invoiceId))
      await tx
        .update(contractInvoices)
        .set({ archivedAt: now, ...bump })
        .where(key(link.invoiceId))
}

async function writeContract(
  tx: Database,
  institutionId: string,
  write: StoreWrite,
  columns: ContractColumns | null,
  position: number,
  now: Date,
): Promise<WrittenRecord> {
  const where = and(eq(contracts.institutionId, institutionId), eq(contracts.id, write.id))
  const bump = { version: sql`${contracts.version} + 1`, updatedAt: now }
  let version: number
  let kind: WrittenRecord['kind'] = write.kind
  switch (write.kind) {
    case 'insert': {
      if (!columns) throw programmingError('missing contract columns')
      const [row] = await tx
        .insert(contracts)
        .values({ institutionId, ...columns, position, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [contracts.institutionId, contracts.id],
          set: { ...columns, position, archivedAt: null, ...bump },
          setWhere: sql`${contracts.archivedAt} is not null`,
        })
        .returning({ version: contracts.version })
      version = versionOf(row)
      if (version > 1) kind = 'restore'
      break
    }
    case 'update': {
      if (!columns) throw programmingError('missing contract columns')
      const set =
        write.position === undefined ? { ...columns, ...bump } : { ...columns, position, ...bump }
      const [row] = await tx
        .update(contracts)
        .set(set)
        .where(
          and(where, eq(contracts.version, write.expectedVersion), isNull(contracts.archivedAt)),
        )
        .returning({ version: contracts.version })
      version = versionOf(row)
      break
    }
    case 'move': {
      const [row] = await tx
        .update(contracts)
        .set({ position: write.position })
        .where(
          and(where, eq(contracts.version, write.expectedVersion), isNull(contracts.archivedAt)),
        )
        .returning({ version: contracts.version })
      version = versionOf(row)
      break
    }
    case 'archive': {
      const [row] = await tx
        .update(contracts)
        .set({ archivedAt: now, ...bump })
        .where(
          and(where, eq(contracts.version, write.expectedVersion), isNull(contracts.archivedAt)),
        )
        .returning({ version: contracts.version })
      version = versionOf(row)
      break
    }
    default:
      return write satisfies never
  }
  return { kind, collection: 'contracts', id: write.id, version }
}

async function writeInvoice(
  tx: Database,
  institutionId: string,
  write: StoreWrite,
  columns: InvoiceColumns | null,
  position: number,
  now: Date,
): Promise<WrittenRecord> {
  const where = and(eq(invoices.institutionId, institutionId), eq(invoices.id, write.id))
  const bump = { version: sql`${invoices.version} + 1`, updatedAt: now }
  let version: number
  let kind: WrittenRecord['kind'] = write.kind
  switch (write.kind) {
    case 'insert': {
      if (!columns) throw programmingError('missing invoice columns')
      const [row] = await tx
        .insert(invoices)
        .values({ institutionId, ...columns, position, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [invoices.institutionId, invoices.id],
          set: { ...columns, position, archivedAt: null, ...bump },
          setWhere: sql`${invoices.archivedAt} is not null`,
        })
        .returning({ version: invoices.version })
      version = versionOf(row)
      if (version > 1) kind = 'restore'
      break
    }
    case 'update': {
      if (!columns) throw programmingError('missing invoice columns')
      const set =
        write.position === undefined ? { ...columns, ...bump } : { ...columns, position, ...bump }
      const [row] = await tx
        .update(invoices)
        .set(set)
        .where(and(where, eq(invoices.version, write.expectedVersion), isNull(invoices.archivedAt)))
        .returning({ version: invoices.version })
      version = versionOf(row)
      break
    }
    case 'move': {
      const [row] = await tx
        .update(invoices)
        .set({ position: write.position })
        .where(and(where, eq(invoices.version, write.expectedVersion), isNull(invoices.archivedAt)))
        .returning({ version: invoices.version })
      version = versionOf(row)
      break
    }
    case 'archive': {
      const [row] = await tx
        .update(invoices)
        .set({ archivedAt: now, ...bump })
        .where(and(where, eq(invoices.version, write.expectedVersion), isNull(invoices.archivedAt)))
        .returning({ version: invoices.version })
      version = versionOf(row)
      break
    }
    default:
      return write satisfies never
  }
  return { kind, collection: 'invoices', id: write.id, version }
}

/**
 * Aynı tablodaki yazma sırası: arşiv, güncelleme, taşıma, ekleme; sonra kimlik. Kısmi benzersiz
 * indeksler ertelenemez: ek protokol onayında yerine gelen taksit, aynı numarayı alan yeni
 * taksitten, iptal edilen ek protokol yenisinden önce yazılmalıdır.
 */
const KIND_ORDER = { archive: 0, update: 1, move: 2, insert: 3 } as const satisfies Record<
  RecordWrite['kind'],
  number
>
function byWriteOrder(left: StoreWrite, right: StoreWrite): number {
  const kind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
  if (kind !== 0) return kind
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

const revisionOf = (write: StoreWrite) =>
  write.kind === 'insert' || write.kind === 'update'
    ? typeof write.data.revision === 'number'
      ? write.data.revision
      : 1
    : 0

/**
 * Sözleşme ve taksit yazmalarını tek transaction'da bağımlılık sırasıyla yazar (ADR 0010 karar 7):
 * sözleşme satırları (önceki sürüm ek protokolden önce), taksit satırları, sonra `invoiceIds` bağları.
 * `records.ts` `writeRecords` ile aynı anlam: güncelleme, taşıma ve arşiv `version = beklenen` ile
 * (tutmazsa 409), ekleme arşivlenmiş satırı yeniden açar (`restore`), canlı satırla çakışırsa 409;
 * sırası verilmemiş ekleme tablonun sonuna gider. Kurum kilidini çağıran alır.
 */
export async function writeContractsAndInvoices(
  db: Database,
  institutionId: string,
  writes: readonly RecordWrite[],
  now: Date,
): Promise<WrittenRecord[]> {
  const prepared = storeWrites(writes)
  if (prepared.length === 0) return []
  const work = db.transaction(async (tx) => {
    const written: WrittenRecord[] = []
    // Sırası verilmemiş eklemeler verilen sırayla tablonun sonuna gider; yazma sırası ayrıdır.
    const next = {
      contracts: await nextContractPosition(tx, institutionId),
      invoices: await nextInvoicePosition(tx, institutionId),
    }
    const appended = new Map<StoreWrite, number>()
    for (const write of prepared)
      if (write.kind === 'insert' && write.position === undefined) {
        appended.set(write, next[write.collection])
        next[write.collection] += POSITION_STEP
      }
    const positionOf = (write: StoreWrite) =>
      write.kind === 'archive' ? 0 : (write.position ?? appended.get(write) ?? 0)

    // Sözleşmeler: ek protokol önceki sürümünden sonra (sürüm numarası artandır).
    const contractWrites = prepared
      .filter((write) => write.collection === 'contracts')
      .sort((left, right) => revisionOf(left) - revisionOf(right) || byWriteOrder(left, right))
    const resolved = new Map<string, string>()
    const links: { contractId: string; invoiceIds: readonly string[] }[] = []
    for (const write of contractWrites) {
      let columns: ContractColumns | null = null
      if (write.kind === 'insert' || write.kind === 'update') {
        const amends = write.data.amendsContractId
        const root =
          typeof amends === 'string'
            ? (await rootsOf(tx, institutionId, [amends], resolved)).get(amends)
            : write.id
        if (root === undefined) throw programmingError('contract root not resolved')
        const converted = contractToColumns(write.data, root)
        columns = converted.columns
        resolved.set(write.id, root)
        links.push({ contractId: write.id, invoiceIds: converted.invoiceIds ?? [] })
      }
      written.push(await writeContract(tx, institutionId, write, columns, positionOf(write), now))
    }

    const invoiceWrites = prepared
      .filter((write) => write.collection === 'invoices')
      .sort(byWriteOrder)
    const contractIds = invoiceWrites.flatMap((write) =>
      (write.kind === 'insert' || write.kind === 'update') &&
      typeof write.data.contractId === 'string'
        ? [write.data.contractId]
        : [],
    )
    const roots = await rootsOf(tx, institutionId, contractIds, resolved)
    for (const write of invoiceWrites) {
      let columns: InvoiceColumns | null = null
      if (write.kind === 'insert' || write.kind === 'update') {
        const contractId = write.data.contractId
        columns = invoiceToColumns(
          write.data,
          typeof contractId === 'string' ? (roots.get(contractId) ?? null) : null,
        )
      }
      written.push(await writeInvoice(tx, institutionId, write, columns, positionOf(write), now))
    }

    for (const link of links)
      await syncLinks(tx, institutionId, link.contractId, link.invoiceIds, now)
    return written
  })
  return withDatabaseErrors(work)
}
