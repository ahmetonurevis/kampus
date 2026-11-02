// Hangi menü sayfalarının React karşılığı var: sayfa kaydı (`pages/page-registry.tsx`) ve kapsam
// testi aynı kümeleri okur. Kayıtta olmayan sayfa yer tutucuyla açılır. İki kaynak birleşir:
// Oğuzhan'ın girdileri `page-coverage/platform.ts`, kayıt ve finans girdileri aşağıdaki
// `// Onur: kayıt ve finans` bloğudur. Bir anahtar yalnız bir kaynakta bulunur (test yakalar).
import {
  ANNOUNCEMENT_PATH,
  ASSESSMENT_PATHS,
  PLATFORM_MIGRATED,
  PLATFORM_WORKFLOW_PATHS,
} from './page-coverage/platform.ts'
import type { RoleKey } from './navigation.ts'

export { ANNOUNCEMENT_PATH, ASSESSMENT_PATHS }

// Onur: kayıt ve finans
export const ONUR_WORKFLOW_PATHS: readonly string[] = ['kayit-yenileme']
export const ONUR_MIGRATED: readonly string[] = [
  'yonetici/finans',
  'onburo/tahsilat-takip',
  'veli/finans',
  'veli/dekontlar',
  'veli/odeme-yap',
  'veli/sozlesmeler',
  'ogrenci/odemelerim',
  'onburo/adaylar',
  'onburo/deneme-dersi-takvimi',
  'onburo/kayit-islemleri',
  'onburo/aday',
  'yonetici/aday',
  'yonetici/kayit-raporlari',
]
// Onur: kayıt ve finans sonu

/** Bağlanmış iş akışı sayfaları (iki kaynağın birleşimi). */
export const WORKFLOW_PATHS = new Set([...PLATFORM_WORKFLOW_PATHS, ...ONUR_WORKFLOW_PATHS])
export const MIGRATED = new Set([...PLATFORM_MIGRATED, ...ONUR_MIGRATED])

export function isMigratedPage(role: RoleKey, path: string): boolean {
  return (
    MIGRATED.has(`${role}/${path}`) ||
    WORKFLOW_PATHS.has(path) ||
    ASSESSMENT_PATHS.has(path) ||
    path === ANNOUNCEMENT_PATH
  )
}
