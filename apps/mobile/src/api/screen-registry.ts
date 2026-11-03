// Mobil API modu ekran kaydı (web `apps/web-react/src/pages/page-registry.tsx` eşi, sahip blokları,
// git-ve-surum §7.6). Ortak dosya önerisi #25; onaya kadar Oğuzhan'ındır. Her kayıt bir gezinme ekranıdır: ekran adı, bileşen ve ekranın
// açıldığı rol + ortak menü yolları (`school-core/modules/full-navigation.ts`). Menü kartı, kategori,
// yığın kaydı (`ApiApp.tsx`) ve `ApiScreen` tipi yalnız bu listeden türer; ikinci liste yoktur.
//
// Dosya `.tsx` değil `.ts`'tir: kök birim testleri (`tests/mobile-screen-registry.test.ts`) kaydı
// Node'da okur. Bileşen `getComponent` ile ilk açılışta, ekranın hata sınırı içinde yüklenir
// (`registered-screen.tsx`); kayıt böylece React Native'e bağlanmadan sınanır. Dosyanın var olduğu
// ve varsayılan bileşen dışa aktardığı testte `getComponent` kaynağından denetlenir (kök tip
// denetimi `.tsx` okumaz).
//
// Kurallar (`screenRegistryIssues`, testte denetlenir): ekran adı tek; bir rol + yol yalnız bir
// ekrana bağlanır; yol o rolün ortak menüsünde bulunur; öğrenciye ödeme (`finance` modülü) ekranı
// kaydedilmez (öğrenci ödemeleri telefonda gösterilmez). Kapalı modül kartı ve ekranı `pages.ts`
// kapatır; ekran yine `canOpenScreen(session, '<Ekran>')` ile "Modül kullanıma kapalı" gösterir.
import type { ComponentType } from 'react'
import type { MemberRole } from './session-state.ts'

/** Ekranın açıldığı menü sayfası; başlık/açıklama telefonda kısalacaksa geçersiz kılınır. */
export type ScreenPlacement = {
  role: MemberRole
  /** Ortak menü yolu (`navigation[role][].path`). */
  path: string
  title?: string
  description?: string
}

/** Menü ekranı bileşeni; dönüş tipi açık yazılır ki kayıt tipi ekran dosyalarına döngüyle bağlanmasın. */
export type MenuScreen = ComponentType<never>

export type ScreenEntry = {
  /** Gezinme adı (PascalCase, tek). `ApiHome`, `ApiCategory`, `ApiConversation` ayrılmıştır. */
  screen: string
  /** Menü sayfası olduğundan parametre almaz; oturumu `useApiSession()` ile okur. */
  getComponent: () => MenuScreen
  pages: readonly ScreenPlacement[]
}

// Oğuzhan: platform, akademik ve iletişim
export const OGUZHAN_SCREENS = [
  {
    screen: 'TeacherClasses',
    getComponent: (): MenuScreen => require('./screens/TeacherClasses.tsx').default,
    pages: [{ role: 'ogretmen', path: 'siniflarim' }],
  },
  {
    screen: 'ParentGrades',
    getComponent: (): MenuScreen => require('./screens/ParentGrades.tsx').default,
    pages: [{ role: 'veli', path: 'akademik-takip' }],
  },
  {
    screen: 'StudentGrades',
    getComponent: (): MenuScreen => require('./screens/StudentGrades.tsx').default,
    pages: [{ role: 'ogrenci', path: 'notlarim' }],
  },
  {
    screen: 'StudentHomework',
    getComponent: (): MenuScreen => require('./screens/StudentHomework.tsx').default,
    // Öğrenci ödevi telefonda okur; teslim şimdilik web'dedir.
    pages: [
      {
        role: 'ogrenci',
        path: 'odevler',
        title: 'Ödevlerim',
        description: 'Ödevlerini, son tarihlerini ve değerlendirmelerini takip et.',
      },
    ],
  },
  {
    screen: 'Announcements',
    getComponent: (): MenuScreen => require('./screens/Announcements.tsx').default,
    // Telefonda yönetici ve ön büro yalnız duyuru okur, yayın web'dedir; metinler buna göre sadedir.
    pages: [
      {
        role: 'yonetici',
        path: 'duyurular',
        title: 'Duyurular',
        description: 'Kurum duyurularını okuyun.',
      },
      {
        role: 'onburo',
        path: 'duyurular',
        title: 'Duyurular',
        description: 'Kurum duyurularını okuyun.',
      },
      {
        role: 'ogretmen',
        path: 'duyurular',
        title: 'Duyurular',
        description: 'Kurumdan haberler ve duyurular.',
      },
      { role: 'ogrenci', path: 'duyurular' },
      { role: 'veli', path: 'duyurular' },
    ],
  },
  {
    screen: 'Messages',
    getComponent: (): MenuScreen => require('./screens/Messages.tsx').default,
    // Mesaj yalnız öğretmen/öğrenci/veli içindir. Veli sayfası web'de randevu da içerir, telefonda
    // yalnız mesajlar vardır.
    pages: [
      { role: 'ogretmen', path: 'mesajlar' },
      { role: 'ogrenci', path: 'mesajlar' },
      {
        role: 'veli',
        path: 'randevu-mesaj',
        title: 'Mesajlar',
        description: 'Öğretmeninizle yazışın.',
      },
    ],
  },
] as const satisfies readonly ScreenEntry[]
// Oğuzhan: platform, akademik ve iletişim sonu

// Onur: kayıt ve finans
// Ortak dosya önerisi #25; onaya kadar Onur kayıt satırını `sahip:oguzhan` issue'suyla ister, biz
// ekleriz. Yeni ekran bu dizinin sonuna eklenir. Ekran dosyası küçük harfli ve Onur'un alan kalıbına
// uyan adla yazılır (`screens/finance-parent.tsx` → `**/finance*`, `screens/contract-approval.tsx`
// → `**/contract*`; `ParentFinance.tsx` kalıba uymaz) ve `export default function` bileşen verir.
// Örnek:
//
//   {
//     screen: 'ParentFinance',
//     getComponent: (): MenuScreen => require('./screens/finance-parent.tsx').default,
//     pages: [{ role: 'veli', path: 'finans' }],
//   },
//
// Ekran kabuk yardımcılarını `./shell.ts`'ten alır (oturum, `canOpenScreen`, seçili çocuk, liste
// belleği, toast). Öğrenciye (`ogrenci`) ödeme ekranı kaydedilmez; test reddeder.
export const ONUR_SCREENS = [] as const satisfies readonly ScreenEntry[]
// Onur: kayıt ve finans sonu

/** Bütün kayıtlar (önce Oğuzhan, sonra Onur bloğu). */
export const SCREEN_REGISTRY = [...OGUZHAN_SCREENS, ...ONUR_SCREENS] as const

/** API'ye taşınmış menü ekranlarının adları; gezinme tipleri bundan türer (`route-types.ts`). */
export type ApiScreen = (typeof SCREEN_REGISTRY)[number]['screen']
