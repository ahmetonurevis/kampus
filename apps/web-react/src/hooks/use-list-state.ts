import { useEffect, useReducer } from 'react'
import { useSearchParams } from 'react-router'
import { listReducer, restoreListState, type ListState } from '@/lib/list-state.ts'
import { listStateFromParams, listStateToParams } from '@/lib/list-url.ts'
import { readView, writeView } from '@/lib/view-memory.ts'

type Options = {
  pageSize?: number
  /** Aynı sayfada birden çok liste varsa URL parametre öneki (ör. `odeme-`). */
  urlPrefix?: string
}

/**
 * Liste görünüm durumu: `key` (liste + çocuk/sekme kapsamı) başına bellekte, arama/sayfa/sıralama
 * ayrıca URL'de tutulur. Geçersiz sayfa türetilerek düzeltilir (`effectivePage`), state'e yazılmaz.
 */
export function useListState(key: string, { pageSize = 8, urlPrefix = '' }: Options = {}) {
  const [params, setParams] = useSearchParams()
  const [state, dispatch] = useReducer(listReducer, undefined, (): ListState =>
    listStateFromParams(params, urlPrefix, restoreListState(readView(`list:${key}`), pageSize)),
  )

  // Dış sistemlerle eşitleme: görünüm belleği ve adres çubuğu.
  useEffect(() => {
    writeView(`list:${key}`, state)
  }, [key, state])

  useEffect(() => {
    setParams(
      (current) => {
        const next = listStateToParams(state, urlPrefix, current)
        return next.toString() === current.toString() ? current : next
      },
      { replace: true, preventScrollReset: true },
    )
  }, [state, urlPrefix, setParams])

  return [state, dispatch] as const
}

/** Veri azalınca geçersiz sayfada kalınmaz. */
export function effectivePage(state: ListState, pageCount: number): number {
  return Math.min(state.page, Math.max(1, pageCount))
}
