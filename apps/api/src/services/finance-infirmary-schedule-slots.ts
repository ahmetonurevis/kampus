import {
  resolveDoseSlots,
  type DoseRecordRef,
  type DoseSlotState,
} from '@kampus/school-core/lib/finance-infirmary-schedule.ts'

import type { Database } from '../db/client.ts'
import {
  loadCorrections,
  loadDoseAdministrations,
  loadSkips,
} from '../db/finance-infirmary-schedule.ts'

/**
 * Doz saatlerinin etkin sonucu (DOM-FIN-152; K-512, K-513): uygulama ve atlama kayıtları, iptalleri
 * ve zincirleri. Uygulama ve atlama yazan işlemler kurum kilidi altında bunu yükler; tek etkin
 * sonuç kuralını core `assertDoseSlotOpen` uygular. İptal yalnız `kind` ile bilinir, şifreli
 * içerik çözülmez.
 */
export async function loadDoseSlots(
  tx: Database,
  institutionId: string,
  consentIds: readonly string[],
): Promise<Map<string, DoseSlotState>> {
  const filter = { consentIds }
  const [administrations, skips] = await Promise.all([
    loadDoseAdministrations(tx, institutionId, filter),
    loadSkips(tx, institutionId, filter),
  ])
  const corrections = await loadCorrections(tx, institutionId, {
    administrationIds: administrations.map((row) => row.id),
    skipIds: skips.map((row) => row.id),
  })
  const records: DoseRecordRef[] = [
    ...administrations.map((row) => ({ kind: 'administration' as const, ...row })),
    ...skips.map((row) => ({ kind: 'skip' as const, ...row })),
  ]
  const voided = new Set(
    corrections.filter((row) => row.kind === 'void').map((row) => row.targetId),
  )
  return resolveDoseSlots(records, voided)
}
