// Platform (Oğuzhan) sayfa kapsamı: hangi menü sayfalarının React karşılığı var. Kayıt ve finans
// girdileri `../page-coverage.ts` içindeki `// Onur: kayıt ve finans` bloğundadır; ikisi orada birleşir.
// Sayfa kaydı `pages/registry/platform-pages.tsx` ile aynı yolları çizer.

export const ASSESSMENT_PATHS = new Set(['optik-degerlendirme', 'otomatik-etut'])
/** Bağlanmış iş akışı sayfaları; kalanlar yer tutucudur (bkz. README geçiş durumu). */
export const PLATFORM_WORKFLOW_PATHS: readonly string[] = [
  'yemek-menusu',
  'okul-takvimi',
  'kulupler',
  'hedef-plani',
  'rehberlik',
  'deneme-sinavlari',
  'program-yonetimi',
  'calisma-plani',
  'okul-servisi',
]

/** `rol/yol` anahtarları; dizi tutulur ki yinelenen anahtar testle yakalansın. */
export const PLATFORM_MIGRATED: readonly string[] = [
  'yonetici/dashboard',
  'onburo/dashboard',
  'ogretmen/dashboard',
  'ogrenci/dashboard',
  'veli/dashboard',
  'yonetici/subeler',
  'yonetici/personel',
  'yonetici/icerik-havuzu',
  'ogretmen/icerik-havuzu',
  'yonetici/ayarlar',
  'ogrenci/ayarlar',
  'veli/ayarlar',
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
  'ogrenci/soru-sor',
  'ogretmen/sorular',
  'ogrenci/mesajlar',
  'ogretmen/mesajlar',
  'yonetici/mesajlar',
  'veli/randevu-mesaj',
  'ogrenci/randevu-talep',
  'ogretmen/randevular',
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
  'yonetici/sla-raporu',
]
// Duyurular beş rolün hepsinde aynı ekrandır; rol kapsamı sunucudadır.
export const ANNOUNCEMENT_PATH = 'duyurular'
