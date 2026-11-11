// Rol kabuğu yönlendirme kararı. Kapsam sunucuda da uygulanır; bu yalnız arayüz davranışıdır.
import {
  findPage,
  isPageAvailable,
  isPageEnabled,
  isRoleKey,
  pageHref,
  type InstitutionType,
  type ModuleState,
  type NavPage,
  type RoleKey,
} from './navigation.ts'
import { workflowPage } from '@kampus/school-core/modules/school-workflows.ts'

type SessionScope = {
  role: RoleKey
  modules: ModuleState
  /** Etkin kurumun türü; verilmezse okul (türe bağlı sayfalar kapalı). */
  institution?: { type: InstitutionType }
}

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
  // Kurum türünde olmayan sayfa (okulda dil okulu kurları) bu kurumda hiç yoktur.
  if (!page || !isPageAvailable(page, session.institution?.type)) return { kind: 'not-found' }
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

/** Öğretmenin öğrenci profili (`/ogretmen/ogrenci/:id`) menüde olmayan sayfadır; modülü `academic`. */
export const STUDENT_PROFILE_PATH = 'ogrenci'
export const STUDENT_PROFILE_TITLE = 'Öğrenci profili'

/**
 * Öğrenci profili kararı: yalnız öğretmen, Sınıflarım (`academic`) açıkken. Başka rol kendi
 * dashboard'una, kapalı modül uyarıyla dashboard'a döner. Öğrencinin öğretmenin kapsamında olup
 * olmadığı sunucudadır: kapsam dışı öğrencinin kaydı 404 döner (DOM-YTK-022).
 */
export function resolveStudentProfile(
  session: SessionScope | null,
  role: string | undefined,
): ShellDecision {
  if (!isRoleKey(role)) return { kind: 'not-found-outside' }
  if (!session) return { kind: 'login' }
  const home = pageHref(session.role, { path: 'dashboard' })
  if (role !== session.role || session.role !== 'ogretmen') return { kind: 'redirect', to: home }
  const listing = findPage('ogretmen', 'siniflarim')
  if (!listing) return { kind: 'not-found' }
  const page: NavPage = {
    ...listing,
    path: STUDENT_PROFILE_PATH,
    title: STUDENT_PROFILE_TITLE,
    description: 'Öğrencinizin akademik gelişimini yakından inceleyin.',
  }
  if (!isPageEnabled(page, session.modules)) return { kind: 'module-closed', to: home, page }
  return { kind: 'page', page }
}

/** Aday detayı (`/<rol>/aday/:id`) menüde olmayan kayıt sayfasıdır; modülü `crm`'dir. */
const PROSPECT_DETAIL_ROLES: readonly RoleKey[] = ['yonetici', 'onburo']
export const PROSPECT_DETAIL_PATH = 'aday'

/**
 * Aday detayı kararı: yalnız yönetici ve ön büro (`prospect.*` yazma yetkisiyle aynı roller),
 * `crm` modülü açıkken. Başka rol kendi dashboard'una, kapalı modül uyarıyla dashboard'a döner;
 * aday kapsamı ve varlığı sunucudadır (başka kurumun adayı 404).
 */
export function resolveProspectDetail(
  session: SessionScope | null,
  role: string | undefined,
): ShellDecision {
  if (!isRoleKey(role)) return { kind: 'not-found-outside' }
  if (!session) return { kind: 'login' }
  const home = pageHref(session.role, { path: 'dashboard' })
  if (role !== session.role || !PROSPECT_DETAIL_ROLES.includes(session.role))
    return { kind: 'redirect', to: home }
  const listing = findPage('onburo', 'adaylar')
  if (!listing) return { kind: 'not-found' }
  const page: NavPage = { ...listing, path: PROSPECT_DETAIL_PATH, title: 'Aday detayı' }
  if (!isPageEnabled(page, session.modules)) return { kind: 'module-closed', to: home, page }
  return { kind: 'page', page }
}
