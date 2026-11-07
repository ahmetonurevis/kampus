// Tarayıcıda dosya indirme. Geçici URL indirmeden sonra temizlenir.
import { csvFilename, toCsv } from './csv.ts'
import type { ListColumn } from './list-view.ts'
import { notify } from './notify.ts'

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Filtrelenmiş/sıralanmış tüm sonuçları CSV olarak indirir (yalnız görünen sayfa değil). */
export function exportCsv(
  name: string,
  columns: readonly ListColumn[],
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
) {
  const content = toCsv(columns, rows)
  saveBlob(new Blob(['﻿', content], { type: 'text/csv;charset=utf-8' }), csvFilename(name))
  notify.success('Rapor indirildi.')
}
