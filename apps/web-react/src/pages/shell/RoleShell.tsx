import { useEffect } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'
import { useAuth } from '@/auth/use-auth.ts'
import { AppLayout } from '@/layout/AppLayout.tsx'
import { notify } from '@/lib/notify.ts'
import { resolveShell } from '@/lib/route-guard.ts'
import { NotFoundContent, NotFoundPage } from './NotFoundPage.tsx'
import { PlaceholderPage } from './PlaceholderPage.tsx'

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
        >
          {decision.kind === 'page' ? (
            <PlaceholderPage key={decision.page.path} page={decision.page} />
          ) : (
            <NotFoundContent />
          )}
        </AppLayout>
      )
    default:
      return decision satisfies never
  }
}
