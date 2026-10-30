import { nextTheme, readTheme, writeTheme, type Theme } from './theme.ts'

// Tema tek bir dış store'da tutulur; React `useSyncExternalStore` ile okur, sonner ve
// yerleşim aynı değeri görür. `<html data-theme>` ilk boyamada index.html'de uygulanır.
type Listener = () => void

const listeners = new Set<Listener>()

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch (error) {
    console.warn('[theme] depolamaya erişilemedi', error)
    return undefined
  }
}

let current: Theme = readTheme(browserStorage())

function apply(theme: Theme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === 'dark') root.dataset.theme = 'dark'
  else delete root.dataset.theme
  root.style.colorScheme = theme
}

export function getTheme(): Theme {
  return current
}

export function setTheme(theme: Theme) {
  if (theme === current) return
  current = theme
  apply(theme)
  writeTheme(browserStorage(), theme)
  for (const listener of listeners) listener()
}

export function toggleTheme() {
  setTheme(nextTheme(current))
}

export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
