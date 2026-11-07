import { useState } from 'react'
import type { RubricVersion } from '@kampus/react-shared/use-rubrics.ts'
import type { TaskSubmissionDetail } from '@kampus/react-shared/use-task-submissions.ts'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { RecordingPlayer } from './RecordingPlayer.tsx'
import { recordingTitle, versionRecording } from './recording-review-model.ts'
import { RubricScoreForm } from './RubricScoreForm.tsx'
import { blindVersionView, secondStaleText, showsSecondStaleNotice } from './second-rating-model.ts'
import { dateTimeLabel, learnerLabel } from './task-model.ts'

type Props = {
  submission: TaskSubmissionDetail
  assignmentTitle: string | undefined
  rubric: { version: RubricVersion | null; loading: boolean; error: unknown }
  /** Rubriksiz görevde form açılmaz. */
  noRubric: boolean
}

/**
 * Kör ikinci puan (`second-scores`; DOM-BEC-024): ikinci değerlendirici son sürümü ilk puanı
 * görmeden puanlar. Ekran yalnız `blindVersionView`'ın şeklini çizer: sürüm kartlarındaki puan,
 * puanlayıcı karşılaştırması ve geri bildirim bu görünümde yoktur; ilk puan yanıtta gelse bile
 * çizilmez. Son sürüm dışındaki sürümler gösterilmez (ikinci puan yalnız son sürüme verilir).
 * Uyuşmazlık ve sonuç sunucudadır.
 */
export function BlindSecondScoring({ submission, assignmentTitle, rubric, noRubric }: Props) {
  const [stale, setStale] = useState(false)
  const latestVersion = submission.versions.at(-1)
  const latest = latestVersion ? blindVersionView(latestVersion) : null
  const recording = latest ? versionRecording(latest) : null
  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">
            {learnerLabel(submission)}
          </h3>
          <p className="text-sm text-muted-foreground">{assignmentTitle ?? 'Görev'}</p>
        </div>
        <StatusBadge text="İkinci puan bekliyor" tone="purple" />
      </header>

      <p className="rounded-card border bg-surface-soft p-4 text-sm">
        Kör puanlama: ilk puan size gösterilmez. Teslimi rubrikle bağımsız puanlayın.
      </p>

      {stale ? (
        <p role="alert" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
          {secondStaleText}
        </p>
      ) : null}

      {latest ? (
        <section aria-labelledby="ikinci-puan-teslim" className="grid gap-3">
          <h3 id="ikinci-puan-teslim" className="text-md font-semibold">
            Son teslim · Sürüm {latest.number}
          </h3>
          <article
            aria-label={`Sürüm ${latest.number}`}
            className="grid gap-3 rounded-card border p-4"
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{dateTimeLabel(latest.submittedAt)}</span>
              {latest.late ? <StatusBadge text="Geç teslim" tone="red" /> : null}
              {latest.wordCount !== null ? (
                <span className="text-muted-foreground">{latest.wordCount} sözcük</span>
              ) : null}
            </div>
            {recording ? (
              <RecordingPlayer file={recording} title={recordingTitle('staff', latest.number)} />
            ) : (
              <p className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                {latest.body ?? ''}
              </p>
            )}
          </article>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Henüz gönderilmiş sürüm yok.</p>
      )}

      <section aria-labelledby="ikinci-puan-formu" className="grid gap-3 border-t pt-5">
        <h3 id="ikinci-puan-formu" className="text-md font-semibold">
          İkinci puan{latest ? ` · Sürüm ${latest.number}` : ''}
        </h3>
        {noRubric ? (
          <p className="text-sm text-muted-foreground">
            Bu görev rubrikle puanlanmaz; bu ekrandan puan verilemez.
          </p>
        ) : rubric.error ? (
          <QueryError error={rubric.error} />
        ) : rubric.loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Rubrik yükleniyor…
          </p>
        ) : !rubric.version ? (
          <p role="alert" className="text-sm text-destructive">
            Görevin rubrik sürümü bulunamadı; puanlama yapılamıyor.
          </p>
        ) : latest ? (
          // Anahtar sürüm numarasıdır: yeni sürüm gelirse form sıfırlanır.
          <RubricScoreForm
            key={`${submission.id}-${latest.number}`}
            kind="second"
            submission={submission}
            rubric={rubric.version}
            versionNumber={latest.number}
            staleOn={showsSecondStaleNotice}
            onStaleChange={setStale}
          />
        ) : null}
      </section>
    </div>
  )
}
