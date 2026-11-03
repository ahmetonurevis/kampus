// Mazeret belgesi ve karar formlarının saf mantığı (DOM-ILT-053; Sabah kararları 71, 72). Kuralın
// kendisi core'dadır (`lib/requests.ts`); burası kullanıcıya gereksiz istek attırmamak içindir.
// Karar yine sunucudadır.
import { z } from 'zod'
import {
  ABSENCE_DOCUMENT_LIMIT,
  ABSENCE_REJECT_REASON_MAX_LENGTH,
  rejectAbsenceSchema,
} from '@kampus/school-core/lib/requests.ts'
import type { FileUploadItem } from '@/components/FileUploadField.tsx'
import type { AbsenceRow } from './request-rows.ts'

export { ABSENCE_DOCUMENT_LIMIT, ABSENCE_REJECT_REASON_MAX_LENGTH }

/** Ret formu: gerekçe core şemasıyla aynı sınırlardadır (2–500 karakter, Türkçe ileti). */
export const rejectFormSchema = z.object({ reason: rejectAbsenceSchema.shape.reason })
export type RejectFormValues = z.input<typeof rejectFormSchema>

/**
 * Panelin okuyucusu: karar yalnız yöneticidedir (Sabah kararı 71); sınıf rehber öğretmeni
 * salt okur görür; belgeyi yalnız veli yükler.
 */
export type AbsenceViewer = 'parent' | 'admin' | 'teacher'

export type AbsenceActions = {
  /** Yönetici: karar bekleyen bildirimi onaylar ya da gerekçeyle reddeder. */
  decide: boolean
  /** Veli: karar bekleyen bildirime belge ekler (yer varsa). */
  attach: boolean
  /** Eklenebilecek belge sayısı (toplam en çok `ABSENCE_DOCUMENT_LIMIT`). */
  remaining: number
}

/**
 * Okuyucunun bildirimde yapabilecekleri. Karar verilmiş bildirimde karar ve belge ekleme
 * kapalıdır (sunucu 409 `absence_already_decided`); süre denetimi (`absence_document_late`)
 * sunucudadır ve Türkçe iletiyle gösterilir.
 */
export function absenceActions(
  row: Pick<AbsenceRow, 'approval' | 'fileIds'>,
  viewer: AbsenceViewer,
): AbsenceActions {
  const pending = row.approval === 'pending'
  const remaining = Math.max(0, ABSENCE_DOCUMENT_LIMIT - row.fileIds.length)
  return {
    decide: viewer === 'admin' && pending,
    attach: viewer === 'parent' && pending && remaining > 0,
    remaining,
  }
}

/** Yüklenen belgeyi listeye ekler; aynı kimlik iki kez eklenmez, liste sınırda kalır. */
export function addAbsenceDocument(
  current: readonly FileUploadItem[],
  item: FileUploadItem,
  limit: number = ABSENCE_DOCUMENT_LIMIT,
): FileUploadItem[] {
  if (current.some((file) => file.id === item.id)) return [...current]
  return [...current, item].slice(0, limit)
}

/** Gönderilecek belge kimlikleri; belge yoksa alan hiç gönderilmez (belge zorunlu değildir). */
export function documentIds(items: readonly FileUploadItem[]): string[] | undefined {
  return items.length > 0 ? items.map((item) => item.id) : undefined
}
