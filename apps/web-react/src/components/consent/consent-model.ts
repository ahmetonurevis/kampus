// Açık rıza adımının modeli (IST-017; DOM-YTK-057…062, guvenlik-kvkk §9): kim işlem yapar, hangi
// amaçlar karar bekler, seçimler tamam mı ve gönderim planı. Saf işlevlerdir; metin, satır ve
// geçerlilik sunucudadır (`@kampus/react-shared/use-consents.ts`). Rıza varsayılan değildir:
// hiçbir amaç önceden seçili gelmez.
import { CONSENT_PURPOSES, type ConsentPurpose } from '@kampus/school-core/lib/consent-purposes.ts'
import type { ConsentStatusView } from '@kampus/react-shared/use-consents.ts'
import type { RoleKey } from '../../lib/navigation.ts'

/** Kullanıcının açık kararı; "declined" sunucuya yazılmaz (rıza yokluğu kayıt gerektirmez). */
export type ConsentChoice = 'granted' | 'declined'
/**
 * Karar, okunan metne bağlıdır (KVKK: rıza belirli metne verilir). Gösterilen metin sürümü
 * (`textId`) değişince eski karar sayılmaz ve kullanıcıya yeniden sorulur.
 */
export interface PurposeChoice {
  textId: string
  choice: ConsentChoice
}
export type ConsentChoices = Partial<Record<ConsentPurpose, PurposeChoice>>

export const CHOICE_LABELS = {
  granted: 'Onaylıyorum',
  declined: 'Onaylamıyorum',
} as const satisfies Record<ConsentChoice, string>

/** Personele gösterilen bilgi: API personele rıza vermeyi 403 ile reddeder (DOM-YTK-057). */
export const STAFF_CONSENT_INFO = 'Rızayı veli ya da öğrenci kendi hesabından verir.'
export const DECLINE_NOTE =
  'Rıza vermemek temel eğitim hizmetini etkilemez. Rızanızı istediğiniz zaman geri çekebilirsiniz.'
export const STUDENT_REQUIRED_INFO = 'Bu rıza öğrenci seçilmeden istenemez.'
export const NO_TEXT_INFO = 'Rıza metni henüz yayımlanmadığı için şu amaçlarda rıza alınamıyor:'
export const OUTDATED_NOTICE =
  'Rıza metni güncellendi. Güncel metni okuyup kararınızı yeniden verin.'
export const GUARDIAN_GIVES_INFO = 'Rızayı veliniz verir.'
export const ADULT_SELF_INFO = 'Öğrenci 18 yaşını doldurduğu için rızayı kendisi verir.'
export const MINOR_ACCOUNT_INFO = 'Bu rıza 18 yaşından küçük öğrenciden alınmaz.'

/** Yalnız veli ve öğrenci rıza verir; personel (yönetici, ön büro, öğretmen) veremez. */
export function canActOnConsent(role: RoleKey | null | undefined): role is ConsentActorRole {
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
  /** Rızayı bu oturum değil başkası verir (veli ya da reşit öğrenci); bilgi gösterilir. */
  | { purpose: ConsentPurpose; kind: 'other-grantor'; info: string }
  | { purpose: ConsentPurpose; kind: 'choose'; textId: string }

/** Rıza verebilen oturum rolü (`canActOnConsent`). */
export type ConsentActorRole = 'veli' | 'ogrenci'

export interface PurposeSource {
  purpose: ConsentPurpose
  /** Oturumun rolü: sunucunun `grantor` sonucuyla karşılaştırılır. */
  actor: ConsentActorRole
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
 * Bu oturum amaçta rıza veremiyorsa gösterilecek bilgi, verebiliyorsa `null` (DOM-YTK-057).
 * Kimin verdiği (`grantor`) sunucuda core `consentGrantor` ile yaştan hesaplanır; burada yalnız
 * oturum rolüyle eşlenir, yaş tahmin edilmez. Öğrenci amacında veli `guardian`, öğrenci `self`
 * satırında verir; hesap amacında hesap sahibi (`self`) verir, `null` alınmaz demektir.
 * `grantor` gelmediyse (eski yanıt) karar sunucuya bırakılır.
 */
export function grantorInfo(
  actor: ConsentActorRole,
  purpose: ConsentPurpose,
  grantor: ConsentStatusView['grantor'],
): string | null {
  if (grantor === undefined) return null
  if (grantor === null) return MINOR_ACCOUNT_INFO
  if (!purposeNeedsStudent(purpose)) return null
  if (actor === 'ogrenci' && grantor === 'guardian') return GUARDIAN_GIVES_INFO
  if (actor === 'veli' && grantor === 'self') return ADULT_SELF_INFO
  return null
}

/**
 * Amacın ekrandaki durumu. Geçerli rızası olan amaç karar beklemez (mükerrer rıza 409 olurdu);
 * rızayı başkasının verdiği amaç bilgi gösterir; öğrenci amacı öğrencisiz, metni olmayan amaç ve
 * okunamayan veri karar bekletmez.
 */
export function purposeStep(source: PurposeSource): PurposeStep {
  const { purpose } = source
  if (purposeNeedsStudent(purpose) && !source.studentId) return { purpose, kind: 'needs-student' }
  if (source.status === undefined) return { purpose, kind: 'loading' }
  const status = source.status.find((item) => item.purpose === purpose)
  if (status?.valid) return { purpose, kind: 'valid' }
  const info = grantorInfo(source.actor, purpose, status?.grantor)
  if (info !== null) return { purpose, kind: 'other-grantor', info }
  if (source.text.state === 'loading') return { purpose, kind: 'loading' }
  if (source.text.state === 'missing') return { purpose, kind: 'no-text' }
  if (source.text.state === 'error') return { purpose, kind: 'error' }
  return { purpose, kind: 'choose', textId: source.text.textId }
}

export function choosable(steps: readonly PurposeStep[]) {
  return steps.filter((step) => step.kind === 'choose')
}

/**
 * Amacın geçerli kararı: yalnız ekrandaki metin sürümüne verilmişse. Metin sessizce tazelenince
 * (başka sekmede yeni sürüm yayımlandı) eski karar burada düşer; kullanıcıya yeniden sorulur.
 */
export function choiceFor(step: PurposeStep, choices: ConsentChoices): ConsentChoice | undefined {
  if (step.kind !== 'choose') return undefined
  const stored = choices[step.purpose]
  return stored?.textId === step.textId ? stored.choice : undefined
}

/** Karar eski metin sürümüne verilmiş (metin değişti): kullanıcı yeniden karar vermeli. */
export function isStale(step: PurposeStep, choices: ConsentChoices): boolean {
  const stored = choices[step.purpose]
  return step.kind === 'choose' && stored !== undefined && stored.textId !== step.textId
}

/**
 * Adım tamam mı: hiçbir amaç yüklenmiyor ya da hata vermiyor ve karar bekleyen her amaç için
 * ekrandaki metne açık seçim yapıldı. Karar bekleyen amaç yoksa (hepsi geçerli, metni yok ya da
 * rızayı başkası verir) adım da tamamdır: form ilerleyebilir.
 */
export function isComplete(steps: readonly PurposeStep[], choices: ConsentChoices): boolean {
  if (steps.some((step) => step.kind === 'loading' || step.kind === 'error')) return false
  return choosable(steps).every((step) => choiceFor(step, choices) !== undefined)
}

/** Her amaç zaten geçerli rızalı: sorulacak bir şey yok (`onComplete` kendiliğinden çağrılır). */
export function allGranted(steps: readonly PurposeStep[]): boolean {
  return steps.length > 0 && steps.every((step) => step.kind === 'valid')
}

/** Seçim ekler; aynı amacın önceki kararı yerine geçer. */
export function choose(
  choices: ConsentChoices,
  purpose: ConsentPurpose,
  textId: string,
  choice: ConsentChoice,
): ConsentChoices {
  return { ...choices, [purpose]: { textId, choice } }
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

/** Yalnız ekrandaki metne verilmiş kararlar gönderilir; eski sürüme verilen karar yok sayılır. */
export function submitPlan(steps: readonly PurposeStep[], choices: ConsentChoices): SubmitPlan {
  const plan: SubmitPlan = { grant: [], declined: [] }
  for (const step of choosable(steps)) {
    const choice = choiceFor(step, choices)
    if (choice === 'granted') plan.grant.push({ purpose: step.purpose, textId: step.textId })
    else if (choice === 'declined') plan.declined.push(step.purpose)
  }
  return plan
}

/** Üst bileşenin (ör. kayıt formu) izlediği durum. */
export interface ConsentStepState {
  /**
   * Oturum rıza verebilir (veli ya da öğrenci). Personelde `false`: adım bilgi gösterir, hiç
   * tamamlanmaz; çağıran adımı atlar.
   */
  actionable: boolean
  /** `isComplete`: karar bekleyen her amaç için ekrandaki metne açık seçim yapıldı ya da bekleyen yok. */
  complete: boolean
  /** Ekrandaki metne verilmiş kararlar (eski sürüme verilenler yok). */
  choices: Partial<Record<ConsentPurpose, ConsentChoice>>
  /** Amaç başına ekran durumu (`PurposeStep['kind']`), ör. hepsi `valid` ise sorulacak yok. */
  steps: Partial<Record<ConsentPurpose, PurposeStep['kind']>>
}

/** Adımın üst bileşene bildirilen durumu (`onChange`); saf, testte de aynısı kullanılır. */
export function stepState(
  actionable: boolean,
  steps: readonly PurposeStep[],
  choices: ConsentChoices,
): ConsentStepState {
  const effective: Partial<Record<ConsentPurpose, ConsentChoice>> = {}
  const kinds: Partial<Record<ConsentPurpose, PurposeStep['kind']>> = {}
  for (const step of steps) {
    kinds[step.purpose] = step.kind
    const choice = choiceFor(step, choices)
    if (choice !== undefined) effective[step.purpose] = choice
  }
  return {
    actionable,
    complete: actionable && isComplete(steps, choices),
    choices: effective,
    steps: kinds,
  }
}

/**
 * Adımın kimliği: öğrenci ya da amaç listesi değişince seçimler sıfırlanır (bileşen `key`'i).
 * Başka öğrencinin ya da amacın kararı taşınmaz.
 */
export function stepKey(studentId: string | undefined, purposes: readonly ConsentPurpose[]) {
  return `${studentId ?? ''}|${purposes.join(',')}`
}
