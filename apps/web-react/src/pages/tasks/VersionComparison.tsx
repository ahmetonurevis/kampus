import { useState } from 'react'
import {
  chooseCompareVersion,
  findVersion,
  resolveComparePair,
  versionFacts,
  versionOptionLabel,
  wordDifference,
  type ComparePair,
  type SubmissionVersion,
} from '@kampus/react-shared/writing-model.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

const SIDES = [
  { side: 'left', label: 'Birinci sürüm' },
  { side: 'right', label: 'İkinci sürüm' },
] as const satisfies readonly { side: keyof ComparePair; label: string }[]

/**
 * İki teslim sürümünün yan yana karşılaştırması (IST-047; DOM-BEC-040, 044): varsayılan son iki
 * sürümdür, öğretmen iki sütunun sürümünü ayrı seçer (aynı sürüm seçilirse sütunlar yer
 * değiştirir). Masaüstünde iki sütun, dar ekranda alt alta; metin yüzeyi opaktır. Her sütunda
 * gönderim zamanı, sözcük sayısı, geç teslim rozeti ve o sürüm için istenen yeniden teslim turu
 * (istenme zamanı ve son tarih, Europe/Istanbul) görünür. Tek sürümde hiçbir şey çizilmez.
 */
export function VersionComparison({ versions }: { versions: readonly SubmissionVersion[] }) {
  const [selection, setSelection] = useState<ComparePair | null>(null)
  const pair = resolveComparePair(versions, selection)
  if (pair === null) return null
  const left = findVersion(versions, pair.left)
  const right = findVersion(versions, pair.right)
  if (left === null || right === null) return null
  const difference = wordDifference(left, right)

  return (
    <section aria-labelledby="surum-karsilastirma" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 id="surum-karsilastirma" className="text-md font-semibold">
          Sürümleri karşılaştır
        </h3>
        <div className="flex flex-wrap gap-3">
          {SIDES.map(({ side, label }) => (
            <label key={side} className="grid gap-1 text-sm font-medium">
              {label}
              <NativeSelect
                value={pair[side]}
                onChange={(event) =>
                  setSelection(chooseCompareVersion(pair, side, Number(event.target.value)))
                }
                className="min-h-9 text-sm"
              >
                {versions.map((version) => (
                  <NativeSelectOption key={version.id} value={version.number}>
                    {versionOptionLabel(version)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ))}
        </div>
      </div>
      {/* Bölge hep yerinde: yalnız içeriği değişir, ekran okuyucu değişimi okur. */}
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {difference}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <CompareColumn version={left} />
        <CompareColumn version={right} />
      </div>
    </section>
  )
}

function CompareColumn({ version }: { version: SubmissionVersion }) {
  return (
    <article
      aria-label={`Karşılaştırılan sürüm ${version.number}`}
      className="grid min-w-0 content-start gap-3 rounded-card border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-semibold">Sürüm {version.number}</h4>
        {version.late ? <StatusBadge text="Geç teslim" tone="red" /> : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {versionFacts(version).map((fact) => (
          <div key={fact.label} className="contents">
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {version.wordCount?.warning ? (
        <p className="text-sm text-warning">{version.wordCount.warning}</p>
      ) : null}
      <p
        lang="en"
        className="border-t pt-3 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
      >
        {version.body ?? ''}
      </p>
    </article>
  )
}
