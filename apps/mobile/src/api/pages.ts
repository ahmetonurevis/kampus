// API modunda açılabilen ekranlar. Başlık, simge, kategori ve modül anahtarı ortak menüden
// (`school-core/modules/full-navigation.ts`) gelir; listede olmayan sayfa henüz taşınmamıştır.
import { navigation } from '@kampus/school-core/modules/full-navigation.ts'
import { categoryLabel } from '../model/hub.ts'
import { isModuleOpen, type MemberRole, type MobileSession } from './session-state.ts'

/**
 * API'ye taşınmış modül ekranları (gezinme yığınında parametresiz). Gezinme tipleri bu
 * birleşimden türer (`route-types.ts`); bu dosya React Navigation tiplerine bağlı kalmaz.
 */
export type ApiScreen = 'TeacherClasses' | 'ParentGrades' | 'Announcements' | 'Messages'

/** Rol + sayfa yolu → API'li ekran. Demo ekranlarının API karşılıkları buraya eklenir. */
const MIGRATED: Partial<Record<MemberRole, Partial<Record<string, ApiScreen>>>> = {
  yonetici: { duyurular: 'Announcements' },
  onburo: { duyurular: 'Announcements' },
  ogretmen: { siniflarim: 'TeacherClasses', duyurular: 'Announcements', mesajlar: 'Messages' },
  ogrenci: { duyurular: 'Announcements', mesajlar: 'Messages' },
  veli: {
    'akademik-takip': 'ParentGrades',
    duyurular: 'Announcements',
    'randevu-mesaj': 'Messages',
  },
}

type CorePage = (typeof navigation)[MemberRole][number]

const communicationPage = (path: string, title: string, icon: string, description: string) =>
  ({
    path,
    title,
    icon,
    module: 'communication',
    view: 'Communication',
    description,
    group: 'İLETİŞİM',
  }) satisfies CorePage

/**
 * Çekirdek menüsünde yalnız öğrenci ve veli iletişim sayfası taşır; web de aynı boşluğu kendi
 * listesiyle kapatır (`apps/web-react/src/lib/navigation.ts`, TODO(core-nav-communication)).
 * Mobilde mesaj yalnız öğretmen, öğrenci ve veli içindir; yönetici ve ön büro yalnız duyuru görür.
 */
const EXTRA_PAGES: Partial<Record<MemberRole, readonly CorePage[]>> = {
  yonetici: [
    communicationPage('duyurular', 'Duyurular', 'Megaphone', 'Kurum duyurularını okuyun.'),
  ],
  onburo: [communicationPage('duyurular', 'Duyurular', 'Megaphone', 'Kurum duyurularını okuyun.')],
  ogretmen: [
    communicationPage('duyurular', 'Duyurular', 'Megaphone', 'Kurumdan haberler ve duyurular.'),
    communicationPage(
      'mesajlar',
      'Mesajlar',
      'MessagesSquare',
      'Öğrencileriniz ve velileriyle yazışın.',
    ),
  ],
}

/** Veli sayfası web'de randevu da içerir; telefonda yalnız mesajlar vardır. */
const TITLE_OVERRIDES: Partial<Record<string, { title: string; description: string }>> = {
  'veli/randevu-mesaj': { title: 'Mesajlar', description: 'Öğretmeninizle yazışın.' },
}

function rolePages(role: MemberRole): CorePage[] {
  const core = navigation[role]
  const extra = (EXTRA_PAGES[role] ?? []).filter(
    (added) => !core.some((page) => page.path === added.path),
  )
  return [...core, ...extra]
}

export type ApiPage = {
  path: string
  title: string
  icon: string
  description: string
  group: string
  screen: ApiScreen
}

/** Rolün taşınmış ve kurumda açık sayfaları (menü sırası korunur). */
export function apiPages(session: Pick<MobileSession, 'role' | 'modules'>): ApiPage[] {
  const migrated = MIGRATED[session.role] ?? {}
  return rolePages(session.role).flatMap((page) => {
    const screen = migrated[page.path]
    if (!screen || !isModuleOpen(session.modules, page.module)) return []
    const override = TITLE_OVERRIDES[`${session.role}/${page.path}`]
    return [
      {
        path: page.path,
        title: override?.title ?? page.title,
        icon: page.icon,
        description: override?.description ?? page.description,
        group: page.group,
        screen,
      },
    ]
  })
}

export type ApiCategory = { key: string; label: string; icon: string; count: number }

const CATEGORY_ICONS: Record<string, string> = {
  AKADEMİK: 'GraduationCap',
  GELİŞİMİM: 'Award',
  DERSLERİM: 'School',
  İLETİŞİM: 'MessagesSquare',
}

/** Ana ekran kategori kartları: yalnız en az bir açık sayfası olan kategoriler. */
export function apiCategories(pages: readonly ApiPage[]): ApiCategory[] {
  const counts = new Map<string, number>()
  for (const page of pages) counts.set(page.group, (counts.get(page.group) ?? 0) + 1)
  return [...counts].map(([key, count]) => ({
    key,
    label: categoryLabel(key),
    icon: CATEGORY_ICONS[key] ?? 'LayoutGrid',
    count,
  }))
}

/** Ekran hâlâ açık mı (modül kapatıldıysa doğrudan erişim de kapanır). */
export function canOpenScreen(
  session: Pick<MobileSession, 'role' | 'modules'>,
  screen: ApiScreen,
): boolean {
  return apiPages(session).some((page) => page.screen === screen)
}
