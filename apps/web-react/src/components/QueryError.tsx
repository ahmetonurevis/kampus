import { useEffect } from 'react'
import { isApiError } from '@kampus/api-client/errors.ts'
import { CollectionTooLargeError, isModuleDisabledError } from '@kampus/react-shared/collections.ts'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/auth/use-auth.ts'
import { pageHref } from '@/lib/navigation.ts'
import { queryErrorMessage } from './query-error-message.ts'
import { ModuleClosedRedirect } from '@/pages/shell/ModuleClosedRedirect.tsx'

export { NOT_FOUND_MESSAGE, queryErrorMessage } from './query-error-message.ts'

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
  // Liste sayfa sınırını aştıysa yeniden denemek aynı sonucu verir.
  const retry = error instanceof CollectionTooLargeError ? undefined : onRetry

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
      {retry ? (
        <Button variant="secondary" size="sm" onClick={retry}>
          <Icon name="RefreshCw" size={15} aria-hidden="true" />
          Yeniden dene
        </Button>
      ) : null}
    </div>
  )
}
