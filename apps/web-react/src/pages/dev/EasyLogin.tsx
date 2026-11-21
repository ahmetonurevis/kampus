// Yalnız geliştirme: giriş ekranındaki "Kolay giriş" düğmesi ve hesap seçme penceresi. LoginPage
// bunu `import.meta.env.DEV` koşuluyla `lazy` yükler; üretim derlemesine girmez, `vite.config.ts`
// `devOnlyGuard` üretim çıktısında iz kalırsa derlemeyi durdurur.
import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  meQueryOptions,
  useActiveInstitution,
} from '@kampus/react-shared/use-active-institution.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/auth/use-auth.ts'
import { notify } from '@/lib/notify.ts'
import { cn } from '@/lib/utils'
import { clearViewMemory } from '@/lib/view-memory.ts'
import {
  accountKey,
  EASY_LOGIN_ACCOUNTS,
  EASY_LOGIN_MARKER,
  easyLoginPassword,
  groupEasyLoginAccounts,
  type EasyLoginAccount,
} from './easy-login-accounts.ts'
import { runEasyLogin } from './easy-login-flow.ts'

const PASSWORD = easyLoginPassword(import.meta.env.VITE_DEMO_PASSWORD)
const GROUPS = groupEasyLoginAccounts(EASY_LOGIN_ACCOUNTS)

type EasyLoginProps = {
  /**
   * Giriş ve gerekiyorsa kurum geçişi sürerken `true`. Giriş sayfası bu sürede yönlendirmeyi
   * bekletir; yönlendirme geçiş bittikten sonra normal girişteki gibi (dönüş adresiyle) yapılır.
   */
  onPendingChange: (pending: boolean) => void
}

export function EasyLogin({ onPendingChange }: EasyLoginProps) {
  const [open, setOpen] = useState(false)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const { signIn } = useAuth()
  const client = useKampusClient()
  const queryClient = useQueryClient()
  const { switchInstitution } = useActiveInstitution()
  const headingId = useId()

  const pendingAccount = pendingKey
    ? EASY_LOGIN_ACCOUNTS.find((account) => accountKey(account) === pendingKey)
    : undefined

  async function enter(account: EasyLoginAccount) {
    if (pendingKey) return
    setPendingKey(accountKey(account))
    onPendingChange(true)
    try {
      // Oturumun varsayılan kurumu seçilen satırın kurumu değilse (iki kurumlu yönetici) avatar
      // menüsündeki kurum değiştirme yolu kullanılır.
      const notice = await runEasyLogin(account, PASSWORD, {
        signIn,
        fetchMe: () => queryClient.fetchQuery(meQueryOptions(client)),
        switchInstitution: async (institutionId) => {
          await switchInstitution.mutateAsync(institutionId)
          clearViewMemory()
        },
      })
      if (notice) notify.error(notice.message, notice.cause)
    } finally {
      setPendingKey(null)
      onPendingChange(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="min-h-[44px] w-full rounded-lg text-sm text-muted-foreground hover:text-foreground"
      >
        <Icon name="Zap" size={16} />
        Kolay giriş
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Kolay giriş"
        description="Yalnız geliştirmede görünür. Hesabı seçin; demo parolasıyla giriş yapılır."
      >
        <div className="flex flex-col gap-6" data-dev-only={EASY_LOGIN_MARKER}>
          {/* Bekleme durumu ekran okuyucuya bildirilir; bölge pencere açıkken hep yerinde durur. */}
          <p aria-live="polite" className="sr-only">
            {pendingAccount ? `${pendingAccount.name} ile giriş yapılıyor…` : ''}
          </p>
          {GROUPS.map((group, groupIndex) => (
            <section
              key={group.institution}
              aria-labelledby={`${headingId}-${groupIndex}`}
              className="flex flex-col gap-3"
            >
              <h3 id={`${headingId}-${groupIndex}`} className="text-base font-semibold">
                {group.institution}
              </h3>
              {group.roles.map((roleGroup) => {
                const roleId = `${headingId}-${groupIndex}-${roleGroup.role}`
                return (
                  <div key={roleGroup.role} className="flex flex-col gap-1.5">
                    <h4 id={roleId} className="text-xs font-medium text-muted-foreground">
                      {roleGroup.label}
                    </h4>
                    <ul aria-labelledby={roleId} className="flex flex-col gap-1.5">
                      {roleGroup.accounts.map((account) => {
                        const key = accountKey(account)
                        const busy = pendingKey === key
                        return (
                          <li key={key}>
                            <button
                              type="button"
                              // `disabled` odağı pencereden düşürür; kilit `aria-disabled` ile.
                              aria-disabled={pendingKey !== null}
                              aria-busy={busy}
                              onClick={() => void enter(account)}
                              className={cn(
                                'flex min-h-12 w-full items-center gap-3 rounded-xl border px-3.5 py-2 text-left transition-colors',
                                pendingKey === null
                                  ? 'bg-background hover:bg-secondary'
                                  : 'cursor-not-allowed',
                                // Kilitli satır saydamlaşmaz (kontrast AA altına düşerdi); sakin
                                // zemin ve ikincil metin tokenı kullanılır.
                                pendingKey !== null && !busy && 'bg-muted text-muted-foreground',
                                busy && 'bg-background',
                              )}
                            >
                              <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-sm font-medium">
                                  {account.name}
                                  <span className="font-normal text-muted-foreground">
                                    {' · '}
                                    {roleGroup.label}
                                  </span>
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                  {account.email}
                                </span>
                                <span className="sr-only">{`, ${account.institution}`}</span>
                              </span>
                              {busy ? (
                                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                                  <Icon
                                    name="RefreshCw"
                                    size={14}
                                    className="motion-safe:animate-spin"
                                  />
                                  Giriş yapılıyor…
                                </span>
                              ) : (
                                <Icon
                                  name="ArrowRight"
                                  size={16}
                                  className="shrink-0 text-muted-foreground"
                                />
                              )}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </Modal>
    </>
  )
}
