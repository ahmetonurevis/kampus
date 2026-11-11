import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-ext-400.css'
import '@fontsource/inter/latin-ext-500.css'
import '@fontsource/inter/latin-ext-600.css'
import { KampusProvider } from '@kampus/react-shared/KampusProvider.tsx'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/auth/AuthProvider.tsx'
import { apiClient, authClient, queryClient } from '@/lib/kampus-clients.ts'
import { notify } from '@/lib/notify.ts'
import { router } from './routes.tsx'
import './styles/app.css'

const root = document.getElementById('root')
if (!root) throw new Error('Kök öğe bulunamadı.')

createRoot(root).render(
  <StrictMode>
    <KampusProvider
      client={apiClient}
      auth={authClient}
      queryClient={queryClient}
      notifyError={notify.error}
    >
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" />
      </AuthProvider>
    </KampusProvider>
  </StrictMode>,
)
