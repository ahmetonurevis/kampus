import { z } from 'zod'

import { DomainError } from './errors.ts'
import type { Scope } from './scope.ts'

/**
 * Velinin iletişim bilgisi (telefon, e-posta; kvkk: K) ve öğretmene maskeli gösterimi
 * (DOM-YTK-055, docs/domain/yetki-ve-kapsam.md).
 *
 * - Öğrenciye ders veren öğretmen (sınıfında branş dersi ya da sınıf rehberliği olan) o öğrencinin
 *   velisinin telefonunu ve e-postasını listede maskeli görür (`maskPhone`, `maskEmail`; maskeleme
 *   `lib/scope.ts` alan ayıklamasındadır).
 * - Tam değer yalnız ayrı "Göster" işlemiyle (`revealParentContact`) ve alan başına döner; çağıran
 *   (API) her açılışı değer yazmadan denetim kaydına yazar (DOM-YTK-052).
 * - Yönetici ve ön büro tam değeri görür (değişmedi); öğrenci ve veli hiçbir velinin iletişim
 *   bilgisini görmez (DOM-YTK-024, DOM-ILT-073).
 *
 * Saf modüldür: kapsam `scopeFor` sonucundan, veli satırı çağıranın yüklediği kayıttan gelir.
 */

export const PARENT_CONTACT_FIELDS = ['phone', 'email'] as const
export type ParentContactField = (typeof PARENT_CONTACT_FIELDS)[number]

/** "Göster" girdisi: hangi öğrencinin velisinin hangi alanı. Öğrenci kimliği kapsamla denetlenir. */
export const revealParentContactSchema = z.strictObject({
  studentId: z.string('Öğrenciyi seçin.').trim().min(1, 'Öğrenciyi seçin.').max(128),
  field: z.enum(PARENT_CONTACT_FIELDS, 'Gösterilecek alan telefon veya e-posta olmalıdır.'),
})
export type RevealParentContactInput = z.infer<typeof revealParentContactSchema>

/** Açılan değer; istemcide yalnız bellekte tutulur (kalıcı depo, adres ve log yok). */
export type RevealedParentContact = {
  parentId: string
  studentId: string
  field: ParentContactField
  value: string
}

const MASK = '***'

/**
 * Telefon maskesi: ilk dört ve son iki hane görünür (`0532 *** ** 12`). `+90`/`90` önekli ve
 * baştaki sıfırı olmayan 10 haneli GSM numarası önce `0` ile başlayan 11 haneye çevrilir; kısa
 * değerde hane gösterilmez.
 */
export function maskPhone(value: string): string {
  let digits = value.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('90')) digits = `0${digits.slice(2)}`
  else if (digits.length === 10 && digits.startsWith('5')) digits = `0${digits}`
  if (digits.length >= 10) return `${digits.slice(0, 4)} ${MASK} ** ${digits.slice(-2)}`
  return digits.length >= 6 ? `${MASK} ** ${digits.slice(-2)}` : MASK
}

/** E-posta maskesi: yerel bölümün ilk harfi ve alan adı görünür (`a***@gmail.com`). */
export function maskEmail(value: string): string {
  const at = value.lastIndexOf('@')
  if (at < 0) return MASK
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  return `${local.slice(0, 1)}${MASK}@${domain}`
}

const MASKERS: Record<ParentContactField, (value: string) => string> = {
  phone: maskPhone,
  email: maskEmail,
}

/** Veli satırının iletişim alanları maskelenmiş kopyası; diğer alanlar ve eksik alan aynen kalır. */
export function maskParentContact<T extends Record<string, unknown>>(row: T): T {
  const copy: Record<string, unknown> = { ...row }
  for (const field of PARENT_CONTACT_FIELDS) {
    const value = copy[field]
    if (typeof value === 'string' && value !== '') copy[field] = MASKERS[field](value)
  }
  return copy as T
}

export type ParentContactDenial = {
  code: string
  message: string
  kind: 'forbidden' | 'not_found' | 'rule'
  rule: string
}

const NOT_FOUND: ParentContactDenial = {
  code: 'parent_not_found',
  message: 'Veli bulunamadı.',
  kind: 'not_found',
  rule: 'DOM-YTK-055',
}

/** Kapsam kararı için gereken veli alanları (API'den gelen JSON da olabilir). */
export type ParentContactRecord = { id: string; studentIds?: unknown; [key: string]: unknown }

/**
 * "Göster" kararı (DOM-YTK-055): yalnız öğretmen, yalnız ders verdiği öğrencinin (`scope.studentIds`)
 * o öğrenciye bağlı velisi için. Kapsam dışı öğrenci, öğrenciye bağlı olmayan veli ve olmayan
 * veli aynı 404'tür; kaydın varlığı sızmaz (DOM-YTK-011). Yönetici ve ön büro tam değeri listede
 * zaten görür, öğrenci ve veli hiç görmez: ikisi de 403.
 */
export function parentContactDecision(
  scope: Pick<Scope, 'actor' | 'teacher' | 'studentIds'>,
  parent: ParentContactRecord | undefined,
  input: RevealParentContactInput,
): ParentContactDenial | null {
  if (scope.actor.role !== 'ogretmen')
    return {
      code: 'permission_denied',
      message: 'Bu işlem için yetkiniz bulunmuyor.',
      kind: 'forbidden',
      rule: 'DOM-YTK-055',
    }
  if (!scope.teacher || !scope.studentIds.has(input.studentId) || !parent) return NOT_FOUND
  const linked = Array.isArray(parent.studentIds) && parent.studentIds.includes(input.studentId)
  if (!linked) return NOT_FOUND
  const value = parent[input.field]
  if (typeof value !== 'string' || value === '')
    return {
      code: 'parent_contact_missing',
      message:
        input.field === 'phone'
          ? 'Velinin kayıtlı telefonu bulunmuyor.'
          : 'Velinin kayıtlı e-postası bulunmuyor.',
      kind: 'rule',
      rule: 'DOM-YTK-055',
    }
  return null
}

/**
 * Tam değeri döndürür; ret `DomainError`'dur. Girdi Zod ile doğrulanır (400). Değeri yalnız
 * çağıran denetim kaydını yazdıktan sonra istemciye verir; denetim kaydına değer yazılmaz.
 */
export function revealParentContact(
  scope: Pick<Scope, 'actor' | 'teacher' | 'studentIds'>,
  parent: ParentContactRecord | undefined,
  input: unknown,
): RevealedParentContact {
  const data = revealParentContactSchema.parse(input)
  const denial = parentContactDecision(scope, parent, data)
  if (denial) throw new DomainError(denial.code, denial.message, { kind: denial.kind })
  // Karar velinin var olduğunu ve alanın dolu metin olduğunu doğruladı; tip için yeniden daraltılır.
  const value = parent?.[data.field]
  if (!parent || typeof value !== 'string')
    throw new DomainError(NOT_FOUND.code, NOT_FOUND.message, { kind: NOT_FOUND.kind })
  return { parentId: parent.id, studentId: data.studentId, field: data.field, value }
}
