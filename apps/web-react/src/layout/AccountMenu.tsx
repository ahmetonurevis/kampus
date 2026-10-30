import { Link } from 'react-router'
import { Avatar } from '@/components/Avatar.tsx'
import { Icon } from '@/components/Icon.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Session } from '@/auth/auth-port.ts'
import { accountPages, pageHref } from '@/lib/navigation.ts'

type AccountMenuProps = { session: Session; onSignOut: () => void }

/** Sağ üstteki isim/avatar menüsü: hesap sayfaları ve oturum kapatma burada. */
export function AccountMenu({ session, onSignOut }: AccountMenuProps) {
  const pages = accountPages(session.role, session.modules)
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
        {pages.map((page) => (
          <DropdownMenuItem key={page.path} asChild className="min-h-10 rounded-lg text-sm">
            <Link to={pageHref(session.role, page)}>
              <Icon name={page.icon} size={17} />
              {page.title}
            </Link>
          </DropdownMenuItem>
        ))}
        {pages.length ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onSelect={onSignOut} className="min-h-10 rounded-lg text-sm">
          <Icon name="LogOut" size={17} />
          Oturumu kapat
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
