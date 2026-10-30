// Tema tercihi Vue uygulamasıyla aynı anahtarda saklanır; varsayılan açık temadır.
export const THEME_STORAGE_KEY = 'kampus-theme'
export type Theme = 'light' | 'dark'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function readTheme(storage: StorageLike | undefined): Theme {
  try {
    return storage?.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch (error) {
    console.warn('[theme] tercih okunamadı', error)
    return 'light'
  }
}

/** Tercihi yazar; depolama kapalıysa tema yalnız bu oturumda geçerli kalır. */
export function writeTheme(storage: StorageLike | undefined, theme: Theme): boolean {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme)
    return true
  } catch (error) {
    console.warn('[theme] tercih saklanamadı', error)
    return false
  }
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'light' ? 'dark' : 'light'
}
