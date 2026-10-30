import { useCallback, useEffect, useReducer, useRef, useState, type UIEvent } from 'react'
import { useLocation, useNavigationType, useSearchParams } from 'react-router'
import {
  listReducer,
  restoreListState,
  type ListState,
  type ScrollPosition,
} from '@/lib/list-state.ts'
import {
  applyListParams,
  listStateFromParams,
  listStateToParams,
  listSync,
} from '@/lib/list-url.ts'
import { readView, writeView } from '@/lib/view-memory.ts'

type Options = {
  pageSize?: number
  /** Aynı sayfada birden çok liste varsa URL parametre öneki (ör. `odeme-`). */
  urlPrefix?: string
}

/**
 * Liste görünüm durumu: yol + `key` (liste + çocuk/sekme kapsamı) başına bellekte, arama/sayfa/
 * sıralama ayrıca URL'de tutulur. Geri/ileri ile değişen URL yeniden okunur; kendi `replace`
 * yazımlarımız okunmaz. Kaydırma konumu her olayda render tetiklemesin diye ref'te izlenir.
 */
export function useListState(key: string, { pageSize = 8, urlPrefix = '' }: Options = {}) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigationType = useNavigationType()
  const memoryKey = `list:${location.pathname}:${key}`
  const remembered = () => restoreListState(readView(memoryKey), pageSize)
  // İlk yüklemede (yenileme, paylaşılan bağlantı) URL bellekten önce gelir.
  const [state, dispatch] = useReducer(listReducer, undefined, () =>
    listStateFromParams(params, urlPrefix, remembered()),
  )

  // Önceki çizimdeki adres ve liste anahtarı; değişince durum çizim sırasında yeniden kurulur
  // (effect içinde setState zinciri yerine React'in önerdiği "önceki değeri sakla" kalıbı).
  const current = { memoryKey, locationKey: location.key }
  const [seen, setSeen] = useState(current)
  const sync = listSync(seen, current, navigationType)
  if (sync !== 'none') setSeen(current)
  // Anahtar değişince URL'deki değerler önceki listeye aittir; yalnız bellek kullanılır.
  if (sync === 'restore') dispatch({ type: 'replace', state: remembered() })
  if (sync === 'read-url') {
    const next = applyListParams(state, params, urlPrefix)
    if (next !== state) dispatch({ type: 'replace', state: next })
  }

  const element = useRef<HTMLElement | null>(null)
  const position = useRef<ScrollPosition>(state.scroll)

  // Dış sistemlerle eşitleme: görünüm belleği, adres çubuğu ve kaydırma alanı.
  useEffect(() => {
    writeView(memoryKey, { ...state, scroll: position.current })
  }, [memoryKey, state])

  useEffect(() => {
    setParams(
      (current) => {
        const next = listStateToParams(state, urlPrefix, current)
        return next.toString() === current.toString() ? current : next
      },
      { replace: true, preventScrollReset: true },
    )
  }, [state, urlPrefix, setParams])

  // İndirgeyici kaydırmayı sıfırladığında (filtre, sayfa, sıralama) alan başa döner.
  useEffect(() => {
    position.current = state.scroll
    element.current?.scrollTo({ top: state.scroll.top, left: state.scroll.left })
  }, [state.scroll])

  const scrollRef = useCallback((node: HTMLElement | null) => {
    element.current = node
    node?.scrollTo({ top: position.current.top, left: position.current.left })
  }, [])

  const onScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const { scrollTop: top, scrollLeft: left } = event.currentTarget
      position.current = { top, left }
      const stored = readView(memoryKey)
      if (stored && typeof stored === 'object')
        writeView(memoryKey, { ...stored, scroll: { top, left } })
    },
    [memoryKey],
  )

  return { state, dispatch, scrollProps: { ref: scrollRef, onScroll } } as const
}
