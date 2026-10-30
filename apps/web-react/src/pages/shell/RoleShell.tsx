import { lazy, Suspense, useEffect } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'
import { useAuth } from '@/auth/use-auth.ts'
import { useChildSelection } from '@/hooks/use-child-selection.ts'
import { AppLayout } from '@/layout/AppLayout.tsx'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import { notify } from '@/lib/notify.ts'
import { resolveShell } from '@/lib/route-guard.ts'
import { NotFoundContent, NotFoundPage } from './NotFoundPage.tsx'
import { PlaceholderPage } from './PlaceholderPage.tsx'

// Yalnız geliştirmede: liste bileşenleri örnek sayfası. Üretimde koşul sabit `false` olur ve
// parça derlemeye girmez.
const DEV_DEMO_PATH = 'ornek-liste'
const ListDemoPage = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import('@/pages/dev/ListDemoPage.tsx')).ListDemoPage }))
  : null

const MODULE_CLOSED = 'Bu modül kurum ayarlarından kapatılmış.'

function ModuleClosedRedirect({ to }: { to: string }) {
  useEffect(() => {
    notify.warning(MODULE_CLOSED, 'module-closed')
  }, [])
  return <Navigate to={to} replace />
}

/** Korumalı rol kabuğu: karar `resolveShell`'de, burada yalnız çizilir. */
export function RoleShell() {
  const { session } = useAuth()
  const { role, page: path } = useParams()
  const location = useLocation()
  const decision = resolveShell(session, role, path)
  const child = useChildSelection(session)

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
      return <Navigate to="/giris" replace state={{ from: location.pathname }} />
    case 'redirect':
      return <Navigate to={decision.to} replace />
    case 'module-closed':
      return <ModuleClosedRedirect to={decision.to} />
    case 'not-found':
    case 'page':
      if (!session) return null
      return (
        <AppLayout
          session={session}
          title={decision.kind === 'page' ? decision.page.title : 'Sayfa bulunamadı'}
          child={child.options.length ? child : undefined}
        >
          {/* Vue gibi: çocuk değişince sayfa yeniden kurulur; her çocuğun kendi görünüm belleği var. */}
          <ViewScopeContext value={child.childId}>
            {decision.kind === 'page' ? (
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
