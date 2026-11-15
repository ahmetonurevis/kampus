import { useMemo, useState } from 'react'
import {
  useCampaignFunnel,
  useCampaignFunnelExport,
} from '@kampus/react-shared/use-prospect-campaigns.ts'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { combineStates, ListCard } from '../dashboard/DashboardParts.tsx'
import { campaignFunnelRows, type CampaignFunnelTableRow } from './prospect-campaign-forms.ts'

const COLUMNS: readonly { key: keyof Omit<CampaignFunnelTableRow, 'id'>; label: string }[] = [
  { key: 'campaign', label: 'Kampanya' },
  { key: 'channel', label: 'Kanal' },
  { key: 'prospects', label: 'Aday' },
  { key: 'meetings', label: 'Görüşme' },
  { key: 'offers', label: 'Teklif' },
  { key: 'enrolled', label: 'Kesin kayıt' },
  { key: 'conversion', label: 'Dönüşüm' },
  { key: 'cost', label: 'Maliyet' },
  { key: 'perProspect', label: 'Aday başı' },
  { key: 'perEnrollment', label: 'Kayıt başı' },
]
const DAY = /^\d{4}-\d{2}-\d{2}$/
const BOM = '﻿'

/**
 * Kampanya kırılımı (DOM-KAY-041; `GET /prospects/funnel/campaigns`, IST-117, ON-134): seçilen
 * günlerde açılan adayların kampanya başına aday → görüşme → teklif → kesin kayıt sayıları, dönüşüm
 * ve maliyet. Sayılar birikimlidir ve sunucudan gelir; aralık kampanyanın bütün günlerini
 * kapsamıyorsa birim maliyet "Aralık kısmi" yazar (K-290). CSV aynı tabloyu sunucudan indirir.
 */
export function ProspectCampaignFunnelSection() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const reversed = DAY.test(dateFrom) && DAY.test(dateTo) && dateTo < dateFrom
  const range = {
    ...(DAY.test(dateFrom) ? { dateFrom } : {}),
    ...(DAY.test(dateTo) ? { dateTo } : {}),
  }
  const funnel = useCampaignFunnel(range, { enabled: !reversed })
  const exporter = useCampaignFunnelExport()
  const data = funnel.data?.data
  const rows = useMemo(() => (data ? campaignFunnelRows(data) : []), [data])

  async function download() {
    const outcome = await exporter.submit(range)
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    saveBlob(new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }), 'kampanya-hunisi.csv')
    notify.success('Dosya indirildi.')
  }

  return (
    <ListCard
      className="mb-6"
      title="Kampanya bazlı dönüşüm"
      description="Kampanya koduyla açılan adayların kesin kayda yolculuğu ve maliyeti"
      state={combineStates(funnel)}
      isEmpty={data !== undefined && data.total.prospects === 0 && data.rows.length === 0}
      emptyText="Bu aralıkta aday ya da kampanya yok."
      headerExtra={
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor="kampanya-huni-baslangic">Başlangıç</Label>
            <Input
              id="kampanya-huni-baslangic"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="kampanya-huni-bitis">Bitiş</Label>
            <Input
              id="kampanya-huni-bitis"
              type="date"
              value={dateTo}
              aria-invalid={reversed || undefined}
              aria-describedby={reversed ? 'kampanya-huni-bitis-hata' : undefined}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => void download()}
            disabled={reversed || exporter.isPending || data === undefined}
            aria-busy={exporter.isPending || undefined}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            CSV indir
          </Button>
          {reversed ? (
            <p id="kampanya-huni-bitis-hata" role="alert" className="text-sm text-destructive">
              Bitiş günü başlangıç gününden önce olamaz.
            </p>
          ) : null}
        </div>
      }
    >
      {data ? (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            Görüşme ve teklif birikimlidir: ileri adıma ulaşan aday önceki adımları geçmiş sayılır.
            Maliyet kampanyanın toplamıdır; seçilen günler kampanyanın bir kısmını kapsıyorsa birim
            maliyet hesaplanmaz.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Kampanya bazlı dönüşüm</caption>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  {COLUMNS.map((column) => (
                    <th key={column.key} scope="col" className="py-2 pr-4 font-medium">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={row.id === 'toplam' ? 'font-semibold' : 'border-b last:border-0'}
                  >
                    {COLUMNS.map((column) =>
                      column.key === 'campaign' ? (
                        <th
                          key={column.key}
                          scope="row"
                          className="py-2 pr-4 text-left font-medium"
                        >
                          {row.campaign}
                        </th>
                      ) : (
                        <td key={column.key} className="py-2 pr-4 tabular-nums">
                          {row[column.key]}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </ListCard>
  )
}
