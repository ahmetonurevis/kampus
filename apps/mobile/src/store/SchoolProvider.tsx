import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { AccessibilityInfo, useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { randomUUID } from 'expo-crypto'
import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import { createSnapshotWriter, restoreSnapshot } from '@kampus/school-core/lib/demo-persistence.ts'
import type { MakeId } from '@kampus/school-core/lib/domain.ts'
import type { Role } from '@kampus/school-core/modules/navigation.ts'
import {
  prepareReferenceData,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '../model/experience.ts'
import { clone, roles } from '../model/school.ts'

// Oturum rolü giriş yapılana kadar boştur.
export type AppSession = { role: Role | ''; childId: string; theme: ThemePreference }
export type ToastType = 'success' | 'error' | 'warning'
export type Toast = { message: string; type: ToastType }
type LogLevel = 'error' | 'warn'
export type LogEntry = {
  date: string
  level: LogLevel
  critical: boolean
  context: string
  message: string
}
type SchoolContext = {
  data: State | null
  session: AppSession
  resolvedTheme: ResolvedTheme
  preference: (changes: Partial<AppSession>) => Promise<boolean>
  commit: (
    mutate: (state: State, makeId: MakeId) => void,
    message?: string,
    onError?: (text: string) => void,
  ) => Promise<boolean>
  notify: (message: string, type?: ToastType) => void
  toast: Toast | null
  setToast: Dispatch<SetStateAction<Toast | null>>
  busy: boolean
  reduceMotion: boolean
  error: string
  load: () => Promise<void>
  reset: () => Promise<void>
}

const DATA_KEY = 'kampus-mobile-data-v1',
  PREF_KEY = 'kampus-mobile-preferences-v1'
const Context = createContext<SchoolContext | null>(null)
export const logs: LogEntry[] = []
export function recordError(error: unknown, context: string, level: LogLevel = 'error') {
  logs.push({
    date: new Date().toISOString(),
    level,
    critical: level === 'error',
    context,
    message: String(error),
  })
  if (logs.length > 100) logs.shift()
}
export const makeId: MakeId = (prefix) => `${prefix}-${randomUUID()}`

const isRole = (value: unknown): value is Role => typeof value === 'string' && value in roles
const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'light' || value === 'dark' || value === 'system'
// Kayıtlı tercihler depodan gelir; beklenen alanlar tek tek doğrulanır.
function parsePreferences(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null) throw new Error('Kayıtlı tercihler okunamadı.')
  return typeof parsed === 'object' ? Object.fromEntries(Object.entries(parsed)) : {}
}
// Doğrulama (Zod) hatasında ilk alan mesajı, aksi halde hata iletisi gösterilir.
function operationMessage(error: unknown) {
  if (typeof error !== 'object' || error === null) return ''
  if ('issues' in error && Array.isArray(error.issues)) {
    const first: unknown = error.issues[0]
    if (
      typeof first === 'object' &&
      first !== null &&
      'message' in first &&
      typeof first.message === 'string' &&
      first.message
    )
      return first.message
  }
  return 'message' in error && typeof error.message === 'string' ? error.message : ''
}

export function SchoolProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<State | null>(null),
    [session, setSession] = useState<AppSession>({ role: '', childId: 's1', theme: 'light' }),
    [error, setError] = useState(''),
    [toast, setToast] = useState<Toast | null>(null),
    [busy, setBusy] = useState(false),
    [reduceMotion, setReduceMotion] = useState(false)
  const systemTheme = useColorScheme()
  const resolvedTheme = resolveTheme(session.theme, systemTheme)
  const current = useRef<State | null>(null),
    preferences = useRef(session),
    lock = useRef(false),
    writer = useRef<((state: State) => string) | null>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  function notify(message: string, type: ToastType = 'success') {
    setToast({ message, type })
    AccessibilityInfo.announceForAccessibility(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }
  async function load() {
    setError('')
    try {
      const [raw, prefs] = await Promise.all([
        AsyncStorage.getItem(DATA_KEY),
        AsyncStorage.getItem(PREF_KEY),
      ])
      const next = raw ? restoreSnapshot(raw) : createSeed()
      const enhanced = prepareReferenceData(next)
      const saved = prefs ? parsePreferences(prefs) : {}
      const parent = next.parents[0]
      if (!parent) throw new Error('Veli kaydı bulunamadı.')
      const nextSession: AppSession = {
        role: isRole(saved.role) ? saved.role : '',
        childId:
          typeof saved.childId === 'string' && parent.studentIds.includes(saved.childId)
            ? saved.childId
            : 's1',
        theme: isThemePreference(saved.theme) ? saved.theme : 'light',
      }
      const write = createSnapshotWriter(createSeed(new Date(next.createdAt)))
      writer.current = write
      if (!raw || enhanced) await AsyncStorage.setItem(DATA_KEY, write(next))
      current.current = next
      preferences.current = nextSession
      setData(next)
      setSession(nextSession)
    } catch (err) {
      recordError(err, 'storage-load')
      setError(
        'Kayıtlı veriler açılamadı. Yeniden deneyebilir veya demo verilerini sıfırlayabilirsiniz.',
      )
    }
  }
  useEffect(() => {
    void load()
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      motion.remove()
      clearTimeout(toastTimer.current)
    }
  }, [])
  async function preference(changes: Partial<AppSession>) {
    try {
      const next = { ...preferences.current, ...changes }
      await AsyncStorage.setItem(PREF_KEY, JSON.stringify(next))
      preferences.current = next
      setSession(next)
      return true
    } catch (err) {
      recordError(err, 'preference-write')
      notify('Tercih kaydedilemedi. Lütfen yeniden deneyin.', 'error')
      return false
    }
  }
  // onError: açık bir pencerenin içinde hata metnini göstermek için (toast modalın arkasında kalabilir).
  async function commit(
    mutate: (state: State, makeId: MakeId) => void,
    message = 'İşlem kaydedildi.',
    onError?: (text: string) => void,
  ) {
    if (lock.current) {
      notify('Önceki işlem tamamlanıyor.', 'warning')
      return false
    }
    lock.current = true
    setBusy(true)
    try {
      if (!current.current) throw new Error('Okul verisi henüz yüklenmedi.')
      const next = clone(current.current)
      mutate(next, makeId)
      // TODO(ts): telefon denetim kaydını yalnızca kimlik/rol/işlem/tarih ile yazar; core `AuditEntry` tipi web'in tüm alanlarını bekler. Tipler birleşince kalkar.
      const audit: unknown[] = next.audit
      audit.unshift({
        id: makeId('audit'),
        actor: preferences.current.role,
        action: message,
        date: new Date().toISOString(),
      })
      next.audit = next.audit.slice(0, 200)
      try {
        if (!writer.current) throw new Error('Kayıt yazıcısı hazır değil.')
        await AsyncStorage.setItem(DATA_KEY, writer.current(next))
      } catch (err) {
        recordError(err, 'storage-write')
        const text =
          'Kayıt için yeterli alan olmayabilir. İşlem kaydedilmedi; yer açıp tekrar deneyin.'
        notify(text, 'error')
        onError?.(text)
        return false
      }
      current.current = next
      setData(next)
      if (message) notify(message)
      return true
    } catch (err) {
      recordError(err, 'operation', 'warn')
      const text = operationMessage(err) || 'İşlem tamamlanamadı.'
      notify(text, 'error')
      onError?.(text)
      return false
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function reset() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      const raw = await AsyncStorage.getItem(DATA_KEY)
      if (raw) await AsyncStorage.setItem(DATA_KEY + '-recovery', raw)
      const next = createSeed()
      prepareReferenceData(next)
      const write = createSnapshotWriter(createSeed(new Date(next.createdAt)))
      writer.current = write
      await AsyncStorage.setItem(DATA_KEY, write(next))
      current.current = next
      setData(next)
      setError('')
      await preference({ role: '', childId: 's1' })
      notify('Demo verileri yenilendi.')
    } catch (err) {
      recordError(err, 'reset')
      notify('Demo sıfırlanamadı. Depolama alanını kontrol edin.', 'error')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Context.Provider
      value={{
        data,
        session,
        resolvedTheme,
        preference,
        commit,
        notify,
        toast,
        setToast,
        busy,
        reduceMotion,
        error,
        load,
        reset,
      }}
    >
      {children}
    </Context.Provider>
  )
}
export function useSchool() {
  const value = useContext(Context)
  if (!value) throw new Error('useSchool yalnızca SchoolProvider içinde kullanılabilir.')
  return value
}
// Veri yüklendikten sonra çizilen ekranlar için: yükleme bitmeden çağrılırsa açık hata verir.
export function useLoadedSchool() {
  const school = useSchool()
  if (!school.data) throw new Error('Okul verisi henüz yüklenmedi.')
  return { ...school, data: school.data }
}
export type ActiveSession = AppSession & { role: Role }
// Giriş yapıldıktan sonra çizilen ekranlar için: veri ve rol dolu gelir.
export function useActiveSchool() {
  const school = useLoadedSchool()
  const { role } = school.session
  if (!role) throw new Error('Bu ekran için önce bir rol seçilmelidir.')
  return { ...school, session: { ...school.session, role } satisfies ActiveSession }
}
