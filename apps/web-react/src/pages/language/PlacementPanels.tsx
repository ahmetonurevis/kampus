import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { PLACEMENT_MODES, type PlacementSection } from '@kampus/school-core/cefr/placement.ts'
import { bandMeaning } from '@kampus/school-core/skills/rubric.ts'
import type { PlacementSession } from '@kampus/react-shared/cefr.ts'
import {
  useCompletePlacement,
  useDecidePlacement,
  useOpenPlacement,
  usePlacementForm,
  usePlacementSession,
  useScorePlacement,
} from '@kampus/react-shared/use-cefr.ts'
import { useResourceList } from '@kampus/react-shared/use-resources.ts'
import { useRubrics, useRubricVersion } from '@kampus/react-shared/use-rubrics.ts'
import type { TaskAttemptAnswers } from '@kampus/react-shared/use-task-attempts.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  SummaryHeader,
  SummaryIcon,
  SummaryList,
  SummaryLoading,
  SummaryMetrics,
  SummarySection,
} from '../management/SummaryParts.tsx'
import { QuestionInput } from '../tasks/QuestionInput.tsx'
import { aspectLabel, bandMeaningLabel, bandNeedsComment } from '../tasks/task-model.ts'
import { PLACEMENT_VALIDITY } from './cefr-profile-model.ts'
import {
  answeredCount,
  decisionBlockedReason,
  decisionBody,
  decisionDefaults,
  decisionFormSchema,
  decisionRows,
  formOptionValue,
  isAnswerSection,
  isPlacementSection,
  isRubricSection,
  LEVEL_OPTIONS,
  MODE_OPTIONS,
  openBody,
  openFormSchema,
  placedLevel,
  rubricSectionBody,
  rubricSectionSchema,
  SECTION_KEYS,
  sectionLabel,
  sectionRows,
  unenteredAutoSections,
  skillSuggestionRows,
  suggestedLevel,
  validityText,
  type AnswerSection,
  type RubricSection,
  type DecisionFormValues,
  type LearnerOption,
  type OpenFormValues,
  type RubricSectionValues,
} from './placement-model.ts'

// Seviye tespiti sağ panelleri (OG-078; IST-058; DOM-DIL-010…012): oturum ayrıntısı, oturum açma,
// bölüm girişi (otomatik bölümde cevaplar, yazma ve konuşmada rubrik bantları) ve gerekçeli
// yerleştirme kararı. Formlar react-hook-form + core şemalarıyla; puan, öneri ve geçerlilik
// sunucuda hesaplanır. Ret Türkçe toast ya da alan mesajıdır.

type Answers = TaskAttemptAnswers

/** Panelin içindeki eylem: bölüm girişi (`puan-<bölüm>`) ya da karar (`karar`). */
export type PlacementAction = { kind: 'score'; section: PlacementSection } | { kind: 'decide' }

export function parseAction(value: string): PlacementAction | null {
  if (value === 'karar') return { kind: 'decide' }
  const section = value.startsWith('puan-') ? value.slice('puan-'.length) : ''
  return isPlacementSection(section) ? { kind: 'score', section } : null
}

export const scoreActionValue = (section: PlacementSection) => `puan-${section}`

const actionTitle = (action: PlacementAction | null) =>
  action === null
    ? 'Seviye tespiti'
    : action.kind === 'decide'
      ? 'Yerleştirme kararı'
      : `${sectionLabel(action.section)} bölümünü puanla`

// --- Ayrıntı ------------------------------------------------------------------------------

export function PlacementDetailPanel({
  sessionId,
  learnerName,
  action,
  onAction,
  onActionClose,
  onClose,
}: {
  sessionId: string
  learnerName: (learnerId: string) => string
  action: PlacementAction | null
  onAction: (value: string) => void
  onActionClose: () => void
  onClose: () => void
}) {
  const query = usePlacementSession(sessionId)
  const session = query.data?.data
  return (
    <SidePanel
      open={sessionId !== ''}
      onOpenChange={(open) => {
        if (open) return
        if (action) onActionClose()
        else onClose()
      }}
      title={actionTitle(action)}
    >
      {query.error ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : !session ? (
        <SummaryLoading />
      ) : action?.kind === 'score' ? (
        <SectionScoreForm session={session} section={action.section} onDone={onActionClose} />
      ) : action?.kind === 'decide' ? (
        <DecisionForm session={session} onDone={onActionClose} />
      ) : (
        <PlacementSummary session={session} learnerName={learnerName} onAction={onAction} />
      )}
    </SidePanel>
  )
}

function PlacementSummary({
  session,
  learnerName,
  onAction,
}: {
  session: PlacementSession
  learnerName: (learnerId: string) => string
  onAction: (value: string) => void
}) {
  const complete = useCompletePlacement()
  const validity = PLACEMENT_VALIDITY[session.validity.status]
  const suggestion = suggestedLevel(session)
  const placed = placedLevel(session)
  const sections = sectionRows(session)
  const blocked = decisionBlockedReason(session)
  const scored = session.sections.filter((row) => row.status === 'scored').length

  const [confirmFinish, setConfirmFinish] = useState(false)
  const unentered = unenteredAutoSections(session)

  async function finish() {
    const outcome = await complete.submit({ sessionId: session.id, version: session.version })
    if (outcome.status === 'success') notify.success('Seviye tespiti bitirildi.')
    setConfirmFinish(false)
  }

  return (
    <div>
      <SummaryHeader
        icon={<SummaryIcon name="ListChecks" />}
        title={learnerName(session.learnerId)}
        subtitle={`${PLACEMENT_MODES[session.mode].label} · ${session.learnerKind === 'prospect' ? 'Aday' : 'Öğrenci'}`}
        status={validity.label}
        tone={validity.tone}
      />
      <SummaryMetrics
        items={[
          { label: 'Önerilen seviye', value: suggestion.level },
          { label: 'Yerleştirilen seviye', value: placed ?? 'Karar verilmedi' },
          { label: 'Puanlanan bölüm', value: `${scored} / ${session.sections.length}` },
          { label: 'Geçerlilik', value: validityText(session) },
        ]}
      />
      <p role="note" className="mb-5 text-sm text-muted-foreground">
        {suggestion.note}
        {session.preliminary ? ' Uzaktan yapılan ön tespit kesin yerleştirme yerine geçmez.' : ''}
      </p>
      <SummarySection title="Bölüm sonuçları">
        <ul aria-label="Bölüm sonuçları" className="grid gap-2">
          {sections.map((row) => (
            <li
              key={row.section}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm"
            >
              <span className="grid min-w-0">
                <strong className="font-medium">{row.label}</strong>
                <small className="text-xs text-muted-foreground">
                  {row.scoring} · {row.status}
                  {row.targetLevel !== '—' ? ` · hedef ${row.targetLevel}` : ''}
                </small>
              </span>
              <span className="flex items-center gap-2">
                <span className="font-semibold">{row.result}</span>
                {row.canScore ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`${row.label} bölümünü puanla`}
                    onClick={() => onAction(scoreActionValue(row.section))}
                  >
                    <Icon name="Pencil" size={15} aria-hidden="true" />
                    Puanla
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </SummarySection>
      <SummarySection title="Beceri önerileri">
        <SummaryList items={skillSuggestionRows(session)} empty="Beceri önerisi yok." />
      </SummarySection>
      <SummarySection title="Yerleştirme kararı">
        {session.decisions.length ? (
          <ul aria-label="Yerleştirme kararları" className="grid gap-2">
            {decisionRows(session).map((row) => (
              <li key={row.key} className="rounded-xl border px-3.5 py-2.5 text-sm">
                <span className="flex justify-between gap-3">
                  <strong className="font-medium">{row.label}</strong>
                  <span className="font-semibold">{row.value}</span>
                </span>
                <span className="block text-muted-foreground">
                  {row.decidedAt} · Gerekçe: {row.rationale}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{blocked ?? 'Karar verilmedi.'}</p>
        )}
      </SummarySection>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        {session.completedAt === null ? (
          <Button
            variant="secondary"
            onClick={() => (unentered.length ? setConfirmFinish(true) : void finish())}
            disabled={complete.isPending}
            aria-busy={complete.isPending || undefined}
          >
            <Icon name="Check" size={17} aria-hidden="true" />
            Tespiti bitir
          </Button>
        ) : null}
        {blocked === null ? (
          <Button onClick={() => onAction('karar')}>
            <Icon name="GraduationCap" size={17} aria-hidden="true" />
            Yerleştirme kararı ver
          </Button>
        ) : null}
      </div>
      <AlertDialog open={confirmFinish} onOpenChange={setConfirmFinish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tespiti bitir</AlertDialogTitle>
            <AlertDialogDescription>
              {`Girilmemiş otomatik bölüm var: ${unentered.join(', ')}. Tespit bittikten sonra bu bölümler girilemez; ilgili beceriler için seviye önerisi çıkmaz. Yine de bitirilsin mi?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={complete.isPending}>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              disabled={complete.isPending}
              aria-busy={complete.isPending || undefined}
              onClick={(event) => {
                // Pencere sonuç gelene kadar açık kalır; kapanışı `finish` yönetir.
                event.preventDefault()
                void finish()
              }}
            >
              Yine de bitir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// --- Bölüm girişi -------------------------------------------------------------------------

function SectionScoreForm({
  session,
  section,
  onDone,
}: {
  session: PlacementSession
  section: PlacementSection
  onDone: () => void
}) {
  const row = session.sections.find((item) => item.section === section)
  if (!row || row.status !== 'pending')
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Bu bölüm girilemez: {row?.status === 'scored' ? 'daha önce puanlandı.' : 'formda yok.'}
      </p>
    )
  if (isAnswerSection(section))
    return <AutoSectionForm session={session} section={section} onDone={onDone} />
  if (isRubricSection(section))
    return <RubricSectionForm session={session} section={section} onDone={onDone} />
  return null
}

function AutoSectionForm({
  session,
  section,
  onDone,
}: {
  session: PlacementSession
  section: AnswerSection
  onDone: () => void
}) {
  const form = usePlacementForm(session.id)
  const score = useScorePlacement()
  const [answers, setAnswers] = useState<Answers>({})
  const items = form.data?.sections.find((item) => item.section === section)?.items ?? []

  if (form.error) return <QueryError error={form.error} onRetry={() => void form.refetch()} />
  if (!form.data) return <SummaryLoading />
  if (!items.length)
    return <p className="text-sm text-muted-foreground">Formda bu bölüme ait soru yok.</p>

  async function save() {
    const outcome = await score.submit({
      sessionId: session.id,
      body: {
        version: session.version,
        section,
        answers,
      },
    })
    if (outcome.status === 'success') {
      notify.success(`${sectionLabel(section)} bölümü kaydedildi; puan hesaplandı.`)
      onDone()
    }
  }

  const answered = answeredCount(items, answers)
  return (
    <form
      noValidate
      aria-label={`${sectionLabel(section)} cevapları`}
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      className="grid gap-5"
    >
      <p className="text-sm text-muted-foreground">
        Kursiyerin cevaplarını işaretleyin. Puan formun cevap anahtarıyla sunucuda hesaplanır; boş
        bırakılan soru yanlış sayılır.
      </p>
      <ol className="grid gap-4">
        {items.map((item, index) => (
          <li key={item.questionVersionId} className="grid gap-2 rounded-card border p-4">
            <span className="text-xs font-semibold text-muted-foreground">
              Soru {index + 1} · {item.points} puan
            </span>
            <QuestionInput
              question={item}
              response={answers[item.questionVersionId]}
              onChange={(response) =>
                setAnswers((current) => ({ ...current, [item.questionVersionId]: response }))
              }
              disabled={score.isPending}
            />
          </li>
        ))}
      </ol>
      <p role="status" className="text-sm font-medium">
        {answered} / {items.length} soru cevaplandı
      </p>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onDone} disabled={score.isPending}>
          Vazgeç
        </Button>
        <Button type="submit" disabled={score.isPending} aria-busy={score.isPending || undefined}>
          <Icon name="Check" size={17} aria-hidden="true" />
          Cevapları kaydet
        </Button>
      </div>
    </form>
  )
}

function RubricSectionForm({
  session,
  section,
  onDone,
}: {
  session: PlacementSession
  section: RubricSection
  onDone: () => void
}) {
  const rubrics = useRubrics({ skill: section, status: 'published', pageSize: 100 })
  const options = (rubrics.data?.data ?? []).flatMap((item) =>
    item.publishedVersionId ? [{ value: item.publishedVersionId, label: item.head.title }] : [],
  )
  const [rubricVersionId, setRubricVersionId] = useState('')
  const chosen = rubricVersionId || options[0]?.value || ''

  if (rubrics.error)
    return <QueryError error={rubrics.error} onRetry={() => void rubrics.refetch()} />
  if (!rubrics.data) return <SummaryLoading />
  if (!options.length)
    return (
      <p className="text-sm text-muted-foreground">
        Bu beceri için yayında rubrik yok. Önce İçerik Havuzu’nda bir {sectionLabel(section)}{' '}
        rubriği yayımlayın.
      </p>
    )
  return (
    <div className="grid gap-5">
      <FormField id="tespit-rubrik" label="Rubrik">
        {(control) => (
          <NativeSelect
            {...control}
            value={chosen}
            onChange={(event) => setRubricVersionId(event.target.value)}
            className="w-full"
          >
            {options.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <RubricBandsForm
        key={chosen}
        session={session}
        section={section}
        rubricVersionId={chosen}
        onDone={onDone}
      />
    </div>
  )
}

function RubricBandsForm({
  session,
  section,
  rubricVersionId,
  onDone,
}: {
  session: PlacementSession
  section: RubricSection
  rubricVersionId: string
  onDone: () => void
}) {
  const version = useRubricVersion(rubricVersionId)
  const rubric = version.data?.data
  if (version.error)
    return <QueryError error={version.error} onRetry={() => void version.refetch()} />
  if (!rubric) return <SummaryLoading />
  return (
    <RubricBands
      session={session}
      section={section}
      rubric={rubric}
      rubricVersionId={rubricVersionId}
      onDone={onDone}
    />
  )
}

type RubricData = NonNullable<ReturnType<typeof useRubricVersion>['data']>['data']

function RubricBands({
  session,
  section,
  rubric,
  rubricVersionId,
  onDone,
}: {
  session: PlacementSession
  section: RubricSection
  rubric: RubricData
  rubricVersionId: string
  onDone: () => void
}) {
  const score = useScorePlacement()
  const form = useForm<RubricSectionValues>({
    resolver: zodResolver(rubricSectionSchema),
    defaultValues: {
      rubricVersionId,
      targetLevel: session.sections.find((row) => row.section === section)?.targetLevel ?? '',
      criteria: rubric.criteria.map((criterion) => ({
        criterionId: criterion.id,
        band: null,
        comment: '',
      })),
    },
  })
  const watched = useWatch({ control: form.control, name: 'criteria' })
  const busy = score.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const submit = form.handleSubmit(async (values) => {
    const parsed = rubricSectionSchema.parse(values)
    const outcome = await score.submit(
      {
        sessionId: session.id,
        body: rubricSectionBody(section, session.version, parsed),
      },
      {
        setError: (name, error) =>
          form.setError(
            (name === 'targetLevel' || name.startsWith('criteria.')
              ? name
              : 'root.server') as 'targetLevel',
            error,
          ),
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${sectionLabel(section)} bölümü puanlandı.`)
      onDone()
    }
  })

  return (
    <form
      noValidate
      aria-label={`${sectionLabel(section)} rubrik puanı`}
      onSubmit={(event) => void submit(event)}
      className="grid gap-5"
    >
      <FormField id="tespit-hedef" label="Görevin hedef seviyesi" error={errors.targetLevel}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('targetLevel')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Seviye seçin</NativeSelectOption>
            {LEVEL_OPTIONS.map((level) => (
              <NativeSelectOption key={level} value={level}>
                {level}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {rubric.criteria.map((criterion, index) => {
        const band = watched[index]?.band ?? null
        const bandError = errors.criteria?.[index]?.band
        const label = aspectLabel(criterion.aspect)
        return (
          <fieldset
            key={criterion.id}
            className="grid gap-3 rounded-card border p-4"
            aria-describedby={bandError ? `tespit-kriter-${index}-hata` : undefined}
          >
            <legend className="px-1 text-sm font-semibold">{label}</legend>
            <Controller
              control={form.control}
              name={`criteria.${index}.band`}
              render={({ field }) => (
                <div role="radiogroup" aria-label={`${label} bandı`} className="grid gap-1.5">
                  {[...criterion.bands]
                    .sort((a, b) => b.band - a.band)
                    .map((item) => (
                      <label
                        key={item.band}
                        className="flex min-h-9 cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                      >
                        <input
                          type="radio"
                          name={`tespit-kriter-${index}`}
                          value={item.band}
                          checked={field.value === item.band}
                          onChange={() => field.onChange(item.band)}
                          onBlur={field.onBlur}
                          disabled={busy}
                          className="mt-1 accent-primary"
                        />
                        <span>
                          <span className="font-medium">
                            {item.band} · {bandMeaningLabel(bandMeaning(item.band))}
                          </span>
                          <span className="block text-muted-foreground">{item.description}</span>
                        </span>
                      </label>
                    ))}
                </div>
              )}
            />
            {bandError?.message ? (
              <p
                id={`tespit-kriter-${index}-hata`}
                role="alert"
                className="text-sm text-destructive"
              >
                {bandError.message}
              </p>
            ) : null}
            <FormField
              id={`tespit-kriter-${index}-yorum`}
              label={band !== null && bandNeedsComment(band) ? 'Yorum (zorunlu)' : 'Yorum'}
              error={errors.criteria?.[index]?.comment}
            >
              {(control) => (
                <Textarea
                  {...control}
                  {...form.register(`criteria.${index}.comment`)}
                  maxLength={2000}
                  rows={2}
                  disabled={busy}
                />
              )}
            </FormField>
          </fieldset>
        )
      })}
      <RootError message={errors.root?.server?.message} />
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onDone} disabled={busy}>
          Vazgeç
        </Button>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          <Icon name="Check" size={17} aria-hidden="true" />
          Puanı kaydet
        </Button>
      </div>
    </form>
  )
}

// --- Karar --------------------------------------------------------------------------------

function DecisionForm({ session, onDone }: { session: PlacementSession; onDone: () => void }) {
  const decide = useDecidePlacement()
  const blocked = decisionBlockedReason(session)
  const suggestion = suggestedLevel(session)
  const form = useForm<DecisionFormValues>({
    resolver: zodResolver(decisionFormSchema),
    defaultValues: decisionDefaults(session),
  })
  const busy = decide.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const submit = form.handleSubmit(async (values) => {
    const outcome = await decide.submit(
      {
        sessionId: session.id,
        body: decisionBody(decisionFormSchema.parse(values), session.version),
      },
      {
        setError: (name, error) =>
          form.setError(
            (name === 'level' || name === 'rationale' ? name : 'root.server') as 'level',
            error,
          ),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Yerleştirme kararı kaydedildi.')
      onDone()
    }
  })

  if (blocked) return <p className="text-sm text-muted-foreground">{blocked}</p>
  return (
    <form
      noValidate
      aria-label="Yerleştirme kararı"
      onSubmit={(event) => void submit(event)}
      className="grid gap-5"
    >
      <p className="text-sm text-muted-foreground">
        Önerilen seviye: <strong className="text-foreground">{suggestion.level}</strong>. Öneriden
        farklı bir seviye seçebilirsiniz; gerekçe her durumda zorunludur.
      </p>
      <FormField id="karar-seviye" label="Genel seviye" error={errors.level}>
        {(control) => (
          <NativeSelect {...control} {...form.register('level')} className="w-full" disabled={busy}>
            <NativeSelectOption value="">Seviye seçin</NativeSelectOption>
            {LEVEL_OPTIONS.map((level) => (
              <NativeSelectOption key={level} value={level}>
                {level}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <fieldset className="grid gap-3 rounded-card border p-4">
        <legend className="px-1 text-sm font-semibold">Beceri seviyeleri (isteğe bağlı)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {SECTION_KEYS.map((skill) => (
            <FormField key={skill} id={`karar-beceri-${skill}`} label={sectionLabel(skill)}>
              {(control) => (
                <NativeSelect
                  {...control}
                  {...form.register(`skillLevels.${skill}`)}
                  className="w-full"
                  disabled={busy}
                >
                  <NativeSelectOption value="">Seçilmedi</NativeSelectOption>
                  {LEVEL_OPTIONS.map((level) => (
                    <NativeSelectOption key={level} value={level}>
                      {level}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          ))}
        </div>
      </fieldset>
      <FormField id="karar-gerekce" label="Gerekçe" error={errors.rationale}>
        {(control) => (
          <Textarea
            {...control}
            {...form.register('rationale')}
            maxLength={2000}
            rows={4}
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onDone} disabled={busy}>
          Vazgeç
        </Button>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          <Icon name="Check" size={17} aria-hidden="true" />
          Kararı kaydet
        </Button>
      </div>
    </form>
  )
}

// --- Oturum açma --------------------------------------------------------------------------

export function OpenPlacementPanel({
  open,
  defaults,
  learners,
  kindOptions,
  onClose,
  onOpened,
}: {
  open: boolean
  defaults: Pick<OpenFormValues, 'learnerKind' | 'learnerId'>
  learners: (kind: OpenFormValues['learnerKind']) => readonly LearnerOption[]
  kindOptions: readonly { value: OpenFormValues['learnerKind']; label: string }[]
  onClose: () => void
  onOpened: (session: PlacementSession) => void
}) {
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Seviye tespiti aç"
    >
      {open ? (
        <OpenPlacementForm
          defaults={defaults}
          learners={learners}
          kindOptions={kindOptions}
          onClose={onClose}
          onOpened={onOpened}
        />
      ) : null}
    </SidePanel>
  )
}

function OpenPlacementForm({
  defaults,
  learners,
  kindOptions,
  onClose,
  onOpened,
}: {
  defaults: Pick<OpenFormValues, 'learnerKind' | 'learnerId'>
  learners: (kind: OpenFormValues['learnerKind']) => readonly LearnerOption[]
  kindOptions: readonly { value: OpenFormValues['learnerKind']; label: string }[]
  onClose: () => void
  onOpened: (session: PlacementSession) => void
}) {
  const openCommand = useOpenPlacement()
  const forms = useResourceList({ contentType: 'quiz', filterOn: 'current', pageSize: 100 })
  const form = useForm<OpenFormValues>({
    resolver: zodResolver(openFormSchema),
    defaultValues: { ...defaults, form: '', mode: 'in_person' },
  })
  const kind = useWatch({ control: form.control, name: 'learnerKind' })
  const busy = openCommand.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const formOptions = (forms.data?.data ?? []).flatMap((item) =>
    item.view === 'staff'
      ? [{ value: formOptionValue(item.id, item.version.id), label: item.version.title }]
      : [],
  )

  const submit = form.handleSubmit(async (values) => {
    const outcome = await openCommand.submit(openBody(openFormSchema.parse(values)), {
      setError: (name, error) =>
        form.setError(
          (name === 'learnerId' || name === 'mode'
            ? name
            : name === 'formId' || name === 'formVersionId'
              ? 'form'
              : 'root.server') as 'learnerId',
          error,
        ),
    })
    if (outcome.status === 'success') {
      notify.success('Seviye tespiti açıldı.')
      onOpened(outcome.data.data)
    }
  })

  return (
    <form
      noValidate
      aria-label="Seviye tespiti aç"
      onSubmit={(event) => void submit(event)}
      className="grid gap-5"
    >
      <FormField id="tespit-ac-tur" label="Kişi türü" error={errors.learnerKind}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('learnerKind', {
              // Tür değişince önceki kişi yeni listede yoktur.
              onChange: () => form.setValue('learnerId', ''),
            })}
            className="w-full"
            disabled={busy}
          >
            {kindOptions.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="tespit-ac-kisi" label="Kişi" error={errors.learnerId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('learnerId')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Kişi seçin</NativeSelectOption>
            {learners(kind).map((option) => (
              <NativeSelectOption key={option.id} value={option.id}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id="tespit-ac-form"
        label="Tespit formu"
        error={errors.form}
        description="Yayındaki bölümlü quiz; sorular birincil becerisine göre bölümlere ayrılır. İkinci tespit farklı formla yapılır."
      >
        {(control) => (
          <NativeSelect {...control} {...form.register('form')} className="w-full" disabled={busy}>
            <NativeSelectOption value="">
              {forms.isPending ? 'Formlar yükleniyor…' : 'Form seçin'}
            </NativeSelectOption>
            {formOptions.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {forms.data && !formOptions.length ? (
        <p role="status" className="text-sm text-muted-foreground">
          Yayında quiz yok. Önce İçerik Havuzu’nda bölümlü bir tespit quiz’i yayımlayın.
        </p>
      ) : null}
      <FormField id="tespit-ac-yer" label="Tespitin yeri" error={errors.mode}>
        {(control) => (
          <NativeSelect {...control} {...form.register('mode')} className="w-full" disabled={busy}>
            {MODE_OPTIONS.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Vazgeç
        </Button>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Tespiti aç
        </Button>
      </div>
    </form>
  )
}
