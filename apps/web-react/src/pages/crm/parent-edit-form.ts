import { z } from 'zod'
import type { UpdateParentDetailsBody } from '@kampus/react-shared/registration-records.ts'

/**
 * Veli bilgisi düzeltme formu (ON-117, DOM-KAY-012): alanlar metindir; gövdeye yalnız değişen alan
 * girer (sunucu gönderilmeyeni aynı bırakır). Telefon zorunludur, e-posta boş bırakılırsa silinir.
 */
export const parentEditFormSchema = z.object({
  name: z.string().trim().min(1, 'Ad soyad girin.').max(80, 'En fazla 80 karakter girin.'),
  phone: z
    .string()
    .trim()
    .regex(/^0\d{10}$/, 'Telefonu 05XXXXXXXXX biçiminde girin.'),
  email: z.union([
    z.literal(''),
    z.string().trim().toLowerCase().pipe(z.email('Geçerli bir e-posta adresi girin.')),
  ]),
})
export type ParentEditFormValues = z.input<typeof parentEditFormSchema>
export const PARENT_EDIT_FIELDS = ['name', 'phone', 'email'] as const

export const parentEditDefaults = (parent: {
  name: string
  phone?: string | undefined
  email?: string | undefined
}): ParentEditFormValues => ({
  name: parent.name,
  phone: parent.phone ?? '',
  email: parent.email ?? '',
})

/** Değişen alanlardan gövde; hiçbiri değişmediyse `null`. */
export function parentEditBody(
  values: z.output<typeof parentEditFormSchema>,
  current: ParentEditFormValues,
): UpdateParentDetailsBody | null {
  const body: UpdateParentDetailsBody = {}
  if (values.name !== current.name.trim()) body.name = values.name
  if (values.phone !== current.phone.trim()) body.phone = values.phone
  if (values.email !== current.email.trim().toLowerCase()) body.email = values.email
  return Object.keys(body).length === 0 ? null : body
}
