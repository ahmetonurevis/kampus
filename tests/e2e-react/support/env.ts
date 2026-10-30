// React web + API uçtan uca düzeninin tek yapılandırma yeri. Değerler ortamdan geçersiz kılınabilir
// (aynı makinede başka bir koşu varsa farklı port/veritabanı adı verilir); gizli değer yoktur.
import { fileURLToPath } from 'node:url'

const root = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url))

function port(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error(`${name} geçerli bir port değil.`)
  return value
}

/** Yalnız `kampus_e2e` önekli adlar düşürülebilir: `kampus` ve başka ajanların veritabanları güvende. */
function databaseName(): string {
  const name = process.env.E2E_DB_NAME ?? 'kampus_e2e'
  if (!/^kampus_e2e[a-z0-9_]*$/.test(name))
    throw new Error('E2E_DB_NAME "kampus_e2e" ile başlamalı (yalnız küçük harf, rakam, alt çizgi).')
  return name
}

const apiPort = port('E2E_API_PORT', 3020)
const webPort = port('E2E_WEB_PORT', 4180)
const dbName = databaseName()
const adminDatabaseUrl =
  process.env.E2E_ADMIN_DATABASE_URL ?? 'postgres://kampus:kampus-yerel@127.0.0.1:5433/postgres'

function databaseUrl(): string {
  const url = new URL(adminDatabaseUrl)
  url.pathname = `/${dbName}`
  return url.toString()
}

export const e2e = {
  apiPort,
  webPort,
  apiOrigin: `http://127.0.0.1:${apiPort}`,
  /** Tarayıcının açtığı kök; `/api` isteklerini önizleme sunucusu API'ye vekiller. */
  webOrigin: `http://127.0.0.1:${webPort}`,
  dbName,
  /** Veritabanını oluşturan/düşüren bağlantı (bakım veritabanı `postgres`). compose.yaml değerleri. */
  adminDatabaseUrl,
  databaseUrl: databaseUrl(),
  /** `db:seed` demo hesaplarının parolası (apps/api/src/db/demo-seed.ts varsayılanı). */
  password: 'Demo-Giris-2026!',
  paths: {
    root: root(''),
    api: root('apps/api'),
    web: root('apps/web-react'),
    /** Gitignore'lı: sunucu günlükleri ve rol başına oturum önbelleği. */
    artifacts: root('artifacts/e2e-react'),
  },
} as const

/** Seed'deki rol anahtarları ve Akademi Özel Okulları hesapları (demo-seed.ts). */
export const roles = ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'] as const
export type RoleKey = (typeof roles)[number]

export const accounts: Record<RoleKey, { email: string; name: string; label: string }> = {
  yonetici: { email: 'murat.yilmaz@kampus.example', name: 'Murat Yılmaz', label: 'Yönetici' },
  onburo: { email: 'busra.aydin@kampus.example', name: 'Büşra Aydın', label: 'Ön Büro & Satış' },
  ogretmen: { email: 'selin.kaya@kampus.example', name: 'Selin Kaya', label: 'Öğretmen' },
  ogrenci: { email: 'deniz.yilmaz@kampus.example', name: 'Deniz Yılmaz', label: 'Öğrenci' },
  veli: { email: 'ayse.yilmaz@kampus.example', name: 'Ayşe Yılmaz', label: 'Veli' },
}

export const institutions = {
  akademi: 'Akademi Özel Okulları',
  kampusDil: 'Kampüs Dil Akademisi',
} as const
