// Hangi menü sayfalarının React karşılığı var: sayfa kaydı (`pages/page-registry.tsx`) ve kapsam
// testi aynı kümeleri okur. Kayıtta olmayan sayfa yer tutucuyla açılır.
import type { RoleKey } from './navigation.ts'

export const ASSESSMENT_PATHS = new Set(['optik-degerlendirme', 'otomatik-etut'])
/** Bağlanmış iş akışı sayfaları; kalanlar yer tutucudur (bkz. README geçiş durumu). */
export const WORKFLOW_PATHS = new Set([
  'yemek-menusu',
  'okul-takvimi',
  'kulupler',
  'hedef-plani',
  'rehberlik',
  'deneme-sinavlari',
  'kayit-yenileme',
  'program-yonetimi',
  'calisma-plani',
  'okul-servisi',
])

export const MIGRATED = new Set([
  'yonetici/dashboard',
  'onburo/dashboard',
  'ogretmen/dashboard',
  'ogrenci/dashboard',
  'veli/dashboard',
  'yonetici/subeler',
  'yonetici/personel',
  'yonetici/ayarlar',
  'ogrenci/ayarlar',
  'veli/ayarlar',
  'yonetici/finans',
  'onburo/tahsilat-takip',
  'ogretmen/siniflarim',
  'ogretmen/yoklama',
  'ogretmen/ders-programi',
  'ogrenci/notlarim',
  'ogrenci/devamsizlik',
  'ogrenci/ders-programi',
  'veli/akademik-takip',
  'veli/cocuk-secici',
  'ogretmen/odevler',
  'ogretmen/materyal-yukle',
  'ogretmen/quiz-olustur',
  'ogrenci/odevler',
  'ogrenci/materyaller',
  'ogrenci/videolar',
  'ogrenci/soru-coz',
  'ogrenci/mesajlar',
  'ogretmen/mesajlar',
  'yonetici/mesajlar',
  'veli/randevu-mesaj',
  'veli/finans',
  'veli/dekontlar',
  'veli/odeme-yap',
  'veli/sozlesmeler',
  'ogrenci/odemelerim',
  'ogrenci/sinav-analizi',
  'ogrenci/seviye-takibi',
  'veli/sinav-analizi',
  'veli/seviye-takibi',
  'veli/ogretmen-degerlendirmeleri',
  'veli/sikayet-talep',
  'veli/devamsizlik-bildirimi',
  'onburo/talepler',
  'ogretmen/sinif-analizi',
  'yonetici/risk-listesi',
  'yonetici/kayit-raporlari',
  'yonetici/sla-raporu',
])
// Duyurular beş rolün hepsinde aynı ekrandır; rol kapsamı sunucudadır.
// TODO(web-randevu): öğretmen `randevular` ve öğrenci `randevu-talep` yer tutucu kalır.
export const ANNOUNCEMENT_PATH = 'duyurular'

export function isMigratedPage(role: RoleKey, path: string): boolean {
  return (
    MIGRATED.has(`${role}/${path}`) ||
    WORKFLOW_PATHS.has(path) ||
    ASSESSMENT_PATHS.has(path) ||
    path === ANNOUNCEMENT_PATH
  )
}
