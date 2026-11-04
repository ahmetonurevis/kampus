import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch, type Control, type Resolver } from 'react-hook-form'
import type { FieldErrors, UseFormRegister } from 'react-hook-form'
import type { RubricVersion } from '@kampus/react-shared/use-rubrics.ts'
import { useDecideTaskAppeal, type TaskAppeal } from '@kampus/react-shared/use-task-grading.ts'
import type { TaskSubmissionDetail } from '@kampus/react-shared/use-task-submissions.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  APPEAL_NOT_INDEPENDENT_TEXT,
  APPEAL_OUTCOME_OPTIONS,
  APPEAL_STALE_TEXT,
  appealDecisionBody,
  appealDecisionFieldFor,
  appealDecisionFormSchema,
  showsAppealNotIndependent,
  showsAppealStaleNotice,
  type AppealDecisionFormValues,
} from './appeal-model.ts'
import { RubricCriteriaFields } from './RubricCriteriaFields.tsx'
import { dateTimeLabel, type ScoreFormValues } from './task-model.ts'

type Props = {
  submission: TaskSubmissionDetail
  appeal: TaskAppeal
  /** İtiraz edilen sürüm numarası. */
  versionNumber: number
  /** Atamanın sabitlediği rubrik sürümü; kabulde yeni puan için gerekir. */
  rubric: { version: RubricVersion | null; loading: boolean }
  /** Yalnız öğretmen karar verir; yönetici itirazı okur, karar veremez (sunucu 403). */
  canDecide: boolean
  /** Kişi itiraz edilen sürümü puanladı mı (sunucunun `grading.scoredByViewer`'ı). */
  scoredByViewer: boolean
  /** Açık itirazlar sekmesinden açıldıysa pencere yüklenince kart odaklanır. */
  focusOnMount?: boolean
}

/**
 * Öğretmenin teslim penceresindeki itiraz kartı (DOM-BEC-025): öğrencinin ya da velisinin
 * gerekçesi, karar bekliyorsa kabul/ret formu, karara bağlanmışsa salt okunur sonuç. Kabul
 * yeni rubrik puanı ister (ilk puan kayıt geçmişinde kalır); ret yalnız gerekçe ister. Kararı
 * o sürümü puanlamamış öğretmen verir (409 `rater_not_independent`); `If-Match` teslimin
 * `rowVersion`'ıdır. Teslim başka yerde değiştiyse güncel hâl yüklenir ve uyarı kartta görünür.
 * Sürümü kendisi puanlayan öğretmene form hiç açılmaz, bilgi metni görünür (`scoredByViewer`;
 * OG-1010); sunucu yine de reddederse (409) aynı metin gösterilir. Karar bekleyen itirazlar
 * "Açık itirazlar" sekmesinden de bulunur; oradan gelinen pencerede `focusOnMount` kartı odaklar.
 */
export function AppealDecisionSection({
  submission,
  appeal,
  versionNumber,
  rubric,
  canDecide,
  scoredByViewer,
  focusOnMount = false,
}: Props) {
  const cardRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!focusOnMount) return
    cardRef.current?.scrollIntoView?.({ block: 'center' })
    cardRef.current?.focus({ preventScroll: true })
  }, [focusOnMount, appeal.id])
  const [stale, setStale] = useState(false)
  // Sunucu bu itirazda puanlayıcı bağımsızlığını reddettiyse (409) form bırakılır; sürümü puanlayan
  // kişi yanıt şemasından anlaşılamadığı için bilgi ilk reddedişte öğrenilir.
  const [blockedAppealId, setBlockedAppealId] = useState<string | null>(null)
  const pending = appeal.outcome === null
  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      aria-labelledby="itiraz-karti"
      className="grid gap-3 border-t pt-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="itiraz-karti" className="text-md font-semibold">
          İtiraz · Sürüm {versionNumber}
        </h3>
        {pending ? (
          <StatusBadge text="Karar bekliyor" tone="amber" />
        ) : (
          <StatusBadge
            text={appeal.outcome === 'upheld' ? 'Kabul edildi' : 'Reddedildi'}
            tone={appeal.outcome === 'upheld' ? 'green' : 'gray'}
          />
        )}
        <span className="text-xs text-muted-foreground">{dateTimeLabel(appeal.filedAt)}</span>
      </div>
      <p className="text-sm [overflow-wrap:anywhere] whitespace-pre-line">
        <span className="font-medium">Gerekçe: </span>
        {appeal.reason}
      </p>
      {stale ? (
        <p role="alert" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
          {APPEAL_STALE_TEXT}
        </p>
      ) : null}
      {!pending ? (
        <p className="text-sm [overflow-wrap:anywhere] whitespace-pre-line">
          <span className="font-medium">Karar gerekçesi: </span>
          {appeal.decisionReason ?? '—'}
          {appeal.decidedAt ? (
            <span className="text-muted-foreground"> · {dateTimeLabel(appeal.decidedAt)}</span>
          ) : null}
        </p>
      ) : canDecide && (scoredByViewer || blockedAppealId === appeal.id) ? (
        <p role="status" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
          {APPEAL_NOT_INDEPENDENT_TEXT}
        </p>
      ) : canDecide ? (
        <DecisionForm
          // Yalnız itiraz değişince form baştan kurulur; rubrik geç gelirse gerekçe korunur.
          key={appeal.id}
          submission={submission}
          appeal={appeal}
          rubric={rubric}
          onStaleChange={setStale}
          onNotIndependent={() => setBlockedAppealId(appeal.id)}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          İtirazı yalnız atamayı gören ve bu sürümü puanlamamış bir öğretmen karara bağlar.
        </p>
      )}
    </section>
  )
}

function DecisionForm({
  submission,
  appeal,
  rubric,
  onStaleChange,
  onNotIndependent,
}: Pick<Props, 'submission' | 'appeal' | 'rubric'> & {
  onStaleChange: (stale: boolean) => void
  onNotIndependent: () => void
}) {
  const decide = useDecideTaskAppeal()
  const form = useForm<AppealDecisionFormValues>({
    resolver: zodResolver(
      appealDecisionFormSchema,
    ) as unknown as Resolver<AppealDecisionFormValues>,
    defaultValues: {
      outcome: null,
      reason: '',
      criteria: (rubric.version?.criteria ?? []).map((criterion) => ({
        criterionId: criterion.id,
        band: null,
        comment: '',
      })),
      overallComment: '',
    },
  })
  // Rubrik sonradan yüklenirse yalnız kriter alanları kurulur; gerekçe ve karar seçimi kalır.
  const rubricVersion = rubric.version
  const { resetField } = form
  useEffect(() => {
    if (!rubricVersion) return
    resetField('criteria', {
      defaultValue: rubricVersion.criteria.map((criterion) => ({
        criterionId: criterion.id,
        band: null,
        comment: '',
      })),
    })
  }, [rubricVersion, resetField])
  const outcome = useWatch({ control: form.control, name: 'outcome' })
  const errors = form.formState.errors
  const busy = decide.isPending || form.formState.isSubmitting
  const version = submission.rowVersion
  const upheldWithoutRubric = outcome === 'upheld' && rubric.version === null

  const submit = form.handleSubmit(async (values) => {
    if (version === null || upheldWithoutRubric) return
    onStaleChange(false)
    const result = await decide.submit(
      {
        submissionId: submission.id,
        appealId: appeal.id,
        version,
        decision: appealDecisionBody(values),
      },
      {
        silent: (error) => showsAppealStaleNotice(error) || showsAppealNotIndependent(error),
        setError: (name, error) => form.setError(appealDecisionFieldFor(name) as 'reason', error),
      },
    )
    if (result.status === 'success') notify.success('İtiraz karara bağlandı.')
    else if (result.status === 'failed') {
      if (showsAppealStaleNotice(result.error)) onStaleChange(true)
      else if (showsAppealNotIndependent(result.error)) onNotIndependent()
    }
  })

  return (
    <form
      noValidate
      aria-label="İtiraz kararı"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(event)
      }}
      className="grid gap-5"
    >
      <Controller
        control={form.control}
        name="outcome"
        render={({ field }) => (
          <fieldset
            className="grid gap-2"
            aria-describedby={errors.outcome ? 'karar-hata' : undefined}
          >
            <legend className="text-sm font-medium">Karar</legend>
            <div role="radiogroup" aria-label="İtiraz kararı" className="flex flex-wrap gap-2">
              {APPEAL_OUTCOME_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
                >
                  <input
                    type="radio"
                    name="itiraz-karari"
                    value={option.value}
                    checked={field.value === option.value}
                    onChange={() => field.onChange(option.value)}
                    onBlur={field.onBlur}
                    disabled={busy}
                    className="accent-primary"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {errors.outcome?.message ? (
              <p id="karar-hata" role="alert" className="text-sm text-destructive">
                {errors.outcome.message}
              </p>
            ) : null}
          </fieldset>
        )}
      />
      <FormField
        id="itiraz-karar-gerekce"
        label="Karar gerekçesi"
        description="Gerekçe öğrenciye ve velisine gösterilir."
        error={errors.reason}
      >
        {(field) => (
          <Textarea
            {...field}
            {...form.register('reason')}
            maxLength={2000}
            rows={3}
            disabled={busy}
          />
        )}
      </FormField>
      {outcome === 'upheld' ? (
        rubric.version ? (
          <div className="grid gap-4">
            <h4 className="text-sm font-semibold">Yeni puan</h4>
            {/*
              Karar formu puan alanlarını `ScoreFormValues` biçiminde kullanır: kriter ve genel yorum
              alanlarının adları ve tipleri iki formda aynıdır, `outcome` ve `reason` yalnız bu formdadır.
              Dönüşüm yalnız burada, bu bileşene geçerken yapılır.
            */}
            <RubricCriteriaFields
              control={form.control as unknown as Control<ScoreFormValues>}
              register={form.register as unknown as UseFormRegister<ScoreFormValues>}
              errors={errors as unknown as FieldErrors<ScoreFormValues>}
              rubric={rubric.version}
              busy={busy}
            />
            <p className="text-sm text-muted-foreground">
              Kabul edilen itirazda bu puan son puan olur; ilk puan kayıt geçmişinde kalır. Toplam
              sunucuda hesaplanır.
            </p>
          </div>
        ) : rubric.loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Rubrik yükleniyor…
          </p>
        ) : (
          <p role="alert" className="text-sm text-destructive">
            Görevin rubrik sürümü bulunamadı; itiraz kabul edilemiyor.
          </p>
        )
      ) : null}
      <RootError message={errors.root?.server?.message} />
      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
        <Button
          type="submit"
          disabled={busy || version === null || upheldWithoutRubric}
          aria-busy={busy || undefined}
        >
          <Icon name="Check" size={17} aria-hidden="true" />
          Kararı kaydet
        </Button>
      </div>
    </form>
  )
}
