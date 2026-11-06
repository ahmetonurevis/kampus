import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import {
  useApplicationFormSettings,
  useRotateApplicationFormKey,
  useUpdateApplicationForm,
} from '@kampus/react-shared/use-prospect-application-form.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  applicationEmbedCode,
  applicationFormUrl,
  siteOriginFormSchema,
} from './prospect-application-form.ts'
import { fieldErrors } from './prospect-forms.ts'

/** `?web-formu=` değeri. */
export const APPLICATION_FORM_PANEL = 'ayarlar'

type SiteValues = z.input<typeof siteOriginFormSchema>
type SiteOutput = z.output<typeof siteOriginFormSchema>

/**
 * Web başvuru formu (ON-133; DOM-KAY-003, IST-145): kayıt alanının bir parçasıdır, Ayarlar'da
 * değildir. Yönetici anahtarı görür, yeniler, formu açar ve kapatır, kurum sitesinin adresini
 * yazar ve kopyalanacak iframe kodunu alır. Anahtar gizli değildir; kurum sitesinde görünür.
 */
export function ApplicationFormPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Web başvuru formu"
    >
      {open ? <PanelContent /> : null}
    </SidePanel>
  )
}

async function copyText(text: string, success: string) {
  try {
    await navigator.clipboard.writeText(text)
    notify.success(success)
  } catch (error) {
    console.warn('[web-formu] kopyalanamadı', error)
    notify.error('Kopyalanamadı; metni elle seçip kopyalayın.')
  }
}

function PanelContent() {
  const settings = useApplicationFormSettings()
  const rotate = useRotateApplicationFormKey()
  const update = useUpdateApplicationForm()
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [dark, setDark] = useState(false)
  const form = useForm<SiteValues, unknown, SiteOutput>({
    resolver: zodResolver(siteOriginFormSchema),
    defaultValues: { siteOrigin: '' },
  })
  const data = settings.data?.data
  const savedOrigin = data?.siteOrigin ?? ''
  const { reset } = form

  // Kayıtlı adres sunucudan gelince alan ona eşitlenir (dış veriyle eşitleme).
  useEffect(() => {
    reset({ siteOrigin: savedOrigin })
  }, [reset, savedOrigin])

  if (settings.error)
    return <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
  if (!data) return <SummaryLoading />

  const busy = rotate.isPending || update.isPending
  const noticeMissing = data.noticeVersion === null

  if (data.formKey === null || data.version === null)
    return (
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Kurum sitenize yerleştireceğiniz başvuru formu aday kaydına düşer; kaynak &quot;Web
          sitesi&quot; olarak yazılır. Üçüncü taraf betik ve çerez kullanmaz.
        </p>
        <Button
          type="button"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => void rotate.submit({ version: null })}
        >
          Form bağlantısı oluştur
        </Button>
      </div>
    )

  const version = data.version
  const url = applicationFormUrl(
    new URL(import.meta.env.BASE_URL, window.location.origin).href,
    data.formKey,
  )
  const code = applicationEmbedCode(url, 'Ön başvuru formu', dark)

  const saveSite = form.handleSubmit(async ({ siteOrigin }) => {
    const outcome = await update.submit(
      { version, body: { siteOrigin: siteOrigin === '' ? null : siteOrigin } },
      {
        setError: fieldErrors(['siteOrigin'] as const, form.setError, (name) =>
          form.setFocus(name),
        ),
      },
    )
    if (outcome.status === 'success') notify.success('Site adresi kaydedildi.')
  })

  async function toggle(enabled: boolean) {
    const outcome = await update.submit({ version, body: { enabled } })
    if (outcome.status === 'success') notify.success(enabled ? 'Form açıldı.' : 'Form kapatıldı.')
  }

  async function renew() {
    setConfirmRotate(false)
    const outcome = await rotate.submit({ version })
    if (outcome.status === 'success')
      notify.success('Anahtar yenilendi; eski gömme kodu artık çalışmaz.')
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <section aria-labelledby="web-formu-durum" className="grid grid-cols-1 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="web-formu-durum" className="text-sm font-semibold">
            Form durumu
          </h3>
          <StatusBadge
            text={data.enabled ? 'Açık' : 'Kapalı'}
            tone={data.enabled ? 'green' : 'gray'}
          />
        </div>
        {noticeMissing ? (
          <p role="status" className="text-sm text-warning">
            Form açılmadan önce aday aydınlatma metnini yayımlayın; metin başvurandan önce
            gösterilir.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Başvurana güncel aday aydınlatma metni (sürüm {data.noticeVersion}) gösterilir.
          </p>
        )}
        <Button
          type="button"
          variant={data.enabled ? 'outline' : 'default'}
          disabled={busy || (!data.enabled && noticeMissing)}
          aria-busy={update.isPending || undefined}
          onClick={() => void toggle(!data.enabled)}
        >
          {data.enabled ? 'Formu kapat' : 'Formu aç'}
        </Button>
      </section>

      <form
        noValidate
        aria-label="Kurum sitesi"
        onSubmit={(event) => void saveSite(event)}
        className="grid grid-cols-1 gap-3 border-t pt-4"
      >
        <FormField
          id="web-formu-site"
          label="Kurum sitesinin adresi"
          description="Form yalnız bu sitede gömülebilir. Boş bırakılırsa yalnız doğrudan bağlantıyla açılır."
          error={form.formState.errors.siteOrigin}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('siteOrigin')}
              inputMode="url"
              autoComplete="off"
              placeholder="https://okul.example"
              disabled={busy}
            />
          )}
        </FormField>
        <div>
          <Button type="submit" variant="secondary" disabled={busy}>
            Adresi kaydet
          </Button>
        </div>
      </form>

      <section aria-labelledby="web-formu-kod" className="grid grid-cols-1 gap-3 border-t pt-4">
        <h3 id="web-formu-kod" className="text-sm font-semibold">
          Gömme kodu
        </h3>
        <FormField id="web-formu-baglanti" label="Form bağlantısı">
          {(control) => <Input {...control} readOnly value={url} />}
        </FormField>
        <FormField
          id="web-formu-iframe"
          label="Sitenize yapıştıracağınız kod"
          description={
            data.siteOrigin === null
              ? 'Site adresi kaydedilmeden kod çalışmaz: form başka sitelerde açılmaz.'
              : `Kod yalnız ${data.siteOrigin} üzerinde çalışır.`
          }
        >
          {(control) => (
            <Textarea {...control} readOnly rows={5} value={code} className="font-mono text-sm" />
          )}
        </FormField>
        <div className="flex items-center gap-2.5">
          <Checkbox
            id="web-formu-koyu"
            checked={dark}
            onCheckedChange={(value) => setDark(value === true)}
          />
          <Label htmlFor="web-formu-koyu" className="font-normal">
            Formu koyu temada göster
          </Label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void copyText(code, 'Kod kopyalandı.')}
          >
            Kodu kopyala
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmRotate(true)}
          >
            Anahtarı yenile
          </Button>
        </div>
      </section>

      <AlertDialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anahtar yenilensin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              Eski bağlantı ve sitenizdeki gömme kodu hemen çalışmaz olur; yeni kodu sitenize
              yeniden yapıştırmanız gerekir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction onClick={() => void renew()}>Anahtarı yenile</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
