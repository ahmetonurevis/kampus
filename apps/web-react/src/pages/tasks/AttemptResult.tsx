import type { TaskAttemptDetail } from '@kampus/react-shared/use-task-attempts.ts'
import { Icon } from '@/components/Icon.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { ListeningRecording } from './ListeningRecording.tsx'
import {
  attemptContentNote,
  attemptResultHeading,
  describeKey,
  describeResponse,
  formatPoints,
  itemOutcome,
  responseLabel,
  type ResultAudience,
} from './student-task-model.ts'
import { SubskillBreakdown } from './SubskillBreakdown.tsx'

type Props = {
  attempt: TaskAttemptDetail
  title: string
  /** Kim bakıyor: kursiyer kendi cevabını, personel öğrencinin, veli çocuğunun cevabını okur. */
  audience?: ResultAudience
}

/**
 * Tamamlanan denemenin sonucu (DOM-BEC-045): kursiyer yalnız kendi toplam puanını görür; madde
 * sonuçları, doğru cevaplar ve açıklamalar yalnız sunucu açtıysa (`items`/`answerKey` dolu)
 * gelir. Açılmadıysa bu alanlar hiç çizilmez; nedenine dair ipucu verilmez. Okuma-anlama
 * etkinliğinin alt beceri dökümü (DOM-BEC-006) aynı kuralla açılır. Personel tamamlanan denemede
 * madde sonuçlarını anahtar açılmadan da alır (OG-983): soru başına cevap ve madde sonucu çizilir,
 * doğru cevap yalnız anahtar geldiyse. İçerik kapalıysa (`contentUnavailable`; kaldırma, askı ya da
 * lisans) soru metni ve anahtar gelmez: soru listesi yerine sakin not çizilir, puan kalır.
 * Kaldırılmış içerikte (`contentRemoved`; DOM-KYN-051) not "Bu içerik kaldırıldı" der; cevap
 * anahtarı silindiği için puan hesaplanamıyorsa (`result: null`) başlık ve not çizilir.
 * Dinleme etkinliğinin kaydı (IST-045, DOM-BEC-005) kursiyer ve velide burada, deneme kimliği
 * gönderilmeden çalınır (hak sayılmaz); personel kaydı deneme penceresinin başında görür
 * (`AttemptReviewModal`). Kaldırılmış içerikte kayıt gelmez.
 */
export function AttemptResult({ attempt, title, audience = 'learner' }: Props) {
  const result = attempt.result
  const items = result?.items ?? null
  const keys = result?.answerKey ?? null
  const note = attemptContentNote(attempt)
  const heading = (
    <div>
      <h3 id="sonuc-baslik" className="text-lg font-semibold">
        {attemptResultHeading(attempt)}
      </h3>
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{title}</p>
    </div>
  )
  if (!result)
    return attempt.contentRemoved ? (
      <section aria-labelledby="sonuc-baslik" className="grid gap-3">
        {heading}
        <p role="status" className="text-sm text-muted-foreground">
          {note}
        </p>
      </section>
    ) : (
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
        {heading}
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
      {attempt.listeningRecording && audience !== 'staff' && !attempt.contentRemoved ? (
        <ListeningRecording
          recording={attempt.listeningRecording}
          listening={attempt.listening}
          mode="review"
          audience={audience}
          headingLevel={4}
          className="p-4 max-[650px]:p-4"
        />
      ) : null}
      <SubskillBreakdown subskills={result.subskills} />
      {note ? (
        // Kapalı içerikte soru metni ve anahtar gelmez (DOM-KYN-025, 051); puan ve döküm kalır.
        <p role="status" className="text-sm text-muted-foreground">
          {note}
        </p>
      ) : items ? (
        <ol aria-label="Soru soru sonuç" className="grid gap-3">
          {attempt.questions.map((question, index) => {
            const score = items.find(
              (item) => item.questionVersionId === question.questionVersionId,
            )
            const key = keys?.find((item) => item.questionVersionId === question.questionVersionId)
            const outcome = score ? itemOutcome(score) : null
            const correct = outcome?.tone === 'green'
            return (
              <li key={question.questionVersionId} className="rounded-card border p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <p className="flex min-w-0 flex-1 items-start gap-2 font-medium">
                    <Icon
                      name={correct ? 'CircleCheck' : 'X'}
                      size={18}
                      className={correct ? 'mt-0.5 text-success' : 'mt-0.5 text-danger'}
                      aria-hidden="true"
                    />
                    <span lang="en" className="[overflow-wrap:anywhere]">
                      {index + 1}. {question.question.stem}
                    </span>
                  </p>
                  {score && outcome ? (
                    <span className="flex flex-wrap gap-1.5">
                      <StatusBadge text={outcome.label} tone={outcome.tone} />
                      <StatusBadge
                        text={`${formatPoints(score.earned)} / ${formatPoints(score.points)} puan`}
                        tone="gray"
                      />
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm">
                  <span className="text-muted-foreground">{responseLabel(audience)}</span>
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
