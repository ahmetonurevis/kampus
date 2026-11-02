import { randomUUID } from 'node:crypto'

import type { ConsentChannel, ConsentPurpose } from '@kampus/school-core/lib/consent-purposes.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import {
  latestNotice,
  minimumConsentTextVersion,
  needsNoticeAcknowledgement,
  NOTICE_AUDIENCES,
  noticeAudienceForRead,
  type NoticeAudience,
  planNoticeAcknowledgement,
  planNoticePublication,
  type NoticeAcknowledgement,
  type NoticeAcknowledgementDraft,
  type PrivacyNotice,
  type PrivacyNoticeDraft,
  type PublishPrivacyNoticeInput,
} from '@kampus/school-core/lib/privacy-notices.ts'

import {
  insertNoticeAcknowledgement,
  insertPrivacyNotice,
  listNoticeAcknowledgements,
  listPrivacyNotices,
} from '../db/privacy.ts'
import { AppError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import {
  mapOperationError,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Aydınlatma ve rıza metinleri (IST-016; docs/domain/yetki-ve-kapsam.md DOM-YTK-056, -060;
 * guvenlik-kvkk §9). Kural core `lib/privacy-notices.ts`'tedir; tablolar `privacy_notices` ve
 * `notice_acknowledgements` (migration 0024, değişmez satırlar). Metin gövdesi log ve denetime
 * girmez; denetime yalnız alan adları yazılır.
 */

const NOTICE = 'privacy_notice'
const ACKNOWLEDGEMENT = 'notice_acknowledgement'

export const noticeView = (notice: PrivacyNotice) => ({ ...notice })

export interface NoticeListInput {
  page: number
  pageSize: number
}

/** Kurumun yayımlanmış bütün metinleri, konu ve sürüm sırasıyla (yönetici). */
export async function listNotices(ctx: ServiceContext, input: NoticeListInput) {
  const notices = await listPrivacyNotices(ctx.db, ctx.institutionId)
  const start = (input.page - 1) * input.pageSize
  return {
    items: notices.slice(start, start + input.pageSize).map(noticeView),
    total: notices.length,
  }
}

/**
 * Metni yayımlar (DOM-YTK-056, -060): sürüm konunun son sürümünün bir fazlasıdır, yayımlanmış metin
 * değişmez. Aynı konuda eşzamanlı yayım kurum kilidiyle sıraya girer; yine çakışırsa sürüm
 * benzersiz indeksi 409 verir. Başarı 201.
 */
export function publishNotice(
  ctx: ServiceContext,
  input: PublishPrivacyNoticeInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const out: { body?: unknown } = {}
  return runCommand<PrivacyNoticeDraft>(
    ctx,
    {
      action: 'notice.publish',
      collections: [],
      entity: { type: NOTICE, id },
      load: async (tx) => {
        const notices = await listPrivacyNotices(tx, ctx.institutionId)
        return {
          run: (_state, { now }) =>
            planNoticePublication({ notices, publishedByUserId: ctx.actor.userId, input, now }),
        }
      },
      after: async (tx, draft) => {
        await insertPrivacyNotice(tx, ctx.institutionId, { id, ...draft }, ctx.now)
        await auditWork(tx, ctx, 'notice.publish', { type: NOTICE, id }, [
          'kind',
          'audience',
          'purpose',
          'version',
          'title',
          'body',
          'requiresReconsent',
        ])
        out.body = {
          data: noticeView({
            id,
            kind: draft.kind,
            audience: draft.audience,
            purpose: draft.purpose,
            version: draft.version,
            title: draft.title,
            body: draft.body,
            requiresReconsent: draft.requiresReconsent,
            publishedAt: draft.publishedAt,
          }),
        }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('privacy notice was not written')
      return { statusCode: 201, body: out.body }
    },
    idempotency,
  )
}

/**
 * Oturum sahibinin kitlesine (rolünden) ait son aydınlatma metni ve bu sürümü görüp görmediği
 * (IST-016, DOM-YTK-056). İlk girişte ve yeni sürüm yayımlanınca `needsAcknowledgement` doğrudur;
 * eski sürümün gösterimi yeni sürümü karşılamaz. Yayımlanmış metin yoksa `notice` boştur.
 *
 * `audience: 'aday'` aday formunun metnidir (DOM-KAY-003): yalnız yönetici ve ön büro okur (core
 * `noticeAudienceForRead`, aksi 403). Aday hesap değildir; gösterim kaydı okunmaz ve açılmaz,
 * gösterilen sürümü aday kaydı saklar.
 */
export async function currentNotice(ctx: ServiceContext, requested?: NoticeAudience) {
  let audience: NoticeAudience
  try {
    audience = noticeAudienceForRead(ctx.actor.role, requested)
  } catch (error) {
    throw mapOperationError(error)
  }
  if (!NOTICE_AUDIENCES[audience].account) {
    const notice = latestNotice(await listPrivacyNotices(ctx.db, ctx.institutionId), {
      kind: 'notice',
      audience,
    })
    return {
      audience,
      notice: notice === null ? null : noticeView(notice),
      needsAcknowledgement: false,
      acknowledgedAt: null,
    }
  }
  const [notices, acknowledgements] = await Promise.all([
    listPrivacyNotices(ctx.db, ctx.institutionId),
    listNoticeAcknowledgements(ctx.db, ctx.institutionId, ctx.actor.userId),
  ])
  const user = { userId: ctx.actor.userId, role: ctx.actor.role }
  const notice = latestNotice(notices, { kind: 'notice', audience })
  const seen =
    notice === null ? undefined : acknowledgements.find((item) => item.noticeId === notice.id)
  return {
    audience,
    notice: notice === null ? null : noticeView(notice),
    needsAcknowledgement: needsNoticeAcknowledgement(notices, acknowledgements, user) !== null,
    acknowledgedAt: seen?.acknowledgedAt ?? null,
  }
}

/**
 * Amacın son yayımlanmış rıza metni ve geçerli rıza için gereken en düşük metin sürümü
 * (DOM-YTK-058, -060). Rıza formu bu metni gösterir ve `textId`'sini gönderir. Metin yoksa 404
 * `consent_text_not_found` (rıza o amaçta alınamaz).
 */
export async function currentConsentText(ctx: ServiceContext, purpose: ConsentPurpose) {
  const notices = await listPrivacyNotices(ctx.db, ctx.institutionId)
  const text = latestNotice(notices, { kind: 'consent_text', purpose })
  if (text === null)
    throw new AppError(404, 'consent_text_not_found', 'Bu amaç için yayımlanmış rıza metni yok.')
  return { text: noticeView(text), minimumVersion: minimumConsentTextVersion(notices, purpose) }
}

type Acknowledged = { created: NoticeAcknowledgementDraft } | { existing: NoticeAcknowledgement }

/**
 * Aydınlatma gösterimini kaydeder (DOM-YTK-056). Yalnız kitlesinin son sürümü kaydedilir: başka
 * kitlenin metni ya da rıza metni 404, eski sürüm 409 `notice_outdated`. Aynı sürümün ikinci kaydı
 * idempotenttir: yeni satır yazılmaz, ilk gösterim 200 ile döner (ilk kayıt 201).
 */
export function acknowledgeNotice(
  ctx: ServiceContext,
  input: { noticeId: string; channel: ConsentChannel },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const out: { body?: unknown; statusCode?: number } = {}
  return runCommand<Acknowledged>(
    ctx,
    {
      action: 'notice.acknowledge',
      collections: [],
      entity: { type: ACKNOWLEDGEMENT, id },
      load: async (tx) => {
        const [notices, acknowledgements] = await Promise.all([
          listPrivacyNotices(tx, ctx.institutionId),
          listNoticeAcknowledgements(tx, ctx.institutionId, ctx.actor.userId),
        ])
        const user = { userId: ctx.actor.userId, role: ctx.actor.role }
        return {
          run: (_state, { now }) => {
            try {
              return {
                created: planNoticeAcknowledgement({
                  notices,
                  acknowledgements,
                  user,
                  input,
                  now,
                }),
              }
            } catch (error) {
              const existing = acknowledgements.find((item) => item.noticeId === input.noticeId)
              if (
                error instanceof DomainError &&
                error.code === 'notice_already_acknowledged' &&
                existing !== undefined
              )
                return { existing }
              throw error
            }
          },
        }
      },
      after: async (tx, result) => {
        if ('existing' in result) {
          out.statusCode = 200
          out.body = { data: result.existing }
          return
        }
        await insertNoticeAcknowledgement(tx, ctx.institutionId, { id, ...result.created }, ctx.now)
        await auditWork(tx, ctx, 'notice.acknowledge', { type: ACKNOWLEDGEMENT, id }, [
          'noticeId',
          'channel',
          'acknowledgedAt',
        ])
        out.statusCode = 201
        out.body = { data: { id, ...result.created } }
      },
    },
    () => {
      if (out.body === undefined || out.statusCode === undefined)
        throw new Error('notice acknowledgement was not written')
      return { statusCode: out.statusCode, body: out.body }
    },
    idempotency,
  )
}
