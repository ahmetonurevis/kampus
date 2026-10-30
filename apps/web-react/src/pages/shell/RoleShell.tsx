import { lazy, Suspense } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'
import { useAuth } from '@/auth/use-auth.ts'
import { useChildSelection } from '@/hooks/use-child-selection.ts'
import { AppLayout } from '@/layout/AppLayout.tsx'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import { withChildParam } from '@/lib/child-selection.ts'
import { loginHref } from '@/lib/return-path.ts'
import { resolveShell, showsClosedNotice } from '@/lib/route-guard.ts'
import { isMigratedPage, MigratedPage } from '@/pages/page-registry.tsx'
import { ModuleClosedPage } from './ModuleClosedPage.tsx'
import { ModuleClosedRedirect } from './ModuleClosedRedirect.tsx'
import { NotFoundContent, NotFoundPage } from './NotFoundPage.tsx'
import { PlaceholderPage } from './PlaceholderPage.tsx'
import { SessionPending } from './SessionPending.tsx'

// Yalnız geliştirmede: liste bileşenleri örnek sayfası. Üretimde koşul sabit `false` olur ve
// parça derlemeye girmez.
const DEV_DEMO_PATH = 'ornek-liste'
const ListDemoPage = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import('@/pages/dev/ListDemoPage.tsx')).ListDemoPage }))
  : null

function PageLoading() {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Sayfa yükleniyor…
    </p>
  )
}

/** Korumalı rol kabuğu: karar `resolveShell`'de, burada yalnız çizilir. */
export function RoleShell() {
  const { status, session, isSigningOut } = useAuth()
  const { role, page: path } = useParams()
  const location = useLocation()
  const decision = resolveShell(session, role, path)
  const child = useChildSelection(session)

  // Oturum durumu bilinmeden yönlendirme yapılmaz; yenilemede girişe düşülmesin.
  if (status === 'loading' && decision.kind !== 'not-found-outside') return <SessionPending />
  // Kurum üyeliği yoksa veya `/me` okunamadıysa giriş sayfası durumu açıklar.
  if (status === 'no-membership' || status === 'error') return <Navigate to="/giris" replace />

  if (ListDemoPage && session && role === session.role && path === DEV_DEMO_PATH)
    return (
      <AppLayout
        session={session}
        title="Liste bileşenleri"
        child={child.options.length ? child : undefined}
      >
        <ViewScopeContext value={child.childId}>
          <Suspense fallback={null}>
            <ListDemoPage key={child.childId} />
          </Suspense>
        </ViewScopeContext>
      </AppLayout>
    )

  switch (decision.kind) {
    case 'not-found-outside':
      return <NotFoundPage />
    case 'login':
      return <Navigate to={loginHref(location.pathname, location.search, isSigningOut())} replace />
    case 'redirect':
      return <Navigate to={decision.to} replace />
    case 'module-closed':
      if (!session || !showsClosedNotice(decision.page))
        return <ModuleClosedRedirect to={decision.to} />
      return (
        <AppLayout
          session={session}
          title={decision.page.title}
          child={child.options.length ? child : undefined}
        >
          <ModuleClosedPage page={decision.page} />
        </AppLayout>
      )
    case 'not-found':
    case 'page':
      if (!session) return null
      // Veli sayfasında seçili çocuk adreste tutulur; eksikse (menü bağlantısı, yenileme) tamamlanır.
      if (child.urlMissing)
        return (
          <Navigate
            to={{
              pathname: location.pathname,
              search: withChildParam(location.search, child.childId),
              hash: location.hash,
            }}
            replace
          />
        )
      return (
        <AppLayout
          session={session}
          title={decision.kind === 'page' ? decision.page.title : 'Sayfa bulunamadı'}
          child={child.options.length ? child : undefined}
        >
          {/* Vue gibi: çocuk değişince sayfa yeniden kurulur; her çocuğun kendi görünüm belleği var. */}
          <ViewScopeContext value={child.childId}>
            {decision.kind === 'page' && isMigratedPage(session.role, decision.page.path) ? (
              <Suspense fallback={<PageLoading />}>
                <MigratedPage
                  key={`${decision.page.path}:${child.childId}`}
                  role={session.role}
                  page={decision.page}
                />
              </Suspense>
            ) : decision.kind === 'page' ? (
              <PlaceholderPage
                key={`${decision.page.path}:${child.childId}`}
                page={decision.page}
              />
            ) : (
              <NotFoundContent />
            )}
          </ViewScopeContext>
        </AppLayout>
      )
    default:
      return decision satisfies never
  }
}
