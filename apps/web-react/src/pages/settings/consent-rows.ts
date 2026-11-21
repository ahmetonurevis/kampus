// Rızalarım bölümünün satır hesapları (IST-017; DOM-YTK-059, -062): API satırı girer, ekran
// satırı çıkar. Saf işlevlerdir; `now` parametrelidir. Rızayı veren kullanıcının kimliği API'den
// veli ve öğrenciye zaten dönmez, burada da hiç taşınmaz (yalnız ilişki: kendisi ya da veli).
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import type { ConsentPurpose } from '@kampus/school-core/lib/consent-purposes.ts'
import type { ConsentStatusView, ConsentView } from '@kampus/react-shared/use-consents.ts'
import type { BadgeTone } from '../../lib/badge-tone.ts'
import { isObjectable, purposeLabel } from '../../components/consent/consent-model.ts'

export interface ConsentRow {
  id: string
  purpose: ConsentPurpose
  label: string
  kind: 'consent' | 'objection'
  kindLabel: 'Rıza' | 'İtiraz'
  statusText: string
  tone: BadgeTone
  givenLabel: string
  expiresLabel: string | null
  withdrawnLabel: string | null
  version: number
  grantor: 'Kendisi' | 'Veli'
  /**
   * Sunucu bu oturuma geri çekme yetkisi veriyor (`canWithdraw`, core `mayWithdrawConsent`;
   * ör. 18 yaş altı öğrenci velinin satırını çekemez) ve satır süresi dolmamış: tek işlemle geri
   * çekilir. Kim çekebilir kuralı burada yeniden yazılmaz.
   */
  canWithdraw: boolean
  /** Geri çekme düğmesinin erişilebilir adı ("… rızasını geri çek"). */
  withdrawName: string
}

const day = (iso: string) => dateLabel(iso, { year: 'numeric' })

/**
 * Satırın durumu. Geri çekilmiş satır hiçbir anda rıza saymaz (DOM-YTK-059); süresi dolan
 * satırın geri çekilecek bir şeyi kalmaz. Açık satır için amacın geçerlilik sonucu (`status`)
 * geçersiz diyorsa (yeni metin, etkin itiraz, yaş) "Geçerli değil" gösterilir.
 */
export function consentRow(
  view: ConsentView,
  now: number,
  status: readonly ConsentStatusView[] | undefined,
): ConsentRow {
  const objection = view.decision === 'objected'
  const expired = view.expiresAt !== null && Date.parse(view.expiresAt) <= now
  const invalid = status?.some((item) => item.purpose === view.purpose && !item.valid) === true
  let statusText: string
  let tone: BadgeTone
  if (view.withdrawnAt !== null) {
    statusText = view.withdrawalReason === 'renewed' ? 'Yenilendi' : 'Geri çekildi'
    tone = 'gray'
  } else if (expired) {
    statusText = 'Süresi doldu'
    tone = 'amber'
  } else if (objection) {
    statusText = 'İtiraz kayıtlı'
    tone = 'amber'
  } else if (invalid) {
    statusText = 'Geçerli değil'
    tone = 'amber'
  } else {
    statusText = 'Geçerli'
    tone = 'green'
  }
  const label = purposeLabel(view.purpose)
  return {
    id: view.id,
    purpose: view.purpose,
    label,
    kind: objection ? 'objection' : 'consent',
    kindLabel: objection ? 'İtiraz' : 'Rıza',
    statusText,
    tone,
    givenLabel: day(view.givenAt),
    expiresLabel: view.expiresAt ? day(view.expiresAt) : null,
    withdrawnLabel: view.withdrawnAt ? day(view.withdrawnAt) : null,
    version: view.textVersion,
    grantor: view.grantorRelation === 'guardian' ? 'Veli' : 'Kendisi',
    canWithdraw: view.canWithdraw && view.withdrawnAt === null && !expired,
    withdrawName: `${label} ${objection ? 'itirazını' : 'rızasını'} geri çek`,
  }
}

/** Yeni kayıt önce; aynı anda verilenlerde amaç adı sırası. */
export function consentRows(
  views: readonly ConsentView[],
  now: number,
  status: readonly ConsentStatusView[] | undefined,
): ConsentRow[] {
  return [...views]
    .sort(
      (a, b) =>
        Date.parse(b.givenAt) - Date.parse(a.givenAt) ||
        purposeLabel(a.purpose).localeCompare(purposeLabel(b.purpose), 'tr'),
    )
    .map((view) => consentRow(view, now, status))
}

/**
 * İtiraz edilebilecek amaçlar (DOM-YTK-062): itiraz edilebilir amaçta, açık ve süresi dolmamış
 * bir rıza var ve açık bir itiraz yok. İtirazın 18 yaş altı öğrenciye ait olduğunu sunucu denetler.
 */
export function objectionCandidates(views: readonly ConsentView[], now: number): ConsentPurpose[] {
  const open = (view: ConsentView) =>
    view.withdrawnAt === null && (view.expiresAt === null || Date.parse(view.expiresAt) > now)
  const purposes = new Set<ConsentPurpose>()
  for (const view of views)
    if (view.decision === 'granted' && open(view) && isObjectable(view.purpose))
      purposes.add(view.purpose)
  for (const view of views)
    if (view.decision === 'objected' && open(view)) purposes.delete(view.purpose)
  return [...purposes]
}

export const WITHDRAW_COPY = {
  consent: {
    title: 'Rızayı geri çek',
    body: (label: string) =>
      `"${label}" için verdiğiniz rıza geri çekilecek. Geri çekme hemen etkili olur; bu rızaya bağlı işlemler durur. Gerekirse sonradan yeniden rıza verebilirsiniz.`,
    confirm: 'Rızayı geri çek',
    done: 'Rızanız geri çekildi.',
  },
  objection: {
    title: 'İtirazı geri çek',
    body: (label: string) =>
      `"${label}" için kayıtlı itirazınız geri çekilecek. Velinizin rızası geçerliyse yeniden etkili olur.`,
    confirm: 'İtirazı geri çek',
    done: 'İtirazınız geri çekildi.',
  },
} as const

export const OBJECTION_COPY = {
  intro:
    '18 yaşından küçükseniz, velinizin verdiği fotoğraf ve video rızasına itiraz edebilirsiniz. İtiraz kayıtlıyken rıza geçersiz sayılır; itirazı istediğiniz zaman geri çekebilirsiniz.',
  title: 'İtiraz et',
  body: (label: string) =>
    `"${label}" için velinizin rızasına itiraz edeceksiniz. İtiraz kayıtlıyken rıza geçersiz sayılır.`,
  done: 'İtirazınız kaydedildi.',
} as const
