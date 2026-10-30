import type { ApiError, ApiIssue } from '@kampus/api-client/errors.ts'

/**
 * Optik ve etüt uçlarının hata yanıtlarını ekranın göstereceği biçime çeviren saf yardımcılar
 * (api-tasarimi.md "Optik ve etüt"). React'siz test edilir; hook'lar `use-assessment-commands.ts`'tedir.
 */

/** Dosya alanları: okuyucu dosyası `evaluate` gövdesinde `text`, cevap anahtarı `profile` gövdesinde `keyCsv`. */
export type FileField = 'text' | 'keyCsv'

export interface FileFailure {
  /** Hatanın bağlanacağı form alanı. */
  field: FileField
  /** Kullanıcıya gösterilecek Türkçe ileti; satır varsa satır numarasını taşır. */
  message: string
  /** Dosya satırı (başlık 1); satır bilgisi yoksa `null`. */
  line: number | null
}

export const FILE_TOO_LARGE_MESSAGE = 'Dosya en fazla 1 MB olabilir.'

function lineOf(issue: ApiIssue): number | null {
  const [, marker, line] = issue.path
  return marker === 'line' && typeof line === 'number' ? line : null
}

/**
 * Dosya hatası ise alan iletisi: 413 (1 MB aşıldı) ve `issues[0].path` `[alan, "line", satır]`
 * olan 422. İleti satır numarasını zaten içermiyorsa başına eklenir. Başka hata `null` döner
 * (toast veya ilgili alan yoluyla gösterilir).
 */
export function fileFailure(error: ApiError, field: FileField): FileFailure | null {
  if (error.status === 413) return { field, message: FILE_TOO_LARGE_MESSAGE, line: null }
  if (error.status !== 422) return null
  const issue = error.issues[0]
  if (!issue || issue.path[0] !== field) return null
  const line = lineOf(issue)
  const message =
    line !== null && !issue.message.includes(`${line}. satır`)
      ? `${line}. satır: ${issue.message}`
      : issue.message
  return { field, message, line }
}

export interface PlanChanges {
  /** Güncel planda yeni görünen etütler. */
  added: string[]
  /** Önizlemede olup güncel planda kalmayan etütler. */
  removed: string[]
  /** Öğrenci listesi değişen etütler. */
  changed: string[]
  /** Yerleşemeyen grup sayısı değişimi gibi diğer farklar. */
  other: string[]
}

/** 409 `tutoring_plan_stale` `issues`'ını eklenen/kalkan/değişen etütlere ayırır. */
export function planChanges(error: ApiError): PlanChanges {
  const changes: PlanChanges = { added: [], removed: [], changed: [], other: [] }
  for (const issue of error.issues) {
    if (issue.code === 'plan_session_added') changes.added.push(issue.message)
    else if (issue.code === 'plan_session_removed') changes.removed.push(issue.message)
    else if (issue.code === 'plan_session_students_changed') changes.changed.push(issue.message)
    else changes.other.push(issue.message)
  }
  return changes
}

/**
 * Önizleme çağrısında toast gösterilmeyecek hatalar: 413 ve 422 alan hatasıdır, ekran bunları
 * forma yazar. Geri kalanı (403, 404, 409, ağ) kullanıcıya toast olarak gider.
 */
export function isFieldFailure(error: ApiError): boolean {
  return error.status === 413 || error.status === 422
}
