import type { ConsentPurpose } from '@kampus/school-core/lib/consent-purposes.ts'
import { isUnderAdultAge } from '@kampus/school-core/lib/age.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import type { ConsentStatusView } from '@kampus/react-shared/use-consents.ts'
import { STAFF_CONSENT_INFO } from '../../components/consent/consent-model.ts'

// Kesin kayıt ekranının rıza bilgilendirmesi (IST-016, IST-017; DOM-YTK-057, DOM-YTK-061,
// DOM-KAY-003). Kayıt formunu yalnız personel kullanır ve personel rıza veremez (API 403); öğrenci
// de form bitmeden oluşmaz. Bu yüzden formda rıza adımı yoktur: form rızayı beklemez, kayıttan
// sonra hangi rızanın kimden bekleneceğini söyler. Saf işlevlerdir.

/** Kontrol adımındaki bilgi: rıza kaydı engellemez (DOM-YTK-061). */
export const ENROLLMENT_CONSENT_NOTE = `Açık rıza bu formda alınmaz ve kaydı engellemez. ${STAFF_CONSENT_INFO} Kayıt tamamlanınca beklenen rızalar listelenir.`

export const GUARDIAN_GUIDANCE =
  'Rızayı velayet sahibi veli kendi hesabından verir: web panelinde hesap menüsü, Ayarlar, Rızalarım.'
export const SELF_GUIDANCE =
  'Öğrenci 18 yaşını doldurduğu için rızayı kendisi verir: kendi hesabıyla web panelinde hesap menüsü, Ayarlar, Rızalarım.'
export const UNKNOWN_GRANTOR_GUIDANCE = `${STAFF_CONSENT_INFO} Yeri: web panelinde hesap menüsü, Ayarlar, Rızalarım.`
/** Rızalarım hesabın bağlı olduğu öğrencileri listeler; bağ kayıtla birlikte kurulmaz. */
export const ACCOUNT_LINK_NOTE =
  'Hesap bu öğrenciye bağlı değilse öğrenci Rızalarım bölümünde görünmez; önce hesap bağlantısı kurulmalıdır.'
/** Veli hesabı kesin kayıtla açılmaz; personel ayrıca açar (ON-290, DOM-YTK-071). */
export const GUARDIAN_ACCOUNT_MISSING_NOTE =
  'Velinin bu öğrenciye bağlı bir hesabı yoksa öğrenci Rızalarım bölümünde görünmez ve veli rıza veremez. Hesabı "Veli hesabı aç" ile açabilirsiniz.'
export const GUARDIAN_ACCOUNT_INVITED_NOTE =
  'Veli hesabı açıldı. Veli e-postadaki bağlantıyla parolasını belirleyip giriş yapınca bu öğrenci Rızalarım bölümünde görünür ve rızayı oradan verir.'

/**
 * Beklenen rızanın altındaki hesap notu: yetişkin kursiyer kendi hesabıyla verir (eski not);
 * veli için bekleyen veli daveti varsa hesabın açıldığı, yoksa açılması gerektiği yazılır.
 */
export function accountNote(input: { adult: boolean; invited: boolean }): string {
  if (input.adult) return ACCOUNT_LINK_NOTE
  return input.invited ? GUARDIAN_ACCOUNT_INVITED_NOTE : GUARDIAN_ACCOUNT_MISSING_NOTE
}
export const CONSENT_OPTIONAL_NOTE =
  'Rıza vermek zorunlu değildir; verilmemesi kaydı ve temel eğitim hizmetini etkilemez.'
/** Tanıtım iletisi öğrencinin değil hesabın amacıdır; öğrenci sonucunda (`studentId`) dönmez. */
export const ACCOUNT_PURPOSE_NOTE =
  'Tanıtım iletileri rızası hesaba aittir ve bu listede yer almaz; hesap sahibi kendisi karar verir.'
export const NO_NOTICE_LABEL = 'Aday kaydında gösterim kaydı yok'

export type ConsentTextState = 'ready' | 'missing' | 'loading' | 'error'

export interface EnrollmentConsentGroup {
  guidance: string
  purposes: ConsentPurpose[]
}

export interface EnrollmentConsentSummary {
  /** Metni yayımlı, geçerli rızası olmayan amaçlar; rızayı verecek kişiye göre gruplu. */
  awaiting: EnrollmentConsentGroup[]
  /** Metni yayımlanmadığı için şu an rıza alınamayan amaçlar. */
  unavailable: ConsentPurpose[]
  /** Geçerli rızası olan amaçlar. */
  granted: ConsentPurpose[]
}

function guidanceFor(grantor: ConsentStatusView['grantor']): string {
  if (grantor === 'guardian') return GUARDIAN_GUIDANCE
  if (grantor === 'self') return SELF_GUIDANCE
  return UNKNOWN_GRANTOR_GUIDANCE
}

/**
 * Yeni öğrencinin rıza özeti (`GET /consents/status` ve amaç metinleri). `adult`, formda girilen
 * doğum tarihinin sonucudur (`isAdultOnForm`): yanıttaki `grantor` öğrenci kaydının doğum tarihinden
 * hesaplanır, kesin kayıt ise doğum tarihini `student_identities`'e yazar; bu yüzden yeni yetişkin
 * öğrenci için sunucu `guardian` döndürür ve velisi olmayan kursiyere bile veli gösterilirdi.
 * Bilgilendirmedir, yetki kararı değildir: rızanın kendisini sunucu denetler.
 */
export function enrollmentConsentSummary(input: {
  statuses: readonly ConsentStatusView[]
  textState: (purpose: ConsentPurpose) => ConsentTextState
  adult: boolean
}): EnrollmentConsentSummary {
  const groups = new Map<string, ConsentPurpose[]>()
  const unavailable: ConsentPurpose[] = []
  const granted: ConsentPurpose[] = []
  for (const { purpose, valid, grantor } of input.statuses) {
    if (valid) {
      granted.push(purpose)
      continue
    }
    if (input.textState(purpose) === 'missing') {
      unavailable.push(purpose)
      continue
    }
    const guidance = guidanceFor(input.adult ? 'self' : grantor)
    groups.set(guidance, [...(groups.get(guidance) ?? []), purpose])
  }
  return {
    awaiting: [...groups].map(([guidance, purposes]) => ({ guidance, purposes })),
    unavailable,
    granted,
  }
}

/** Formdaki doğum tarihiyle öğrenci 18 yaşını doldurmuş mu (Europe/Istanbul günü; DOM-YTK-057). */
export function isAdultOnForm(birthDate: string, now: string | number | Date = new Date()) {
  return !isUnderAdultAge(birthDate, now)
}

/** Kontrol adımında adayın gördüğü aydınlatma metni: sürüm ve gösterim günü (DOM-KAY-003). */
export function prospectNoticeLabel(
  notice: { version: string; shownAt: string } | null | undefined,
): string {
  if (!notice) return NO_NOTICE_LABEL
  return `${notice.version} · ${dateLabel(notice.shownAt, { year: 'numeric' })}`
}
