import { z } from 'zod'
import type {
  CreateStaffSeparationBody,
  StaffSeparationDetail,
  UpdateStaffSeparationBody,
} from '@kampus/react-shared/use-finance-staff-separations.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  SGK_EXIT_CODES,
  SGK_EXIT_CODE_SUGGESTIONS,
  STAFF_SEPARATION_REASONS,
  STAFF_SEPARATION_STEP_LABELS,
  staffSeparationCancelSchema,
  type SgkExitCode,
  type StaffSeparationReason,
  type StaffSeparationStep,
} from '@kampus/school-core/lib/finance-staff-separations.ts'

// İşten ayrılış formlarının ve kontrol listesinin saf mantığı (DOM-FIN-118; ON-180). Doğrulama
// sunucudadır (core şeması); form yalnız boş alanı ve gün sırasını erken söyler. Bileşen bağlar.

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

export type StaffSeparationFormValues = {
  membershipId: string
  separationDate: string
  reason: StaffSeparationReason
  /** Boş: nedenden önerilen kod. */
  sgkExitCode: '' | SgkExitCode
  hireDate: string
  noticeGivenDate: string
  note: string
}

const FORM_FIELDS = [
  'membershipId',
  'separationDate',
  'reason',
  'sgkExitCode',
  'hireDate',
  'noticeGivenDate',
  'note',
] as const satisfies readonly (keyof StaffSeparationFormValues)[]
type FormField = (typeof FORM_FIELDS)[number]

/** Sunucu hatasının yolu forma düşen alansa onu verir; değilse kök hata. */
export function staffSeparationFormField(name: string): FormField | null {
  return (FORM_FIELDS as readonly string[]).includes(name) ? (name as FormField) : null
}

const day = (message: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message)
const optionalDay = z.union([z.literal(''), day('Geçerli bir tarih seçin.')])

/** Açılış ve düzeltme formu; düzeltmede personel alanı doludur ve değişmez. */
export const staffSeparationFormSchema = z
  .object({
    membershipId: z.string().trim().min(1, 'Personel seçin.'),
    separationDate: day('Ayrılış gününü seçin.'),
    reason: z.enum(STAFF_SEPARATION_REASONS, 'Ayrılış nedenini seçin.'),
    sgkExitCode: z.union([z.literal(''), z.enum(SGK_EXIT_CODES)]),
    hireDate: optionalDay,
    noticeGivenDate: optionalDay,
    note: z.string().trim().max(500, 'En fazla 500 karakter girebilirsiniz.'),
  })
  .superRefine((value, context) => {
    if (value.hireDate !== '' && value.hireDate > value.separationDate)
      context.addIssue({
        code: 'custom',
        path: ['hireDate'],
        message: 'İşe giriş günü ayrılış gününden sonra olamaz.',
      })
    if (value.noticeGivenDate !== '' && value.noticeGivenDate > value.separationDate)
      context.addIssue({
        code: 'custom',
        path: ['noticeGivenDate'],
        message: 'Bildirim günü ayrılış gününden sonra olamaz.',
      })
  })

export const staffSeparationCancelFormSchema = staffSeparationCancelSchema

export function emptyStaffSeparationForm(today: string): StaffSeparationFormValues {
  return {
    membershipId: '',
    separationDate: today,
    reason: 'resignation',
    sgkExitCode: '',
    hireDate: '',
    noticeGivenDate: '',
    note: '',
  }
}

/** Personel seçilince işe giriş günü son personel belgesinden önerilir (boşsa). */
export function withHireSuggestion(
  values: StaffSeparationFormValues,
  lastHireDate: string | null,
): StaffSeparationFormValues {
  return values.hireDate === '' && lastHireDate !== null
    ? { ...values, hireDate: lastHireDate }
    : values
}

/** Dosyanın düzeltme formu değerleri. */
export function staffSeparationEditValues(
  separation: Pick<
    StaffSeparationDetail,
    | 'membershipId'
    | 'separationDate'
    | 'reason'
    | 'sgkExitCode'
    | 'hireDate'
    | 'noticeGivenDate'
    | 'note'
  >,
): StaffSeparationFormValues {
  return {
    membershipId: separation.membershipId,
    separationDate: separation.separationDate,
    reason: separation.reason,
    sgkExitCode: separation.sgkExitCode,
    hireDate: separation.hireDate ?? '',
    noticeGivenDate: separation.noticeGivenDate ?? '',
    note: separation.note ?? '',
  }
}

const orNull = (value: string) => (value.trim() === '' ? null : value.trim())

export function staffSeparationBody(values: StaffSeparationFormValues): CreateStaffSeparationBody {
  return {
    membershipId: values.membershipId,
    separationDate: values.separationDate,
    reason: values.reason,
    sgkExitCode: values.sgkExitCode === '' ? null : values.sgkExitCode,
    hireDate: orNull(values.hireDate),
    noticeGivenDate: orNull(values.noticeGivenDate),
    note: orNull(values.note),
  }
}

/**
 * Düzeltme gövdesi: yalnız değişen alanlar. Neden değişip kod önerideyse kod gönderilmez; sunucu
 * yeni nedenin önerisini yazar.
 */
export function staffSeparationUpdateBody(
  initial: StaffSeparationFormValues,
  values: StaffSeparationFormValues,
): UpdateStaffSeparationBody {
  const body: UpdateStaffSeparationBody = {}
  if (values.separationDate !== initial.separationDate) body.separationDate = values.separationDate
  if (values.reason !== initial.reason) body.reason = values.reason
  if (values.sgkExitCode !== '' && values.sgkExitCode !== initial.sgkExitCode)
    body.sgkExitCode = values.sgkExitCode
  if (values.hireDate !== initial.hireDate) body.hireDate = orNull(values.hireDate)
  if (values.noticeGivenDate !== initial.noticeGivenDate)
    body.noticeGivenDate = orNull(values.noticeGivenDate)
  if (values.note.trim() !== initial.note.trim()) body.note = orNull(values.note)
  return body
}

/** Kod alanının boş seçeneği: nedenin önerisi. */
export const suggestedCodeText = (reason: StaffSeparationReason) =>
  `Önerilen (${SGK_EXIT_CODE_SUGGESTIONS[reason]})`

/** Bildirim süresi satırı (K-405); işe giriş günü yoksa `null`. */
export function noticeText(notice: StaffSeparationDetail['notice']): string | null {
  if (notice === null) return null
  const base = `Yasal bildirim süresi ${String(notice.weeks)} hafta`
  if (!notice.applies) return `${base}; bu ayrılış nedeninde bildirim aranmaz.`
  if (notice.noticeEndDate === null) return `${base}; bildirim günü girilmedi.`
  const end = `süre ${dayText(notice.noticeEndDate)} günü doluyor`
  return notice.shortDays > 0
    ? `${base}; ${end}, ayrılış ${String(notice.shortDays)} gün erken (ihbar tazminatına konu olabilir).`
    : `${base}; ${end}.`
}

/** Adımın kısa durum açıklaması (kontrol listesi satırı). */
export function stepDetailText(
  step: StaffSeparationStep,
  detail: Pick<
    StaffSeparationDetail,
    'assets' | 'deductions' | 'leave' | 'accountClosedDate' | 'serviceCertificate'
  >,
): string {
  switch (step) {
    case 'asset_return': {
      const open = detail.assets.filter((asset) => asset.returnDate === null).length
      if (detail.assets.length === 0) return 'Personele zimmetli demirbaş yok.'
      return open === 0
        ? `${String(detail.assets.length)} zimmetin tamamı iade alındı.`
        : `${String(open)} zimmet iade bekliyor.`
    }
    case 'deductions': {
      const { openAdvanceCount, openAdvanceCents, activeGarnishmentCount } = detail.deductions
      if (openAdvanceCount === 0 && activeGarnishmentCount === 0)
        return 'Kesilecek avans ve süren icra yok.'
      const parts = [
        ...(openAdvanceCount > 0 ? [`kesilecek avans ${money(openAdvanceCents)}`] : []),
        ...(activeGarnishmentCount > 0 ? [`${String(activeGarnishmentCount)} süren icra`] : []),
      ]
      return `Uyarı: ${parts.join(', ')}. Son bordroda mahsubu kontrol edin.`
    }
    case 'leave': {
      if (!detail.leave.hasProfile || detail.leave.unusedDays === null)
        return 'İzin bilgisi yok; gün elle hesaplanmalı.'
      return `Kullanılmayan yıllık izin: ${String(detail.leave.unusedDays)} gün${detail.leave.frozen ? ' (dondurulmuş)' : ''}. Ücreti bordroda.`
    }
    case 'severance':
      return 'Kıdem ve ihbar tahmini hesaplayıcıda yapılır; sonuç saklanmaz.'
    case 'account_closure':
      return detail.accountClosedDate === null
        ? 'Hesap açık; Ayarlar > Kullanıcı & Yetkiler sekmesinden pasifleştirin.'
        : `Hesap ${dayText(detail.accountClosedDate)} günü kapatıldı.`
    case 'service_certificate':
      return detail.serviceCertificate === null
        ? 'Hizmet belgesi düzenlenmedi (hesap kapatıldıktan sonra düzenlenir).'
        : `Hizmet belgesi ${detail.serviceCertificate.label} düzenlendi.`
    default:
      return step satisfies never
  }
}

export const stepLabel = (step: StaffSeparationStep) => STAFF_SEPARATION_STEP_LABELS[step]
