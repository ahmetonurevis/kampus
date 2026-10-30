// Sınıf Analizi saf hesabı: öğretmenin sınıf seçicisi (Vue `Academic.vue` "Sınıf seç" listesi).
import type { CoreRecord, CoreRow } from '@/hooks/use-core-collection.ts'

export type ClassOption = { id: string; label: string }

/**
 * Seçilebilir sınıflar: yalnız etkin sınıflar, ada göre Türkçe sıralı; etiket "Sınıf · Kampüs".
 * Girdi kapsamı sunucu daraltmıştır (öğretmen ders verdiği ve danışmanı olduğu sınıfları alır).
 */
export function classOptions(
  classes: readonly CoreRow<'classes'>[],
  branches: ReadonlyMap<string, Pick<CoreRecord<'branches'>, 'name'>>,
): ClassOption[] {
  return classes
    .map((row) => row.record)
    .filter((record) => record.isActive)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true }))
    .map((record) => {
      const branch = branches.get(record.branchId)?.name
      return { id: record.id, label: branch ? `${record.name} · ${branch}` : record.name }
    })
}
