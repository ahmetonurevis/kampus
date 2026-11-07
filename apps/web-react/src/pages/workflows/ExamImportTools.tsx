import { useId, useState, type ChangeEvent } from 'react'
import type { State } from '@kampus/school-core/data/seed.ts'
import type { Session as CoreSession } from '@kampus/school-core/lib/domain.ts'
import {
  csvTemplate,
  workflowCsvReferences,
} from '@kampus/school-core/lib/workflow-presentation.ts'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { csvFileProblem, csvSummary } from './workflow-state.ts'

type Props = {
  state: State
  session: CoreSession
  /** Metin alanındaki güncel CSV içeriği; ön kontrol bunun üzerinden yapılır. */
  csv: unknown
  disabled: boolean
  /** Dosyadan okunan metin metin alanına yazılır (tek doğru kaynak form değeridir). */
  onLoad: (text: string) => void
}

/**
 * Deneme sonucu CSV aktarımı yardımcıları (Vue `readCsv`/`downloadTemplate`): şablon indirme,
 * dosya seçme, kimlik eşleştirme listesi ve içerik ön kontrolü. Dosya tarayıcıda okunur;
 * gönderim yine form komutuyla (`Idempotency-Key` ile) yapılır.
 */
export function ExamImportTools({ state, session, csv, disabled, onLoad }: Props) {
  const inputId = useId()
  const [reading, setReading] = useState(false)
  const summary = csvSummary(csv)
  const references = workflowCsvReferences(state, session)

  function downloadTemplate() {
    saveBlob(
      new Blob(['﻿', csvTemplate], { type: 'text/csv;charset=utf-8' }),
      'deneme-sonuc-sablonu.csv',
    )
  }

  async function read(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    const problem = csvFileProblem(file)
    if (problem) {
      notify.error(problem)
      input.value = ''
      return
    }
    setReading(true)
    try {
      onLoad(await file.text())
    } catch (error) {
      notify.error('CSV okunamadı. UTF-8 olarak kaydedip tekrar deneyin.', error)
    } finally {
      setReading(false)
      input.value = ''
    }
  }

  return (
    <section aria-label="CSV dosyası" className="grid gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={downloadTemplate}>
          <Icon name="Download" size={16} aria-hidden="true" />
          CSV şablonunu indir
        </Button>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={inputId} className="text-sm font-medium">
          CSV dosyası seç
        </Label>
        <Input
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          disabled={disabled || reading}
          onChange={(event) => void read(event)}
        />
      </div>
      <p
        role="status"
        className={summary.ok ? 'text-sm text-muted-foreground' : 'text-sm text-danger'}
      >
        {summary.ok ? `${summary.rows} sonuç satırı okundu.` : summary.message}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">CSV kimlik eşleştirme listesi</summary>
        <div className="mt-2 grid gap-1 text-muted-foreground">
          <p>Sınav, öğrenci ve ders kimliklerini bu listeden alabilirsiniz.</p>
          {references.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </details>
    </section>
  )
}
