import { useEffect } from 'react'
import { isApiError } from '@kampus/api-client/errors.ts'
import { isModuleDisabledError } from '@kampus/react-shared/collections.ts'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/auth/use-auth.ts'
import { pageHref } from '@/lib/navigation.ts'
import { ModuleClosedRedirect } from '@/pages/shell/ModuleClosedRedirect.tsx'

const FALLBACK = 'Kayıtlar yüklenemedi. Lütfen yeniden deneyin.'
const FORBIDDEN = 'Bu kayıtları görüntüleme yetkiniz yok.'
const NOT_FOUND = 'Kayıt bulunamadı. Silinmiş veya arşive taşınmış olabilir.'

/** Kullanıcıya gösterilecek Türkçe metin; teknik ayrıntı (kod, istek kimliği) yalnız loga gider. */
export function queryErrorMessage(error: unknown): string {
  if (!isApiError(error)) return FALLBACK
  if (error.status === 403 && error.code === 'forbidden') return FORBIDDEN
  if (error.status === 404) return NOT_FOUND
  return error.message || FALLBACK
}

type QueryErrorProps = {
  error: unknown
  onRetry?: () => void
}

/**
 * Sorgu hatası durumu: kapalı modül (403 `module_disabled`) rolün ana sayfasına yönlendirir;
 * diğer hatalar Türkçe mesaj ve "Yeniden dene" ile gösterilir. Kimlik hatası (401) oturum
 * katmanında girişe yönlendirilir.
 */
export function QueryError({ error, onRetry }: QueryErrorProps) {
  const { session } = useAuth()
  const moduleClosed = isModuleDisabledError(error)

  useEffect(() => {
    if (moduleClosed) return
    const detail = isApiError(error)
      ? { status: error.status, code: error.code, requestId: error.requestId }
      : error
    console.error('[sorgu] kayıtlar okunamadı', detail)
  }, [error, moduleClosed])

  if (moduleClosed && session)
    return <ModuleClosedRedirect to={pageHref(session.role, { path: 'dashboard' })} />

  return (
    <div className="query-error flex flex-col items-center gap-3 text-center">
      <Icon name="TriangleAlert" size={26} aria-hidden="true" className="text-danger" />
      <p className="max-w-[52ch] text-base">{queryErrorMessage(error)}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <Icon name="RefreshCw" size={15} aria-hidden="true" />
          Yeniden dene
        </Button>
      ) : null}
    </div>
  )
}
