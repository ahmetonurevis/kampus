import {
  MODULE_KEYS,
  moduleAvailableFor,
  type InstitutionType,
  type ModuleKey,
} from '../modules/collection-modules.ts'

/**
 * Kurum türü tablosu (IST-001; ADR 0001 karar 4, ADR 0008). Tür; görünen adı, terminolojiyi,
 * seviye modelini, varsayılan modülleri ve menü kategorilerinin adını belirler. Hangi modülün
 * hangi türde açılabildiği `modules/collection-modules.ts`'tedir (DOM-YTK-012); burası yalnız
 * açılabilen modüllerin yeni kurumdaki başlangıç durumunu verir.
 *
 * Web, mobil ve API aynı tabloyu okur; tüketen her `switch` `satisfies never` ile kapanır ki yeni
 * tür eklenince derleme eksik yeri göstersin.
 */

export const INSTITUTION_TYPE_LABELS = {
  school: 'Okul',
  language_school: 'Dil okulu',
  course_center: 'Kurs',
} as const satisfies Record<InstitutionType, string>

/** Türün öğretim modeli: düzeyin neyle tanımlandığı ve ölçmenin neye bağlandığı. */
export type LevelModel = 'grade_outcome' | 'cefr_skill' | 'program_topic'

export interface Terminology {
  /** Kayıtlı kişi: öğrenci / kursiyer. */
  learner: string
  learners: string
  /** Öğretim birimi: sınıf / grup. */
  group: string
  groups: string
  teacher: string
  teachers: string
  /** Düzeyin adı: sınıf düzeyi / seviye / program. */
  level: string
  /** Ölçmenin bağlandığı en küçük birim: kazanım / beceri tanımlayıcısı / konu. */
  unit: string
  units: string
  levelModel: LevelModel
}

/**
 * Terminoloji (ADR 0008 karar 1). Kurs, MEB özel öğretim kursu mevzuatı ve e-Özel diliyle
 * "kursiyer" der (dil okuluyla aynı); öğretim birimi okul veri modelindeki sınıftır, kur/grup
 * değildir; ölçme ders + konu ağacına bağlanır.
 */
export const TERMINOLOGY = {
  school: {
    learner: 'Öğrenci',
    learners: 'Öğrenciler',
    group: 'Sınıf',
    groups: 'Sınıflar',
    teacher: 'Öğretmen',
    teachers: 'Öğretmenler',
    level: 'Sınıf düzeyi',
    unit: 'Kazanım',
    units: 'Kazanımlar',
    levelModel: 'grade_outcome',
  },
  language_school: {
    learner: 'Kursiyer',
    learners: 'Kursiyerler',
    group: 'Grup',
    groups: 'Gruplar',
    teacher: 'Öğretmen',
    teachers: 'Öğretmenler',
    level: 'Seviye',
    unit: 'Beceri',
    units: 'Beceriler',
    levelModel: 'cefr_skill',
  },
  course_center: {
    learner: 'Kursiyer',
    learners: 'Kursiyerler',
    group: 'Sınıf',
    groups: 'Sınıflar',
    teacher: 'Öğretmen',
    teachers: 'Öğretmenler',
    level: 'Program',
    unit: 'Konu',
    units: 'Konular',
    levelModel: 'program_topic',
  },
} as const satisfies Record<InstitutionType, Terminology>

export function terminologyFor(type: InstitutionType): Terminology {
  return TERMINOLOGY[type]
}

/**
 * Yeni kurumda kapalı başlayan modüller (ADR 0008 karar 3). Türde açılabilen ama türün olağan
 * işleyişinde bulunmayan modüller kapalı başlar; yönetici açabilir (DOM-YTK-042). Okul ve dil
 * okulunda bugünkü davranış korunur: açılabilen her modül açık başlar.
 */
const CLOSED_BY_DEFAULT = {
  school: [],
  language_school: [],
  course_center: ['transport', 'meals', 'clubs'],
} as const satisfies Record<InstitutionType, readonly ModuleKey[]>

/** Yeni kurumda açık başlayan modüller (`MODULE_KEYS` sırasıyla). */
export function defaultModulesFor(type: InstitutionType): ModuleKey[] {
  const closed: readonly ModuleKey[] = CLOSED_BY_DEFAULT[type]
  return MODULE_KEYS.filter((key) => moduleAvailableFor(key, type) && !closed.includes(key))
}

/**
 * Yeni kurumun saklanacak modül haritası. Saklanmayan ve türde açılabilen modül açık sayıldığı
 * için (API `effectiveModules`) harita yalnız kapalı başlayanları `false` olarak taşır.
 */
export function defaultModuleMap(type: InstitutionType): Record<string, boolean> {
  const closed: readonly ModuleKey[] = CLOSED_BY_DEFAULT[type]
  return Object.fromEntries(
    closed.filter((key) => moduleAvailableFor(key, type)).map((key) => [key, false]),
  )
}

/**
 * Menü kategorisinin türdeki adı (ADR 0008 karar 4). Menü iskeleti üç türde aynıdır; kursta okul
 * iş akışları sınav hazırlığı olarak, okul yaşamı kurs yaşamı olarak görünür. Bilinmeyen ya da
 * yeniden adlandırılmayan kategori olduğu gibi döner.
 */
const CATEGORY_LABELS = {
  school: {},
  language_school: {},
  course_center: { 'OKUL İŞ AKIŞLARI': 'SINAV HAZIRLIK', 'OKUL YAŞAMI': 'KURS YAŞAMI' },
} as const satisfies Record<InstitutionType, Readonly<Record<string, string>>>

export function categoryLabel(group: string, type: InstitutionType): string {
  const labels: Readonly<Record<string, string>> = CATEGORY_LABELS[type]
  return Object.hasOwn(labels, group) ? (labels[group] ?? group) : group
}

/**
 * 18 yaşını doldurmuş kişi velisiz kaydolabilir mi (ADR 0008 karar 5; DOM-KAY-012, DOM-YTK-030).
 * Okulda veli her yaşta zorunludur; dil okulu ve kursta yetişkin kendi adına kaydolur. Kayıt
 * akışının kendisi `lib/enrollment.ts` `guardianRequired`'dadır; bu tablo türün kuralını adlandırır.
 */
export function adultEnrollsWithoutGuardian(type: InstitutionType): boolean {
  switch (type) {
    case 'school':
      return false
    case 'language_school':
    case 'course_center':
      return true
    default:
      return type satisfies never
  }
}
