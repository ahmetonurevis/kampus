import { useState } from 'react'
import { NavLink, useParams } from 'react-router'
import { Avatar } from '@/components/Avatar.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { Session } from '@/auth/auth-port.ts'
import { academicYearLabel } from '@/auth/session-mapping.ts'
import {
  isGroupExpanded,
  pageHref,
  setGroupExpanded,
  sidebarGroups,
  type GroupState,
} from '@/lib/navigation.ts'
import { cn } from '@/lib/utils'
import { readView, writeView } from '@/lib/view-memory.ts'

const GROUPS_KEY = 'nav-groups'

function storedGroups(): GroupState {
  const value = readView(GROUPS_KEY)
  return value && typeof value === 'object' ? (value as GroupState) : {}
}

type SidebarContentProps = {
  session: Session
  onNavigate?: () => void
  onSignOut: () => void
}

/** Sidebar içeriği: masaüstünde sabit cam yüzey, dar ekranda soldan açılan panel içinde. */
export function SidebarContent({ session, onNavigate, onSignOut }: SidebarContentProps) {
  const { page: activePath } = useParams()
  const [expanded, setExpanded] = useState<GroupState>(storedGroups)
  const groups = sidebarGroups(session.role, session.modules)
  const term = academicYearLabel(session.institution.academicYear)

  function toggle(group: string, open: boolean) {
    const next = setGroupExpanded(expanded, session.role, group, open)
    writeView(GROUPS_KEY, next)
    setExpanded(next)
  }

  return (
    <>
      <NavLink
        to={pageHref(session.role, { path: 'dashboard' })}
        onClick={onNavigate}
        className="brand flex items-center gap-3 px-[27px] pt-[31px] pb-[29px] text-sidebar-strong no-underline"
      >
        <span className="grid size-[41px] place-items-center rounded-xl bg-on-sapphire text-sapphire">
          <Icon name="GraduationCap" size={27} />
        </span>
        <span className="flex flex-col text-4xl leading-[1.05] font-semibold tracking-[-1.2px]">
          <span>
            kampüs<span className="text-brand">.</span>
          </span>
          <small className="mt-1 text-[6px] font-medium tracking-[1.5px]">
            EĞİTİMİN YENİ ADRESİ
          </small>
        </span>
      </NavLink>

      <div className="mx-[17px] mb-[22px] flex items-center gap-3 rounded-2xl border border-sidebar-border p-3">
        <span
          aria-hidden="true"
          className="grid h-[33px] w-[31px] place-items-center rounded-md bg-sidebar-raised text-sm font-semibold text-sidebar-strong"
        >
          {session.institution.name.charAt(0)}
        </span>
        <div className="flex min-w-0 flex-col">
          <strong className="truncate text-2xs font-medium text-sidebar-strong">
            {session.institution.name}
          </strong>
          {term ? <small className="text-[8px] text-sidebar-foreground">{term}</small> : null}
        </div>
      </div>

      <nav aria-label="Menü" className="side-nav min-h-0 flex-1 overflow-y-auto px-3.5">
        {groups.map((group) => {
          const open = isGroupExpanded(
            expanded,
            session.role,
            group.key,
            group.pages.some((page) => page.path === activePath),
          )
          return (
            <Collapsible
              key={`${session.role}:${group.key}`}
              open={open}
              onOpenChange={(value) => toggle(group.key, value)}
              className="nav-group mb-2 border-t border-sidebar-border pt-2 first:border-t-0 first:pt-0"
            >
              <CollapsibleTrigger className="nav-group-toggle flex h-9 w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-sidebar-muted hover:text-sidebar-strong">
                {group.label}
                <Icon
                  name="ChevronDown"
                  size={15}
                  className={cn('transition-transform', open && 'rotate-180')}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col items-start gap-0.5">
                {group.pages.map((page) => (
                  <NavLink
                    key={page.path}
                    to={pageHref(session.role, page)}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'nav-link inline-flex min-h-[43px] items-center gap-2.5 rounded-lg px-3 py-[11px] text-sm text-sidebar-foreground no-underline hover:bg-sidebar-raised hover:text-sidebar-strong',
                        isActive &&
                          'bg-sidebar-active font-semibold text-sidebar-active-foreground hover:bg-sidebar-active hover:text-sidebar-active-foreground',
                      )
                    }
                  >
                    <Icon name={page.icon} size={19} />
                    <span>{page.title}</span>
                  </NavLink>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      </nav>

      <div className="sidebar-user flex items-center gap-3 border-t border-sidebar-border px-[19px] py-[18px]">
        <Avatar name={session.user.name} />
        <div className="flex min-w-0 flex-1 flex-col">
          <strong className="truncate text-xs font-medium text-sidebar-strong">
            {session.user.name}
          </strong>
          <small className="truncate text-[8px] text-sidebar-foreground">
            {session.roleSubtitle}
          </small>
        </div>
        <button
          type="button"
          aria-label="Oturumu kapat"
          onClick={onSignOut}
          className="grid size-9 place-items-center rounded-2xl text-sidebar-foreground hover:bg-sidebar-raised hover:text-sidebar-strong"
        >
          <Icon name="LogOut" size={18} />
        </button>
      </div>
    </>
  )
}
