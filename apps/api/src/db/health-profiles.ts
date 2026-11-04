import { randomUUID } from 'node:crypto'

import { and, eq, isNull, sql } from 'drizzle-orm'

import {
  healthProfileContentSchema,
  type HealthLegalBasis,
  type HealthProfileContent,
} from '@kampus/school-core/lib/health-profile.ts'

import type { FieldBinding, FieldCipher } from '../lib/field-crypto.ts'
import type { Database } from './client.ts'
import { studentHealthProfiles } from './schema/student-health-profiles.ts'

/**
 * Sağlık ve acil bilgi deposu (IST-020; DOM-ILT-035). Her fonksiyonun ilk parametresi kurumdur;
 * içerik yazmadan önce şifrelenir, okurken çözülür ve core şemasıyla doğrulanır. Yetki ve okuma
 * denetim kaydı (DOM-YTK-052) servistedir; depo erişim kararı vermez.
 */

export type StoredHealthProfile = {
  // kvkk: Ö
  content: HealthProfileContent
  legalBasis: HealthLegalBasis
  version: number
  keyVersion: number
  updatedByUserId: string
  updatedAt: Date
}

/** Satır var ama içeriği çözülemiyor ya da şemaya uymuyor; ayrıntı (içerik) taşımaz. */
export class HealthProfileIntegrityError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Sağlık bilgisi satırı okunamadı.', options)
    this.name = 'HealthProfileIntegrityError'
  }
}

const binding = (institutionId: string, studentId: string): FieldBinding => ({
  institutionId,
  table: 'student_health_profiles',
  column: 'content_ciphertext',
  rowKey: studentId,
})

const columns = {
  contentCiphertext: studentHealthProfiles.contentCiphertext,
  keyVersion: studentHealthProfiles.keyVersion,
  legalBasis: studentHealthProfiles.legalBasis,
  version: studentHealthProfiles.version,
  updatedByUserId: studentHealthProfiles.updatedByUserId,
  updatedAt: studentHealthProfiles.updatedAt,
}
type Row = Pick<typeof studentHealthProfiles.$inferSelect, keyof typeof columns>

function decode(
  cipher: FieldCipher,
  institutionId: string,
  studentId: string,
  row: Row,
): StoredHealthProfile {
  let content: HealthProfileContent
  try {
    const plain = cipher.decrypt(binding(institutionId, studentId), {
      ciphertext: row.contentCiphertext,
      keyVersion: row.keyVersion,
    })
    content = healthProfileContentSchema.parse(JSON.parse(plain))
  } catch (error) {
    throw new HealthProfileIntegrityError({ cause: error })
  }
  return {
    content,
    legalBasis: row.legalBasis,
    version: row.version,
    keyVersion: row.keyVersion,
    updatedByUserId: row.updatedByUserId,
    updatedAt: row.updatedAt,
  }
}

const activeRow = (institutionId: string, studentId: string) =>
  and(
    eq(studentHealthProfiles.institutionId, institutionId),
    eq(studentHealthProfiles.studentId, studentId),
    isNull(studentHealthProfiles.archivedAt),
  )

/** Öğrencinin etkin kaydı; yoksa `null` (istemci ilk yazımda sürüm 1 gönderir). */
export async function loadHealthProfile(
  db: Database,
  institutionId: string,
  studentId: string,
  cipher: FieldCipher,
): Promise<StoredHealthProfile | null> {
  const [row] = await db
    .select(columns)
    .from(studentHealthProfiles)
    .where(activeRow(institutionId, studentId))
    .limit(1)
  return row ? decode(cipher, institutionId, studentId, row) : null
}

export type HealthProfileSave = {
  content: HealthProfileContent
  legalBasis: HealthLegalBasis
  /** Okunan sürüm; kayıt yoksa 1. */
  expectedVersion: number
  actorUserId: string
  now: Date
}

/**
 * Sürüm koşuluyla yazar (iyimser kilit); kayıt yoksa ve beklenen sürüm 1 ise satır açılır (sürüm
 * 2). Sürüm tutmazsa ya da aynı anda başkası açtıysa `null` (409). İçerik core şemasıyla yeniden
 * doğrulanır, sonra şifrelenir; düz metin veritabanına gitmez.
 */
export async function saveHealthProfile(
  tx: Database,
  institutionId: string,
  studentId: string,
  input: HealthProfileSave,
  cipher: FieldCipher,
): Promise<StoredHealthProfile | null> {
  const content = healthProfileContentSchema.parse(input.content)
  const encrypted = cipher.encrypt(binding(institutionId, studentId), JSON.stringify(content))
  const values = {
    contentCiphertext: encrypted.ciphertext,
    keyVersion: encrypted.keyVersion,
    legalBasis: input.legalBasis,
    updatedByUserId: input.actorUserId,
    updatedAt: input.now,
  }
  const [updated] = await tx
    .update(studentHealthProfiles)
    .set({ ...values, version: sql`${studentHealthProfiles.version} + 1` })
    .where(
      and(
        activeRow(institutionId, studentId),
        eq(studentHealthProfiles.version, input.expectedVersion),
      ),
    )
    .returning(columns)
  if (updated) return decode(cipher, institutionId, studentId, updated)
  if (input.expectedVersion !== 1) return null
  const [created] = await tx
    .insert(studentHealthProfiles)
    .values({
      ...values,
      institutionId,
      id: randomUUID(),
      studentId,
      version: 2,
      createdAt: input.now,
    })
    .onConflictDoNothing()
    .returning(columns)
  return created ? decode(cipher, institutionId, studentId, created) : null
}
