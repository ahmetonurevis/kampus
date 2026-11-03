import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import type { KampusClient } from '@kampus/api-client/client.ts'
import { CLIENT_ERROR_CODES, type ApiError } from '@kampus/api-client/errors.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'
import { normalizeVerificationCode } from '@kampus/school-core/cefr/certificates.ts'

import { runRequest } from './api-result.ts'
import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { fetchAllPages, type ListPage } from './institution-lists.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey, sessionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * Kurum başarı belgesi ve MEBBİS belge izi kancaları (OG-088; IST-081; DOM-DIL-080, 081, 082):
 * liste, ayrıntı, düzenleme, iptal (`If-Match`), grubun MEBBİS listesi ve işareti, kimliksiz
 * doğrulama. Kapsam ve yetki sunucudadır: öğrenci ve 18 yaş altı kursiyerin velisi yalnız geçerli
 * belgeyi (düzenleyen ve iptal izi olmadan) alır, yetişkin kursiyerin velisi hiç almaz. Belgeyi
 * kurum yöneticisi ya da kurun seviyesinin akademik koordinatörü düzenler ve iptal eder.
 * Doğrulama oturumsuzdur; sorgu anahtarı kuruma bağlı değildir.
 */

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

type Data<
  TOperation extends keyof operations,
  TStatus extends 200 | 201,
> = operations[TOperation] extends {
  responses: Record<TStatus, { content: { 'application/json': { data: infer TData } } }>
}
  ? TData
  : never

export type CertificateListQuery = NonNullable<
  operations['listCourseCertificates']['parameters']['query']
>
/** Liste satırı: personel tam belgeyi, öğrenci ve veli dar belgeyi alır. */
export type CourseCertificate = Data<'listCourseCertificates', 200>[number]
/** Personelin gördüğü belge (`rowVersion`, kayıt, iptal izi). */
export type StaffCourseCertificate = Data<'issueCourseCertificate', 201>
export type CertificateContent = CourseCertificate['content']
export type GroupMebbisList = Data<'getGroupMebbisCertificates', 200>
export type MebbisLearner = GroupMebbisList['learners'][number]
export type CertificateVerification = Data<'verifyCourseCertificate', 200>

export type IssueCertificateBody = JsonBody<'issueCourseCertificate'>
export type CancelCertificateBody = JsonBody<'cancelCourseCertificate'>
export type MebbisRecordBody = JsonBody<'recordMebbisCertificate'>

/** Sorgu anahtarlarının kökleri; yazma sonrası belge listeleri ve MEBBİS listesi tazelenir. */
export const COURSE_CERTIFICATES_KEY = 'course-certificates'
export const MEBBIS_CERTIFICATES_KEY = 'mebbis-certificates'
export const CERTIFICATE_INVALIDATES = [
  [COURSE_CERTIFICATES_KEY],
  [MEBBIS_CERTIFICATES_KEY],
] as const

export const CERTIFICATE_CHANGED_MESSAGE =
  'Belge bu arada değişti. Güncel hâli yüklendi; kontrol edip yeniden deneyin.'

/**
 * Koda özgü Türkçe metinler (DOM-DIL-080, 081, 082). `certificate_cancel_first` kur sonu kararının
 * düzeltme onayında döner; belge ekranı da aynı metni kullanır.
 */
export const CERTIFICATE_MESSAGES = {
  version_conflict: CERTIFICATE_CHANGED_MESSAGE,
  not_found: 'Belge ya da kayıt bulunamadı. Liste güncellendi.',
  certificate_not_found: 'Yerine düzenlenecek belge bulunamadı. Liste güncellendi.',
  progression_not_found: 'Kur sonu kararı bulunamadı. Liste güncellendi.',
  permission_denied:
    'Bu işlem için yetkiniz yok. Belgeyi kurum yöneticisi ya da kurun akademik koordinatörü düzenler.',
  module_disabled: 'Akademik modül kapalı; belge işlemleri yapılamaz.',
  certificate_cancel_first:
    'Önce düzenlenmiş belge iptal edilmeli; ardından kur sonu kararı düzeltilebilir.',
  certificate_already_issued:
    'Bu kursiyerin geçerli bir belgesi var. Hata varsa belgeyi iptal edip yeniden düzenleyin.',
  certificate_already_cancelled: 'Bu belge zaten iptal edildi.',
  certificate_already_replaced: 'Bu belgenin yerine yeni belge zaten düzenlendi.',
  certificate_replacement_required:
    'Kursiyerin iptal edilmiş belgesi var; yeni belge “Yeniden düzenle” ile onun yerine düzenlenir.',
  certificate_replace_not_cancelled: 'Yalnız iptal edilmiş belgenin yerine yeni belge düzenlenir.',
  certificate_decision_pending:
    'Kur sonu kararı onay bekliyor; belge onaylı geçti kararıyla düzenlenir.',
  certificate_no_decision: 'Onaylı kur sonu kararı yok; belge düzenlenemez.',
  certificate_not_eligible:
    'Kursiyer belgeye hak kazanmadı (tekrar ya da devamsızlık kararı); belge düzenlenmez.',
  certificate_decision_superseded:
    'Kur sonu kararı düzeltildi; belge güncel kararla düzenlenir. Liste güncellendi.',
  certificate_wording_forbidden:
    'Kur ya da kurum adında “CEFR sertifikası”, “Avrupa Konseyi” gibi ifadeler var; önce adı düzeltin.',
  certificate_learner_name_missing:
    'Kursiyerin adı kayıtlı değil; önce öğrenci kaydını tamamlayın.',
  certificate_basis_incomplete:
    'Karar dayanağında kur sonu değerlendirmesi yok; belge düzenlenemez.',
  mebbis_already_recorded: 'Bu kursiyerin MEBBİS belgesi zaten işaretlendi.',
  mebbis_date_in_future: 'MEBBİS belge tarihi ileri bir gün olamaz.',
} as const satisfies CommandMessages

/** Hatanın form alanı; yalnız gövde alanına bağlı iş kuralları (diğerleri toast). */
export const CERTIFICATE_ERROR_FIELDS = {
  mebbis_date_in_future: 'issuedDate',
} as const satisfies Readonly<Record<string, string>>

export function certificateErrorField(error: ApiError): string | undefined {
  return (CERTIFICATE_ERROR_FIELDS as Readonly<Record<string, string>>)[error.code]
}

/** Ekrandaki belge ya da liste eskidi (sürüm çakıştı, kayıt yok, karar düzeltildi): tazelenir. */
export const certificateStale = (error: ApiError) =>
  error.status === 404 ||
  (error.status === 409 && error.code === 'version_conflict') ||
  error.code === 'certificate_decision_superseded'

/** Personel yanıtı mı (sürüm ve kayıt alanları var)? Öğrenci ve veli dar belgeyi alır. */
export function isStaffCertificate(
  certificate: CourseCertificate,
): certificate is Extract<CourseCertificate, { rowVersion: number }> {
  return 'rowVersion' in certificate
}

/**
 * İptal edilmiş ve yerine henüz belge düzenlenmemiş belge (DOM-DIL-082): yeni belge yalnız onun
 * yerine (`replacesCertificateId`) düzenlenir. `all` aynı kaydın (ya da kurumun) belgeleridir.
 */
export function awaitingReplacement(
  certificate: StaffCourseCertificate | Extract<CourseCertificate, { rowVersion: number }>,
  all: readonly CourseCertificate[],
): boolean {
  return (
    certificate.status === 'cancelled' &&
    !all.some(
      (other) => isStaffCertificate(other) && other.replacesCertificateId === certificate.id,
    )
  )
}

/**
 * Kaydın belge durumu (MEBBİS listesindeki satır için): geçerli belge, yerine belge bekleyen
 * iptal ya da belge yok. Düzenleme düğmesi bu duruma göre "Belge düzenle" ya da "Yeniden düzenle"
 * olur.
 */
export type EnrollmentCertificateState =
  | { kind: 'valid'; certificate: Extract<CourseCertificate, { rowVersion: number }> }
  | { kind: 'replace'; certificate: Extract<CourseCertificate, { rowVersion: number }> }
  | { kind: 'none' }

export function enrollmentCertificateState(
  enrollmentId: string,
  all: readonly CourseCertificate[],
): EnrollmentCertificateState {
  const own = all.filter(
    (certificate): certificate is Extract<CourseCertificate, { rowVersion: number }> =>
      isStaffCertificate(certificate) && certificate.enrollmentId === enrollmentId,
  )
  const valid = own.find((certificate) => certificate.status === 'valid')
  if (valid) return { kind: 'valid', certificate: valid }
  const pending = own.find((certificate) => awaitingReplacement(certificate, own))
  return pending ? { kind: 'replace', certificate: pending } : { kind: 'none' }
}

// --- Kimliksiz doğrulama ---------------------------------------------------------------------

export const VERIFICATION_MESSAGES = {
  notFound: 'Belge bulunamadı. Kodu belgede yazdığı gibi girdiğinizden emin olun.',
  rateLimited: 'Çok fazla deneme yaptınız. Bir dakika bekleyip yeniden deneyin.',
  network: 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin.',
  unavailable: 'Doğrulama şu anda yapılamıyor. Lütfen biraz sonra yeniden deneyin.',
  invalidCode: 'Doğrulama kodunu belgede yazdığı gibi girin (28 karakter, tireler isteğe bağlı).',
} as const

/** Doğrulama hatasının kullanıcı metni; sunucunun teknik ayrıntısı gösterilmez. */
export function verificationErrorMessage(error: ApiError): string {
  if (error.status === 404) return VERIFICATION_MESSAGES.notFound
  if (error.status === 429) return VERIFICATION_MESSAGES.rateLimited
  if (error.code === CLIENT_ERROR_CODES.network) return VERIFICATION_MESSAGES.network
  return VERIFICATION_MESSAGES.unavailable
}

/** Doğrulama formu: kod büyük/küçük harf, boşluk ve tireden bağımsız kanonik biçime iner. */
export const verificationFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Doğrulama kodunu girin.')
    .refine(
      (value) => normalizeVerificationCode(value) !== null,
      VERIFICATION_MESSAGES.invalidCode,
    ),
})
export type VerificationFormInput = z.input<typeof verificationFormSchema>

/** Doğrulama sorgusunun anahtarı: oturumdan ve kurumdan bağımsız, kanonik koda göre. */
export const verificationKey = (code: string) => sessionKey('certificate-verification', code)

export function verifyCertificateRequest(client: KampusClient, code: string, signal?: AbortSignal) {
  return client.GET('/api/v1/certificate-verifications/{code}', {
    params: { path: { code } },
    ...(signal ? { signal } : {}),
  })
}

/**
 * Doğrulama sonucu önbellekte bayatlamaz: belge iptal edilebilir, geri/ileri gezinmede ya da
 * sayfa yeniden açıldığında iptal edilmiş belge "Geçerli" görünmemelidir (DOM-DIL-082).
 */
export const VERIFICATION_QUERY_FRESHNESS = { staleTime: 0, refetchOnMount: 'always' } as const

/**
 * Kimliksiz doğrulama (`GET /certificate-verifications/:code`). Biçimi bozuk kod için istek
 * atılmaz (sunucu da aynı 404'ü verirdi). 404 ve 429 yeniden denenmez (`shouldRetry`).
 */
export function useCertificateVerification(rawCode: string) {
  const client = useKampusClient()
  const code = normalizeVerificationCode(rawCode)
  return useQuery<CertificateVerification, ApiError>({
    queryKey: verificationKey(code ?? ''),
    queryFn: async ({ signal }) =>
      (await runRequest(() => verifyCertificateRequest(client, code ?? '', signal))).data,
    enabled: code !== null,
    ...VERIFICATION_QUERY_FRESHNESS,
  })
}

// --- Okuma -----------------------------------------------------------------------------------

interface Options {
  enabled?: boolean
}

export async function fetchCertificatePage(
  client: KampusClient,
  query: CertificateListQuery,
  signal?: AbortSignal,
): Promise<ListPage<CourseCertificate>> {
  const body = await runRequest(() =>
    client.GET('/api/v1/course-certificates', { params: { query }, ...(signal ? { signal } : {}) }),
  )
  return { rows: body.data, ...body.meta }
}

export function fetchAllCertificates(
  client: KampusClient,
  query: Omit<CertificateListQuery, 'page' | 'pageSize'>,
  signal?: AbortSignal,
): Promise<CourseCertificate[]> {
  return fetchAllPages<CertificateListQuery, CourseCertificate>(
    (pageQuery, pageSignal) => fetchCertificatePage(client, pageQuery, pageSignal),
    query,
    signal,
  )
}

/** Sayfalı belge listesi (yeniden eskiye); süzgeç değişirken önceki sayfa ekranda kalır. */
export function useCourseCertificates(query: CertificateListQuery, options: Options = {}) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, COURSE_CERTIFICATES_KEY, 'list', query),
    queryFn: ({ signal }) => fetchCertificatePage(client, query, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
    placeholderData: keepPreviousData,
  })
}

/** Süzgeçle bütün belgeler (kurun belgeleri, öğrencinin belgeleri). */
export function useAllCourseCertificates(
  query: Omit<CertificateListQuery, 'page' | 'pageSize'>,
  options: Options = {},
) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, COURSE_CERTIFICATES_KEY, 'all', query),
    queryFn: ({ signal }) => fetchAllCertificates(client, query, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
  })
}

export function useCourseCertificate(certificateId: string, options: Options = {}) {
  return useApiQuery({
    key: [COURSE_CERTIFICATES_KEY, 'item', certificateId],
    request: (client, signal) =>
      client.GET('/api/v1/course-certificates/{certificateId}', {
        params: { path: { certificateId } },
        signal,
      }),
    enabled: certificateId !== '' && (options.enabled ?? true),
  })
}

/** Grubun belgeye hak kazanan kursiyerleri ve MEBBİS izi (DOM-DIL-080); yalnız personel. */
export function useGroupMebbisList(groupId: string, options: Options = {}) {
  return useApiQuery({
    key: [MEBBIS_CERTIFICATES_KEY, groupId],
    request: (client, signal) =>
      client.GET('/api/v1/groups/{groupId}/mebbis-certificates', {
        params: { path: { groupId } },
        signal,
      }),
    enabled: groupId !== '' && (options.enabled ?? true),
  })
}

// --- Yazma -----------------------------------------------------------------------------------

export function issueCertificateRequest(
  client: KampusClient,
  body: IssueCertificateBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/course-certificates', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

/** İptalin girdisi; `version` belgenin okunan `rowVersion`'ıdır. */
export interface CancelCertificateInput {
  certificateId: string
  version: number
  body: CancelCertificateBody
}

export function cancelCertificateRequest(
  client: KampusClient,
  { certificateId, body }: CancelCertificateInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/course-certificates/{certificateId}/cancel', {
    params: {
      path: { certificateId },
      header: {
        'idempotency-key': headers['idempotency-key'],
        'if-match': requireIfMatch(headers),
      },
    },
    body,
  })
}

export interface MebbisRecordCommandInput {
  decisionId: string
  body: MebbisRecordBody
}

export function recordMebbisRequest(
  client: KampusClient,
  { decisionId, body }: MebbisRecordCommandInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/progression-decisions/{decisionId}/mebbis-record', {
    params: {
      path: { decisionId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
    body,
  })
}

export const issueCertificateCommand = {
  request: issueCertificateRequest,
  invalidates: CERTIFICATE_INVALIDATES,
  refreshOn: certificateStale,
  messages: CERTIFICATE_MESSAGES,
} as const
export const cancelCertificateCommand = {
  request: cancelCertificateRequest,
  version: (input: CancelCertificateInput) => input.version,
  invalidates: CERTIFICATE_INVALIDATES,
  refreshOn: certificateStale,
  messages: CERTIFICATE_MESSAGES,
} as const
export const recordMebbisCommand = {
  request: recordMebbisRequest,
  invalidates: CERTIFICATE_INVALIDATES,
  refreshOn: certificateStale,
  messages: CERTIFICATE_MESSAGES,
} as const

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}
const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}

/** Belge düzenler (`POST /course-certificates`, 201; `Idempotency-Key` zorunlu; DOM-DIL-081). */
export function useIssueCourseCertificate(options: CommandOptions = {}) {
  return useApiCommand({ ...issueCertificateCommand, ...withSuccess(options) })
}

/** Belgeyi gerekçeyle iptal eder (`If-Match` zorunlu; DOM-DIL-082). */
export function useCancelCourseCertificate(options: CommandOptions = {}) {
  return useApiCommand({ ...cancelCertificateCommand, ...withSuccess(options) })
}

/** Resmî belgenin MEBBİS'te düzenlendiğini işaretler (DOM-DIL-080). */
export function useRecordMebbisCertificate(options: CommandOptions = {}) {
  return useApiCommand({ ...recordMebbisCommand, ...withSuccess(options) })
}
