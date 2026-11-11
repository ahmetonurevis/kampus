import type { QueryClient } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import { isApiError } from '@kampus/api-client/errors.ts'
import type { components } from '@kampus/api-client/schema.d.ts'

import { fetchFileUrl, type FileUrl } from './files.ts'
import { institutionKey } from './query-keys.ts'
import { TASK_ATTEMPTS_KEY } from './use-task-attempts.ts'

/**
 * Dinleme etkinliğinin istemci kuralları (OG-052; IST-045, DOM-BEC-005). Hak sunucuda sayılır
 * (`GET /files/:fileId/url`, `attemptId` ile); burada kalan hakkın okunması, sayaç metni,
 * bağlantının yeniden kullanılması ve hata kodlarının Türkçe metinleri vardır. Web ve mobil aynı
 * yardımcıları kullanır.
 *
 * Bir dinleme bir bağlantı ömrüdür (kayıt süresi + 60 sn): bağlantı geçerliyken oynatıcının
 * yeniden bağlanması yeni istek atmaz; aynı pencerede yeni istek atılsa da sunucu saymaz (sayfa
 * yenileme) ve aynı bitiş anıyla bağlantı verir.
 */

type Schemas = components['schemas']
type AttemptDetail = Schemas['TaskAttemptDetail']

/** Deneme ayrıntısındaki dinleme kaydı (başlık, dosya, döküm, altyazı, kaynak gösterimi). */
export type ListeningRecording = NonNullable<AttemptDetail['listeningRecording']>
/** Deneme ayrıntısındaki hak özeti; sınırsız ya da sayılacak kayıt yoksa `null`. */
export type AttemptListening = AttemptDetail['listening']
/** Bağlantı yanıtındaki sayım; yalnız öğrencinin süren denemesinde sınırlı kayıtta dolu. */
export type ListeningGrant = NonNullable<Schemas['FileUrl']['listening']>

export interface ListeningAllowance {
  limit: number
  used: number
  remaining: number
}

/** Bağlantı isteğinin hata kodları; kullanıcıya teknik ayrıntı gösterilmez. */
export const LISTENING_MESSAGES = {
  listening_plays_exhausted: 'Bu kaydın dinleme hakkı doldu.',
  listening_attempt_required: 'Kayıt, görev açıkken yalnız denemenin içinde dinlenebilir.',
  listening_attempt_mismatch: 'Bu dinleme kaydı bu göreve ait değil.',
  listening_attempt_closed: 'Deneme sona erdi; kayıt yalnız süren denemede dinlenebilir.',
  listening_attempt_running:
    'Bu kayıt süren bir denemenizde sınırlı; dinlemeyi o denemenin ekranından açın.',
  file_processing: 'Kayıt hazırlanıyor; biraz sonra yeniden deneyin.',
  not_found: 'Kayıt bulunamadı.',
} as const

export type ListeningErrorCode = keyof typeof LISTENING_MESSAGES

export const LISTENING_FAILED_MESSAGE = 'Kayıt açılamadı. Biraz sonra yeniden deneyin.'

/** Bilinen dinleme hata kodu; değilse `null` (ağ, sunucu ya da başka hata). */
export function listeningErrorCode(error: unknown): ListeningErrorCode | null {
  if (!isApiError(error)) return null
  return Object.hasOwn(LISTENING_MESSAGES, error.code) ? (error.code as ListeningErrorCode) : null
}

/** Hatanın Türkçe metni; bilinmeyen hata genel metindir. */
export function listeningErrorMessage(error: unknown): string {
  const code = listeningErrorCode(error)
  return code === null ? LISTENING_FAILED_MESSAGE : LISTENING_MESSAGES[code]
}

/**
 * Dinleme kaydının bağlantısını ister (`attemptId` yalnız öğrencinin süren denemesinde). Hak
 * sayıldıysa denemenin ayrıntı sorgusu eskitilir: ekrandaki sayaç yanıttan güncellenir, sayfaya
 * dönünce deneme ayrıntısı da kalan hakkı doğru gösterir. Tazeleme beklenmez; oynatıcı gecikmez.
 */
export async function fetchListeningUrl(
  client: KampusClient,
  queryClient: QueryClient,
  institutionId: string | null,
  fileId: string,
  attemptId?: string,
): Promise<FileUrl> {
  const result = await fetchFileUrl(client, fileId, attemptId ? { attemptId } : {})
  if (result.listening?.counted)
    void queryClient.invalidateQueries({
      queryKey: institutionKey(
        institutionId,
        TASK_ATTEMPTS_KEY,
        'detail',
        result.listening.attemptId,
      ),
    })
  return result
}

/**
 * Kaydın bu denemedeki hakkı (`null` sınırsız). Henüz dinlenmemiş kayıt `media`'da yoksa hakkın
 * tamamı kalır.
 */
export function listeningAllowance(
  listening: AttemptListening,
  fileId: string,
): ListeningAllowance | null {
  if (!listening) return null
  const media = listening.media.find((item) => item.fileId === fileId)
  return {
    limit: listening.limit,
    used: media?.used ?? 0,
    remaining: media?.remaining ?? listening.limit,
  }
}

/** Bağlantı yanıtının sayımı deneme ayrıntısından yenidir; ekranda onun yerine geçer. */
export const allowanceOf = (grant: ListeningGrant): ListeningAllowance => ({
  limit: grant.limit,
  used: grant.used,
  remaining: grant.remaining,
})

// Sayının belirtme/iyelik eki (ünlü uyumu son okunan sözcüğe göre): 1'i, 2'si, 3'ü, 6'sı, 10'u.
const UNIT_SUFFIX = ["'ı", "'i", "'si", "'ü", "'ü", "'i", "'sı", "'si", "'i", "'u"] as const
const TEN_SUFFIX = ['', "'u", "'si", "'u", "'ı", "'si", "'ı", "'i", "'i", "'ı"] as const

/** Sayıya Türkçe ek: `1'i`, `2'si`, `20'si`, `100'ü`. */
export function numberWithSuffix(value: number): string {
  const n = Math.abs(Math.trunc(value))
  const unit = n % 10
  const ten = Math.trunc(n / 10) % 10
  const suffix =
    n === 0 || unit !== 0
      ? UNIT_SUFFIX[unit]
      : ten !== 0
        ? TEN_SUFFIX[ten]
        : n % 1000 === 0
          ? "'i"
          : "'ü"
  return `${value}${suffix ?? ''}`
}

/** Kalan hak metni: "2 dinleme hakkından 1'i kaldı"; hak bitince "Dinleme hakkınız doldu." */
export function listeningCounterText(allowance: ListeningAllowance): string {
  if (allowance.remaining <= 0) return 'Dinleme hakkınız doldu.'
  if (allowance.remaining >= allowance.limit) return `${allowance.limit} dinleme hakkınız var.`
  return `${allowance.limit} dinleme hakkından ${numberWithSuffix(allowance.remaining)} kaldı.`
}

/**
 * Bağlantının bitişine bu kadar kala yeniden kullanılmaz: oynatıcı yeni aralık isteğini bitişten
 * önce atabilsin.
 */
export const LISTENING_LINK_MARGIN_MS = 5_000

/** Bağlantı hâlâ geçerli mi (aynı dinleme penceresi); geçerliyse yeni istek atılmaz. */
export function linkUsable(link: { expiresAt: string } | null, now: number): boolean {
  if (link === null) return false
  const ends = Date.parse(link.expiresAt)
  return Number.isFinite(ends) && ends - LISTENING_LINK_MARGIN_MS > now
}
