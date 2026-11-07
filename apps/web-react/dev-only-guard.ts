// Derleme denetimi: yalnız geliştirmede yüklenen kodun (Kolay giriş penceresi, demo hesapları ve
// parolası) izleri paket çıktısında bulunursa derleme hata verir. Kipten bağımsız her `vite build`
// taranır: `import.meta.env.DEV` `NODE_ENV`/kipten türediği için `vite build --mode development` ya
// da `NODE_ENV=staging vite build` çıktısına geliştirme kodu girer; denetim bunları da durdurur
// (CI `pnpm build`, React e2e kurulumu dahil).
//
// Yayımlanmayacak bir geliştirme derlemesi bilerek isteniyorsa `KAMPUS_ALLOW_DEV_SECRETS=1`
// verilir; denetim yine tarar, iz bulursa durdurmak yerine uyarı yazar.
import type { Plugin } from 'vite'
import { EASY_LOGIN_MARKER } from './src/pages/dev/easy-login-accounts.ts'

/**
 * Paket çıktısında geçmemesi gereken metinler: Kolay giriş modülünün benzersiz işareti ve demo
 * parolası. Genel metinler (`kampus.example`, düğme adı) school-core verisinde de geçebildiği için
 * işaret olarak kullanılmaz.
 */
export const DEV_ONLY_MARKERS = [EASY_LOGIN_MARKER, 'Demo-Giris'] as const

/** Bilerek yapılan geliştirme derlemesinde denetimin durdurmasını kapatan ortam değişkeni. */
export const ALLOW_DEV_SECRETS_ENV = 'KAMPUS_ALLOW_DEV_SECRETS'

export function devSecretsAllowed(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[ALLOW_DEV_SECRETS_ENV] === '1'
}

/** Paketleyici ASCII dışı karakteri `\uXXXX` kaçışıyla da yazabilir; iki biçim de aranır. */
function variants(marker: string): string[] {
  const escape = (upper: boolean) =>
    marker.replace(/[^\x20-\x7e]/g, (char) => {
      const hex = char.charCodeAt(0).toString(16).padStart(4, '0')
      return `\\u${upper ? hex.toUpperCase() : hex}`
    })
  return [...new Set([marker, escape(false), escape(true)])]
}

export type DevOnlyLeak = { file: string; marker: string }

/** Dosya adı → içerik; içinde geliştirme izi geçen dosya ve iz çiftleri. */
export function findDevOnlyLeaks(
  files: Readonly<Record<string, string>>,
  markers: readonly string[] = DEV_ONLY_MARKERS,
): DevOnlyLeak[] {
  const leaks: DevOnlyLeak[] = []
  for (const [file, content] of Object.entries(files))
    for (const marker of markers)
      if (variants(marker).some((form) => content.includes(form))) leaks.push({ file, marker })
  return leaks
}

export function devOnlyGuard(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Plugin {
  const allowed = devSecretsAllowed(env)
  return {
    name: 'kampus-dev-only-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files: Record<string, string> = {}
      for (const [name, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') files[name] = output.code
        else if (typeof output.source === 'string') files[name] = output.source
      }
      const leaks = findDevOnlyLeaks(files)
      if (!leaks.length) return
      const found = leaks.map((leak) => `${leak.file} → "${leak.marker}"`).join(', ')
      if (allowed) {
        this.warn(
          `${ALLOW_DEV_SECRETS_ENV}=1: paket yalnız geliştirmeye ait metin içeriyor, yayımlanmamalı (${found}).`,
        )
        return
      }
      this.error(
        `Pakette yalnız geliştirmeye ait metin var: ${found}. Üretim derlemesi varsayılan kipte ` +
          `(\`vite build\`, NODE_ENV boş ya da production) yapılır; yayımlanmayacak bir geliştirme ` +
          `derlemesi için ${ALLOW_DEV_SECRETS_ENV}=1 verin.`,
      )
    },
  }
}
