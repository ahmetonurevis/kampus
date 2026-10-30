import { createBrowserRouter, Navigate } from 'react-router'
import { useAuth } from '@/auth/use-auth.ts'
import { pageHref } from '@/lib/navigation.ts'
import { RootLayout } from '@/pages/shell/RootLayout.tsx'
import { RouteErrorPage } from '@/pages/shell/RouteErrorPage.tsx'

function HomeRedirect() {
  const { session } = useAuth()
  return (
    <Navigate to={session ? pageHref(session.role, { path: 'dashboard' }) : '/giris'} replace />
  )
}

export const router = createBrowserRouter([
  {
    Component: RootLayout,
    ErrorBoundary: RouteErrorPage,
    children: [
      { index: true, Component: HomeRedirect },
      {
        path: 'giris',
        lazy: async () => ({ Component: (await import('@/pages/auth/LoginPage.tsx')).LoginPage }),
      },
      {
        path: ':role/:page?',
        lazy: async () => ({ Component: (await import('@/pages/shell/RoleShell.tsx')).RoleShell }),
      },
      {
        path: '*',
        lazy: async () => ({
          Component: (await import('@/pages/shell/NotFoundPage.tsx')).NotFoundPage,
        }),
      },
    ],
  },
])
