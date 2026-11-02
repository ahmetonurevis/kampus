import { useMemo, useState } from 'react'
import { useAcademicYears } from '@kampus/react-shared/use-academic-years.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import {
  ActivateYearDialog,
  CloseYearDialog,
  RemoveTermDialog,
  type TermRemoval,
} from './AcademicYearDialogs.tsx'
import { AcademicYearPanel } from './AcademicYearPanels.tsx'
import {
  activationPlan,
  closeBlockedReason,
  NEW_YEAR,
  PANEL_PARAM,
  parsePanelTarget,
  termEditPanelValue,
  termNewPanelValue,
  TERM_LIMIT_NOTICE,
  todayKey,
  yearPanelValue,
  yearRow,
  type TermRow,
  type YearRow,
} from './academic-year-rows.ts'
import { MAX_TERMS_PER_YEAR } from '@kampus/school-core/lib/academic-years.ts'

/**
 * Ayarlar → Eğitim yılı (yalnız yönetici, IST-011; DOM-YTK-063…066). Eğitim yılı platform
 * yeteneğidir, modüle bağlı değildir. Her yıl kendi bloğunda ad, tarih aralığı, durum ve (etkinse)
 * "Etkin yıl" rozetiyle görünür; dönemleri altındaki tabloda eklenir, düzenlenir, kaldırılır.
 * Oluşturma ve düzenleme sağ panelde (`?yil=`), etkinleştirme, kapatma ve dönem kaldırma
 * onay penceresindedir. Kapanmış yıl salt okunurdur.
 */
export function AcademicYearSection() {
  const { session } = useAuth()
  const years = useAcademicYears()
  const rows = useMemo(() => years.data?.data.map(yearRow), [years.data])
  const panel = useDetailPanel(PANEL_PARAM)
  const target = parsePanelTarget(panel.selectedId)
  const [activating, setActivating] = useState<number | null>(null)
  const [closing, setClosing] = useState<number | null>(null)
  const [removal, setRemoval] = useState<TermRemoval | null>(null)
  const today = todayKey()
  const institutionType = session?.institution.type ?? 'school'

  async function reload() {
    const fresh = await years.refetch()
    return fresh.data?.data.map(yearRow)
  }

  if (years.error)
    return (
      <section className="panel rounded-card border bg-surface px-6 py-8">
        <QueryError error={years.error} onRetry={() => void years.refetch()} />
      </section>
    )

  const plan =
    activating !== null && rows ? activationPlan(rows, activating, institutionType, today) : null
  // Satır kapatılamaz hâle geldiyse (başka yönetici kapattı) pencere kendiliğinden kapanır.
  const closingRow = rows?.find((row) => row.startYear === closing && row.canClose) ?? null
  const activatablePlan = plan?.target.canActivate ? plan : null

  return (
    <section
      aria-labelledby="egitim-yili"
      aria-busy={years.isLoading || undefined}
      className="panel rounded-card border bg-surface"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-6 py-5 max-[650px]:px-4">
        <div className="min-w-0">
          <h2 id="egitim-yili" className="text-lg font-semibold">
            Eğitim yılı ve dönemler
          </h2>
          <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">
            Kurumda tek etkin yıl bulunur. Yeni yılı etkinleştirmek önceki etkin yılı kapatır ve bu
            geri alınamaz. Günler Europe/Istanbul takvimiyle gösterilir.
          </p>
        </div>
        <Button onClick={() => panel.open(NEW_YEAR)}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Eğitim yılı oluştur
        </Button>
      </div>
      {years.isLoading ? (
        <p role="status" className="px-6 py-6 text-sm text-muted-foreground">
          Eğitim yılları yükleniyor…
        </p>
      ) : rows && rows.length === 0 ? (
        <p role="status" className="px-6 py-6 text-sm text-muted-foreground">
          Henüz eğitim yılı tanımlı değil. &quot;Eğitim yılı oluştur&quot; ile başlayın.
        </p>
      ) : (
        <ul className="divide-y">
          {rows?.map((row) => (
            <li key={row.startYear}>
              <YearBlock
                row={row}
                today={today}
                onEdit={() => panel.open(yearPanelValue(row.startYear))}
                onActivate={() => setActivating(row.startYear)}
                onClose={() => setClosing(row.startYear)}
                onAddTerm={() => panel.open(termNewPanelValue(row.startYear))}
                onEditTerm={(term) => panel.open(termEditPanelValue(row.startYear, term.id))}
                onRemoveTerm={(term) => setRemoval({ year: row, term })}
              />
            </li>
          ))}
        </ul>
      )}
      <AcademicYearPanel target={target} rows={rows} reload={reload} onClose={panel.close} />
      <ActivateYearDialog plan={activatablePlan} onClose={() => setActivating(null)} />
      <CloseYearDialog row={closingRow} onClose={() => setClosing(null)} />
      <RemoveTermDialog
        removal={removal && rows ? currentRemoval(rows, removal) : null}
        onClose={() => setRemoval(null)}
      />
    </section>
  )
}

/** Onay penceresindeki dönem güncel listeden okunur (sürüm eskimesin); dönem kalmadıysa kapanır. */
function currentRemoval(rows: readonly YearRow[], removal: TermRemoval): TermRemoval | null {
  const year = rows.find((row) => row.startYear === removal.year.startYear)
  const term = year?.terms.find((item) => item.id === removal.term.id)
  return year?.canEdit && term ? { year, term } : null
}

type YearBlockProps = {
  row: YearRow
  today: string
  onEdit: () => void
  onActivate: () => void
  onClose: () => void
  onAddTerm: () => void
  onEditTerm: (term: TermRow) => void
  onRemoveTerm: (term: TermRow) => void
}

function YearBlock({
  row,
  today,
  onEdit,
  onActivate,
  onClose,
  onAddTerm,
  onEditTerm,
  onRemoveTerm,
}: YearBlockProps) {
  const headingId = `yil-${row.startYear}`
  const closeBlock = row.canClose ? closeBlockedReason(row, today) : null
  const hintId = closeBlock ? `${headingId}-kapatma-notu` : undefined
  return (
    <article aria-labelledby={headingId} className="grid gap-4 px-6 py-5 max-[650px]:px-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={headingId} className="text-base font-semibold">
              {row.name}
            </h3>
            {row.isActive ? (
              <StatusBadge text="Etkin yıl" tone="green" />
            ) : (
              <StatusBadge text={row.statusLabel} tone={row.tone} />
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{row.rangeLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {row.canEdit ? (
            <Button
              variant="secondary"
              size="sm"
              aria-label={`${row.name} yılını düzenle`}
              onClick={onEdit}
            >
              <Icon name="Pencil" size={15} aria-hidden="true" />
              Düzenle
            </Button>
          ) : null}
          {row.canActivate ? (
            <Button size="sm" aria-label={`${row.name} yılını etkinleştir`} onClick={onActivate}>
              <Icon name="Check" size={15} aria-hidden="true" />
              Etkinleştir
            </Button>
          ) : null}
          {row.canClose ? (
            <Button
              variant="outline"
              size="sm"
              aria-label={`${row.name} yılını kapat`}
              aria-describedby={hintId}
              disabled={closeBlock !== null}
              onClick={onClose}
            >
              <Icon name="Lock" size={15} aria-hidden="true" />
              Yılı kapat
            </Button>
          ) : null}
        </div>
      </header>
      {closeBlock ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {closeBlock}
        </p>
      ) : null}
      <TermsTable row={row} onAdd={onAddTerm} onEdit={onEditTerm} onRemove={onRemoveTerm} />
    </article>
  )
}

function TermsTable({
  row,
  onAdd,
  onEdit,
  onRemove,
}: {
  row: YearRow
  onAdd: () => void
  onEdit: (term: TermRow) => void
  onRemove: (term: TermRow) => void
}) {
  const full = row.terms.length >= MAX_TERMS_PER_YEAR
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Dönemler</h4>
        {row.canEdit ? (
          <Button
            variant="outline"
            size="sm"
            aria-label={`${row.name} yılına dönem ekle`}
            disabled={full}
            onClick={onAdd}
          >
            <Icon name="Plus" size={15} aria-hidden="true" />
            Dönem ekle
          </Button>
        ) : null}
      </div>
      {row.terms.length === 0 ? (
        <p className="rounded-card border border-dashed px-4 py-4 text-sm text-muted-foreground">
          Bu yılda dönem tanımlı değil.
          {row.canEdit ? ' Okulda yıl, en az bir dönem eklenmeden etkinleştirilemez.' : ''}
        </p>
      ) : (
        <div className="rounded-card border">
          <Table aria-label={`${row.name} dönemleri`}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14 max-[650px]:hidden">Sıra</TableHead>
                <TableHead>Dönem</TableHead>
                <TableHead className="max-[650px]:hidden">Tarih aralığı</TableHead>
                {row.canEdit ? <TableHead className="text-right">İşlemler</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {row.terms.map((term) => (
                <TableRow key={term.id}>
                  <TableCell className="max-[650px]:hidden">{term.sequence}</TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="font-medium [overflow-wrap:anywhere]">{term.name}</span>
                    <small className="hidden text-xs text-muted-foreground max-[650px]:block">
                      {term.rangeLabel}
                    </small>
                  </TableCell>
                  <TableCell className="max-[650px]:hidden">{term.rangeLabel}</TableCell>
                  {row.canEdit ? (
                    <TableCell>
                      <span className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={`Dönemi düzenle: ${term.name}`}
                          onClick={() => onEdit(term)}
                        >
                          <Icon name="Pencil" size={15} aria-hidden="true" />
                          Düzenle
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Dönemi kaldır: ${term.name}`}
                          onClick={() => onRemove(term)}
                        >
                          <Icon name="Trash2" size={15} aria-hidden="true" />
                          Kaldır
                        </Button>
                      </span>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {full ? <p className="text-xs text-muted-foreground">{TERM_LIMIT_NOTICE}</p> : null}
    </div>
  )
}
