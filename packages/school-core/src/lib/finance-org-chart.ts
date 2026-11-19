import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { STAFF_ROLES } from './staff-accounts.ts'

/**
 * Organizasyon şeması (docs/domain/finans.md DOM-FIN-129; ON-187; K-442…K-444).
 *
 * - **Birim (K-442):** ad, üst birim, tür (yönetim, akademik zümre, idari, destek) ve etkinlik.
 *   Birimler ağaçtır: üst birim kendisi ya da kendi alt birimi olamaz (döngü), derinlik en çok
 *   `ORG_UNIT_DEPTH_MAX`. Etkin birim pasif birimin altına konmaz; etkin alt birimi ya da güncel
 *   veya ileri tarihli ataması olan birim pasife alınmaz. Aynı üst birimde aynı ad bir kez.
 * - **Pozisyon (K-443):** birim, unvan, kadro sayısı ve raporladığı pozisyon (raporlama hattı;
 *   döngü yok). Kadro planındaki açık pozisyon (DOM-FIN-126) branş × saatlik işe alım ihtiyacıdır,
 *   burada tekrar tanımlanmaz. Unvan rol değildir; yetki üyelik rolünden gelir (IST-006).
 * - **Atama (K-444):** kurum personel üyeliği × pozisyon, başlangıç ve isteğe bağlı bitiş günü
 *   (ikisi de dahil). Aynı personel aynı pozisyona çakışan aralıkla iki kez atanmaz; aynı günde
 *   pozisyondaki atama sayısı kadro sayısını aşmaz. Boş kadro = kadro sayısı − o gün süren atama.
 *
 * Fonksiyonlar saftır; gün `YYYY-MM-DD` (Europe/Istanbul) olarak dışarıdan verilir.
 */

/** Organizasyon şemasını yalnız yönetici okur ve yazar (K-444). */
export const FINANCE_ORG_CHART_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const ORG_UNIT_KINDS = [
  'management',
  'academic_department',
  'administrative',
  'support',
] as const
export type OrgUnitKind = (typeof ORG_UNIT_KINDS)[number]
export const ORG_UNIT_KIND_LABELS = {
  management: 'Yönetim',
  academic_department: 'Akademik zümre',
  administrative: 'İdari',
  support: 'Destek',
} as const satisfies Record<OrgUnitKind, string>

export const ORG_NAME_MIN = 2
export const ORG_NAME_MAX = 120
export const ORG_HEADCOUNT_MAX = 500
/** Kurum başına üst sınırlar; şema tek yanıtla (sayfasız) döner. */
export const ORG_UNITS_MAX = 300
export const ORG_POSITIONS_MAX = 1000
/** Kök birim 1. düzeydir. */
export const ORG_UNIT_DEPTH_MAX = 10

const nameSchema = (label: string) =>
  z
    .string(`${label} yazın.`)
    .trim()
    .min(ORG_NAME_MIN, `${label} en az ${String(ORG_NAME_MIN)} karakter olmalı.`)
    .max(ORG_NAME_MAX, `${label} en fazla ${String(ORG_NAME_MAX)} karakter olabilir.`)

const headcountSchema = z
  .number('Kadro sayısını girin.')
  .int('Kadro sayısı tam sayı olmalı.')
  .min(1, 'Kadro sayısı en az 1 olmalı.')
  .max(ORG_HEADCOUNT_MAX, `Kadro sayısı en fazla ${String(ORG_HEADCOUNT_MAX)} olabilir.`)
  .describe('Pozisyondaki kadro (aynı anda atanabilecek personel) sayısı')

// --- Şemalar ---------------------------------------------------------------------------------------

export const orgUnitInputSchema = z.strictObject({
  name: nameSchema('Birim adını').describe('Birimin adı; aynı üst birimde bir kez'),
  parentId: z
    .uuid('Üst birim geçersiz.')
    .nullable()
    .default(null)
    .describe('Üst birim; boşsa kök birim'),
  kind: z
    .enum(ORG_UNIT_KINDS, 'Birim türünü seçin.')
    .describe(
      '`management` yönetim, `academic_department` akademik zümre, `administrative` idari, `support` destek',
    ),
})
export type OrgUnitInput = z.output<typeof orgUnitInputSchema>

export const orgUnitUpdateSchema = z
  .strictObject({
    name: nameSchema('Birim adını').optional(),
    parentId: z.uuid('Üst birim geçersiz.').nullable().optional().describe('Boş: kök birim'),
    kind: z.enum(ORG_UNIT_KINDS, 'Birim türünü seçin.').optional(),
    isActive: z.boolean().optional().describe('Etkin ya da pasif'),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan gönderin.',
  })
export type OrgUnitUpdate = z.output<typeof orgUnitUpdateSchema>

export const orgPositionInputSchema = z.strictObject({
  unitId: z.uuid('Birim seçin.').describe('Pozisyonun birimi'),
  title: nameSchema('Unvanı').describe('Pozisyon unvanı; aynı birimde bir kez'),
  headcount: headcountSchema,
  reportsToPositionId: z
    .uuid('Raporladığı pozisyon geçersiz.')
    .nullable()
    .default(null)
    .describe('Raporladığı pozisyon (raporlama hattı); boşsa en üst'),
})
export type OrgPositionInput = z.output<typeof orgPositionInputSchema>

export const orgPositionUpdateSchema = z
  .strictObject({
    unitId: z.uuid('Birim seçin.').optional(),
    title: nameSchema('Unvanı').optional(),
    headcount: headcountSchema.optional(),
    reportsToPositionId: z.uuid('Raporladığı pozisyon geçersiz.').nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan gönderin.',
  })
export type OrgPositionUpdate = z.output<typeof orgPositionUpdateSchema>

export const orgAssignmentInputSchema = z
  .strictObject({
    positionId: z.uuid('Pozisyon seçin.').describe('Atanan pozisyon'),
    // kvkk: K (personel üyeliği)
    membershipId: z
      .string('Personel seçin.')
      .trim()
      .min(1, 'Personel seçin.')
      .max(100, 'Personel geçersiz.')
      .describe('Atanan personelin kurum üyeliği'),
    startDate: daySchema.describe('Başlangıç günü (YYYY-MM-DD, dahil)'),
    endDate: daySchema.nullable().default(null).describe('Bitiş günü (dahil); boşsa süresiz'),
  })
  .superRefine((value, ctx) => {
    if (value.endDate !== null && value.endDate < value.startDate)
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Bitiş günü başlangıçtan önce olamaz.',
      })
  })
export type OrgAssignmentInput = z.output<typeof orgAssignmentInputSchema>

export const orgAssignmentUpdateSchema = z.strictObject({
  endDate: daySchema.nullable().describe('Bitiş günü (dahil); boşsa süresiz'),
})

// --- Kurallar --------------------------------------------------------------------------------------

const rule = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })
const conflict = (code: string, message: string, path?: string) =>
  new DomainError(code, message, {
    kind: 'conflict',
    ...(path === undefined ? {} : { path: [path] }),
  })

/** Ad karşılaştırması: baştaki ve sondaki boşluk ile Türkçe büyük/küçük harf farkı yok sayılır. */
export const orgNameKey = (name: string) => name.trim().toLocaleLowerCase('tr-TR')

/** Aynı üst birimde aynı ad (K-442) ya da aynı birimde aynı unvan (K-443) 409. */
export function assertUniqueName(input: {
  name: string
  siblings: readonly string[]
  kind: 'unit' | 'position'
}): void {
  const key = orgNameKey(input.name)
  if (!input.siblings.some((sibling) => orgNameKey(sibling) === key)) return
  if (input.kind === 'unit')
    throw conflict('org_unit_name_taken', 'Bu üst birimde aynı adlı birim var.', 'name')
  throw conflict('org_position_title_taken', 'Bu birimde aynı unvanlı pozisyon var.', 'title')
}

export interface OrgUnitNode {
  id: string
  parentId: string | null
  isActive: boolean
}

/** Birimin üst zinciri (yakından uzağa); bozuk veride döngüye girmez. */
function ancestorsOf(units: ReadonlyMap<string, OrgUnitNode>, id: string): string[] {
  const chain: string[] = []
  const seen = new Set<string>([id])
  let current = units.get(id)?.parentId ?? null
  while (current !== null && !seen.has(current)) {
    chain.push(current)
    seen.add(current)
    current = units.get(current)?.parentId ?? null
  }
  return chain
}

/** Birimin altındaki en uzun dal (kendisi dahil, düzey sayısı). */
function subtreeHeight(units: readonly OrgUnitNode[], id: string): number {
  const children = new Map<string, string[]>()
  for (const unit of units)
    if (unit.parentId !== null)
      children.set(unit.parentId, [...(children.get(unit.parentId) ?? []), unit.id])
  const seen = new Set<string>()
  const height = (node: string): number => {
    if (seen.has(node)) return 0
    seen.add(node)
    return 1 + Math.max(0, ...(children.get(node) ?? []).map(height))
  }
  return height(id)
}

/**
 * Birimin üst birimi (K-442): üst birim kurumda olmalı, birimin kendisi ya da alt birimi olamaz,
 * derinlik sınırı aşılmaz, etkin birim pasif üst birime bağlanmaz. Yeni birimde `unitId` boştur.
 */
export function assertUnitPlacement(input: {
  unitId: string | null
  parentId: string | null
  active: boolean
  units: readonly OrgUnitNode[]
}): void {
  if (input.parentId === null) return
  const byId = new Map(input.units.map((unit) => [unit.id, unit]))
  const parent = byId.get(input.parentId)
  if (parent === undefined)
    throw rule('org_unit_parent_not_found', 'Üst birim bulunamadı.', 'parentId')
  if (input.unitId !== null) {
    if (input.parentId === input.unitId || ancestorsOf(byId, input.parentId).includes(input.unitId))
      throw rule(
        'org_unit_cycle',
        'Birim kendi altındaki bir birime bağlanamaz (döngü oluşur).',
        'parentId',
      )
  }
  const depth = ancestorsOf(byId, input.parentId).length + 2
  const height = input.unitId === null ? 1 : subtreeHeight(input.units, input.unitId)
  if (depth + height - 1 > ORG_UNIT_DEPTH_MAX)
    throw rule(
      'org_unit_too_deep',
      `Birim ağacı en fazla ${String(ORG_UNIT_DEPTH_MAX)} düzey olabilir.`,
      'parentId',
    )
  if (input.active && !parent.isActive)
    throw rule('org_unit_parent_inactive', 'Etkin birim pasif birimin altına konamaz.', 'parentId')
}

/** Birimi pasife alma (K-442): etkin alt birim ya da süren/ileri tarihli atama varken olmaz. */
export function assertUnitDeactivation(input: {
  activeChildren: number
  openAssignments: number
}): void {
  if (input.activeChildren > 0)
    throw rule(
      'org_unit_has_active_children',
      'Etkin alt birimi olan birim pasife alınamaz; önce alt birimleri pasife alın ya da taşıyın.',
      'isActive',
    )
  if (input.openAssignments > 0)
    throw rule(
      'org_unit_has_assignments',
      'Biriminde süren ya da başlayacak atama olan birim pasife alınamaz; önce atamaları bitirin.',
      'isActive',
    )
}

/** Pozisyon yalnız kurumun etkin birimine açılır ya da taşınır (K-443). */
export function assertPositionUnit(unit: { isActive: boolean } | null): void {
  if (unit === null) throw rule('org_position_unit_not_found', 'Birim bulunamadı.', 'unitId')
  if (!unit.isActive)
    throw rule('org_unit_inactive', 'Pasif birime pozisyon açılamaz ya da taşınamaz.', 'unitId')
}

export interface OrgPositionNode {
  id: string
  reportsToPositionId: string | null
}

/**
 * Raporlama hattı (K-443): raporlanan pozisyon kurumda (arşivsiz) olmalı; pozisyon kendisine ya da
 * kendisine raporlayan bir pozisyona raporlayamaz. Yeni pozisyonda `positionId` boştur.
 */
export function assertReportingLine(input: {
  positionId: string | null
  reportsToPositionId: string | null
  positions: readonly OrgPositionNode[]
}): void {
  if (input.reportsToPositionId === null) return
  const byId = new Map(input.positions.map((position) => [position.id, position]))
  if (!byId.has(input.reportsToPositionId))
    throw rule(
      'org_position_reports_to_not_found',
      'Raporladığı pozisyon bulunamadı.',
      'reportsToPositionId',
    )
  if (input.positionId === null) return
  const seen = new Set<string>()
  let current: string | null = input.reportsToPositionId
  while (current !== null && !seen.has(current)) {
    if (current === input.positionId)
      throw rule(
        'org_position_cycle',
        'Pozisyon kendisine ya da kendisine raporlayan bir pozisyona raporlayamaz.',
        'reportsToPositionId',
      )
    seen.add(current)
    current = byId.get(current)?.reportsToPositionId ?? null
  }
}

export interface DayRange {
  startDate: string
  endDate: string | null
}

/** İki gün aralığı kesişiyor mu (uçlar dahil; boş bitiş süresiz). */
export function rangesOverlap(a: DayRange, b: DayRange): boolean {
  return (
    (a.endDate === null || b.startDate <= a.endDate) &&
    (b.endDate === null || a.startDate <= b.endDate)
  )
}

const covers = (range: DayRange, day: string) =>
  range.startDate <= day && (range.endDate === null || day <= range.endDate)

/**
 * Pencere içinde aynı gün süren en çok atama sayısı. Eşzamanlılık yalnız bir atamanın başladığı
 * gün artar; bu yüzden pencerenin ilk günü ve pencere içindeki başlangıç günleri denenir.
 */
export function maxConcurrent(ranges: readonly DayRange[], window: DayRange): number {
  const days = [
    window.startDate,
    ...ranges.map((range) => range.startDate).filter((day) => covers(window, day)),
  ]
  let best = 0
  for (const day of days) {
    const count = ranges.filter((range) => covers(range, day)).length
    if (count > best) best = count
  }
  return best
}

/** Atama durumu: verilen güne göre süren, başlayacak ya da bitmiş. */
export const ORG_ASSIGNMENT_STATES = ['current', 'upcoming', 'past'] as const
export type OrgAssignmentState = (typeof ORG_ASSIGNMENT_STATES)[number]
export const ORG_ASSIGNMENT_STATE_LABELS = {
  current: 'Sürüyor',
  upcoming: 'Başlayacak',
  past: 'Bitti',
} as const satisfies Record<OrgAssignmentState, string>

export function assignmentState(range: DayRange, day: string): OrgAssignmentState {
  if (range.startDate > day) return 'upcoming'
  if (range.endDate !== null && range.endDate < day) return 'past'
  return 'current'
}

/** Verilen günde dolu ve boş kadro (K-444). */
export function positionFill(
  headcount: number,
  assignments: readonly DayRange[],
  day: string,
): { filled: number; vacant: number } {
  const filled = assignments.filter((range) => covers(range, day)).length
  return { filled, vacant: Math.max(0, headcount - filled) }
}

export interface OrgAssignmentStaff {
  role: string
  active: boolean
}

/** Atanacak personel (K-444): kurumun etkin yönetici, öğretmen ya da ön büro üyeliği. */
export function assertAssignmentStaff(staff: OrgAssignmentStaff | null): void {
  if (staff === null)
    throw rule('org_assignment_staff_not_found', 'Personel bu kurumda bulunamadı.', 'membershipId')
  if (!(STAFF_ROLES as readonly string[]).includes(staff.role))
    throw rule(
      'org_assignment_not_staff',
      'Yalnız yönetici, öğretmen ya da ön büro personeli atanır.',
      'membershipId',
    )
  if (!staff.active)
    throw rule(
      'org_assignment_staff_inactive',
      'Ayrılmış personel pozisyona atanamaz.',
      'membershipId',
    )
}

/**
 * Atama aralığı (K-444): aynı personelin aynı pozisyondaki başka atamasıyla kesişmez (409), aralık
 * boyunca hiçbir gün kadro sayısı aşılmaz (422). `others` pozisyonun bu atama dışındaki
 * (arşivsiz) atamalarıdır.
 */
export function assertAssignmentRange(input: {
  range: DayRange
  membershipId: string
  headcount: number
  others: readonly (DayRange & { membershipId: string })[]
}): void {
  if (input.range.endDate !== null && input.range.endDate < input.range.startDate)
    throw rule('org_assignment_end_before_start', 'Bitiş günü başlangıçtan önce olamaz.', 'endDate')
  if (
    input.others.some(
      (other) => other.membershipId === input.membershipId && rangesOverlap(other, input.range),
    )
  )
    throw conflict(
      'org_assignment_overlap',
      'Bu personel aynı tarihlerde bu pozisyona zaten atanmış.',
      'startDate',
    )
  if (maxConcurrent(input.others, input.range) + 1 > input.headcount)
    throw rule(
      'org_position_full',
      `Pozisyonun kadrosu (${String(input.headcount)}) bu tarihlerde dolu.`,
      'positionId',
    )
}

/** Kadro sayısı bugünden sonraki herhangi bir günün atama sayısının altına inmez (K-444). */
export function assertHeadcount(input: {
  headcount: number
  assignments: readonly DayRange[]
  today: string
}): void {
  const needed = maxConcurrent(input.assignments, { startDate: input.today, endDate: null })
  if (needed > input.headcount)
    throw rule(
      'org_position_headcount_below_assigned',
      `Kadro sayısı süren ya da başlayacak ${String(needed)} atamanın altına indirilemez.`,
      'headcount',
    )
}

/** Pozisyon kaldırma (arşiv; K-443): kendisine raporlayan pozisyon ya da süren atama varken olmaz. */
export function assertPositionArchivable(input: {
  reports: number
  openAssignments: number
}): void {
  if (input.reports > 0)
    throw rule(
      'org_position_has_reports',
      'Bu pozisyona raporlayan pozisyonlar var; önce raporlama hattını değiştirin.',
    )
  if (input.openAssignments > 0)
    throw rule(
      'org_position_has_assignments',
      'Süren ya da başlayacak ataması olan pozisyon kaldırılamaz; önce atamaları bitirin.',
    )
}

// --- Ağaç ------------------------------------------------------------------------------------------

export interface OrgTreeUnit extends OrgUnitNode {
  name: string
}
export interface OrgTreePosition extends OrgPositionNode {
  unitId: string
  title: string
}
export interface OrgTreeNode<U extends OrgTreeUnit, P extends OrgTreePosition> {
  unit: U
  depth: number
  positions: P[]
  children: OrgTreeNode<U, P>[]
}

const byName = (a: string, b: string) => a.localeCompare(b, 'tr')

/**
 * Görsel şema ağacı: birimler üst birime göre iç içe, kardeşler ada göre. Üst birimi listede
 * olmayan birim köktür (ör. pasifler gizlenince). Birim içinde birim dışına (ya da hiç)
 * raporlayan pozisyonlar önce, sonra unvana göre.
 */
export function buildOrgTree<U extends OrgTreeUnit, P extends OrgTreePosition>(
  units: readonly U[],
  positions: readonly P[],
): OrgTreeNode<U, P>[] {
  const ids = new Set(units.map((unit) => unit.id))
  const positionsByUnit = new Map<string, P[]>()
  for (const position of positions)
    positionsByUnit.set(position.unitId, [
      ...(positionsByUnit.get(position.unitId) ?? []),
      position,
    ])
  const unitOfPosition = new Map(positions.map((position) => [position.id, position.unitId]))
  const childrenOf = new Map<string | null, U[]>()
  for (const unit of units) {
    const parent = unit.parentId !== null && ids.has(unit.parentId) ? unit.parentId : null
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), unit])
  }
  const seen = new Set<string>()
  const build = (unit: U, depth: number): OrgTreeNode<U, P> => {
    seen.add(unit.id)
    const leads = (position: P) =>
      position.reportsToPositionId === null ||
      unitOfPosition.get(position.reportsToPositionId) !== unit.id
        ? 0
        : 1
    return {
      unit,
      depth,
      positions: [...(positionsByUnit.get(unit.id) ?? [])].sort(
        (a, b) => leads(a) - leads(b) || byName(a.title, b.title),
      ),
      children: [...(childrenOf.get(unit.id) ?? [])]
        .filter((child) => !seen.has(child.id))
        .sort((a, b) => byName(a.name, b.name))
        .map((child) => build(child, depth + 1)),
    }
  }
  return [...(childrenOf.get(null) ?? [])]
    .sort((a, b) => byName(a.name, b.name))
    .map((root) => build(root, 1))
}

/** Ağacı derinlik sırasıyla düzleştirir (seçim listeleri için). */
export function flattenOrgTree<U extends OrgTreeUnit, P extends OrgTreePosition>(
  tree: readonly OrgTreeNode<U, P>[],
): { unit: U; depth: number }[] {
  return tree.flatMap((node) => [
    { unit: node.unit, depth: node.depth },
    ...flattenOrgTree(node.children),
  ])
}

/** Birimin üstten alta yolu: "Okul müdürlüğü › Akademik birimler › Matematik zümresi". */
export function unitPath(units: readonly OrgTreeUnit[], unitId: string): string {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  const names = [unitId, ...ancestorsOf(byId, unitId)]
    .map((id) => byId.get(id)?.name)
    .filter((name): name is string => name !== undefined)
  return names.reverse().join(' › ')
}
