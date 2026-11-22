import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { addDays } from './academic-years.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { MEAL_KINDS, orderedAllergens, type Allergen, type MealKind } from './finance-meal-menus.ts'
import type { AllergySeverity } from './health-profile.ts'

/**
 * Yemekhane alerji uyarısı (docs/domain/finans.md DOM-FIN-162; ON-151; K-541…K-543; H-117). Servis
 * sırasında görevli, seçilen gün, öğün ve sınıfta (ya da sınıf düzeyinde) **yalnız uyarısı olan**
 * öğrencileri görür: ad, sınıf, hangi yemekte hangi alerjen. Öğrencinin alerjisi sağlık profilinin
 * serbest metnidir (DOM-ILT-035, şiddetiyle); menü kaleminin alerjenleri TGK Ek-1'in 14 maddesidir
 * (DOM-FIN-157). Bu modül ikisini eşler:
 *
 * - Eşleme (K-541): alerji adı küçük harfe ve aksansız yazıma çevrilir, ayraçlarla (virgül, "ve",
 *   "veya", "ile", `/`, `+`) parçalara bölünür; her parça sözlükteki kalıplarla (kelime başı;
 *   "yer fıstığı" gibi çok kelimeli kalıplar önce) 14 alerjene eşlenir. Belirsiz ad korumacı
 *   eşlenir ("fıstık" yer fıstığı ve sert kabuklu yemiş, "deniz ürünü" balık, kabuklu ve
 *   yumuşakça). İlaç, polen, böcek, hayvan, lateks ve ev tozu gibi besin dışı alerjiler yemekhane
 *   listesine girmez. Kalıpla eşlenmeyen anlamlı kelime kalan parça **eşlenemedi** sayılır;
 *   eşlenemeyen alerji "menüyle karşılaştırılamadı, elle kontrol" diye ayrı döner, sessizce düşmez.
 * - Uyarı (K-542): kalem başına öğrencinin eşlenen alerjenleriyle kalemin alerjenlerinin kesişimi;
 *   şiddet o alerjeni veren alerjilerin en ağırıdır. Öğünde yemek yoksa uyarı yoktur. Teşhis, ilaç,
 *   not ve eşlenen alerjinin adı dönmez; yalnız eşlenemeyen alerjinin adı elle kontrol için döner.
 * - Görevli onayı (K-543): "uyarı görüldü, alternatif verildi" işareti yalnız bugünün (Europe/
 *   Istanbul) öğününde, uyarısı olan öğrenci için ve öğrenci × gün × öğün başına bir kez yazılır;
 *   kayıt değişmez.
 *
 * Fonksiyonlar saftır; kayıtları ve bugünü çağıran verir.
 */

/** Servis listesini okuyan ve onay işaretini yazan roller (K-543; yemekhane görevlisi rolü yok). */
export const MEAL_ALLERGY_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]

/** Liste bugünden en çok bu kadar gün ileriye açılır (mutfak hazırlığı); geçmiş gün açılmaz. */
export const MEAL_ALLERGY_DAYS_AHEAD = 7

/** Şiddet sırası: büyük olan daha ağır. */
export const ALLERGY_SEVERITY_RANK = {
  mild: 1,
  moderate: 2,
  severe: 3,
} as const satisfies Record<AllergySeverity, number>

const heavier = (a: AllergySeverity, b: AllergySeverity): AllergySeverity =>
  ALLERGY_SEVERITY_RANK[b] > ALLERGY_SEVERITY_RANK[a] ? b : a

// --- Eşleme sözlüğü ------------------------------------------------------------------------------

/**
 * Kalıplar: boşlukla ayrılmış kelimeler; her kelime ad parçasının ardışık kelimelerinin **başıyla**
 * eşleşir (Türkçe ek alır: "sütü", "fındığa" → `sut`, `findi`), `.` ile biten kelime tam eşleşir.
 * Yazım aksansız ve küçük harftir (`normalizeAllergyText`). Sıra önemlidir: çok kelimeli ve özel
 * kalıplar (ör. "yer fıstığı", "sert kabuklu") genel olandan önce gelir, eşleşen kelime bir daha
 * kullanılmaz.
 */
const FOOD_PATTERNS: readonly (readonly [string, readonly Allergen[]])[] = [
  // Yer fıstığı ve sert kabuklu yemişler (fıstık tek başına ikisi de: korumacı).
  ['yer fisti', ['peanuts']],
  ['yerfisti', ['peanuts']],
  ['peanut', ['peanuts']],
  ['antep fisti', ['nuts']],
  ['antepfisti', ['nuts']],
  ['sam fisti', ['nuts']],
  ['brezilya ceviz', ['nuts']],
  ['sert kabuklu', ['nuts']],
  ['kuruyemis', ['nuts', 'peanuts']],
  ['kuru yemis', ['nuts', 'peanuts']],
  ['fisti', ['peanuts', 'nuts']],
  ['findi', ['nuts']],
  ['ceviz', ['nuts']],
  ['badem', ['nuts']],
  ['kaju', ['nuts']],
  ['pikan', ['nuts']],
  ['makadamya', ['nuts']],
  ['hazelnut', ['nuts']],
  ['walnut', ['nuts']],
  ['almond', ['nuts']],
  ['cashew', ['nuts']],
  ['pistachio', ['nuts']],
  ['nut.', ['nuts']],
  ['nuts.', ['nuts']],
  // Deniz ürünleri: "kabuklu deniz" kabuklular ve yumuşakçalar; genel "deniz ürünü" balık da.
  ['kabuklu deniz', ['crustaceans', 'molluscs']],
  ['deniz urun', ['fish', 'crustaceans', 'molluscs']],
  ['deniz mahsul', ['fish', 'crustaceans', 'molluscs']],
  ['seafood', ['fish', 'crustaceans', 'molluscs']],
  ['shellfish', ['crustaceans', 'molluscs']],
  ['karides', ['crustaceans']],
  ['yengec', ['crustaceans']],
  ['istakoz', ['crustaceans']],
  ['kerevit', ['crustaceans']],
  ['shrimp', ['crustaceans']],
  ['crab', ['crustaceans']],
  ['lobster', ['crustaceans']],
  ['midye', ['molluscs']],
  ['kalamar', ['molluscs']],
  ['ahtapot', ['molluscs']],
  ['salyangoz', ['molluscs']],
  ['istiridye', ['molluscs']],
  ['yumusakca', ['molluscs']],
  ['mollus', ['molluscs']],
  ['bali', ['fish']],
  ['somon', ['fish']],
  ['hamsi', ['fish']],
  ['fish', ['fish']],
  // Acı bakla kereviz ve diğer tek kelimelilerden önce.
  ['aci bakla', ['lupin']],
  ['lupin', ['lupin']],
  // Süt ve ürünleri.
  ['sut', ['milk']],
  ['laktoz', ['milk']],
  ['peynir', ['milk']],
  ['yogurt', ['milk']],
  ['kazein', ['milk']],
  ['tereyag', ['milk']],
  ['kaymak', ['milk']],
  ['milk', ['milk']],
  ['lactose', ['milk']],
  ['dairy', ['milk']],
  // Yumurta.
  ['yumurta', ['eggs']],
  ['egg', ['eggs']],
  // Gluten içeren tahıllar.
  ['gluten', ['gluten']],
  ['colyak', ['gluten']],
  ['bugday', ['gluten']],
  ['cavdar', ['gluten']],
  ['arpa', ['gluten']],
  ['yulaf', ['gluten']],
  ['kamut', ['gluten']],
  ['wheat', ['gluten']],
  ['celiac', ['gluten']],
  ['coeliac', ['gluten']],
  // Diğerleri.
  ['soya', ['soybeans']],
  ['soy.', ['soybeans']],
  ['soybean', ['soybeans']],
  ['kereviz', ['celery']],
  ['celery', ['celery']],
  ['hardal', ['mustard']],
  ['mustard', ['mustard']],
  ['susam', ['sesame']],
  ['tahin', ['sesame']],
  ['sesame', ['sesame']],
  ['sulfit', ['sulphites']],
  ['kukurt', ['sulphites']],
  ['sulphite', ['sulphites']],
  ['sulfite', ['sulphites']],
]

/** Besin dışı alerjiler: yemekhane listesine girmez (en az veri). */
const NON_FOOD_PATTERNS: readonly string[] = [
  'ari sok',
  'bocek sok',
  'ev toz',
  'toz akar',
  'ari',
  'bocek',
  'akar',
  'polen',
  'cicek tozu',
  'penisilin',
  'antibiyotik',
  'aspirin',
  'ilac',
  'lateks',
  'latex',
  'kedi',
  'kopek',
  'hayvan',
  'tuy',
  'nikel',
  'parfum',
  'gunes',
  'pollen',
  'penicillin',
  'drug',
  'bee.',
  'dust',
]

/**
 * Anlam taşımayan kelimeler: parçada yalnız bunlar kalırsa parça eşlenmiş sayılır ("süt ürünleri",
 * "laktoz intoleransı"). Hayvan adları süt/peynir ile kullanıldığında belirleyici değildir.
 */
const FILLER_WORDS: readonly string[] = [
  'urun',
  'turev',
  'icer',
  'icerik',
  'alerji',
  'alerjen',
  'intolerans',
  'hassasiyet',
  'duyarlilik',
  'yiyecek',
  'gida',
  'besin',
  'madde',
  'protein',
  'katki',
  'sokma',
  'tum',
  'her',
  'tur',
  'cesit',
  'vb.',
  'gibi',
  'diger',
  'olan',
  'iceren',
  'inek',
  'keci',
  'manda',
  'koyun',
  'allergy',
  'intolerance',
  'products.',
  'product.',
]

type Pattern = readonly { stem: string; exact: boolean }[]
const compile = (pattern: string): Pattern =>
  pattern
    .split(' ')
    .map((word) =>
      word.endsWith('.') ? { stem: word.slice(0, -1), exact: true } : { stem: word, exact: false },
    )
const FOOD = FOOD_PATTERNS.map(([pattern, allergens]) => ({ words: compile(pattern), allergens }))
const NON_FOOD = NON_FOOD_PATTERNS.map(compile)
const FILLER = FILLER_WORDS.map((word) => compile(word)[0]).filter(
  (word): word is { stem: string; exact: boolean } => word !== undefined,
)

const wordMatches = (token: string, word: { stem: string; exact: boolean }) =>
  word.exact ? token === word.stem : token.startsWith(word.stem)

/** Küçük harf (Türkçe), aksansız ve yalnız harf/rakam: "Yer Fıstığı" → "yer fistigi". */
export function normalizeAllergyText(text: string): string {
  return text
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9,;/+&|()]+/g, ' ')
    .trim()
}

const CONNECTORS = new Set(['ve', 'veya', 'ile', 'ya', 'da', 'de', 'and', 'or'])

/** Parçalar: ayraç işaretleri ve bağlaçlar ("ve", "veya", "ile") parçaları ayırır. */
function partsOf(normalized: string): string[][] {
  const parts: string[][] = []
  for (const segment of normalized.split(/[,;/+&|()]+/)) {
    let current: string[] = []
    for (const token of segment.split(' ')) {
      if (token === '') continue
      if (CONNECTORS.has(token)) {
        if (current.length > 0) parts.push(current)
        current = []
      } else current.push(token)
    }
    if (current.length > 0) parts.push(current)
  }
  return parts
}

/** Kalıbı parçanın kullanılmamış ardışık kelimelerine uygular; eşleşirse kelimeleri işaretler. */
function consume(tokens: readonly string[], used: boolean[], words: Pattern): boolean {
  let found = false
  for (let start = 0; start + words.length <= tokens.length; start += 1) {
    const fits = words.every((word, offset) => {
      const token = tokens[start + offset]
      return token !== undefined && !used[start + offset] && wordMatches(token, word)
    })
    if (!fits) continue
    for (let offset = 0; offset < words.length; offset += 1) used[start + offset] = true
    found = true
  }
  return found
}

export const ALLERGY_MATCH_STATUSES = ['matched', 'partial', 'unmatched', 'non_food'] as const
export type AllergyMatchStatus = (typeof ALLERGY_MATCH_STATUSES)[number]

export interface AllergyMatch {
  /** Eşlenen alerjenler (yönetmelik sırasıyla). */
  allergens: Allergen[]
  /**
   * `matched` bütün parçalar eşlendi; `partial` bir kısmı eşlendi, kalanı eşlenemedi; `unmatched`
   * hiçbir alerjen eşlenemedi; `non_food` yalnız besin dışı alerji (listeye girmez).
   */
  status: AllergyMatchStatus
}

/**
 * Serbest metin alerjiyi 14 alerjene eşler (K-541). Boş ya da yalnız "alerji" gibi anlamsız
 * kelimeden oluşan ad `unmatched`'tır (elle kontrol).
 */
export function matchAllergy(name: string): AllergyMatch {
  const found = new Set<Allergen>()
  let unknown = false
  let nonFood = false
  for (const tokens of partsOf(normalizeAllergyText(name))) {
    const used = tokens.map(() => false)
    let food = false
    for (const pattern of FOOD)
      if (consume(tokens, used, pattern.words)) {
        food = true
        for (const allergen of pattern.allergens) found.add(allergen)
      }
    let other = false
    for (const words of NON_FOOD) if (consume(tokens, used, words)) other = true
    const leftover = tokens.some(
      (token, index) => !used[index] && !FILLER.some((word) => wordMatches(token, word)),
    )
    if (leftover) unknown = true
    else if (other && !food) nonFood = true
  }
  const allergens = orderedAllergens([...found])
  if (allergens.length > 0) return { allergens, status: unknown ? 'partial' : 'matched' }
  return { allergens, status: nonFood && !unknown ? 'non_food' : 'unmatched' }
}

// --- Uyarı ---------------------------------------------------------------------------------------

/** Öğrencinin sağlık profilinden yalnız alerji adı ve şiddeti; başka alan bu modüle girmez. */
export interface StudentAllergy {
  // kvkk: Ö
  name: string
  // kvkk: Ö
  severity: AllergySeverity
}

/** Öğünün kalemi (menüden). */
export interface ServedItem {
  name: string
  position: number
  allergens: readonly Allergen[]
}

export interface MealAllergyConflict {
  itemName: string
  position: number
  /** Kalemde bulunan ve öğrencinin eşlenen alerjisine denk gelen alerjenler. */
  allergens: Allergen[]
  // kvkk: Ö
  severity: AllergySeverity
}

export interface MealAllergyUnmatched {
  // kvkk: Ö — elle kontrol için alerjinin profildeki adı
  allergyName: string
  // kvkk: Ö
  severity: AllergySeverity
  /** Adın bir kısmı eşlendi (eşlenen kısım çakışmada ayrıca görünür). */
  partial: boolean
}

export interface MealAllergyWarnings {
  conflicts: MealAllergyConflict[]
  unmatched: MealAllergyUnmatched[]
  /** Uyarıların en ağır şiddeti; uyarı yoksa `null`. */
  severity: AllergySeverity | null
}

/**
 * Öğrencinin bu öğündeki uyarıları (K-542): kalem başına eşleşen alerjenler ve eşlenemeyen
 * alerjiler. Öğünde yemek yoksa uyarı yoktur (eşlenemeyen alerji de listelenmez: karşılaştırılacak
 * yemek yok). Kalemler sırasına, alerjenler yönetmelik sırasına göre.
 */
export function mealAllergyWarnings(
  allergies: readonly StudentAllergy[],
  items: readonly ServedItem[],
): MealAllergyWarnings {
  if (items.length === 0) return { conflicts: [], unmatched: [], severity: null }
  const bySeverity = new Map<Allergen, AllergySeverity>()
  const unmatched: MealAllergyUnmatched[] = []
  for (const allergy of allergies) {
    const match = matchAllergy(allergy.name)
    for (const allergen of match.allergens) {
      const current = bySeverity.get(allergen)
      bySeverity.set(
        allergen,
        current === undefined ? allergy.severity : heavier(current, allergy.severity),
      )
    }
    if (match.status === 'partial' || match.status === 'unmatched')
      unmatched.push({
        allergyName: allergy.name,
        severity: allergy.severity,
        partial: match.status === 'partial',
      })
  }
  const conflicts: MealAllergyConflict[] = []
  for (const item of [...items].sort((a, b) => a.position - b.position)) {
    const shared = orderedAllergens(item.allergens.filter((allergen) => bySeverity.has(allergen)))
    const [first, ...rest] = shared
    if (first === undefined) continue
    const severity = rest.reduce<AllergySeverity>(
      (worst, allergen) => heavier(worst, bySeverity.get(allergen) ?? worst),
      bySeverity.get(first) ?? 'mild',
    )
    conflicts.push({ itemName: item.name, position: item.position, allergens: shared, severity })
  }
  const severities = [
    ...conflicts.map((item) => item.severity),
    ...unmatched.map((item) => item.severity),
  ]
  return {
    conflicts,
    unmatched,
    severity: severities.reduce<AllergySeverity | null>(
      (worst, value) => (worst === null ? value : heavier(worst, value)),
      null,
    ),
  }
}

export const hasMealAllergyWarning = (warnings: MealAllergyWarnings): boolean =>
  warnings.conflicts.length > 0 || warnings.unmatched.length > 0

// --- Gün ve sorgu --------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[]) =>
  new DomainError(code, message, { kind: 'rule', path })

/** Listenin günü (K-541): bugün ya da en çok 7 gün sonrası; geçmiş gün açılmaz. */
export function assertMealAllergyServiceDate(serviceDate: string, today: string): void {
  if (serviceDate < today)
    throw ruleError('meal_allergy_date_past', 'Geçmiş günün alerji listesi açılmaz.', [
      'serviceDate',
    ])
  if (serviceDate > addDays(today, MEAL_ALLERGY_DAYS_AHEAD))
    throw ruleError(
      'meal_allergy_date_too_far',
      `Alerji listesi en çok ${String(MEAL_ALLERGY_DAYS_AHEAD)} gün sonrası için açılır.`,
      ['serviceDate'],
    )
}

export const mealAllergyServiceDateSchema = daySchema.describe(
  'Servis günü (YYYY-MM-DD, Europe/Istanbul)',
)
export const mealAllergyMealKindSchema = z
  .enum(MEAL_KINDS, 'Öğünü seçin.')
  .describe('Öğün: `breakfast` kahvaltı, `lunch` öğle yemeği, `snack` ikindi ara öğünü')

// --- Görevli onayı -------------------------------------------------------------------------------

export const mealAllergyAcknowledgementSchema = z.strictObject({
  studentId: z
    .string('Öğrenciyi seçin.')
    .trim()
    .min(1, 'Öğrenciyi seçin.')
    .max(128)
    .describe('Öğrenci kaydı'),
  serviceDate: mealAllergyServiceDateSchema,
  mealKind: mealAllergyMealKindSchema,
})
export type MealAllergyAcknowledgementInput = z.output<typeof mealAllergyAcknowledgementSchema>

/**
 * Onay işareti (K-543): öğrenci kurumda ve kayıtlı olmalı; gün bugün olmalı; öğrenci × gün × öğün
 * için ikinci işaret 409; öğrencinin bu öğünde uyarısı yoksa (menü yok ya da uyarı yok) 422.
 */
export function planMealAllergyAcknowledgement(
  input: MealAllergyAcknowledgementInput,
  checks: {
    today: string
    student: { active: boolean } | null
    exists: boolean
    menuId: string | null
    hasWarning: boolean
  },
): { studentId: string; serviceDate: string; mealKind: MealKind; menuId: string } {
  if (checks.student === null)
    throw ruleError('meal_allergy_student_not_found', 'Öğrenci bulunamadı.', ['studentId'])
  if (!checks.student.active)
    throw ruleError(
      'meal_allergy_student_inactive',
      'Ayrılmış ya da mezun öğrenci için işaret konmaz.',
      ['studentId'],
    )
  if (input.serviceDate !== checks.today)
    throw ruleError('meal_allergy_ack_not_today', 'Uyarı yalnız bugünün servisinde işaretlenir.', [
      'serviceDate',
    ])
  if (checks.exists)
    throw new DomainError(
      'meal_allergy_ack_exists',
      'Bu öğrencinin bu öğündeki uyarısı zaten işaretlenmiş.',
      { kind: 'conflict', path: ['studentId'] },
    )
  if (checks.menuId === null || !checks.hasWarning)
    throw ruleError('meal_allergy_ack_no_warning', 'Öğrencinin bu öğünde alerji uyarısı yok.', [
      'studentId',
    ])
  return {
    studentId: input.studentId,
    serviceDate: input.serviceDate,
    mealKind: input.mealKind,
    menuId: checks.menuId,
  }
}
