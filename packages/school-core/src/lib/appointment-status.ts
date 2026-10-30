/**
 * Randevu durumları ve takvim etkisi (docs/domain/iletisim-ve-veli.md DOM-ILT-102, -104).
 * Çakışma denetimi (`lib/tutor-conflicts.ts`) ve sınıf/öğretmen düzenlemesi
 * (`lib/school-management.ts`) de bunu kullanır; randevu işlemlerinden (`lib/appointments.ts`)
 * ayrıdır, çünkü o dosya çakışma denetimini içe aktarır.
 */

/** Randevu durumları; ilk ikisi açıktır, diğerleri son durumdur. */
export const APPOINTMENT_STATUSES = [
  'Bekliyor',
  'Onaylandı',
  'Reddedildi',
  'İptal',
  'Geri çekildi',
] as const
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]
/** Zamanı tutan durumlar (DOM-ILT-104); çakışma denetimine yalnız bunlar girer. */
export const APPOINTMENT_HOLDING_STATUSES = [
  'Bekliyor',
  'Onaylandı',
] as const satisfies readonly AppointmentStatus[]
/** Kaydın artık değişmediği durumlar (DOM-ILT-102). */
export const APPOINTMENT_FINAL_STATUSES = [
  'Reddedildi',
  'İptal',
  'Geri çekildi',
] as const satisfies readonly AppointmentStatus[]

const FINAL: ReadonlySet<string> = new Set(APPOINTMENT_FINAL_STATUSES)

/**
 * Randevu zamanı tutuyor mu (DOM-ILT-104). Bilinmeyen durum tutar sayılır: takvimi yanlışlıkla
 * boşaltmak çakışan iki görüşmeye yol açar.
 */
export function appointmentHoldsTime(appointment: { status?: string | undefined }): boolean {
  return appointment.status === undefined || !FINAL.has(appointment.status)
}

/** Randevu son durumda mı; son durumdaki kayıt değişmez (DOM-ILT-102). */
export function appointmentClosed(appointment: { status?: string | undefined }): boolean {
  return appointment.status !== undefined && FINAL.has(appointment.status)
}

/**
 * Günlük programda görünen randevular: yalnız onaylanmışlar (DOM-ILT-104). Bekleyen talep henüz
 * yapılacak görüşme değildir; iptal, red ve geri çekme programdan düşer.
 */
export function scheduledAppointments<T extends { status?: string | undefined }>(
  appointments: readonly T[],
): T[] {
  return appointments.filter((appointment) => appointment.status === 'Onaylandı')
}
