// Yönetici yoklama düzeltmesi (IST-093, DOM-AKD-035) ekranının saf hesapları: gün seçimi, satır
// farkı, düzeltme geçmişi ve gönderim sonrası form durumu. Yetki ve gerekçe kuralı sunucudadır
// (school-core `authorize('attendance.record')`); form aynı çekirdek şemayla istek atmadan uyarır.
import { z } from 'zod'
import { attendanceCorrectionReasonSchema } from '@kampus/school-core/lib/domain.ts'
import {
  ATTENDANCE_STATUSES,
  attendanceStatusLabel,
  isDayKey,
  type AttendanceStatus,
} from './academic-rows.ts'

/** Düzeltme formu: yalnız gerekçe; sınıf ve gün sayfa süzgecidir (adreste). */
export const correctionFormSchema = z.object({ reason: attendanceCorrectionReasonSchema })
export type CorrectionFormInput = z.input<typeof correctionFormSchema>
export type CorrectionFormOutput = z.output<typeof correctionFormSchema>

export const NOT_RECORDED = 'Kayıt yok'

const DAY_MS = 86_400_000

/** Takvim gününden bir gün önce (`YYYY-MM-DD`; öğle saatiyle yaz saati kaymaz). */
export function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) - DAY_MS).toISOString().slice(0, 10)
}

/** Seçilebilir gün: geçerli takvim günü ve bugünden ileri değil (gelecek için yoklama yok). */
export function isSelectableDay(day: unknown, today: string): boolean {
  if (!isDayKey(day)) return false
  const parsed = new Date(`${day}T12:00:00Z`)
  return (
    Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day && day <= today
  )
}

/**
 * Adresteki gün (`?tarih=`): seçilebilirse kendisi, ileri tarihse bugün, yoksa ya da bozuksa dün.
 * Elle yazılan ileri tarih ekranda hiçbir zaman seçili görünmez.
 */
export function correctionDay(requested: string | null, today: string): string {
  if (requested !== null && isSelectableDay(requested, today)) return requested
  if (isDayKey(requested) && requested > today) return today
  return previousDay(today)
}

export type CorrectionChange = 'same' | 'changed' | 'new'

export type CorrectionRow = {
  studentId: string
  name: string
  /** O gün kayıtlı durum; kayıt yoksa `null`. */
  current: AttendanceStatus | null
  currentLabel: string
  /** Gönderilecek durum: kullanıcının seçimi, yoksa kayıtlı durum, o da yoksa "Geldi". */
  next: AttendanceStatus
  change: CorrectionChange
}

const isStatus = (value: string | undefined): value is AttendanceStatus =>
  ATTENDANCE_STATUSES.some((status) => status === value)

/**
 * Sınıfın aktif öğrencileri için mevcut ve yeni durum. Kaydı olmayan öğrenci (gün hiç alınmamış ya
 * da öğrenci sonradan katılmış) `new` olur: gönderim onun ilk kaydını yazar.
 */
export function correctionRows(
  students: readonly { id: string; name: string }[],
  saved: readonly { studentId: string; status: string }[],
  edits: Readonly<Record<string, AttendanceStatus>> = {},
): CorrectionRow[] {
  const savedBy = new Map(saved.map((item) => [item.studentId, item.status]))
  return students.map((student) => {
    const stored = savedBy.get(student.id)
    const current = isStatus(stored) ? stored : null
    const next = edits[student.id] ?? current ?? 'present'
    return {
      studentId: student.id,
      name: student.name,
      current,
      currentLabel: stored === undefined ? NOT_RECORDED : attendanceStatusLabel(stored),
      next,
      change: current === null ? 'new' : current === next ? 'same' : 'changed',
    }
  })
}

export function correctionCounts(rows: readonly CorrectionRow[]) {
  return {
    changed: rows.filter((row) => row.change === 'changed').length,
    added: rows.filter((row) => row.change === 'new').length,
  }
}

/** Gönderilecek bir şey var mı: değişen ya da ilk kez yazılacak öğrenci. */
export const hasCorrection = (rows: readonly CorrectionRow[]) =>
  rows.some((row) => row.change !== 'same')

export const correctionMarks = (rows: readonly CorrectionRow[]) =>
  Object.fromEntries(rows.map((row) => [row.studentId, row.next]))

export type CorrectionEntry = {
  key: string
  student: string
  previous: string
  next: string
  reason: string
  by: string
  at: string
}

type CorrectedRecord = {
  id: string
  studentId: string
  corrections?:
    | readonly { previousStatus: string; status: string; reason: string; by: string; at: string }[]
    | undefined
}

export const UNKNOWN_ACTOR = 'Bilinmeyen kullanıcı'

/**
 * Günün düzeltme geçmişi, en yeniden eskiye. Kaynak kayıtların `corrections` alanıdır (yönetici
 * ve öğretmen görür, öğrenci ve veliye dönmez); düzelten kişi kullanıcı kimliğinden ada çevrilir.
 */
export function correctionHistory(
  records: readonly CorrectedRecord[],
  studentNames: ReadonlyMap<string, string>,
  userNames: ReadonlyMap<string, string>,
): CorrectionEntry[] {
  return records
    .flatMap((record) =>
      (record.corrections ?? []).map((item, index) => ({
        key: `${record.id}-${index}`,
        student: studentNames.get(record.studentId) ?? '—',
        previous: attendanceStatusLabel(item.previousStatus),
        next: attendanceStatusLabel(item.status),
        reason: item.reason,
        by: (item.by && userNames.get(item.by)) || UNKNOWN_ACTOR,
        at: item.at,
      })),
    )
    .sort((left, right) => right.at.localeCompare(left.at) || left.key.localeCompare(right.key))
}

/** Düzelten kullanıcı kimlikleri (ad çözümü yalnız geçmiş varsa istenir). */
export function correctorIds(records: readonly CorrectedRecord[]): string[] {
  return [
    ...new Set(records.flatMap((record) => (record.corrections ?? []).map((item) => item.by))),
  ].filter(Boolean)
}

/**
 * Gönderimden sonra formun durumu. Başarıda işaretler ve gerekçe temizlenir (liste yeni kayıttan
 * gelir). Sürüm çakışmasında (409) veri tazelenir ama kullanıcının işaretleri ve gerekçesi kalır;
 * güncel duruma bakıp yeniden kaydedebilir. Diğer hatalarda hiçbir şey kaybolmaz.
 */
export function afterCorrection(outcome: { status: 'success' | 'failed' | 'busy' }): {
  clearEdits: boolean
  clearReason: boolean
} {
  const done = outcome.status === 'success'
  return { clearEdits: done, clearReason: done }
}
