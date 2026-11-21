import { Link, useNavigate } from 'react-router'
import { useActiveInstitution } from '@kampus/react-shared/use-active-institution.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { Icon } from '@/components/Icon.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Session } from '@/auth/auth-port.ts'
import { securityHref, SECURITY_TITLE } from '@/lib/account-pages.ts'
import { accountPages, getRole, pageHref } from '@/lib/navigation.ts'
import { notify } from '@/lib/notify.ts'
import { clearViewMemory } from '@/lib/view-memory.ts'

type AccountMenuProps = { session: Session; onSignOut: () => void }

const SWITCH_FAILED = 'Kurum değiştirilemedi. Lütfen tekrar deneyin.'

/** Sağ üstteki isim/avatar menüsü: hesap sayfaları, kurum değiştirme ve oturum kapatma burada. */
export function AccountMenu({ session, onSignOut }: AccountMenuProps) {
  const pages = accountPages(session.role, session.modules, session.institution.type)
  const navigate = useNavigate()
  const { switchInstitution } = useActiveInstitution()

  function selectInstitution(institutionId: string) {
    if (institutionId === session.institution.id || switchInstitution.isPending) return
    // react-shared eski kurumun sorgularını siler ve `/me`'yi yeniler; görünüm belleği (liste
    // durumu, seçili çocuk) da eski kuruma ait olduğundan burada temizlenir.
    switchInstitution
      .mutateAsync(institutionId)
      .then(() => {
        clearViewMemory()
        return navigate('/', { replace: true })
      })
      .catch((error: unknown) => notify.error(SWITCH_FAILED, error))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Hesap menüsü: ${session.user.name}`}
        className="grid size-9 place-items-center rounded-2xl max-[860px]:size-11"
      >
        <Avatar name={session.user.name} size="small" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={10} className="min-w-56 rounded-2xl p-1.5">
        <DropdownMenuLabel className="flex flex-col gap-0.5 px-2.5 py-2">
          <span className="text-base font-semibold">{session.user.name}</span>
          <span className="text-xs font-normal text-muted-foreground">{session.roleSubtitle}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {session.memberships.length > 1 ? (
          <>
            <DropdownMenuLabel className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
              Kurum
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={session.institution.id}
              onValueChange={selectInstitution}
              aria-label="Kurum değiştir"
            >
              {session.memberships.map((membership) => (
                <DropdownMenuRadioItem
                  key={membership.id}
                  value={membership.institutionId}
                  disabled={switchInstitution.isPending}
                  className="min-h-10 rounded-lg text-sm"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{membership.institutionName}</span>
                    <span className="text-xs text-muted-foreground">
                      {getRole(membership.role).label}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {pages.map((page) => (
          <DropdownMenuItem key={page.path} asChild className="min-h-10 rounded-lg text-sm">
            <Link to={pageHref(session.role, page)}>
              <Icon name={page.icon} size={17} />
              {page.title}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem asChild className="min-h-10 rounded-lg text-sm">
          <Link to={securityHref(session.role)}>
            <Icon name="ShieldCheck" size={17} />
            {SECURITY_TITLE}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut} className="min-h-10 rounded-lg text-sm">
          <Icon name="LogOut" size={17} />
          Oturumu kapat
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
