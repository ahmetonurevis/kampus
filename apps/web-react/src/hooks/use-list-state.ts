import { use, useCallback, useEffect, useReducer, useRef, useState, type UIEvent } from 'react'
import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router'
import { listReducer, restoreListState, type ScrollPosition } from '@/lib/list-state.ts'
import {
  applyListParams,
  hasLegacySearch,
  keepsSearchInUrl,
  listStateFromParams,
  listStateToParams,
  listSync,
  urlBelongsToScope,
  type UrlFilters,
} from '@/lib/list-url.ts'
import { keptHistoryState } from '@/lib/history-state.ts'
import { createParamsWriter } from '@/lib/params-writer.ts'
import { readView, writeView } from '@/lib/view-memory.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'

// Aynı sayfadaki bütün listeler tek yazıcıyı paylaşır (bkz. params-writer).
const writeParams = createParamsWriter(() => window.location.search)

type Options = {
  pageSize?: number
  /** Aynı sayfada birden çok liste varsa URL parametre öneki (ör. `odeme-`). */
  urlPrefix?: string
  /**
   * Dış filtre (sekme, durum seçimi) anahtarı; değişince sayfa ve kaydırma sıfırlanır.
   * Çocuk/kapsam değişimi için `key` kullanılır (her kapsamın kendi durumu vardır).
   */
  resetKey?: string
  /**
   * URL'de de tutulacak tekli filtreler (anahtar → parametre adı). Sunucu sayfalı listelerde
   * filtre bağlantıyla paylaşılır ve geri/ileri ile döner. Sabit nesne verin (modül düzeyi).
   */
  urlFilters?: UrlFilters
  /**
   * @deprecated Etkisizdir: arama metni hiçbir listede URL'ye yazılmaz (ADR 0009). Mevcut
   * çağrılar derlensin diye tipte durur; yeni kodda verilmez.
   */
  searchInUrl?: boolean
}

const NO_URL_FILTERS: UrlFilters = {}

/**
 * Liste görünüm durumu: yol + `key` (liste + çocuk/sekme kapsamı) başına bellekte, sayfa/sıralama
 * ve `urlFilters` ayrıca URL'de tutulur. Arama metni yalnız bellektedir (ADR 0009, KVKK): geri/
 * ileri ve sayfa içi gezinmede bellekten döner, tam yenilemede kaybolur; eski bağlantıdaki `q` bir
 * kez okunur ve `replace` ile adresten silinir. Geri/ileri ile değişen URL yeniden okunur; kendi
 * `replace` yazımlarımız okunmaz. Kaydırma konumu her olayda render tetiklemesin diye ref'te izlenir.
 */
export function useListState(
  key: string,
  { pageSize = 8, urlPrefix = '', resetKey = '', urlFilters = NO_URL_FILTERS }: Options = {},
) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const navigationType = useNavigationType()
  const scope = use(ViewScopeContext)
  const memoryKey = `list:${location.pathname}:${scope}:${key}`
  const keepSearch = keepsSearchInUrl(location.pathname)
  const remembered = () => restoreListState(readView(memoryKey), pageSize)
  // İlk yüklemede (yenileme, paylaşılan bağlantı) URL bellekten önce gelir.
  const urlScopeKey = `list-url-scope:${location.pathname}`
  const [state, dispatch] = useReducer(listReducer, undefined, () =>
    urlBelongsToScope(readView(urlScopeKey), scope)
      ? listStateFromParams(params, urlPrefix, remembered(), urlFilters)
      : remembered(),
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
    const next = applyListParams(state, params, urlPrefix, urlFilters, keepSearch)
    if (next !== state) dispatch({ type: 'replace', state: next })
  }
  const [seenReset, setSeenReset] = useState(resetKey)
  if (seenReset !== resetKey) {
    setSeenReset(resetKey)
    if (sync !== 'restore') dispatch({ type: 'external' })
  }

  // Adres yazımı geçerli girdinin `state`'ini (ör. `from` geri dönüş adresi) korur; effect
  // bağımlılığı olmasın diye ref'te tutulur.
  const historyState = useRef(location.state)
  useEffect(() => {
    historyState.current = location.state
  }, [location.state])

  const element = useRef<HTMLElement | null>(null)
  const position = useRef<ScrollPosition>(state.scroll)

  // Eski bağlantıdaki arama adreste durdukça yazım yeniden çalışır; durum değişmese de (`q` zaten
  // bellekteki aramayla aynıysa) parametre silinir.
  const legacySearch = !keepSearch && hasLegacySearch(params, urlPrefix)

  // Dış sistemlerle eşitleme: görünüm belleği, adres çubuğu ve kaydırma alanı.
  useEffect(() => {
    writeView(memoryKey, { ...state, scroll: position.current })
  }, [memoryKey, state])

  useEffect(() => {
    writeView(urlScopeKey, scope)
    writeParams(
      (current) => listStateToParams(state, urlPrefix, current, urlFilters, keepSearch),
      (search) =>
        void Promise.resolve(
          navigate(
            { search },
            {
              replace: true,
              preventScrollReset: true,
              state: keptHistoryState(historyState.current),
            },
          ),
        ).catch((error: unknown) => console.error('[liste] adres güncellenemedi', error)),
    )
  }, [state, urlPrefix, urlFilters, keepSearch, legacySearch, navigate, urlScopeKey, scope])

  // İndirgeyici kaydırmayı sıfırladığında (filtre, sayfa, sıralama) alan başa döner.
  useEffect(() => {
    position.current = state.scroll
    element.current?.scrollTo({ top: state.scroll.top, left: state.scroll.left })
  }, [state.scroll])

  const attachScrollRegion = useCallback((node: HTMLElement | null) => {
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

  return { state, dispatch, attachScrollRegion, onScroll } as const
}
