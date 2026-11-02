import { useId, useState } from 'react'
import type { ConsentPurpose } from '@kampus/school-core/lib/consent-purposes.ts'
import { isApiError } from '@kampus/api-client/errors.ts'
import {
  consentErrorMessage,
  isConsentInlineError,
  useConsentStatus,
  useConsentTexts,
  useGiveConsent,
  type ConsentTextView,
} from '@kampus/react-shared/use-consents.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { notify } from '@/lib/notify.ts'
import {
  CHOICE_LABELS,
  DECLINE_NOTE,
  NO_TEXT_INFO,
  OUTDATED_NOTICE,
  STAFF_CONSENT_INFO,
  STUDENT_REQUIRED_INFO,
  canActOnConsent,
  choosable,
  choose,
  clearChoice,
  isComplete,
  purposeLabel,
  purposeOpens,
  purposeStep,
  submitPlan,
  withoutPurpose,
  type ConsentChoice,
  type ConsentChoices,
  type ConsentStepState,
  type PurposeStep,
} from './consent-model.ts'

export type { ConsentStepState } from './consent-model.ts'

export interface ConsentStepResult {
  /** Bu adımda sunucuya yazılan onaylar. */
  granted: ConsentPurpose[]
  /** Açıkça "onaylamıyorum" denenler (kayıt yazılmadı). */
  declined: ConsentPurpose[]
}

export interface ConsentStepProps {
  /**
   * Veri sahibi öğrenci. Öğrenci amaçları (fotoğraf/video, konuşma kaydı) için zorunludur; yalnız
   * hesap amacı (tanıtım iletisi) istenirse verilmez.
   */
  studentId?: string | undefined
  /** Karar istenecek amaçlar (`CONSENT_PURPOSES` kodları); geçerli rızası olan amaç karar beklemez. */
  purposes: readonly ConsentPurpose[]
  /** Her seçimde: seçimler ve adımın tamam olup olmadığı (ör. kayıt formunun "İleri" düğmesi). */
  onChange?: (state: ConsentStepState) => void
  /** Onaylar sunucuya yazıldıktan sonra bir kez çağrılır. */
  onComplete?: (result: ConsentStepResult) => void
  /** Geçerli rızası olan amaçlar "Rıza verilmiş" olarak gösterilir; `false`: gizlenir. */
  showGranted?: boolean
  submitLabel?: string
}

/**
 * Açık rıza adımı (IST-017; DOM-YTK-057…062): her amaç için güncel metin (kaydırılabilir, opak
 * yüzey) ve açık "Onaylıyorum" / "Onaylamıyorum" seçimi; ön işaretli seçim yoktur. Gönderimde onaylar
 * `textId` ile sırayla `POST /consents`'a yazılır; metin arada güncellenmişse (409) yeni metin
 * yeniden gösterilir ve karar yeniden istenir. Yalnız veli ve öğrenci oturumunda etkindir;
 * personelde bilgi metni çıkar ve istek atılmaz (API personele 403 verir).
 * "Onaylamıyorum" kayıt yazmaz: rıza yokluğu kendisi sonuçtur ve temel hizmeti engellemez.
 *
 * Kayıt formu gibi başka ekranlar bu bileşeni içe aktarır: `<ConsentStep studentId={id}
 * purposes={['photo_video_sharing']} onComplete={…} />`.
 */
export function ConsentStep({
  studentId,
  purposes,
  onChange,
  onComplete,
  showGranted = true,
  submitLabel = 'Seçimlerimi kaydet',
}: ConsentStepProps) {
  const { session } = useAuth()
  const actionable = canActOnConsent(session?.role)
  const headingId = useId()
  const [choices, setChoices] = useState<ConsentChoices>({})
  const [notices, setNotices] = useState<Partial<Record<ConsentPurpose, string>>>({})
  const give = useGiveConsent()

  const status = useConsentStatus(studentId, { enabled: actionable })
  const texts = useConsentTexts(purposes, { enabled: actionable })
  const steps = purposes.map((purpose, index): PurposeStep => {
    const query = texts[index]
    const missing = isApiError(query?.error) && query.error.code === 'consent_text_not_found'
    return purposeStep({
      purpose,
      studentId,
      status: status.data?.data,
      text: query?.data
        ? { state: 'ready', textId: query.data.data.text.id }
        : missing
          ? { state: 'missing' }
          : query?.isError
            ? { state: 'error' }
            : { state: 'loading' },
    })
  })
  const complete = isComplete(steps, choices)

  if (!actionable)
    return (
      <p role="note" className="rounded-xl border bg-surface-soft p-4 text-sm">
        {STAFF_CONSENT_INFO}
      </p>
    )

  function report(next: ConsentChoices) {
    onChange?.({ actionable, complete: isComplete(steps, next), choices: next })
  }

  function select(purpose: ConsentPurpose, choice: ConsentChoice) {
    const next = choose(choices, purpose, choice)
    setChoices(next)
    setNotices((current) => withoutPurpose(current, purpose))
    report(next)
  }

  async function submit() {
    const plan = submitPlan(steps, choices)
    const granted: ConsentPurpose[] = []
    for (const item of plan.grant) {
      const outcome = await give.submit(
        { purpose: item.purpose, textId: item.textId, ...(studentId ? { studentId } : {}) },
        { silent: isConsentInlineError },
      )
      if (outcome.status === 'busy') return
      if (outcome.status === 'success') {
        granted.push(item.purpose)
        continue
      }
      // Güncel olmayan metin: sorgular tazelendi; eski karar düşer, yeni metin yeniden gösterilir.
      const message = consentErrorMessage(outcome.error)
      if (outcome.error.code === 'consent_text_outdated') {
        const next = clearChoice(choices, item.purpose)
        setChoices(next)
        report(next)
        setNotices((current) => ({ ...current, [item.purpose]: OUTDATED_NOTICE }))
      } else if (isConsentInlineError(outcome.error)) {
        setNotices((current) => ({ ...current, [item.purpose]: message }))
      }
      return
    }
    if (granted.length > 0)
      notify.success(granted.length === 1 ? 'Rızanız kaydedildi.' : 'Rızalarınız kaydedildi.')
    onComplete?.({ granted, declined: plan.declined })
  }

  const visible = steps.filter((step) => showGranted || step.kind !== 'valid')
  const pending = choosable(steps).length > 0

  return (
    <div role="group" aria-labelledby={headingId} className="grid gap-4">
      <h3 id={headingId} className="sr-only">
        Açık rıza
      </h3>
      {visible.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          Bekleyen rıza yok.
        </p>
      ) : null}
      {visible.map((step) => (
        <PurposeCard
          key={step.purpose}
          step={step}
          text={textFor(texts, purposes, step.purpose)}
          choice={choices[step.purpose]}
          notice={notices[step.purpose]}
          disabled={give.isPending}
          onChoose={(choice) => select(step.purpose, choice)}
        />
      ))}
      {pending ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={!complete || give.isPending}
            aria-busy={give.isPending}
            onClick={() => void submit()}
          >
            {give.isPending ? 'Kaydediliyor…' : submitLabel}
          </Button>
          <p className="text-sm text-muted-foreground">{DECLINE_NOTE}</p>
        </div>
      ) : null}
    </div>
  )
}

function textFor(
  texts: ReturnType<typeof useConsentTexts>,
  purposes: readonly ConsentPurpose[],
  purpose: ConsentPurpose,
): ConsentTextView | undefined {
  return texts[purposes.indexOf(purpose)]?.data?.data
}

function PurposeCard({
  step,
  text,
  choice,
  notice,
  disabled,
  onChoose,
}: {
  step: PurposeStep
  text: { text: ConsentTextView['text'] } | undefined
  choice: ConsentChoice | undefined
  notice: string | undefined
  disabled: boolean
  onChoose: (choice: ConsentChoice) => void
}) {
  const id = useId()
  const label = purposeLabel(step.purpose)
  return (
    <section
      aria-labelledby={`${id}-baslik`}
      className="grid gap-3 rounded-card border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`${id}-baslik`} className="text-base font-semibold">
          {label}
        </h4>
        {step.kind === 'valid' ? (
          <StatusBadge text="Rıza verilmiş" tone="green" />
        ) : step.kind === 'choose' && text ? (
          <span className="text-xs text-muted-foreground">Metin sürümü {text.text.version}</span>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">Açtığı işlem: {purposeOpens(step.purpose)}</p>
      {notice ? (
        <p role="alert" className="rounded-xl border bg-warning-soft p-3 text-sm text-warning">
          {notice}
        </p>
      ) : null}
      {step.kind === 'loading' ? (
        <p role="status" className="text-sm text-muted-foreground">
          Rıza metni yükleniyor…
        </p>
      ) : null}
      {step.kind === 'needs-student' ? <p className="text-sm">{STUDENT_REQUIRED_INFO}</p> : null}
      {step.kind === 'no-text' ? <p className="text-sm">{NO_TEXT_INFO}</p> : null}
      {step.kind === 'error' ? (
        <p role="alert" className="text-sm text-danger">
          Rıza metni yüklenemedi. Lütfen sayfayı yenileyip yeniden deneyin.
        </p>
      ) : null}
      {step.kind === 'choose' && text ? (
        <>
          <div
            role="region"
            tabIndex={0}
            aria-label={`${label} rıza metni`}
            className="max-h-48 overflow-y-auto rounded-xl border bg-surface-soft p-3 text-sm leading-relaxed whitespace-pre-line"
          >
            <p className="mb-2 font-medium">{text.text.title}</p>
            {text.text.body}
          </div>
          <RadioGroup
            aria-label={`${label} kararı`}
            value={choice ?? ''}
            onValueChange={(value) => onChoose(value as ConsentChoice)}
            disabled={disabled}
            className="gap-1"
          >
            {(['granted', 'declined'] as const).map((value) => (
              <label
                key={value}
                htmlFor={`${id}-${value}`}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-field px-1 text-sm"
              >
                <RadioGroupItem id={`${id}-${value}`} value={value} />
                {CHOICE_LABELS[value]}
              </label>
            ))}
          </RadioGroup>
        </>
      ) : null}
    </section>
  )
}
