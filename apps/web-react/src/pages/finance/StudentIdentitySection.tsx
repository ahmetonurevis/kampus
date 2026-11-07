import { isApiError } from '@kampus/api-client/errors.ts'
import { useStudentIdentityReveal } from '@kampus/react-shared/enrollment-identity.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'

const KIND_LABELS: Record<string, string> = {
  tc: 'T.C. kimlik numarası',
  foreign: 'Yabancı kimlik / pasaport',
}

/**
 * Öğrencinin kimlik özeti (ON-063): yönetici ve ön büro sözleşmeyi incelerken kimliği maskeli
 * görür. Her okuma denetim kaydı ürettiği için (DOM-YTK-052) açılışta okunmaz; "Kimliği göster"
 * ile okunur, "Gizle" ile bellekten atılır. Uç kayıt modülüne (`crm`) bağlıdır; modül kapalıysa
 * bölüm görünmez.
 */
export function StudentIdentitySection({ studentId }: { studentId: string }) {
  const { session } = useAuth()
  const learner = useEnrollmentLearner()
  const reveal = useStudentIdentityReveal(studentId)
  const staff = session?.role === 'yonetici' || session?.role === 'onburo'
  if (!staff || session?.modules.crm !== true || studentId === '') return null
  const identity = reveal.query.data?.data
  return (
    <section aria-labelledby="kimlik-ozeti" className="mb-5 rounded-card border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="kimlik-ozeti" className="font-semibold">
          Kimlik bilgisi
        </h4>
        {reveal.revealed ? (
          <Button type="button" variant="ghost" size="sm" onClick={reveal.hide}>
            <Icon name="EyeOff" size={15} aria-hidden="true" />
            Gizle
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={reveal.show}>
            <Icon name="Eye" size={15} aria-hidden="true" />
            Kimliği göster
          </Button>
        )}
      </div>
      {!reveal.revealed ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Kimlik numarası maskeli gösterilir; her görüntüleme denetim kaydına yazılır.
        </p>
      ) : isApiError(reveal.query.error) && reveal.query.error.status === 404 ? (
        <p role="status" className="mt-1 text-sm text-muted-foreground">
          Bu {learner.noun} için kimlik kaydı yok; kimlik kesin kayıtta alınır.
        </p>
      ) : reveal.query.error ? (
        <div className="mt-2">
          <QueryError error={reveal.query.error} onRetry={() => void reveal.query.refetch()} />
        </div>
      ) : !identity ? (
        <p role="status" className="mt-1 text-sm text-muted-foreground">
          Kimlik bilgisi yükleniyor…
        </p>
      ) : (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{KIND_LABELS[identity.kind] ?? 'Kimlik'}</dt>
          <dd className="font-mono">{identity.maskedNumber}</dd>
          <dt className="text-muted-foreground">Doğum tarihi</dt>
          <dd>{dateLabel(identity.birthDate, { year: 'numeric' })}</dd>
          <dt className="text-muted-foreground">Kayıt yılı</dt>
          <dd>
            {identity.academicYear}–{identity.academicYear + 1}
          </dd>
        </dl>
      )}
    </section>
  )
}
