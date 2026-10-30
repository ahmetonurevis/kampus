import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Icon } from '@/components/Icon.tsx'
import { useMediaQuery } from '@/hooks/use-media-query.ts'
import type { Session } from '@/auth/auth-port.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { clearViewMemory } from '@/lib/view-memory.ts'
import { SidebarContent } from './Sidebar.tsx'
import { Topbar } from './Topbar.tsx'

const YEAR = new Date().getFullYear()

type AppLayoutProps = { session: Session; title: string; children: ReactNode }

/**
 * Uygulama kabuğu. Cam yalnız yüzen katmanlarda: sidebar, topbar ve açık menü/diyalog
 * (aynı anda en fazla 3 bulanık katman). İçerik yüzeyleri opaktır.
 */
export function AppLayout({ session, title, children }: AppLayoutProps) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const narrow = useMediaQuery('(max-width: 860px)')
  const [menuOpen, setMenuOpen] = useState(false)

  function handleSignOut() {
    setMenuOpen(false)
    void signOut()
      .then(() => {
        clearViewMemory()
        return navigate('/giris', { replace: true })
      })
      .catch((error: unknown) => console.error('[auth] oturum kapatılamadı', error))
  }

  const sidebar = (
    <SidebarContent
      session={session}
      onNavigate={narrow ? () => setMenuOpen(false) : undefined}
      onSignOut={handleSignOut}
    />
  )

  return (
    <>
      <a className="skip-link" href="#main">
        İçeriğe geç
      </a>
      {narrow ? (
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent
            side="left"
            showCloseButton={false}
            aria-describedby={undefined}
            className="sidebar glass-sidebar w-[268px] max-w-[85vw] gap-0 border-0 p-0 text-sidebar-foreground [&_:is(a,button):focus-visible]:outline-brand"
          >
            <SheetTitle className="sr-only">Ana gezinme</SheetTitle>
            <button
              type="button"
              aria-label="Menüyü kapat"
              onClick={() => setMenuOpen(false)}
              className="absolute top-4 right-4 grid size-11 place-items-center rounded-2xl text-sidebar-foreground hover:bg-sidebar-raised"
            >
              <Icon name="X" size={20} />
            </button>
            {sidebar}
          </SheetContent>
        </Sheet>
      ) : (
        <aside
          aria-label="Ana gezinme"
          className="sidebar glass-sidebar fixed top-3 bottom-3 left-3 z-30 flex w-sidebar flex-col overflow-hidden rounded-card text-sidebar-foreground [&_:is(a,button):focus-visible]:outline-brand"
        >
          {sidebar}
        </aside>
      )}
      <div className="main-shell flex min-h-dvh flex-col min-[861px]:ml-[256px]">
        <Topbar
          session={session}
          title={title}
          narrow={narrow}
          menuOpen={menuOpen}
          onOpenMenu={() => setMenuOpen(true)}
          onSignOut={handleSignOut}
        />
        <main
          id="main"
          tabIndex={-1}
          className="main-content mx-auto w-full max-w-content flex-1 scroll-mt-24 p-8 outline-none max-[650px]:px-4 max-[650px]:py-6"
        >
          {children}
        </main>
        <footer className="app-footer flex flex-wrap justify-between gap-2 border-t px-[31px] py-[21px] text-2xs text-muted-foreground">
          <span>© {YEAR} Kampüs · Öğrenmenin her adımında.</span>
        </footer>
      </div>
    </>
  )
}
