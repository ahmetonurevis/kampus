import { z } from 'zod'
import type { State } from '../data/seed.ts'
import { requireAuthorized } from './authorize.ts'
import { requiredText } from './domain.ts'
import { DomainError } from './errors.ts'
import type { Actor } from './scope.ts'

/**
 * Kayıt sonrası veli bilgisi düzeltme (ON-117; KVKK md. 11 düzeltme hakkı, DOM-KAY-012). Veli
 * kaydını kesin kayıt açar; adı, telefonu ve e-postası sonradan yalnız bu komutla düzelir. Yakınlık,
 * velayet ve ödeyici bağı veli kaydında değil veli–öğrenci bağındadır (`student_guardians`,
 * DOM-ILT-070) ve burada değişmez. Gönderilmeyen alan aynı kalır; e-posta boş metinle silinir,
 * telefon silinemez (velinin ulaşılabilir tek kanalıdır, DOM-KAY-012).
 */

export const PARENT_EDITABLE_FIELDS = ['name', 'phone', 'email'] as const
export type ParentEditableField = (typeof PARENT_EDITABLE_FIELDS)[number]

export const updateParentDetailsSchema = z
  .strictObject({
    // kvkk: K
    name: requiredText.max(80).optional(),
    // kvkk: K
    phone: z
      .string()
      .trim()
      .regex(/^0\d{10}$/, 'Telefonu 05XXXXXXXXX biçiminde girin.')
      .optional(),
    // kvkk: K — boş metin e-postayı siler.
    email: z
      .union([z.literal(''), z.email('Geçerli bir e-posta adresi girin.').toLowerCase()])
      .optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Düzeltilecek en az bir bilgi gönderin.',
  })
export type UpdateParentDetailsInput = z.input<typeof updateParentDetailsSchema>

/**
 * Veli kaydını düzeltir; değişen alan adlarını döndürür (denetime yalnız adlar gider). Kayıt yoksa
 * 404 `parent_not_found`, değişiklik yoksa 409 `parent_unchanged`. Reddedilen istekte State değişmez.
 */
export function updateParentDetails(
  state: State,
  actor: Actor,
  parentId: string,
  input: unknown,
): ParentEditableField[] {
  const data = updateParentDetailsSchema.parse(input)
  requireAuthorized(actor, 'parent.update', {}, state)
  const parent = state.parents.find((item) => item.id === parentId)
  if (!parent)
    throw new DomainError('parent_not_found', 'Veli kaydı bulunamadı.', { kind: 'not_found' })
  const current: Record<ParentEditableField, string> = {
    name: parent.name,
    phone: parent.phone ?? '',
    email: parent.email ?? '',
  }
  const changed = PARENT_EDITABLE_FIELDS.filter(
    (field) => data[field] !== undefined && data[field] !== current[field],
  )
  if (changed.length === 0)
    throw new DomainError('parent_unchanged', 'Veli bilgisinde değişiklik yok.', {
      kind: 'conflict',
    })
  if (data.name !== undefined) parent.name = data.name
  if (data.phone !== undefined) parent.phone = data.phone
  if (data.email !== undefined) {
    if (data.email === '') delete parent.email
    else parent.email = data.email
  }
  return changed
}
