import { z } from 'zod'

import type { FilePurpose } from '../content/taxonomy.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import { OPEN_PROSPECT_STAGES } from './prospects.ts'

/**
 * Aday belgeleri (docs/domain/kayit-ve-crm.md DOM-KAY-043; ON-263). Ön büro adayın kimlik, karne,
 * sağlık raporu, fotoğraf gibi belgelerini platform dosya altyapısıyla yükler (ADR 0003; amaç
 * `document`: yalnız PDF, en çok 20 MB, tarama ve tür denetimi dosya ucundadır); belge türü listesi
 * kurum ayarıdır. Fonksiyonlar saftır: tür, belge ve rıza satırlarını servis yükler.
 *
 * - Belge türü: tür (`kind`), ad, zorunlu mu, hangi aşamada istendiği (ön başvuru ya da kesin kayıt)
 *   ve özel nitelikli işareti. Sağlık raporu her zaman özel nitelikli kişisel veridir (KVKK md. 6).
 *   Kurum ilk okumada varsayılan listeyle başlar (`defaultProspectDocumentTypes`, K-320).
 * - Belge açık adaya ve kesin kayda dönmüş adaya eklenir; vazgeçen adaya eklenmez (önce yeniden
 *   açılır). Aynı türe yeni yükleme öncekini "yerine yenisi yüklendi" yapar; türde tek güncel belge.
 * - Özel nitelikli belge yalnız adayın (18 yaş altında velinin) açık rızası kaydedilmişse yüklenir;
 *   görüntüleme ve inceleme yalnız yöneticidedir, her açılış denetim kaydına yazılır (K-322).
 * - Eksik belge: aşaması gelmiş zorunlu türde güncel belge yoksa ya da güncel belge reddedildiyse ya
 *   da dosyası imha edildiyse tür eksiktir. Ön başvuru belgesi aday açıkken, kesin kayıt belgesi
 *   aday `Teklif verildi` aşamasına geçince ve kesin kayıttan sonra istenir; eksik belge kesin
 *   kaydı engellemez (K-321).
 */

/** Aday belgelerini yükleyen, listeleyen ve özel nitelikli olmayan belgeyi inceleyen roller. */
export const PROSPECT_DOCUMENT_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]
/** Belge türü listesini değiştiren roller (kurum ayarı; okuma `PROSPECT_DOCUMENT_ROLES`). */
export const PROSPECT_DOCUMENT_SETTINGS_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Özel nitelikli belgeyi açan ve inceleyen roller (K-322; DOM-YTK-052). */
export const SPECIAL_DOCUMENT_ROLES = ['yonetici'] as const satisfies readonly Role[]

/** Platform dosya amacı: kurum belgesi (yalnız PDF, 20 MB; yönetici ve ön büro yükler). */
export const PROSPECT_DOCUMENT_PURPOSE = 'document' satisfies FilePurpose

export const PROSPECT_DOCUMENT_KINDS = [
  'identity',
  'report_card',
  'health_report',
  'photo',
  'other',
] as const
export type ProspectDocumentKind = (typeof PROSPECT_DOCUMENT_KINDS)[number]
export const PROSPECT_DOCUMENT_KIND_LABELS = {
  identity: 'Kimlik / nüfus kayıt örneği',
  report_card: 'Karne / transkript',
  health_report: 'Sağlık raporu',
  photo: 'Fotoğraf',
  other: 'Diğer',
} as const satisfies Record<ProspectDocumentKind, string>

export const PROSPECT_DOCUMENT_STAGES = ['application', 'enrollment'] as const
export type ProspectDocumentStage = (typeof PROSPECT_DOCUMENT_STAGES)[number]
export const PROSPECT_DOCUMENT_STAGE_LABELS = {
  application: 'Ön başvuru',
  enrollment: 'Kesin kayıt',
} as const satisfies Record<ProspectDocumentStage, string>

export const PROSPECT_DOCUMENT_STATUSES = [
  'uploaded',
  'accepted',
  'rejected',
  'superseded',
] as const
export type ProspectDocumentStatus = (typeof PROSPECT_DOCUMENT_STATUSES)[number]
export const PROSPECT_DOCUMENT_STATUS_LABELS = {
  uploaded: 'İnceleme bekliyor',
  accepted: 'Kabul edildi',
  rejected: 'Reddedildi',
  superseded: 'Yerine yenisi yüklendi',
} as const satisfies Record<ProspectDocumentStatus, string>

/** Özel nitelikli belge rızasının alındığı yol: velinin ya da adayın ıslak imzalı formu (H-50). */
export const DOCUMENT_CONSENT_METHODS = ['wet_signature'] as const
export type DocumentConsentMethod = (typeof DOCUMENT_CONSENT_METHODS)[number]
export const DOCUMENT_CONSENT_METHOD_LABELS = {
  wet_signature: 'Islak imzalı açık rıza formu',
} as const satisfies Record<DocumentConsentMethod, string>
/** Rızayı veren: 18 yaş altı (ve okul) adayında veli, yetişkin kursiyer adayında kendisi. */
export const DOCUMENT_CONSENT_GRANTORS = ['guardian', 'self'] as const
export type DocumentConsentGrantor = (typeof DOCUMENT_CONSENT_GRANTORS)[number]
export const DOCUMENT_CONSENT_GRANTOR_LABELS = {
  guardian: 'Veli',
  self: 'Aday',
} as const satisfies Record<DocumentConsentGrantor, string>

export const PROSPECT_DOCUMENT_LABEL_MAX = 80
/** Kurumda arşivlenmemiş en çok belge türü. */
export const PROSPECT_DOCUMENT_TYPE_LIMIT = 30
/** Adayda (yerine yenisi yüklenenler dahil) en çok belge; yanlış yükleme döngüsünü sınırlar. */
export const PROSPECT_DOCUMENT_HISTORY_LIMIT = 50
export const PROSPECT_DOCUMENT_REJECTION_MAX = 300
/**
 * Yerine yenisi yüklenen belgenin ve vazgeçen adayın belgelerinin dosyası bu kadar gün sonra imha
 * edilir (K-323; platform imha işi `files.purge-expired`).
 */
export const PROSPECT_DOCUMENT_RETENTION_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export type ProspectDocumentTypeSeed = {
  id: string
  kind: ProspectDocumentKind
  label: string
  required: boolean
  stage: ProspectDocumentStage
  specialCategory: boolean
  position: number
}

/**
 * Kurumun ilk belge türü listesi (K-320). Kimlik, karne ve fotoğraf kesin kayıt aşamasındadır:
 * aday aşamasında T.C. kimlik no, doğum tarihi ve okul notu alınmaz (DOM-KAY-009); kurum ön başvuru
 * aşamasına alabilir (H-49). Sağlık raporu zorunlu değildir ve özel nitelikli işaretlidir. Okulda
 * kimlik, karne ve fotoğraf zorunlu; kurslarda yalnız kimlik. Kimlikler türün kendisidir; özel
 * türler sunucuda üretilen UUID alır.
 */
export function defaultProspectDocumentTypes(type: InstitutionType): ProspectDocumentTypeSeed[] {
  const school = type === 'school'
  const seeds: Omit<ProspectDocumentTypeSeed, 'position'>[] = [
    {
      id: 'identity',
      kind: 'identity',
      label: school ? 'Nüfus kayıt örneği / kimlik' : 'Kimlik fotokopisi',
      required: true,
      stage: 'enrollment',
      specialCategory: false,
    },
    {
      id: 'report_card',
      kind: 'report_card',
      label: school ? 'Karne / öğrenim belgesi' : 'Karne / transkript',
      required: school,
      stage: 'enrollment',
      specialCategory: false,
    },
    {
      id: 'photo',
      kind: 'photo',
      label: 'Vesikalık fotoğraf',
      required: school,
      stage: 'enrollment',
      specialCategory: false,
    },
    {
      id: 'health_report',
      kind: 'health_report',
      label: 'Sağlık raporu',
      required: false,
      stage: 'enrollment',
      specialCategory: true,
    },
    {
      id: 'other',
      kind: 'other',
      label: 'Diğer belge',
      required: false,
      stage: 'application',
      specialCategory: false,
    },
  ]
  return seeds.map((seed, index) => ({ ...seed, position: (index + 1) * 10 }))
}

// --- Şemalar ------------------------------------------------------------------------------

const typeLabel = z
  .string('Belge adını yazın.')
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(
    PROSPECT_DOCUMENT_LABEL_MAX,
    `En fazla ${PROSPECT_DOCUMENT_LABEL_MAX} karakter girebilirsiniz.`,
  )
const typeStage = z.enum(PROSPECT_DOCUMENT_STAGES, 'Belgenin istendiği aşamayı seçin.')
const typeRequired = z.boolean('Belgenin zorunlu olup olmadığını seçin.')
const typeSpecial = z.boolean('Özel nitelikli olup olmadığını seçin.')

/** Yeni belge türü (yönetici). Sağlık raporunda özel nitelikli işareti kendiliğinden açıktır. */
export const createDocumentTypeSchema = z.strictObject({
  kind: z.enum(PROSPECT_DOCUMENT_KINDS, 'Belge türünü seçin.'),
  label: typeLabel,
  required: typeRequired,
  stage: typeStage,
  specialCategory: typeSpecial.optional(),
})
export type CreateDocumentTypeInput = z.input<typeof createDocumentTypeSchema>

/** Belge türü düzeltmesi: ad, zorunluluk, aşama ve özel nitelikli işareti; tür değişmez. */
export const updateDocumentTypeSchema = z
  .strictObject({
    label: typeLabel.optional(),
    required: typeRequired.optional(),
    stage: typeStage.optional(),
    specialCategory: typeSpecial.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Değiştirilecek bir alan seçin.',
  })
export type UpdateDocumentTypeInput = z.input<typeof updateDocumentTypeSchema>

/** Adaya belge ekleme: önceden `POST /files` (amaç `document`) ile yüklenmiş dosya ve tür. */
export const addProspectDocumentSchema = z.strictObject({
  documentTypeId: z.string('Belge türünü seçin.').trim().min(1, 'Belge türünü seçin.').max(64),
  fileId: z.uuid('Belgeyi yükleyin.'),
})
export type AddProspectDocumentInput = z.input<typeof addProspectDocumentSchema>

/** Belge incelemesi: kabul ya da gerekçeli ret. */
export const reviewProspectDocumentSchema = z.discriminatedUnion(
  'decision',
  [
    z.strictObject({ decision: z.literal('accept') }),
    z.strictObject({
      decision: z.literal('reject'),
      // kvkk: K — ret gerekçesi serbest metindir; form özel nitelikli veri yazılmaması için uyarır.
      reason: z
        .string('Ret gerekçesini yazın.')
        .trim()
        .min(2, 'Ret gerekçesini yazın.')
        .max(
          PROSPECT_DOCUMENT_REJECTION_MAX,
          `En fazla ${PROSPECT_DOCUMENT_REJECTION_MAX} karakter girebilirsiniz.`,
        ),
    }),
  ],
  'Kabul ya da ret kararını seçin.',
)
export type ReviewProspectDocumentInput = z.input<typeof reviewProspectDocumentSchema>

/** Özel nitelikli belge için açık rıza kaydı (ön büro ıslak imzalı formu aldığını işaretler). */
export const recordDocumentConsentSchema = z.strictObject({
  method: z.enum(DOCUMENT_CONSENT_METHODS, 'Rızanın alındığı yolu seçin.'),
})
export type RecordDocumentConsentInput = z.input<typeof recordDocumentConsentSchema>

/** Ret gerekçesi alanında gösterilen uyarı (DOM-KAY-032 not uyarısıyla aynı amaç). */
export const DOCUMENT_REJECTION_NOTICE =
  'Gerekçeye sağlık durumu, din, engellilik gibi özel nitelikli bilgi yazmayın; yalnız belgenin neden kabul edilmediğini yazın.'

// --- Kurallar -----------------------------------------------------------------------------

/**
 * Türün özel nitelikli işareti: sağlık raporunda her zaman açık, işaret kaldırılamaz (422); öteki
 * türlerde kurumun seçimi, verilmezse kapalı.
 */
export function documentTypeSpecialCategory(
  kind: ProspectDocumentKind,
  specialCategory: boolean | undefined,
): boolean {
  if (kind !== 'health_report') return specialCategory ?? false
  if (specialCategory === false)
    throw new DomainError(
      'document_type_special_required',
      'Sağlık raporu özel nitelikli kişisel veridir; bu işaret kaldırılamaz.',
      { path: ['specialCategory'] },
    )
  return true
}

const normalizedLabel = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr')

/** Arşivlenmemiş türler arasında ad tekildir (büyük/küçük harf ve boşluk farkı gözetilmez). 409. */
export function assertDocumentTypeLabelFree(
  types: readonly { id: string; label: string }[],
  label: string,
  exceptId: string | null = null,
): void {
  const wanted = normalizedLabel(label)
  if (types.some((type) => type.id !== exceptId && normalizedLabel(type.label) === wanted))
    throw new DomainError('document_type_exists', 'Bu adla bir belge türü zaten var.', {
      kind: 'conflict',
      path: ['label'],
    })
}

/** Kurumda arşivlenmemiş tür sayısı sınırı (422). */
export function assertDocumentTypeCapacity(activeCount: number): void {
  if (activeCount >= PROSPECT_DOCUMENT_TYPE_LIMIT)
    throw new DomainError(
      'document_type_limit',
      `En fazla ${PROSPECT_DOCUMENT_TYPE_LIMIT} belge türü tanımlanabilir. Kullanılmayan bir türü kaldırın.`,
    )
}

const isOpenStage = (stage: string | undefined) =>
  (OPEN_PROSPECT_STAGES as readonly string[]).includes(stage ?? '')
const ENROLLED = 'Kayıt oldu'
const OFFERED = 'Teklif verildi'

/**
 * Adaya belge eklenir, rıza kaydedilir, belge incelenir mi: açık aday ve kesin kayda dönmüş aday
 * evet; vazgeçen ya da tanınmayan aşamadaki aday hayır (409 `prospect_closed`).
 */
export function assertProspectAcceptsDocuments(stage: string | undefined): void {
  if (isOpenStage(stage) || stage === ENROLLED) return
  throw new DomainError(
    'prospect_closed',
    'Vazgeçen adayın belgesi değiştirilemez. Önce adayı yeniden açın.',
    { kind: 'conflict' },
  )
}

/** Adayda belge sınırı (422). */
export function assertDocumentHistoryCapacity(count: number): void {
  if (count >= PROSPECT_DOCUMENT_HISTORY_LIMIT)
    throw new DomainError(
      'prospect_document_limit',
      `Bir adaya en fazla ${PROSPECT_DOCUMENT_HISTORY_LIMIT} belge eklenebilir.`,
    )
}

/** Arşivlenmiş türe yeni belge eklenmez (422). */
export function assertDocumentTypeUsable(type: { archived: boolean }): void {
  if (type.archived)
    throw new DomainError(
      'document_type_archived',
      'Bu belge türü kaldırıldı. Listeden başka bir tür seçin.',
      { path: ['documentTypeId'] },
    )
}

/** Özel nitelikli belge yalnız geçerli açık rıza varken yüklenir (422 `document_consent_required`). */
export function assertSpecialDocumentConsent(specialCategory: boolean, consentActive: boolean) {
  if (specialCategory && !consentActive)
    throw new DomainError(
      'document_consent_required',
      'Bu belge özel nitelikli kişisel veri içerir. Önce ıslak imzalı açık rıza formunu kaydedin.',
      { path: ['documentTypeId'] },
    )
}

/** Rızayı kim verir: okul adayı her zaman ve yaşı bilinmeyen aday 18 yaş altı sayılır (DOM-KAY-009). */
export function documentConsentGrantor(
  prospect: { minor?: boolean | undefined },
  institutionType: InstitutionType,
): DocumentConsentGrantor {
  if (institutionType === 'school') return 'guardian'
  return prospect.minor === false ? 'self' : 'guardian'
}

/** Belgeyi açabilir ve inceleyebilir mi: özel nitelikli belge yalnız yönetici (K-322). */
export function canOpenProspectDocument(role: Role, specialCategory: boolean): boolean {
  const roles: readonly Role[] = specialCategory ? SPECIAL_DOCUMENT_ROLES : PROSPECT_DOCUMENT_ROLES
  return roles.includes(role)
}

/** Yalnız güncel ve incelemesi bekleyen belge kararlaştırılır; kararlı belgeye yeni karar 409. */
export function assertDocumentReviewable(document: {
  status: ProspectDocumentStatus
  fileAvailable: boolean
}): void {
  if (document.status === 'superseded')
    throw new DomainError(
      'prospect_document_superseded',
      'Bu belgenin yerine yenisi yüklendi; güncel belgeyi inceleyin.',
      { kind: 'conflict' },
    )
  if (document.status !== 'uploaded')
    throw new DomainError('prospect_document_reviewed', 'Bu belge için karar zaten verildi.', {
      kind: 'conflict',
    })
  if (!document.fileAvailable)
    throw new DomainError(
      'prospect_document_file_missing',
      'Belgenin dosyası imha edildi. Belgeyi yeniden yükleyin.',
    )
}

/**
 * Tür adayın şimdiki aşamasında isteniyor mu (K-321): ön başvuru belgesi açık adayda, kesin kayıt
 * belgesi `Teklif verildi` aşamasında; kesin kayda dönmüş adayda ikisi de. Vazgeçen adayda hiçbiri.
 */
export function documentDue(stage: ProspectDocumentStage, prospectStage: string | undefined) {
  if (prospectStage === ENROLLED) return true
  if (!isOpenStage(prospectStage)) return false
  return stage === 'application' || prospectStage === OFFERED
}

export type GapDocumentType = {
  id: string
  label: string
  stage: ProspectDocumentStage
  required: boolean
  archived: boolean
}
export type GapDocument = {
  documentTypeId: string
  status: ProspectDocumentStatus
  /** Dosya imha edilmemiş mi (`files.status` `deleted` değil). */
  fileAvailable: boolean
}
export type ProspectDocumentGaps = {
  missing: { id: string; label: string; stage: ProspectDocumentStage }[]
  /** İncelemesi bekleyen güncel belge sayısı. */
  awaitingReview: number
}

/**
 * Adayın eksik zorunlu belgeleri (DOM-KAY-043): aşaması gelmiş, arşivlenmemiş zorunlu türde güncel
 * belge yoksa, güncel belge reddedildiyse ya da dosyası imha edildiyse tür eksiktir. İncelemesi
 * bekleyen belge eksik sayılmaz, ayrıca sayılır. Türler verilen sırayla döner.
 */
export function prospectDocumentGaps(
  types: readonly GapDocumentType[],
  documents: readonly GapDocument[],
  prospectStage: string | undefined,
): ProspectDocumentGaps {
  const current = new Map(
    documents
      .filter((document) => document.status !== 'superseded')
      .map((document) => [document.documentTypeId, document]),
  )
  const missing = types
    .filter((type) => !type.archived && type.required && documentDue(type.stage, prospectStage))
    .filter((type) => {
      const document = current.get(type.id)
      return document === undefined || document.status === 'rejected' || !document.fileAvailable
    })
    .map((type) => ({ id: type.id, label: type.label, stage: type.stage }))
  const awaitingReview = [...current.values()].filter(
    (document) => document.status === 'uploaded' && document.fileAvailable,
  ).length
  return { missing, awaitingReview }
}

/** İmha anı: verilen andan `PROSPECT_DOCUMENT_RETENTION_DAYS` gün sonra (K-323). */
export function documentRetentionUntil(from: Date): Date {
  return new Date(from.getTime() + PROSPECT_DOCUMENT_RETENTION_DAYS * DAY_MS)
}
