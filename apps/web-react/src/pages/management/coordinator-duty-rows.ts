// Zümre başkanı / akademik koordinatör ekranının saf hesapları (IST-005, DOM-YTK-027): satırlar,
// seçenekler ve kurum türüne göre metinler. Kural çekirdektedir (`lib/coordinator-duties.ts`);
// burada yalnız görünüm vardır, atamanın geçerliliğini sunucu doğrular.
import { CEFR_LEVELS } from '@kampus/school-core/content/taxonomy.ts'
import { subjects } from '@kampus/school-core/data/curriculum.ts'
import { COORDINATOR_DUTY_KINDS, dutyKindFor } from '@kampus/school-core/lib/coordinator-duties.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import type { CoordinatorDuty } from '@kampus/react-shared/use-coordinator-duties.ts'
import type { InstitutionMember } from '@kampus/react-shared/institution-lists.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

/** Yalnız yönetici görev verir ve kaldırır (DOM-YTK-027); sunucu da böyle uygular. */
export const canManageDuties = (role: string | undefined) => role === 'yonetici'

/** Kurum türüne göre ekran metinleri: okulda zümre başkanı ve ders, dil okulunda koordinatör ve seviye. */
export type DutyTexts = {
  kindLabel: string
  scopeLabel: string
  scopePlaceholder: string
  tableTitle: string
  addLabel: string
  formTitle: string
  formNote: string
  empty: string
}

const SUBJECT_HEAD_TEXTS = {
  scopeLabel: 'Ders',
  scopePlaceholder: 'Ders seçin',
  tableTitle: 'Zümre başkanları',
  addLabel: 'Zümre başkanı ata',
  formTitle: 'Zümre başkanı ata',
  formNote: 'Zümre başkanlığı öğretmenin kendi branşındaki derste verilir.',
  empty: 'Henüz zümre başkanı atanmadı.',
} as const

const TEXTS = {
  school: SUBJECT_HEAD_TEXTS,
  // Kurs ders + konu ağacıyla çalışır; görev okuldaki gibi ders kapsamlıdır (ADR 0008).
  course_center: SUBJECT_HEAD_TEXTS,
  language_school: {
    scopeLabel: 'Seviye',
    scopePlaceholder: 'Seviye seçin',
    tableTitle: 'Akademik koordinatörler',
    addLabel: 'Koordinatör ata',
    formTitle: 'Akademik koordinatör ata',
    formNote: 'Koordinatörlük seçilen CEFR seviyesi için verilir.',
    empty: 'Henüz akademik koordinatör atanmadı.',
  },
} as const satisfies Record<InstitutionType, Omit<DutyTexts, 'kindLabel'>>

export function dutyTexts(type: InstitutionType): DutyTexts {
  return { ...TEXTS[type], kindLabel: COORDINATOR_DUTY_KINDS[dutyKindFor(type)].label }
}

export type ScopeOption = { value: string; label: string }

/**
 * `school` ve `course_center`: müfredattaki dersler; `language_school`: CEFR seviyeleri (düşükten
 * yükseğe).
 */
export function scopeOptions(type: InstitutionType): ScopeOption[] {
  if (dutyKindFor(type) === 'subject_head')
    return subjects.map((subject) => ({ value: subject.id, label: subject.name }))
  return Object.entries(CEFR_LEVELS)
    .sort(([, a], [, b]) => a.rank - b.rank)
    .map(([value, level]) => ({ value, label: level.label }))
}

export function scopeLabel(type: InstitutionType, scopeId: string): string {
  return scopeOptions(type).find((option) => option.value === scopeId)?.label ?? scopeId
}

export type TeacherOption = { value: string; label: string }

const byTurkish = (a: string, b: string) => a.localeCompare(b, 'tr')

/** Atanabilecek öğretmenler: yalnız etkin üyelikler, ada göre (pasif öğretmene görev verilmez). */
export function teacherOptions(members: readonly InstitutionMember[]): TeacherOption[] {
  return members
    .filter((member) => member.role === 'ogretmen' && member.status === 'active')
    .map((member) => ({ value: member.id, label: member.name }))
    .sort((a, b) => byTurkish(a.label, b.label))
}

type TeacherRecord = { name: string; subjectId: string; isActive: boolean }

/**
 * Seçilen öğretmenin kadro branşı: üyeliğin bağlı öğretmen kaydının adıyla eşleşen tek etkin kayıt.
 * Yalnız formda dersi önceden seçmek içindir; ad eşleşmesi belirsizse ya da kayıt yoksa `null`.
 * Geçerliliği sunucu doğrular (`duty_outside_branch`, `teacher_record_required`).
 */
export function teacherBranchOf(
  member: Pick<InstitutionMember, 'links'> | undefined,
  records: readonly TeacherRecord[],
): string | null {
  const name = member?.links.find((link) => link.kind === 'teacher')?.name
  if (!name) return null
  const same = records.filter(
    (record) =>
      record.isActive &&
      record.name.trim().toLocaleLowerCase('tr') === name.trim().toLocaleLowerCase('tr'),
  )
  return same.length === 1 ? (same[0]?.subjectId ?? null) : null
}

export type DutyRow = {
  id: string
  membershipId: string
  teacher: string
  email: string
  /** Görevli üyelik artık etkin değil (pasif öğretmen). */
  passive: boolean
  scopeId: string
  scope: string
  kind: string
  createdAt: string
  /** Kaldırmada `If-Match` olarak gönderilen okunan sürüm. */
  version: number
}

export const UNKNOWN_TEACHER = 'Öğretmen bulunamadı'

/** Görev satırları: öğretmen adı ve e-postası üyelik listesinden, kapsam adı müfredat/CEFR'den. */
export function dutyRows(
  type: InstitutionType,
  duties: readonly CoordinatorDuty[],
  members: readonly InstitutionMember[],
): DutyRow[] {
  const byId = new Map(members.map((member) => [member.id, member]))
  return duties.map((duty) => {
    const member = byId.get(duty.membershipId)
    return {
      id: duty.id,
      membershipId: duty.membershipId,
      teacher: member?.name ?? UNKNOWN_TEACHER,
      email: member?.email ?? '',
      passive: member?.status === 'passive',
      scopeId: duty.scopeId,
      scope: scopeLabel(type, duty.scopeId),
      kind: COORDINATOR_DUTY_KINDS[duty.kind].label,
      createdAt: duty.createdAt,
      version: duty.rowVersion,
    }
  })
}

/** Tablo sırası: öğretmen adı, sonra kapsam (Türkçe). */
export function sortedDutyRows(rows: readonly DutyRow[]): DutyRow[] {
  return [...rows].sort((a, b) => byTurkish(a.teacher, b.teacher) || byTurkish(a.scope, b.scope))
}

export const DUTY_CSV_COLUMNS = (scope: string) =>
  [
    { key: 'teacher', label: 'Öğretmen' },
    { key: 'kind', label: 'Görev' },
    { key: 'scope', label: scope },
    { key: 'createdAt', label: 'Verildiği tarih' },
  ] as const

/** Verildiği tarih, yıllı (görev yıllar sonra da listede durur). */
export const dutyDate = (value: string) => dateLabel(value, { year: 'numeric' })

export function dutyCsvRows(rows: readonly DutyRow[]) {
  return rows.map((row) => ({ ...row, createdAt: dutyDate(row.createdAt) }))
}
