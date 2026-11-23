// Her rolde avatar menüsünde bulunan, menü kaydında olmayan web hesap sayfaları (IST-003).
import type { RoleKey } from './navigation.ts'

export const SECURITY_PATH = 'guvenlik'
export const SECURITY_TITLE = 'Güvenlik'
export const SECURITY_DESCRIPTION =
  'Parolanızı değiştirin ve hesabınızın açık olduğu cihazları yönetin.'

export function securityHref(role: RoleKey): string {
  return `/${role}/${SECURITY_PATH}`
}
