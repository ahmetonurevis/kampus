import { useState } from 'react'
import { moduleChangedMessage, type ModuleRow } from '@kampus/react-shared/module-settings.ts'
import { useModuleSettings, useSetModuleEnabled } from '@kampus/react-shared/use-module-settings.ts'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify.ts'

export const CLOSE_WARNING = 'Modül kapanınca menü ve sayfaları gizlenir, veriler silinmez.'

/**
 * Ayarlar → Kurum & Modüller (yönetici, DOM-YTK-040/042; Vue `Settings.vue` modül yönetimi).
 * Kurum türünde olmayan modül sunucu listesinde yoktur. Açma doğrudan, kapatma onay
 * penceresinden sonra gönderilir; başarıda oturumdaki `enabledModules` tazelenir ve menü anında
 * değişir (`useSetModuleEnabled`). Başka yönetici araya girdiyse 409: Türkçe mesaj, liste yenilenir.
 */
export function ModuleSettingsSection() {
  const settings = useModuleSettings()
  const setEnabled = useSetModuleEnabled()
  const [closing, setClosing] = useState<ModuleRow | null>(null)

  async function submit(row: ModuleRow, enabled: boolean) {
    if (settings.version === null) return
    const outcome = await setEnabled.submit({
      moduleKey: row.key,
      enabled,
      version: settings.version,
    })
    if (outcome.status === 'success') notify.success(moduleChangedMessage(row.title, enabled))
  }

  async function confirmClose() {
    const row = closing
    setClosing(null)
    if (row) await submit(row, false)
  }

  function onToggle(row: ModuleRow, enabled: boolean) {
    // Kapatma geri alınabilir ama tüm rollerin iş akışını değiştirir (DOM-YTK-042): onay ister.
    if (enabled) void submit(row, true)
    else setClosing(row)
  }

  if (settings.error)
    return (
      <section className="panel rounded-card border bg-surface px-6 py-8">
        <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
      </section>
    )

  const busy = setEnabled.isPending
  return (
    <section
      aria-labelledby="modul-yonetimi"
      aria-busy={settings.isLoading || busy || undefined}
      className="panel rounded-card border bg-surface"
    >
      <div className="border-b px-6 py-5 max-[650px]:px-4">
        <h2 id="modul-yonetimi" className="text-lg font-semibold">
          Modül yönetimi
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Kapalı modüller menülerden kaldırılır ve doğrudan bağlantı ile açılamaz. Kapatmak veri
          silmez.
        </p>
      </div>
      {settings.isLoading ? (
        <p role="status" className="px-6 py-6 text-sm text-muted-foreground">
          Modüller yükleniyor…
        </p>
      ) : (
        <ul className="divide-y">
          {settings.rows.map((row) => (
            <li key={row.key} className="flex items-center gap-4 px-6 py-4 max-[650px]:px-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                <Icon name={row.icon} size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{row.title}</p>
                <p className="text-sm text-muted-foreground">{row.description}</p>
              </div>
              <Switch
                checked={row.enabled}
                disabled={busy || settings.isFetching}
                aria-label={row.title}
                onCheckedChange={(next) => onToggle(row, next)}
              />
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={closing !== null}
        onOpenChange={(open) => (open ? undefined : setClosing(null))}
        title={closing ? `${closing.title} modülünü kapat` : 'Modülü kapat'}
        description={CLOSE_WARNING}
        footer={
          <>
            <Button variant="secondary" onClick={() => setClosing(null)}>
              Vazgeç
            </Button>
            <Button variant="destructive" onClick={() => void confirmClose()}>
              Modülü kapat
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Modülün kayıtları saklanır; modülü yeniden açtığınızda aynen görünür.
        </p>
      </Modal>
    </section>
  )
}
