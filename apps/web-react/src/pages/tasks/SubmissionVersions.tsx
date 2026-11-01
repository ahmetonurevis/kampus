import type { TaskSubmissionDetail } from '@kampus/react-shared/use-task-submissions.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'

type Version = TaskSubmissionDetail['versions'][number]

const stamp = (iso: string) => `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`

/**
 * Gönderilen değişmez sürümler (DOM-BEC-040), yeniden eskiye. Puan ve geri bildirim yalnız sunucu
 * açtıysa (`score` dolu ve kesinleşmiş) çizilir; aksi hâlde sürümde puana dair hiçbir ifade yoktur
 * (DOM-BEC-045). Kriter adları öğrenciye açık olmadığından kriterler sıra numarasıyla anılır.
 */
export function SubmissionVersions({ versions }: { versions: readonly Version[] }) {
  if (versions.length === 0) return null
  return (
    <ol aria-label="Gönderilen sürümler" className="grid gap-4">
      {[...versions].reverse().map((version) => {
        const score = version.score?.settled ? version.score : null
        return (
          <li key={version.id} className="rounded-card border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{version.number}. sürüm</h3>
              <span className="text-sm text-muted-foreground">{stamp(version.submittedAt)}</span>
              {version.late ? <StatusBadge text="Geç teslim" tone="amber" /> : null}
              {version.wordCount ? (
                <StatusBadge text={`${version.wordCount.count} sözcük`} tone="gray" />
              ) : null}
              {score ? <StatusBadge text={`Puan ${score.percent} / 100`} tone="green" /> : null}
            </div>
            {version.wordCount?.warning ? (
              <p className="mt-2 text-sm text-warning">{version.wordCount.warning}</p>
            ) : null}
            {version.body ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-primary">
                  Gönderdiğiniz metni göster
                </summary>
                <p lang="en" className="mt-2 text-sm whitespace-pre-line [overflow-wrap:anywhere]">
                  {version.body}
                </p>
              </details>
            ) : null}
            {score ? (
              <div className="mt-3 grid gap-2 border-t pt-3 text-sm">
                <h4 className="font-medium">Öğretmen geri bildirimi</h4>
                {score.overallComment ? (
                  <p className="[overflow-wrap:anywhere]">{score.overallComment}</p>
                ) : null}
                <ul className="grid gap-1">
                  {score.criteria.map((criterion, index) => (
                    <li key={criterion.criterionId}>
                      <span className="font-medium">
                        {index + 1}. kriter: {criterion.band}. bant
                      </span>
                      {criterion.comment ? (
                        <span className="text-muted-foreground"> · {criterion.comment}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
