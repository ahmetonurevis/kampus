import { isApiError } from '@kampus/api-client/errors.ts'
import { useConsentStatus, useConsentTexts } from '@kampus/react-shared/use-consents.ts'
import { NO_TEXT_INFO, STUDENT_PURPOSES, purposeLabel } from '@/components/consent/consent-model.ts'
import { QueryError } from '@/components/QueryError.tsx'
import {
  ACCOUNT_LINK_NOTE,
  ACCOUNT_PURPOSE_NOTE,
  CONSENT_OPTIONAL_NOTE,
  enrollmentConsentSummary,
  type ConsentTextState,
} from './enrollment-consent.ts'

const textStateOf = (query: ReturnType<typeof useConsentTexts>[number]): ConsentTextState => {
  if (query.data) return 'ready'
  if (isApiError(query.error) && query.error.code === 'consent_text_not_found') return 'missing'
  return query.isError ? 'error' : 'loading'
}

/**
 * Kesin kayıt sonrası rıza bilgilendirmesi (IST-017; DOM-YTK-057, DOM-YTK-061): personele hangi
 * rızaların bekleneceğini ve kimin nereden vereceğini söyler; rıza almaz. Okuma hatası kaydı geri
 * almaz, başarı ekranının kalanını kapatmaz: yalnız bu bölüm yeniden denenir.
 */
export function EnrollmentConsentNotice({
  studentId,
  adult,
}: {
  studentId: string
  adult: boolean
}) {
  const status = useConsentStatus(studentId)
  const texts = useConsentTexts(STUDENT_PURPOSES)
  const states = texts.map(textStateOf)
  const failure =
    status.error ?? texts.find((_, index) => states[index] === 'error')?.error ?? undefined

  return (
    <section aria-labelledby="kayit-riza" className="grid w-full gap-3 border-t pt-4">
      <h3 id="kayit-riza" className="text-base font-semibold">
        Açık rıza durumu
      </h3>
      {failure ? (
        <QueryError
          error={failure}
          onRetry={() => {
            void status.refetch()
            for (const text of texts) void text.refetch()
          }}
        />
      ) : status.data && !states.includes('loading') ? (
        <Summary
          summary={enrollmentConsentSummary({
            statuses: status.data.data,
            textState: (purpose) => states[STUDENT_PURPOSES.indexOf(purpose)] ?? 'loading',
            adult,
          })}
        />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Rıza durumu okunuyor…
        </p>
      )}
      <p className="text-sm text-muted-foreground">{CONSENT_OPTIONAL_NOTE}</p>
      <p className="text-sm text-muted-foreground">{ACCOUNT_PURPOSE_NOTE}</p>
    </section>
  )
}

function Summary({ summary }: { summary: ReturnType<typeof enrollmentConsentSummary> }) {
  const { awaiting, unavailable, granted } = summary
  return (
    <>
      {awaiting.map((group) => (
        <div key={group.guidance} className="grid gap-1 text-sm">
          <p className="font-medium">Beklenen rızalar</p>
          <ul className="list-disc pl-5">
            {group.purposes.map((purpose) => (
              <li key={purpose}>{purposeLabel(purpose)}</li>
            ))}
          </ul>
          <p>{group.guidance}</p>
        </div>
      ))}
      {awaiting.length > 0 ? (
        <p className="text-sm text-muted-foreground">{ACCOUNT_LINK_NOTE}</p>
      ) : null}
      {unavailable.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {NO_TEXT_INFO} {unavailable.map(purposeLabel).join('; ')}.
        </p>
      ) : null}
      {granted.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Geçerli rızası olan amaçlar: {granted.map(purposeLabel).join('; ')}.
        </p>
      ) : null}
    </>
  )
}
