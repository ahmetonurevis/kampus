import {
  buildOrgTree,
  flattenOrgTree,
  type OrgTreePosition,
  type OrgTreeUnit,
  type OrgUnitKind,
} from '@kampus/school-core/lib/finance-org-chart.ts'

// Organizasyon sekmesinin saf mantığı (DOM-FIN-129; ON-187): seçim listeleri döngüye yol açan
// seçenekleri baştan dışlar (sunucu yine denetler, K-442/K-443) ve düzeltme formu yalnız değişen
// alanları gövdeye yazar (değişiklik yoksa gövde boş, istek atılmaz).

export type SelectOption = { value: string; label: string }

/** Girinti: düzey başına iki bölünmez boşluk (seçim listesinde ağaç görünümü). */
export const indent = (depth: number) => '  '.repeat(Math.max(0, depth - 1))

/** Birimin kendisi ve bütün alt birimleri (taşımada üst birim olamazlar). */
export function unitWithDescendants(units: readonly OrgTreeUnit[], unitId: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const unit of units)
    if (unit.parentId !== null)
      children.set(unit.parentId, [...(children.get(unit.parentId) ?? []), unit.id])
  const result = new Set<string>()
  const stack = [unitId]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined || result.has(id)) continue
    result.add(id)
    stack.push(...(children.get(id) ?? []))
  }
  return result
}

/**
 * Üst birim seçenekleri: etkin birimler ağaç sırasıyla; taşınan birim ve alt birimleri hariç.
 * İlk seçenek kök (boş değer).
 */
export function parentOptions(
  units: readonly OrgTreeUnit[],
  unitId: string | null,
): SelectOption[] {
  const excluded = unitId === null ? new Set<string>() : unitWithDescendants(units, unitId)
  return [
    { value: '', label: 'Kök birim (üst birim yok)' },
    ...flattenOrgTree(buildOrgTree(units, []))
      .filter(({ unit }) => unit.isActive && !excluded.has(unit.id))
      .map(({ unit, depth }) => ({ value: unit.id, label: `${indent(depth)}${unit.name}` })),
  ]
}

/** Pozisyonun kendisi ve ona (dolaylı) raporlayan bütün pozisyonlar. */
export function positionWithReports(
  positions: readonly OrgTreePosition[],
  positionId: string,
): Set<string> {
  const reports = new Map<string, string[]>()
  for (const position of positions)
    if (position.reportsToPositionId !== null)
      reports.set(position.reportsToPositionId, [
        ...(reports.get(position.reportsToPositionId) ?? []),
        position.id,
      ])
  const result = new Set<string>()
  const stack = [positionId]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined || result.has(id)) continue
    result.add(id)
    stack.push(...(reports.get(id) ?? []))
  }
  return result
}

/**
 * Raporladığı pozisyon seçenekleri: birim ağacı sırasıyla, "Unvan (Birim)"; düzeltilen pozisyon
 * ve ona raporlayanlar hariç. İlk seçenek "en üst" (boş değer).
 */
export function reportsToOptions(
  units: readonly OrgTreeUnit[],
  positions: readonly OrgTreePosition[],
  positionId: string | null,
): SelectOption[] {
  const excluded =
    positionId === null ? new Set<string>() : positionWithReports(positions, positionId)
  return [
    { value: '', label: 'En üst (raporlamaz)' },
    ...flattenOrgTree(buildOrgTree(units, positions)).flatMap(({ unit, depth }) =>
      positions
        .filter((position) => position.unitId === unit.id && !excluded.has(position.id))
        .map((position) => ({
          value: position.id,
          label: `${indent(depth)}${position.title} (${unit.name})`,
        })),
    ),
  ]
}

export type UnitFormValues = { name: string; kind: OrgUnitKind; parentId: string }

/** Birim düzeltme gövdesi: yalnız değişen alanlar (boş üst birim = kök). */
export function unitUpdateBody(
  unit: { name: string; kind: OrgUnitKind; parentId: string | null },
  values: UnitFormValues,
): { name?: string; kind?: OrgUnitKind; parentId?: string | null } {
  const parentId = values.parentId === '' ? null : values.parentId
  const name = values.name.trim()
  return {
    ...(name === unit.name ? {} : { name }),
    ...(values.kind === unit.kind ? {} : { kind: values.kind }),
    ...(parentId === unit.parentId ? {} : { parentId }),
  }
}

export type PositionFormValues = {
  unitId: string
  title: string
  headcount: string
  reportsTo: string
}

/** Kadro sayısı metni: yalnız rakam; değilse `NaN` (sunucu şeması alan hatası verir). */
export const parseHeadcount = (value: string) =>
  /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN

/** Pozisyon düzeltme gövdesi: yalnız değişen alanlar. */
export function positionUpdateBody(
  position: {
    unitId: string
    title: string
    headcount: number
    reportsToPositionId: string | null
  },
  values: PositionFormValues,
): {
  unitId?: string
  title?: string
  headcount?: number
  reportsToPositionId?: string | null
} {
  const title = values.title.trim()
  const headcount = parseHeadcount(values.headcount)
  const reportsToPositionId = values.reportsTo === '' ? null : values.reportsTo
  return {
    ...(values.unitId === position.unitId ? {} : { unitId: values.unitId }),
    ...(title === position.title ? {} : { title }),
    ...(headcount === position.headcount ? {} : { headcount }),
    ...(reportsToPositionId === position.reportsToPositionId ? {} : { reportsToPositionId }),
  }
}

/** Sunucu hata yolunu düzeltme formundaki alana çevirir; karşılığı yoksa `null`. */
export function positionFormField(name: string): keyof PositionFormValues | null {
  if (name === 'reportsToPositionId') return 'reportsTo'
  return name === 'unitId' || name === 'title' || name === 'headcount' ? name : null
}
