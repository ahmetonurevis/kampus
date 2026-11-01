// Üretim derlemesi denetimi: yalnız geliştirmede yüklenen kodun (Kolay giriş penceresi, demo
// hesapları ve parolası) izleri paket çıktısında bulunursa derleme hata verir. Her `vite build`
// (CI `pnpm build`, React e2e kurulumu) bu denetimden geçer.
import type { Plugin } from 'vite'

/** Üretim çıktısında geçmemesi gereken metinler. */
export const DEV_ONLY_MARKERS = ['Kolay giriş', 'kampus.example', 'Demo-Giris'] as const

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

export function devOnlyGuard(): Plugin {
  let production = false
  return {
    name: 'kampus-dev-only-guard',
    apply: 'build',
    configResolved(config) {
      production = config.isProduction
    },
    generateBundle(_options, bundle) {
      if (!production) return
      const files: Record<string, string> = {}
      for (const [name, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') files[name] = output.code
        else if (typeof output.source === 'string') files[name] = output.source
      }
      const leaks = findDevOnlyLeaks(files)
      if (leaks.length)
        this.error(
          `Üretim paketinde yalnız geliştirmeye ait metin var: ${leaks
            .map((leak) => `${leak.file} → "${leak.marker}"`)
            .join(', ')}`,
        )
    },
  }
}
