import { useState } from 'react'
import { useRubricVersion, type RubricVersion } from '@kampus/react-shared/use-rubrics.ts'
import { useTaskSubmission } from '@kampus/react-shared/use-task-submissions.ts'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import {
  compareRaterScores,
  finalScoreState,
  finalStaleText,
  showsFinalStaleNotice,
} from './dispute-model.ts'
import { RubricScoreForm } from './RubricScoreForm.tsx'
import { ScoreCard } from './SubmissionGradingModal.tsx'
import { dateTimeLabel } from './task-model.ts'
import { useTaskLookups } from './use-task-lookups.ts'

type Props = {
  /** `''` kapalı; aksi hâlde uyuşmazlıklı teslimin kimliği. */
  submissionId: string
  /** Kuyruk satırındaki görev başlığı; koordinatör atamayı göremeyebilir (DOM-YTK-027). */
  assignmentTitle: string | undefined
  onClose: () => void
}

/**
 * Son puan penceresi (`?son-puan=`; OG-058, DOM-BEC-024, DOM-YTK-027): son sürümün metni, ilk ve
 * ikinci puan kriter bazında yan yana (sunucunun bildirdiği uyuşmazlık kriterleri işaretli), iki
 * puanın ayrıntısı ve koordinatörün rubrikli son puan formu. Form yalnız sunucu `canResolve`
 * derse açılır; puanlayıcı koordinatör kör kalır ve iki puanı görmez. Rubrik sürümü puanın
 * sabitlediği sürümdür; atama okunmaz (alanındaki koordinatör atamayı görmeyebilir).
 */
export function FinalScoreModal({ submissionId, assignmentTitle, onClose }: Props) {
  return (
    <Modal
      open={submissionId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Son puanı ver"
      size="wide"
    >
      {submissionId ? (
        <FinalScoreBody
          submissionId={submissionId}
          assignmentTitle={assignmentTitle}
          onScored={onClose}
        />
      ) : null}
    </Modal>
  )
}

function FinalScoreBody({
  submissionId,
  assignmentTitle,
  onScored,
}: {
  submissionId: string
  assignmentTitle: string | undefined
  onScored: () => void
}) {
  const detail = useTaskSubmission(submissionId)
  const submission = detail.data?.data
  const latest = submission?.versions.at(-1) ?? null
  const grading = latest?.grading ?? null
  const rubricVersionId = grading?.raterScores[0]?.score.rubricVersionId ?? null
  const rubricQuery = useRubricVersion(rubricVersionId)
  const rubric = rubricQuery.data?.data ?? null
  const { names } = useTaskLookups()
  const [stale, setStale] = useState(false)

  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  if (!submission) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Teslim yükleniyor…
      </p>
    )
  }
  const state = finalScoreState(grading)
  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">
            {names.studentName(submission.learnerId)}
          </h3>
          <p className="text-sm text-muted-foreground">
            {assignmentTitle ?? 'Görev'}
            {latest ? ` · Sürüm ${latest.number} · ${dateTimeLabel(latest.submittedAt)}` : ''}
          </p>
        </div>
        {state.kind === 'resolve' ? (
          <StatusBadge text="Son puan bekliyor" tone="amber" />
        ) : (
          <StatusBadge text={state.label} tone={state.tone} />
        )}
      </header>

      {stale ? (
        <p role="alert" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
          {finalStaleText(state.kind === 'resolve')}
        </p>
      ) : null}

      {latest ? (
        <section aria-labelledby="son-surum-metni" className="grid gap-2">
          <h3 id="son-surum-metni" className="text-md font-semibold">
            Teslim metni
          </h3>
          <p className="rounded-card border p-4 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
            {latest.body ?? ''}
          </p>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Henüz gönderilmiş sürüm yok.</p>
      )}

      {grading && grading.raterScores.length > 0 ? (
        <section aria-labelledby="puan-karsilastirma" className="grid gap-3">
          <h3 id="puan-karsilastirma" className="text-md font-semibold">
            Puanlayıcıların bantları
          </h3>
          <Comparison grading={grading} rubric={rubric} />
          <div className="grid gap-3 md:grid-cols-2">
            {grading.raterScores.map((item) => (
              <div key={item.raterRole} className="grid gap-2">
                <h4 className="text-sm font-semibold">{RATER_LABELS[item.raterRole]}</h4>
                <ScoreCard score={item.score} rubric={rubric} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="son-puan-formu" className="grid gap-3 border-t pt-5">
        <h3 id="son-puan-formu" className="text-md font-semibold">
          Son puan
        </h3>
        {state.kind === 'notice' ? (
          <p className="text-sm text-muted-foreground">{state.text}</p>
        ) : rubricQuery.error ? (
          <QueryError error={rubricQuery.error} onRetry={() => void rubricQuery.refetch()} />
        ) : !rubric || !latest ? (
          <p role="status" className="text-sm text-muted-foreground">
            Rubrik yükleniyor…
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Teslimi iki puanı göz önünde tutarak rubrikle yeniden puanlayın. Son puan sonucu
              kesinleştirir; geri bildirim öğrenciye ve velisine açılır.
            </p>
            {/* Anahtar sürüm numarasıdır: yeni sürüm gelirse form sıfırlanır. */}
            <RubricScoreForm
              key={`${submission.id}-${latest.number}`}
              kind="final"
              submission={submission}
              rubric={rubric}
              versionNumber={latest.number}
              staleOn={showsFinalStaleNotice}
              onStaleChange={setStale}
              onScored={onScored}
            />
          </>
        )}
      </section>
    </div>
  )
}

const RATER_LABELS = {
  first: 'İlk puan',
  second: 'İkinci puan',
  final: 'Son puan',
} as const

function Comparison({
  grading,
  rubric,
}: {
  grading: Parameters<typeof compareRaterScores>[1]
  rubric: RubricVersion | null
}) {
  if (!rubric) return null
  const rows = compareRaterScores(rubric.criteria, grading)
  return (
    <div className="overflow-x-auto rounded-card border">
      <table className="w-full text-sm">
        <caption className="sr-only">Kriter bazında ilk ve ikinci puan</caption>
        <thead>
          <tr className="border-b text-left">
            <th scope="col" className="px-4 py-2 font-medium">
              Kriter
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              İlk puan
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              İkinci puan
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Durum
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.criterionId} className="border-b last:border-b-0">
              <th scope="row" className="px-4 py-2 text-left font-medium">
                {row.label}
              </th>
              <td className="px-4 py-2">{row.first ?? '—'}</td>
              <td className="px-4 py-2">{row.second ?? '—'}</td>
              <td className="px-4 py-2">
                {row.disputed ? (
                  <StatusBadge text="Uyuşmazlık" tone="red" />
                ) : (
                  <span className="text-muted-foreground">Uyumlu</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
