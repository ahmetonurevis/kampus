import { useMyTeacherFeedbackResults } from '@kampus/react-shared/use-finance-teacher-feedback.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { QueryError } from '@/components/QueryError.tsx'
import {
  TeacherFeedbackResultBody,
  TeacherFeedbackTrendTable,
} from './FinanceTeacherFeedbackResult.tsx'

const day = (value: string) => dateLabel(`${value}T09:00:00.000Z`, { year: 'numeric' })

/**
 * "Geri bildirim sonuçlarım" (DOM-FIN-159; ON-213; K-532): öğretmen yalnız kendi sonucunu görür.
 * Kapanan anketlerdeki ortalama, dağılım, eşik üstündeki yorumlar, sınıf kırılımı ve dönemler
 * arası eğilim. Eşik altındaki dönemde sonuç ve yorum gösterilmez. Öğretmen menüsüne bağlanması
 * rol kabuğundadır; bileşen kendi verisini `GET /finance/teacher-feedback-results/mine`'dan okur.
 */
export function TeacherFeedbackMineView() {
  const mine = useMyTeacherFeedbackResults()
  const view = mine.data?.data
  return (
    <section
      aria-labelledby="geri-bildirim-sonuclarim"
      className="panel overflow-hidden rounded-card border bg-surface px-6 py-6"
    >
      <h2 id="geri-bildirim-sonuclarim" className="text-lg font-semibold">
        Geri bildirim sonuçlarım
      </h2>
      <p className="text-sm text-muted-foreground">
        Öğrenci ve velilerin anonim değerlendirmeleri. Sonuç anket kapanınca ve en az eşik kadar
        yanıtla gösterilir; kimin ne yazdığı görünmez.
      </p>
      {mine.error ? (
        <QueryError error={mine.error} onRetry={() => void mine.refetch()} />
      ) : view === undefined ? (
        <p className="mt-3 text-sm">Sonuçlar yükleniyor…</p>
      ) : view.teacherId === null ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Hesabınız bir öğretmen kaydına bağlı değil; okul yönetimine başvurun.
        </p>
      ) : view.surveys.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Henüz kapanmış geri bildirim yok.</p>
      ) : (
        <div className="mt-3 grid gap-6">
          <TeacherFeedbackTrendTable trend={view.trend} caption="Dönemler arası eğilim" />
          {view.surveys.map((survey) => (
            <article
              key={survey.surveyId}
              aria-label={`${survey.term} sonucu`}
              className="grid gap-2 border-t pt-3"
            >
              <h3 className="font-semibold">
                {survey.title} · {survey.term}
              </h3>
              <p className="text-sm text-muted-foreground">Kapanış {day(survey.closeDate)}</p>
              <TeacherFeedbackResultBody
                result={survey}
                threshold={survey.threshold}
                label={survey.term}
              />
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
