import { z } from 'zod'

import { CSV_SEPARATOR, csvCell } from './csv.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { COST_CENTER_GRADE_MAX, COST_CENTER_GRADE_MIN } from './finance-cost-centers.ts'
import {
  foldName,
  planStockIssueLines,
  STOCK_NOTE_MAX,
  type StockItemRef,
  type StockMovementContext,
} from './finance-inventory.ts'

/**
 * Kitap ve materyal seti dağıtımı (docs/domain/finans.md DOM-FIN-080; ON-232). Kurum bir eğitim yılı
 * için set tanımlar: ad, isteğe bağlı hedef (okulda sınıf düzeyi, dil okulunda kur) ve stok
 * kartlarından kalemler. Sete hedef verilirse set o düzeydeki (kurdaki) etkin öğrencilere
 * dağıtılır; verilmezse kurumun bütün etkin öğrencilerine.
 *
 * Teslim öğrenci başınadır: teslim alan (öğrencinin kendisi, kayıtlı veli ya da adı yazılan kişi),
 * teslim günü ve kâğıt imzanın alındığı işareti. Teslim seçilen depodan setin her kalemi için
 * `delivery` türünde stok çıkışı yazar (DOM-FIN-078; stok yetmezse 422 `stock_insufficient`, K-181).
 * Aynı öğrenciye aynı set iptal edilmemiş ikinci kez teslim edilmez. İptal gerekçeyle yapılır ve
 * stok çıkışlarını da iptal eder. Ücret tahsili bu işin parçası değildir: ödenmemiş materyal ücreti
 * teslimi engellemez (K-207).
 *
 * Fonksiyonlar saftır; zaman `today` parametresiyle gelir.
 */

/** Seti ve teslim listesini okuyan roller (K-205). */
export const MATERIAL_SET_READ_ROLES = ['yonetici', 'onburo'] as const
/** Seti tanımlayan ve düzelten rol (K-205). */
export const MATERIAL_SET_MANAGE_ROLES = ['yonetici'] as const
/** Teslimi ve imza işaretini yazan roller (K-205). */
export const MATERIAL_DELIVERY_ROLES = ['yonetici', 'onburo'] as const
/** Teslimi iptal eden rol (K-205; stok hareketi iptaliyle aynı, K-183). */
export const MATERIAL_DELIVERY_CANCEL_ROLES = ['yonetici'] as const

export const MATERIAL_SET_NAME_MAX = 120
export const MATERIAL_SET_ITEMS_MAX = 30
export const MATERIAL_SET_ITEM_QUANTITY_MAX = 100
export const MATERIAL_RECIPIENT_NAME_MAX = 120
export const MATERIAL_DELIVERY_NOTE_MAX = STOCK_NOTE_MAX
export const MATERIAL_CANCEL_REASON_MIN = 5
export const MATERIAL_CANCEL_REASON_MAX = 500
export const MATERIAL_SET_YEAR_MIN = 2000
export const MATERIAL_SET_YEAR_MAX = 2100
export const MATERIAL_SET_GRADE_MIN = COST_CENTER_GRADE_MIN
export const MATERIAL_SET_GRADE_MAX = COST_CENTER_GRADE_MAX

/** Teslimi alan kişi (K-206): öğrencinin kendisi, kayıtlı veli ya da adı yazılan kişi. */
export const MATERIAL_RECIPIENT_KINDS = ['student', 'guardian', 'other'] as const
export type MaterialRecipientKind = (typeof MATERIAL_RECIPIENT_KINDS)[number]
export const MATERIAL_RECIPIENT_KIND_LABELS = {
  student: 'Öğrencinin kendisi',
  guardian: 'Kayıtlı veli',
  other: 'Başka kişi',
} as const satisfies Record<MaterialRecipientKind, string>

/** Ücret kalemi türü: kitap ve kırtasiye (`stationery`, DOM-FIN-003; K-207). */
export const MATERIAL_FEE_KIND = 'stationery' as const

// --- Şemalar -------------------------------------------------------------------------------------

const nameSchema = z
  .string('Set adını yazın.')
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(MATERIAL_SET_NAME_MAX, `En fazla ${String(MATERIAL_SET_NAME_MAX)} karakter girebilirsiniz.`)
const academicYearSchema = z
  .number('Eğitim yılını seçin.')
  .int('Eğitim yılı geçersiz.')
  .min(MATERIAL_SET_YEAR_MIN, 'Eğitim yılı geçersiz.')
  .max(MATERIAL_SET_YEAR_MAX, 'Eğitim yılı geçersiz.')
const gradeLevelSchema = z
  .number('Sınıf düzeyi sayı olmalıdır.')
  .int('Sınıf düzeyi tam sayı olmalıdır.')
  .min(MATERIAL_SET_GRADE_MIN, `Sınıf düzeyi en az ${String(MATERIAL_SET_GRADE_MIN)} olabilir.`)
  .max(MATERIAL_SET_GRADE_MAX, `Sınıf düzeyi en çok ${String(MATERIAL_SET_GRADE_MAX)} olabilir.`)
  .nullable()
const courseIdSchema = z.uuid('Kur geçersiz.').nullable()

const itemSchema = z.strictObject({
  stockItemId: z.uuid('Stok kartını seçin.'),
  quantity: z
    .number('Adedi girin.')
    .int('Adet tam sayı olmalıdır.')
    .min(1, 'Adet en az 1 olmalıdır.')
    .max(
      MATERIAL_SET_ITEM_QUANTITY_MAX,
      `Adet en çok ${String(MATERIAL_SET_ITEM_QUANTITY_MAX)} olabilir.`,
    ),
})
const itemsSchema = z
  .array(itemSchema, 'Sete en az bir stok kartı ekleyin.')
  .min(1, 'Sete en az bir stok kartı ekleyin.')
  .max(MATERIAL_SET_ITEMS_MAX, `Sette en çok ${String(MATERIAL_SET_ITEMS_MAX)} kalem olabilir.`)
  .superRefine((items, ctx) => {
    const seen = new Set<string>()
    items.forEach((item, index) => {
      if (seen.has(item.stockItemId))
        ctx.addIssue({
          code: 'custom',
          path: [index, 'stockItemId'],
          message: 'Aynı stok kartı sette bir kez yer alır; adedi artırın.',
        })
      seen.add(item.stockItemId)
    })
  })
export type MaterialSetItemInput = z.output<typeof itemSchema>

const bothTargets = (
  value: { gradeLevel?: number | null | undefined; courseId?: string | null | undefined },
  ctx: z.RefinementCtx,
) => {
  if (
    value.gradeLevel !== undefined &&
    value.gradeLevel !== null &&
    value.courseId !== undefined &&
    value.courseId !== null
  )
    ctx.addIssue({
      code: 'custom',
      path: ['courseId'],
      message: 'Set ya sınıf düzeyine ya kura bağlanır.',
    })
}

export const materialSetSchema = z
  .strictObject({
    name: nameSchema,
    academicYear: academicYearSchema,
    gradeLevel: gradeLevelSchema.default(null),
    courseId: courseIdSchema.default(null),
    items: itemsSchema,
  })
  .superRefine(bothTargets)
export type MaterialSetInput = z.input<typeof materialSetSchema>
export type MaterialSetFields = z.output<typeof materialSetSchema>

export const updateMaterialSetSchema = z
  .strictObject({
    name: nameSchema,
    academicYear: academicYearSchema,
    gradeLevel: gradeLevelSchema,
    courseId: courseIdSchema,
    items: itemsSchema,
    isActive: z.boolean('Durumu seçin.'),
  })
  .partial()
  .superRefine(bothTargets)
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan gönderin.')
export type UpdateMaterialSetInput = z.input<typeof updateMaterialSetSchema>
export type MaterialSetChanges = z.output<typeof updateMaterialSetSchema>

const recipientNameSchema = z
  .string('Teslim alanın adını yazın.')
  .trim()
  .min(2, 'Teslim alanın adını en az 2 karakterle yazın.')
  .max(
    MATERIAL_RECIPIENT_NAME_MAX,
    `En fazla ${String(MATERIAL_RECIPIENT_NAME_MAX)} karakter girebilirsiniz.`,
  )

export const materialDeliverySchema = z
  .strictObject({
    studentId: z.string('Öğrenciyi seçin.').trim().min(1, 'Öğrenciyi seçin.').max(200),
    warehouseId: z.uuid('Depoyu seçin.'),
    deliveryDate: daySchema,
    recipientKind: z.enum(MATERIAL_RECIPIENT_KINDS, 'Teslim alanı seçin.'),
    guardianId: z.uuid('Veliyi seçin.').nullable().default(null),
    // kvkk: K — teslim alan kişinin adı (kayıtlı veli değilse)
    recipientName: z.string().nullable().default(null),
    signatureReceived: z.boolean('İmza durumunu seçin.'),
    note: z
      .string()
      .trim()
      .max(
        MATERIAL_DELIVERY_NOTE_MAX,
        `En fazla ${String(MATERIAL_DELIVERY_NOTE_MAX)} karakter girebilirsiniz.`,
      )
      .nullable()
      .default(null)
      .transform((value) => (value === '' ? null : value)),
  })
  .superRefine((value, ctx) => {
    if (value.recipientKind === 'guardian' && value.guardianId === null)
      ctx.addIssue({ code: 'custom', path: ['guardianId'], message: 'Veliyi seçin.' })
    if (value.recipientKind === 'other') {
      const parsed = recipientNameSchema.safeParse(value.recipientName ?? '')
      if (!parsed.success)
        ctx.addIssue({
          code: 'custom',
          path: ['recipientName'],
          message: parsed.error.issues[0]?.message ?? 'Teslim alanın adını yazın.',
        })
    }
  })
  .transform((value) => ({
    ...value,
    // Teslim alan türünün taşımadığı alan saklanmaz.
    guardianId: value.recipientKind === 'guardian' ? value.guardianId : null,
    recipientName: value.recipientKind === 'other' ? (value.recipientName ?? '').trim() : null,
  }))
export type MaterialDeliveryInput = z.input<typeof materialDeliverySchema>
export type MaterialDeliveryFields = z.output<typeof materialDeliverySchema>

export const cancelMaterialDeliverySchema = z.strictObject({
  reason: z
    .string('İptal gerekçesini yazın.')
    .trim()
    .min(MATERIAL_CANCEL_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(
      MATERIAL_CANCEL_REASON_MAX,
      `En fazla ${String(MATERIAL_CANCEL_REASON_MAX)} karakter girebilirsiniz.`,
    ),
})
export type CancelMaterialDeliveryInput = z.input<typeof cancelMaterialDeliverySchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: (string | number)[]) =>
  new DomainError(code, message, {
    kind: 'rule',
    ...(path ? { path: path.map(String) } : {}),
  })
const conflictError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'conflict', ...(path ? { path: [path] } : {}) })

export interface MaterialSetRef {
  id: string
  name: string
  academicYear: number
}

export interface MaterialSetContext {
  institutionType: string
  /** Kurumun bütün setleri (pasifler dahil); ad yıl içinde tekildir. */
  sets: readonly MaterialSetRef[]
  /** Gövdedeki stok kartları (bulunanlar). */
  items: ReadonlyMap<string, Pick<StockItemRef, 'id' | 'name' | 'isActive'>>
  /** Kurumun etkin kurları (dil okulu). */
  courseIds: ReadonlySet<string>
}

/** Set adı aynı eğitim yılında tekildir (Türkçe harf ve büyük/küçük harf duyarsız). */
function assertName(
  name: string,
  academicYear: number,
  id: string | null,
  ctx: MaterialSetContext,
) {
  const folded = foldName(name)
  if (
    ctx.sets.some(
      (set) => set.id !== id && set.academicYear === academicYear && foldName(set.name) === folded,
    )
  )
    throw conflictError(
      'material_set_name_exists',
      'Bu eğitim yılında bu adla bir set var.',
      'name',
    )
}

/** Hedef kurum türüne uygun olmalı: sınıf düzeyi okulda, kur dil okulunda (K-205). */
function assertTarget(
  target: { gradeLevel: number | null; courseId: string | null },
  ctx: MaterialSetContext,
) {
  if (target.gradeLevel !== null && ctx.institutionType !== 'school')
    throw ruleError(
      'material_set_target_unavailable',
      'Sınıf düzeyi yalnız okulda seçilir; dil okulunda seti kura bağlayın.',
      ['gradeLevel'],
    )
  if (target.courseId !== null) {
    if (ctx.institutionType !== 'language_school')
      throw ruleError(
        'material_set_target_unavailable',
        'Kur yalnız dil okulunda seçilir; okulda seti sınıf düzeyine bağlayın.',
        ['courseId'],
      )
    if (!ctx.courseIds.has(target.courseId))
      throw ruleError('material_set_course_not_found', 'Kur bulunamadı.', ['courseId'])
  }
}

/** Kalemlerin stok kartları kurumda var ve etkin olmalı. */
function assertItems(items: readonly MaterialSetItemInput[], ctx: MaterialSetContext) {
  items.forEach((line, index) => {
    const item = ctx.items.get(line.stockItemId)
    if (item === undefined)
      throw ruleError('stock_item_not_found', 'Stok kartı bulunamadı.', [
        'items',
        index,
        'stockItemId',
      ])
    if (!item.isActive)
      throw ruleError('stock_item_inactive', `${item.name} pasif; sete eklenmez.`, [
        'items',
        index,
        'stockItemId',
      ])
  })
}

/** Yeni set (DOM-FIN-080): ad yıl içinde tekil, hedef kurum türüne uygun, kartlar etkin. */
export function planMaterialSet(input: unknown, ctx: MaterialSetContext): MaterialSetFields {
  const data = materialSetSchema.parse(input)
  assertTarget(data, ctx)
  assertItems(data.items, ctx)
  assertName(data.name, data.academicYear, null, ctx)
  return data
}

export interface StoredMaterialSetRef extends MaterialSetRef {
  gradeLevel: number | null
  courseId: string | null
}

/**
 * Set düzeltmesi (K-208): ad, kalemler ve durum her zaman düzeltilir; teslim edilmiş setin eğitim
 * yılı ve hedefi değişmez (422 `material_set_has_deliveries`). Önceki teslimler kendi kalemlerini
 * korur.
 */
export function planMaterialSetUpdate(
  current: StoredMaterialSetRef,
  input: unknown,
  ctx: MaterialSetContext & { hasDeliveries: boolean },
): MaterialSetChanges {
  const changes = updateMaterialSetSchema.parse(input)
  const target = {
    gradeLevel: changes.gradeLevel === undefined ? current.gradeLevel : changes.gradeLevel,
    courseId: changes.courseId === undefined ? current.courseId : changes.courseId,
  }
  const academicYear = changes.academicYear ?? current.academicYear
  const moved =
    academicYear !== current.academicYear ||
    target.gradeLevel !== current.gradeLevel ||
    target.courseId !== current.courseId
  if (moved && ctx.hasDeliveries)
    throw ruleError(
      'material_set_has_deliveries',
      'Teslimi başlamış setin eğitim yılı ve hedefi değiştirilemez; yeni set açın.',
      [changes.academicYear !== undefined ? 'academicYear' : 'gradeLevel'],
    )
  if (target.gradeLevel !== current.gradeLevel || target.courseId !== current.courseId)
    assertTarget(target, ctx)
  if (changes.items !== undefined) assertItems(changes.items, ctx)
  if (changes.name !== undefined || academicYear !== current.academicYear)
    assertName(changes.name ?? current.name, academicYear, current.id, ctx)
  return changes
}

export interface DeliveryStudent {
  id: string
  isActive: boolean
  /** Setin hedefindeki (sınıf düzeyi, kur) öğrenci mi; hedefsiz sette her etkin öğrenci. */
  isEligible: boolean
}

export interface DeliveryGuardian {
  id: string
  name: string
  isContactRestricted: boolean
}

export interface MaterialDeliveryContext extends StockMovementContext {
  set: { id: string; name: string; isActive: boolean; items: readonly MaterialSetItemInput[] }
  student: DeliveryStudent | undefined
  /** Öğrencinin etkin veli bağları. */
  guardians: ReadonlyMap<string, DeliveryGuardian>
  /** Öğrenciye bu setin iptal edilmemiş teslimi var mı. */
  delivered: boolean
}

export interface PlannedDelivery {
  data: MaterialDeliveryFields
  /** Teslim alanın adı: kayıtlı velide velinin bugünkü adı, başka kişide yazılan ad. */
  recipientName: string | null
  lines: { itemId: string; quantity: number }[]
}

/**
 * Teslim (DOM-FIN-080): set etkin, öğrenci etkin ve setin hedefinde, aynı set iptal edilmemiş
 * ikinci kez teslim edilmez (409 `material_delivery_exists`). Kayıtlı veli öğrenciye bağlı ve
 * iletişim kısıtsız olmalı (K-206). Seçilen depodan her kalem için teslim gününde çıkış; stok
 * yetmezse 422 `stock_insufficient` (K-181). Ödenmemiş materyal ücreti teslimi engellemez (K-207).
 */
export function planMaterialDelivery(
  input: unknown,
  ctx: MaterialDeliveryContext,
): PlannedDelivery {
  const data = materialDeliverySchema.parse(input)
  if (!ctx.set.isActive)
    throw ruleError('material_set_inactive', `${ctx.set.name} pasif; teslim yazılmaz.`)
  if (ctx.student === undefined || !ctx.student.isActive)
    throw ruleError('material_delivery_student_not_found', 'Etkin bir öğrenci seçin.', [
      'studentId',
    ])
  if (!ctx.student.isEligible)
    throw ruleError(
      'material_delivery_student_not_eligible',
      'Öğrenci bu setin sınıf düzeyinde ya da kurunda değil.',
      ['studentId'],
    )
  if (ctx.delivered)
    throw conflictError(
      'material_delivery_exists',
      'Bu set öğrenciye zaten teslim edildi; önce önceki teslimi iptal edin.',
      'studentId',
    )
  let recipientName = data.recipientName
  if (data.recipientKind === 'guardian') {
    const guardian = ctx.guardians.get(data.guardianId ?? '')
    if (guardian === undefined)
      throw ruleError('material_delivery_guardian_not_found', 'Öğrencinin velisini seçin.', [
        'guardianId',
      ])
    if (guardian.isContactRestricted)
      throw ruleError(
        'material_delivery_guardian_restricted',
        'Bu veliye teslim yapılamaz; başka bir teslim alan seçin.',
        ['guardianId'],
      )
    recipientName = guardian.name
  }
  if (data.deliveryDate > ctx.today)
    throw ruleError('material_delivery_date_future', 'Teslim günü bugünden sonra olamaz.', [
      'deliveryDate',
    ])
  const lines = ctx.set.items.map((item) => ({ itemId: item.stockItemId, quantity: item.quantity }))
  planStockIssueLines(
    {
      warehouseId: data.warehouseId,
      day: data.deliveryDate,
      lines: lines.map((line) => ({ ...line, path: ['warehouseId'] })),
    },
    ctx,
    { warehouse: ['warehouseId'], day: ['deliveryDate'] },
  )
  return { data, recipientName, lines }
}

export interface DeliveryState {
  cancelledAt: string | null
  signatureReceived: boolean
}

/** Teslim iptali (K-209): gerekçeyle; stok çıkışları da iptal edilir. */
export function planMaterialDeliveryCancel(delivery: DeliveryState, input: unknown): string {
  const { reason } = cancelMaterialDeliverySchema.parse(input)
  if (delivery.cancelledAt !== null)
    throw ruleError('material_delivery_already_cancelled', 'Bu teslim zaten iptal edildi.')
  return reason
}

/** Kâğıt imzası sonradan getirildi (K-206): iptal edilmemiş ve imzası alınmamış teslimde. */
export function planMaterialDeliverySignature(delivery: DeliveryState): void {
  if (delivery.cancelledAt !== null)
    throw ruleError('material_delivery_cancelled', 'İptal edilmiş teslime imza işlenmez.')
  if (delivery.signatureReceived)
    throw ruleError('material_delivery_signature_exists', 'Bu teslimin imzası zaten alındı.')
}

/** Rolün materyal setinde yapabileceği işlemler (ekran düğmeleri; sunucu yeniden denetler). */
export function materialSetActions(role: string): {
  manage: boolean
  deliver: boolean
  sign: boolean
  cancel: boolean
} {
  const manager = role === 'yonetici'
  const desk = manager || role === 'onburo'
  return { manage: manager, deliver: desk, sign: desk, cancel: manager }
}

/** Setin hedef metni: `7. sınıf`, kur adı ya da `Bütün öğrenciler`. */
export function materialSetTargetLabel(set: {
  gradeLevel: number | null
  courseName?: string | null
}): string {
  if (set.gradeLevel !== null) return `${String(set.gradeLevel)}. sınıf`
  if (set.courseName) return set.courseName
  return 'Bütün öğrenciler'
}

// --- CSV -----------------------------------------------------------------------------------------

export interface MaterialStudentCsvRow {
  studentNumber: string | null
  studentName: string
  className: string | null
  hasMaterialFee: boolean
  delivery: {
    deliveryDate: string
    recipientKind: MaterialRecipientKind
    recipientName: string | null
    signatureReceived: boolean
    warehouseName: string
  } | null
}

const dayText = (day: string) => {
  const [year, month, date] = day.split('-')
  return `${date ?? ''}.${month ?? ''}.${year ?? ''}`
}

/**
 * Setin öğrenci listesi CSV'si (K-209): `;` ayırıcı, formül kaçışı. Öğrenci adı kişisel veridir;
 * dosya taze oturum ister ve denetime düşer (rota).
 */
export function materialSetStudentsCsv(rows: readonly MaterialStudentCsvRow[]): string {
  const header = [
    'Öğrenci no',
    'Öğrenci',
    'Sınıf',
    'Materyal ücreti',
    'Durum',
    'Teslim günü',
    'Teslim alan',
    'İmza',
    'Depo',
  ]
  const lines = rows.map((row) => {
    const delivery = row.delivery
    const recipient =
      delivery === null
        ? ''
        : delivery.recipientKind === 'student'
          ? MATERIAL_RECIPIENT_KIND_LABELS.student
          : `${delivery.recipientName ?? ''} (${MATERIAL_RECIPIENT_KIND_LABELS[delivery.recipientKind]})`
    return [
      row.studentNumber ?? '',
      row.studentName,
      row.className ?? '',
      row.hasMaterialFee ? 'Ücretli' : 'Ücret kalemi yok',
      delivery === null ? 'Teslim edilmedi' : 'Teslim edildi',
      delivery === null ? '' : dayText(delivery.deliveryDate),
      recipient,
      delivery === null ? '' : delivery.signatureReceived ? 'Alındı' : 'Bekliyor',
      delivery?.warehouseName ?? '',
    ]
      .map(csvCell)
      .join(CSV_SEPARATOR)
  })
  return [header.map(csvCell).join(CSV_SEPARATOR), ...lines].join('\r\n')
}
