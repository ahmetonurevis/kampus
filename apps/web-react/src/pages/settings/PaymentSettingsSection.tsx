import { useState } from 'react'
import { IF_MATCH_MISSING_MESSAGE } from '@kampus/react-shared/commands.ts'
import { useModuleSettings } from '@kampus/react-shared/use-module-settings.ts'
import {
  usePaymentSettings,
  useSetCashPayments,
} from '@kampus/react-shared/use-payment-commands.ts'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
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
  return <CashSetting />
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
