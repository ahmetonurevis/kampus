import { useEffect, useId, useRef, useState } from 'react'
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
import { useStableCallback } from '@/hooks/use-stable-callback.ts'
import { notify } from '@/lib/notify.ts'
import {
  CHOICE_LABELS,
  DECLINE_NOTE,
  NO_TEXT_INFO,
  OUTDATED_NOTICE,
  STAFF_CONSENT_INFO,
  STUDENT_REQUIRED_INFO,
  allGranted,
  canActOnConsent,
  choiceFor,
  choosable,
  choose,
  clearChoice,
  isComplete,
  isStale,
  purposeLabel,
  purposeOpens,
  purposeStep,
  stepKey,
  stepState,
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
   * hesap amacı (tanıtım iletisi) istenirse verilmez. Değişince seçimler sıfırlanır.
   */
  studentId?: string | undefined
  /**
   * Karar istenecek amaçlar (`CONSENT_PURPOSES` kodları); geçerli rızası olan amaç karar beklemez.
   * İçeriği değişince seçimler sıfırlanır.
   */
  purposes: readonly ConsentPurpose[]
  /**
   * Açılışta ve durum her değiştiğinde (seçim, metin ya da geçerlilik tazelenmesi, kayıt) güncel
   * durum: `complete` çağıranın sonraki adımını açar (ör. bir sihirbazın "İleri" düğmesi).
   * Personelde `actionable: false`.
   */
  onChange?: ((state: ConsentStepState) => void) | undefined
  /**
   * Adım bittiğinde bir kez: onaylar sunucuya yazıldıktan sonra ya da açılışta bütün amaçlar zaten
   * geçerliyse (`granted` ve `declined` boş). Kısmi kayıtta (biri 409) çağrılmaz.
   */
  onComplete?: ((result: ConsentStepResult) => void) | undefined
  /** Geçerli rızası olan amaçlar "Rıza verilmiş" olarak gösterilir; `false`: gizlenir. */
  showGranted?: boolean
  submitLabel?: string
}

/**
 * Açık rıza adımı (IST-017; DOM-YTK-057…062): her amaç için güncel metin (kaydırılabilir, opak
 * yüzey) ve açık "Onaylıyorum" / "Onaylamıyorum" seçimi; ön işaretli seçim yoktur. Karar okunan
 * metin sürümüne (`textId`) bağlıdır: metin tazelenirse eski karar düşer ve yeniden sorulur.
 * Gönderimde onaylar `textId` ile sırayla `POST /consents`'a yazılır; metin arada güncellenmişse
 * (409) yeni metin yeniden gösterilir. Rızayı bu oturum değil başkası veriyorsa (sunucunun
 * `grantor` sonucu: 18 yaş altında veli, 18 ve üstünde öğrenci) form yerine bilgi çıkar. Yalnız
 * veli ve öğrenci oturumunda etkindir; personelde bilgi metni çıkar ve istek atılmaz.
 * "Onaylamıyorum" kayıt yazmaz: rıza yokluğu kendisi sonuçtur ve temel hizmeti engellemez.
 *
 * Kayıt formu gibi başka ekranlar bu bileşeni içe aktarır: `<ConsentStep studentId={id}
 * purposes={['photo_video_sharing']} onChange={…} onComplete={…} />`.
 */
export function ConsentStep(props: ConsentStepProps) {
  return <ConsentStepBody key={stepKey(props.studentId, props.purposes)} {...props} />
}

function ConsentStepBody({
  studentId,
  purposes,
  onChange,
  onComplete,
  showGranted = true,
  submitLabel = 'Seçimlerimi kaydet',
}: ConsentStepProps) {
  const { session } = useAuth()
  const role = session?.role
  const actor = canActOnConsent(role) ? role : null
  const actionable = actor !== null
  const headingId = useId()
  const [choices, setChoices] = useState<ConsentChoices>({})
  const [notices, setNotices] = useState<Partial<Record<ConsentPurpose, string>>>({})
  const completed = useRef(false)
  const give = useGiveConsent()

  const status = useConsentStatus(studentId, { enabled: actionable })
  const texts = useConsentTexts(purposes, { enabled: actionable })
  const steps =
    actor === null
      ? []
      : purposes.map((purpose, index): PurposeStep => {
          const query = texts[index]
          const missing = isApiError(query?.error) && query.error.code === 'consent_text_not_found'
          return purposeStep({
            purpose,
            actor,
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

  // Üst bileşen açılışta ve her durum değişiminde güncel durumu alır (seçim, tazeleme, kayıt).
  const signature = JSON.stringify(stepState(actionable, steps, choices))
  const report = useStableCallback((state: ConsentStepState) => onChange?.(state))
  useEffect(() => report(JSON.parse(signature) as ConsentStepState), [signature, report])

  // Bütün amaçlar zaten geçerliyse sorulacak bir şey yok: adım kendiliğinden biter.
  const finish = useStableCallback((result: ConsentStepResult) => onComplete?.(result))
  const everyGranted = actionable && allGranted(steps)
  useEffect(() => {
    if (!everyGranted || completed.current) return
    completed.current = true
    finish({ granted: [], declined: [] })
  }, [everyGranted, finish])

  if (!actionable)
    return (
      <p role="note" className="rounded-xl border bg-surface-soft p-4 text-sm">
        {STAFF_CONSENT_INFO}
      </p>
    )

  function select(purpose: ConsentPurpose, textId: string, choice: ConsentChoice) {
    setChoices((current) => choose(current, purpose, textId, choice))
    setNotices((current) => withoutPurpose(current, purpose))
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
      // Kısmi kayıt: önceki onaylar yazıldı; kullanıcı bunu bilmeli (sorgular tazelenince o
      // amaçlar "Rıza verilmiş" olur ve `onChange` güncel durumu verir).
      if (granted.length > 0) notify.success(savedMessage(granted))
      // Güncel olmayan metin: sorgular tazelendi; eski karar düşer, yeni metin yeniden gösterilir.
      const message = consentErrorMessage(outcome.error)
      if (outcome.error.code === 'consent_text_outdated') {
        setChoices((current) => clearChoice(current, item.purpose))
        setNotices((current) => ({ ...current, [item.purpose]: OUTDATED_NOTICE }))
      } else if (isConsentInlineError(outcome.error)) {
        setNotices((current) => ({ ...current, [item.purpose]: message }))
      }
      return
    }
    if (granted.length > 0)
      notify.success(granted.length === 1 ? 'Rızanız kaydedildi.' : 'Rızalarınız kaydedildi.')
    completed.current = true
    onComplete?.({ granted, declined: plan.declined })
  }

  // Metni yayımlanmamış amaçlar ve rızayı başkasının verdiği amaçlar tek satırda toplanır; her
  // biri için boş kart ekranı uzatırdı.
  const unavailable = steps.filter((step) => step.kind === 'no-text')
  const others = groupInfo(steps)
  const visible = steps.filter(
    (step) =>
      step.kind !== 'no-text' &&
      step.kind !== 'other-grantor' &&
      (showGranted || step.kind !== 'valid'),
  )
  const pending = choosable(steps).length > 0

  return (
    <div role="group" aria-labelledby={headingId} className="grid gap-4">
      <h3 id={headingId} className="sr-only">
        Açık rıza
      </h3>
      {visible.length === 0 && unavailable.length === 0 && others.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          Bekleyen rıza yok.
        </p>
      ) : null}
      {others.map(({ info, labels }) => (
        <p key={info} role="note" className="rounded-xl border bg-surface-soft p-3 text-sm">
          {info}
          {labels.length > 0 ? ` (${labels.join('; ')})` : null}
        </p>
      ))}
      {unavailable.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {NO_TEXT_INFO} {unavailable.map((step) => purposeLabel(step.purpose)).join('; ')}.
        </p>
      ) : null}
      {visible.map((step) => (
        <PurposeCard
          key={step.purpose}
          step={step}
          text={textFor(texts, purposes, step.purpose)}
          choice={choiceFor(step, choices)}
          notice={notices[step.purpose] ?? (isStale(step, choices) ? OUTDATED_NOTICE : undefined)}
          disabled={give.isPending}
          onChoose={(choice) => {
            if (step.kind === 'choose') select(step.purpose, step.textId, choice)
          }}
        />
      ))}
      {pending ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            className="min-h-12"
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

/** "… için rızanız kaydedildi" (kısmi kayıtta hangi amaçların yazıldığı). */
function savedMessage(granted: readonly ConsentPurpose[]) {
  const labels = granted.map(purposeLabel).join('; ')
  return granted.length === 1
    ? `${labels} için rızanız kaydedildi.`
    : `${labels} için rızalarınız kaydedildi.`
}

/**
 * Rızayı başkasının verdiği amaçlar bilgi metnine göre gruplanır. Bilgi geçerli olmayan bütün
 * amaçları kapsıyorsa amaç adları yazılmaz (ör. 18 yaş altı öğrencide "Rızayı veliniz verir.").
 */
function groupInfo(steps: readonly PurposeStep[]) {
  const open = steps.filter((step) => step.kind !== 'valid')
  const groups = new Map<string, ConsentPurpose[]>()
  for (const step of open)
    if (step.kind === 'other-grantor')
      groups.set(step.info, [...(groups.get(step.info) ?? []), step.purpose])
  return [...groups].map(([info, list]) => ({
    info,
    labels: list.length === open.length ? [] : list.map(purposeLabel),
  }))
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
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-field px-1 text-sm"
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
