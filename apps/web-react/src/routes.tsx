import { createBrowserRouter, Navigate } from 'react-router'
import { useAuth } from '@/auth/use-auth.ts'
import { routerBasename, VERIFICATION_ROUTE } from '@/lib/certificate-verification.ts'
import { pageHref } from '@/lib/navigation.ts'
import { RootLayout } from '@/pages/shell/RootLayout.tsx'
import { RouteErrorPage } from '@/pages/shell/RouteErrorPage.tsx'
import { SessionPending } from '@/pages/shell/SessionPending.tsx'

function HomeRedirect() {
  const { status, session } = useAuth()
  if (status === 'loading') return <SessionPending />
  return (
    <Navigate to={session ? pageHref(session.role, { path: 'dashboard' }) : '/giris'} replace />
  )
}

export const router = createBrowserRouter(
  [
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
          path: 'parolami-unuttum',
          lazy: async () => ({
            Component: (await import('@/pages/auth/ForgotPasswordPage.tsx')).ForgotPasswordPage,
          }),
        },
        {
          path: 'parola-sifirla',
          lazy: async () => ({
            Component: (await import('@/pages/auth/ResetPasswordPage.tsx')).ResetPasswordPage,
          }),
        },
        {
          // Kimliksiz belge doğrulama (DOM-DIL-082): oturum gerekmez; statik ilk parça `:role`
          // rotasından önce eşleşir. QR adresi aynı sabitten kurulur.
          path: VERIFICATION_ROUTE,
          lazy: async () => ({
            Component: (await import('@/pages/verification/CertificateVerificationPage.tsx'))
              .CertificateVerificationPage,
          }),
        },
        {
          path: ':role/aday/:prospectId',
          lazy: async () => ({
            Component: (await import('@/pages/shell/RoleShell.tsx')).RoleShell,
          }),
        },
        {
          path: ':role/ogrenci/:studentId',
          lazy: async () => ({
            Component: (await import('@/pages/shell/RoleShell.tsx')).RoleShell,
          }),
        },
        {
          path: ':role/:page?',
          lazy: async () => ({
            Component: (await import('@/pages/shell/RoleShell.tsx')).RoleShell,
          }),
        },
        {
          path: '*',
          lazy: async () => ({
            Component: (await import('@/pages/shell/NotFoundPage.tsx')).NotFoundPage,
          }),
        },
      ],
    },
  ],
  {
    // Uygulama alt yolda yayınlanırsa (Vite `base`) rotalar ve QR adresi aynı kökten çözülür.
    basename: routerBasename(import.meta.env.BASE_URL),
  },
)
