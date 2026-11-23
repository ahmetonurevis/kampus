import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { addDays } from './academic-years.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'

/**
 * Yemek menüsü, besin değeri ve alerjen matrisi (docs/domain/finans.md DOM-FIN-157; ON-090,
 * ON-149; IST-099). Menü kurumun (isteğe bağlı kampüsün) bir haftasıdır: gün (Europe/Istanbul
 * takvim günü) × öğün (kahvaltı, öğle, ikindi ara öğünü; kurum ayarındakiler) × sıralı yemek
 * kalemleri. Kalem 14 alerjenin işaretlerini (Türk Gıda Kodeksi Gıda Etiketleme ve Tüketicileri
 * Bilgilendirme Yönetmeliği Ek-1) ve isteğe bağlı besin değerini taşır; besin değeri tamsayıdır
 * (enerji kcal, gramlar gramın onda biri, `…Dg`). Taslak menü görünmez, yayımlanan menü veli ve
 * öğrenciye görünür; yayımlanmış menünün geçmiş günü yalnız yöneticinin gerekçeli düzeltmesiyle
 * değişir (K-526…K-528).
 *
 * Kurumun eski iş akışı koleksiyonu (`mealMenus`; Oğuzhan'ın okul yaşamı ekranı) bu modelden
 * ayrıdır ve değişmez; modül anahtarı (`meals`) ve rol kapsamı ortaktır. Menü sağlık verisi
 * değildir; öğrencinin alerjisiyle eşleme bu modülde yoktur (ON-151). Fonksiyonlar saftır.
 */

/** Menü yazma ve yayımlama: yönetici ve ön büro (K-527). */
export const FINANCE_MEAL_MANAGE_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]
/** Yayımlanmış menünün geçmiş gününü gerekçeyle düzelten ve öğün ayarını değiştiren rol. */
export const FINANCE_MEAL_ADMIN_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Yayımlanmış haftalık menüyü okuyan aile rolleri; kampüs kapsamı sunucuda daralır. */
export const FINANCE_MEAL_FAMILY_ROLES = ['veli', 'ogrenci'] as const satisfies readonly Role[]

/** Öğünler; saklanan değer İngilizce anahtardır, gösterim sırası bu dizidir. */
export const MEAL_KINDS = ['breakfast', 'lunch', 'snack'] as const
export type MealKind = (typeof MEAL_KINDS)[number]
export const MEAL_KIND_LABELS = {
  breakfast: 'Kahvaltı',
  lunch: 'Öğle yemeği',
  snack: 'İkindi ara öğünü',
} as const satisfies Record<MealKind, string>
/** Hiç kaydedilmemiş kurum ayarında açık öğünler (K-526). */
export const DEFAULT_MEAL_KINDS: readonly MealKind[] = ['lunch']

/**
 * Alerjiye ya da intoleransa neden olan 14 madde (TGK Gıda Etiketleme ve Tüketicileri
 * Bilgilendirme Yönetmeliği Ek-1; AB 1169/2011 Ek II ile aynı liste). Sıra yönetmeliğin sırasıdır;
 * saklanan değer İngilizce anahtardır.
 */
export const ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const
export type Allergen = (typeof ALLERGENS)[number]
export const ALLERGEN_LABELS = {
  gluten: 'Gluten',
  crustaceans: 'Kabuklular',
  eggs: 'Yumurta',
  fish: 'Balık',
  peanuts: 'Yer fıstığı',
  soybeans: 'Soya',
  milk: 'Süt',
  nuts: 'Sert kabuklu yemişler',
  celery: 'Kereviz',
  mustard: 'Hardal',
  sesame: 'Susam',
  sulphites: 'Sülfit',
  lupin: 'Acı bakla',
  molluscs: 'Yumuşakçalar',
} as const satisfies Record<Allergen, string>
/** Yönetmelikteki tanımın kısa açıklaması (alerjen seçicide ipucu). */
export const ALLERGEN_HINTS = {
  gluten: 'Buğday, çavdar, arpa, yulaf, kavuz buğdayı, kamut ve ürünleri',
  crustaceans: 'Karides, yengeç, ıstakoz ve ürünleri',
  eggs: 'Yumurta ve ürünleri',
  fish: 'Balık ve ürünleri',
  peanuts: 'Yer fıstığı ve ürünleri',
  soybeans: 'Soya fasulyesi ve ürünleri',
  milk: 'Süt ve ürünleri (laktoz dahil)',
  nuts: 'Badem, fındık, ceviz, kaju, pikan, Brezilya cevizi, Antep fıstığı, makadamya',
  celery: 'Kereviz ve ürünleri',
  mustard: 'Hardal ve ürünleri',
  sesame: 'Susam tohumu ve ürünleri',
  sulphites: 'Kükürt dioksit ve sülfitler (10 mg/kg ya da 10 mg/L üzeri)',
  lupin: 'Acı bakla (lupin) ve ürünleri',
  molluscs: 'Midye, kalamar, ahtapot, salyangoz ve ürünleri',
} as const satisfies Record<Allergen, string>

export const MEAL_MENU_STATUSES = ['draft', 'published'] as const
export type MealMenuStatus = (typeof MEAL_MENU_STATUSES)[number]
export const MEAL_MENU_STATUS_LABELS = {
  draft: 'Taslak',
  published: 'Yayımlandı',
} as const satisfies Record<MealMenuStatus, string>

export const MEAL_WEEK_DAYS = 7
export const MEAL_ITEM_NAME_MAX = 120
export const MEAL_ITEMS_PER_SLOT_MAX = 10
export const MEAL_SLOTS_PER_UPDATE_MAX = MEAL_WEEK_DAYS * MEAL_KINDS.length
/** Bir kalemin enerjisi en çok 3000 kcal. */
export const MEAL_ENERGY_MAX_KCAL = 3000
/** Protein, yağ, karbonhidrat ve lif kalem başına en çok 500,0 g (5000 dg). */
export const MEAL_GRAMS_MAX_DG = 5000
/** Tuz kalem başına en çok 20,0 g (200 dg). */
export const MEAL_SALT_MAX_DG = 200
export const MEAL_CORRECTION_REASON_MIN = 10
export const MEAL_CORRECTION_REASON_MAX = 500
/** Menü en çok bu kadar gün ilerideki haftaya açılır. */
export const MEAL_WEEK_AHEAD_MAX_DAYS = 366

// --- Takvim --------------------------------------------------------------------------------------

/** ISO hafta günü (1 Pazartesi … 7 Pazar) bir takvim günü için. */
export function isoWeekday(day: string): number {
  const weekday = new Date(`${day}T12:00:00.000Z`).getUTCDay()
  return weekday === 0 ? 7 : weekday
}

/** Günün haftasının pazartesisi. */
export function mealWeekStartOf(day: string): string {
  return addDays(day, 1 - isoWeekday(day))
}

/** Haftanın günleri (pazartesiden pazara). */
export function mealWeekDays(weekStart: string): string[] {
  return Array.from({ length: MEAL_WEEK_DAYS }, (_, index) => addDays(weekStart, index))
}

export const mealWeekEnd = (weekStart: string) => addDays(weekStart, MEAL_WEEK_DAYS - 1)

// --- Şemalar -------------------------------------------------------------------------------------

const weekStartSchema = daySchema
  .refine((day) => !/^\d{4}-\d{2}-\d{2}$/.test(day) || isoWeekday(day) === 1, {
    message: 'Hafta pazartesi günüyle başlamalı.',
  })
  .describe('Haftanın pazartesisi (YYYY-MM-DD)')

const gramsSchema = (label: string, max: number) =>
  z
    .number(`${label} değerini girin.`)
    .int(`${label} gramın onda biri cinsinden tam sayı olmalı.`)
    .min(0, `${label} negatif olamaz.`)
    .max(max, `${label} en çok ${String(max / 10)} g olabilir.`)

export const mealNutritionSchema = z
  .strictObject({
    energyKcal: z
      .number('Enerjiyi girin.')
      .int('Enerji tam sayı (kcal) olmalı.')
      .min(0, 'Enerji negatif olamaz.')
      .max(MEAL_ENERGY_MAX_KCAL, `Enerji en çok ${String(MEAL_ENERGY_MAX_KCAL)} kcal olabilir.`)
      .describe('Enerji (kcal, tam sayı)'),
    proteinDg: gramsSchema('Protein', MEAL_GRAMS_MAX_DG).describe('Protein (dg: gram × 10)'),
    fatDg: gramsSchema('Yağ', MEAL_GRAMS_MAX_DG).describe('Yağ (dg: gram × 10)'),
    carbohydrateDg: gramsSchema('Karbonhidrat', MEAL_GRAMS_MAX_DG).describe(
      'Karbonhidrat (dg: gram × 10)',
    ),
    fiberDg: gramsSchema('Lif', MEAL_GRAMS_MAX_DG)
      .nullable()
      .describe('Lif (dg: gram × 10); bilinmiyorsa `null`'),
    saltDg: gramsSchema('Tuz', MEAL_SALT_MAX_DG)
      .nullable()
      .describe('Tuz (dg: gram × 10); bilinmiyorsa `null`'),
  })
  .describe('Porsiyon başına besin değeri; enerji, protein, yağ ve karbonhidrat birlikte girilir')
export type MealNutrition = z.output<typeof mealNutritionSchema>

export const mealItemSchema = z.strictObject({
  name: z
    .string('Yemek adını girin.')
    .trim()
    .min(2, 'Yemek adını en az 2 karakterle yazın.')
    .max(MEAL_ITEM_NAME_MAX, `En çok ${String(MEAL_ITEM_NAME_MAX)} karakter girebilirsiniz.`)
    .describe('Yemek adı (2–120)'),
  allergens: z
    .array(z.enum(ALLERGENS, 'Alerjen geçersiz.'), 'Alerjenleri seçin.')
    .max(ALLERGENS.length)
    .refine((list) => new Set(list).size === list.length, 'Aynı alerjen iki kez seçilmiş.')
    .describe('İçerdiği alerjenler (TGK Ek-1 listesi); boş liste işaretli alerjen yok demektir'),
  nutrition: mealNutritionSchema.nullable().describe('Besin değeri; bilinmiyorsa `null`'),
})
export type MealItemInput = z.input<typeof mealItemSchema>
export type MealItemFields = z.output<typeof mealItemSchema>

export const mealSlotSchema = z.strictObject({
  menuDate: daySchema.describe('Menü günü (YYYY-MM-DD, Europe/Istanbul); haftanın içinde'),
  mealKind: z.enum(MEAL_KINDS, 'Öğünü seçin.').describe('Öğün'),
  items: z
    .array(mealItemSchema)
    .max(
      MEAL_ITEMS_PER_SLOT_MAX,
      `Bir öğüne en çok ${String(MEAL_ITEMS_PER_SLOT_MAX)} yemek yazılır.`,
    )
    .describe('Öğünün yemekleri, sırasıyla; boş liste öğünü boşaltır'),
})
export type MealSlotFields = z.output<typeof mealSlotSchema>

export const mealMenuCreateSchema = z.strictObject({
  weekStart: weekStartSchema,
  branchId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .nullable()
    .optional()
    .describe('Kampüs (branches); boş ya da `null` bütün kampüsler'),
  copyFromMenuId: z
    .uuid('Kopyalanacak menü geçersiz.')
    .optional()
    .describe('Kalemleri kopyalanacak menü (ör. önceki hafta); günler yeni haftaya kaydırılır'),
})
export type MealMenuCreateFields = z.output<typeof mealMenuCreateSchema>

export const mealMenuUpdateSchema = z.strictObject({
  slots: z
    .array(mealSlotSchema, 'Değişen öğünleri girin.')
    .min(1, 'En az bir öğünü değiştirin.')
    .max(MEAL_SLOTS_PER_UPDATE_MAX)
    .refine(
      (slots) =>
        new Set(slots.map((slot) => `${slot.menuDate}|${slot.mealKind}`)).size === slots.length,
      'Aynı gün ve öğün iki kez gönderilmiş.',
    )
    .describe('Yeniden yazılan gün × öğün hücreleri; gönderilmeyen hücre değişmez'),
  correctionReason: z
    .string()
    .trim()
    .min(
      MEAL_CORRECTION_REASON_MIN,
      `Düzeltme gerekçesini en az ${String(MEAL_CORRECTION_REASON_MIN)} karakterle yazın.`,
    )
    .max(
      MEAL_CORRECTION_REASON_MAX,
      `En çok ${String(MEAL_CORRECTION_REASON_MAX)} karakter girebilirsiniz.`,
    )
    .optional()
    .describe(
      'Yayımlanmış menünün geçmiş gününü düzeltirken zorunlu gerekçe (10–500; yalnız yönetici)',
    ),
})
export type MealMenuUpdateFields = z.output<typeof mealMenuUpdateSchema>

export const mealMenuSettingsSchema = z.strictObject({
  mealKinds: z
    .array(z.enum(MEAL_KINDS, 'Öğün geçersiz.'), 'Öğünleri seçin.')
    .min(1, 'En az bir öğün seçin.')
    .max(MEAL_KINDS.length)
    .refine((list) => new Set(list).size === list.length, 'Aynı öğün iki kez seçilmiş.')
    .describe('Kurumun kullandığı öğünler'),
})
export type MealMenuSettingsFields = z.output<typeof mealMenuSettingsSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'rule', path })
const conflict = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'conflict', path })

/** Öğünleri ayar sırasıyla (gösterim sırası) döndürür. */
export function orderedMealKinds(kinds: readonly MealKind[]): MealKind[] {
  return MEAL_KINDS.filter((kind) => kinds.includes(kind))
}

/** Kampüs seçimi: seçilmediyse `undefined`, kurumda yoksa `null`. */
export type BranchCheck = { name: string } | null | undefined

/** Menüde saklanan kalem (kimliksiz; sıra 0 tabanlı). */
export interface MealItemValue {
  menuDate: string
  mealKind: MealKind
  position: number
  name: string
  allergens: readonly Allergen[]
  nutrition: MealNutrition | null
}

/**
 * Yeni haftalık menü (K-526): hafta tamamen geçmişte olamaz ve en çok bir yıl ileridedir;
 * kampüs kurumda olmalı; aynı hafta ve kampüs için ikinci etkin menü 409. Kopya kaynağı verildiyse
 * kalemleri yeni haftaya kaydırılır; kurumun kapalı öğünündeki kalemler kopyalanmaz.
 */
export function planMealMenuCreate(
  input: MealMenuCreateFields,
  checks: {
    today: string
    branch: BranchCheck
    exists: boolean
    enabledKinds: readonly MealKind[]
    source?: { weekStart: string; items: readonly MealItemValue[] } | null | undefined
  },
): { items: MealItemValue[] } {
  if (mealWeekEnd(input.weekStart) < checks.today)
    throw ruleError('meal_menu_week_past', 'Geçmiş bir haftaya menü açılamaz.', ['weekStart'])
  if (input.weekStart > addDays(checks.today, MEAL_WEEK_AHEAD_MAX_DAYS))
    throw ruleError('meal_menu_week_too_far', 'Menü en çok bir yıl sonrasına açılabilir.', [
      'weekStart',
    ])
  if (checks.branch === null)
    throw ruleError('meal_menu_branch_not_found', 'Kampüs bulunamadı.', ['branchId'])
  if (checks.exists)
    throw conflict('meal_menu_exists', 'Bu hafta ve kampüs için menü zaten var.', ['weekStart'])
  if (input.copyFromMenuId === undefined) return { items: [] }
  if (checks.source === null || checks.source === undefined)
    throw ruleError('meal_menu_source_not_found', 'Kopyalanacak menü bulunamadı.', [
      'copyFromMenuId',
    ])
  return { items: shiftMealItems(checks.source.items, input.weekStart, checks.enabledKinds) }
}

/**
 * Kaynak menünün kalemlerini hedef haftaya taşır: her kalem haftadaki aynı güne (pazartesi →
 * pazartesi) geçer; kapalı öğün atlanır, sıra korunur.
 */
export function shiftMealItems(
  items: readonly MealItemValue[],
  targetWeekStart: string,
  enabledKinds: readonly MealKind[],
): MealItemValue[] {
  return items
    .filter((item) => enabledKinds.includes(item.mealKind))
    .map((item) => ({
      ...item,
      menuDate: addDays(targetWeekStart, isoWeekday(item.menuDate) - 1),
      allergens: [...item.allergens],
    }))
}

const slotKey = (menuDate: string, mealKind: MealKind) => `${menuDate}|${mealKind}`

const sameItem = (a: MealItemValue, b: MealItemValue) =>
  a.name === b.name &&
  a.allergens.length === b.allergens.length &&
  a.allergens.every((allergen) => b.allergens.includes(allergen)) &&
  JSON.stringify(a.nutrition) === JSON.stringify(b.nutrition)

/** Alerjenleri yönetmelik sırasına koyar (saklama ve karşılaştırma kararlı olur). */
export const orderedAllergens = (list: readonly Allergen[]): Allergen[] =>
  ALLERGENS.filter((allergen) => list.includes(allergen))

export interface MealMenuUpdatePlan {
  /** Yeniden yazılacak hücreler (değişmeyen hücre listede yok). */
  slots: { menuDate: string; mealKind: MealKind; items: MealItemValue[] }[]
  /** Gerekçeli düzeltmeye düşen hücreler (yayımlanmış menünün geçmiş günleri). */
  corrections: { menuDate: string; mealKind: MealKind }[]
}

/**
 * Menü düzenleme (K-527): hücre haftanın içinde ve kurumun açık öğününde olmalı. Taslağın her
 * hücresi değişir. Yayımlanmış menüde bugünden önceki gün yalnız yöneticinin gerekçeli
 * düzeltmesidir (gerekçe yok 422 `meal_menu_day_past`, yönetici değil 403); gerekçe yalnız geçmiş
 * günde kabul edilir. Değişmeyen hücreler atlanır; hiçbiri değişmediyse 422.
 */
export function planMealMenuUpdate(
  menu: { weekStart: string; status: MealMenuStatus; items: readonly MealItemValue[] },
  input: MealMenuUpdateFields,
  checks: { today: string; enabledKinds: readonly MealKind[]; role: Role },
): MealMenuUpdatePlan {
  const days = new Set(mealWeekDays(menu.weekStart))
  const current = new Map<string, MealItemValue[]>()
  for (const item of menu.items) {
    const key = slotKey(item.menuDate, item.mealKind)
    current.set(key, [...(current.get(key) ?? []), item])
  }
  const plan: MealMenuUpdatePlan = { slots: [], corrections: [] }
  input.slots.forEach((slot, index) => {
    const path = ['slots', String(index)]
    if (!days.has(slot.menuDate))
      throw ruleError('meal_menu_date_outside_week', 'Gün menünün haftasında değil.', [
        ...path,
        'menuDate',
      ])
    if (!checks.enabledKinds.includes(slot.mealKind))
      throw ruleError('meal_kind_disabled', 'Bu öğün kurumda kullanılmıyor.', [...path, 'mealKind'])
    const items = slot.items.map((item, position): MealItemValue => ({
      menuDate: slot.menuDate,
      mealKind: slot.mealKind,
      position,
      name: item.name,
      allergens: orderedAllergens(item.allergens),
      nutrition: item.nutrition,
    }))
    const before = [...(current.get(slotKey(slot.menuDate, slot.mealKind)) ?? [])].sort(
      (a, b) => a.position - b.position,
    )
    const unchanged =
      before.length === items.length &&
      before.every((item, position) => {
        const next = items[position]
        return next !== undefined && sameItem(item, next)
      })
    if (unchanged) return
    if (menu.status === 'published' && slot.menuDate < checks.today)
      plan.corrections.push({ menuDate: slot.menuDate, mealKind: slot.mealKind })
    plan.slots.push({ menuDate: slot.menuDate, mealKind: slot.mealKind, items })
  })
  if (plan.slots.length === 0) throw ruleError('meal_menu_unchanged', 'Menüde değişiklik yok.')
  if (plan.corrections.length > 0) {
    if (input.correctionReason === undefined)
      throw ruleError(
        'meal_menu_day_past',
        'Yayımlanmış menünün geçmiş günü değiştirilemez; düzeltme için gerekçe yazın.',
        ['correctionReason'],
      )
    if (checks.role !== 'yonetici')
      throw new DomainError(
        'meal_menu_correction_forbidden',
        'Geçmiş günün düzeltmesini yalnız yönetici yapar.',
        { kind: 'forbidden', path: ['correctionReason'] },
      )
  } else if (input.correctionReason !== undefined)
    throw ruleError(
      'meal_menu_correction_not_needed',
      'Gerekçe yalnız yayımlanmış menünün geçmiş günü düzeltilirken yazılır.',
      ['correctionReason'],
    )
  return plan
}

/** Yayımlama (K-527): yalnız taslak ve en az bir yemeği olan menü. */
export function assertMealMenuPublishable(status: MealMenuStatus, itemCount: number): void {
  if (status !== 'draft')
    throw ruleError('meal_menu_not_draft', 'Menü zaten yayımlanmış.', ['status'])
  if (itemCount === 0)
    throw ruleError('meal_menu_empty', 'Yemeği olmayan menü yayımlanamaz.', ['slots'])
}

/** Yayımdan kaldırma (K-527): yalnız hafta başlamadan; başlamış haftanın menüsü yayında kalır. */
export function assertMealMenuUnpublishable(
  menu: { status: MealMenuStatus; weekStart: string },
  today: string,
): void {
  if (menu.status !== 'published')
    throw ruleError('meal_menu_not_published', 'Menü yayımlanmamış.', ['status'])
  if (menu.weekStart <= today)
    throw ruleError(
      'meal_menu_week_started',
      'Haftası başlamış menü yayımdan kaldırılamaz; değişiklik için düzenleyin.',
      ['status'],
    )
}

/** Arşiv (K-527): yayımlanmış menü silinmez; yalnız taslak arşivlenir. */
export function assertMealMenuArchivable(status: MealMenuStatus): void {
  if (status !== 'draft')
    throw ruleError('meal_menu_published', 'Yayımlanmış menü silinemez; önce yayımdan kaldırın.', [
      'status',
    ])
}

/** Öğün ayarı (K-526): değişiklik yoksa 422. */
export function planMealMenuSettings(
  current: readonly MealKind[],
  input: MealMenuSettingsFields,
): MealKind[] {
  const next = orderedMealKinds(input.mealKinds)
  const before = orderedMealKinds(current)
  if (next.length === before.length && next.every((kind, index) => kind === before[index]))
    throw ruleError('meal_menu_settings_unchanged', 'Öğün ayarında değişiklik yok.')
  return next
}

/**
 * Aile görünümünde kampüs başına menü (K-526): kampüsün yayımlanmış kendi menüsü, yoksa bütün
 * kampüslerin yayımlanmış menüsü. Kampüsü bilinmeyen öğrenci (sınıfsız) bütün kampüs menüsünü görür.
 */
export function familyMenuFor<T extends { branchId: string | null; status: MealMenuStatus }>(
  menus: readonly T[],
  branchId: string | null,
): T | undefined {
  const published = menus.filter((menu) => menu.status === 'published')
  return (
    (branchId === null ? undefined : published.find((menu) => menu.branchId === branchId)) ??
    published.find((menu) => menu.branchId === null)
  )
}

// --- Hesap ve görünüm ----------------------------------------------------------------------------

export interface MealDayTotals {
  menuDate: string
  itemCount: number
  /** Besin değeri girilmemiş kalem sayısı; toplamlar yalnız girilmiş kalemlerdendir. */
  missingNutrition: number
  energyKcal: number
  proteinDg: number
  fatDg: number
  carbohydrateDg: number
  /** Besin değeri olan kalemlerden lif değeri bilinenlerin toplamı. */
  fiberDg: number
  /** Besin değeri olup lif değeri bilinmeyen kalem sayısı. */
  missingFiber: number
  saltDg: number
  missingSalt: number
}

/**
 * Günlük besin toplamı (K-528): günün bütün öğünlerindeki kalemlerin porsiyon değerleri toplanır;
 * besin değeri girilmemiş kalem ve lif/tuzu bilinmeyen kalem ayrıca sayılır. Sonuç haftanın günleri
 * sırasıyla, kalemi olmayan gün sıfırdır. Saklanmaz.
 */
export function mealDayTotals(
  weekStart: string,
  items: readonly Pick<MealItemValue, 'menuDate' | 'nutrition'>[],
): MealDayTotals[] {
  return mealWeekDays(weekStart).map((menuDate) => {
    const day = items.filter((item) => item.menuDate === menuDate)
    const totals: MealDayTotals = {
      menuDate,
      itemCount: day.length,
      missingNutrition: 0,
      energyKcal: 0,
      proteinDg: 0,
      fatDg: 0,
      carbohydrateDg: 0,
      fiberDg: 0,
      missingFiber: 0,
      saltDg: 0,
      missingSalt: 0,
    }
    for (const { nutrition } of day) {
      if (nutrition === null) {
        totals.missingNutrition += 1
        continue
      }
      totals.energyKcal += nutrition.energyKcal
      totals.proteinDg += nutrition.proteinDg
      totals.fatDg += nutrition.fatDg
      totals.carbohydrateDg += nutrition.carbohydrateDg
      if (nutrition.fiberDg === null) totals.missingFiber += 1
      else totals.fiberDg += nutrition.fiberDg
      if (nutrition.saltDg === null) totals.missingSalt += 1
      else totals.saltDg += nutrition.saltDg
    }
    return totals
  })
}

export interface MealAllergenMatrixRow {
  menuDate: string
  mealKind: MealKind
  position: number
  name: string
  /** 14 alerjenin her biri için işaret, `ALLERGENS` sırasıyla. */
  marks: boolean[]
}

/**
 * Alerjen matrisi (K-528): gün × kalem satırları ve 14 alerjen sütunu. Satırlar gün, öğün
 * (`MEAL_KINDS` sırası) ve kalem sırasıyla; `dayAllergens` günün herhangi bir kaleminde geçen
 * alerjenlerdir.
 */
export function mealAllergenMatrix(
  items: readonly Pick<
    MealItemValue,
    'menuDate' | 'mealKind' | 'position' | 'name' | 'allergens'
  >[],
): { rows: MealAllergenMatrixRow[]; dayAllergens: Map<string, Allergen[]> } {
  const rows = [...items]
    .sort(
      (a, b) =>
        a.menuDate.localeCompare(b.menuDate) ||
        MEAL_KINDS.indexOf(a.mealKind) - MEAL_KINDS.indexOf(b.mealKind) ||
        a.position - b.position,
    )
    .map((item) => ({
      menuDate: item.menuDate,
      mealKind: item.mealKind,
      position: item.position,
      name: item.name,
      marks: ALLERGENS.map((allergen) => item.allergens.includes(allergen)),
    }))
  const dayAllergens = new Map<string, Allergen[]>()
  for (const row of rows) {
    const present = new Set(dayAllergens.get(row.menuDate) ?? [])
    ALLERGENS.forEach((allergen, index) => {
      if (row.marks[index] === true) present.add(allergen)
    })
    dayAllergens.set(row.menuDate, orderedAllergens([...present]))
  }
  return { rows, dayAllergens }
}

/** Gramın onda biri → `12,5 g` (Türkçe ondalık). */
export function decigramText(value: number): string {
  const whole = Math.trunc(value / 10)
  const tenth = Math.abs(value % 10)
  return tenth === 0 ? `${String(whole)} g` : `${String(whole)},${String(tenth)} g`
}

/**
 * Kullanıcının yazdığı gramı (`12,5`, `12.5`, `12`) gramın onda birine çevirir; en çok bir ondalık.
 * Boş metin `null`, geçersiz değer `undefined`.
 */
export function parseDecigrams(text: string): number | null | undefined {
  const value = text.trim().replace(',', '.')
  if (value === '') return null
  if (!/^\d{1,4}(\.\d)?$/.test(value)) return undefined
  const [whole = '0', tenth = '0'] = value.split('.')
  return Number(whole) * 10 + Number(tenth)
}
