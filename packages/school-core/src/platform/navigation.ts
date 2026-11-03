import type { NavigationPage } from '../modules/full-navigation.ts'
import type { Role } from '../modules/navigation.ts'

/**
 * Platform menü sayfaları: temel menüde olmayan, yalnız API'li yüzeylerde (yeni web, mobil) açılan
 * iletişim ve içerik havuzu sayfaları. Yerleştirme (hangi kategorinin yanına gireceği) ve okul iş
 * akışı modülleri `modules/full-navigation.ts`'te birleşir.
 */

const communicationPage = (
  path: string,
  title: string,
  icon: string,
  description: string,
): NavigationPage => ({
  path,
  title,
  icon,
  module: 'communication',
  view: 'Communication',
  description,
  group: 'İLETİŞİM',
  apiOnly: true,
})

// Dijital veli onayı (IST-067, DOM-ILT-030…039): modül `communication`. Yönetici ve rehber
// öğretmen form açar ve izler, veli çocuğu için, yetişkin öğrenci kendisi için karar verir; ön büro
// görmez. Öğrenci sayfası kurum türüne bağlı değildir: 18 yaşını dolduran öğrenci okulda da vardır,
// 18 yaş altı öğrenci yalnız durumu görür. Vue demosunun ve mobilin karşılığı yoktur (`apiOnly`).
const permissionFormsPage = (title: string, description: string): NavigationPage =>
  communicationPage('izin-formlari', title, 'FileCheck', description)

// Temel menüde olmayan iletişim sayfaları (öğrenci ve veli için temel menüde zaten vardır). Hesap
// grubu varsa ondan önce, yoksa sona eklenir; yönetici ve ön büro mesajı yalnız yeni web açar,
// mobil bunlardan yalnız kendi taşıdığı sayfaları gösterir.
export const API_COMMUNICATION_PAGES: Record<Role, readonly NavigationPage[]> = {
  yonetici: [
    communicationPage(
      'duyurular',
      'Duyurular',
      'Megaphone',
      'Kurum duyurularını yayınlayın ve izleyin.',
    ),
    communicationPage(
      'mesajlar',
      'Mesajlar',
      'MessagesSquare',
      'Öğrenci–öğretmen yazışmalarının üst verisini görün; içeriği gerekçeyle açın.',
    ),
    permissionFormsPage(
      'İzin Formları',
      'Gezi ve etkinlik izin formu açın; velilerin onayını izleyin.',
    ),
  ],
  onburo: [
    communicationPage(
      'duyurular',
      'Duyurular',
      'Megaphone',
      'İdari duyuruları yayınlayın ve izleyin.',
    ),
  ],
  ogretmen: [
    communicationPage('duyurular', 'Duyurular', 'Megaphone', 'Sınıflarınıza duyuru yayınlayın.'),
    communicationPage(
      'mesajlar',
      'Mesajlar',
      'MessagesSquare',
      'Öğrencileriniz ve velileriyle yazışın.',
    ),
    permissionFormsPage(
      'İzin Formları',
      'Rehber olduğunuz sınıflar için izin formu açın; onay durumunu izleyin.',
    ),
  ],
  ogrenci: [
    permissionFormsPage(
      'İzin Formlarım',
      '18 yaşını doldurduysanız izin formlarına kendiniz karar verirsiniz; değilseniz velinizin kararını burada izlersiniz.',
    ),
  ],
  veli: [
    permissionFormsPage(
      'Onay Bekleyenler',
      'Okulun çocuğunuz için istediği izinleri onaylayın ya da reddedin.',
    ),
  ],
}

// İçerik havuzu (ADR 0004, docs/domain/kaynak-platformu.md): yalnız içerik personeli (yönetici,
// öğretmen; DOM-YTK-021). Öğrenci ve veli içeriği paylaşım ve atamayla görür, ön büro görmez.
// Sayfa kendi kategorisinin (`group`) sonuna girer.
// Vue demosunun karşılığı yoktur; mobil API menüsü yalnız taşıdığı sayfaları gösterir.
const contentPoolPage = (description: string): NavigationPage => ({
  path: 'icerik-havuzu',
  title: 'İçerik Havuzu',
  icon: 'Library',
  module: 'learning',
  view: 'ContentPool',
  description,
  group: 'ÖĞRENME',
  apiOnly: true,
})

// Rubrik kütüphanesi (OG-083; IST-048, DOM-BEC-020, DOM-BEC-022): kurumun ortak rubrikleri tek
// listede; aynı rubrik birçok görevde kullanılır, bu yüzden tek göreve bağlı Ödevler sekmesi değil
// içerik havuzunun yanında ayrı sayfadır. Uçlar yalnız içerik personeline (yönetici, öğretmen;
// koordinatör öğretmen rolündedir) açıktır; modül `learning` kapalıysa menüden ve rotadan kalkar.
const rubricLibraryPage = (description: string): NavigationPage => ({
  path: 'rubrik-kutuphanesi',
  title: 'Rubrik Kütüphanesi',
  icon: 'Table2',
  module: 'learning',
  view: 'RubricLibrary',
  description,
  group: 'ÖĞRENME',
  apiOnly: true,
})

export const API_LEARNING_PAGES: Record<Role, readonly NavigationPage[]> = {
  yonetici: [
    contentPoolPage('Kurumun okuma parçası ve soru havuzunu inceleyin, onaylayın ve yönetin.'),
    // Beceri görevleri (OG-993; DOM-YTK-028): öğretmenin "Ödevler & Değerlendirme" sayfasındaki
    // Görevler sekmesinin yönetici karşılığı. Yönetici kurumun bütün atamalarını okur ve atar;
    // adres öğretmendekiyle aynı adı taşır (`/yonetici/odevler`), modül aynıdır (`learning`).
    {
      path: 'odevler',
      title: 'Beceri Görevleri',
      icon: 'ListChecks',
      module: 'learning',
      view: 'Learning',
      description:
        'Kurumun beceri görevlerini izleyin, sınıflara görev atayın ve teslimleri görün.',
      group: 'ÖĞRENME',
      apiOnly: true,
    },
    rubricLibraryPage('Kurumun yazma ve konuşma rubriklerini inceleyin, yayımlayın ve arşivleyin.'),
  ],
  onburo: [],
  ogretmen: [
    contentPoolPage('Okuma parçası ve soru hazırlayın, onaya gönderin, yayındaki içeriği izleyin.'),
    rubricLibraryPage('Yazma ve konuşma rubriklerini hazırlayın, yayımlayın ve yeni sürüm açın.'),
  ],
  ogrenci: [],
  // Veli Materyaller (OG-982; DOM-KYN-041): öğrencinin "Paylaşılan dosyalar" sekmesinin karşılığı,
  // seçili çocuğa paylaşılan yayındaki materyal dosyaları salt okunur. Modül öğrencinin
  // Materyaller sayfasıyla aynıdır (`learning`); kapalıysa menüden ve rotadan kalkar.
  veli: [
    {
      path: 'materyaller',
      title: 'Materyaller',
      icon: 'FolderOpen',
      module: 'learning',
      view: 'Learning',
      description: 'Öğretmenlerin çocuğunuzla paylaştığı materyal dosyaları.',
      group: 'AKADEMİK',
      apiOnly: true,
    },
  ],
}

// Akademik yönetim (IST-093, DOM-AKD-035): geçmiş günün yoklamasını yalnız yönetici gerekçeyle
// düzeltir; öğretmen bugünü kendi "Yoklama" sayfasında alır. Zümre başkanı (`school`) ve akademik
// koordinatör (`language_school`) görevini yalnız yönetici verir ve kaldırır (IST-005,
// DOM-YTK-027); görev öğretmen üyeliğine bağlı ek yetkidir, sayfa her iki kurum türünde vardır.
// Modül `academic` kapalıysa iki sayfa da menüden ve rotadan kalkar. Vue demosu ve mobil bu
// sayfaları taşımaz (`apiOnly`).
export const API_ACADEMIC_PAGES: Record<Role, readonly NavigationPage[]> = {
  yonetici: [
    {
      path: 'yoklama-duzeltme',
      title: 'Yoklama Düzeltme',
      icon: 'ClipboardCheck',
      module: 'academic',
      view: 'AttendanceCorrection',
      description: 'Geçmiş günlerin yoklamasını gerekçe yazarak düzeltin.',
      group: 'YÖNETİM',
      apiOnly: true,
    },
    {
      path: 'koordinator-gorevleri',
      title: 'Zümre & Koordinatörler',
      icon: 'Award',
      module: 'academic',
      view: 'CoordinatorDuties',
      description:
        'Öğretmene zümre başkanlığı (okul) ya da akademik koordinatörlük (dil okulu) görevi verin.',
      group: 'YÖNETİM',
      apiOnly: true,
    },
    {
      path: 'mazeret-bildirimleri',
      title: 'Mazeret Bildirimleri',
      icon: 'FileCheck',
      module: 'academic',
      view: 'AbsenceApprovals',
      description:
        'Velilerin izin ve mazeret bildirimlerini özür belgesiyle inceleyin, karar verin.',
      group: 'YÖNETİM',
      apiOnly: true,
    },
  ],
  onburo: [],
  // Sınıf rehber öğretmeni şubesinin bildirimlerini ve belgelerini salt okur görür; karar vermez
  // (DOM-ILT-053). Rehber olmayan öğretmende sunucu kapsamı listeyi boş döner.
  ogretmen: [
    {
      path: 'mazeret-bildirimleri',
      title: 'Mazeret Bildirimleri',
      icon: 'FileCheck',
      module: 'academic',
      view: 'AbsenceApprovals',
      description:
        'Rehber öğretmeni olduğunuz sınıfların mazeret bildirimlerini ve belgelerini görün.',
      group: 'AKADEMİK',
      apiOnly: true,
    },
  ],
  ogrenci: [],
  veli: [],
}

// Dil okulu kur ve grup sayfaları (IST-076, IST-077; DOM-DIL-005, -008): modüle değil kurum
// türüne bağlıdır (`institutionTypes`), okul kurumunda menüde yoktur ve doğrudan adresi kapalıdır
// (API de 404 döner). Yazma yönetici ve seviyenin akademik koordinatörü öğretmendedir; ön büro
// okur ve bekleme sırasını görür. Öğrenci ve veli kendi grubunun takvimini ders programı
// ekranlarında görür; ayrı sayfaları yoktur. Vue demosunun ve mobilin karşılığı yoktur.
const languageSchoolPage = (
  path: string,
  title: string,
  icon: string,
  description: string,
  group: string,
): NavigationPage => ({
  path,
  title,
  icon,
  module: null,
  view: 'LanguageSchool',
  description,
  group,
  apiOnly: true,
  institutionTypes: ['language_school'],
})

const coursesPage = (group: string, description: string) =>
  languageSchoolPage('kurlar', 'Kurlar', 'Languages', description, group)
const groupsPage = (group: string, description: string) =>
  languageSchoolPage('gruplar', 'Gruplar', 'UsersRound', description, group)
// Seviye tespiti (OG-078; IST-058, DOM-DIL-010…012): uçların rolleri `PLACEMENT_DECIDER_ROLES`
// (yönetici, öğretmen); ön büro uçlarda 403 aldığından menüde yoktur.
const placementPage = (group: string, description: string) =>
  languageSchoolPage('seviye-tespiti', 'Seviye Tespiti', 'ListChecks', description, group)

export const API_LANGUAGE_SCHOOL_PAGES: Record<Role, readonly NavigationPage[]> = {
  yonetici: [
    coursesPage('YÖNETİM', 'Kur programını tanımlayın, etkinleştirin ve e-Özel kaydını izleyin.'),
    groupsPage('YÖNETİM', 'Kurlardan grup açın; öğretmen, derslik ve takvimi planlayın.'),
    placementPage('YÖNETİM', 'Seviye tespiti açın, bölümleri puanlayın ve yerleştirin.'),
  ],
  onburo: [
    coursesPage('KAYIT & SATIŞ', 'Etkin kurları ve kapasitelerini inceleyin.'),
    groupsPage('KAYIT & SATIŞ', 'Grupların doluluğunu ve kursiyerlerini izleyin.'),
  ],
  ogretmen: [
    coursesPage('AKADEMİK', 'Koordinatörü olduğunuz seviyelerin kurlarını yönetin.'),
    groupsPage('AKADEMİK', 'Gruplarınızın takvimini ve doluluğunu izleyin.'),
    placementPage('AKADEMİK', 'Kursiyer ve adayların seviye tespitini yürütün.'),
  ],
  ogrenci: [],
  veli: [],
}
