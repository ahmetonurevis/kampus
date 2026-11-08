import { z } from 'zod'

import type { InstitutionType } from '../modules/collection-modules.ts'
import { DomainError } from './errors.ts'

/**
 * Maliyet merkezi (docs/domain/finans.md DOM-FIN-062; ON-242, IST-010). Kurum gelir ve giderini
 * kampüs, birim ve program merkezleri üzerinden planlar. Merkez silinmez, pasifleştirilir;
 * hiyerarşi en çok `COST_CENTER_MAX_DEPTH` düzeydir (K-66). Fonksiyonlar saftır: kurumun bütün
 * merkezleri, kampüs ve kur kimlikleri servisten gelir; karar burada verilir.
 */

export const COST_CENTER_TYPES = ['campus', 'unit', 'program'] as const
export type CostCenterType = (typeof COST_CENTER_TYPES)[number]

export const COST_CENTER_TYPE_LABELS = {
  campus: 'Kampüs',
  unit: 'Birim',
  program: 'Program',
} as const satisfies Record<CostCenterType, string>

/** Kök merkez 1. düzeydir; en derin merkez 4. düzeyde olur (K-66). */
export const COST_CENTER_MAX_DEPTH = 4
export const FINANCE_CODE_MAX = 20
export const FINANCE_NAME_MAX = 120
/** Okulda program merkezinin bağlanabildiği sınıf düzeyleri (sınıf şemasıyla aynı aralık). */
export const COST_CENTER_GRADE_MIN = 5
export const COST_CENTER_GRADE_MAX = 12

/**
 * Bütçe kodu: harf, rakam, `.`, `_`, `-`; büyük harfe çevrilir. Yalnız ASCII kabul edilir, böylece
 * büyük harfe çevirme yerel ayara bağlı olmaz (`i` → `I`).
 */
export const financeCodeSchema = z
  .string('Kodu yazın.')
  .trim()
  .min(1, 'Kodu yazın.')
  .max(FINANCE_CODE_MAX, `Kod en fazla ${String(FINANCE_CODE_MAX)} karakter olabilir.`)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    'Kod harf ya da rakamla başlar; yalnız harf, rakam, nokta, alt çizgi ve tire içerir.',
  )
  .toUpperCase()

export const financeNameSchema = z
  .string('Adı yazın.')
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(FINANCE_NAME_MAX, `En fazla ${String(FINANCE_NAME_MAX)} karakter girebilirsiniz.`)

const parentIdSchema = z.uuid('Üst merkez geçersiz.').nullable()
const campusIdSchema = z.string().trim().min(1, 'Kampüs seçin.').max(100).nullable()
const gradeLevelSchema = z
  .number('Sınıf düzeyi sayı olmalıdır.')
  .int('Sınıf düzeyi tam sayı olmalıdır.')
  .min(COST_CENTER_GRADE_MIN, `Sınıf düzeyi en az ${String(COST_CENTER_GRADE_MIN)} olabilir.`)
  .max(COST_CENTER_GRADE_MAX, `Sınıf düzeyi en çok ${String(COST_CENTER_GRADE_MAX)} olabilir.`)
  .nullable()
const courseIdSchema = z.uuid('Kur geçersiz.').nullable()

export interface CostCenterLink {
  campusId: string | null
  gradeLevel: number | null
  courseId: string | null
}

/** Türün taşıyabileceği bağ; yanlış alan dolu ya da zorunlu bağ eksikse alan yolu ve mesaj. */
function linkIssue(
  type: CostCenterType,
  link: CostCenterLink,
): { path: string; message: string } | null {
  if (type === 'campus') {
    if (link.campusId === null)
      return { path: 'campusId', message: 'Kampüs merkezine kampüs seçin.' }
    if (link.gradeLevel !== null)
      return { path: 'gradeLevel', message: 'Kampüs merkezi sınıf düzeyine bağlanmaz.' }
    if (link.courseId !== null)
      return { path: 'courseId', message: 'Kampüs merkezi kura bağlanmaz.' }
    return null
  }
  if (link.campusId !== null)
    return { path: 'campusId', message: 'Yalnız kampüs merkezi kampüse bağlanır.' }
  if (type === 'unit') {
    if (link.gradeLevel !== null)
      return { path: 'gradeLevel', message: 'Birim merkezi sınıf düzeyine bağlanmaz.' }
    if (link.courseId !== null)
      return { path: 'courseId', message: 'Birim merkezi kura bağlanmaz.' }
    return null
  }
  if (link.gradeLevel !== null && link.courseId !== null)
    return { path: 'courseId', message: 'Program ya sınıf düzeyine ya da kura bağlanır.' }
  return null
}

/** Yeni maliyet merkezi (DOM-FIN-062). Bağ alanları türe uymalıdır; boş bağ `null`. */
export const costCenterSchema = z
  .strictObject({
    code: financeCodeSchema,
    name: financeNameSchema,
    type: z.enum(COST_CENTER_TYPES, 'Merkez türünü seçin.'),
    parentId: parentIdSchema.default(null),
    campusId: campusIdSchema.default(null),
    gradeLevel: gradeLevelSchema.default(null),
    courseId: courseIdSchema.default(null),
  })
  .superRefine((value, context) => {
    const issue = linkIssue(value.type, value)
    if (issue) context.addIssue({ code: 'custom', path: [issue.path], message: issue.message })
  })
export type CostCenterInput = z.input<typeof costCenterSchema>
export type CostCenterFields = z.output<typeof costCenterSchema>

/** Kısmi düzeltme; tür değişmez. `isActive: false` pasifleştirir, `true` yeniden etkinleştirir. */
export const updateCostCenterSchema = z
  .strictObject({
    code: financeCodeSchema.optional(),
    name: financeNameSchema.optional(),
    parentId: parentIdSchema.optional(),
    campusId: campusIdSchema.optional(),
    gradeLevel: gradeLevelSchema.optional(),
    courseId: courseIdSchema.optional(),
    isActive: z.boolean('Etkinlik durumu açık ya da kapalı olmalıdır.').optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan girin.')
export type UpdateCostCenterInput = z.input<typeof updateCostCenterSchema>
export type CostCenterChanges = z.output<typeof updateCostCenterSchema>

export interface CostCenterNode extends CostCenterLink {
  id: string
  code: string
  name: string
  type: CostCenterType
  parentId: string | null
  isActive: boolean
}

export interface CostCenterContext {
  institutionType: InstitutionType
  /** Kurumun bütün merkezleri (pasifler dahil); merkez sayısı küçüktür, tamamı yüklenir. */
  centers: readonly CostCenterNode[]
  /** Arşivlenmemiş kampüs kimlikleri (`branches`). */
  campusIds: ReadonlySet<string>
  /** Arşivlenmemiş kur kimlikleri (`courses`; yalnız dil okulunda). */
  courseIds: ReadonlySet<string>
}

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })
const conflictError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'conflict', path: [path] })

/** Merkezin kök düzeyi 1 olmak üzere düzeyi; döngülü veride en çok merkez sayısı kadar yürür. */
function depthOf(byId: ReadonlyMap<string, CostCenterNode>, id: string | null): number {
  let depth = 0
  let cursor = id
  while (cursor !== null && depth <= byId.size) {
    depth += 1
    cursor = byId.get(cursor)?.parentId ?? null
  }
  return depth
}

/** Merkezin altındaki en derin dalın merkezin kendisi dahil düzey sayısı. */
function subtreeHeight(centers: readonly CostCenterNode[], id: string): number {
  const children = new Map<string, string[]>()
  for (const center of centers)
    if (center.parentId !== null) {
      const list = children.get(center.parentId)
      if (list) list.push(center.id)
      else children.set(center.parentId, [center.id])
    }
  const visit = (node: string, seen: Set<string>): number => {
    if (seen.has(node)) return 0
    seen.add(node)
    let deepest = 0
    for (const child of children.get(node) ?? []) deepest = Math.max(deepest, visit(child, seen))
    return deepest + 1
  }
  return visit(id, new Set())
}

/** `candidate` merkezin kendisi ya da altında mı (üst merkez seçiminde döngü denetimi). */
function isSelfOrDescendant(
  byId: ReadonlyMap<string, CostCenterNode>,
  id: string,
  candidate: string,
): boolean {
  let cursor: string | null = candidate
  let steps = 0
  while (cursor !== null && steps <= byId.size) {
    if (cursor === id) return true
    cursor = byId.get(cursor)?.parentId ?? null
    steps += 1
  }
  return false
}

interface CenterDraft extends CostCenterLink {
  id: string | null
  code: string
  type: CostCenterType
  parentId: string | null
  isActive: boolean
}

/**
 * Oluşturma ve düzeltmenin ortak denetimi. Sıra: bağ biçimi → kod tekilliği → üst merkez (var,
 * etkin, döngüsüz, düzey sınırı) → bağın varlığı ve kurum türü → bağ tekilliği.
 */
function assertCenter(draft: CenterDraft, ctx: CostCenterContext, checkParent: boolean): void {
  const issue = linkIssue(draft.type, draft)
  if (issue) throw ruleError('cost_center_link_invalid', issue.message, issue.path)
  const others = ctx.centers.filter((center) => center.id !== draft.id)
  if (others.some((center) => center.code === draft.code))
    throw conflictError(
      'cost_center_code_taken',
      'Bu kodla kayıtlı bir maliyet merkezi var.',
      'code',
    )

  const byId = new Map(ctx.centers.map((center) => [center.id, center]))
  if (checkParent && draft.parentId !== null) {
    const parent = byId.get(draft.parentId)
    if (parent === undefined)
      throw ruleError('cost_center_parent_not_found', 'Üst merkez bulunamadı.', 'parentId')
    if (!parent.isActive)
      throw ruleError(
        'cost_center_parent_inactive',
        'Pasif merkez üst merkez seçilemez.',
        'parentId',
      )
    if (draft.id !== null && isSelfOrDescendant(byId, draft.id, draft.parentId))
      throw ruleError(
        'cost_center_cycle',
        'Merkez kendisinin ya da alt merkezinin altına taşınamaz.',
        'parentId',
      )
    const height = draft.id === null ? 1 : subtreeHeight(ctx.centers, draft.id)
    if (depthOf(byId, draft.parentId) + height > COST_CENTER_MAX_DEPTH)
      throw ruleError(
        'cost_center_too_deep',
        `Merkez hiyerarşisi en çok ${String(COST_CENTER_MAX_DEPTH)} düzey olabilir.`,
        'parentId',
      )
  }

  if (draft.campusId !== null && !ctx.campusIds.has(draft.campusId))
    throw ruleError('cost_center_campus_not_found', 'Kampüs bulunamadı.', 'campusId')
  if (draft.gradeLevel !== null && ctx.institutionType !== 'school')
    throw ruleError(
      'cost_center_link_unavailable',
      'Sınıf düzeyi yalnız okulda seçilir; dil okulunda programı kura bağlayın.',
      'gradeLevel',
    )
  if (draft.courseId !== null) {
    if (ctx.institutionType !== 'language_school')
      throw ruleError(
        'cost_center_link_unavailable',
        'Kur yalnız dil okulunda seçilir; okulda programı sınıf düzeyine bağlayın.',
        'courseId',
      )
    if (!ctx.courseIds.has(draft.courseId))
      throw ruleError('cost_center_course_not_found', 'Kur bulunamadı.', 'courseId')
  }
  if (!draft.isActive) return
  const active = others.filter((center) => center.isActive)
  if (draft.campusId !== null && active.some((center) => center.campusId === draft.campusId))
    throw conflictError(
      'cost_center_campus_taken',
      'Bu kampüse bağlı etkin bir maliyet merkezi var.',
      'campusId',
    )
  const sameProgram = (center: CostCenterNode) =>
    center.type === 'program' &&
    center.parentId === draft.parentId &&
    ((draft.gradeLevel !== null && center.gradeLevel === draft.gradeLevel) ||
      (draft.courseId !== null && center.courseId === draft.courseId))
  if (draft.type === 'program' && active.some(sameProgram))
    throw conflictError(
      'cost_center_program_taken',
      'Aynı üst merkezde bu programa bağlı etkin bir merkez var.',
      draft.gradeLevel !== null ? 'gradeLevel' : 'courseId',
    )
}

/** Yeni merkez planı (DOM-FIN-062); yeni merkez etkindir. */
export function planCostCenter(input: unknown, ctx: CostCenterContext): CostCenterFields {
  const data = costCenterSchema.parse(input)
  assertCenter({ ...data, id: null, isActive: true }, ctx, true)
  return data
}

/**
 * Düzeltme planı: değişen alanlar. Pasifleştirmede altında etkin merkez olamaz; yeniden
 * etkinleştirmede üst merkez etkin olmalı ve kampüs bağı boşta olmalıdır.
 */
export function planCostCenterUpdate(
  current: CostCenterNode,
  input: unknown,
  ctx: CostCenterContext,
): CostCenterChanges {
  const changes = updateCostCenterSchema.parse(input)
  const next: CenterDraft = {
    id: current.id,
    code: changes.code ?? current.code,
    type: current.type,
    parentId: changes.parentId === undefined ? current.parentId : changes.parentId,
    campusId: changes.campusId === undefined ? current.campusId : changes.campusId,
    gradeLevel: changes.gradeLevel === undefined ? current.gradeLevel : changes.gradeLevel,
    courseId: changes.courseId === undefined ? current.courseId : changes.courseId,
    isActive: changes.isActive ?? current.isActive,
  }
  if (current.isActive && !next.isActive) {
    const activeChild = ctx.centers.some(
      (center) => center.parentId === current.id && center.isActive,
    )
    if (activeChild)
      throw ruleError(
        'cost_center_has_active_children',
        'Altında etkin merkez olan merkez pasifleştirilemez; önce alt merkezleri pasifleştirin.',
        'isActive',
      )
  }
  // Üst merkez yalnız değişince ya da merkez yeniden etkinleşince denetlenir: pasif üstün altında
  // kalan pasif merkezin adı düzeltilebilir.
  const reactivated = !current.isActive && next.isActive
  assertCenter(next, ctx, changes.parentId !== undefined || reactivated)
  return changes
}

/** Merkezin kökten kendisine kod yolu (`KAD / ORT / 7`); hiyerarşi gösterimi için. */
export function costCenterPath(
  byId: ReadonlyMap<string, Pick<CostCenterNode, 'code' | 'parentId'>>,
  id: string,
): string {
  const codes: string[] = []
  let cursor: string | null = id
  while (cursor !== null && codes.length <= byId.size) {
    const node = byId.get(cursor)
    if (node === undefined) break
    codes.unshift(node.code)
    cursor = node.parentId
  }
  return codes.join(' / ')
}
