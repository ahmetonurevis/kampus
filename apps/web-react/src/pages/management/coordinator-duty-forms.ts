// Görev atama formunun tanımları (IST-005, DOM-YTK-027): doğrulama çekirdek şemasıdır, sunucu
// kural reddi (öğretmen olmayan üyelik, branş dışı ders, geçersiz seviye, yinelenen görev) ilgili
// alanın altında görünür.
import type { z } from 'zod'
import { coordinatorDutyInputSchema } from '@kampus/school-core/lib/coordinator-duties.ts'

export { coordinatorDutyInputSchema as dutyFormSchema }
export type DutyFormValues = z.input<typeof coordinatorDutyInputSchema>
export type DutyFormOutput = z.output<typeof coordinatorDutyInputSchema>

export const NEW_DUTY = 'yeni'

export const DUTY_FORM_DEFAULTS: DutyFormValues = { membershipId: '', scopeId: '' }

/** Sunucu hata kodunun bağlandığı form alanı; diğer hatalar toast'tur. */
export const DUTY_ERROR_FIELDS = {
  duty_requires_teacher: 'membershipId',
  teacher_record_required: 'membershipId',
  duty_outside_branch: 'scopeId',
  invalid_cefr_level: 'scopeId',
  coordinator_duty_exists: 'scopeId',
} as const satisfies Record<string, keyof DutyFormValues>
