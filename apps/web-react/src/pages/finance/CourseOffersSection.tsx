import { useMemo, useState } from 'react'
import { useCourseOffers } from '@kampus/react-shared/use-finance-packages.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import {
  COURSE_OFFER_OUTCOME_OPTIONS,
  courseOfferRow,
  isProgressionOutcome,
  type CourseOfferRow,
} from './course-offer-rows.ts'
import { PackageSaleModal, type SaleOffer } from './PackageSaleModal.tsx'
import { PackageSalePanel } from './PackageSalePanel.tsx'

const NO_SORT: readonly string[] = []
const MOBILE = ['studentName', 'target', 'state']
const FILTERS = [
  {
    key: 'outcome',
    label: 'Karar',
    type: 'select' as const,
    options: COURSE_OFFER_OUTCOME_OPTIONS,
  },
]
const filterText = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

/**
 * Kur yenileme ve üst kur teklifleri (`?gorunum=kur-yenileme`; IST-088, ON-082; DOM-DIL-070,
 * DOM-DIL-071): yalnız dil okulunda, yönetici ve ön büro. Son kurunun kur sonu kararı onaylı
 * kursiyerler, karar sonucu ve teklif edilen kur ya da seviyeyle listelenir; tutar kurum tarifesidir.
 * Teklif paket satışıyla açılır: indirim yalnız tarifede ilanlı türden seçilir (DOM-FIN-020).
 * Kursiyere bildirim ve ödeme bağlantısı yoktur; kararın gerekçesi ve öğretmen notu gösterilmez.
 */
export function CourseOffersSection({
  canApproveCapException,
  academicYear,
}: {
  canApproveCapException: boolean
  academicYear: number
}) {
  const list = useListState('kur-yenileme', { urlPrefix: 'teklif_' })
  const search = useDebouncedValue(list.state.query).trim()
  const outcome = filterText(list.state.filters.outcome)
  const offers = useCourseOffers({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isProgressionOutcome(outcome) ? { outcome } : {}),
  })
  const panel = useDetailPanel('paket-satis')
  const openSale = panel.open
  const [selling, setSelling] = useState<SaleOffer | null>(null)

  const rows = useMemo(() => offers.data?.data.map(courseOfferRow), [offers.data])
  const columns = useMemo<DataColumn<CourseOfferRow>[]>(
    () => [
      { key: 'studentName', label: 'Kursiyer' },
      { key: 'fromCourse', label: 'Son kur' },
      { key: 'outcome', label: 'Karar' },
      { key: 'target', label: 'Teklif' },
      { key: 'price', label: 'Tarife tutarı' },
      {
        key: 'state',
        label: 'Durum',
        cell: (row) => (
          <span className="grid gap-1">
            <StatusBadge text={row.state.label} tone={row.state.tone} />
            {row.state.note ? (
              <span className="text-sm text-muted-foreground">{row.state.note}</span>
            ) : null}
          </span>
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => {
          if (row.saleId !== null) {
            const saleId = row.saleId
            return (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.studentName} satış ayrıntısını aç`}
                onClick={() => openSale(saleId)}
              >
                Satışı gör
              </Button>
            )
          }
          const offer = row.offer
          return offer ? (
            <Button
              size="sm"
              aria-label={`${row.studentName} için teklif aç`}
              onClick={() => setSelling(offer)}
            >
              Teklif aç
            </Button>
          ) : null
        },
      },
    ],
    [openSale],
  )

  return (
    <section
      aria-labelledby="kur-yenileme-teklifleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2">
        <h2 id="kur-yenileme-teklifleri" className="text-lg font-semibold">
          Kur yenileme teklifleri
        </h2>
        <p className="text-sm text-muted-foreground">
          Kur sonu kararı onaylanan kursiyerler. Geçen kursiyere üst kur, tekrar ve devamsızlık
          kararında aynı kur teklif edilir; tutar yayımdaki tarifeden gelir.
        </p>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={offers.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Kur yenileme teklifleri"
        empty="Kur sonu kararı onaylanmış kursiyer yok."
        emptyFiltered="Bu seçimle eşleşen kursiyer yok."
        loading={offers.isPending}
        fetching={offers.isFetching && !offers.isPending}
        error={
          offers.error ? (
            <QueryError error={offers.error} onRetry={() => void offers.refetch()} />
          ) : undefined
        }
      />
      {selling ? (
        <PackageSaleModal
          canApproveCapException={canApproveCapException}
          academicYear={academicYear}
          offer={selling}
          onClose={() => setSelling(null)}
          onSold={(saleId) => {
            setSelling(null)
            openSale(saleId)
          }}
        />
      ) : null}
      <PackageSalePanel saleId={panel.selectedId} onClose={panel.close} />
    </section>
  )
}
