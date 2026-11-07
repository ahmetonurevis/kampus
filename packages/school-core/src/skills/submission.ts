import { z } from 'zod'
import { DomainError } from '../lib/errors.ts'
import { linkedRecordId, type Actor } from '../lib/scope.ts'
import { wordCount } from '../content/resource.ts'
import {
  FILE_PURPOSES,
  MIME,
  assertFileAllowed,
  type AllowedMimeType,
  type FileCandidate,
  type FilePurpose,
} from '../content/taxonomy.ts'
import { assertSubmissionOpen, isClosed, isLate, type Deadline } from './scoring.ts'

/**
 * Öğretmen puanlı beceri görevinin teslimi: tek teslim kaydı, değişmez sürümler, sürüm sınırı,
 * yazma taslağı, sözcük sayısı ve konuşma deneme hakkı (docs/domain/beceri-gelisimi.md
 * DOM-BEC-040, 044, 046; IST-047, IST-051; ADR 0004 karar 6).
 *
 * Satırlar: `task_submissions` (kursiyer × atama başına bir), `submission_versions` (değişmez
 * gönderimler), `submission_drafts` (kursiyer × atama başına bir, üzerine yazılır, iyimser kilitli).
 * Fonksiyonlar saftır, `now` alır ve yazılacak satırı döndürür; kimlik ve yazma servistedir.
 * Sözcük sayısı ve geç bayrağı saklanmaz, okunurken hesaplanır (ADR 0004 karar 5).
 */

z.config(z.locales.tr())

const identifier = z.string().trim().min(1, 'Bir kayıt seçin.').max(200)

// --- Ayarlar ------------------------------------------------------------------------------

/** Sürüm sınırı (DOM-BEC-040): varsayılan 3, görev ayarıyla 1–5. */
export const VERSION_LIMITS = { default: 3, min: 1, max: 5 } as const

/**
 * Konuşma deneme hakkı (IST-051: "deneme hakkı aşılamaz"). Gönderilen her kayıt bir denemedir ve
 * yeni sürüm açar; etkin sınır sürüm sınırı ile bu haktan küçük olanıdır.
 */
// TODO(beceri-konusma-hakki): Domain konuşma hakkının varsayılanını ve aralığını vermiyor; en
// muhafazakâr yorumla otomatik görevin hakkı (DOM-BEC-042: varsayılan 1, 1–3) uygulandı.
export const SPEAKING_ATTEMPT_LIMITS = { default: 1, min: 1, max: 3 } as const

/**
 * Konuşma süresi sınırı (DOM-BEC-054): görev ayarı, varsayılan 3 dakika, en fazla 10 dakika (konuşma
 * kaydı amacının sınırı). Bir saniyeden kısa kayıt boş sayılır.
 */
export const SPEAKING_SECONDS = {
  default: 180,
  min: 10,
  max: FILE_PURPOSES.speaking_recording.maxDurationSeconds,
} as const
export const RECORDING_MIN_SECONDS = 1

/** Yazma teslimi metnin üst sınırı (karakter). */
export const SUBMISSION_TEXT_MAX = 50_000

/** El yazısı teslimi yalnız görüntü veya PDF'tir (DOM-BEC-046). */
export const HANDWRITTEN_MIME_TYPES = [
  MIME.pdf,
  MIME.jpeg,
  MIME.png,
  MIME.webp,
] as const satisfies readonly AllowedMimeType[]

const versionLimit = z
  .number()
  .int()
  .min(VERSION_LIMITS.min, 'Sürüm sınırı en az 1 olmalıdır.')
  .max(VERSION_LIMITS.max, 'Sürüm sınırı en fazla 5 olabilir.')
  .default(VERSION_LIMITS.default)
const words = z.number().int().min(1).max(5000)

/**
 * Teslim ayarı. Tür taksonomideki teslim türleriyle aynı anahtarları kullanır: `text` platformda
 * yazılan metin (DOM-BEC-046), `file` el yazısı görüntü/PDF, `audio` konuşma kaydı.
 */
export const submissionSettingsSchema = z.discriminatedUnion('submissionKind', [
  z
    .object({
      submissionKind: z.literal('text'),
      maxVersions: versionLimit,
      minWords: words.nullable().default(null),
      maxWords: words.nullable().default(null),
    })
    .refine((s) => s.minWords === null || s.maxWords === null || s.minWords <= s.maxWords, {
      message: 'Alt sınır üst sınırdan büyük olamaz.',
      path: ['maxWords'],
    }),
  z.object({ submissionKind: z.literal('file'), maxVersions: versionLimit }),
  z.object({
    submissionKind: z.literal('audio'),
    maxVersions: versionLimit,
    speakingAttempts: z
      .number()
      .int()
      .min(SPEAKING_ATTEMPT_LIMITS.min, 'Deneme hakkı en az 1 olmalıdır.')
      .max(SPEAKING_ATTEMPT_LIMITS.max, 'Deneme hakkı en fazla 3 olabilir.')
      .default(SPEAKING_ATTEMPT_LIMITS.default),
    /** Hazırlık süresi; kayıt bu süre bitince başlar (DOM-BEC-002). */
    preparationSeconds: z.number().int().min(0).max(600).default(0),
    /** Konuşma süresi sınırı; kayıt sınırda durur (IST-051). */
    speakingSeconds: z
      .number()
      .int()
      .min(SPEAKING_SECONDS.min, 'Konuşma süresi en az 10 saniye olmalıdır.')
      .max(SPEAKING_SECONDS.max, 'Konuşma süresi en fazla 10 dakika olabilir.')
      .default(SPEAKING_SECONDS.default),
  }),
])
export type SubmissionSettingsInput = z.input<typeof submissionSettingsSchema>
export type SubmissionSettings = z.output<typeof submissionSettingsSchema>

// --- Girdiler -----------------------------------------------------------------------------

/** Yeni sürüm gövdesi (API ve form). Tür görev ayarıyla aynı olmalıdır. */
export const submissionVersionInputSchema = z.discriminatedUnion('submissionKind', [
  z.object({
    submissionKind: z.literal('text'),
    body: z
      .string()
      .max(SUBMISSION_TEXT_MAX, 'Metin en fazla 50.000 karakter olabilir.')
      .refine((value) => value.trim() !== '', 'Metni yazın.'),
  }),
  z.object({
    submissionKind: z.literal('file'),
    fileIds: z
      .array(identifier)
      .min(1, 'En az bir dosya ekleyin.')
      .max(
        FILE_PURPOSES.submission.maxFiles,
        `En fazla ${FILE_PURPOSES.submission.maxFiles} dosya eklenebilir.`,
      )
      .refine((ids) => new Set(ids).size === ids.length, 'Aynı dosya iki kez eklenemez.'),
  }),
  z.object({ submissionKind: z.literal('audio'), recordingFileId: identifier }),
])
export type SubmissionVersionInput = z.input<typeof submissionVersionInputSchema>
export type SubmissionVersionData = z.output<typeof submissionVersionInputSchema>

/** Taslak kaydı (otomatik). Boş metin kaydedilebilir; `expectedRevision` iyimser kilittir. */
export const draftInputSchema = z.object({
  body: z.string().max(SUBMISSION_TEXT_MAX, 'Metin en fazla 50.000 karakter olabilir.'),
  expectedRevision: z.number().int().min(0),
})
export type DraftInput = z.output<typeof draftInputSchema>

// --- Satırlar -----------------------------------------------------------------------------

/** `task_submissions` satırı. Öğretmen yeniden teslim istediğinde puanlanan sürüm numarası yazılır. */
export type SubmissionRow = {
  id: string
  // kvkk: K
  learnerId: string
  resubmissionRequestedForVersion: number | null
}

/** `submission_versions` satırı. Değişmezdir; geç bayrağı `versionIsLate` ile okunur. */
export type VersionRow = {
  id: string
  number: number
  submittedAt: string
  body: string | null
  fileIds: readonly string[]
}

/** `submission_drafts` satırı. */
export type DraftRow = {
  // kvkk: K
  learnerId: string
  body: string
  revision: number
  savedAt: string
}

/** `files` satırının denetimde kullanılan alanları; tür ve süre sunucuda ölçülür (ADR 0003). */
export type SubmissionFile = FileCandidate & { id: string; purpose: FilePurpose }

// --- Sürüm sınırı -------------------------------------------------------------------------

export type VersionAllowance = {
  /** Etkin sınır: sürüm sınırı, konuşmada deneme hakkıyla birlikte. */
  limit: number
  used: number
  remaining: number
  /** Son sürüm puanlanmış ve öğretmen yeniden teslim istemiş. */
  resubmissionOpen: boolean
  canSubmit: boolean
  /** `canSubmit: false` ise neden. */
  blockedBy: 'limit' | 'graded' | null
}

const latestOf = (versions: readonly VersionRow[]) =>
  versions.reduce<VersionRow | null>(
    (latest, version) => (latest === null || version.number > latest.number ? version : latest),
    null,
  )

/**
 * Yeni sürüm hakkı (DOM-BEC-040, IST-051). Son teslim tarihine kadar en fazla `limit` sürüm
 * gönderilir. Son sürüm puanlandıysa yeni sürüm yalnız öğretmen o sürüm için "yeniden teslim iste"
 * dediğinde açılır; bu sürüm sınıra sayılmaz.
 */
export function versionAllowance(input: {
  settings: SubmissionSettings
  submission: SubmissionRow | null
  versions: readonly VersionRow[]
  /** Puanlanmış (en az bir rubrik puanı olan) sürüm numaraları: `rubric.ts` `gradedVersionNumbers`. */
  gradedVersionNumbers: readonly number[]
}): VersionAllowance {
  const { settings, submission, versions, gradedVersionNumbers } = input
  const limit =
    settings.submissionKind === 'audio'
      ? Math.min(settings.maxVersions, settings.speakingAttempts)
      : settings.maxVersions
  const used = versions.length
  const latest = latestOf(versions)
  const graded = latest !== null && gradedVersionNumbers.includes(latest.number)
  const resubmissionOpen = graded && submission?.resubmissionRequestedForVersion === latest.number
  const blockedBy = graded ? (resubmissionOpen ? null : 'graded') : used >= limit ? 'limit' : null
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resubmissionOpen,
    canSubmit: blockedBy === null,
    blockedBy,
  }
}

// --- Sözcük sayısı ------------------------------------------------------------------------

export type WordCountCheck = {
  count: number
  status: 'ok' | 'below' | 'above'
  /** Sınır dışındaysa kursiyere ve öğretmene gösterilen uyarı; teslim reddedilmez. */
  warning: string | null
}

/**
 * Sözcük sayısı (DOM-BEC-046, IST-047). Sunucuda ve canlı olarak aynı fonksiyonla hesaplanır,
 * saklanmaz. Türkçe ekler kesmeyle ("Ankara'da"), İngilizce kısaltmalar ("don't") ve tireli
 * sözcükler ("well-known") tek sözcüktür; noktalama ve sayı dışı işaretler sayılmaz. Sınır
 * dışındaki metin uyarıyla kabul edilir; sayı bant önermez (DOM-BEC-023).
 */
export function wordCountCheck(
  body: string,
  limits: { minWords: number | null; maxWords: number | null },
): WordCountCheck {
  const count = wordCount(body)
  if (limits.minWords !== null && count < limits.minWords) {
    return {
      count,
      status: 'below',
      warning: `Metin ${count} sözcük; en az ${limits.minWords} sözcük isteniyor.`,
    }
  }
  if (limits.maxWords !== null && count > limits.maxWords) {
    return {
      count,
      status: 'above',
      warning: `Metin ${count} sözcük; en fazla ${limits.maxWords} sözcük isteniyor.`,
    }
  }
  return { count, status: 'ok', warning: null }
}

// --- Yeni sürüm ---------------------------------------------------------------------------

export type SubmissionVersionPlanInput = {
  settings: SubmissionSettings
  deadline: Deadline
  submission: SubmissionRow | null
  versions: readonly VersionRow[]
  gradedVersionNumbers: readonly number[]
  input: unknown
  /** Gövdedeki dosya kimliklerinin servisçe yüklenmiş satırları (kurum kapsamlı). */
  files: readonly SubmissionFile[]
  /**
   * Kursiyerin ses kaydı için işlem anında geçerli rızası (DOM-BEC-050, DOM-YTK-061; core
   * `lib/consents.ts` `hasValidConsent`). Yalnız sesli teslimde okunur; verilmezse rıza yok sayılır.
   */
  recordingConsent?: boolean
  now: Date | string
}

export type SubmissionVersionPlan = {
  /** Kursiyerin ilk teslimi: `task_submissions` satırı açılır (tek teslim kaydı). */
  createSubmission: boolean
  /** Eklenecek değişmez sürüm; önceki sürümlere dokunulmaz. */
  version: Omit<VersionRow, 'id'>
  /** Yeniden teslim isteği bu sürümle karşılandı; servis isteği kapatır. */
  consumesResubmission: boolean
  wordCount: WordCountCheck | null
}

function fileFor(
  files: readonly SubmissionFile[],
  id: string,
  purpose: FilePurpose,
  path: string[],
) {
  const file = files.find((f) => f.id === id)
  if (!file || file.purpose !== purpose) {
    throw new DomainError('submission_file_not_found', 'Dosya bulunamadı; yeniden yükleyin.', {
      kind: 'not_found',
      path,
    })
  }
  try {
    assertFileAllowed(purpose, file)
  } catch (error) {
    if (error instanceof DomainError) {
      throw new DomainError(error.code, error.message, { kind: error.kind, path, cause: error })
    }
    throw error
  }
  return file
}

/**
 * Yeni teslim sürümü (DOM-BEC-040, 044, 046, 050, 054; IST-051). Doğrulama hatasında hiçbir satır
 * değişmez. Sırası: gövde şeması, tür, sesli teslimde rıza, teslim penceresi (geç kabul dahil),
 * sürüm hakkı, içerik. Yazmada sözcük sınırı dışı metin uyarıyla kabul edilir; konuşmada kayıt
 * ölçülmüş, boş olmayan ve süre sınırı içinde olmalıdır.
 */
export function planSubmissionVersion(input: SubmissionVersionPlanInput): SubmissionVersionPlan {
  const { settings, deadline, submission, versions, files, now } = input
  const data = submissionVersionInputSchema.parse(input.input)
  if (data.submissionKind !== settings.submissionKind) {
    throw new DomainError('submission_kind_mismatch', 'Bu görev başka türde teslim bekliyor.', {
      path: ['submissionKind'],
    })
  }
  // Rıza yoksa kayıt alınmaz; görev yüz yüze değerlendirilir ve kursiyer puan kaybetmez
  // (DOM-BEC-050). Ret pencereden önce gelir: istemci kayıt düğmesini hiç göstermemelidir.
  if (data.submissionKind === 'audio' && input.recordingConsent !== true) {
    throw new DomainError(
      'consent_required',
      'Ses kaydı için gerekli onay bulunmuyor; görev yüz yüze değerlendirilecek.',
      { kind: 'forbidden', path: ['recordingFileId'] },
    )
  }
  assertSubmissionOpen(deadline, now)
  const allowance = versionAllowance(input)
  if (allowance.blockedBy === 'graded') {
    throw new DomainError(
      'resubmission_not_requested',
      'Teslim puanlandı; yeni sürüm için öğretmenin yeniden teslim istemesi gerekir.',
      { kind: 'conflict' },
    )
  }
  if (allowance.blockedBy === 'limit') {
    throw new DomainError(
      'version_limit_reached',
      settings.submissionKind === 'audio'
        ? 'Konuşma deneme hakkınız doldu.'
        : `En fazla ${allowance.limit} sürüm gönderebilirsiniz.`,
      { path: ['versions'] },
    )
  }

  let body: string | null = null
  let fileIds: string[] = []
  let words: WordCountCheck | null = null
  switch (data.submissionKind) {
    case 'text':
      if (settings.submissionKind !== 'text') break
      body = data.body
      words = wordCountCheck(data.body, settings)
      break
    case 'file':
      fileIds = data.fileIds.map((id, index) => {
        const file = fileFor(files, id, 'submission', ['fileIds', String(index)])
        if (!(HANDWRITTEN_MIME_TYPES as readonly string[]).includes(file.contentType)) {
          throw new DomainError(
            'file_type_not_allowed',
            'El yazısı teslimi görüntü veya PDF olarak yüklenir.',
            { path: ['fileIds', String(index)] },
          )
        }
        return file.id
      })
      break
    case 'audio': {
      if (settings.submissionKind !== 'audio') break
      const path = ['recordingFileId']
      const file = fileFor(files, data.recordingFileId, 'speaking_recording', path)
      // Süre sunucuda ölçülür (ADR 0003 karar 10); ölçülmeden teslim edilemez.
      if (file.durationSeconds === undefined || file.durationSeconds === null) {
        throw new DomainError(
          'recording_not_measured',
          'Kayıt henüz işleniyor; biraz sonra yeniden teslim edin.',
          { path },
        )
      }
      if (file.durationSeconds < RECORDING_MIN_SECONDS) {
        throw new DomainError('recording_empty', 'Kayıt boş; yeniden kaydedin.', { path })
      }
      // TODO(beceri-kayit-toleransi): Domain ölçüm toleransı vermiyor; en muhafazakâr yorumla
      // sunucuda ölçülen süre sınırı aşamaz.
      if (file.durationSeconds > settings.speakingSeconds) {
        throw new DomainError(
          'recording_too_long',
          `Kayıt en fazla ${settings.speakingSeconds} saniye olabilir.`,
          { path },
        )
      }
      fileIds = [file.id]
      break
    }
    default:
      return data satisfies never
  }

  const latest = latestOf(versions)
  return {
    createSubmission: submission === null,
    version: {
      number: (latest?.number ?? 0) + 1,
      submittedAt: new Date(now).toISOString(),
      body,
      fileIds,
    },
    consumesResubmission: allowance.resubmissionOpen,
    wordCount: words,
  }
}

/** Geç sürüm mi (DOM-BEC-044); saklanmaz, okunurken hesaplanır. */
export function versionIsLate(version: Pick<VersionRow, 'submittedAt'>, deadline: Deadline) {
  return isLate(version.submittedAt, deadline)
}

/**
 * Öğretmen her zaman son sürümü puanlar (DOM-BEC-040); puan o sürüme sabitlenir (`rubric_scores`).
 * Eski sürüm veya bilinmeyen sürüm reddedilir.
 */
export function assertGradableVersion(
  versions: readonly VersionRow[],
  versionId: string,
): VersionRow {
  const latest = latestOf(versions)
  if (!versions.some((v) => v.id === versionId)) {
    throw new DomainError('submission_version_not_found', 'Teslim sürümü bulunamadı.', {
      kind: 'not_found',
    })
  }
  if (latest?.id !== versionId) {
    throw new DomainError('version_not_latest', 'Yalnız son teslim sürümü puanlanır.', {
      kind: 'conflict',
      path: ['versionId'],
    })
  }
  return latest
}

export type SubmissionStatus = 'pending' | 'submitted' | 'late' | 'not_submitted'

/**
 * Teslim durumu (DOM-BEC-044). Hiç sürüm yoksa teslim kapanana kadar `pending`, sonra
 * `not_submitted`; varsa son sürüm geç mi. Proje sıfırı ve not yazımı not defteri kuralıdır.
 */
export function submissionStatus(
  versions: readonly VersionRow[],
  deadline: Deadline,
  now: Date | string,
): SubmissionStatus {
  const latest = latestOf(versions)
  if (latest === null) return isClosed(deadline, now) ? 'not_submitted' : 'pending'
  return versionIsLate(latest, deadline) ? 'late' : 'submitted'
}

// --- Taslak -------------------------------------------------------------------------------

/**
 * Yazma taslağının otomatik kaydı (IST-047; ADR 0004 karar 6). Kursiyer × atama başına tek satır
 * üzerine yazılır; `expectedRevision` güncel değilse başka pencerede değişmiştir (`conflict`).
 * Teslim kapandıktan sonra taslak kaydedilmez.
 */
export function planDraftSave(input: {
  settings: SubmissionSettings
  deadline: Deadline
  draft: DraftRow | null
  learnerId: string
  input: unknown
  now: Date | string
}): DraftRow {
  const { settings, deadline, draft, learnerId, now } = input
  if (settings.submissionKind !== 'text') {
    throw new DomainError('draft_not_supported', 'Taslak yalnız yazma görevinde tutulur.')
  }
  const data = draftInputSchema.parse(input.input)
  assertSubmissionOpen(deadline, now)
  if (draft !== null && draft.learnerId !== learnerId) {
    throw new DomainError('draft_not_found', 'Taslak bulunamadı.', { kind: 'not_found' })
  }
  const current = draft?.revision ?? 0
  if (data.expectedRevision !== current) {
    throw new DomainError(
      'draft_conflict',
      'Taslak başka bir pencerede değişti; sayfayı yenileyip devam edin.',
      { kind: 'conflict', path: ['expectedRevision'] },
    )
  }
  return { learnerId, body: data.body, revision: current + 1, savedAt: new Date(now).toISOString() }
}

/**
 * Taslağı yalnız kursiyerin kendisi görür (ADR 0004 karar 6: öğretmen yalnız gönderilmiş sürümleri
 * görür). Öğretmen, yönetici, ön büro ve veli göremez.
 */
// TODO(beceri-taslak-veli): Domain veliyi anmıyor; en muhafazakâr yorumla veli de göremez.
export function canReadDraft(actor: Actor, draft: Pick<DraftRow, 'learnerId'>): boolean {
  return actor.role === 'ogrenci' && linkedRecordId(actor, 'student') === draft.learnerId
}

/**
 * Teslimin aktöre görünen hâli: gönderilmiş sürümler (eskiden yeniye; öğretmen iki sürümü yan
 * yana açar) ve yalnız kursiyerin kendisine taslak. Sürüm kapsamı (hangi öğretmen hangi kursiyeri
 * görür) `lib/scope.ts`'tedir; bu fonksiyon yalnız taslağı ayıklar.
 */
export function submissionViewFor(
  actor: Actor,
  input: { versions: readonly VersionRow[]; draft: DraftRow | null },
): { versions: VersionRow[]; draft: DraftRow | null } {
  return {
    versions: [...input.versions].sort((a, b) => a.number - b.number),
    draft: input.draft !== null && canReadDraft(actor, input.draft) ? input.draft : null,
  }
}
