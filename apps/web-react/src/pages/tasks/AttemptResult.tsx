import type { TaskAttemptDetail } from '@kampus/react-shared/use-task-attempts.ts'
import { Icon } from '@/components/Icon.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { describeKey, describeResponse } from './student-task-model.ts'
import { SubskillBreakdown } from './SubskillBreakdown.tsx'

type Props = { attempt: TaskAttemptDetail; title: string }

/**
 * Tamamlanan denemenin sonucu (DOM-BEC-045): kursiyer yalnız kendi toplam puanını görür; madde
 * sonuçları, doğru cevaplar ve açıklamalar yalnız sunucu açtıysa (`items`/`answerKey` dolu)
 * gelir. Açılmadıysa bu alanlar hiç çizilmez; nedenine dair ipucu verilmez. Okuma-anlama
 * etkinliğinin alt beceri dökümü (DOM-BEC-006) aynı kuralla açılır.
 */
export function AttemptResult({ attempt, title }: Props) {
  const result = attempt.result
  const items = result?.items ?? null
  const keys = result?.answerKey ?? null
  if (!result)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Sonuç yükleniyor…
      </p>
    )
  return (
    <section aria-labelledby="sonuc-baslik" className="grid gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid size-14 place-items-center rounded-full bg-primary-soft text-primary">
          <Icon name="Award" size={28} aria-hidden="true" />
        </span>
        <div>
          <h3 id="sonuc-baslik" className="text-lg font-semibold">
            {attempt.attemptNumber}. deneme sonucu
          </h3>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{title}</p>
        </div>
        <p
          className="ml-auto text-3xl font-semibold"
          aria-label={`Puan 100 üzerinden ${result.percent}`}
        >
          {result.percent}
          <small className="text-base text-muted-foreground"> / 100</small>
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge text={`${result.earned} / ${result.possible} puan`} tone="purple" />
        {attempt.late ? <StatusBadge text="Geç teslim" tone="amber" /> : null}
        {attempt.autoSubmitted ? (
          <StatusBadge text="Süre dolduğu için teslim edildi" tone="amber" />
        ) : null}
      </div>
      <SubskillBreakdown subskills={result.subskills} />
      {items && keys ? (
        <ol aria-label="Soru soru sonuç" className="grid gap-3">
          {attempt.questions.map((question, index) => {
            const score = items.find(
              (item) => item.questionVersionId === question.questionVersionId,
            )
            const key = keys.find((item) => item.questionVersionId === question.questionVersionId)
            const correct = score !== undefined && score.correctParts === score.parts
            return (
              <li key={question.questionVersionId} className="rounded-card border p-4">
                <p className="flex items-start gap-2 font-medium">
                  <Icon
                    name={correct ? 'CircleCheck' : 'X'}
                    size={18}
                    className={correct ? 'mt-0.5 text-success' : 'mt-0.5 text-danger'}
                    aria-hidden="true"
                  />
                  <span lang="en" className="[overflow-wrap:anywhere]">
                    {index + 1}. {question.question.stem}
                  </span>
                  <span className="sr-only">{correct ? 'Doğru' : 'Yanlış veya eksik'}</span>
                </p>
                <p className="mt-2 text-sm">
                  <span className="text-muted-foreground">Cevabınız: </span>
                  <span lang="en">
                    {describeResponse(
                      question.question,
                      attempt.answers[question.questionVersionId],
                    )}
                  </span>
                </p>
                {key ? (
                  <>
                    <p className="mt-1 text-sm">
                      <span className="text-muted-foreground">Doğru cevap: </span>
                      <span lang="en">{describeKey(question.question, key.answerKey)}</span>
                    </p>
                    {key.answerKey.explanation ? (
                      <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {key.answerKey.explanation}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </li>
            )
          })}
        </ol>
      ) : null}
    </section>
  )
}
