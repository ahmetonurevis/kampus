// Rol kabuğu yönlendirme kararı. Kapsam sunucuda da uygulanır; bu yalnız arayüz davranışıdır.
import {
  findPage,
  isPageEnabled,
  isRoleKey,
  pageHref,
  type ModuleState,
  type NavPage,
  type RoleKey,
} from './navigation.ts'
import { workflowPage } from '@kampus/school-core/modules/school-workflows.ts'

type SessionScope = { role: RoleKey; modules: ModuleState }

export type ShellDecision =
  | { kind: 'not-found-outside' }
  | { kind: 'login' }
  | { kind: 'redirect'; to: string }
  /** Kapalı modülün sayfası; iş akışı sayfaları yönlendirme yerine "kullanıma kapalı" der. */
  | { kind: 'module-closed'; to: string; page: NavPage }
  | { kind: 'not-found' }
  | { kind: 'page'; page: NavPage }

export function resolveShell(
  session: SessionScope | null,
  role: string | undefined,
  path: string | undefined,
): ShellDecision {
  if (!isRoleKey(role)) return { kind: 'not-found-outside' }
  if (!session) return { kind: 'login' }
  const home = pageHref(session.role, { path: 'dashboard' })
  // Başka rolün adresi kendi dashboard'una gider; rol kökü dashboard'a açılır.
  if (role !== session.role || !path) return { kind: 'redirect', to: home }
  const page = findPage(session.role, path)
  if (!page) return { kind: 'not-found' }
  if (!isPageEnabled(page, session.modules)) return { kind: 'module-closed', to: home, page }
  return { kind: 'page', page }
}

/**
 * Kapalı modülün doğrudan adresi: okul iş akışı sayfası kabuk içinde "Modül kullanıma kapalı"
 * der (Vue `SchoolWorkflows.vue`); diğer sayfalar uyarıyla dashboard'a döner.
 */
export function showsClosedNotice(page: Pick<NavPage, 'path'>): boolean {
  return workflowPage(page.path) !== undefined
}
