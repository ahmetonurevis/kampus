// API modunda açılabilen ekranlar. Başlık, simge, kategori ve modül anahtarı ortak menüden
// (`school-core/modules/full-navigation.ts`) gelir; listede olmayan sayfa henüz taşınmamıştır.
import { navigation } from '@kampus/school-core/modules/full-navigation.ts'
import { categoryLabel } from '../model/hub.ts'
import { isModuleOpen, type MemberRole, type MobileSession } from './session-state.ts'

/**
 * API'ye taşınmış modül ekranları (gezinme yığınında parametresiz). Gezinme tipleri bu
 * birleşimden türer (`route-types.ts`); bu dosya React Navigation tiplerine bağlı kalmaz.
 */
export type ApiScreen =
  | 'TeacherClasses'
  | 'ParentGrades'
  | 'StudentGrades'
  | 'StudentHomework'
  | 'Announcements'
  | 'Messages'

/** Rol + sayfa yolu → API'li ekran. Demo ekranlarının API karşılıkları buraya eklenir. */
const MIGRATED: Partial<Record<MemberRole, Partial<Record<string, ApiScreen>>>> = {
  yonetici: { duyurular: 'Announcements' },
  onburo: { duyurular: 'Announcements' },
  ogretmen: { siniflarim: 'TeacherClasses', duyurular: 'Announcements', mesajlar: 'Messages' },
  ogrenci: {
    notlarim: 'StudentGrades',
    odevler: 'StudentHomework',
    duyurular: 'Announcements',
    mesajlar: 'Messages',
  },
  veli: {
    'akademik-takip': 'ParentGrades',
    duyurular: 'Announcements',
    'randevu-mesaj': 'Messages',
  },
}

/**
 * Telefonda iletişim sayfaları web'den dar okunur: yönetici ve ön büro yalnız duyuru okur, mesaj
 * yazmaz; metinler buna göre sadeleşir. Veli sayfası web'de randevu da içerir, telefonda yalnız
 * mesajlar vardır. Öğrenci ödevi telefonda okur; teslim şimdilik web'dedir.
 */
const TITLE_OVERRIDES: Partial<Record<string, { title: string; description: string }>> = {
  'yonetici/duyurular': { title: 'Duyurular', description: 'Kurum duyurularını okuyun.' },
  'onburo/duyurular': { title: 'Duyurular', description: 'Kurum duyurularını okuyun.' },
  'ogretmen/duyurular': { title: 'Duyurular', description: 'Kurumdan haberler ve duyurular.' },
  'veli/randevu-mesaj': { title: 'Mesajlar', description: 'Öğretmeninizle yazışın.' },
  'ogrenci/odevler': {
    title: 'Ödevlerim',
    description: 'Ödevlerini, son tarihlerini ve değerlendirmelerini takip et.',
  },
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
  return navigation[session.role].flatMap((page) => {
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
