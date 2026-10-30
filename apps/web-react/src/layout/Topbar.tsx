import { Icon } from '@/components/Icon.tsx'
import { useTheme } from '@/hooks/use-theme.ts'
import type { Session } from '@/auth/auth-port.ts'
import { getRole } from '@/lib/navigation.ts'
import { AccountMenu } from './AccountMenu.tsx'

type TopbarProps = {
  session: Session
  title: string
  narrow: boolean
  menuOpen: boolean
  onOpenMenu: () => void
  onSignOut: () => void
}

const iconButton =
  'grid size-9 place-items-center rounded-2xl text-muted-foreground hover:bg-surface hover:text-foreground max-[860px]:size-11'

export function Topbar({ session, title, narrow, menuOpen, onOpenMenu, onSignOut }: TopbarProps) {
  const { theme, toggleTheme } = useTheme()
  return (
    <header className="topbar glass sticky top-3 z-20 mx-3 mt-3 flex min-h-[72px] items-center justify-between gap-3 rounded-card px-5 py-2.5 max-[860px]:px-3 max-[650px]:flex-wrap">
      <div className="flex min-w-0 items-center gap-2">
        {narrow ? (
          <button
            type="button"
            aria-label="Menüyü aç"
            aria-expanded={menuOpen}
            onClick={onOpenMenu}
            className={iconButton}
          >
            <Icon name="Menu" size={20} />
          </button>
        ) : null}
        <span className="breadcrumb flex min-w-0 items-center gap-[13px] text-sm text-muted-foreground">
          <span className="max-[650px]:hidden">{getRole(session.role).label} Paneli</span>
          <Icon name="ChevronRight" size={14} className="max-[650px]:hidden" />
          <strong className="truncate font-medium text-foreground">{title}</strong>
        </span>
      </div>
      <div className="topbar-actions flex items-center gap-1.5 rounded-[14px] border border-topbar-border bg-topbar p-[5px]">
        <button
          type="button"
          aria-label={theme === 'light' ? 'Koyu temaya geç' : 'Açık temaya geç'}
          onClick={toggleTheme}
          className={iconButton}
        >
          <Icon name={theme === 'light' ? 'Moon' : 'Sun'} size={19} />
        </button>
        <AccountMenu session={session} onSignOut={onSignOut} />
      </div>
    </header>
  )
}
