import { useCallback, useState } from 'react'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components } from '@kampus/api-client/schema.d.ts'

import type { CommandMessages } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'

/**
 * Velinin iletişim bilgisini açma (DOM-YTK-055): öğretmen listede maskeli değeri görür
 * (`GET /collections/parents`), "Göster" ile tam değeri ayrı uçtan alır
 * (`POST /parents/:parentId/reveal-contact`). Açılan değer yalnız bu kancanın bellekteki
 * durumunda tutulur: sorgu önbelleğine, kalıcı depoya (`localStorage`, AsyncStorage), adrese ve
 * loga yazılmaz; bileşen kapanınca kaybolur. Her açılış sunucuda denetim kaydına düşer.
 */

export type RevealedParentContact = components['schemas']['RevealedParentContact']
export type ParentContactField = RevealedParentContact['field']

export interface RevealParentContactInput {
  parentId: string
  studentId: string
  field: ParentContactField
}

export const PARENT_CONTACT_RATE_LIMITED_MESSAGE =
  'Kısa sürede çok fazla iletişim bilgisi açtınız. Bir dakika bekleyip yeniden deneyin.'

/** Koda özgü metinler; olmayan kodda sunucunun Türkçe mesajı gösterilir. */
export const PARENT_CONTACT_MESSAGES = {
  rate_limited: PARENT_CONTACT_RATE_LIMITED_MESSAGE,
  not_found: 'Bu velinin iletişim bilgisini görme yetkiniz yok ya da veli bulunamadı.',
  forbidden: 'Veli iletişim bilgisini yalnız öğrenciye ders veren öğretmen açabilir.',
  parent_contact_missing: 'Velinin bu iletişim bilgisi kayıtlı değil.',
} as const satisfies CommandMessages

/**
 * `POST /parents/:parentId/reveal-contact`. `Idempotency-Key` gönderilmez: işlem kayıt
 * oluşturmaz, her açılış ayrı denetim kaydıdır.
 */
export function revealParentContactRequest(
  client: KampusClient,
  { parentId, studentId, field }: RevealParentContactInput,
) {
  return client.POST('/api/v1/parents/{parentId}/reveal-contact', {
    params: { path: { parentId } },
    body: { studentId, field },
  })
}

/** Açılan değerin bellekteki anahtarı: aynı veli farklı öğrencinin velisi olarak ayrı açılır. */
export function parentContactKey({ parentId, studentId, field }: RevealParentContactInput): string {
  return JSON.stringify([parentId, studentId, field])
}

/** Açılan değerler haritasına yeni değeri ekler (saf; önceki harita değişmez). */
export function rememberContact(
  values: ReadonlyMap<string, string>,
  contact: RevealedParentContact,
): ReadonlyMap<string, string> {
  return new Map(values).set(parentContactKey(contact), contact.value)
}

/** Değeri yeniden maskeler (harita kopyası); olmayan anahtarda aynı harita döner. */
export function forgetContact(
  values: ReadonlyMap<string, string>,
  input: RevealParentContactInput,
): ReadonlyMap<string, string> {
  const key = parentContactKey(input)
  if (!values.has(key)) return values
  const next = new Map(values)
  next.delete(key)
  return next
}

const EMPTY: ReadonlyMap<string, string> = new Map()

/**
 * "Göster" kancası. `reveal` tam değeri ister (çift tıklama tek istek; hata toast'ı, 429 Türkçe);
 * `valueOf` açılmış değeri, açılmamışsa `undefined` döndürür; `hide` değeri bellekten siler.
 */
export function useParentContactReveal() {
  const [values, setValues] = useState(EMPTY)
  const command = useApiCommand({
    request: (client, input: RevealParentContactInput) => revealParentContactRequest(client, input),
    invalidates: [],
    messages: PARENT_CONTACT_MESSAGES,
    onSuccess: (data) => setValues((current) => rememberContact(current, data.data)),
  })
  const valueOf = useCallback(
    (input: RevealParentContactInput) => values.get(parentContactKey(input)),
    [values],
  )
  const hide = useCallback(
    (input: RevealParentContactInput) => setValues((current) => forgetContact(current, input)),
    [],
  )
  return {
    reveal: (input: RevealParentContactInput) => command.submit(input),
    valueOf,
    hide,
    isPending: command.isPending,
  }
}
