import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import type {
  ChemicalProfileFields,
  LotMovement,
  MovementLot,
} from '@kampus/school-core/lib/finance-chemicals.ts'

import type { Database } from './client.ts'
import { stockChemicalProfiles, stockMovementLots } from './schema/finance-chemicals.ts'
import { stockMovements } from './schema/finance-inventory.ts'

/**
 * Kimyasal bilgisi ve parti deposu (DOM-FIN-090; ON-234). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Parti miktarı saklanmaz; hareketler ve girişlerin partileri birlikte okunur,
 * core `chemicalLotBalances` FEFO ile düşer (K-242).
 */

export interface StoredChemicalProfile extends ChemicalProfileFields {
  itemId: string
  version: number
}

const PROFILE_COLUMNS = {
  itemId: stockChemicalProfiles.itemId,
  hazardPictograms: stockChemicalProfiles.hazardPictograms,
  signalWord: stockChemicalProfiles.signalWord,
  casNumber: stockChemicalProfiles.casNumber,
  storageClass: stockChemicalProfiles.storageClass,
  incompatibilityNote: stockChemicalProfiles.incompatibilityNote,
  sdsUrl: stockChemicalProfiles.sdsUrl,
  sdsDocumentNumber: stockChemicalProfiles.sdsDocumentNumber,
  sdsRevisionDate: stockChemicalProfiles.sdsRevisionDate,
  version: stockChemicalProfiles.version,
}

const profilesOf = (institutionId: string) =>
  and(
    eq(stockChemicalProfiles.institutionId, institutionId),
    isNull(stockChemicalProfiles.archivedAt),
  )

/** Kimyasal bilgileri; `itemIds` verilmezse kurumun bütün kimyasal kartları. */
export async function loadChemicalProfiles(
  db: Database,
  institutionId: string,
  itemIds?: readonly string[],
): Promise<StoredChemicalProfile[]> {
  if (itemIds !== undefined && itemIds.length === 0) return []
  return db
    .select(PROFILE_COLUMNS)
    .from(stockChemicalProfiles)
    .where(
      and(
        profilesOf(institutionId),
        itemIds === undefined
          ? undefined
          : inArray(stockChemicalProfiles.itemId, [...new Set(itemIds)]),
      ),
    )
    .orderBy(asc(stockChemicalProfiles.itemId))
}

export async function insertChemicalProfile(
  tx: Database,
  institutionId: string,
  input: ChemicalProfileFields & { itemId: string; now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(stockChemicalProfiles)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Sürüm tutmazsa `false` (409). */
export async function updateChemicalProfile(
  tx: Database,
  institutionId: string,
  input: {
    itemId: string
    expectedVersion: number
    changes: Partial<ChemicalProfileFields>
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(stockChemicalProfiles)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        profilesOf(institutionId),
        eq(stockChemicalProfiles.itemId, input.itemId),
        eq(stockChemicalProfiles.version, input.expectedVersion),
      ),
    )
    .returning({ itemId: stockChemicalProfiles.itemId })
  return rows.length === 1
}

// --- Parti ---------------------------------------------------------------------------------------

export async function insertMovementLot(
  tx: Database,
  institutionId: string,
  input: MovementLot & { movementId: string; now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(stockMovementLots)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Hareketlerin partileri (hareket listesinde gösterim). */
export async function loadMovementLots(
  db: Database,
  institutionId: string,
  movementIds: readonly string[],
): Promise<Map<string, MovementLot>> {
  if (movementIds.length === 0) return new Map()
  const rows = await db
    .select({
      movementId: stockMovementLots.movementId,
      lotNumber: stockMovementLots.lotNumber,
      expiryDate: stockMovementLots.expiryDate,
    })
    .from(stockMovementLots)
    .where(
      and(
        eq(stockMovementLots.institutionId, institutionId),
        isNull(stockMovementLots.archivedAt),
        inArray(stockMovementLots.movementId, [...new Set(movementIds)]),
      ),
    )
  return new Map(rows.map(({ movementId, ...lot }) => [movementId, lot]))
}

/**
 * Kartların iptal edilmemiş bütün hareketleri ve girişlerin partileri (FEFO hesabının girdisi,
 * K-242). Sıra gün, kayıt anı ve kimliktir; core yeniden sıralar.
 */
export async function loadLotLedger(
  db: Database,
  institutionId: string,
  itemIds: readonly string[],
): Promise<{ movements: LotMovement[]; lots: Map<string, MovementLot> }> {
  if (itemIds.length === 0) return { movements: [], lots: new Map() }
  const rows = await db
    .select({
      id: stockMovements.id,
      itemId: stockMovements.itemId,
      warehouseId: stockMovements.warehouseId,
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      movementDate: stockMovements.movementDate,
      createdAt: stockMovements.createdAt,
      transferId: stockMovements.transferId,
      lotNumber: stockMovementLots.lotNumber,
      expiryDate: stockMovementLots.expiryDate,
    })
    .from(stockMovements)
    .leftJoin(
      stockMovementLots,
      and(
        eq(stockMovementLots.institutionId, stockMovements.institutionId),
        eq(stockMovementLots.movementId, stockMovements.id),
        isNull(stockMovementLots.archivedAt),
      ),
    )
    .where(
      and(
        eq(stockMovements.institutionId, institutionId),
        isNull(stockMovements.archivedAt),
        isNull(stockMovements.cancelledAt),
        inArray(stockMovements.itemId, [...new Set(itemIds)]),
      ),
    )
    .orderBy(
      asc(stockMovements.movementDate),
      asc(stockMovements.createdAt),
      asc(stockMovements.id),
    )
  const lots = new Map<string, MovementLot>()
  const movements = rows.map(({ lotNumber, expiryDate, createdAt, ...movement }) => {
    if (lotNumber !== null && expiryDate !== null) lots.set(movement.id, { lotNumber, expiryDate })
    return { ...movement, createdAt: createdAt.toISOString(), cancelledAt: null }
  })
  return { movements, lots }
}
