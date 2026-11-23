import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { bankAccountSchema, type BankAccountInput } from '@kampus/school-core/lib/payments.ts'
import { IF_MATCH_MISSING_MESSAGE } from '@kampus/react-shared/commands.ts'
import { useModuleSettings } from '@kampus/react-shared/use-module-settings.ts'
import {
  useArchiveBankAccount,
  useBankAccounts,
  useCreateBankAccount,
  usePaymentSettings,
  useSetCashPayments,
} from '@kampus/react-shared/use-payment-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify.ts'

export const CASH_OPEN_WARNING =
  'Öğrenim ücretinin bildirilmiş banka hesabına tahsili mevzuat kuralıdır (ÖÖKY md. 55/3). Nakit tahsilatın kurumunuz için uygunluğunu açmadan önce doğrulayın.'

/**
 * Ayarlar → nakit tahsilat (yönetici; ADR 0006 karar 7, DOM-FIN-032). Finans modülü kapalıysa
 * bölüm gösterilmez. Açma mevzuat uyarısı ve onay ister, kapatma doğrudandır; geçmiş tahsilatlar
 * değişmez. Başka yönetici araya girdiyse 409: Türkçe mesaj, durum yenilenir.
 */
export function PaymentSettingsSection() {
  const modules = useModuleSettings()
  const financeOpen = modules.rows.some((row) => row.key === 'finance' && row.enabled)
  if (!financeOpen) return null
  return (
    <>
      <CashSetting />
      <BankAccountsSetting />
    </>
  )
}

const EMPTY_ACCOUNT: BankAccountInput = { bankName: '', iban: '', accountHolder: '' }

/**
 * Bildirilmiş banka hesapları (DOM-FIN-032). Hesap tanımlıysa nakit dışı tahsilat bu hesaplardan
 * birine bağlanır. Arşivlenen hesap yeni tahsilatta seçilmez, geçmiş tahsilatlarda görünür.
 */
function BankAccountsSetting() {
  const accounts = useBankAccounts()
  const create = useCreateBankAccount()
  const archive = useArchiveBankAccount()
  const form = useForm<BankAccountInput>({
    resolver: zodResolver(bankAccountSchema),
    defaultValues: EMPTY_ACCOUNT,
  })
  const busy = create.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(values, {
      setError: (name, error) => {
        if (name === 'bankName' || name === 'iban' || name === 'accountHolder')
          form.setError(name, error)
      },
    })
    if (outcome.status === 'success') {
      notify.success('Banka hesabı eklendi.')
      form.reset(EMPTY_ACCOUNT)
    }
  })

  async function remove(account: { id: string; version: number }) {
    const outcome = await archive.submit({ id: account.id, version: account.version })
    if (outcome.status === 'success') notify.success('Banka hesabı arşivlendi.')
  }

  const rows = accounts.data?.data ?? []
  return (
    <section
      aria-labelledby="banka-hesaplari"
      aria-busy={accounts.isPending || undefined}
      className="panel rounded-card border bg-surface"
    >
      <div className="border-b px-6 py-5 max-[650px]:px-4">
        <h2 id="banka-hesaplari" className="text-lg font-semibold">
          Bildirilmiş banka hesapları
        </h2>
        <p className="text-sm text-muted-foreground">
          Hesap tanımlıysa havale ve kart tahsilatı bu hesaplardan birine bağlanır.
        </p>
      </div>
      {accounts.error ? (
        <div className="px-6 py-4 max-[650px]:px-4">
          <QueryError error={accounts.error} onRetry={() => void accounts.refetch()} />
        </div>
      ) : (
        <ul aria-label="Banka hesapları" className="divide-y">
          {rows.map((account) => (
            <li
              key={account.id}
              className="flex flex-wrap items-center gap-4 px-6 py-4 max-[650px]:px-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{account.bankName}</p>
                <p className="text-sm break-all text-muted-foreground">
                  {account.iban} · {account.accountHolder}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={archive.isPending}
                aria-label={`${account.bankName} hesabını arşivle`}
                onClick={() => void remove(account)}
              >
                Arşivle
              </Button>
            </li>
          ))}
          {rows.length === 0 && !accounts.isPending ? (
            <li className="px-6 py-4 text-sm text-muted-foreground max-[650px]:px-4">
              Henüz banka hesabı tanımlanmadı.
            </li>
          ) : null}
        </ul>
      )}
      <form
        noValidate
        aria-label="Banka hesabı ekle"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4 border-t px-6 py-5 max-[650px]:px-4"
      >
        <FormField id="hesap-banka" label="Banka adı" error={errors.bankName}>
          {(control) => <Input {...control} {...form.register('bankName')} disabled={busy} />}
        </FormField>
        <FormField id="hesap-iban" label="IBAN" error={errors.iban}>
          {(control) => (
            <Input {...control} {...form.register('iban')} autoComplete="off" disabled={busy} />
          )}
        </FormField>
        <FormField id="hesap-sahibi" label="Hesap sahibi" error={errors.accountHolder}>
          {(control) => <Input {...control} {...form.register('accountHolder')} disabled={busy} />}
        </FormField>
        <div>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            Hesabı ekle
          </Button>
        </div>
      </form>
    </section>
  )
}

function CashSetting() {
  const settings = usePaymentSettings()
  const setCash = useSetCashPayments()
  const [confirming, setConfirming] = useState(false)

  async function submit(enabled: boolean) {
    if (settings.version === null) {
      notify.error(IF_MATCH_MISSING_MESSAGE)
      return
    }
    const outcome = await setCash.submit({ enabled, version: settings.version })
    if (outcome.status === 'success')
      notify.success(enabled ? 'Nakit tahsilat açıldı.' : 'Nakit tahsilat kapatıldı.')
  }

  if (settings.error)
    return (
      <section className="panel rounded-card border bg-surface px-6 py-8">
        <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
      </section>
    )

  const busy = setCash.isPending
  return (
    <section
      aria-labelledby="tahsilat-ayarlari"
      aria-busy={settings.isPending || busy || undefined}
      className="panel rounded-card border bg-surface"
    >
      <div className="border-b px-6 py-5 max-[650px]:px-4">
        <h2 id="tahsilat-ayarlari" className="text-lg font-semibold">
          Tahsilat ayarları
        </h2>
      </div>
      <div className="flex items-center gap-4 px-6 py-4 max-[650px]:px-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Nakit tahsilat</p>
          <p className="text-sm text-muted-foreground">
            Açıkken tahsilat formunda nakit yöntemi seçilebilir. Geçmiş kayıtlar değişmez.
          </p>
        </div>
        <Switch
          checked={settings.cashEnabled}
          disabled={busy || settings.isPending || settings.isFetching}
          aria-label="Nakit tahsilat"
          onCheckedChange={(next) => (next ? setConfirming(true) : void submit(false))}
        />
      </div>
      <Modal
        open={confirming}
        onOpenChange={(open) => (open ? undefined : setConfirming(false))}
        title="Nakit tahsilatı aç"
        description={CASH_OPEN_WARNING}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Vazgeç
            </Button>
            <Button
              onClick={() => {
                setConfirming(false)
                void submit(true)
              }}
            >
              Nakit tahsilatı aç
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Bu değişiklik işlem geçmişine yazılır. İstediğiniz zaman kapatabilirsiniz.
        </p>
      </Modal>
    </section>
  )
}
