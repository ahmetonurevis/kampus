import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { EMPTY_LIST_STATE, withFilter, withSearch, type ListState } from './list-state.ts'

/**
 * Oturum süresince bellekte tutulan görünüm durumu: velinin seçtiği çocuk ve liste başına arama,
 * süzgeç ve sayfa. Cihaza yazılmaz (kişisel veri); oturum veya kurum değişince sağlayıcıyla silinir.
 */
type ViewMemory = {
  childId: string | null
  setChildId: (id: string) => void
  lists: Map<string, ListState>
}

const ViewMemoryContext = createContext<ViewMemory | null>(null)

export function ViewMemoryProvider({ children }: { children: ReactNode }) {
  const [childId, setChildId] = useState<string | null>(null)
  const lists = useRef(new Map<string, ListState>())
  return (
    <ViewMemoryContext.Provider value={{ childId, setChildId, lists: lists.current }}>
      {children}
    </ViewMemoryContext.Provider>
  )
}

function useViewMemory(): ViewMemory {
  const value = useContext(ViewMemoryContext)
  if (!value) throw new Error('Görünüm belleği yalnızca API uygulaması içinde kullanılabilir.')
  return value
}

export function useSelectedChild() {
  const { childId, setChildId } = useViewMemory()
  return [childId, setChildId] as const
}

/** Liste (ve veli için çocuk) başına arama metni, süzgeç ve sayfa; ekrana dönünce geri gelir. */
export function useListMemory(key: string) {
  const { lists } = useViewMemory()
  const [state, setState] = useState<ListState>(() => lists.get(key) ?? EMPTY_LIST_STATE)
  // Anahtar değişince (çocuk değişti) o anahtarın kayıtlı durumu okunur.
  const [currentKey, setCurrentKey] = useState(key)
  let current = state
  if (currentKey !== key) {
    current = lists.get(key) ?? EMPTY_LIST_STATE
    setCurrentKey(key)
    setState(current)
  }
  function update(next: ListState) {
    lists.set(key, next)
    setState(next)
  }
  return {
    state: current,
    setSearch: (search: string) => update(withSearch(current, search)),
    setFilter: (filter: string) => update(withFilter(current, filter)),
    /** Arama ve süzgeci birlikte temizler (iki ayrı güncelleme birbirini ezmesin). */
    clear: () => update(EMPTY_LIST_STATE),
    setIndex: (index: number) => update({ ...current, index }),
    /** Durumu tek güncellemeyle değiştirir (ör. aralığı koruyan süzgeç temizleme). */
    replace: update,
  }
}
