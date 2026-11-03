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
  /** Gezinme adı (PascalCase, tek). `ApiHome`, `ApiCategory`, `ApiConversation`, `ApiNotifications` ayrılmıştır. */
  screen: string
  /**
   * Menü sayfasıdır, parametre zorunlu değildir; yalnız bildirimden açılan sekmeli ekranlar isteğe
   * bağlı `tab` alır (`route-types.ts`, `use-route-tab.ts`). Oturumu `useApiSession()` ile okur.
   */
  getComponent: () => MenuScreen
  pages: readonly ScreenPlacement[]
}

// Oğuzhan: platform, akademik ve iletişim
export const OGUZHAN_SCREENS = [
  {
    screen: 'TeacherClasses',
    getComponent: (): MenuScreen => require('./screens/TeacherClasses.tsx').default,
    // Telefonda sınıf listesine ek olarak not girişi ve düzeltmesi vardır (`screens/teacher-grades.tsx`);
    // web'deki not listesi (okuma) telefonda yoktur.
    pages: [
      {
        role: 'ogretmen',
        path: 'siniflarim',
        description: 'Sınıflarınızı görün, notları girin ve düzeltin.',
      },
    ],
  },
  {
    screen: 'ParentTracking',
    getComponent: (): MenuScreen => require('./screens/ParentTracking.tsx').default,
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
  {
    screen: 'TeacherAttendance',
    getComponent: (): MenuScreen => require('./screens/TeacherAttendance.tsx').default,
    // İki sekme: bugünkü yoklamayı alma ve yoklama geçmişi (salt okunur; geçmiş günü yalnız yönetici
    // düzeltir). Devamsızlık bildirimi geçmiş sekmesini `route.params.tab` ile açar.
    pages: [
      {
        role: 'ogretmen',
        path: 'yoklama',
        description: 'Bugünkü yoklamayı alın, yoklama geçmişini görün.',
      },
    ],
  },
  {
    screen: 'StudentQuizzes',
    getComponent: (): MenuScreen => require('./screens/StudentQuizzes.tsx').default,
    // Telefonda sınıf quizleri çözülür (`/quizzes`); soru bankası görevleri, soru sor/çöz ve
    // yazma/konuşma görevleri web'dedir.
    pages: [
      {
        role: 'ogrenci',
        path: 'soru-coz',
        description: 'Sınıf quizlerini çöz, sonuçlarını gör.',
      },
    ],
  },
  {
    screen: 'StudentQuestions',
    getComponent: (): MenuScreen => require('./screens/StudentQuestions.tsx').default,
    // Telefonda soru sorma, yanıtı okuma ve yanıtlanmamış soruyu geri çekme vardır; soru
    // fotoğrafı (DOM-ILT-094) web'dedir.
    pages: [
      {
        role: 'ogrenci',
        path: 'soru-sor',
        description: 'Ders öğretmenine soru sor, yanıtı oku.',
      },
    ],
  },
  {
    screen: 'StudentAppointments',
    getComponent: (): MenuScreen => require('./screens/StudentAppointments.tsx').default,
    // Telefonda öğrenci randevu talep eder, bekleyen talebi geri çeker ve onaylı randevuyu iptal
    // eder; öğretmen ve veli tarafı ayrı adımlardır.
    pages: [
      {
        role: 'ogrenci',
        path: 'randevu-talep',
        description: 'Öğretmenlerinin müsait saatlerinden randevu al.',
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
