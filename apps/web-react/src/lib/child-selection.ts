// Velinin görüntülediği çocuk. Seçim yalnız bellekte tutulur (kişisel veri depoya yazılmaz);
// oturum kapanınca görünüm belleğiyle birlikte silinir.
import type { SessionChild } from '../auth/auth-port.ts'

export const CHILD_VIEW_KEY = 'selected-child'

/** Kayıtlı seçim hâlâ bu hesabın çocuğuysa korunur, değilse ilk çocuk; çocuk yoksa boş. */
export function resolveChild(children: readonly SessionChild[], stored: unknown): string {
  if (typeof stored === 'string' && children.some((child) => child.id === stored)) return stored
  return children[0]?.id ?? ''
}

/** Kaydırma ve liste belleği kapsamı: veli için yol + çocuk, diğer rollerde yalnız yol. */
export function childScrollKey(pathname: string, childId: string): string {
  return `scroll:${pathname}:${childId}`
}
