import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import {
  CONSENT_CHANNELS,
  CONSENT_PURPOSE_KEYS,
  type ConsentChannel,
  type ConsentPurpose,
} from './consent-purposes.ts'
import { DomainError } from './errors.ts'

/**
 * Aydınlatma ve rıza metinleri (docs/muhendislik/guvenlik-kvkk.md §9; IST-016; DOM-YTK-056).
 *
 * - Aydınlatma metni (`notice`) hedef kitleye (veli, öğrenci, personel) göre sürümlüdür. Her yeni
 *   sürüm kullanıcıya yeniden gösterilir; gösterim (`notice_acknowledgements`) kullanıcı, metin
 *   sürümü ve zamanla saklanır. "Okudum" işareti rıza değildir.
 * - Rıza metni (`consent_text`) amaca göre sürümlüdür ve aydınlatma metninden ayrıdır
 *   (DOM-ILT-033). Amacı genişleten sürüm `requiresReconsent` ile yayımlanır; ondan eski sürüme
 *   verilmiş rıza geçersizdir (`minimumConsentTextVersion`, DOM-YTK-060).
 * - Yayımlanmış metin değişmez; düzeltme yeni sürümdür (veritabanında tetikleyiciyle korunur).
 *
 * Fonksiyonlar saftır ve `now` parametrelidir; kimlik, yükleme ve yazma servistedir. Girdi
 * dizileri değiştirilmez.
 */

z.config(z.locales.tr())

export const NOTICE_AUDIENCES = {
  veli: { label: 'Veli' },
  ogrenci: { label: 'Öğrenci' },
  personel: { label: 'Personel' },
} as const
export type NoticeAudience = keyof typeof NOTICE_AUDIENCES
export const NOTICE_AUDIENCE_KEYS = Object.keys(NOTICE_AUDIENCES) as [
  NoticeAudience,
  ...NoticeAudience[],
]

export const PRIVACY_NOTICE_KINDS = ['notice', 'consent_text'] as const
export type PrivacyNoticeKind = (typeof PRIVACY_NOTICE_KINDS)[number]

/** Rolün aydınlatma kitlesi: yönetici, ön büro ve öğretmen personeldir. */
export function noticeAudienceForRole(role: Role): NoticeAudience {
  switch (role) {
    case 'veli':
    case 'ogrenci':
      return role
    case 'yonetici':
    case 'onburo':
    case 'ogretmen':
      return 'personel'
    default:
      return role satisfies never
  }
}

const title = z.string().trim().min(1, 'Başlık girin.').max(200)
const body = z.string().trim().min(1, 'Metni girin.').max(50_000)

/** Metin yayımlama girdisi (yönetici). Aydınlatma kitleye, rıza metni amaca bağlıdır. */
export const publishPrivacyNoticeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('notice'),
    audience: z.enum(NOTICE_AUDIENCE_KEYS),
    title,
    body,
  }),
  z.strictObject({
    kind: z.literal('consent_text'),
    purpose: z.enum(CONSENT_PURPOSE_KEYS),
    title,
    body,
    /** Amaç genişledi: eski sürümlere verilmiş rızalar yeni sürümü kapsamaz. İlk sürümde etkisiz. */
    requiresReconsent: z.boolean().default(false),
  }),
])
export type PublishPrivacyNoticeInput = z.input<typeof publishPrivacyNoticeSchema>

/** Yayımlanmış metin (servisin yüklediği satır). */
export type PrivacyNotice = {
  id: string
  kind: PrivacyNoticeKind
  audience: NoticeAudience | null
  purpose: ConsentPurpose | null
  version: number
  title: string
  body: string
  requiresReconsent: boolean
  publishedAt: string
}

export type PrivacyNoticeDraft = Omit<PrivacyNotice, 'id'> & {
  // kvkk: K — yayımlayan kullanıcı
  publishedByUserId: string
}

type NoticeTopic =
  { kind: 'notice'; audience: NoticeAudience } | { kind: 'consent_text'; purpose: ConsentPurpose }

const sameTopic = (notice: PrivacyNotice, topic: NoticeTopic) =>
  notice.kind === topic.kind &&
  (topic.kind === 'notice' ? notice.audience === topic.audience : notice.purpose === topic.purpose)

/** Konunun (kitle ya da amaç) en yüksek sürümlü yayımlanmış metni; yoksa `null`. */
export function latestNotice(
  notices: readonly PrivacyNotice[],
  topic: NoticeTopic,
): PrivacyNotice | null {
  let latest: PrivacyNotice | null = null
  for (const notice of notices)
    if (sameTopic(notice, topic) && (latest === null || notice.version > latest.version))
      latest = notice
  return latest
}

/**
 * Metin yayımlama (DOM-YTK-056): sürüm konunun son sürümünün bir fazlasıdır, yayım anı `now`'dır.
 * İlk rıza metni her zaman yeniden rıza ister sayılmaz (önceki rıza yoktur).
 */
export function planNoticePublication(input: {
  notices: readonly PrivacyNotice[]
  publishedByUserId: string
  input: unknown
  now: string
}): PrivacyNoticeDraft {
  const data = publishPrivacyNoticeSchema.parse(input.input)
  const topic: NoticeTopic =
    data.kind === 'notice'
      ? { kind: 'notice', audience: data.audience }
      : { kind: 'consent_text', purpose: data.purpose }
  const previous = latestNotice(input.notices, topic)
  return {
    kind: data.kind,
    audience: data.kind === 'notice' ? data.audience : null,
    purpose: data.kind === 'consent_text' ? data.purpose : null,
    version: (previous?.version ?? 0) + 1,
    title: data.title,
    body: data.body,
    requiresReconsent: data.kind === 'consent_text' && previous !== null && data.requiresReconsent,
    publishedAt: input.now,
    publishedByUserId: input.publishedByUserId,
  }
}

/**
 * Amacın geçerli rıza için gereken en düşük metin sürümü (DOM-YTK-060): `requiresReconsent` ile
 * yayımlanmış son sürüm; yoksa 1.
 */
export function minimumConsentTextVersion(
  notices: readonly PrivacyNotice[],
  purpose: ConsentPurpose,
): number {
  let minimum = 1
  for (const notice of notices)
    if (
      sameTopic(notice, { kind: 'consent_text', purpose }) &&
      notice.requiresReconsent &&
      notice.version > minimum
    )
      minimum = notice.version
  return minimum
}

/** Aydınlatma gösterim kaydı (servisin yüklediği satır). */
export type NoticeAcknowledgement = {
  id: string
  noticeId: string
  // kvkk: K — metni gören kullanıcı
  userId: string
  channel: ConsentChannel
  acknowledgedAt: string
}
export type NoticeAcknowledgementDraft = Omit<NoticeAcknowledgement, 'id'>

export const acknowledgeNoticeSchema = z.strictObject({
  noticeId: z.uuid('Aydınlatma metni bulunamadı.'),
  channel: z.enum(CONSENT_CHANNELS),
})
export type AcknowledgeNoticeInput = z.infer<typeof acknowledgeNoticeSchema>

/**
 * Kullanıcıya gösterilmesi gereken aydınlatma metni (IST-016, DOM-YTK-056): rolünün kitlesine ait
 * son sürümü görmediyse o sürüm, gördüyse ya da yayımlanmış metin yoksa `null`. Eski sürümün
 * gösterimi yeni sürümü karşılamaz.
 */
export function needsNoticeAcknowledgement(
  notices: readonly PrivacyNotice[],
  acknowledgements: readonly Pick<NoticeAcknowledgement, 'noticeId' | 'userId'>[],
  user: { userId: string; role: Role },
): PrivacyNotice | null {
  const latest = latestNotice(notices, {
    kind: 'notice',
    audience: noticeAudienceForRole(user.role),
  })
  if (latest === null) return null
  const seen = acknowledgements.some(
    (item) => item.userId === user.userId && item.noticeId === latest.id,
  )
  return seen ? null : latest
}

/**
 * Aydınlatma gösterimini kaydeder (DOM-YTK-056). Yalnız kendi kitlesinin son sürümü kaydedilir;
 * eski sürüm `notice_outdated` (409), başka kitlenin metni ya da rıza metni bulunamadı (404), aynı
 * sürümün ikinci kaydı `notice_already_acknowledged` (409).
 */
export function planNoticeAcknowledgement(input: {
  notices: readonly PrivacyNotice[]
  acknowledgements: readonly Pick<NoticeAcknowledgement, 'noticeId' | 'userId'>[]
  user: { userId: string; role: Role }
  input: unknown
  now: string
}): NoticeAcknowledgementDraft {
  const data = acknowledgeNoticeSchema.parse(input.input)
  const audience = noticeAudienceForRole(input.user.role)
  const notice = input.notices.find((item) => item.id === data.noticeId)
  if (notice === undefined || notice.kind !== 'notice' || notice.audience !== audience) {
    throw new DomainError('notice_not_found', 'Aydınlatma metni bulunamadı.', {
      kind: 'not_found',
      path: ['noticeId'],
    })
  }
  if (latestNotice(input.notices, { kind: 'notice', audience })?.id !== notice.id) {
    throw new DomainError(
      'notice_outdated',
      'Aydınlatma metni güncellendi; lütfen güncel metni okuyun.',
      { kind: 'conflict', path: ['noticeId'] },
    )
  }
  if (
    input.acknowledgements.some(
      (item) => item.userId === input.user.userId && item.noticeId === notice.id,
    )
  ) {
    throw new DomainError('notice_already_acknowledged', 'Bu metni zaten okudunuz.', {
      kind: 'conflict',
    })
  }
  return {
    noticeId: notice.id,
    userId: input.user.userId,
    channel: data.channel,
    acknowledgedAt: input.now,
  }
}
