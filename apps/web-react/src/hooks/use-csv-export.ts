import { useState } from 'react'
import { CollectionTooLargeError } from '@kampus/react-shared/collections.ts'
import { exportCsv } from '@/lib/download.ts'
import type { ListColumn } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'

type CsvRows = ReadonlyArray<Readonly<Record<string, unknown>>>

const FAILED = 'Liste indirilemedi. Lütfen yeniden deneyin.'

/**
 * Sunucu sayfalı listenin CSV'si: satırlar `load` ile (bütün sayfalar, aynı filtre/sıralama)
 * çekilir, sonra indirilir. İndirme sürerken `busy` doğrudur; düğme kilitlenir.
 */
export function useCsvExport() {
  const [busy, setBusy] = useState(false)

  async function download(
    name: string,
    columns: readonly ListColumn[],
    load: () => Promise<CsvRows>,
  ) {
    if (busy) return
    setBusy(true)
    try {
      exportCsv(name, columns, await load())
    } catch (error) {
      notify.error(error instanceof CollectionTooLargeError ? error.message : FAILED, error)
    } finally {
      setBusy(false)
    }
  }

  return { busy, download } as const
}
