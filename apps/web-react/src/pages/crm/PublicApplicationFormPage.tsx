import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useParams } from 'react-router'
import {
  usePublicApplicationForm,
  useSubmitApplication,
} from '@kampus/react-shared/use-prospect-application-form.ts'
import type { MarketingChannel } from '@kampus/school-core/lib/prospects.ts'
import { FormField } from '@/components/FormField.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { CHANNEL_LABELS } from './prospect-consent.ts'
import { fieldErrors } from './prospect-forms.ts'
import {
  applicationBody,
  applicationDefaults,
  applicationFailureText,
  applicationFormSchema,
  applicationTheme,
  embeddingAllowed,
  isMinorApplicant,
  type ApplicationFormOutput,
  type ApplicationFormValues,
} from './prospect-application-form.ts'

type PublicForm = NonNullable<ReturnType<typeof usePublicApplicationForm>['data']>['data']

const FIELDS = [
  'name',
  'phone',
  'email',
  'branchId',
  'interest',
  'minor',
  'guardianName',
  'emailConsent',
] as const

const CONSENT_FIELDS = {
  sms: 'smsConsent',
  email: 'emailConsent',
  call: 'callConsent',
} as const satisfies Record<MarketingChannel, keyof ApplicationFormValues>

/** Üst pencerelerin kökenleri; `ancestorOrigins` olmayan tarayıcıda `null`. */
function ancestorOrigins(): readonly string[] | null {
  const list = window.location.ancestorOrigins as DOMStringList | undefined
  return list === undefined ? null : Array.from(list)
}

/**
 * Kurum sitesine gömülen ön başvuru formu (ON-133; DOM-KAY-003, -004, -009; IST-145). Oturumsuz,
 * menüsüz ve hafiftir: üçüncü taraf betik, analitik ve çerez yoktur, tarayıcı deposuna yazılmaz.
 * Önce sürümlü aydınlatma metni gösterilir, başvuru ancak metin okunduktan sonra açılır; gönderilen
 * sürüm gösterilen metnindir. Başarı iletisi tektir: yeni kayıt, mükerrer ve gizli alan ayrılmaz.
 * Kurum tavanı doluyken başvuru alınmaz; "alındı" denmez, kurumla iletişim iletisi yazar (K-23).
 */
export function PublicApplicationFormPage() {
  useDocumentTitle('Ön başvuru')
  const { formKey = '' } = useParams<{ formKey: string }>()
  const query = usePublicApplicationForm(formKey)

  // Gömme kodundaki tema uygulanır (kurum sitesiyle eşitleme); tercih saklanmaz.
  useLayoutEffect(() => {
    const theme = applicationTheme(window.location.search)
    if (theme === null) return
    const root = document.documentElement
    const previous = root.dataset.theme
    if (theme === 'dark') root.dataset.theme = 'dark'
    else delete root.dataset.theme
    return () => {
      if (previous === undefined) delete root.dataset.theme
      else root.dataset.theme = previous
    }
  }, [])

  return (
    <div className="min-h-dvh bg-background p-5 max-[400px]:p-3">
      <main id="main" className="mx-auto flex w-full max-w-[560px] min-w-0 flex-col gap-5">
        {query.data ? (
          <FormGate form={query.data.data} formKey={formKey} onStale={() => void query.refetch()} />
        ) : query.isPending ? (
          <p role="status" className="text-base text-muted-foreground">
            Form yükleniyor…
          </p>
        ) : (
          <Unavailable
            message={
              query.error?.status === 429
                ? 'Kısa sürede çok fazla istek geldi. Lütfen biraz sonra yeniden deneyin.'
                : query.error?.status === 404
                  ? 'Bu başvuru formu şu anda kullanıma açık değil.'
                  : 'Form yüklenemedi. Lütfen sayfayı yenileyin.'
            }
          />
        )}
      </main>
    </div>
  )
}

function Unavailable({ message }: { message: string }) {
  return (
    <div role="alert" className="grid gap-2">
      <h1 className="text-xl font-semibold">Ön başvuru</h1>
      <p className="text-base text-muted-foreground">{message}</p>
    </div>
  )
}

function FormGate({
  form,
  formKey,
  onStale,
}: {
  form: PublicForm
  formKey: string
  onStale: () => void
}) {
  const allowed = embeddingAllowed(window.self !== window.top, ancestorOrigins(), form.siteOrigin)
  const [step, setStep] = useState<'notice' | 'form' | 'done'>('notice')
  const [noticeChanged, setNoticeChanged] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)

  // Adım değişince odak yeni adımın başlığına gider; ekran okuyucu yeni içeriği duyurur.
  const firstStep = useRef(true)
  useEffect(() => {
    if (firstStep.current) firstStep.current = false
    else heading.current?.focus()
  }, [step])

  if (!allowed) return <Unavailable message="Bu form yalnız kurumun kendi sitesinde açılır." />

  return (
    <>
      <header className="grid gap-1">
        <p className="text-sm font-semibold text-brand">{form.institutionName}</p>
        <h1 ref={heading} tabIndex={-1} className="text-[24px] font-semibold outline-none">
          {step === 'notice'
            ? 'Aydınlatma metni'
            : step === 'form'
              ? 'Ön başvuru formu'
              : 'Başvurunuz alındı'}
        </h1>
      </header>
      {step === 'notice' ? (
        <section aria-label={form.notice.title} className="grid gap-4">
          {noticeChanged ? (
            <p role="alert" className="text-sm text-danger">
              Aydınlatma metni güncellendi. Lütfen güncel metni okuyun.
            </p>
          ) : null}
          <h2 className="text-base font-semibold">{form.notice.title}</h2>
          <div
            role="region"
            tabIndex={0}
            aria-label="Aydınlatma metninin tamamı"
            className="max-h-[55dvh] overflow-y-auto rounded-field border bg-surface p-4 text-base break-words whitespace-pre-line"
          >
            {form.notice.body}
          </div>
          <Button
            type="button"
            onClick={() => {
              setNoticeChanged(false)
              setStep('form')
            }}
            className="min-h-11 text-base"
          >
            Okudum, başvuruya geç
          </Button>
        </section>
      ) : step === 'form' ? (
        <ApplicationForm
          form={form}
          formKey={formKey}
          onDone={() => setStep('done')}
          onShowNotice={() => setStep('notice')}
          onNoticeChanged={() => {
            setNoticeChanged(true)
            setStep('notice')
            onStale()
          }}
        />
      ) : (
        <p role="status" className="text-base">
          Teşekkür ederiz. Kurum, verdiğiniz iletişim bilgileriyle size dönüş yapacak.
        </p>
      )}
    </>
  )
}

function ApplicationForm({
  form,
  formKey,
  onDone,
  onShowNotice,
  onNoticeChanged,
}: {
  form: PublicForm
  formKey: string
  onDone: () => void
  onShowNotice: () => void
  onNoticeChanged: () => void
}) {
  const submit = useSubmitApplication()
  const schema = useMemo(() => applicationFormSchema(form.asksAgeGroup), [form.asksAgeGroup])
  const rhf = useForm<ApplicationFormValues, unknown, ApplicationFormOutput>({
    resolver: zodResolver(schema),
    defaultValues: applicationDefaults(form.branches[0]?.id ?? ''),
  })
  const [failure, setFailure] = useState('')
  const minorValue = useWatch({ control: rhf.control, name: 'minor' })
  const minor = isMinorApplicant(minorValue, form.asksAgeGroup)
  const busy = submit.isPending
  const errors = rhf.formState.errors

  const onSubmit = rhf.handleSubmit(async (values) => {
    setFailure('')
    const outcome = await submit.submit(
      {
        formKey,
        body: applicationBody(values, form.notice.version, form.asksAgeGroup),
      },
      {
        silent: () => true,
        setError: fieldErrors(FIELDS, rhf.setError, (name) => rhf.setFocus(name)),
      },
    )
    if (outcome.status === 'success') onDone()
    else if (outcome.status === 'failed' && outcome.error.code === 'notice_outdated')
      onNoticeChanged()
    else if (outcome.status === 'failed') setFailure(applicationFailureText(outcome.error))
  })

  return (
    <form
      noValidate
      aria-label="Ön başvuru formu"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-4"
    >
      <p className="text-sm text-muted-foreground">
        Yalnız iletişim için gereken bilgileri istiyoruz; kimlik numarası, doğum tarihi ve adres bu
        formda alınmaz.
      </p>
      <FormField id="basvuru-ad" label="Aday adı soyadı" error={errors.name}>
        {(control) => (
          <Input
            {...control}
            {...rhf.register('name')}
            maxLength={80}
            autoComplete="name"
            disabled={busy}
          />
        )}
      </FormField>
      {form.asksAgeGroup ? (
        <FormField id="basvuru-yas" label="Yaş grubu" error={errors.minor}>
          {(control) => (
            <NativeSelect
              {...control}
              {...rhf.register('minor')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Seçin</NativeSelectOption>
              <NativeSelectOption value="no">18 yaş ve üzeri</NativeSelectOption>
              <NativeSelectOption value="yes">18 yaş altı</NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      {minor ? (
        <FormField
          id="basvuru-veli"
          label="Veli adı soyadı"
          description="18 yaş altı adayda telefon ve e-posta velinindir."
          error={errors.guardianName}
        >
          {(control) => (
            <Input {...control} {...rhf.register('guardianName')} maxLength={80} disabled={busy} />
          )}
        </FormField>
      ) : null}
      <FormField
        id="basvuru-telefon"
        label={minor ? 'Velinin telefonu' : 'Telefon'}
        description="05XXXXXXXXX biçiminde."
        error={errors.phone}
      >
        {(control) => (
          <Input
            {...control}
            {...rhf.register('phone')}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            disabled={busy}
          />
        )}
      </FormField>
      <FormField
        id="basvuru-eposta"
        label={minor ? 'Velinin e-postası (isteğe bağlı)' : 'E-posta (isteğe bağlı)'}
        error={errors.email}
      >
        {(control) => (
          <Input
            {...control}
            {...rhf.register('email')}
            type="email"
            autoComplete="email"
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="basvuru-kampus" label="Kampüs" error={errors.branchId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...rhf.register('branchId')}
            className="w-full"
            disabled={busy}
          >
            {form.branches.map((branch) => (
              <NativeSelectOption key={branch.id} value={branch.id}>
                {branch.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="basvuru-ilgi" label="İlgilendiğiniz program" error={errors.interest}>
        {(control) => (
          <Input {...control} {...rhf.register('interest')} maxLength={200} disabled={busy} />
        )}
      </FormField>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Tanıtım iletileri (isteğe bağlı)</legend>
        <p id="basvuru-onay-aciklama" className="text-sm text-muted-foreground">
          Kampanya ve tanıtım iletisi almak istediğiniz kanalları işaretleyin. Başvurunuz bu seçime
          bağlı değildir.
        </p>
        {(Object.keys(CONSENT_FIELDS) as MarketingChannel[]).map((channel) => (
          <Controller
            key={channel}
            control={rhf.control}
            name={CONSENT_FIELDS[channel]}
            render={({ field }) => (
              <div className="flex min-h-6 items-center gap-2.5">
                <Checkbox
                  id={`basvuru-onay-${channel}`}
                  checked={field.value === true}
                  onCheckedChange={(value) => field.onChange(value === true)}
                  onBlur={field.onBlur}
                  disabled={busy}
                  aria-describedby="basvuru-onay-aciklama"
                  aria-invalid={channel === 'email' ? Boolean(errors.emailConsent) : undefined}
                />
                <Label htmlFor={`basvuru-onay-${channel}`} className="font-normal">
                  {CHANNEL_LABELS[channel]}
                </Label>
              </div>
            )}
          />
        ))}
        <FieldError errors={errors.emailConsent ? [errors.emailConsent] : undefined} />
      </fieldset>
      {/* Gizli alan: insana ve ekran okuyucuya görünmez; dolu gönderim yazılmaz (IST-145). */}
      <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden">
        <label htmlFor="basvuru-web">Web siteniz</label>
        <input
          id="basvuru-web"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          {...rhf.register('website')}
        />
      </div>
      {failure ? (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={onShowNotice} disabled={busy}>
          Aydınlatma metnini gör
        </Button>
        <Button
          type="submit"
          disabled={busy}
          aria-busy={busy || undefined}
          className="min-h-11 text-base"
        >
          {busy ? 'Gönderiliyor…' : 'Başvuruyu gönder'}
        </Button>
      </div>
    </form>
  )
}
