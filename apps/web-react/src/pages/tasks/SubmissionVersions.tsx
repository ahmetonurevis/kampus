import type { TaskSubmissionDetail } from '@kampus/react-shared/use-task-submissions.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { RecordingPlayer } from './RecordingPlayer.tsx'
import { recordingTitle, versionRecording } from './recording-review-model.ts'
import { submittedTextLabel, type ResultAudience } from './student-task-model.ts'

type Version = TaskSubmissionDetail['versions'][number]

const stamp = (iso: string) => `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`

/**
 * Gönderilen değişmez sürümler (DOM-BEC-040), yeniden eskiye. Puan ve geri bildirim yalnız sunucu
 * açtıysa (`score` dolu ve kesinleşmiş) çizilir; aksi hâlde sürümde puana dair hiçbir ifade yoktur
 * (DOM-BEC-045). Kriter adları öğrenciye açık olmadığından kriterler sıra numarasıyla anılır.
 * Veli (`audience="parent"`) aynı alanları okur; itiraz ve puanlama iç ayrıntısı çizilmez.
 * Konuşma sürümünde kayıt dinlenebilir (IST-052; DOM-BEC-052, 053): bağlantıyı sunucu yalnız
 * kaydın sahibine ve 18 yaş altında velisine verir; açılmayan kayıt "erişilemiyor" der.
 */
export function SubmissionVersions({
  versions,
  audience = 'learner',
  headingLevel = 3,
}: {
  versions: readonly Version[]
  audience?: ResultAudience
  /** Sürüm başlığı düzeyi; geri bildirim başlığı bir alt düzeydedir. Varsayılan öğrenci ekranıdır. */
  headingLevel?: 3 | 4
}) {
  if (versions.length === 0) return null
  const VersionHeading = `h${headingLevel}` as const
  const FeedbackHeading = headingLevel === 3 ? 'h4' : 'h5'
  return (
    <ol aria-label="Gönderilen sürümler" className="grid gap-4">
      {[...versions].reverse().map((version) => {
        const score = version.score?.settled ? version.score : null
        const recording = versionRecording(version)
        return (
          <li key={version.id} className="rounded-card border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <VersionHeading className="font-semibold">{version.number}. sürüm</VersionHeading>
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
            {recording ? (
              <div className="mt-3">
                <RecordingPlayer
                  file={recording}
                  title={recordingTitle(audience, version.number)}
                />
              </div>
            ) : null}
            {version.body ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-primary">
                  {submittedTextLabel(audience)}
                </summary>
                <p lang="en" className="mt-2 text-sm whitespace-pre-line [overflow-wrap:anywhere]">
                  {version.body}
                </p>
              </details>
            ) : null}
            {score ? (
              <div className="mt-3 grid gap-2 border-t pt-3 text-sm">
                <FeedbackHeading className="font-medium">Öğretmen geri bildirimi</FeedbackHeading>
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
