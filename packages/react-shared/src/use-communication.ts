import { infiniteQueryOptions, useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'

import type { KampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from './api-result.ts'
import { collectionKeyPrefix } from './collections.ts'
import type { CommandHeaders, CommandMessages } from './commands.ts'
import { useKampusClient } from './kampus-context.ts'
import {
  conversationListKey,
  conversationMessagesKey,
  conversationsPrefix,
  institutionKey,
  parentAccountsKey,
} from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiMutation } from './use-api-mutation.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * İletişim kancaları: duyuru yazma komutları ve birebir yazışma (liste, imleçli mesaj akışı,
 * başlatma, gönderme, okundu, gerekçeli yönetici erişimi). Duyuru okuması genel koleksiyon
 * kancalarıyladır (`useCollectionList('announcements', …)`). Yetki ve kapsam sunucudadır;
 * burada yalnız çağrı, önbellek tazeleme ve Türkçe hata metni vardır (docs/domain/iletisim-ve-veli.md).
 */

export type ConversationSummary = components['schemas']['ConversationSummary']
export type ConversationMessage = components['schemas']['ConversationMessage']

type Body<K extends keyof operations> = operations[K] extends {
  requestBody: { content: { 'application/json': infer B } }
}
  ? B
  : never

export type PublishAnnouncementBody = Body<'publishAnnouncement'>
export type ReviseAnnouncementBody = Body<'reviseAnnouncement'>
export type StartConversationBody = Body<'startConversation'>

/** Duyuru ve yazışma uçlarının koda özgü metinleri; olmayan kodda sunucunun mesajı gösterilir. */
export const ANNOUNCEMENT_CHANGED_MESSAGE =
  'Duyuru siz bakarken başkası tarafından değiştirildi. Güncel hali yüklendi; sayfayı yenileyip değişikliği yeniden yapın.'
export const MESSAGE_RATE_LIMITED_MESSAGE =
  'Çok hızlı mesaj gönderiyorsunuz. Bir dakika bekleyip yeniden deneyin.'

export const ANNOUNCEMENT_MESSAGES = {
  version_conflict: ANNOUNCEMENT_CHANGED_MESSAGE,
  announcement_publisher_only: 'Duyuruyu yalnızca yayınlayan kişi veya yönetici değiştirebilir.',
  announcement_withdrawn: 'Bu duyuru geri çekilmiş; artık değiştirilemez.',
  announcement_unchanged: 'Duyuruda değişiklik yok.',
  announcement_not_found: 'Duyuru bulunamadı.',
  not_found: 'Duyuru bulunamadı.',
} as const satisfies CommandMessages

export const MESSAGE_MESSAGES = {
  rate_limited: MESSAGE_RATE_LIMITED_MESSAGE,
  conversation_relationship_ended:
    'Bu öğrenciyle ders ilişkiniz sona erdiği için yeni mesaj gönderemezsiniz; yazışmayı okuyabilirsiniz.',
  conversation_parent_restricted:
    'Bu veliyle yazışma kapalı; yeni mesaj gönderemezsiniz, yazışmayı okuyabilirsiniz.',
  conversation_party_forbidden: 'Bu kişiyle yazışma başlatma yetkiniz yok.',
  parent_choice_required: 'Yazışılacak veliyi seçin.',
  parent_account_not_found: 'Öğrencinin platformda veli hesabı bulunmuyor.',
  conversation_not_found: 'Yazışma bulunamadı.',
  not_found: 'Yazışma bulunamadı.',
} as const satisfies CommandMessages

export const ACCESS_MESSAGES = {
  forbidden:
    'Bu yazışmanın içeriğini açma yetkiniz yok. Veli yazışmaları yönetici erişimine kapalıdır.',
  access_reason_required: 'Erişim gerekçesi en az 10 karakter olmalıdır.',
  conversation_not_found: 'Yazışma bulunamadı.',
  not_found: 'Yazışma bulunamadı.',
} as const satisfies CommandMessages

/** Gerekçeli erişim gerekçesinin alt sınırı (core `accessDecision`, DOM-YTK-052). */
export const ACCESS_REASON_MIN_LENGTH = 10
/** Gerekçeli erişimin süresi (core `CONVERSATION_ACCESS_MINUTES`). */
export const ACCESS_MINUTES = 30

/** DOM-ILT-014: özel nitelikli bilgi mesajla taşınmaz; sabit, sakin bilgi notu. */
export const SENSITIVE_INFO_NOTICE =
  'Sağlık durumu, ilaç, engellilik veya aile içi hassas bilgileri mesajla paylaşmayın. Bu konularda velinin sağlık bilgisi formunu veya rehberlik randevusunu kullanmasını önerin.'

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}

const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}

// --- Duyuru komutları -----------------------------------------------------------------------

/**
 * Duyuru yayınlar (`POST /announcements`, yönetici, ön büro, öğretmen); `Idempotency-Key`
 * zorunlu. Başarıda duyuru koleksiyonu tazelenir.
 */
export function publishAnnouncementRequest(
  client: KampusClient,
  body: PublishAnnouncementBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/announcements', {
    // `Idempotency-Key` bu uçta zorunludur, `If-Match` desteklenmez.
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

export function usePublishAnnouncement(options: CommandOptions = {}) {
  return useApiCommand({
    request: publishAnnouncementRequest,
    invalidates: [collectionKeyPrefix('announcements')],
    messages: ANNOUNCEMENT_MESSAGES,
    ...withSuccess(options),
  })
}

export interface ReviseAnnouncementInput {
  announcementId: string
  /** Duyurunun okunan sürümü (`If-Match`); başkası değiştirdiyse 409. */
  version: number
  changes: ReviseAnnouncementBody
}

/** Düzeltme (`PATCH /announcements/:id`); 409'da liste tazelenir ve Türkçe uyarı gösterilir. */
export function reviseAnnouncementRequest(
  client: KampusClient,
  { announcementId, changes }: ReviseAnnouncementInput,
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/announcements/{announcementId}', {
    params: { path: { announcementId }, header: headers },
    body: changes,
  })
}

export function useReviseAnnouncement(options: CommandOptions = {}) {
  return useApiCommand({
    request: reviseAnnouncementRequest,
    version: (input: ReviseAnnouncementInput) => input.version,
    invalidates: [collectionKeyPrefix('announcements')],
    messages: ANNOUNCEMENT_MESSAGES,
    ...withSuccess(options),
  })
}

export interface WithdrawAnnouncementInput {
  announcementId: string
  version: number
  reason: string
}

/** Gerekçeli geri çekme (`POST /announcements/:id/withdraw`); kayıt silinmez. */
export function withdrawAnnouncementRequest(
  client: KampusClient,
  { announcementId, reason }: WithdrawAnnouncementInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/announcements/{announcementId}/withdraw', {
    params: { path: { announcementId }, header: headers },
    body: { reason },
  })
}

export function useWithdrawAnnouncement(options: CommandOptions = {}) {
  return useApiCommand({
    request: withdrawAnnouncementRequest,
    version: (input: WithdrawAnnouncementInput) => input.version,
    invalidates: [collectionKeyPrefix('announcements')],
    messages: ANNOUNCEMENT_MESSAGES,
    ...withSuccess(options),
  })
}

/**
 * Okundu işareti (`POST /announcements/:id/read`): alıcının ilk açılışı bir kez yazılır. Arka plan
 * işlemidir; hata toast göstermez (kullanıcı eylemi değildir), duyuru yine okunabilir.
 */
export function readAnnouncementRequest(client: KampusClient, announcementId: string) {
  return client.POST('/api/v1/announcements/{announcementId}/read', {
    params: { path: { announcementId } },
    body: {},
  })
}

export function useMarkAnnouncementRead() {
  return useApiMutation({
    request: readAnnouncementRequest,
    invalidates: [collectionKeyPrefix('announcements')],
  })
}

// --- Yazışma okuma --------------------------------------------------------------------------

/** Yazışma listesinin bir sayfadaki kaydı (API `pageSize` ≤ 100); sonraki sayfalar istek üzerine gelir. */
export const CONVERSATION_PAGE_SIZE = 50
/** Açık ekranın liste tazeleme aralığı; arka plan sekmesinde çalışmaz. */
export const CONVERSATION_REFRESH_MS = 30_000

/** `GET /conversations` yanıtının kullandığımız kısmı: sayfa kayıtları ve süzgeçli toplam. */
export interface ConversationPage {
  data: ConversationSummary[]
  meta: { total: number }
}

/**
 * Sonraki sayfa numarası; yoksa `undefined` (liste sonu). Sayfalar `page/pageSize` ile gelir:
 * yüklenen kayıt sayısı toplama ulaştıysa ya da son sayfa boşsa son sayfadır. Boş sayfa koşulu,
 * sunucuda kayıt azalınca (toplam eskiden kalma) sonsuz istek atılmasını önler.
 */
export function nextConversationPage(pages: readonly ConversationPage[]): number | undefined {
  const last = pages.at(-1)
  if (!last || last.data.length === 0) return undefined
  const loaded = pages.reduce((sum, page) => sum + page.data.length, 0)
  return loaded < last.meta.total ? pages.length + 1 : undefined
}

/**
 * Sayfaları tek listeye birleştirir. Sayfalar arasında bir yazışma yeni mesajla öne geçerse iki
 * sayfada da görünebilir; aynı kimlik bir kez, ilk görüldüğü yerde kalır. `total` son sayfanın
 * (en güncel) süzgeçli toplamıdır.
 */
export function mergeConversationPages(pages: readonly ConversationPage[] | undefined): {
  items: ConversationSummary[]
  total: number
} {
  if (!pages || pages.length === 0) return { items: [], total: 0 }
  const seen = new Set<string>()
  const items: ConversationSummary[] = []
  for (const page of pages)
    for (const item of page.data)
      if (!seen.has(item.id)) {
        seen.add(item.id)
        items.push(item)
      }
  return { items, total: pages.at(-1)?.meta.total ?? 0 }
}

/**
 * Yazışma listesi sorgu seçenekleri: sayfa numarasıyla sonsuz sorgu. Kanca ve testler aynı
 * seçenekleri kullanır; ekran yalnız `fetchNextPage` çağırır.
 */
export function conversationListQueryOptions(
  client: KampusClient,
  institutionId: string | null,
  filters: { studentId?: string | undefined } = {},
) {
  return infiniteQueryOptions<
    ConversationPage,
    ApiError,
    InfiniteData<ConversationPage, number>,
    readonly unknown[],
    number
  >({
    queryKey: institutionKey(institutionId, ...conversationListKey(filters)),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      runRequest(() =>
        client.GET('/api/v1/conversations', {
          params: {
            query: {
              page: pageParam,
              pageSize: CONVERSATION_PAGE_SIZE,
              ...(filters.studentId ? { studentId: filters.studentId } : {}),
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (_last, pages) => nextConversationPage(pages),
  })
}

/**
 * Oturum sahibinin yazışmaları (`GET /conversations`), son etkinliğe göre, sayfa sayfa. `items`
 * şimdiye kadar yüklenen kayıtlardır; `hasNextPage` doğruysa `fetchNextPage` sonrakini getirir
 * ("Daha fazla yükle", mobilde `onEndReached`). Yöneticide `studentId` zorunludur (yalnız üst
 * veri döner). Tazeleme (30 sn, mesaj gönderimi) yüklenmiş sayfaların hepsini yeniler.
 */
export function useConversations(
  options: { studentId?: string | undefined; enabled?: boolean } = {},
) {
  const { studentId, enabled = true } = options
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const query = useInfiniteQuery({
    ...conversationListQueryOptions(client, institutionId, { studentId }),
    enabled: institutionId !== null && enabled,
    refetchInterval: CONVERSATION_REFRESH_MS,
  })
  const merged = useMemo(() => mergeConversationPages(query.data?.pages), [query.data])
  return { ...query, items: merged.items, total: merged.total }
}

export const MESSAGE_PAGE_SIZE = 30

type MessagePage = { data: ConversationMessage[]; meta: { nextCursor: string | null } }

/**
 * Mesaj akışı sayfaları en yeniden geriye gelir; her sayfa kendi içinde eskiden yeniye sıralıdır.
 * Ekranda tek akış için eski sayfalar öne alınır.
 */
export function flattenMessagePages(
  pages: readonly { data: readonly ConversationMessage[] }[] | undefined,
): ConversationMessage[] {
  if (!pages) return []
  return [...pages].reverse().flatMap((page) => page.data)
}

/**
 * Yazışmanın mesajları (`GET /conversations/:id/messages`), eskiye doğru imleçli. `fetchNextPage`
 * "Daha eski mesajlar"dır. Yöneticide erişim gerekçeyle açılmadan 404 döner; `enabled` ile
 * erişim açılana kadar istek atılmaz.
 */
export function useConversationMessages(
  conversationId: string | null,
  options: { enabled?: boolean } = {},
) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const id = conversationId ?? ''
  const query = useInfiniteQuery<
    MessagePage,
    ApiError,
    InfiniteData<MessagePage, string | undefined>,
    readonly unknown[],
    string | undefined
  >({
    queryKey: institutionKey(institutionId, ...conversationMessagesKey(id)),
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      runRequest(() =>
        client.GET('/api/v1/conversations/{conversationId}/messages', {
          params: {
            path: { conversationId: id },
            query: { limit: MESSAGE_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
          },
          signal,
        }),
      ),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    enabled: institutionId !== null && id !== '' && (options.enabled ?? true),
  })
  return { ...query, messages: flattenMessagePages(query.data?.pages) }
}

/** Öğrencinin veli hesapları (`GET /students/:id/parent-accounts`); yalnız yazışma başlatan öğretmen. */
export function useParentAccounts(studentId: string | null, options: { enabled?: boolean } = {}) {
  const id = studentId ?? ''
  return useApiQuery({
    key: parentAccountsKey(id),
    request: (client, signal) =>
      client.GET('/api/v1/students/{studentId}/parent-accounts', {
        params: { path: { studentId: id } },
        signal,
      }),
    enabled: id !== '' && (options.enabled ?? true),
  })
}

// --- Yazışma komutları ----------------------------------------------------------------------

export type StartConversationInput = StartConversationBody

/**
 * Yazışma başlatır (`POST /conversations`). Aynı taraflar için varsa yenisi açılmaz (200), yoksa
 * açılır (201); `entity.id` yazışma kimliğidir. İlk mesaj `text` ile gönderilebilir.
 */
export function startConversationRequest(
  client: KampusClient,
  body: StartConversationInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/conversations', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

export function useStartConversation(options: CommandOptions = {}) {
  return useApiCommand({
    request: startConversationRequest,
    invalidates: [conversationsPrefix()],
    messages: MESSAGE_MESSAGES,
    ...withSuccess(options),
  })
}

export interface SendMessageInput {
  conversationId: string
  text: string
}

/**
 * Mesaj gönderir (`POST /conversations/:id/messages`, dakikada 30). İyimser güncelleme yoktur:
 * başarıdan sonra mesaj akışı ve liste tazelenir. Aynı gövdenin belirsiz hatadan sonra yeniden
 * gönderimi aynı `Idempotency-Key`'i taşır; tek mesaj üretir.
 */
export function sendMessageRequest(
  client: KampusClient,
  { conversationId, text }: SendMessageInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/conversations/{conversationId}/messages', {
    params: {
      path: { conversationId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
    body: { text },
  })
}

export function useSendMessage(options: CommandOptions = {}) {
  return useApiCommand({
    request: sendMessageRequest,
    invalidates: [conversationsPrefix()],
    messages: MESSAGE_MESSAGES,
    ...withSuccess(options),
  })
}

/**
 * Yazışmayı okundu işaretler (`POST /conversations/:id/read`). Arka plan işlemidir; hata toast
 * göstermez. Yöneticinin gerekçeli okuması okundu üretmez, bu yüzden çağrılmaz.
 */
export function readConversationRequest(client: KampusClient, conversationId: string) {
  return client.POST('/api/v1/conversations/{conversationId}/read', {
    params: { path: { conversationId } },
    body: {},
  })
}

export function useMarkConversationRead() {
  return useApiMutation({
    request: readConversationRequest,
    invalidates: [conversationsPrefix()],
  })
}

export interface OpenAccessInput {
  conversationId: string
  reason: string
}

/**
 * Yöneticinin gerekçeli erişimi (`POST /conversations/:id/access`): 30 dakika geçerli, denetim
 * kaydına yazılır. Yanıtın `expiresAt` değeri ekranda kalan süre için kullanılır.
 */
export function openAccessRequest(
  client: KampusClient,
  { conversationId, reason }: OpenAccessInput,
) {
  return client.POST('/api/v1/conversations/{conversationId}/access', {
    params: { path: { conversationId } },
    body: { reason },
  })
}

export function useOpenConversationAccess(
  options: { onSuccess?: (access: { conversationId: string; expiresAt: string }) => void } = {},
) {
  return useApiCommand({
    request: openAccessRequest,
    invalidates: [conversationsPrefix()],
    messages: ACCESS_MESSAGES,
    onSuccess: (data) => options.onSuccess?.(data.data),
  })
}

/** Kalan erişim süresi (ms); bitmişse 0. Saf: `now` verilir. */
export function accessRemainingMs(expiresAt: string, now: number): number {
  const end = Date.parse(expiresAt)
  return Number.isFinite(end) ? Math.max(0, end - now) : 0
}
