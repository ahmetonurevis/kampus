import { academicYearName } from '@kampus/school-core/lib/academic-years.ts'
import {
  LINKABLE_DEVELOPMENT_GOAL_STATUSES,
  PROFESSIONAL_DEVELOPMENT_TARGET_MAX_HOURS,
  professionalDevelopmentTargetInputSchema,
} from '@kampus/school-core/lib/finance-professional-development-hours.ts'
import { hoursLabel } from '@kampus/school-core/lib/finance-professional-development.ts'
import type { StaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

// Mesleki gelişim saati ekranının saf mantığı (DOM-FIN-144; ON-215): öğretim yılı seçenekleri, hedef
// formunun gövdesi, özet satırının metinleri, bağlanabilir hedef ve sertifika seçenekleri.

/** Seçilebilen öğretim yılları: önceki, içinde bulunulan ve sonraki. */
export function yearOptions(current: number): { value: number; label: string }[] {
  return [current - 1, current, current + 1].map((value) => ({
    value,
    label: academicYearName(value),
  }))
}

export type TargetParse =
  | { ok: true; body: { targetHours: number | null; appliesToRoles: StaffRole[] } }
  | { ok: false; message: string }

/** Hedef formu: boş saat hedefi kaldırır; tam saat 1–500 ve en az bir rol. */
export function targetBody(hoursText: string, roles: readonly StaffRole[]): TargetParse {
  const trimmed = hoursText.trim()
  const targetHours = trimmed === '' ? null : Number(trimmed)
  if (targetHours !== null && !Number.isInteger(targetHours))
    return {
      ok: false,
      message: `Hedef saat 1–${String(PROFESSIONAL_DEVELOPMENT_TARGET_MAX_HOURS)} arasında tam sayı olmalı.`,
    }
  const parsed = professionalDevelopmentTargetInputSchema.safeParse({
    targetHours,
    appliesToRoles: [...roles],
  })
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Hedef geçersiz.' }
  return { ok: true, body: parsed.data }
}

/** Özet satırının metinleri; hedef yoksa "—". */
export function hoursRowText(row: {
  completedHours: number
  targetHours: number | null
  missingHours: number | null
  met: boolean | null
}) {
  return {
    completed: hoursLabel(row.completedHours),
    target: row.targetHours === null ? '—' : hoursLabel(row.targetHours),
    missing:
      row.missingHours === null
        ? '—'
        : row.met === true
          ? 'Tamamlandı'
          : hoursLabel(row.missingHours),
  }
}

/** Bağlanabilir gelişim hedefleri: açık ya da süren; mevcut bağ kapanmış olsa da listede kalır. */
export function goalChoices<T extends { id: string; status: string }>(
  goals: readonly T[],
  linkedId: string | null,
): T[] {
  return goals.filter(
    (goal) =>
      goal.id === linkedId ||
      (LINKABLE_DEVELOPMENT_GOAL_STATUSES as readonly string[]).includes(goal.status),
  )
}

/** Bağlanabilir sertifikalar: personelin yerine geçilmemiş sertifika türü belgeleri. */
export function certificateChoices<
  T extends { id: string; documentType: string; supersededAt: string | null },
>(documents: readonly T[]): T[] {
  return documents.filter((doc) => doc.documentType === 'certificate' && doc.supersededAt === null)
}

/** Dosya boyutu gösterimi: `240 KB`, `1,2 MB`. */
export function byteSizeLabel(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024 * 1024) return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`
}
