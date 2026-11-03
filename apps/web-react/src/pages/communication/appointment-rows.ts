// Randevu satır hesapları web ve mobil için ortaktır; gerçek tanım
// `@kampus/react-shared/appointment-model.ts`'tedir (davranış değişmeden taşındı, IST-124). Yalnız
// liste süzgeci web tablosuna özgüdür (`FilterField`).
import { APPOINTMENT_STATUSES } from '@kampus/school-core/lib/appointment-status.ts'
import {
  APPOINTMENT_TYPES,
  APPOINTMENT_TYPES_BY_ROLE,
} from '@kampus/school-core/lib/appointments.ts'
import type { AppointmentAudience } from '@kampus/react-shared/appointment-model.ts'
import type { FilterField } from '@/lib/list-query.ts'

export {
  STATUS_TONES,
  appointmentActions,
  appointmentLookups,
  appointmentRow,
  appointmentStamp,
  orderAppointments,
  outsideChildScope,
  pendingCount,
  upcomingSchedule,
  type AppointmentAction,
  type AppointmentAudience,
  type AppointmentLookups,
  type AppointmentRow,
  type HistoryRow,
} from '@kampus/react-shared/appointment-model.ts'

/**
 * Liste süzgeçleri: durum ve tür. Seçenekler satırlardan türetilmez, sabittir; böylece süzgeç
 * henüz hiç satırı olmayan bir durumu (ör. "Reddedildi") da seçtirir ve boş sonuç söyler.
 * Öğrenci yalnız kendi seçebildiği türleri (`APPOINTMENT_TYPES_BY_ROLE`), öğretmen ve veli
 * öteki tarafın açtığı türleri de görür.
 */
export function appointmentFilters(audience: AppointmentAudience): FilterField[] {
  const types: readonly string[] =
    audience === 'student' ? APPOINTMENT_TYPES_BY_ROLE.ogrenci : APPOINTMENT_TYPES
  return [
    {
      key: 'status',
      label: 'Durum',
      options: APPOINTMENT_STATUSES.map((value) => ({ value, label: value })),
    },
    { key: 'type', label: 'Tür', options: types.map((value) => ({ value, label: value })) },
  ]
}
