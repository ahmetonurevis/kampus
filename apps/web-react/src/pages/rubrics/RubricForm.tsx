import { useMemo } from 'react'
import {
  get,
  set,
  useFieldArray,
  useForm,
  useWatch,
  type FieldErrors,
  type FieldPath,
  type Resolver,
  type UseFormReturn,
} from 'react-hook-form'
import {
  useCreateRubric,
  useCreateRubricVersion,
  useRubricDetail,
  useUpdateRubricDraft,
  type RubricVersion,
} from '@kampus/react-shared/use-rubrics.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import {
  WEIGHT_LIMITS,
  type RubricKind,
  type RubricSkill,
} from '@kampus/school-core/skills/rubric.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import {
  ConflictNotice,
  isVersionConflict,
  RootError,
  useEditConflict,
} from '../management/FormParts.tsx'
import {
  aspectOptions,
  BANDS,
  bandTitle,
  CEFR_LEVEL_OPTIONS,
  defaultRubricForm,
  formFieldFor,
  formFromVersion,
  KIND_OPTIONS,
  MAX_CRITERIA,
  nextAspect,
  OUTCOME_SOURCE_OPTIONS,
  parseFormTarget,
  rubricActions,
  SKILL_OPTIONS,
  validateRubricForm,
  weightShares,
  withAddedCriterion,
  withKind,
  withSkill,
  type RubricFormValues,
} from './rubric-library-model.ts'

type FormProps = {
  /** `?rubrik-form=` değeri; `''` kapalı. */
  target: string
  onClose: () => void
  /**
   * Yeni rubrik kaydedildi (kimliğiyle); ekran ayrıntıyı formun yerine açar. Yeni sürüm ve taslak
   * düzenleme panelden açılır; kayıtta pencere kapanır ve geçmişte bir adım geri, panele dönülür.
   */
  onSaved: (rubricId: string) => void
}

const TITLES = {
  create: 'Yeni rubrik',
  version: 'Yeni sürüm',
  edit: 'Taslağı düzenle',
} as const

/**
 * Rubrik formu (geniş pencere; IST-048, DOM-BEC-020, DOM-BEC-022): başlık, tür (analitik ya da
 * bütüncül), beceri; kriter başına niteliksel yön, ağırlık, CEFR tanımlayıcısı ya da kazanım
 * eşlemesi ve altı bant tanımı. Doğrulama core `rubricVersionInputSchema` ve kurum türü kuralıyla
 * istemcide yapılır; sunucunun yollu hatası alanın altına, yolsuz hatası tek toast olarak gelir.
 * Yeni sürüm baş sürümün içeriğiyle, taslak düzenleme taslağın içeriğiyle başlar; düzenleme
 * okunan sürümle (`If-Match`) gider, çakışmada girdi korunur ve "Güncel kaydı yükle" çıkar.
 */
export function RubricForm({ target, onClose, onSaved }: FormProps) {
  const parsed = parseFormTarget(target)
  return (
    <Modal
      open={parsed !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={parsed ? TITLES[parsed.mode] : 'Rubrik'}
      size="wide"
    >
      {parsed?.mode === 'create' ? (
        <RubricEditor
          key={target}
          mode={{ kind: 'create' }}
          initial={defaultRubricForm()}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : null}
      {parsed && parsed.mode !== 'create' ? (
        <SourceLoader
          key={target}
          mode={parsed.mode}
          rubricId={parsed.rubricId}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : null}
    </Modal>
  )
}

function SourceLoader({
  mode,
  rubricId,
  onClose,
  onSaved,
}: {
  mode: 'version' | 'edit'
  rubricId: string
  onClose: () => void
  onSaved: (rubricId: string) => void
}) {
  const detail = useRubricDetail(rubricId)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const data = detail.data?.data
  if (!data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Rubrik yükleniyor…
      </p>
    )
  const actions = rubricActions(data)
  if (mode === 'edit') {
    const draft = actions.canEditDraft ? actions.draft : null
    if (!draft)
      return (
        <p role="status" className="text-sm text-muted-foreground">
          Bu rubriğin düzenlenebilir taslağı yok; yayımlanmış ya da görevde kullanılmış sürüm
          değiştirilemez.
        </p>
      )
    return (
      <RubricEditor
        mode={{ kind: 'edit', rubricId, draft }}
        initial={formFromVersion(draft)}
        reload={async () => {
          const fresh = (await detail.refetch()).data?.data
          const next = fresh ? rubricActions(fresh).draft : null
          return next ? { version: next.rowVersion, values: formFromVersion(next) } : null
        }}
        onClose={onClose}
        onSaved={onSaved}
      />
    )
  }
  const base = actions.canOpenVersion ? actions.head : null
  if (!base)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {actions.draft
          ? 'Bu rubriğin açık bir taslağı var; yeni sürüm açmadan önce onu yayımlayın.'
          : 'Bu rubriğe yeni sürüm açamazsınız.'}
      </p>
    )
  return (
    <RubricEditor
      mode={{ kind: 'version', rubricId, base }}
      initial={formFromVersion(base)}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
}

type EditorMode =
  | { kind: 'create' }
  | { kind: 'version'; rubricId: string; base: RubricVersion }
  | { kind: 'edit'; rubricId: string; draft: RubricVersion }

type FieldName = FieldPath<RubricFormValues> | 'root.server'
type RubricForm = UseFormReturn<RubricFormValues>

/** Core doğrulamasını react-hook-form çözümleyicisine bağlar; hata yolları form alanlarıdır. */
function rubricResolver(institutionType: InstitutionType): Resolver<RubricFormValues> {
  return (values) => {
    const result = validateRubricForm(values, institutionType)
    if (result.ok) return { values, errors: {} }
    const errors: FieldErrors<RubricFormValues> = {}
    for (const issue of result.issues)
      set(errors, issue.field, { type: 'validation', message: issue.message })
    return { values: {}, errors }
  }
}

function RubricEditor({
  mode,
  initial,
  reload,
  onClose,
  onSaved,
}: {
  mode: EditorMode
  initial: RubricFormValues
  reload?: () => Promise<{ version: number; values: RubricFormValues } | null>
  onClose: () => void
  onSaved: (rubricId: string) => void
}) {
  const { session } = useAuth()
  const institutionType: InstitutionType = session?.institution.type ?? 'school'
  const languageSchool = institutionType === 'language_school'
  const create = useCreateRubric()
  const openVersion = useCreateRubricVersion()
  const update = useUpdateRubricDraft()
  const resolver = useMemo(() => rubricResolver(institutionType), [institutionType])
  const form: RubricForm = useForm<RubricFormValues>({ resolver, defaultValues: initial })
  const criteria = useFieldArray({ control: form.control, name: 'criteria' })
  const kind = useWatch({ control: form.control, name: 'kind' })
  const skill = useWatch({ control: form.control, name: 'skill' })
  const watched = useWatch({ control: form.control, name: 'criteria' })
  const conflict = useEditConflict<RubricFormValues>({
    initialVersion: mode.kind === 'edit' ? mode.draft.rowVersion : 0,
    reload: async () => (reload ? reload() : null),
    apply: (values) => form.reset(values),
  })
  const busy =
    create.isPending || openVersion.isPending || update.isPending || form.formState.isSubmitting
  const holistic = kind === 'holistic'
  const weights = watched.map((criterion) => Number(criterion.weight))
  const shares = weightShares(weights)
  const weightTotal = weights.reduce(
    (sum, weight) => sum + (Number.isFinite(weight) ? weight : 0),
    0,
  )
  const canAdd =
    !holistic &&
    watched.length < MAX_CRITERIA &&
    nextAspect(
      skill,
      watched.map((criterion) => criterion.aspect),
    ) !== null

  const errorAt = (name: string) =>
    get(form.formState.errors, name) as { message?: string } | undefined
  const setServerError = (name: string, error: { type: string; message: string }) =>
    form.setError(formFieldFor(name.split('.')) as FieldName, error)

  function changeKind(next: RubricKind) {
    const values = withKind(form.getValues(), next)
    form.setValue('kind', next)
    criteria.replace(values.criteria)
  }
  function changeSkill(next: RubricSkill) {
    const values = withSkill(form.getValues(), next)
    form.setValue('skill', next)
    criteria.replace(values.criteria)
  }
  function addCriterion() {
    const values = withAddedCriterion(form.getValues())
    const added = values.criteria.at(-1)
    if (added && values.criteria.length > watched.length) criteria.append(added)
  }

  const submit = form.handleSubmit(async (values) => {
    const result = validateRubricForm(values, institutionType)
    if (!result.ok) return
    if (mode.kind === 'create') {
      const outcome = await create.submit(result.body, { setError: setServerError })
      if (outcome.status !== 'success') return
      notify.success('Rubrik taslağı kaydedildi.')
      onSaved(outcome.data.data.rubric.id)
      return
    }
    if (mode.kind === 'version') {
      const outcome = await openVersion.submit(
        { rubricId: mode.rubricId, body: result.body },
        { setError: setServerError },
      )
      if (outcome.status !== 'success') return
      notify.success(`v${outcome.data.data.version.versionNumber} taslağı açıldı.`)
      onClose()
      return
    }
    const outcome = await update.submit(
      {
        rubricId: mode.rubricId,
        versionId: mode.draft.id,
        version: conflict.version,
        patch: result.body,
      },
      { setError: setServerError, silent: isVersionConflict },
    )
    if (outcome.status === 'success') {
      notify.success('Taslak güncellendi.')
      onClose()
    } else if (outcome.status === 'failed' && isVersionConflict(outcome.error)) {
      conflict.markConflict()
    }
  })

  return (
    <form
      noValidate
      aria-label={TITLES[mode.kind]}
      onSubmit={(event) => void submit(event)}
      className="grid gap-6"
    >
      {conflict.conflicted ? (
        <ConflictNotice
          onReload={() => void conflict.reloadRecord()}
          reloading={conflict.reloading}
        />
      ) : null}
      {mode.kind === 'version' ? (
        <p className="text-sm text-muted-foreground">
          v{mode.base.versionNumber} içeriğiyle başlar. Yeni sürüm taslak olarak kaydedilir;
          yayımlanınca yeni görevlerde kullanılır, eski görevler kendi sürümleriyle puanlanır.
        </p>
      ) : null}
      <FormField id="rubrik-baslik" label="Başlık" error={errorAt('title')}>
        {(control) => (
          <Input {...control} {...form.register('title')} maxLength={200} disabled={busy} />
        )}
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          id="rubrik-tur"
          label="Rubrik türü"
          error={errorAt('kind')}
          description={
            holistic
              ? 'Bütüncül rubrik tek genel ölçekle puanlar.'
              : 'Analitik rubrik her kriteri ayrı puanlar.'
          }
        >
          {(control) => (
            <NativeSelect
              {...control}
              value={kind}
              onChange={(event) => {
                const chosen = KIND_OPTIONS.find((item) => item.value === event.target.value)
                if (chosen) changeKind(chosen.value)
              }}
              className="w-full"
              disabled={busy}
            >
              {KIND_OPTIONS.map((item) => (
                <NativeSelectOption key={item.value} value={item.value}>
                  {item.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="rubrik-beceri" label="Beceri" error={errorAt('skill')}>
          {(control) => (
            <NativeSelect
              {...control}
              value={skill}
              onChange={(event) => {
                const chosen = SKILL_OPTIONS.find((item) => item.value === event.target.value)
                if (chosen) changeSkill(chosen.value)
              }}
              className="w-full"
              disabled={busy}
            >
              {SKILL_OPTIONS.map((item) => (
                <NativeSelectOption key={item.value} value={item.value}>
                  {item.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>

      <section aria-labelledby="rubrik-form-kriterler" className="grid gap-4">
        <div className="grid gap-1">
          <h3 id="rubrik-form-kriterler" className="text-base font-semibold">
            Kriterler
          </h3>
          <p className="text-sm text-muted-foreground">
            Ağırlık toplamı {weightTotal}. Puan, kriter bantlarının ağırlıklı toplamından
            hesaplanır; her kriterin altı bandı (0–5) tanımlanır, 3 hedef seviyedir.
            {languageSchool ? ' Dil okulunda bantlar CEFR tanımlayıcısına bağlanır.' : ''}
          </p>
        </div>
        {criteria.fields.map((field, index) => (
          <CriterionFields
            key={field.id}
            form={form}
            index={index}
            skill={skill}
            kind={kind}
            share={shares[index] ?? 0}
            overridden={watched[index]?.bandAlignments != null}
            alignmentKind={watched[index]?.alignment.kind ?? 'cefr'}
            languageSchool={languageSchool}
            busy={busy}
            errorAt={errorAt}
            removable={!holistic && criteria.fields.length > 2}
            onRemove={() => criteria.remove(index)}
          />
        ))}
        <RootError message={errorAt('criteria.root')?.message ?? errorAt('criteria')?.message} />
        {holistic ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={addCriterion}
              disabled={busy || !canAdd}
            >
              <Icon name="Plus" size={16} aria-hidden="true" />
              Kriter ekle
            </Button>
            {canAdd ? null : (
              <p className="text-sm text-muted-foreground">
                Bu becerinin bütün niteliksel yönleri eklendi.
              </p>
            )}
          </div>
        )}
      </section>

      <RootError message={form.formState.errors.root?.server?.message} />
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Vazgeç
        </Button>
        <Button type="submit" disabled={busy || conflict.conflicted} aria-busy={busy || undefined}>
          <Icon name="Check" size={17} aria-hidden="true" />
          {mode.kind === 'edit' ? 'Değişiklikleri kaydet' : 'Taslağı kaydet'}
        </Button>
      </div>
    </form>
  )
}

function CriterionFields({
  form,
  index,
  skill,
  kind,
  share,
  overridden,
  alignmentKind,
  languageSchool,
  busy,
  errorAt,
  removable,
  onRemove,
}: {
  form: RubricForm
  index: number
  skill: RubricSkill
  kind: RubricKind
  share: number
  overridden: boolean
  alignmentKind: 'cefr' | 'outcome'
  languageSchool: boolean
  busy: boolean
  errorAt: (name: string) => { message?: string } | undefined
  removable: boolean
  onRemove: () => void
}) {
  const at = `criteria.${index}` as const
  const holistic = kind === 'holistic'
  const id = (name: string) => `rubrik-k${index}-${name}`
  // Kriterin eşlemesi değişince altı bant onu alır; korunmuş bant eşlemesi bırakılır.
  const alignment = { onChange: () => form.setValue(`${at}.bandAlignments`, null) }
  return (
    <fieldset className="grid gap-4 rounded-card border bg-surface p-4">
      <legend className="px-1 text-sm font-semibold">Kriter {index + 1}</legend>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <FormField id={id('yon')} label="Niteliksel yön" error={errorAt(`${at}.aspect`)}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register(`${at}.aspect`)}
              className="w-full"
              disabled={busy || holistic}
            >
              {aspectOptions(skill, kind).map((item) => (
                <NativeSelectOption key={item.value} value={item.value}>
                  {item.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id={id('agirlik')}
          label="Ağırlık"
          description={`Pay %${share}`}
          error={errorAt(`${at}.weight`)}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register(`${at}.weight`, { valueAsNumber: true })}
              type="number"
              inputMode="numeric"
              min={WEIGHT_LIMITS.min}
              max={WEIGHT_LIMITS.max}
              step={1}
              disabled={busy || holistic}
            />
          )}
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id={id('esleme')} label="Eşleme" error={errorAt(`${at}.alignment.kind`)}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register(`${at}.alignment.kind`, alignment)}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="cefr">CEFR tanımlayıcısı</NativeSelectOption>
              {languageSchool && alignmentKind !== 'outcome' ? null : (
                <NativeSelectOption value="outcome">Kazanım</NativeSelectOption>
              )}
            </NativeSelect>
          )}
        </FormField>
        {alignmentKind === 'outcome' ? (
          <>
            <FormField
              id={id('kazanim')}
              label="Kazanım kodu"
              error={errorAt(`${at}.alignment.outcomeId`)}
            >
              {(control) => (
                <Input
                  {...control}
                  {...form.register(`${at}.alignment.outcomeId`, alignment)}
                  maxLength={200}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField
              id={id('kaynak')}
              label="Kazanım kaynağı"
              error={errorAt(`${at}.alignment.outcomeSource`)}
            >
              {(control) => (
                <NativeSelect
                  {...control}
                  {...form.register(`${at}.alignment.outcomeSource`, alignment)}
                  className="w-full"
                  disabled={busy}
                >
                  {OUTCOME_SOURCE_OPTIONS.map((item) => (
                    <NativeSelectOption key={item.value} value={item.value}>
                      {item.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </>
        ) : (
          <>
            <FormField
              id={id('olcek')}
              label="CEFR ölçeği"
              description="Örn. Overall written production"
              error={errorAt(`${at}.alignment.scale`)}
            >
              {(control) => (
                <Input
                  {...control}
                  {...form.register(`${at}.alignment.scale`, alignment)}
                  maxLength={200}
                  lang="en"
                  disabled={busy}
                />
              )}
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                id={id('duzey')}
                label="CEFR düzeyi"
                error={errorAt(`${at}.alignment.level`)}
              >
                {(control) => (
                  <NativeSelect
                    {...control}
                    {...form.register(`${at}.alignment.level`, alignment)}
                    className="w-full"
                    disabled={busy}
                  >
                    {CEFR_LEVEL_OPTIONS.map((item) => (
                      <NativeSelectOption key={item.value} value={item.value}>
                        {item.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField
                id={id('sira')}
                label="Tanımlayıcı sırası"
                error={errorAt(`${at}.alignment.index`)}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register(`${at}.alignment.index`, {
                      ...alignment,
                      valueAsNumber: true,
                    })}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={200}
                    step={1}
                    disabled={busy}
                  />
                )}
              </FormField>
            </div>
          </>
        )}
      </div>
      {overridden ? (
        <p className="text-sm text-muted-foreground">
          Bu kriterin bantları farklı tanımlayıcılara bağlı; eşlemeyi değiştirirseniz altı banda
          aynı eşleme yazılır.
        </p>
      ) : null}

      <div className="grid gap-3">
        {BANDS.map((band) => (
          <FormField
            key={band}
            id={id(`bant${band}`)}
            label={bandTitle(band)}
            error={errorAt(`${at}.bands.${band}.description`)}
          >
            {(control) => (
              <Textarea
                {...control}
                {...form.register(`${at}.bands.${band}.description`)}
                rows={2}
                maxLength={1000}
                disabled={busy}
              />
            )}
          </FormField>
        ))}
      </div>
      {removable ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRemove}
            disabled={busy}
            aria-label={`Kriter ${index + 1} kaldır`}
          >
            <Icon name="Trash2" size={15} aria-hidden="true" />
            Kriteri kaldır
          </Button>
        </div>
      ) : null}
    </fieldset>
  )
}
