import type {
  MealAllergyAcknowledgement,
  MealAllergyRoster,
  MealAllergyRosterQuery,
  MealAllergyRosterStudent,
} from '@kampus/react-shared/use-finance-meal-allergy-checks.ts'
import type { HealthAccessReason } from '@kampus/school-core/lib/finance-health-access.ts'
import { ALLERGEN_LABELS, type MealKind } from '@kampus/school-core/lib/finance-meal-menus.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { ALLERGY_SEVERITIES } from '@kampus/school-core/lib/health-profile.ts'

/**
 * Yemekhane alerji uyarısı sekmesinin saf mantığı (DOM-FIN-162; ON-151; K-541…K-543): seçim
 * değeri → sorgu, önerilen erişim gerekçesi, satır metinleri ve onay işaretinin listeye işlenmesi.
 * Eşleme kuralı sunucudadır (core `finance-meal-allergy-checks.ts`).
 */

/**
 * Önerilen erişim gerekçesi (K-542): servis ekranının amacı bellidir; kod listesinde yemek servisi
 * olmadığından "Diğer" ve kısa açıklama ön seçilidir, görevli onaylar ya da değiştirir.
 */
export const MEAL_ALLERGY_SUGGESTED_REASON = {
  code: 'other',
  note: 'Yemek servisinde alerji kontrolü',
} as const satisfies HealthAccessReason

/** Gerekçe kapsamı: bütün servis ekranı için tek görünüm (K-525, 15 dakika). */
export const MEAL_ALLERGY_REASON_SCOPE = 'meal-allergy-roster'

/** Sınıf ya da düzey seçimi: `class:<id>` ya da `grade:<n>`; boşsa seçilmemiş. */
export type MealAllergyTarget = '' | `class:${string}` | `grade:${string}`

export const classTarget = (classId: string): MealAllergyTarget => `class:${classId}`
export const gradeTarget = (grade: number): MealAllergyTarget => `grade:${String(grade)}`

/** Seçimden sorgu; seçim boş ya da bozuksa `null` (düğme kilitli). */
export function rosterQuery(input: {
  serviceDate: string
  mealKind: MealKind
  target: string
}): MealAllergyRosterQuery | null {
  const base = { serviceDate: input.serviceDate, mealKind: input.mealKind }
  if (input.target.startsWith('class:')) {
    const classId = input.target.slice('class:'.length)
    return classId === '' ? null : { ...base, classId }
  }
  if (input.target.startsWith('grade:')) {
    const grade = Number(input.target.slice('grade:'.length))
    return Number.isInteger(grade) && grade > 0 ? { ...base, grade } : null
  }
  return null
}

export const severityText = (severity: MealAllergyRosterStudent['severity']) =>
  severity === null ? 'Şiddet bilinmiyor' : ALLERGY_SEVERITIES[severity].label

/** "Sütlü pilav: Süt, Yumurta". */
export const conflictText = (conflict: MealAllergyRosterStudent['conflicts'][number]) =>
  `${conflict.itemName}: ${conflict.allergens.map((allergen) => ALLERGEN_LABELS[allergen]).join(', ')}`

/** "Kivi (hafif) — menüyle karşılaştırılamadı, elle kontrol". */
export function unmatchedText(item: MealAllergyRosterStudent['unmatched'][number]) {
  const note = item.partial
    ? 'bir kısmı menüyle karşılaştırılamadı, elle kontrol'
    : 'menüyle karşılaştırılamadı, elle kontrol'
  return `${item.allergyName} (${ALLERGY_SEVERITIES[item.severity].label.toLocaleLowerCase('tr')}) — ${note}`
}

/** "Uyarı görüldü, alternatif verildi · 12:05 · Büşra Aydın". */
export function acknowledgementText(ack: MealAllergyAcknowledgement) {
  const who = ack.acknowledgedByName ?? 'görevli'
  return `Uyarı görüldü, alternatif verildi · ${timeLabel(ack.acknowledgedAt)} · ${who}`
}

/** Liste başlığı: "Salı 6 Ekim · Öğle yemeği · 7-A" gibi; düzeyde "7. sınıflar". */
export function rosterTitle(roster: MealAllergyRoster, mealLabel: string) {
  const group =
    roster.className ?? (roster.grade === null ? 'Seçim' : `${String(roster.grade)}. sınıflar`)
  const day = dateLabel(`${roster.serviceDate}T09:00:00.000Z`, { weekday: 'long', month: 'long' })
  return `${day} · ${mealLabel} · ${group}`
}

/** Onay işaretini listeye işler (liste yeniden okunmaz: her okuma denetim satırıdır). */
export function withAcknowledgement(
  roster: MealAllergyRoster,
  studentId: string,
  ack: MealAllergyAcknowledgement,
): MealAllergyRoster {
  return {
    ...roster,
    students: roster.students.map((row) =>
      row.studentId === studentId ? { ...row, acknowledgement: ack } : row,
    ),
  }
}

/** Menü satırı: "Bütün kampüsler" ya da kampüs adı. */
export const menuScopeText = (menu: MealAllergyRoster['menus'][number]) =>
  menu.branchId === null ? 'Bütün kampüsler' : (menu.branchName ?? 'Kampüs')
