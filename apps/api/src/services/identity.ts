import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { defaultAcademicYearDates } from '@kampus/school-core/lib/academic-years.ts'

import type { Auth, InstitutionType, Role } from '../auth.ts'
import { ensureAcademicYears } from '../db/academic-years.ts'
import type { Database } from '../db/client.ts'
import { lockInstitution } from '../db/records.ts'
import { institutions, memberships } from '../db/schema/auth.ts'
import { institutionSettings } from '../db/schema/institution-settings.ts'
import { membershipLinks, type MembershipLinkKind } from '../db/schema/membership-links.ts'
import { ensureGuardianLinks } from '../db/student-guardians.ts'
import { AppError, MESSAGES } from '../errors.ts'

function systemFailure(what: string): AppError {
  return new AppError(500, 'internal_error', MESSAGES.internal_error, {
    cause: new Error(`${what} failed`),
  })
}

/**
 * Sistem eylemleri: tohum (db:seed) ve test fabrikaları kullanır, HTTP'den çağrılmaz.
 * Kayıtlar Better Auth API'si ve iç bağdaştırıcısıyla açılır; parola özeti Better Auth'undur.
 * Hepsi idempotenttir: kayıt varsa yenisi açılmaz.
 */

export interface UserInput {
  name: string
  // kvkk: K
  email: string
  password: string
}

export async function ensureUser(auth: Auth, input: UserInput): Promise<{ id: string }> {
  const ctx = await auth.$context
  const email = input.email.trim().toLowerCase()
  const existing = await ctx.internalAdapter.findUserByEmail(email)
  if (existing) return { id: existing.user.id }
  const user = await ctx.internalAdapter.createUser(
    {
      name: input.name,
      email,
      emailVerified: true,
    },
    { method: 'email-password' },
  )
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(input.password),
  })
  return { id: user.id }
}

export interface InstitutionInput {
  name: string
  slug: string
  type: InstitutionType
  /** Kurumu açan kullanıcı; Better Auth onu `yonetici` üyesi yapar. */
  creatorUserId: string
  /** Modül anahtarı → açık mı; verilmeyen modül varsayılanındadır. */
  enabledModules?: Record<string, boolean>
}

export async function ensureInstitution(
  auth: Auth,
  db: Database,
  input: InstitutionInput,
): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: institutions.id })
    .from(institutions)
    .where(eq(institutions.slug, input.slug))
    .limit(1)
  if (existing) return existing
  // Oturum başlığı olmadan `userId` ile çağrı Better Auth'ta sistem eylemidir.
  const created = await auth.api.createOrganization({
    body: {
      name: input.name,
      slug: input.slug,
      type: input.type,
      enabledModules: input.enabledModules ?? {},
      userId: input.creatorUserId,
    },
  })
  if (!created) throw systemFailure('createOrganization')
  return { id: created.id }
}

/**
 * Kurum ayar satırını açar; satır varsa dokunmaz (akademik yıl değişimi ayrı bir yönetici
 * işlemidir, tohum onu ezmez). Satır ilk kez açılınca aynı başlangıç yılı varsayılan aralıkla
 * (1 Eylül – 31 Ağustos), dönemsiz ve etkin eğitim yılı olarak yazılır (DOM-YTK-063, -065;
 * migration 0026'nın geri doldurmasıyla aynı). Kurumun yılı zaten varsa ya da başka yıl etkinse
 * yıl yazılmaz.
 */
export async function ensureInstitutionSettings(
  db: Database,
  institutionId: string,
  input: { academicYear: number; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date()
  await db.transaction(async (tx) => {
    const opened = await tx
      .insert(institutionSettings)
      .values({ institutionId, academicYear: input.academicYear, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning({ institutionId: institutionSettings.institutionId })
    if (opened.length === 0) return
    await ensureAcademicYears(
      tx,
      institutionId,
      [
        {
          startYear: input.academicYear,
          ...defaultAcademicYearDates(input.academicYear),
          status: 'active',
          activatedAt: now.toISOString(),
          closedAt: null,
          terms: [],
        },
      ],
      now,
    )
  })
}

export async function ensureMember(
  auth: Auth,
  db: Database,
  input: { institutionId: string; userId: string; role: Role },
): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(eq(memberships.institutionId, input.institutionId), eq(memberships.userId, input.userId)),
    )
    .limit(1)
  if (existing) return existing
  const member = await auth.api.addMember({
    body: { userId: input.userId, organizationId: input.institutionId, role: input.role },
  })
  if (!member) throw systemFailure('addMember')
  return { id: member.id }
}

export interface MembershipLinkInput {
  kind: MembershipLinkKind
  recordId: string
}

/**
 * Üyeliğin school-core kayıt bağlantılarını ekler; var olan bağlantı korunur. Veli bağlantısı
 * (`child`) için öğrenci–veli bağı da yoksa açılır: kurumun kurduğu bağ doğrulanmıştır, velayetli
 * ve kısıtsızdır (migration 0027 geri doldurmasıyla aynı; DOM-ILT-070). Önceden kurulmuş bağ
 * (velayetsiz, kısıtlı, ödeyici) değişmez; kaldırılmış (arşivli) bağ yeniden açılmaz
 * (DOM-ILT-071). Bağlantı ve bağ kurum kilidi altında tek transaction'da yazılır; eşzamanlı bağ
 * işlemiyle (`runCommand`) sıraya girer.
 */
export async function ensureMembershipLinks(
  db: Database,
  institutionId: string,
  membershipId: string,
  links: readonly MembershipLinkInput[],
): Promise<void> {
  if (links.length === 0) return
  await db.transaction(async (tx) => {
    await lockInstitution(tx, institutionId)
    await tx
      .insert(membershipLinks)
      .values(links.map((link) => ({ institutionId, membershipId, ...link })))
      .onConflictDoNothing()
    await ensureGuardianLinks(
      tx,
      institutionId,
      links
        .filter((link) => link.kind === 'child')
        .map((link) => ({
          id: randomUUID(),
          studentId: link.recordId,
          parentId: null,
          membershipId,
          relationship: 'other' as const,
          custody: 'full' as const,
          contactRestricted: false,
          isPayer: false,
          canPickUp: false,
        })),
    )
  })
}
