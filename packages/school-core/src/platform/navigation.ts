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
  ],
  ogrenci: [],
  veli: [],
}

// İçerik havuzu (ADR 0004, docs/domain/kaynak-platformu.md): yalnız içerik personeli (yönetici,
// öğretmen; DOM-YTK-021). Öğrenci ve veli içeriği paylaşım ve atamayla görür, ön büro görmez.
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

export const API_LEARNING_PAGES: Record<Role, readonly NavigationPage[]> = {
  yonetici: [
    contentPoolPage('Kurumun okuma parçası ve soru havuzunu inceleyin, onaylayın ve yönetin.'),
  ],
  onburo: [],
  ogretmen: [
    contentPoolPage('Okuma parçası ve soru hazırlayın, onaya gönderin, yayındaki içeriği izleyin.'),
  ],
  ogrenci: [],
  veli: [],
}

// Akademik yönetim (IST-093, DOM-AKD-035): geçmiş günün yoklamasını yalnız yönetici gerekçeyle
// düzeltir; öğretmen bugünü kendi "Yoklama" sayfasında alır. Modül `academic` kapalıysa menüden ve
// rotadan kalkar. Vue demosu ve mobil bu sayfayı taşımaz (`apiOnly`).
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
  ],
  onburo: [],
  ogretmen: [],
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

export const API_LANGUAGE_SCHOOL_PAGES: Record<Role, readonly NavigationPage[]> = {
  yonetici: [
    coursesPage('YÖNETİM', 'Kur programını tanımlayın, etkinleştirin ve e-Özel kaydını izleyin.'),
  ],
  onburo: [coursesPage('KAYIT & SATIŞ', 'Etkin kurları ve kapasitelerini inceleyin.')],
  ogretmen: [coursesPage('AKADEMİK', 'Koordinatörü olduğunuz seviyelerin kurlarını yönetin.')],
  ogrenci: [],
  veli: [],
}
