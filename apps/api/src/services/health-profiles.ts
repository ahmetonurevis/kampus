import {
  applyHealthProfilePatch,
  changedHealthFields,
  emergencyView,
  healthProfileContentSchema,
  requireHealthRead,
  requireHealthWrite,
  type HealthAccessInput,
  type HealthActor,
  type HealthEmergencyView,
  type HealthLegalBasis,
  type HealthProfileContent,
  type HealthProfilePatch,
} from '@kampus/school-core/lib/health-profile.ts'

import type { Database } from '../db/client.ts'
import { loadHealthProfile, saveHealthProfile } from '../db/health-profiles.ts'
import { loadMembershipGuardians } from '../db/student-guardians.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { FieldCipher } from '../lib/field-crypto.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { recordAudit } from './audit.ts'
import { learnerFactsOf } from './learner-age.ts'
import { getInstitutionModules } from './modules.ts'
import { mapOperationError } from './operation-runner.ts'
import { readScope, readSource } from './read-scope.ts'

/**
 * Öğrencinin sağlık ve acil bilgisi (IST-020; docs/domain/iletisim-ve-veli.md DOM-ILT-035, okuma
 * denetimi docs/domain/yetki-ve-kapsam.md DOM-YTK-052). Erişim kararı core'dadır
 * (`lib/health-profile.ts`, Sabah kararı 98); burada aktörün öğrenciyle bağı mevcut kapsam
 * kaynağından kurulur, içerik depodan şifre çözülerek okunur ve her başarılı okuma ile yazma aynı
 * transaction'da denetim kaydına yazılır. Denetime içerik değil alan adları düşer; içerik, hukuki
 * dayanak ve öğrenci kimliği loglanmaz.
 *
 * Aktörün bağı (core `HealthActor`) ikinci bir kapsam yazmadan kurulur: öğrenci, sınıf ve ders
 * ataması okuma kapsamının kaynağından (`readSource`), öğretmen kaydı ile velinin ve öğrencinin
 * kapsamdaki öğrencileri `readScope`'tan gelir. Veli `child` bağlantısı yalnız velayetli ve
 * kısıtsız bağla kapsam verdiğinden (`guardedActorLinks`, DOM-ILT-070) kısıtlı veli 404 alır;
 * bağların kendisi `student_guardians`'tan okunur. Yaş izin formuyla aynı kaynaktandır
 * (`learnerFactsOf`, DOM-ILT-037).
 */

/** Uygulama kurulurken bir kez verilen bağımlılıklar ve isteğin denetim bilgisi. */
export type HealthProfileDeps = {
  cipher: FieldCipher
  audit: { secret: string; ip?: string | undefined; requestId?: string | undefined }
}

export type HealthProfileFullView = HealthProfileContent & {
  /** Kayıt yoksa `null`. */
  legalBasis: HealthLegalBasis | null
  updatedAt: string | null
}

export type HealthProfileView =
  | { level: 'full'; profile: HealthProfileFullView; version: number }
  | { level: 'emergency'; profile: HealthEmergencyView; version: number }

const ENTITY = 'student'

/** Tam düzeyde dönen alanlar (denetim kaydının `changes.fields`'ı). */
const FULL_FIELDS = [...Object.keys(healthProfileContentSchema.shape), 'legalBasis']
/** Acil düzeyde dönen alanlar (core `emergencyView`). */
const EMERGENCY_FIELDS = [
  'allergies',
  'emergencyInstructions',
] satisfies (keyof HealthEmergencyView)[]

const emptyContent = (): HealthProfileContent => healthProfileContentSchema.parse({})

/**
 * Core erişim girdisi. Olmayan, arşivli ya da başka kurumun öğrencisi 404 (kapsam kaynağı yalnız
 * kurumun arşivlenmemiş kayıtlarıdır). Yaş yalnız kararı yaşa bağlı roller (veli, öğrenci) için
 * okunur.
 */
async function accessInput(ctx: ServiceContext, studentId: string): Promise<HealthAccessInput> {
  const [scope, source, institution] = await Promise.all([
    readScope(ctx),
    readSource(ctx),
    getInstitutionModules(ctx.db, ctx.institutionId),
  ])
  const student = source.students.find((item) => item.id === studentId)
  if (!student) throw new NotFoundError()
  const institutionType = institution?.type ?? 'school'
  const now = ctx.now.toISOString()
  const actor = await healthActor(ctx, studentId, student.classId, scope, source)
  const learner =
    actor.role === 'veli' || actor.role === 'ogrenci'
      ? ((await learnerFactsOf(ctx.db, ctx.institutionId, [studentId])).get(studentId) ?? {})
      : {}
  return { actor, learner, institutionType, now }
}

async function healthActor(
  ctx: ServiceContext,
  studentId: string,
  classId: string,
  scope: Awaited<ReturnType<typeof readScope>>,
  source: Awaited<ReturnType<typeof readSource>>,
): Promise<HealthActor> {
  const role = ctx.actor.role
  switch (role) {
    case 'yonetici':
    case 'onburo':
      return { role }
    case 'ogretmen': {
      // Yalnız etkin öğretmen kaydı (`scope.teacher`); öğrencinin güncel sınıfına göre.
      const teacherId = scope.teacher?.id
      if (teacherId === undefined) return { role, homeroom: false, teachesClass: false }
      return {
        role,
        homeroom: source.classes.some((c) => c.id === classId && c.teacherId === teacherId),
        teachesClass: source.assignments.some(
          (a) => a.classId === classId && a.teacherId === teacherId,
        ),
      }
    }
    case 'veli': {
      if (!scope.studentIds.has(studentId)) return { role, bonds: [] }
      const links = await loadMembershipGuardians(ctx.db, ctx.institutionId, ctx.actor.membershipId)
      return { role, bonds: links.filter((link) => link.studentId === studentId) }
    }
    case 'ogrenci':
      return { role, self: scope.studentIds.has(studentId) }
    default:
      return role satisfies never
  }
}

function fullView(
  stored: Awaited<ReturnType<typeof loadHealthProfile>>,
): Extract<HealthProfileView, { level: 'full' }> {
  return {
    level: 'full',
    profile: {
      ...(stored?.content ?? emptyContent()),
      legalBasis: stored?.legalBasis ?? null,
      updatedAt: stored?.updatedAt.toISOString() ?? null,
    },
    // Kayıt yoksa 1: ilk yazım bu sürümle gelir (depo satırı sürüm 2 ile açar).
    version: stored?.version ?? 1,
  }
}

async function audit(
  ctx: ServiceContext,
  tx: Database,
  deps: HealthProfileDeps,
  action: string,
  studentId: string,
  fields: readonly string[],
) {
  await recordAudit(
    { db: tx, secret: deps.audit.secret },
    {
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action,
      entityType: ENTITY,
      entityId: studentId,
      requestId: deps.audit.requestId ?? null,
      ip: deps.audit.ip ?? null,
      // kvkk: içerik değil, dönen ya da değişen alanların adları (DOM-YTK-052, DOM-YTK-053).
      changes: { fields: [...fields] },
    },
  )
}

/**
 * Okuma (DOM-ILT-035): düzey core'dan; acil düzeyde yalnız `emergencyView` döner. Kayıt yoksa boş
 * profil ve sürüm 1. Her başarılı okuma, kayıt olmasa da, aynı transaction'da denetime yazılır
 * (tam: `health_profile.read`, acil: `health_profile.read_emergency`; DOM-YTK-052); denetim satırı
 * yazılamazsa yanıt dönmez.
 */
export async function getHealthProfile(
  ctx: ServiceContext,
  deps: HealthProfileDeps,
  studentId: string,
): Promise<HealthProfileView> {
  try {
    const level = requireHealthRead(await accessInput(ctx, studentId))
    return await ctx.db.transaction(async (tx) => {
      const stored = await loadHealthProfile(tx, ctx.institutionId, studentId, deps.cipher)
      if (level === 'emergency') {
        await audit(ctx, tx, deps, 'health_profile.read_emergency', studentId, EMERGENCY_FIELDS)
        return {
          level,
          profile: emergencyView(stored?.content ?? emptyContent()),
          version: stored?.version ?? 1,
        }
      }
      await audit(ctx, tx, deps, 'health_profile.read', studentId, FULL_FIELDS)
      return fullView(stored)
    })
  } catch (error) {
    throw mapOperationError(error)
  }
}

/**
 * Kısmi yazma (DOM-ILT-035): gönderilen alanlar yüklenmiş profille birleşir, birleşmiş sonuç core
 * tam şemasında doğrulanır (400), `version` ile iyimser kilit (tutmazsa 409). Yazma ve
 * `health_profile.update` denetim satırı (yalnız değişen alan adları) tek transaction'dır; biri
 * başarısızsa hiçbiri yazılmaz. Yanıt yazanın tam görünümüdür (yazabilen herkes tam okur).
 */
export async function updateHealthProfile(
  ctx: ServiceContext,
  deps: HealthProfileDeps,
  studentId: string,
  patch: HealthProfilePatch,
): Promise<HealthProfileView> {
  try {
    requireHealthWrite(await accessInput(ctx, studentId))
    return await ctx.db.transaction(async (tx) => {
      const before = await loadHealthProfile(tx, ctx.institutionId, studentId, deps.cipher)
      if ((before?.version ?? 1) !== patch.version) throw new ConflictError()
      const { version, legalBasis, ...content } = applyHealthProfilePatch(before, patch)
      const saved = await saveHealthProfile(
        tx,
        ctx.institutionId,
        studentId,
        {
          content,
          legalBasis,
          expectedVersion: version,
          actorUserId: ctx.actor.userId,
          now: ctx.now,
        },
        deps.cipher,
      )
      if (saved === null) throw new ConflictError()
      const fields: string[] = changedHealthFields(before?.content ?? null, saved.content)
      if (before?.legalBasis !== legalBasis) fields.push('legalBasis')
      await audit(ctx, tx, deps, 'health_profile.update', studentId, fields)
      return fullView(saved)
    })
  } catch (error) {
    throw mapOperationError(error)
  }
}
