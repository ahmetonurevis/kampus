import { useEffect } from 'react'
import { useRouteError } from 'react-router'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'

/** Rota hata sınırı: kullanıcıya Türkçe ve teknik ayrıntısız mesaj, ayrıntı loga. */
export function RouteErrorPage() {
  const error = useRouteError()
  useDocumentTitle('Bir sorun oluştu')
  useEffect(() => {
    console.error('[route] beklenmeyen hata', error)
  }, [error])
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-[720px] place-items-center p-6">
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-card border bg-surface p-8"
      >
        <h1 className="text-3xl font-semibold tracking-[-0.8px]">Bu sayfa şu an açılamadı.</h1>
        <p className="text-base text-muted-foreground">
          Beklenmeyen bir sorun oluştu. Sayfayı yeniden deneyebilir veya ana sayfaya dönebilirsiniz.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => window.location.reload()}>Yeniden dene</Button>
          <Button variant="secondary" onClick={() => window.location.assign('/')}>
            Ana sayfaya dön
          </Button>
        </div>
      </div>
    </main>
  )
}
