import { useQueries, type UseQueryOptions } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import type { CommandHeaders, CommandMessages } from './commands.ts'
import { useKampusClient } from './kampus-context.ts'
import {
  consentListKey,
  consentsPrefix,
  consentStatusKey,
  consentTextKey,
  institutionKey,
} from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * Açık rıza kancaları (IST-017; core `lib/consents.ts`, docs/domain/yetki-ve-kapsam.md
 * DOM-YTK-056…062, docs/muhendislik/guvenlik-kvkk.md §9): güncel rıza metni, rıza satırları,
 * amaç başına geçerlilik sonucu, rıza verme ve geri çekme. Kimin vereceği, yaş ve velayet sunucuda
 * karara bağlanır; istemci yalnız sonucu ve Türkçe hata iletisini gösterir. Rıza varsayılan
 * değildir: bu kancalar hiçbir yerde "verildi" varsaymaz.
 */

type TextResponse = operations['getConsentText']['responses'][200]['content']['application/json']
type ListResponse = operations['listConsents']['responses'][200]['content']['application/json']
type StatusResponse =
  operations['getConsentStatus']['responses'][200]['content']['application/json']
type GiveBody = operations['giveConsent']['requestBody']['content']['application/json']

export type ConsentPurposeKey = GiveBody['purpose']
export type ConsentTextView = TextResponse['data']
export type ConsentView = ListResponse['data'][number]
export type ConsentStatusView = StatusResponse['data'][number]
export type ConsentChannelKey = GiveBody['channel']
export type ConsentListStatus = 'open' | 'all'

/** Rıza satırları tek sayfada gelir (en çok 6 amaç × geçmiş); API `pageSize` ≤ 100. */
export const CONSENT_PAGE_SIZE = 100
/** Kayıt kanalı: bu paketin web ve mobil ortak kancası olduğundan çağıran verir. */
export const DEFAULT_CONSENT_CHANNEL: ConsentChannelKey = 'web'

/**
 * Hata kodu → kullanıcı iletisi (api-tasarimi.md rıza maddesi). Kodlar sunucudadır; bu tablo
 * iletiyi veli ve öğrenciye uygun, teknik ayrıntısız söyler (verilmeyen kodda sunucunun Türkçe
 * iletisi kullanılır).
 */
export const CONSENT_MESSAGES = {
  consent_text_outdated: 'Rıza metni güncellendi. Güncel metni okuyup yeniden onaylayın.',
  consent_adult_self: 'Öğrenci 18 yaşını doldurduğu için rızayı kendisi verir.',
  consent_exists: 'Bu amaç için geçerli bir rızanız zaten var.',
  consent_required: 'Bu işlem için önce rızanın verilmesi gerekir.',
  consent_guardian_required: '18 yaşından küçük öğrenci için rızayı velayet sahibi veli verir.',
  consent_custody_required: 'Bu rızayı yalnız doğrulanmış velayet sahibi veli verebilir.',
  consent_already_withdrawn: 'Bu rıza zaten geri çekilmiş.',
  consent_text_not_found: 'Bu amaç için rıza metni henüz yayımlanmadı; rıza alınamıyor.',
  consent_not_applicable: 'Bu rıza 18 yaşından küçük öğrenciden alınmaz.',
  objection_exists: 'Bu amaç için itirazınız zaten kayıtlı.',
  objection_not_applicable:
    'Bu amaç için itiraz kaydı alınmaz ya da 18 yaşını doldurduğunuz için itiraz gerekmez.',
  academic_year_required:
    'Kurumun eğitim yılı tanımlı olmadığı için rıza kaydedilemedi. Lütfen okulunuzla görüşün.',
} as const satisfies CommandMessages

/** `error.code` için Türkçe ileti; tabloda yoksa sunucunun iletisi. */
export function consentErrorMessage(error: ApiError): string {
  return (CONSENT_MESSAGES as CommandMessages)[error.code] ?? error.message
}

/**
 * Formun kendi gösterdiği hatalar (toast çıkmaz): güncel olmayan metin, mükerrer rıza ve
 * yayımlanmamış metin kartın içinde anlatılır, kullanıcının eylemini ister.
 */
export function isConsentInlineError(error: ApiError): boolean {
  return (
    error.code === 'consent_text_outdated' ||
    error.code === 'consent_exists' ||
    error.code === 'consent_text_not_found'
  )
}

export function consentTextRequest(
  client: KampusClient,
  purpose: ConsentPurposeKey,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/consent-texts/{purpose}', {
    params: { path: { purpose } },
    ...(signal ? { signal } : {}),
  })
}

export interface ConsentListQuery {
  /** Öğrenci amaçları için öğrenci; yoksa oturum sahibinin hesap amaçları. */
  studentId?: string | undefined
  /** `all` (varsayılan) geri çekilmişleri de getirir; `open` yalnız geri çekilmemişleri. */
  status?: ConsentListStatus
}

export function listConsentsRequest(
  client: KampusClient,
  query: ConsentListQuery,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/consents', {
    params: {
      query: {
        page: 1,
        pageSize: CONSENT_PAGE_SIZE,
        status: query.status ?? 'all',
        ...(query.studentId ? { studentId: query.studentId } : {}),
      },
    },
    ...(signal ? { signal } : {}),
  })
}

export function consentStatusRequest(
  client: KampusClient,
  query: { studentId?: string | undefined },
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/consents/status', {
    params: { query: query.studentId ? { studentId: query.studentId } : {} },
    ...(signal ? { signal } : {}),
  })
}

export interface GiveConsentInput {
  purpose: ConsentPurposeKey
  /** Öğrenci amaçlarında zorunlu, hesap amaçlarında verilmez. */
  studentId?: string | undefined
  /** Kullanıcıya gösterilen rıza metninin kimliği (`useConsentText`). */
  textId: string
  /** `granted` rıza (varsayılan), `objected` 18 yaş altı öğrencinin itirazı (DOM-YTK-062). */
  decision?: 'granted' | 'objected'
  channel?: ConsentChannelKey
}

export function giveConsentRequest(
  client: KampusClient,
  input: GiveConsentInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/consents', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body: {
      purpose: input.purpose,
      textId: input.textId,
      decision: input.decision ?? 'granted',
      channel: input.channel ?? DEFAULT_CONSENT_CHANNEL,
      ...(input.studentId ? { studentId: input.studentId } : {}),
    },
  })
}

/** Geri çekme gövdesizdir (boş nesne); `If-Match` kabul edilmez. */
export function withdrawConsentRequest(
  client: KampusClient,
  consentId: string,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/consents/{consentId}/withdraw', {
    params: {
      path: { consentId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
    body: {},
  })
}

/**
 * Amacın güncel rıza metni ve geçerli rıza için en düşük sürüm. Rıza formu bu metni gösterir ve
 * `textId` olarak gönderir. Yayımlanmış metin yoksa 404 `consent_text_not_found` (hata nesnesinde):
 * o amaçta rıza alınamaz.
 */
export function useConsentText(purpose: ConsentPurposeKey, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: consentTextKey(purpose),
    request: (client, signal) => consentTextRequest(client, purpose, signal),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}

/**
 * Birden çok amacın güncel metni (rıza adımı): `useConsentText` ile aynı sorgu anahtarı, ama
 * amaç listesi değişebilir. Sonuçlar `purposes` sırasındadır.
 */
export function useConsentTexts(
  purposes: readonly ConsentPurposeKey[],
  options: { enabled?: boolean } = {},
) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQueries({
    queries: purposes.map((purpose): UseQueryOptions<TextResponse, ApiError> => ({
      queryKey: institutionKey(institutionId, ...consentTextKey(purpose)),
      queryFn: ({ signal }) => runRequest(() => consentTextRequest(client, purpose, signal)),
      enabled: institutionId !== null && (options.enabled ?? true),
    })),
  })
}

/**
 * Rıza ve itiraz satırları (geri çekilmişler dahil): öğrenci amaçları için `studentId`, yoksa
 * oturum sahibinin hesap amaçları. Veli ve öğrenci rızayı veren kullanıcının kimliğini görmez
 * (`grantedByUserId` dönmez), yalnız ilişkiyi (`grantorRelation`).
 */
export function useConsents(
  studentId?: string,
  options: { status?: ConsentListStatus; enabled?: boolean } = {},
) {
  const status = options.status ?? 'all'
  return useApiQuery({
    key: consentListKey({ studentId, status }),
    request: (client, signal) => listConsentsRequest(client, { studentId, status }, signal),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}

/** Amaç başına yalnız var/yok (DOM-YTK-061): geçerli rıza var ve etkin itiraz yok. */
export function useConsentStatus(studentId?: string, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: consentStatusKey({ studentId }),
    request: (client, signal) => consentStatusRequest(client, { studentId }, signal),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}

/**
 * Rıza verir ya da itiraz kaydeder. `Idempotency-Key` kancanın komut oturumunda üretilir: her
 * kullanıcı eylemine yeni anahtar, belirsiz hatadan (ağ, 5xx) sonra aynı gövdenin yeniden
 * gönderiminde aynı anahtar (çift kayıt olmaz). Başarıda ve 409'da (`consent_text_outdated`,
 * `consent_exists`) metin, satır ve sonuç sorguları tazelenir. Hata iletileri Türkçe'dir
 * (`CONSENT_MESSAGES`); `isConsentInlineError` olanlar `submit(…, { silent })` ile formda anlatılır.
 */
export function useGiveConsent(
  options: { onSuccess?: (consent: ConsentView, input: GiveConsentInput) => void } = {},
) {
  return useApiCommand({
    request: giveConsentRequest,
    invalidates: [consentsPrefix()],
    messages: CONSENT_MESSAGES,
    onSuccess: (data, input) => options.onSuccess?.(data.data, input),
  })
}

/** Rızayı ya da itirazı tek işlemle geri çeker (DOM-YTK-059); etkisi anındadır. */
export function useWithdrawConsent(options: { onSuccess?: (consent: ConsentView) => void } = {}) {
  return useApiCommand({
    request: withdrawConsentRequest,
    invalidates: [consentsPrefix()],
    messages: CONSENT_MESSAGES,
    onSuccess: (data) => options.onSuccess?.(data.data),
  })
}
