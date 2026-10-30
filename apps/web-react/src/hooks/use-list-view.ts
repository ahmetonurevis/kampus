import { useMemo, type ActionDispatch } from 'react'
import type { FilterField, Row } from '@/lib/list-query.ts'
import type { ListAction, ListState } from '@/lib/list-state.ts'
import { listView, type ListView } from '@/lib/list-view.ts'

type Config<T extends Row> = {
  fields: readonly FilterField[]
  searchKeys: readonly string[]
  sort?: (rows: T[], state: ListState) => T[]
}

/**
 * Liste görünümünü türetir. Veri azalıp sayfa geçersiz kalırsa durum da son geçerli sayfaya
 * çekilir (URL'de eski sayfa kalmaz). Veri boşken çekilmez: yükleme sırasındaki boş liste
 * kayıtlı sayfayı silmesin.
 */
export function useListView<T extends Row>(
  rows: readonly T[],
  state: ListState,
  dispatch: ActionDispatch<[ListAction]>,
  { fields, searchKeys, sort }: Config<T>,
): ListView<T> {
  const view = useMemo(
    () => listView(rows, state, { fields, searchKeys, sort }),
    [rows, state, fields, searchKeys, sort],
  )
  if (view.total > 0 && state.page > view.pageCount)
    dispatch({ type: 'clamp', pageCount: view.pageCount })
  return view
}
