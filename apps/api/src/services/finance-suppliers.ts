import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  assertSupplierTaxNumberFree,
  maskIban,
  maskSupplierTaxNumber,
  supplierDocumentAlerts,
  supplierDocumentStatus,
  supplierSchema,
  updateSupplierSchema,
} from '@kampus/school-core/lib/finance-suppliers.ts'

import type { Database } from '../db/client.ts'
import {
  findSupplier,
  insertSupplier,
  isSupplierTaxNumberTaken,
  listSuppliers,
  updateSupplier,
  type StoredSupplier,
  type SupplierQuery,
} from '../db/finance-suppliers.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Tedarikçi kaydı (DOM-FIN-070; ON-221). Kural core `lib/finance-suppliers.ts`'tedir; servis kurum
 * kilidi altında vergi numarası tekilliğini denetler ve aynı transaction'da yazar. Liste şahıs
 * TCKN'sini ve IBAN'ı maskeler; tam değerler yalnız yöneticinin ayrıntısında döner (K-126). Denetim
 * kaydına alan adları yazılır, değerler yazılmaz. Rol ve modül denetimi rotadadır.
 */

const ENTITY = 'suppliers'

/** Liste satırı: maskeli vergi numarası ve IBAN, belge uyarısı (DOM-FIN-070). */
function listView(supplier: StoredSupplier, today: string) {
  const alerts = supplierDocumentAlerts(supplier.documents, today)
  return {
    id: supplier.id,
    name: supplier.name,
    type: supplier.type,
    taxNumber: maskSupplierTaxNumber(supplier.type, supplier.taxNumber),
    taxOffice: supplier.taxOffice,
    categories: supplier.categories,
    contactName: supplier.contactName,
    contactPhone: supplier.contactPhone,
    contactEmail: supplier.contactEmail,
    iban: supplier.iban === null ? null : maskIban(supplier.iban),
    documentCount: supplier.documents.length,
    expiredDocumentCount: alerts.expired,
    expiringDocumentCount: alerts.expiring,
    isActive: supplier.isActive,
    version: supplier.version,
  }
}

/** Ayrıntı: tam değerler ve belge durumları; yalnız yönetici okur. */
function detailView(supplier: StoredSupplier, today: string) {
  return {
    ...supplier,
    documents: supplier.documents.map((document) => ({
      ...document,
      status: supplierDocumentStatus(document, today),
    })),
  }
}

async function supplierOf(db: Database, ctx: ServiceContext, id: string) {
  const found = await findSupplier(db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return found
}

export async function listSuppliersFor(
  ctx: ServiceContext,
  query: Omit<SupplierQuery, 'searchTaxNumber'>,
) {
  const { items, total } = await listSuppliers(ctx.db, ctx.institutionId, {
    ...query,
    // Ön büro tam vergi numarasını görmez; numarayla arayıp şahıs TCKN'sini doğrulayamaz.
    searchTaxNumber: ctx.actor.role === 'yonetici',
  })
  const today = dayKey(ctx.now)
  return { items: items.map((item) => listView(item, today)), total }
}

export async function getSupplierFor(ctx: ServiceContext, id: string) {
  return detailView(await supplierOf(ctx.db, ctx, id), dayKey(ctx.now))
}

const supplierBody = async (tx: Database, ctx: ServiceContext, id: string) => ({
  data: detailView(await supplierOf(tx, ctx, id), dayKey(ctx.now)),
})

/** Yeni tedarikçi (DOM-FIN-070); vergi numarası kurumda tekil. 201. */
export function createSupplierCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'supplier.create',
      collections: [],
      entity,
      load: async (tx) => {
        const data = supplierSchema.parse(input)
        const taken = await isSupplierTaxNumberTaken(tx, ctx.institutionId, data.taxNumber)
        return {
          run: () => {
            assertSupplierTaxNumberFree(taken)
            return data
          },
        }
      },
      after: async (tx, data) => {
        await insertSupplier(tx, ctx.institutionId, { ...data, id, now: ctx.now })
        await auditWork(tx, ctx, 'supplier.create', entity, Object.keys(data))
        body = await supplierBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Kısmi düzeltme ve pasifleştirme; başka tedarikçinin vergi numarası 409. */
export function updateSupplierCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'supplier.update',
      collections: [],
      entity,
      load: async (tx) => {
        const changes = updateSupplierSchema.parse(input)
        const current = await supplierOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const taken =
          changes.taxNumber !== undefined &&
          (await isSupplierTaxNumberTaken(tx, ctx.institutionId, changes.taxNumber, id))
        return {
          run: () => {
            assertSupplierTaxNumberFree(taken)
            return changes
          },
        }
      },
      after: async (tx, changes) => {
        const saved = await updateSupplier(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'supplier.update', entity, Object.keys(changes))
        body = await supplierBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
