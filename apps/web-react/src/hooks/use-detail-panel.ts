import { useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { keptHistoryState, PANEL_MARKER } from '@/lib/history-state.ts'

const NO_PARAMS: readonly string[] = []

type PanelState = { detailPanel?: string } | null

function openedBy(state: unknown, parameter: string): boolean {
  return (
    typeof state === 'object' && state !== null && (state as PanelState)?.detailPanel === parameter
  )
}

/**
 * Sağ panel seçimi URL'de (`?sinif=c1`; Vue `use-detail-panel.js`): liste yerinde kalır, bağlantı
 * paylaşılabilir, tarayıcının geri/ileri düğmesi paneli kapatıp açar. Panel bu sayfadan açıldıysa
 * kapatma bir adım geri gider (geçmişte fazladan kayıt kalmaz); bağlantıyla gelindiyse parametre
 * `replace` ile silinir. `clears`: panelin içindeki alt listelerin (ör. `dn-sayfa`) adres
 * parametreleri; panel bağlantıyla açıldıysa kapanırken onlar da silinir ki bir sonraki panele
 * önceki kaydın sayfası taşınmasın (sabit dizi verin, modül düzeyi).
 */
export function useDetailPanel(parameter: string, clears: readonly string[] = NO_PARAMS) {
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const selectedId = params.get(parameter) ?? ''

  const open = useCallback(
    (id: string) => {
      const next = new URLSearchParams(window.location.search)
      next.set(parameter, id)
      void Promise.resolve(
        navigate(
          { search: `?${next.toString()}`, hash: location.hash },
          {
            state: { ...keptHistoryState(location.state), [PANEL_MARKER]: parameter },
            preventScrollReset: true,
          },
        ),
      ).catch((error: unknown) => console.error('[panel] açılamadı', error))
    },
    [navigate, parameter, location.hash, location.state],
  )

  const close = useCallback(() => {
    if (openedBy(location.state, parameter)) {
      void Promise.resolve(navigate(-1)).catch((error: unknown) =>
        console.error('[panel] kapatılamadı', error),
      )
      return
    }
    const next = new URLSearchParams(window.location.search)
    next.delete(parameter)
    for (const name of clears) next.delete(name)
    const search = next.toString()
    void Promise.resolve(
      navigate(
        { search: search ? `?${search}` : '', hash: location.hash },
        {
          replace: true,
          preventScrollReset: true,
          state: keptHistoryState(location.state),
        },
      ),
    ).catch((error: unknown) => console.error('[panel] kapatılamadı', error))
  }, [navigate, parameter, clears, location.state, location.hash])

  return { selectedId, open, close } as const
}
