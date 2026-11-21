import {
  PROSPECT_DOCUMENT_ROLES,
  prospectDocumentGaps,
  type GapDocument,
  type GapDocumentType,
  type ProspectDocumentGaps,
  type ProspectDocumentStatus,
} from './prospect-documents.ts'

/**
 * Kayıt belgeleri: kesin kayıtta aday belgelerinin öğrenci dosyasına bağlanması
 * (docs/domain/kayit-ve-crm.md DOM-KAY-045; ON-344, K-384…K-386). Fonksiyonlar saftır; belge ve rıza
 * satırlarını servis yükler.
 *
 * - Dosya kopyalanmaz: aday belgesine ikinci bağ (öğrenci) yazılır, dosyanın bağı aday belgesinde
 *   kalır; açılış, özel nitelikli belgenin dar yetkisi ve denetim aday belgesindeki gibidir (K-384).
 * - Kesin kayıtta kabul edilmiş güncel belge bağlanır; inceleme bekleyen belge kabul edilince
 *   bağlanır; reddedilen ve yerine yenisi yüklenen bağlanmaz. Reddedilen belgenin dosyası 30 gün
 *   sonra imhaya işaretlenir; dosyası imha edilmiş belge bağlanmaz (K-384).
 * - Özel nitelikli belge yalnız etkin açık rıza varsa bağlanır ve rıza da öğrenciye bağlanır; rıza
 *   yoksa belge bağlanmaz, arşivlenir ve dosyası hemen imhaya işaretlenir (K-385, H-80).
 * - Bağlı belgenin dosyası imha işinde bekletilir; kesin kayıt geri alınamaz, ayrılışta bağ kalır
 *   (K-386, M-74).
 */

/** Öğrencinin kayıt belgelerini okuyan roller (aday belgeleriyle aynı; K-386). */
export const ENROLLMENT_DOCUMENT_ROLES = PROSPECT_DOCUMENT_ROLES

/** Kayıt belgelerinin eksik hesabında adayın aşaması: kesin kayıtta iki aşamanın türleri istenir. */
export const ENROLLED_PROSPECT_STAGE = 'Kayıt oldu'

export type EnrollmentDocumentCandidate = {
  id: string
  status: ProspectDocumentStatus
  specialCategory: boolean
  /** Dosya imha edilmemiş mi. */
  fileAvailable: boolean
  /** Belge zaten bir öğrenciye bağlı mı. */
  linked: boolean
}

export type EnrollmentDocumentPlan = {
  /** Öğrenciye bağlanacak belgeler. */
  link: string[]
  /** Dosyası 30 gün sonra imhaya işaretlenecek belgeler (reddedilen). */
  purgeLater: string[]
  /** Arşivlenip dosyası hemen imhaya işaretlenecek belgeler (rızası olmayan özel nitelikli). */
  purgeNow: string[]
  /** İncelemesi bekleyen belgeler: kabul edilince bağlanır. */
  pending: string[]
}

/**
 * Kesin kayıtta (ya da kayıttan sonraki incelemede) belgelerin akıbeti (K-384, K-385). Yerine yenisi
 * yüklenen belge yok sayılır: imha işareti yüklemede yazılmıştır. Zaten bağlı belge yeniden
 * bağlanmaz.
 */
export function planEnrollmentDocuments(
  documents: readonly EnrollmentDocumentCandidate[],
  consentActive: boolean,
): EnrollmentDocumentPlan {
  const plan: EnrollmentDocumentPlan = { link: [], purgeLater: [], purgeNow: [], pending: [] }
  for (const document of documents) {
    if (document.status === 'superseded' || document.linked) continue
    if (document.status === 'uploaded') {
      if (document.fileAvailable) plan.pending.push(document.id)
      continue
    }
    if (document.status === 'rejected') {
      if (document.fileAvailable) plan.purgeLater.push(document.id)
      continue
    }
    if (!document.fileAvailable) continue
    if (document.specialCategory && !consentActive) plan.purgeNow.push(document.id)
    else plan.link.push(document.id)
  }
  return plan
}

/**
 * Öğrenciye bağlı belgenin dosyası imha işinde bekletilir mi: bağlı, kabul edilmiş ve arşivlenmemiş
 * belge evet. Yerine yenisi yüklenen ya da rızası geri çekilip arşivlenen belge bekletilmez (K-386).
 */
export function enrollmentDocumentHeld(document: {
  linked: boolean
  status: ProspectDocumentStatus
  archived: boolean
}): boolean {
  return document.linked && document.status === 'accepted' && !document.archived
}

/**
 * Öğrencinin kayıt belgesi eksikleri: kesin kayda dönmüş adayın bütün zorunlu türleri (ön başvuru ve
 * kesin kayıt) istenir (K-321). Hesap aday belgeleriyle aynıdır: incelemesi bekleyen eksik değildir.
 */
export function enrollmentDocumentGaps(
  types: readonly GapDocumentType[],
  documents: readonly GapDocument[],
): ProspectDocumentGaps {
  return prospectDocumentGaps(types, documents, ENROLLED_PROSPECT_STAGE)
}

/** Öğrenci listesinde arama: ad, Türkçe büyük/küçük harf duyarsız, boşluk farkı gözetilmez. */
export function matchesEnrollmentDocumentSearch(name: string, query: string | undefined): boolean {
  const wanted = (query ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr')
  if (wanted === '') return true
  return name.replace(/\s+/g, ' ').toLocaleLowerCase('tr').includes(wanted)
}
