import { useApplicationFormSettings } from '@kampus/react-shared/use-prospect-application-form.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { applicationLimitWarning } from './prospect-application-form.ts'

/**
 * Bugün ön başvuru tavanı dolduysa yöneticiye tek uyarı (DOM-KAY-002, K-23): gönderim başına ayrı
 * bildirim üretilmez, gün değişince kendiliğinden kalkar. Form ayarını okur; uç yalnız yöneticiye ve
 * `crm` açıkken açıktır, başkası için sorgu da gitmez.
 */
export function ApplicationLimitNotice() {
  const { session } = useAuth()
  const allowed = session?.role === 'yonetici' && session.modules.crm === true
  const settings = useApplicationFormSettings(allowed)
  const warning =
    allowed && settings.data ? applicationLimitWarning(settings.data.data.dailyLimit) : null
  if (warning === null) return null
  return (
    <p role="status" className="mb-4 rounded-md border bg-warning-soft p-3 text-sm">
      {warning}
    </p>
  )
}
