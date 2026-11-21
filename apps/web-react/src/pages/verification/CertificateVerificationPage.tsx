import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router'
import {
  useCertificateVerification,
  verificationFormSchema,
  type VerificationFormInput,
} from '@kampus/react-shared/use-course-certificates.ts'
import { normalizeVerificationCode } from '@kampus/school-core/cefr/certificates.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon, type IconName } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { verificationHref } from '@/lib/certificate-verification.ts'
import { cn } from '@/lib/utils'
import { verificationView, type VerificationTone } from './verification-view.ts'

const TONE_CLASS = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
} as const satisfies Record<VerificationTone, string>

const TONE_ICON = {
  success: 'CircleCheck',
  warning: 'TriangleAlert',
  danger: 'TriangleAlert',
} as const satisfies Record<VerificationTone, IconName>

/**
 * Kurum başarı belgesinin kimliksiz doğrulaması (OG-088; DOM-DIL-082): oturum gerekmez, QR
 * adresteki kodla açılır ya da kod elle girilir. Sonuçta yalnız API'nin verdiği durum, baş harfler,
 * kur, düzenleme günü ve kurum adı gösterilir. Yüzey opaktır (ADR 0002); sonuç `aria-live`
 * bölgesinde duyurulur.
 */
export function CertificateVerificationPage() {
  useDocumentTitle('Belge doğrulama')
  const { code: rawCode } = useParams<{ code?: string }>()
  const navigate = useNavigate()
  const query = useCertificateVerification(rawCode ?? '')
  const view = verificationView(rawCode, {
    data: query.data,
    error: query.error,
    isFetching: query.isFetching,
  })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<VerificationFormInput>({
    resolver: zodResolver(verificationFormSchema),
    defaultValues: { code: normalizeVerificationCode(rawCode ?? '') ?? rawCode ?? '' },
  })

  // Adres değişince (geri/ileri, yeni QR) alan adresteki koda eşitlenir.
  useEffect(() => {
    reset({ code: normalizeVerificationCode(rawCode ?? '') ?? rawCode ?? '' })
  }, [rawCode, reset])

  const onSubmit = handleSubmit(({ code }) => {
    const canonical = normalizeVerificationCode(code)
    if (canonical === null) return
    if (canonical === rawCode) void query.refetch()
    else void navigate(verificationHref(canonical))
  })

  return (
    <div className="grid min-h-dvh place-items-center bg-background p-10 max-[650px]:p-5">
      <main id="main" className="flex w-full max-w-[520px] min-w-0 flex-col gap-7">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold tracking-[0.2em] text-brand">KAMPÜS</p>
          <h1 className="text-[28px] font-semibold tracking-[-0.8px]">Belge doğrulama</h1>
          <p className="text-base text-muted-foreground">
            Kurum başarı belgesinin üzerindeki doğrulama kodunu girin ya da belgedeki QR kodu
            okutun.
          </p>
        </div>

        <form
          noValidate
          onSubmit={(event) => void onSubmit(event)}
          className="flex flex-col gap-4"
          aria-label="Kodla doğrula"
        >
          <FormField
            id="dogrulama-kodu"
            label="Doğrulama kodu"
            description="28 karakter; büyük/küçük harf, boşluk ve tire fark etmez."
            error={errors.code}
          >
            {(control) => (
              <Input
                {...control}
                {...register('code')}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                className="h-[46px] rounded-field px-3.5 font-mono text-[15px] md:text-[15px]"
              />
            )}
          </FormField>
          <Button
            type="submit"
            disabled={view.kind === 'loading' || query.isFetching}
            className="min-h-[47px] rounded-lg bg-brand px-5 text-base text-on-brand hover:bg-brand-hover"
          >
            {view.kind === 'loading' || query.isFetching ? 'Doğrulanıyor…' : 'Doğrula'}
          </Button>
        </form>

        <section aria-labelledby="dogrulama-sonucu-baslik" className="min-w-0">
          <h2 id="dogrulama-sonucu-baslik" className="sr-only">
            Doğrulama sonucu
          </h2>
          <div aria-live="polite" aria-atomic="true" className="min-w-0">
            <VerificationResult view={view} />
          </div>
        </section>

        <p className="text-sm text-muted-foreground">
          Doğrulama yalnız belgenin durumunu gösterir; kişisel bilgi olarak kursiyerin baş harfleri
          yer alır.
        </p>
      </main>
    </div>
  )
}

function VerificationResult({ view }: { view: ReturnType<typeof verificationView> }) {
  if (view.kind === 'idle') return null
  if (view.kind === 'loading')
    return (
      <p role="status" className="rounded-2xl border bg-surface px-4 py-3 text-sm">
        Belge doğrulanıyor…
      </p>
    )
  const tone = TONE_CLASS[view.tone]
  return (
    <div className="overflow-hidden rounded-2xl border bg-surface">
      <div
        className={cn(
          'flex items-start gap-3 px-4 py-3.5',
          view.kind === 'result' && 'border-b',
          tone,
        )}
      >
        <Icon name={TONE_ICON[view.tone]} size={22} className="mt-0.5 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-lg leading-tight font-semibold" data-testid="dogrulama-durumu">
            {view.title}
          </p>
          <p className="text-sm text-foreground">{view.message}</p>
        </div>
      </div>
      {view.kind === 'result' ? (
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2.5 px-4 py-4 text-sm max-[420px]:grid-cols-1 max-[420px]:gap-y-1">
          {view.rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted-foreground max-[420px]:mt-1.5">{row.label}</dt>
              <dd className="font-medium break-words">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
