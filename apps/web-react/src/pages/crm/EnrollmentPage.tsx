import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useSearchParams } from 'react-router'
import { installmentAmounts } from '@kampus/school-core/lib/domain.ts'
import {
  allowedGuardianModes,
  enrollmentFormSchema,
  enrollmentFormToBody,
  ENROLLMENT_STEP_FIELDS,
  GUARDIAN_RELATIONSHIP_LABELS,
  GUARDIAN_RELATIONSHIPS,
  OTHER_CAMPUS_CONFIRM_LABEL,
  OTHER_CAMPUS_CONFIRM_MESSAGE,
  previewEnrollment,
  type EnrollmentFormValues,
  type EnrollmentTariff,
} from '@kampus/school-core/lib/enrollment.ts'
import {
  FEE_DISCOUNT_KIND_LABELS,
  FEE_ITEM_KIND_LABELS,
  FEE_ITEM_KINDS,
} from '@kampus/school-core/lib/fee-tariffs.ts'
import { dayKey, money } from '@kampus/school-core/lib/format.ts'
import { OPEN_PROSPECT_STAGES } from '@kampus/school-core/lib/prospects.ts'
import { useFeeTariffs } from '@kampus/react-shared/use-fee-tariffs.ts'
import {
  useEnrollProspect,
  useGuardianMatches,
} from '@kampus/react-shared/use-prospect-commands.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { FormField } from '@/components/FormField.tsx'
import { FormSteps } from '@/components/FormSteps.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll, useCoreCounts } from '@/hooks/use-core-collection.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { enrollmentServerError, guardianModeFor, prospectChangeValues } from './enrollment-form.ts'

const STEPS = ['Aday ve sınıf', 'Kimlik ve veli', 'Ücret ve taksit', 'Kontrol'] as const
const TARIFF_PAGE_SIZE = 100
const OPEN_STAGES: readonly (string | undefined)[] = OPEN_PROSPECT_STAGES
const OCCUPANCY_QUERY = { groupBy: 'classId', isActive: true } as const
const GUARDIAN_MODE_LABELS = {
  new: 'Yeni veli',
  existing: 'Mevcut veliye bağla',
  self: 'Kursiyerin kendisi (18 yaş ve üstü)',
} as const

type Done = { studentName: string; contractId: string | null }

/**
 * Kayıt İşlemleri (ön büro `/kayit-islemleri`; DOM-KAY-001, -011…-013, -035, DOM-FIN-002, -003,
 * -010, -011, -020…-022): adımlı kesin kayıt. Tutar girilmez, yayındaki tarifeden hesaplanır;
 * önizleme sunucuyla aynı core kuralıdır, kesin hesabı sunucu yapar. Kimlik yanıtta ve listelerde
 * dönmez. Yayımlanmış tarife yoksa form açılmaz.
 */
export function EnrollmentPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const [, setParams] = useSearchParams()
  const { session } = useAuth()
  const institutionType = session?.institution.type ?? 'school'
  const year = session?.institution.academicYear ?? Number(dayKey().slice(0, 4))
  const tariffs = useFeeTariffs({ page: 1, pageSize: TARIFF_PAGE_SIZE, academicYear: year })
  const [done, setDone] = useState<Done | null>(null)
  const [round, setRound] = useState(0)
  const published = tariffs.data?.data.find((tariff) => tariff.status === 'published')

  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {tariffs.error ? (
        <QueryError error={tariffs.error} onRetry={() => void tariffs.refetch()} />
      ) : tariffs.isPending ? (
        <SummaryLoading />
      ) : !published ? (
        <EmptyState
          title="Yayımlanmış ücret tarifesi yok"
          description="Kesin kayıt tutarı tarifeden hesaplanır. Yöneticiniz bu eğitim yılının tarifesini Finans sayfasından yayımlamalıdır."
        />
      ) : done ? (
        <section
          aria-labelledby="kayit-tamam"
          className="panel grid justify-items-start gap-3 rounded-card border bg-surface p-6"
        >
          <h2 id="kayit-tamam" className="text-lg font-semibold">
            {done.studentName} kaydedildi
          </h2>
          <p className="text-sm text-muted-foreground">
            Öğrenci, veli, sözleşme ve taksit planı oluşturuldu.
          </p>
          <div className="flex flex-wrap gap-3">
            {done.contractId ? (
              <PdfButton
                type="contract"
                recordId={done.contractId}
                label="Sözleşmeyi görüntüle"
                ariaLabel={`${done.studentName} sözleşmesini görüntüle`}
              />
            ) : null}
            <Button asChild variant="secondary">
              <Link to="../tahsilat-takip" relative="path">
                Ödeme planını görüntüle
              </Link>
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDone(null)
                setRound((value) => value + 1)
                // Kayda alınan aday adreste kalmaz.
                setParams({}, { replace: true })
              }}
            >
              Yeni kayıt
            </Button>
          </div>
        </section>
      ) : (
        <EnrollmentForm
          key={round}
          tariff={published}
          institutionType={institutionType}
          onDone={setDone}
        />
      )}
    </>
  )
}

function EnrollmentForm({
  tariff,
  institutionType,
  onDone,
}: {
  tariff: EnrollmentTariff
  institutionType: 'school' | 'language_school'
  onDone: (done: Done) => void
}) {
  const [params] = useSearchParams()
  const prospects = useCoreAll('prospects')
  const classes = useCoreAll('classes')
  const branches = useCoreAll('branches')
  const enroll = useEnrollProspect()
  const [step, setStep] = useState(0)
  const today = dayKey()
  const schema = useMemo(() => enrollmentFormSchema(institutionType), [institutionType])
  const form = useForm<EnrollmentFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      prospectId: params.get('aday') ?? '',
      classId: '',
      identityKind: 'tc',
      identityNumber: '',
      birthDate: '',
      guardianMode: 'new',
      guardianName: '',
      guardianPhone: '',
      relationship: 'mother',
      existingParentId: '',
      studentPhone: '',
      studentEmail: '',
      lessonHours: '',
      discounts: [],
      extras: [],
      installmentCount: '8',
      firstDueDate: today,
      allCampuses: false,
      confirmOtherCampus: false,
    },
  })
  const values = useWatch({ control: form.control }) as EnrollmentFormValues
  const matches = useGuardianMatches(values.prospectId)
  const errors = form.formState.errors
  const busy = enroll.isPending || form.formState.isSubmitting

  const openProspects = (prospects.data ?? []).filter((row) =>
    OPEN_STAGES.includes(row.record.stage),
  )
  const prospect = openProspects.find((row) => row.id === values.prospectId)
  // Aday kampüsündeki etkin sınıflar; kampüs değişince eski seçim listeden düşer. "Tüm kampüsler"
  // başka kampüsün sınıfını da getirir; böyle bir sınıf ayrıca açık onay ister ve gövdeye
  // `allowOtherCampus` yalnız bu onayla gider (yoksa 422 `class_campus_mismatch`).
  const branchId = prospect?.record.branchId
  const activeClasses = (classes.data ?? []).filter(
    (row) =>
      row.record.isActive !== false &&
      (values.allCampuses || !branchId || row.record.branchId === branchId),
  )
  const campusName = (id: string) => branches.data?.find((row) => row.id === id)?.record.name ?? ''
  const occupancy = useCoreCounts('students', OCCUPANCY_QUERY)
  const occupied = (classId: string) =>
    occupancy.data?.groups.find((group) => group.value === classId)?.count ?? 0
  const room = activeClasses.find((row) => row.id === values.classId)
  // Veli seçimleri doğum tarihine göre: "kendisi" yalnız kursta 18 yaş ve üstünde (DOM-KAY-012).
  const guardianModes = allowedGuardianModes(institutionType, values.birthDate)
  const otherCampus = Boolean(room && branchId && room.record.branchId !== branchId)
  const preview = previewEnrollment(tariff, values, {
    institutionType,
    level:
      institutionType === 'language_school'
        ? (room?.record.level ?? '')
        : String(room?.record.grade ?? ''),
  })
  const plan =
    preview.ok && Number(values.installmentCount) >= 1
      ? installmentAmounts(preview.price.netCents, Number(values.installmentCount))
      : []

  async function next() {
    const valid = await form.trigger(ENROLLMENT_STEP_FIELDS[step] ?? [])
    if (!valid) return
    if (step === 0 && !prospect) {
      form.setError('prospectId', { type: 'closed', message: 'Kaydı açık bir aday seçin.' })
      return
    }
    if (step === 0 && !room) {
      form.setError('classId', { type: 'branch', message: 'Adayın kampüsünden bir sınıf seçin.' })
      return
    }
    if (step === 0 && otherCampus && !values.confirmOtherCampus) {
      form.setError('confirmOtherCampus', { type: 'campus', message: OTHER_CAMPUS_CONFIRM_MESSAGE })
      form.setFocus('confirmOtherCampus')
      return
    }
    // Veli alanları adaydan dolar; kullanıcı dilediğini değiştirir.
    if (step === 0 && prospect) {
      if (!form.getValues('guardianName'))
        form.setValue('guardianName', prospect.record.guardianName ?? '')
      if (!form.getValues('guardianPhone'))
        form.setValue('guardianPhone', prospect.record.phone ?? '')
    }
    if (step === 2 && !preview.ok) {
      form.setError('root.server', { type: 'preview', message: preview.message })
      return
    }
    form.clearErrors('root.server')
    setStep(step + 1)
  }

  const onSubmit = form.handleSubmit(async (data) => {
    if (!prospect) return
    const outcome = await enroll.submit(
      {
        prospectId: prospect.id,
        version: prospect.version,
        body: enrollmentFormToBody(data, tariff.id),
      },
      {
        // Veli, doğum tarihi ve kimlik hatası kendi alanına ve adımına döner (DOM-KAY-012).
        setError: (name, error) => {
          const target = enrollmentServerError(name, error)
          if (target.step !== null) setStep(target.step)
          form.setError(target.field, { type: target.type, message: target.message })
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Kesin kayıt, sözleşme ve taksit planı oluşturuldu.')
      const contract = outcome.data.data.records.find((row) => row.collection === 'contracts')
      onDone({ studentName: prospect.record.name, contractId: contract?.id ?? null })
    }
  })

  const loadError = prospects.error ?? classes.error
  if (loadError)
    return (
      <QueryError
        error={loadError}
        onRetry={() => {
          void prospects.refetch()
          void classes.refetch()
        }}
      />
    )
  if (!prospects.data || !classes.data) return <SummaryLoading />

  // Her ek hizmet bir kez: sınıf düzeyinin kalemi, yoksa genel kalem (sunucu kuralıyla aynı).
  const classLevel =
    institutionType === 'language_school' ? room?.record.level : String(room?.record.grade ?? '')
  const extraItems = FEE_ITEM_KINDS.filter((kind) => kind !== 'tuition').flatMap((kind) => {
    const item =
      tariff.items.find((row) => row.kind === kind && row.level === classLevel) ??
      tariff.items.find((row) => row.kind === kind && row.level === null)
    return item ? [item] : []
  })
  const summary: readonly [string, string][] = [
    ['Aday', prospect?.record.name ?? '—'],
    ['Sınıf', room?.record.name ?? '—'],
    [
      'Veli',
      values.guardianMode === 'self'
        ? 'Kursiyerin kendisi'
        : values.guardianMode === 'existing'
          ? 'Mevcut veli'
          : values.guardianName,
    ],
    ['Taksit', `${values.installmentCount} taksit · İlk vade ${values.firstDueDate}`],
  ]

  return (
    <div className="grid gap-6">
      <section
        aria-labelledby="kayit-formu"
        className="panel rounded-card border bg-surface p-6 max-[650px]:p-4"
      >
        <h2 id="kayit-formu" className="mb-3 text-lg font-semibold">
          Öğrenci kayıt bilgileri
        </h2>
        <FormSteps steps={STEPS} current={step} onBack={setStep} />
        <form
          noValidate
          className="mt-5 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (step < STEPS.length - 1) void next()
            else void onSubmit(event)
          }}
        >
          {step === 0 ? (
            <>
              <FormField id="kayit-aday" label="Aday öğrenci" error={errors.prospectId}>
                {(control) => (
                  <NativeSelect
                    {...control}
                    {...form.register('prospectId', {
                      // Başka adayın veli seçimi ve bilgisi yeni adaya taşınmaz.
                      onChange: () => {
                        const reset = prospectChangeValues(form.getValues(), institutionType)
                        for (const [name, value] of Object.entries(reset))
                          form.setValue(name as keyof typeof reset, value)
                        form.clearErrors('guardianMode')
                      },
                    })}
                  >
                    <NativeSelectOption value="">Aday seçin</NativeSelectOption>
                    {openProspects.map((row) => (
                      <NativeSelectOption key={row.id} value={row.id}>
                        {row.record.name} · {row.record.interest}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField id="kayit-sinif" label="Sınıf" error={errors.classId}>
                {(control) => (
                  <NativeSelect
                    {...control}
                    {...form.register('classId', {
                      // Onay seçilen sınıfa özgüdür: sınıf değişince yeniden istenir.
                      onChange: () => {
                        form.setValue('confirmOtherCampus', false)
                        form.clearErrors('confirmOtherCampus')
                      },
                    })}
                  >
                    <NativeSelectOption value="">Sınıf seçin</NativeSelectOption>
                    {activeClasses.map((row) => (
                      <NativeSelectOption
                        key={row.id}
                        value={row.id}
                        disabled={occupied(row.id) >= row.record.capacity}
                      >
                        {row.record.name}
                        {values.allCampuses ? ` · ${campusName(row.record.branchId)}` : ''} (
                        {occupied(row.id)}/{row.record.capacity})
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <label className="flex min-h-6 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  {...form.register('allCampuses', {
                    // Liste daralınca başka kampüsün seçili sınıfı formda kalmaz.
                    onChange: () => {
                      form.setValue('classId', '')
                      form.setValue('confirmOtherCampus', false)
                      form.clearErrors('confirmOtherCampus')
                    },
                  })}
                />
                Tüm kampüslerin sınıflarını göster
              </label>
              {otherCampus ? (
                <div className="grid gap-2 rounded-card border bg-warning-soft p-4">
                  <p id="kayit-kampus-onayi-aciklama" className="text-sm">
                    Seçilen sınıf adayın kampüsünde ({campusName(branchId ?? '')}) değil.
                  </p>
                  <label className="flex min-h-6 items-center gap-2 text-sm font-medium">
                    <input
                      id="kayit-kampus-onayi"
                      type="checkbox"
                      className="size-4"
                      aria-invalid={errors.confirmOtherCampus ? true : undefined}
                      aria-describedby={
                        errors.confirmOtherCampus
                          ? 'kayit-kampus-onayi-aciklama kayit-kampus-onayi-hata'
                          : 'kayit-kampus-onayi-aciklama'
                      }
                      {...form.register('confirmOtherCampus', {
                        onChange: () => form.clearErrors('confirmOtherCampus'),
                      })}
                    />
                    {OTHER_CAMPUS_CONFIRM_LABEL}
                  </label>
                  {errors.confirmOtherCampus ? (
                    <p
                      id="kayit-kampus-onayi-hata"
                      role="alert"
                      className="text-sm text-destructive"
                    >
                      {errors.confirmOtherCampus.message}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          {step === 1 ? (
            <>
              <div className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1">
                <FormField id="kayit-kimlik-tur" label="Kimlik türü" error={errors.identityKind}>
                  {(control) => (
                    <NativeSelect {...control} {...form.register('identityKind')}>
                      <NativeSelectOption value="tc">T.C. kimlik no</NativeSelectOption>
                      <NativeSelectOption value="foreign">Yabancı kimlik no</NativeSelectOption>
                    </NativeSelect>
                  )}
                </FormField>
                <FormField id="kayit-kimlik" label="Kimlik numarası" error={errors.identityNumber}>
                  {(control) => (
                    <Input
                      {...control}
                      {...form.register('identityNumber')}
                      inputMode="numeric"
                      autoComplete="off"
                    />
                  )}
                </FormField>
                <FormField id="kayit-dogum" label="Doğum tarihi" error={errors.birthDate}>
                  {(control) => (
                    <Input
                      {...control}
                      {...form.register('birthDate', {
                        // Veli seçimi yaşa uyar: kursta 18 yaş ve üstünde "kendisi" (DOM-KAY-012).
                        onChange: () => {
                          const values = form.getValues()
                          form.setValue(
                            'guardianMode',
                            guardianModeFor(values.guardianMode, institutionType, values.birthDate),
                          )
                          form.clearErrors('guardianMode')
                        },
                      })}
                      type="date"
                      max={today}
                    />
                  )}
                </FormField>
              </div>
              <FormField
                id="kayit-veli-tur"
                label="Veli ve ödeyici"
                error={errors.guardianMode}
                description={
                  institutionType === 'school'
                    ? 'Okulda veli her yaşta zorunludur.'
                    : '18 yaş altında veli zorunludur; 18 yaş ve üstü kursiyer kendi ödeyicisidir.'
                }
              >
                {(control) => (
                  <NativeSelect {...control} {...form.register('guardianMode')}>
                    {guardianModes.map((mode) => (
                      <NativeSelectOption key={mode} value={mode}>
                        {GUARDIAN_MODE_LABELS[mode]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              {values.guardianMode === 'self' ? (
                <div className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1">
                  <FormField
                    id="kayit-kursiyer-telefon"
                    label="Kursiyer telefonu (isteğe bağlı)"
                    error={errors.studentPhone}
                    description="Boş bırakılırsa aday kartındaki telefon yazılır."
                  >
                    {(control) => (
                      <Input
                        {...control}
                        {...form.register('studentPhone')}
                        inputMode="tel"
                        autoComplete="off"
                      />
                    )}
                  </FormField>
                  <FormField
                    id="kayit-kursiyer-eposta"
                    label="Kursiyer e-postası (isteğe bağlı)"
                    error={errors.studentEmail}
                    description="Boş bırakılırsa aday kartındaki e-posta yazılır."
                  >
                    {(control) => (
                      <Input
                        {...control}
                        {...form.register('studentEmail')}
                        type="email"
                        autoComplete="off"
                      />
                    )}
                  </FormField>
                </div>
              ) : null}
              {values.guardianMode === 'new' ? (
                <div className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1">
                  <FormField id="kayit-veli-ad" label="Veli adı soyadı" error={errors.guardianName}>
                    {(control) => <Input {...control} {...form.register('guardianName')} />}
                  </FormField>
                  <FormField
                    id="kayit-veli-telefon"
                    label="Veli telefonu"
                    error={errors.guardianPhone}
                  >
                    {(control) => (
                      <Input {...control} {...form.register('guardianPhone')} inputMode="tel" />
                    )}
                  </FormField>
                  <FormField
                    id="kayit-veli-yakinlik"
                    label="Yakınlık derecesi"
                    error={errors.relationship}
                  >
                    {(control) => (
                      <NativeSelect {...control} {...form.register('relationship')}>
                        {GUARDIAN_RELATIONSHIPS.map((item) => (
                          <NativeSelectOption key={item} value={item}>
                            {GUARDIAN_RELATIONSHIP_LABELS[item]}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    )}
                  </FormField>
                </div>
              ) : null}
              {values.guardianMode === 'existing' ? (
                <FormField
                  id="kayit-veli-mevcut"
                  label="Mevcut veli"
                  error={errors.existingParentId}
                  description="Adayın telefonuyla eşleşen veliler önerilir."
                >
                  {(control) => (
                    <NativeSelect {...control} {...form.register('existingParentId')}>
                      <NativeSelectOption value="">
                        {matches.data?.data.length ? 'Veli seçin' : 'Eşleşen veli yok'}
                      </NativeSelectOption>
                      {(matches.data?.data ?? []).map((match) => (
                        <NativeSelectOption key={match.parentId} value={match.parentId}>
                          {match.name} ({match.studentCount} öğrenci)
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              {institutionType === 'language_school' ? (
                <FormField id="kayit-saat" label="Paket ders saati" error={errors.lessonHours}>
                  {(control) => (
                    <Input {...control} {...form.register('lessonHours')} inputMode="numeric" />
                  )}
                </FormField>
              ) : null}
              {tariff.discounts.length > 0 ? (
                <fieldset className="grid gap-2 text-sm">
                  <legend className="mb-1 font-medium">İlan edilen indirimler</legend>
                  {tariff.discounts.map((discount) => (
                    <label key={discount.kind} className="flex min-h-6 items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4"
                        value={discount.kind}
                        {...form.register('discounts')}
                      />
                      {FEE_DISCOUNT_KIND_LABELS[discount.kind]}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {extraItems.length > 0 ? (
                <fieldset className="grid gap-2 text-sm">
                  <legend className="mb-1 font-medium">Talep edilen ek hizmetler</legend>
                  {extraItems.map((item) => (
                    <label
                      key={`${item.kind}-${item.level ?? ''}`}
                      className="flex min-h-6 items-center gap-2"
                    >
                      <input
                        type="checkbox"
                        className="size-4"
                        value={item.kind}
                        {...form.register('extras')}
                      />
                      {FEE_ITEM_KIND_LABELS[item.kind]} · {money(item.amountCents)}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <div className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1">
                <FormField id="kayit-taksit" label="Taksit sayısı" error={errors.installmentCount}>
                  {(control) => (
                    <NativeSelect {...control} {...form.register('installmentCount')}>
                      {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => (
                        <NativeSelectOption key={count} value={String(count)}>
                          {count} taksit
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                <FormField id="kayit-vade" label="İlk taksit tarihi" error={errors.firstDueDate}>
                  {(control) => (
                    <Input {...control} {...form.register('firstDueDate')} type="date" />
                  )}
                </FormField>
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <dl className="grid gap-1 text-sm">
              {summary.map(([label, value]) => (
                <div key={label} className="flex flex-wrap justify-between gap-3 border-b py-1.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {errors.root?.server?.message ? (
            <p role="alert" className="text-sm text-danger">
              {errors.root.server.message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {step > 0 ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setStep(step - 1)}
              >
                Geri
              </Button>
            ) : null}
            <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
              {step < STEPS.length - 1 ? 'Devam et' : 'Kaydı tamamla'}
            </Button>
          </div>
        </form>
      </section>

      {step >= 2 && preview.ok ? (
        <section
          aria-labelledby="odeme-onizleme"
          className="panel rounded-card border bg-surface p-6 max-[650px]:p-4"
        >
          <h2 id="odeme-onizleme" className="mb-2 text-lg font-semibold">
            Ödeme planı önizlemesi
          </h2>
          <dl className="grid gap-1 text-sm">
            <Line label="İlan ücreti" value={money(preview.price.grossCents)} />
            {preview.price.discounts.map((line) => (
              <Line
                key={line.kind}
                label={`${FEE_DISCOUNT_KIND_LABELS[line.kind]} indirimi`}
                value={`-${money(line.amountCents)}`}
              />
            ))}
            <Line label="Net öğrenim ücreti" value={money(preview.price.netCents)} strong />
            {preview.price.extras.map((line) => (
              <Line
                key={line.kind}
                label={FEE_ITEM_KIND_LABELS[line.kind]}
                value={money(line.amountCents)}
              />
            ))}
            {plan.map((amount, index) => (
              <Line
                key={`taksit-${String(index + 1)}`}
                label={`${index + 1}. taksit`}
                value={money(amount)}
              />
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`flex flex-wrap justify-between gap-3 border-b py-1.5 ${strong ? 'font-semibold' : ''}`}
    >
      <dt className={strong ? undefined : 'text-muted-foreground'}>{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
