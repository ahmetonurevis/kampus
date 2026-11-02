// Açık rıza adımının modeli (IST-017; DOM-YTK-057…062, guvenlik-kvkk §9): kim işlem yapar, hangi
// amaçlar karar bekler, seçimler tamam mı ve gönderim planı. Saf işlevlerdir; metin, satır ve
// geçerlilik sunucudadır (`@kampus/react-shared/use-consents.ts`). Rıza varsayılan değildir:
// hiçbir amaç önceden seçili gelmez.
import { CONSENT_PURPOSES, type ConsentPurpose } from '@kampus/school-core/lib/consent-purposes.ts'
import type { ConsentStatusView } from '@kampus/react-shared/use-consents.ts'
import type { RoleKey } from '../../lib/navigation.ts'

/** Kullanıcının açık kararı; "declined" sunucuya yazılmaz (rıza yokluğu kayıt gerektirmez). */
export type ConsentChoice = 'granted' | 'declined'
export type ConsentChoices = Partial<Record<ConsentPurpose, ConsentChoice>>

export const CHOICE_LABELS = {
  granted: 'Onaylıyorum',
  declined: 'Onaylamıyorum',
} as const satisfies Record<ConsentChoice, string>

/** Personele gösterilen bilgi: API personele rıza vermeyi 403 ile reddeder (DOM-YTK-057). */
export const STAFF_CONSENT_INFO = 'Rızayı veli ya da öğrenci kendi hesabından verir.'
export const DECLINE_NOTE =
  'Rıza vermemek temel eğitim hizmetini etkilemez. Rızanızı istediğiniz zaman geri çekebilirsiniz.'
export const STUDENT_REQUIRED_INFO = 'Bu rıza öğrenci seçilmeden istenemez.'
export const NO_TEXT_INFO = 'Bu amaç için rıza metni henüz yayımlanmadı; rıza alınamıyor.'
export const OUTDATED_NOTICE =
  'Rıza metni güncellendi. Güncel metni okuyup kararınızı yeniden verin.'

/** Yalnız veli ve öğrenci rıza verir; personel (yönetici, ön büro, öğretmen) veremez. */
export function canActOnConsent(role: RoleKey | null | undefined): boolean {
  return role === 'veli' || role === 'ogrenci'
}

export function purposeLabel(purpose: ConsentPurpose): string {
  return CONSENT_PURPOSES[purpose].label
}

/** Öğrenci amacı `studentId` ister; hesap amacı (tanıtım iletisi) istemez. */
export function purposeNeedsStudent(purpose: ConsentPurpose): boolean {
  return CONSENT_PURPOSES[purpose].subject === 'student'
}

export function purposeOpens(purpose: ConsentPurpose): string {
  return CONSENT_PURPOSES[purpose].opens
}

/** İtiraz yalnız fotoğraf/video amaçlarında ve 18 yaş altı öğrenci içindir (DOM-YTK-062). */
export function isObjectable(purpose: ConsentPurpose): boolean {
  return CONSENT_PURPOSES[purpose].objectable
}

export const STUDENT_PURPOSES: readonly ConsentPurpose[] = (
  Object.keys(CONSENT_PURPOSES) as ConsentPurpose[]
).filter((purpose) => CONSENT_PURPOSES[purpose].subject === 'student')

export const ACCOUNT_PURPOSES: readonly ConsentPurpose[] = (
  Object.keys(CONSENT_PURPOSES) as ConsentPurpose[]
).filter((purpose) => CONSENT_PURPOSES[purpose].subject === 'user')

export type PurposeStep =
  | { purpose: ConsentPurpose; kind: 'valid' }
  | { purpose: ConsentPurpose; kind: 'loading' }
  | { purpose: ConsentPurpose; kind: 'needs-student' }
  | { purpose: ConsentPurpose; kind: 'no-text' }
  | { purpose: ConsentPurpose; kind: 'error' }
  | { purpose: ConsentPurpose; kind: 'choose'; textId: string }

export interface PurposeSource {
  purpose: ConsentPurpose
  /** Güncel metin sorgusunun durumu. */
  text:
    | { state: 'loading' }
    | { state: 'error' }
    | { state: 'missing' }
    | { state: 'ready'; textId: string }
  /** `GET /consents/status` sonucu (henüz gelmediyse `undefined`). */
  status: readonly ConsentStatusView[] | undefined
  studentId: string | undefined
}

/**
 * Amacın ekrandaki durumu. Geçerli rızası olan amaç karar beklemez (mükerrer rıza 409 olurdu);
 * öğrenci amacı öğrencisiz, metni olmayan amaç ve okunamayan veri karar bekletmez ama
 * tamamlanmayı da engellemez.
 */
export function purposeStep(source: PurposeSource): PurposeStep {
  const { purpose } = source
  if (purposeNeedsStudent(purpose) && !source.studentId) return { purpose, kind: 'needs-student' }
  if (source.status === undefined) return { purpose, kind: 'loading' }
  if (source.status.some((item) => item.purpose === purpose && item.valid))
    return { purpose, kind: 'valid' }
  if (source.text.state === 'loading') return { purpose, kind: 'loading' }
  if (source.text.state === 'missing') return { purpose, kind: 'no-text' }
  if (source.text.state === 'error') return { purpose, kind: 'error' }
  return { purpose, kind: 'choose', textId: source.text.textId }
}

export function choosable(steps: readonly PurposeStep[]) {
  return steps.filter((step) => step.kind === 'choose')
}

/** Karar bekleyen her amaç için açık seçim yapıldı mı (hiç karar bekleyen yoksa tamam değil). */
export function isComplete(steps: readonly PurposeStep[], choices: ConsentChoices): boolean {
  const pending = choosable(steps)
  return pending.length > 0 && pending.every((step) => choices[step.purpose] !== undefined)
}

/** Seçim ekler; aynı amacın önceki kararı yerine geçer. */
export function choose(
  choices: ConsentChoices,
  purpose: ConsentPurpose,
  choice: ConsentChoice,
): ConsentChoices {
  return { ...choices, [purpose]: choice }
}

/** Metin güncellenince eski karar geçersizdir: kullanıcı yeni metni okuyup yeniden seçer. */
export function clearChoice(choices: ConsentChoices, purpose: ConsentPurpose): ConsentChoices {
  return withoutPurpose(choices, purpose)
}

/** Amaç anahtarlı kaydın bir amaçsız kopyası (seçim ve uyarı tabloları). */
export function withoutPurpose<T>(
  record: Partial<Record<ConsentPurpose, T>>,
  purpose: ConsentPurpose,
): Partial<Record<ConsentPurpose, T>> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== purpose))
}

export interface SubmitPlan {
  /** Sunucuya yazılacak onaylar, adım sırasıyla. */
  grant: { purpose: ConsentPurpose; textId: string }[]
  /** Açıkça "onaylamıyorum" denen amaçlar: kayıt yazılmaz, yalnız çağırana bildirilir. */
  declined: ConsentPurpose[]
}

export function submitPlan(steps: readonly PurposeStep[], choices: ConsentChoices): SubmitPlan {
  const plan: SubmitPlan = { grant: [], declined: [] }
  for (const step of choosable(steps)) {
    if (choices[step.purpose] === 'granted')
      plan.grant.push({ purpose: step.purpose, textId: step.textId })
    else if (choices[step.purpose] === 'declined') plan.declined.push(step.purpose)
  }
  return plan
}

/** Üst bileşenin (ör. kayıt formu) izlediği durum. */
export interface ConsentStepState {
  /** Oturum rıza verebilir (veli ya da öğrenci). Personelde `false`: adım bilgi gösterir. */
  actionable: boolean
  /** Karar bekleyen her amaç için açık seçim yapıldı. */
  complete: boolean
  choices: ConsentChoices
}
