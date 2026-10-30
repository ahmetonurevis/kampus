import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-ext-400.css'
import '@fontsource/inter/latin-ext-500.css'
import '@fontsource/inter/latin-ext-600.css'
import { Toaster } from '@/components/ui/sonner'
import './styles/app.css'

const root = document.getElementById('root')
if (!root) throw new Error('Kök öğe bulunamadı.')

createRoot(root).render(
  <StrictMode>
    <main id="icerik" className="p-8">
      <h1>Kampüs</h1>
    </main>
    <Toaster />
  </StrictMode>,
)
