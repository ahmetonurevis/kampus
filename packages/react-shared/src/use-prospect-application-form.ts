import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Kurum sitesine gömülen ön başvuru formu (ON-133; DOM-KAY-002, -003, -004, -009; IST-145).
// Yönetici kancaları oturumludur. Açık form kancaları oturum gerektirmez, kurumu form anahtarı
// çözer; sorgu oturum kapsamındadır ve pencereye dönünce yeniden okunmaz, hız sınırı dardır.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type ApplicationFormUpdateBody = JsonBody<'updateProspectApplicationForm'>
export type ProspectApplicationBody = JsonBody<'submitProspectApplication'>

const SETTINGS_KEY = ['prospect-application-form'] as const
const INVALIDATES: readonly (readonly unknown[])[] = [SETTINGS_KEY]
const PUBLIC_KEY = 'public-application-form'

/** Yöneticinin form ayarı. */
export function useApplicationFormSettings(enabled = true) {
  return useApiQuery({
    key: SETTINGS_KEY,
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/prospects/application-form', { signal }).then((result) => result),
  })
}

export interface UpdateApplicationFormInput {
  version: number
  body: ApplicationFormUpdateBody
}

/** Formu aç/kapat, site adresini yaz; okunan sürüm `If-Match` olur. */
export function useUpdateApplicationForm() {
  return useApiCommand({
    request: (
      client: KampusClient,
      { body }: UpdateApplicationFormInput,
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/prospects/application-form', {
        params: { header: { 'if-match': requireIfMatch(headers) } },
        body,
      }),
    version: (input: UpdateApplicationFormInput) => input.version,
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

/** İlk anahtarı üretir ya da yeniler (`version: null` ilk üretim); eski anahtar hemen geçersizdir. */
export function useRotateApplicationFormKey() {
  return useApiCommand({
    request: (client: KampusClient, _input: { version: number | null }, headers: CommandHeaders) =>
      client.POST('/api/v1/prospects/application-form/rotate-key', {
        params: { header: headers['if-match'] ? { 'if-match': headers['if-match'] } : {} },
      }),
    version: (input: { version: number | null }) => input.version,
    invalidates: INVALIDATES,
  })
}

/** Oturumsuz form verisi: kurum adı, kampüsler, güncel aydınlatma metni. */
export function usePublicApplicationForm(formKey: string) {
  return useApiQuery({
    key: [PUBLIC_KEY, formKey],
    scope: 'session',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    request: (client, signal) =>
      client.GET('/api/v1/prospects/application-forms/{formKey}', {
        params: { path: { formKey } },
        signal,
      }),
  })
}

export interface SubmitApplicationInput {
  formKey: string
  body: ProspectApplicationBody
}

/** Başvuru gönderimi; yanıt mükerrer ya da yeni kayıt ayrımı taşımaz. */
export function useSubmitApplication() {
  return useApiCommand({
    request: (client: KampusClient, { formKey, body }: SubmitApplicationInput) =>
      client.POST('/api/v1/prospects/application-forms/{formKey}/submissions', {
        params: { path: { formKey } },
        body,
      }),
    invalidates: [],
    exclusive: true,
  })
}
