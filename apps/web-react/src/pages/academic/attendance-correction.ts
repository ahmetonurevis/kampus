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

/**
 * `unselected`: kaydı olmayan öğrenciye henüz durum seçilmedi. İlk kayıt yazılacağı için varsayılan
 * durum yoktur; her öğrenci için açık seçim (ya da toplu "Geldi") gerekir.
 */
export type CorrectionChange = 'same' | 'changed' | 'new' | 'unselected'

export type CorrectionRow = {
  studentId: string
  name: string
  /** O gün kayıtlı durum; kayıt yoksa `null`. */
  current: AttendanceStatus | null
  currentLabel: string
  /** Gönderilecek durum: kullanıcının seçimi, yoksa kayıtlı durum; ikisi de yoksa `null`. */
  next: AttendanceStatus | null
  change: CorrectionChange
}

const isStatus = (value: string | undefined): value is AttendanceStatus =>
  ATTENDANCE_STATUSES.some((status) => status === value)

/**
 * Sınıfın aktif öğrencileri için mevcut ve yeni durum. Kaydı olmayan öğrenci (gün hiç alınmamış ya
 * da öğrenci sonradan katılmış) seçim yapılana kadar `unselected`, seçilince `new` olur: gönderim
 * onun ilk kaydını yazar. Kayıtlı öğrencide seçim yoksa durum kayıtlı olandır (`same`).
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
    const next = edits[student.id] ?? current
    return {
      studentId: student.id,
      name: student.name,
      current,
      currentLabel: stored === undefined ? NOT_RECORDED : attendanceStatusLabel(stored),
      next,
      change:
        next === null
          ? 'unselected'
          : current === null
            ? 'new'
            : current === next
              ? 'same'
              : 'changed',
    }
  })
}

export function correctionCounts(rows: readonly CorrectionRow[]) {
  const count = (change: CorrectionChange) => rows.filter((row) => row.change === change).length
  return { changed: count('changed'), added: count('new'), unselected: count('unselected') }
}

/**
 * Gönderilebilir mi: durumu seçilmemiş öğrenci kalmamış ve en az bir öğrenci değişmiş ya da ilk
 * kez yazılacak. Seçilmemiş tek satır bile kaydı kapatır (sunucu da tüm öğrenciyi ister).
 */
export function canSubmitCorrection(rows: readonly CorrectionRow[]): boolean {
  return (
    rows.length > 0 &&
    rows.every((row) => row.change !== 'unselected') &&
    rows.some((row) => row.change !== 'same')
  )
}

/** Toplu eylem: seçilmemiş öğrencileri "Geldi" yapar; yapılmış seçimlere ve kayıtlara dokunmaz. */
export function markUnselectedPresent(
  rows: readonly CorrectionRow[],
  edits: Readonly<Record<string, AttendanceStatus>>,
): Record<string, AttendanceStatus> {
  const next = { ...edits }
  for (const row of rows) if (row.change === 'unselected') next[row.studentId] = 'present'
  return next
}

export const correctionMarks = (rows: readonly CorrectionRow[]) =>
  Object.fromEntries(rows.flatMap((row) => (row.next === null ? [] : [[row.studentId, row.next]])))

/**
 * Formda kullanıcının girdiği, henüz kaydedilmemiş bir şey var mı: değişen ya da seçilen satır
 * ya da gerekçe. Gezinirken onay istemenin ölçütüdür.
 */
export function correctionDirty(rows: readonly CorrectionRow[], reason: string): boolean {
  return (
    reason.trim() !== '' || rows.some((row) => row.change === 'changed' || row.change === 'new')
  )
}

/**
 * İlk yoklamada gerekçe saklanmaz: core `recordAttendance` ilk kayda gerekçe ve düzelteni yazmaz,
 * `audit_log` yalnız alan adlarını tutar (`changes.fields`). Gerekçe yine zorunludur, çünkü API
 * yönetici isteğinde ister; yalnız durumu değişen kayıtların düzeltme geçmişine yazılır.
 */
export const FIRST_ENTRY_NOTE = 'İlk yoklamada gerekçe saklanmaz.'

/** Başarı toast'ı: gerekçenin nereye yazıldığı gerçeğe uygun söylenir. */
export function savedMessage(counts: { changed: number; added: number }): string {
  if (counts.added === 0) return 'Yoklama düzeltildi.'
  if (counts.changed === 0) return `Yoklama kaydedildi. ${FIRST_ENTRY_NOTE}`
  return `Yoklama düzeltildi. İlk kez kaydedilenler için gerekçe saklanmadı.`
}

/** Ekranın gösterdiği kayıtlarla sunucudan yeni okunanlar aynı mı (öğrenci → durum). */
export function sameStatuses(
  shown: readonly { studentId: string; status: string }[],
  fresh: readonly { studentId: string; status: string }[],
): boolean {
  const left = new Map(shown.map((item) => [item.studentId, item.status]))
  const right = new Map(fresh.map((item) => [item.studentId, item.status]))
  return left.size === right.size && [...left].every(([id, status]) => right.get(id) === status)
}

export type FreshSubmitResult<TOutcome> =
  | { kind: 'sent'; outcome: TOutcome }
  /** Ekrandaki yoklama sunucudakinden eski: gönderilmedi, güncel veri yüklendi. */
  | { kind: 'stale' }
  /** Güncel sınıf sürümü ya da yoklama okunamadı: gönderilmedi. */
  | { kind: 'unavailable'; cause: unknown }

/**
 * Gönderimden hemen önce sınıf sürümü ve yoklama yeniden okunur; kayıp güncelleme olmasın diye
 * sıra önemlidir: sürüm önce, yoklama sonra okunur. Arada başkası yazarsa sürüm eskide kalır ve
 * sunucu 409 verir; sürüm yoklamadan yeni olamaz. Okunan yoklama ekrandakinden farklıysa
 * (başkası düzeltmiş) kullanıcı farkı görmeden istek atılmaz.
 */
export async function submitWithFreshState<TOutcome>(
  shown: readonly { studentId: string; status: string }[],
  deps: {
    refreshClassVersion: () => Promise<number>
    refreshSaved: () => Promise<readonly { studentId: string; status: string }[]>
    send: (classVersion: number) => Promise<TOutcome>
  },
): Promise<FreshSubmitResult<TOutcome>> {
  let version: number
  let fresh: readonly { studentId: string; status: string }[]
  try {
    version = await deps.refreshClassVersion()
    fresh = await deps.refreshSaved()
  } catch (cause) {
    return { kind: 'unavailable', cause }
  }
  if (!sameStatuses(shown, fresh)) return { kind: 'stale' }
  return { kind: 'sent', outcome: await deps.send(version) }
}

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

export type CorrectionFormState = {
  edits: Readonly<Record<string, AttendanceStatus>>
  reason: string
}

/**
 * Gönderimden sonra formun durumu. Başarıda işaretler ve gerekçe temizlenir (liste yeni kayıttan
 * gelir). Sürüm çakışmasında (409) veri tazelenir ama kullanıcının işaretleri ve gerekçesi kalır;
 * güncel duruma bakıp yeniden kaydedebilir. Diğer hatalarda hiçbir şey kaybolmaz.
 */
export function formAfterSubmit(
  form: CorrectionFormState,
  outcome: { status: 'success' | 'failed' | 'busy' },
): CorrectionFormState {
  return outcome.status === 'success' ? { edits: {}, reason: '' } : form
}
