import { and, eq, isNull } from 'drizzle-orm'

import type { Database } from './client.ts'
import { studentIdentities } from './schema/student-identities.ts'

/** Öğrenci kimlik deposu (ADR 0006 karar 9). Kimlik numarası loglanmaz. */

/** Kimliğin arşivlenmemiş satırının öğrencisi; yoksa `null`. */
export async function findIdentityHolder(
  db: Database,
  institutionId: string,
  identityNumber: string,
): Promise<string | null> {
  const [row] = await db
    .select({ studentId: studentIdentities.studentId })
    .from(studentIdentities)
    .where(
      and(
        eq(studentIdentities.institutionId, institutionId),
        eq(studentIdentities.identityNumber, identityNumber),
        isNull(studentIdentities.archivedAt),
      ),
    )
    .limit(1)
  return row?.studentId ?? null
}

export async function insertStudentIdentity(
  tx: Database,
  institutionId: string,
  input: {
    studentId: string
    academicYear: number
    kind: 'tc' | 'foreign'
    number: string
    birthDate: string
    now: Date
  },
): Promise<void> {
  await tx.insert(studentIdentities).values({
    institutionId,
    studentId: input.studentId,
    academicYear: input.academicYear,
    identityKind: input.kind,
    identityNumber: input.number,
    birthDate: input.birthDate,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

export async function findStudentIdentity(db: Database, institutionId: string, studentId: string) {
  const [row] = await db
    .select({
      kind: studentIdentities.identityKind,
      number: studentIdentities.identityNumber,
      birthDate: studentIdentities.birthDate,
      academicYear: studentIdentities.academicYear,
    })
    .from(studentIdentities)
    .where(
      and(
        eq(studentIdentities.institutionId, institutionId),
        eq(studentIdentities.studentId, studentId),
      ),
    )
    .limit(1)
  return row ?? null
}
