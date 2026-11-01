import { z } from 'zod'

import { CEFR_LEVELS, type CefrLevel } from '../content/taxonomy.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { DomainError } from './errors.ts'
import type { Role } from '../modules/navigation.ts'

/**
 * Zümre başkanı ve akademik koordinatör ek görevi (docs/domain/yetki-ve-kapsam.md DOM-YTK-027;
 * beceri-gelisimi.md DOM-BEC-024). Görev öğretmen üyeliğine verilen ek yetkidir, rol değildir:
 * `school`'da zümre başkanı (`subject_head`) kendi branşının dersini, `language_school`'da
 * akademik koordinatör (`academic_coordinator`) bir CEFR seviyesini kapsar. Görevi yönetici atar
 * ve kaldırır. Görev öğrenci bazında not yazma yetkisi vermez; tek istisna uyuşmazlıkta son
 * puandır (`skills/rubric.ts` `planRubricScore`, `final`).
 *
 * Fonksiyonlar saftır; kimlik, yükleme ve yazma servistedir.
 */

z.config(z.locales.tr())

export const COORDINATOR_DUTY_KINDS = {
  subject_head: { label: 'Zümre başkanı', institutionType: 'school' },
  academic_coordinator: { label: 'Akademik koordinatör', institutionType: 'language_school' },
} as const satisfies Record<string, { label: string; institutionType: InstitutionType }>
export type CoordinatorDutyKind = keyof typeof COORDINATOR_DUTY_KINDS

/** Kurum türünün görev türü: `school` zümre başkanı, `language_school` akademik koordinatör. */
export function dutyKindFor(institutionType: InstitutionType): CoordinatorDutyKind {
  return institutionType === 'school' ? 'subject_head' : 'academic_coordinator'
}

export const coordinatorDutyInputSchema = z.strictObject({
  membershipId: z.string().trim().min(1, 'Bir öğretmen seçin.').max(200),
  /** `school`: ders kimliği; `language_school`: CEFR seviyesi. */
  scopeId: z.string().trim().min(1, 'Ders veya seviye seçin.').max(200),
})
export type CoordinatorDutyInput = z.infer<typeof coordinatorDutyInputSchema>

/** Görev satırı (servisin yüklediği; arşivliler verilmez). */
export type CoordinatorDutyRow = {
  id: string
  membershipId: string
  kind: CoordinatorDutyKind
  scopeId: string
}

export type CoordinatorDutyDraft = Pick<CoordinatorDutyRow, 'membershipId' | 'kind' | 'scopeId'>

const isCefrLevel = (value: string): value is CefrLevel => Object.hasOwn(CEFR_LEVELS, value)

/**
 * Görev ataması (DOM-YTK-027). Yalnız öğretmen üyeliğine verilir (`duty_requires_teacher`).
 * `school`'da kapsam öğretmenin kendi branşıdır (`duty_outside_branch`; öğretmen kaydı bağlı
 * değilse `teacher_record_required`); `language_school`'da geçerli bir CEFR seviyesi
 * (`invalid_cefr_level`). Aynı üyeliğe aynı kapsam ikinci kez verilmez (`coordinator_duty_exists`).
 */
// TODO(zumre-tekil): Domain bir ders/seviyenin tek zümre başkanı veya koordinatörü olup
// olmadığını söylemiyor; aynı kapsama birden çok öğretmen atanabilir.
// TODO(koordinator-arti-seviye): Artı seviye (A2+, B1+, B2+) ayrı kapsamdır; B1 koordinatörü
// B1+ görevlerini kapsamaz. Domain ana seviyenin artısını da kapsayıp kapsamadığını söylemiyor.
export function planCoordinatorDuty(input: {
  institutionType: InstitutionType
  member: { role: Role; teacherSubjectId: string | null }
  active: readonly CoordinatorDutyRow[]
  input: unknown
}): CoordinatorDutyDraft {
  const data = coordinatorDutyInputSchema.parse(input.input)
  if (input.member.role !== 'ogretmen') {
    throw new DomainError('duty_requires_teacher', 'Bu görev yalnız öğretmene verilir.', {
      path: ['membershipId'],
    })
  }
  const kind = dutyKindFor(input.institutionType)
  if (kind === 'subject_head') {
    if (input.member.teacherSubjectId === null) {
      throw new DomainError(
        'teacher_record_required',
        'Öğretmenin kadro kaydı bağlı değil; önce öğretmen kaydını bağlayın.',
        { path: ['membershipId'] },
      )
    }
    if (input.member.teacherSubjectId !== data.scopeId) {
      throw new DomainError(
        'duty_outside_branch',
        'Zümre başkanlığı öğretmenin kendi branşında verilir.',
        { path: ['scopeId'] },
      )
    }
  } else if (!isCefrLevel(data.scopeId)) {
    throw new DomainError('invalid_cefr_level', 'Geçerli bir CEFR seviyesi seçin.', {
      path: ['scopeId'],
    })
  }
  if (
    input.active.some(
      (duty) =>
        duty.membershipId === data.membershipId &&
        duty.kind === kind &&
        duty.scopeId === data.scopeId,
    )
  ) {
    throw new DomainError('coordinator_duty_exists', 'Bu görev öğretmene zaten verilmiş.', {
      kind: 'conflict',
    })
  }
  return { membershipId: data.membershipId, kind, scopeId: data.scopeId }
}

/** Görevlerin kapsamı; `content/resource.ts` `ContentActor.reviewer` ile aynı biçim. */
export type CoordinatorScope = {
  subjectIds: readonly string[]
  cefrLevels: readonly CefrLevel[]
}

export const NO_COORDINATOR_SCOPE: CoordinatorScope = { subjectIds: [], cefrLevels: [] }

export function coordinatorScopeOf(
  duties: readonly Pick<CoordinatorDutyRow, 'kind' | 'scopeId'>[],
): CoordinatorScope {
  const subjectIds = new Set<string>()
  const cefrLevels = new Set<CefrLevel>()
  for (const duty of duties) {
    if (duty.kind === 'subject_head') subjectIds.add(duty.scopeId)
    else if (isCefrLevel(duty.scopeId)) cefrLevels.add(duty.scopeId)
  }
  return { subjectIds: [...subjectIds].sort(), cefrLevels: [...cefrLevels].sort() }
}

export const isCoordinator = (scope: CoordinatorScope) =>
  scope.subjectIds.length > 0 || scope.cefrLevels.length > 0

/**
 * Görevin kapsadığı alan mı: içeriğin dersi zümre başkanının dersi ya da CEFR seviyesi
 * koordinatörün seviyesi (DOM-YTK-027). Etiketsiz alan kimsenin kapsamında değildir.
 */
export function coordinatesArea(
  scope: CoordinatorScope,
  area: { subjectId: string | null; cefrLevel: string | null },
): boolean {
  return (
    (area.subjectId !== null && scope.subjectIds.includes(area.subjectId)) ||
    (area.cefrLevel !== null && (scope.cefrLevels as readonly string[]).includes(area.cefrLevel))
  )
}
