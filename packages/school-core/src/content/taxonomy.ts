import { DomainError } from '../lib/errors.ts'
import { dayKey } from '../lib/format.ts'

/**
 * İçerik havuzu sözlüğü (docs/domain/kaynak-platformu.md, beceri-gelisimi.md; ADR 0004 karar 9).
 * CEFR seviyeleri, beceriler, içerik türleri, lisans türleri ve dosya amaçları veritabanı tablosu
 * değil sabittir: kurum değer ekleyemez, raporlar aynı anahtarlarla bölünür (DOM-KYN-012,
 * DOM-DIL-001). Anahtarlar kalıcı kimliktir ve İngilizcedir; ekranda yalnız `label` görünür.
 *
 * Her sözlük `as const` nesnedir; birleşim tipi anahtarlarından, Zod şeması `enumKeys` ile türetilir.
 */

/** Nesnenin anahtarlarını `z.enum`'un beklediği boş olmayan demete çevirir. */
export function enumKeys<T extends Record<string, unknown>>(record: T) {
  return Object.keys(record) as [keyof T & string, ...(keyof T & string)[]]
}

// --- CEFR ---------------------------------------------------------------------------------

/**
 * CEFR-CV seviye ölçeği (DOM-DIL-001, DOM-KYN-012). Artı seviyeler ve Pre-A1 resmî ölçektedir;
 * C1+ gibi resmî olmayan ara değer yoktur. `rank` sıralama ve karşılaştırma içindir.
 */
export const CEFR_LEVELS = {
  'Pre-A1': { label: 'Pre-A1', rank: 0 },
  A1: { label: 'A1', rank: 1 },
  A2: { label: 'A2', rank: 2 },
  'A2+': { label: 'A2+', rank: 3 },
  B1: { label: 'B1', rank: 4 },
  'B1+': { label: 'B1+', rank: 5 },
  B2: { label: 'B2', rank: 6 },
  'B2+': { label: 'B2+', rank: 7 },
  C1: { label: 'C1', rank: 8 },
  C2: { label: 'C2', rank: 9 },
} as const
export type CefrLevel = keyof typeof CEFR_LEVELS

// --- Beceri ve kip ------------------------------------------------------------------------

/**
 * Beceri sözlüğü (DOM-BEC-001, DOM-KYN-012). `core` dört beceridir; seviye önerisi bunlar
 * üzerinden hesaplanır. `language_use` dil bilgisi ve sözcük bilgisinin ortak bileşenidir; dört
 * beceriden birine sayılmaz, öneride ayrı gösterilir. `vocabulary`, `grammar`, `pronunciation`
 * yalnız ikincil etikettir.
 */
export const SKILLS = {
  reading: { label: 'Okuma', group: 'core' },
  listening: { label: 'Dinleme', group: 'core' },
  writing: { label: 'Yazma', group: 'core' },
  speaking: { label: 'Konuşma', group: 'core' },
  mediation: { label: 'Aracılık', group: 'mediation' },
  language_use: { label: 'Dil kullanımı', group: 'component' },
  vocabulary: { label: 'Kelime', group: 'component' },
  grammar: { label: 'Dil bilgisi', group: 'component' },
  pronunciation: { label: 'Sesletim', group: 'component' },
} as const
export type Skill = keyof typeof SKILLS

/**
 * Birincil beceri olabilenler (DOM-BEC-001): bir görev tek beceriye puan yazar. Dil kullanımı
 * yalnız soru, quiz ve alıştırma setinde birincil beceri olabilir (DOM-KYN-012 istisnası; denetim
 * `resource.ts` `publicationIssues`); alt bileşenler olamaz.
 */
export const PRIMARY_SKILLS = [
  'reading',
  'listening',
  'writing',
  'speaking',
  'mediation',
  'language_use',
] as const satisfies readonly Skill[]
export type PrimarySkill = (typeof PRIMARY_SKILLS)[number]

/** Aracılıkta kaynak ve hedef olabilen beceriler (DOM-BEC-001: okuduğunu sözlü aktarma …). */
export const MEDIATION_SKILLS = [
  'reading',
  'listening',
  'writing',
  'speaking',
] as const satisfies readonly Skill[]
export type MediationSkill = (typeof MEDIATION_SKILLS)[number]

/** CEFR-CV etkinlik kipleri (DOM-BEC-001). */
export const ACTIVITY_MODES = {
  reception: { label: 'Alımlama' },
  production: { label: 'Üretim' },
  interaction: { label: 'Etkileşim' },
  mediation: { label: 'Aracılık' },
} as const
export type ActivityMode = keyof typeof ACTIVITY_MODES

/** Etkileşim kipinin kanalı (DOM-BEC-001; DOM-KYN-012'deki sözlü/yazılı etkileşim etiketleri). */
export const INTERACTION_CHANNELS = {
  spoken: { label: 'Sözlü' },
  written: { label: 'Yazılı' },
  online: { label: 'Çevrim içi' },
} as const
export type InteractionChannel = keyof typeof INTERACTION_CHANNELS

// --- İçerik türleri -----------------------------------------------------------------------

/**
 * Kaynak türleri (DOM-KYN-002, DOM-KYN-027, IST-030, IST-036). `hosted: false` türlerin içeriği
 * platformda barındırılmaz; yalnız bağlantı veya kitap/sayfa referansıdır ve indirilemez.
 */
export const CONTENT_TYPES = {
  text: { label: 'Metin', hosted: true },
  reading_passage: { label: 'Okuma parçası', hosted: true },
  audio: { label: 'Ses', hosted: true },
  video: { label: 'Video', hosted: true },
  worksheet: { label: 'Çalışma kâğıdı', hosted: true },
  file: { label: 'Dosya', hosted: true },
  link: { label: 'Dış bağlantı', hosted: false },
  book_reference: { label: 'Kitap/sayfa referansı', hosted: false },
  question: { label: 'Soru', hosted: true },
  quiz: { label: 'Quiz', hosted: true },
  exercise_set: { label: 'Alıştırma seti', hosted: true },
  homework_template: { label: 'Ödev şablonu', hosted: true },
} as const
export type ContentType = keyof typeof CONTENT_TYPES

/** Soru türleri (IST-033; otomatik puanlanan tipler DOM-BEC-002). */
export const QUESTION_TYPES = {
  multiple_choice: { label: 'Çoktan seçmeli' },
  true_false: { label: 'Doğru/yanlış' },
  matching: { label: 'Eşleştirme' },
  gap_fill: { label: 'Boşluk doldurma' },
  ordering: { label: 'Sıralama' },
  short_answer: { label: 'Kısa yanıt' },
} as const
export type QuestionType = keyof typeof QUESTION_TYPES

/** Ödev şablonunun teslim türleri (DOM-KYN-002). */
export const SUBMISSION_KINDS = {
  file: { label: 'Dosya' },
  text: { label: 'Metin' },
  audio: { label: 'Ses kaydı' },
} as const
export type SubmissionKind = keyof typeof SUBMISSION_KINDS

/** Zorluk etiketi (IST-031). */
export const DIFFICULTIES = {
  easy: { label: 'Kolay', rank: 1 },
  medium: { label: 'Orta', rank: 2 },
  hard: { label: 'Zor', rank: 3 },
} as const
export type Difficulty = keyof typeof DIFFICULTIES

/**
 * Kazanım etiketinin işaret ettiği katalog (ADR 0004 karar 9): MEB öğretim programı kodları
 * platform kataloğunda, kurumun kendi kodları kurum kataloğundadır.
 */
export const OUTCOME_SOURCES = {
  platform: { label: 'Öğretim programı' },
  institution: { label: 'Kurum kazanımı' },
} as const
export type OutcomeSource = keyof typeof OUTCOME_SOURCES

/** Sınıf düzeyi aralığı (DOM-KYN-010: ortaokul ve lise, 5–12). */
export const GRADE_LEVEL_RANGE = { min: 5, max: 12 } as const

// --- Lisans ve menşe ----------------------------------------------------------------------

/**
 * Menşe/lisans türleri (DOM-KYN-020, DOM-KYN-044, IST-036). `indicator` bağımlılık göstergesinin
 * (DOM-KYN-053, IST-123) kümesidir: kurum içeriği, Kampüs kütüphanesi, açık kaynak, lisanslı yayın,
 * harici referans. `requiresAttribution` türünde kaynak gösterimi yayımın ön koşuludur (DOM-KYN-024).
 */
export const LICENSE_KINDS = {
  institution_original: {
    label: 'Kurum özgün',
    indicator: 'institution',
    requiresAttribution: false,
  },
  contains_quotation: {
    label: 'Alıntı içerir',
    indicator: 'institution',
    requiresAttribution: true,
  },
  platform_derived: {
    label: 'Kampüs örnek içeriğinden türetildi',
    indicator: 'platform',
    requiresAttribution: false,
  },
  open_license: { label: 'Açık lisans', indicator: 'open', requiresAttribution: true },
  public_domain: { label: 'Kamu malı', indicator: 'open', requiresAttribution: true },
  licensed_publication: {
    label: 'Lisanslı yayın',
    indicator: 'licensed',
    requiresAttribution: true,
  },
  external_reference: {
    label: 'Harici kaynak (yayınevi referansı veya bağlantı)',
    indicator: 'external',
    requiresAttribution: false,
  },
} as const
export type LicenseKind = keyof typeof LICENSE_KINDS
export type LicenseIndicator = (typeof LICENSE_KINDS)[LicenseKind]['indicator']

/**
 * Kabul edilen açık lisanslar (DOM-KYN-020). Ticari kullanıma izin vermeyen (NC) ve türev
 * yasaklayan (ND) lisanslar özel okulda kullanılmaz; listede bulunmamaları kuralın kendisidir.
 */
export const OPEN_LICENSES = {
  'CC0-1.0': { label: 'CC0 1.0' },
  'CC-BY-4.0': { label: 'CC BY 4.0' },
  'CC-BY-SA-4.0': { label: 'CC BY-SA 4.0' },
  'CC-BY-3.0': { label: 'CC BY 3.0' },
  'CC-BY-SA-3.0': { label: 'CC BY-SA 3.0' },
} as const
export type OpenLicense = keyof typeof OPEN_LICENSES

/**
 * Telif beyanı (DOM-KYN-020, 025): içeriği hazırlayan, kullanma hakkı olduğunu bu metinle
 * beyan eder. Form onay kutusunda gösterir; telif bildirimi gelen içerik incelemeye alınır.
 */
export const COPYRIGHT_DECLARATION =
  'Bu içeriği kullanma hakkım var. Telif ihlali bildirilirse içeriğin incelemeye alınacağını biliyorum.'

/**
 * Lisanslı yayının bitiş günü geçti mi (DOM-KYN-021). Bitiş günü dahil geçerlidir; gün
 * Europe/Istanbul'a göre sayılır. Bitiş tarihi olmayan lisans türleri süresizdir.
 */
export function licenseExpired(
  license: { kind: LicenseKind; expiryDate?: string } | null,
  now: Date | string,
): boolean {
  if (license?.kind !== 'licensed_publication' || license.expiryDate === undefined) return false
  return license.expiryDate < dayKey(now)
}

// --- Paylaşım kapsamı ---------------------------------------------------------------------

/**
 * Paylaşım kapsamı basamakları (DOM-KYN-040). `ownAudience` kapsamı öğretmenin kendi
 * öğrencileri/sınıflarıyla sınırlıdır; kurum özgün içerik bu kapsamlarda onaysız yayımlanabilir
 * (DOM-KYN-031).
 */
export const SHARE_SCOPES = {
  private: { label: 'Yalnız ben', ownAudience: true },
  students: { label: 'Öğrenci', ownAudience: true },
  classes: { label: 'Sınıf/grup', ownAudience: true },
  department: { label: 'Zümre', ownAudience: false },
  institution: { label: 'Kurum', ownAudience: false },
} as const
export type ShareScope = keyof typeof SHARE_SCOPES

// --- Dosya amaçları -----------------------------------------------------------------------

const MB = 1024 * 1024

export const MIME = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4aAlt: 'audio/x-m4a',
  wav: 'audio/wav',
  webmAudio: 'audio/webm',
  mp4: 'video/mp4',
} as const
export type AllowedMimeType = (typeof MIME)[keyof typeof MIME]

/**
 * İstemcilerin aynı tür için bildirdiği takma adlar (tarayıcı ve işletim sistemi farkı; ör. Windows
 * Firefox `.m4a` için `audio/x-m4a`, tarayıcı kaydı `video/webm` bildirir). Web/mobil ön denetimi ve
 * API'nin tutarlılık denetimi aynı tabloyu kullanır (ADR 0003 karar 3).
 */
export const MIME_ALIASES: Readonly<Record<string, AllowedMimeType>> = {
  'image/jpg': MIME.jpeg,
  'image/pjpeg': MIME.jpeg,
  'audio/mp3': MIME.mp3,
  'audio/x-m4a': MIME.m4a,
  'audio/m4a': MIME.m4a,
  'audio/x-wav': MIME.wav,
  'audio/wave': MIME.wav,
  'audio/vnd.wave': MIME.wav,
  'video/webm': MIME.webmAudio,
}

const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set(Object.values(MIME))

/**
 * Bildirilen türün kanonik MIME'ı: parametreler (`;codecs=opus`) atılır, büyük/küçük harf
 * sadeleşir, takma ad kanonik ada çevrilir. Tanınmayan tür `null` (karar sunucuya kalır).
 */
export function canonicalMimeType(declared: string): AllowedMimeType | null {
  const base = declared.split(';')[0]?.trim().toLowerCase() ?? ''
  if (Object.hasOwn(MIME_ALIASES, base)) return MIME_ALIASES[base] ?? null
  return ALLOWED_MIME_TYPES.has(base) ? (base as AllowedMimeType) : null
}

export type FilePurposeRule = {
  readonly label: string
  /** İçerikten (sihirli bayt) tespit edilen türler; uzantı yalnız tutarlılık denetimidir. */
  readonly mimeTypes: readonly AllowedMimeType[]
  readonly maxBytes: number
  /** Türe özel üst sınır (ör. materyalde video 200 MB). */
  readonly maxBytesByMime?: Readonly<Partial<Record<AllowedMimeType, number>>>
  /** Sunucuda ölçülen azami süre; ses ve video dışındaki amaçlarda yok. */
  readonly maxDurationSeconds?: number
  /** Tek teslimde en fazla dosya. */
  readonly maxFiles?: number
  /** Yüklemeden önce rıza gerekir (ADR 0003 karar 9). */
  readonly requiresConsent?: boolean
}

/**
 * Amaç bazlı tür ve boyut sınırları (ADR 0003 karar 3). Web ve mobil yüklemeden önce aynı tabloyla
 * uyarır, sunucu yeniden denetler; sınır tek yerde tutulur.
 */
export const FILE_PURPOSES = {
  submission: {
    label: 'Ödev teslimi',
    mimeTypes: [MIME.pdf, MIME.jpeg, MIME.png, MIME.webp, MIME.docx],
    maxBytes: 20 * MB,
    maxFiles: 10,
  },
  material: {
    label: 'Materyal',
    mimeTypes: [
      MIME.pdf,
      MIME.docx,
      MIME.pptx,
      MIME.xlsx,
      MIME.jpeg,
      MIME.png,
      MIME.mp3,
      MIME.m4a,
      MIME.m4aAlt,
      MIME.mp4,
    ],
    maxBytes: 50 * MB,
    maxBytesByMime: { [MIME.mp4]: 200 * MB },
  },
  question_image: {
    label: 'Soru görseli',
    mimeTypes: [MIME.jpeg, MIME.png, MIME.webp],
    maxBytes: 2 * MB,
  },
  // kvkk: K — öğrencinin öğretmene sorduğu soruya eklediği fotoğraf (defter, kitap sayfası); kişisel
  // veridir, yalnız sorunun okuma kapsamına açılır (DOM-ILT-094). Soru başına en çok 3.
  student_question_photo: {
    label: 'Soru fotoğrafı',
    mimeTypes: [MIME.jpeg, MIME.png, MIME.webp],
    maxBytes: 5 * MB,
    maxFiles: 3,
  },
  listening_audio: {
    label: 'Dinleme sesi',
    mimeTypes: [MIME.mp3, MIME.m4a, MIME.m4aAlt, MIME.wav, MIME.webmAudio],
    maxBytes: 50 * MB,
    maxDurationSeconds: 15 * 60,
  },
  speaking_recording: {
    label: 'Konuşma kaydı',
    mimeTypes: [MIME.m4a, MIME.m4aAlt, MIME.webmAudio, MIME.mp3],
    maxBytes: 20 * MB,
    maxDurationSeconds: 10 * 60,
    requiresConsent: true,
  },
  document: { label: 'Kurum belgesi', mimeTypes: [MIME.pdf], maxBytes: 20 * MB },
} as const satisfies Record<string, FilePurposeRule>
export type FilePurpose = keyof typeof FILE_PURPOSES

export type FileCandidate = {
  contentType: string
  byteSize: number
  /** Sunucuda ölçülen süre; istemcinin bildirdiği süreye güvenilmez (ADR 0003 karar 3). */
  durationSeconds?: number | null
}

/** Dosyanın amaca uyup uymadığını denetler; uymayan ilk kuralı Türkçe iletiyle reddeder. */
export function assertFileAllowed(purpose: FilePurpose, file: FileCandidate): void {
  const rule: FilePurposeRule = FILE_PURPOSES[purpose]
  const mime = rule.mimeTypes.find((type) => type === file.contentType)
  if (!mime) {
    throw new DomainError(
      'file_type_not_allowed',
      `${rule.label} için bu dosya türü kabul edilmez.`,
    )
  }
  const limit = rule.maxBytesByMime?.[mime] ?? rule.maxBytes
  if (!Number.isFinite(file.byteSize) || file.byteSize <= 0 || file.byteSize > limit) {
    throw new DomainError('file_too_large', `Dosya en fazla ${Math.round(limit / MB)} MB olabilir.`)
  }
  if (
    rule.maxDurationSeconds !== undefined &&
    file.durationSeconds !== undefined &&
    file.durationSeconds !== null &&
    file.durationSeconds > rule.maxDurationSeconds
  ) {
    throw new DomainError(
      'file_too_long',
      `Kayıt en fazla ${Math.round(rule.maxDurationSeconds / 60)} dakika olabilir.`,
    )
  }
}

// --- Kaynak sürümünün dosyaları -----------------------------------------------------------

export type ResourceFileRule = {
  /** Sürüme bağlanabilen dosya amaçları; boşsa tür dosya almaz. */
  readonly purposes: readonly FilePurpose[]
  /** Sürüm başına en fazla dosya (içerik alanındaki ana dosya dahil). */
  readonly maxFiles: number
}

const NO_FILES: ResourceFileRule = { purposes: [], maxFiles: 0 }

/**
 * İçerik türüne göre sürüm dosyaları (DOM-KYN-006; ADR 0003 karar 3, 5). `hosted` dosya
 * zorunluluğu değildir; zorunlu dosya içerik şemasının alanıdır (`audio`, `video`, `file`
 * `fileId`; metin ve çalışma kâğıdında gövde ya da dosya). Bu tablo yalnız hangi amaçla ve kaç
 * dosya bağlanabileceğini söyler. Dış bağlantı ve kitap referansı platformda barındırılmaz
 * (DOM-KYN-027); okuma parçası gövde metnidir; quiz ve alıştırma setinin dosyası sorudadır.
 */
export const RESOURCE_FILE_RULES = {
  text: { purposes: ['material'], maxFiles: 10 },
  reading_passage: NO_FILES,
  audio: { purposes: ['listening_audio', 'material'], maxFiles: 1 },
  // ADR 0003 karar 3: video Faz 1'de tek dosya.
  video: { purposes: ['material'], maxFiles: 1 },
  worksheet: { purposes: ['material'], maxFiles: 10 },
  file: { purposes: ['material'], maxFiles: 10 },
  link: NO_FILES,
  book_reference: NO_FILES,
  question: { purposes: ['question_image'], maxFiles: 1 },
  quiz: NO_FILES,
  exercise_set: NO_FILES,
  homework_template: { purposes: ['material'], maxFiles: 10 },
} as const satisfies Record<ContentType, ResourceFileRule>

/**
 * İstekteki dosya listesinin üst sınırı (gövde biçimi, 400). Tür sınırı iş kuralıdır ve ayrı
 * denetlenir (422 `resource_files_limit`); bu sınır yalnız aşırı büyük listeyi keser.
 */
export const RESOURCE_FILE_LIST_MAX = 50
