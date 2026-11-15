import { zodResolver } from '@hookform/resolvers/zod'
import { useFieldArray, useForm } from 'react-hook-form'
import { useModuleSettings } from '@kampus/react-shared/use-module-settings.ts'
import {
  usePurchaseApprovalSettings,
  useSetPurchaseApprovalSettings,
  type PurchaseApprovalSettingsView,
} from '@kampus/react-shared/use-finance-procurement.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import {
  PURCHASE_APPROVAL_TIERS_MAX,
  PURCHASE_APPROVER_ROLE_LABELS,
} from '@kampus/school-core/lib/finance-purchase-approvals.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  ANY_MANAGER,
  approvalFormDefaults,
  approvalFormField,
  approvalFormSchema,
  approvalSettingsBody,
  approverValue,
  newTierRow,
  type ApprovalFormValues,
} from './finance-purchase-approval-form.ts'

/**
 * Ayarlar → Satın alma onayı (yönetici; DOM-FIN-071, ON-223, K-260). Talebin KDV dahil tahmini
 * toplamına göre kademeler: her kademenin alt sınırı ve onaylayanı (herhangi bir yönetici ya da
 * adlandırılmış yönetici). Kademe yoksa talepleri her yönetici tek adımda onaylar (K-129). Kayıt
 * açık talepleri değiştirmez: kademeler gönderimde talebe dondurulur (K-261). Finans modülü
 * kapalıysa bölüm gösterilmez.
 */
export function FinancePurchaseApprovalSettings() {
  const modules = useModuleSettings()
  const financeOpen = modules.rows.some((row) => row.key === 'finance' && row.enabled)
  const settings = usePurchaseApprovalSettings(financeOpen)
  if (!financeOpen) return null
  const data = settings.data?.data
  return (
    <section
      aria-labelledby="satin-alma-onayi"
      aria-busy={settings.isPending || undefined}
      className="panel rounded-card border bg-surface"
    >
      <div className="border-b px-6 py-5 max-[650px]:px-4">
        <h2 id="satin-alma-onayi" className="text-lg font-semibold">
          Satın alma onay kademeleri
        </h2>
        <p className="text-sm text-muted-foreground">
          Talebin KDV dahil tahmini toplamı bir kademenin alt sınırına ulaşırsa o kademenin onayı da
          gerekir; kademeler sırayla onaylanır. Talebi açan kişi onaylayamaz, aynı kişi iki kademeyi
          onaylayamaz. Kademe tanımlı değilse talepleri her yönetici tek adımda onaylar. Değişiklik
          yalnız bundan sonra gönderilen talepleri etkiler.
        </p>
      </div>
      {settings.error ? (
        <div className="px-6 py-4 max-[650px]:px-4">
          <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
        </div>
      ) : data ? (
        // Kaydedilen sürüm değişince form sunucudaki listeyle yeniden kurulur.
        <TiersForm key={data.version} settings={data} />
      ) : (
        <div className="px-6 py-4 max-[650px]:px-4">
          <SummaryLoading />
        </div>
      )}
    </section>
  )
}

function TiersForm({ settings }: { settings: PurchaseApprovalSettingsView }) {
  const save = useSetPurchaseApprovalSettings()
  const form = useForm<ApprovalFormValues>({
    resolver: zodResolver(approvalFormSchema),
    defaultValues: approvalFormDefaults(settings),
  })
  const tiers = useFieldArray({ control: form.control, name: 'tiers' })
  const busy = save.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  // Ayrılmış ya da yöneticiliği düşmüş adlandırılmış kişi seçenekte kalır, uyarıyla işaretlenir.
  const stale = settings.tiers.filter((tier) => !tier.approverEligible)
  const choices = [
    { value: ANY_MANAGER, label: PURCHASE_APPROVER_ROLE_LABELS.yonetici },
    ...settings.approvers.map((approver) => ({
      value: `user:${approver.userId}`,
      label: approver.name,
    })),
    ...stale.map((tier) => ({
      value: approverValue(tier),
      label: `${tier.approverName ?? 'Adı bilinmeyen kişi'} (artık yönetici değil)`,
    })),
  ]

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await save.submit(
      { version: settings.version, body: approvalSettingsBody(values) },
      {
        setError: (name: string, error: { type: string; message: string }) => {
          const field = approvalFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success')
      notify.success(
        values.tiers.length === 0
          ? 'Kademeli onay kapatıldı; talepleri her yönetici tek adımda onaylar.'
          : 'Onay kademeleri kaydedildi.',
      )
  })

  return (
    <form
      noValidate
      aria-label="Satın alma onay kademeleri"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-4 px-6 py-5 max-[650px]:px-4"
    >
      {stale.length > 0 ? (
        <p role="alert" className="rounded-md border border-warning p-3 text-sm">
          Adlandırılmış onaylayanlardan biri artık kurumun etkin yöneticisi değil. Yeni bir
          onaylayan seçip kaydedin; açık talepler geri çekilip yeniden gönderilirse yeni kademeyle
          ilerler.
        </p>
      ) : null}
      {tiers.fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Kademe tanımlı değil: gönderilen talepleri her yönetici tek adımda onaylar.
        </p>
      ) : (
        <ol className="grid gap-3" aria-label="Onay kademeleri">
          {tiers.fields.map((field, index) => (
            <li
              key={field.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-start gap-3 rounded-lg border p-3 max-[650px]:grid-cols-1"
            >
              <FormField
                id={`onay-kademe-${String(index)}-sinir`}
                label={`${String(index + 1)}. kademe alt sınırı (₺)`}
                error={errors.tiers?.[index]?.minTotal}
              >
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    {...form.register(`tiers.${index}.minTotal`)}
                    readOnly={index === 0}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField
                id={`onay-kademe-${String(index)}-onaylayan`}
                label={`${String(index + 1)}. kademe onaylayanı`}
                error={errors.tiers?.[index]?.approver}
              >
                {(control) => (
                  <NativeSelect
                    {...control}
                    {...form.register(`tiers.${index}.approver`)}
                    className="w-full"
                    disabled={busy}
                  >
                    {choices.map((choice) => (
                      <NativeSelectOption key={choice.value} value={choice.value}>
                        {choice.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <Button
                type="button"
                variant="ghost"
                className="mt-6 max-[650px]:mt-0"
                disabled={busy}
                aria-label={`${String(index + 1)}. kademeyi kaldır`}
                onClick={() => {
                  tiers.remove(index)
                  // İlk kademe her zaman 0'dan başlar; kalan ilk satır sıfırlanır.
                  if (index === 0 && tiers.fields.length > 1) form.setValue('tiers.0.minTotal', '0')
                }}
              >
                <Icon name="Trash2" size={16} aria-hidden="true" />
                Kaldır
              </Button>
            </li>
          ))}
        </ol>
      )}
      {errors.tiers?.root?.message || errors.tiers?.message ? (
        <p role="alert" className="text-sm text-danger">
          {errors.tiers.root?.message ?? errors.tiers.message}
        </p>
      ) : null}
      <RootError message={errors.root?.server?.message} />
      <p className="text-sm text-muted-foreground">{tierSummary(settings)}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={busy || tiers.fields.length >= PURCHASE_APPROVAL_TIERS_MAX}
          onClick={() => tiers.append(newTierRow(tiers.fields.length))}
        >
          <Icon name="Plus" size={16} aria-hidden="true" />
          Kademe ekle
        </Button>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}

/** Kayıtlı ayarın tek cümlelik özeti: "0,00 ₺ ve üstü: …; 5.000,00 ₺ ve üstü: …". */
function tierSummary(settings: PurchaseApprovalSettingsView): string {
  if (settings.tiers.length === 0) return 'Kayıtlı ayar: tek adımlı yönetici onayı.'
  return `Kayıtlı ayar: ${settings.tiers
    .map(
      (tier) =>
        `${money(tier.minTotalCents)} ve üstü → ${
          tier.approverUserId === null
            ? PURCHASE_APPROVER_ROLE_LABELS.yonetici.toLocaleLowerCase('tr')
            : (tier.approverName ?? 'adı bilinmeyen kişi')
        }`,
    )
    .join('; ')}.`
}
