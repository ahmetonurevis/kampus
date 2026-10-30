// `GET /api/v1/me` yanıtından arayüz oturumu. Kapsam sunucuda uygulanır; buradaki eşleme yalnız
// menü, yönlendirme ve görünüm içindir.
import type { components } from '@kampus/api-client/schema.d.ts'
import { getRole, moduleKeys, type ModuleState } from '../lib/navigation.ts'
import type { Session, SessionChild } from './auth-port.ts'

export type Me = components['schemas']['Me']

/**
 * school-core modül varsayılanları: örnek kurum verisindeki gibi bütün modüller açık başlar
 * (`createSeed().modules`). Anahtarlar tam navigasyondan gelir; seed'i paketlemeye gerek kalmaz.
 */
export function defaultModules(): Record<string, boolean> {
  return Object.fromEntries(moduleKeys().map((key) => [key, true]))
}

/**
 * Kurum ayarı varsayılanların üzerine yazılır: `/me`'de listelenmeyen modül varsayılanındadır
 * (API sözleşmesi). Navigasyonda olmayan anahtarlar da korunur; sunucu kapatıyorsa kapalıdır.
 */
export function mergeModules(enabled: ModuleState): Record<string, boolean> {
  const merged = defaultModules()
  for (const [key, value] of Object.entries(enabled))
    if (typeof value === 'boolean') merged[key] = value
  return merged
}

/**
 * Etkin kurum ve üyelik yoksa `null` (kullanıcı hiçbir kurumda değil). Veli bağlantıları
 * (`child`) çocuk listesi olur; öğrenci/öğretmen bağlantıları kendi kaydıdır, seçiciye girmez.
 *
 * Yanıt burada yeniden Zod ile ayrıştırılmaz: `Me` tipi sunucunun yanıt şemasından üretilir ve
 * sunucu yanıtı o şemayla serileştirir (`apps/api/src/routes/me.schemas.ts`). Zod'un ilk
 * yüklemeye girmemesi için oturum yolu yalnız tipleri kullanır (ilk JS bütçesi ≤ 200 KB gzip).
 */
export function toSession(me: Me): Session | null {
  const institution = me.activeInstitution
  const membership = me.activeMembership
  if (!institution || !membership) return null
  return {
    user: me.user,
    role: membership.role,
    roleSubtitle: getRole(membership.role).label,
    membershipId: membership.id,
    institution: {
      id: institution.id,
      name: institution.name,
      slug: institution.slug,
      type: institution.type,
    },
    modules: mergeModules(institution.enabledModules),
    children:
      membership.role === 'veli'
        ? membership.links
            .filter((link) => link.kind === 'child')
            .map((link) => ({ id: link.recordId }))
        : [],
    memberships: me.memberships,
  }
}

/** Çocuk seçicide adı olmayan kayıt varsa liste yükleniyor sayılır (ad okuma ucu gelene kadar). */
export function childNamesPending(children: readonly SessionChild[]): boolean {
  return children.some((child) => !child.name)
}
