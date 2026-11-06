import { z } from 'zod'

import type { State } from '../data/seed.ts'
import { DomainError } from './errors.ts'
import { discountRuleAmount, type FeeDiscount, type FeeDiscountKind } from './fee-tariffs.ts'

/**
 * Referans indirimi hakkı (docs/domain/finans.md DOM-FIN-024; kayit-ve-crm.md DOM-KAY-007; ON-139).
 * Hak yalnız indirim kalemidir: nakit, hediye çeki ya da borçtan bağımsız para iadesi yoktur (vergi
 * sorusu M-08 açık). Satır kesin kayıtta `pending` açılır, referansla gelen öğrencinin ilk taksiti
 * ödenince `available` olur, sonraki sözleşmede bir kez `used` olur. Kullanılmış hak geri istenmez.
 * Kayıt `referral_rewards` tablosundadır, State dışındadır: bu dosya servisin yüklediği satırlarla
 * çalışır. Hakkın değeri kesin kayıt anında o yılın tarifesinden kuruş olarak sabitlenir (K-14) ve
 * sonraki yılların tarifesinden etkilenmez; sözleşmeye uygulanan tutar bundan tavanı aşan kısım
 * düşülerek çıkar (DOM-FIN-021).
 */

export const REFERRAL_REWARD_STATUSES = ['pending', 'available', 'used', 'cancelled'] as const
export type ReferralRewardStatus = (typeof REFERRAL_REWARD_STATUSES)[number]

export const REFERRAL_REWARD_STATUS_LABELS: Readonly<Record<ReferralRewardStatus, string>> = {
  pending: 'İlk taksit bekleniyor',
  available: 'Kullanılabilir',
  used: 'Kullanıldı',
  cancelled: 'İptal edildi',
}

export const REFERRAL_CANCEL_REASONS = [
  /** Referansla gelen öğrenci öğretim başlamadan ayrılıp iade aldı (DOM-FIN-040). */
  'refunded_before_start',
  /** Hak doğmadan, ilk taksit ödenmeden ayrıldı. */
  'withdrawn_before_earned',
] as const
export type ReferralCancelReason = (typeof REFERRAL_CANCEL_REASONS)[number]

export const REFERRAL_CANCEL_REASON_LABELS: Readonly<Record<ReferralCancelReason, string>> = {
  refunded_before_start: 'Öğretim başlamadan iade aldı',
  withdrawn_before_earned: 'İlk taksit ödenmeden ayrıldı',
}

/** Sözleşmede kullanılacak hak; kesin kayıt ve yenileme gövdesinde aynı alan. */
export const referralRewardIdSchema = z.uuid('Referans hakkı geçersiz.')

export interface ReferralRewardDraft {
  prospectId: string
  referrerStudentId: string
  referrerParentId: string
  referredStudentId: string
  academicYear: number
  /** Değerin alındığı tarife. */
  tariffId: string
  /** Kayıt anında sabitlenen hak değeri, kuruş. */
  amountCents: number
}

/** Kullanım denetiminin gerektirdiği alanlar; servis kurum kilidi altında yükler. */
export interface ReferralRewardFacts {
  id: string
  status: ReferralRewardStatus
  referrerParentId: string
  /** Kayıt anında sabitlenen hak değeri, kuruş. */
  amountCents: number
}

/** Referans kalemi hakkın kendi tutarıyla gelir; hak seçilmeden kalem fiyatlanmaz (DOM-FIN-024). */
export function referralRewardRequiredError(): DomainError {
  return new DomainError(
    'referral_reward_required',
    'Referans indirimi için kullanılabilir bir referans hakkı seçin.',
    { path: ['referralRewardId'] },
  )
}

/**
 * Kesin kayıtta açılacak hak; koşul sağlanmıyorsa `null`, kayıt yine de tamamlanır. Veli referansıyla
 * gelmiş olmalı, indirim o yılın tarifesinde ilan edilmiş olmalı, referans veren ile yeni öğrenci
 * aynı aile olmamalıdır: kişi kendi çocuğu için referans olamaz, kardeş kaydı kardeş indirimidir
 * (DOM-FIN-022). Aile yeni veli satırıyla girildiyse kardeş adayı bağı ve velinin telefonu da
 * aynı aileyi gösterir. Değer bu kaydın tarifesinden ve ilan ücretinden sabitlenir (DOM-FIN-020,
 * K-14): oranlı kuralda ilan ücretinin oranı, sabit kuralda tutarın kendisi; sıfır kuruşa düşen hak
 * açılmaz. `applyEnrollment` sonrasındaki State'le çağrılır.
 */
export function referralRewardDraft(
  state: Pick<State, 'prospects' | 'students' | 'parents'>,
  input: {
    prospectId: string
    studentId: string
    academicYear: number
    tariff: { id: string; discounts: readonly FeeDiscount[] }
    /** Bu kaydın ilan ücreti; indirim ve bursla değişmez. */
    grossCents: number
  },
): ReferralRewardDraft | null {
  const prospect = state.prospects.find((item) => item.id === input.prospectId)
  const rule = input.tariff.discounts.find((item) => item.kind === 'referral')
  if (!prospect?.referrerStudentId || !rule) return null
  const parentOf = (id: string | undefined) => state.students.find((s) => s.id === id)?.parentId
  const referrerParentId = parentOf(prospect.referrerStudentId)
  const parentId = parentOf(input.studentId)
  if (!referrerParentId || !parentId || referrerParentId === parentId) return null
  if (parentOf(prospect.siblingOfId) === referrerParentId) return null
  const phoneOf = (id: string) => state.parents.find((item) => item.id === id)?.phone
  const phone = phoneOf(parentId)
  if (phone && phone === phoneOf(referrerParentId)) return null
  const amountCents = discountRuleAmount(rule, input.grossCents)
  if (amountCents <= 0) return null
  return {
    prospectId: prospect.id,
    referrerStudentId: prospect.referrerStudentId,
    referrerParentId,
    referredStudentId: input.studentId,
    academicYear: input.academicYear,
    tariffId: input.tariff.id,
    amountCents,
  }
}

/**
 * `referral` kalemi yalnız kullanılabilir bir hakla seçilir, hak da yalnız sahibinin ailesinin
 * sözleşmesinde kullanılır (DOM-FIN-024). Hak sabit değerini taşısa da kalem kullanıldığı yılın
 * tarifesinde ilan edilmiş olmalıdır; değilse hak denetlenmez, fiyatlama `discount_not_in_tariff`
 * ile reddeder. Dönen hakkın tutarı fiyatlamaya girer, kimliği servisçe aynı işlemde `used` olur.
 */
export function requireUsableReferralReward(request: {
  kinds: readonly FeeDiscountKind[]
  /** Sözleşmenin tarifesindeki indirimler. */
  rules: readonly FeeDiscount[]
  rewardId: string | undefined
  reward: ReferralRewardFacts | null
  /** Sözleşmenin velisi; yeni veliyle kesin kayıtta `null` (henüz hakkı olamaz). */
  ownerParentId: string | null
}): ReferralRewardFacts | null {
  const wanted = request.kinds.includes('referral')
  if (wanted && !request.rules.some((item) => item.kind === 'referral')) return null
  if (request.rewardId === undefined) {
    if (wanted) throw referralRewardRequiredError()
    return null
  }
  if (!wanted)
    throw new DomainError('referral_discount_required', 'Referans indirimini de seçin.', {
      path: ['discounts'],
    })
  const reward = request.reward
  if (reward === null || reward.id !== request.rewardId)
    throw new DomainError('referral_reward_not_found', 'Referans hakkı bulunamadı.', {
      kind: 'not_found',
      path: ['referralRewardId'],
    })
  if (reward.referrerParentId !== request.ownerParentId)
    throw new DomainError(
      'referral_reward_not_owned',
      'Bu referans hakkı yalnız sahibi velinin sözleşmesinde kullanılır.',
      { path: ['referralRewardId'] },
    )
  if (reward.status === 'used')
    throw new DomainError('referral_reward_used', 'Bu referans hakkı daha önce kullanılmış.', {
      kind: 'conflict',
      path: ['referralRewardId'],
    })
  if (reward.status === 'cancelled')
    throw new DomainError('referral_reward_cancelled', 'Bu referans hakkı iptal edilmiş.', {
      path: ['referralRewardId'],
    })
  if (reward.status === 'pending')
    throw new DomainError(
      'referral_reward_not_earned',
      'Referans hakkı henüz doğmadı: referansla gelen kaydın ilk taksiti ödenmemiş.',
      { path: ['referralRewardId'] },
    )
  return reward
}

/** Sözleşmenin referans kalemi: hakkın sabit tutarının tavandan sonra kalanı (DOM-FIN-024). */
export function referralUseOf(
  rewardId: string | null,
  discounts: readonly { kind: FeeDiscountKind; amountCents: number }[],
): { rewardId: string; amountCents: number } | null {
  if (rewardId === null) return null
  const line = discounts.find((item) => item.kind === 'referral')
  return { rewardId, amountCents: line?.amountCents ?? 0 }
}

/**
 * Hakkı doğuran koşul (DOM-FIN-024): referansla gelen kaydın o yılki ilk taksiti ödendi. İlk taksit
 * numarası en küçük olandır; tam bursta öğrenim taksiti olmadığından ek hizmet taksitidir, hiç
 * taksit yoksa hak doğmaz. Yılı olmayan eski taksit o yıla sayılır.
 */
export function isFirstInstallmentPaid(
  invoices: readonly {
    installment: number
    paidAt?: string | null | undefined
    academicYear?: number | undefined
  }[],
  academicYear: number,
): boolean {
  let first: (typeof invoices)[number] | undefined
  for (const invoice of invoices) {
    if (invoice.academicYear !== undefined && invoice.academicYear !== academicYear) continue
    if (first === undefined || invoice.installment < first.installment) first = invoice
  }
  return Boolean(first?.paidAt)
}

/**
 * Referansla gelen öğrencinin ayrılışının hakka etkisi (DOM-FIN-024, DOM-FIN-040). Kullanılmış hak
 * geri istenmez. Öğretim başlamadan iade alan kaydın kullanılmamış hakkı iptal olur; doğmamış hak
 * da ayrılışla kapanır, çünkü taksitler iptal edildiği için koşul artık sağlanamaz. Öğretim
 * başladıktan sonra ya da iadesiz ayrılışta doğmuş hak kalır. İptal edilmesi gerekmiyorsa `null`.
 */
export function referralCancelReason(
  status: ReferralRewardStatus,
  withdrawal: { started: boolean; refundCents: number },
): ReferralCancelReason | null {
  if (status !== 'pending' && status !== 'available') return null
  if (!withdrawal.started && withdrawal.refundCents > 0) return 'refunded_before_start'
  return status === 'pending' ? 'withdrawn_before_earned' : null
}

/**
 * Ayrılışla iptal edilen planlanmış yenilemelerin sözleşmeleri: bu sözleşmeler yürürlüğe girmez,
 * onlarda kullanılmış hak sahibine döner (kullanıldı sayılmaz).
 */
export function cancelledRenewalContractIds(
  state: Pick<State, 'renewals'>,
  studentId: string,
): string[] {
  return state.renewals.flatMap((item) =>
    item.studentId === studentId && item.status === 'İptal' && item.contractId
      ? [item.contractId]
      : [],
  )
}
