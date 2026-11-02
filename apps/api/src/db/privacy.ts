import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import type { ConsentSubjectKind } from '@kampus/school-core/lib/consent-purposes.ts'
import type {
  ConsentClosure,
  ConsentDraft,
  ConsentRecord,
} from '@kampus/school-core/lib/consents.ts'
import type {
  NoticeAcknowledgement,
  NoticeAcknowledgementDraft,
  PrivacyNotice,
  PrivacyNoticeDraft,
} from '@kampus/school-core/lib/privacy-notices.ts'

import type { Database } from './client.ts'
import { consents, noticeAcknowledgements, privacyNotices } from './schema/privacy.ts'

/**
 * Aydınlatma ve rıza deposu (DOM-YTK-056…062; tablolar migration 0024). Kurum kapsamlıdır: ilk
 * parametre `institutionId`. Kararı core verir (`lib/privacy-notices.ts`, `lib/consents.ts`);
 * depo yalnız satırları core biçimine çevirir ve yazar. Metin ve gösterim için güncelleme yoktur;
 * rızada tek güncelleme geri çekmedir (`closeConsent`). Kimlik (`uuid`) servis tarafından üretilir.
 */

type NoticeRow = typeof privacyNotices.$inferSelect
type ConsentRow = typeof consents.$inferSelect

const iso = (value: Date | null) => (value === null ? null : value.toISOString())

const toNotice = (row: NoticeRow): PrivacyNotice => ({
  id: row.id,
  kind: row.kind,
  audience: row.audience,
  purpose: row.purpose,
  version: row.noticeVersion,
  title: row.title,
  body: row.body,
  requiresReconsent: row.requiresReconsent,
  publishedAt: row.publishedAt.toISOString(),
})

export type StoredConsent = ConsentRecord & { rowVersion: number }

const toConsent = (row: ConsentRow): StoredConsent => ({
  id: row.id,
  subjectKind: row.subjectKind,
  subjectId: row.subjectId,
  purpose: row.purpose,
  decision: row.decision,
  grantedByUserId: row.grantedByUserId,
  grantorRelation: row.grantorRelation,
  textId: row.textId,
  textVersion: row.textVersion,
  channel: row.channel,
  givenAt: row.givenAt.toISOString(),
  expiresAt: iso(row.expiresAt),
  withdrawnAt: iso(row.withdrawnAt),
  withdrawnByUserId: row.withdrawnByUserId,
  withdrawalReason: row.withdrawalReason,
  rowVersion: row.version,
})

/**
 * Kurumun yayımlanmış (arşivlenmemiş) metinleri, konu ve sürüm sırasıyla. Core son sürümü ve en
 * düşük geçerli rıza sürümünü bu listeden hesaplar; metin sayısı kurum başına küçüktür.
 */
export async function listPrivacyNotices(
  db: Database,
  institutionId: string,
): Promise<PrivacyNotice[]> {
  const rows = await db
    .select()
    .from(privacyNotices)
    .where(and(eq(privacyNotices.institutionId, institutionId), isNull(privacyNotices.archivedAt)))
    .orderBy(
      asc(privacyNotices.kind),
      asc(privacyNotices.audience),
      asc(privacyNotices.purpose),
      asc(privacyNotices.noticeVersion),
    )
  return rows.map(toNotice)
}

export async function insertPrivacyNotice(
  tx: Database,
  institutionId: string,
  notice: PrivacyNoticeDraft & { id: string },
  now: Date,
): Promise<void> {
  await tx.insert(privacyNotices).values({
    institutionId,
    id: notice.id,
    kind: notice.kind,
    audience: notice.audience,
    purpose: notice.purpose,
    noticeVersion: notice.version,
    title: notice.title,
    body: notice.body,
    requiresReconsent: notice.requiresReconsent,
    publishedAt: new Date(notice.publishedAt),
    publishedByUserId: notice.publishedByUserId,
    createdAt: now,
    updatedAt: now,
  })
}

/** Kullanıcının aydınlatma gösterimleri. */
export async function listNoticeAcknowledgements(
  db: Database,
  institutionId: string,
  userId: string,
): Promise<NoticeAcknowledgement[]> {
  const rows = await db
    .select()
    .from(noticeAcknowledgements)
    .where(
      and(
        eq(noticeAcknowledgements.institutionId, institutionId),
        eq(noticeAcknowledgements.userId, userId),
      ),
    )
    .orderBy(asc(noticeAcknowledgements.acknowledgedAt), asc(noticeAcknowledgements.id))
  return rows.map((row) => ({
    id: row.id,
    noticeId: row.noticeId,
    userId: row.userId,
    channel: row.channel,
    acknowledgedAt: row.acknowledgedAt.toISOString(),
  }))
}

export async function insertNoticeAcknowledgement(
  tx: Database,
  institutionId: string,
  acknowledgement: NoticeAcknowledgementDraft & { id: string },
  now: Date,
): Promise<void> {
  await tx.insert(noticeAcknowledgements).values({
    institutionId,
    ...acknowledgement,
    acknowledgedAt: new Date(acknowledgement.acknowledgedAt),
    createdAt: now,
    updatedAt: now,
  })
}

/**
 * Veri sahibinin rıza satırları (geçmiş dahil), amaç ve veriliş sırasıyla. `openOnly` yalnız geri
 * çekilmemiş satırları döndürür (`planConsent` girdisi, kısmi benzersiz indeksle okunur).
 */
export async function listConsentsOfSubject(
  db: Database,
  institutionId: string,
  subject: { kind: ConsentSubjectKind; id: string; openOnly?: boolean },
): Promise<StoredConsent[]> {
  const rows = await db
    .select()
    .from(consents)
    .where(
      and(
        eq(consents.institutionId, institutionId),
        eq(consents.subjectKind, subject.kind),
        eq(consents.subjectId, subject.id),
        isNull(consents.archivedAt),
        ...(subject.openOnly === true ? [isNull(consents.withdrawnAt)] : []),
      ),
    )
    .orderBy(asc(consents.purpose), asc(consents.givenAt), asc(consents.id))
  return rows.map(toConsent)
}

/** Rıza satırı; olmayan ya da başka kurumun satırı `null`. */
export async function findConsent(
  db: Database,
  institutionId: string,
  consentId: string,
): Promise<StoredConsent | null> {
  const [row] = await db
    .select()
    .from(consents)
    .where(
      and(
        eq(consents.institutionId, institutionId),
        eq(consents.id, consentId),
        isNull(consents.archivedAt),
      ),
    )
    .limit(1)
  return row ? toConsent(row) : null
}

/**
 * Rızayı yazar. Aynı veri sahibi + amaç + karar için ikinci etkin satır
 * `consents_subject_purpose_decision_key` ile 23505 verir (`mapDatabaseError` → 409).
 */
export async function insertConsent(
  tx: Database,
  institutionId: string,
  consent: ConsentDraft & { id: string },
  now: Date,
): Promise<void> {
  await tx.insert(consents).values({
    institutionId,
    ...consent,
    givenAt: new Date(consent.givenAt),
    expiresAt: consent.expiresAt === null ? null : new Date(consent.expiresAt),
    withdrawnAt: consent.withdrawnAt === null ? null : new Date(consent.withdrawnAt),
    createdAt: now,
    updatedAt: now,
  })
}

/**
 * Rızayı kapatır (geri çekme ya da yenileme; DOM-YTK-059). Yalnız geri çekilmemiş ve sürümü tutan
 * satır değişir; değilse `false` (409).
 */
export async function closeConsent(
  tx: Database,
  institutionId: string,
  closure: ConsentClosure & { rowVersion: number },
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(consents)
    .set({
      withdrawnAt: new Date(closure.withdrawnAt),
      withdrawnByUserId: closure.withdrawnByUserId,
      withdrawalReason: closure.withdrawalReason,
      updatedAt: now,
      version: sql`${consents.version} + 1`,
    })
    .where(
      and(
        eq(consents.institutionId, institutionId),
        eq(consents.id, closure.id),
        isNull(consents.withdrawnAt),
        isNull(consents.archivedAt),
        eq(consents.version, closure.rowVersion),
      ),
    )
    .returning({ id: consents.id })
  return rows.length === 1
}
