import { Link } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'

/** 404: kabuk içinde (bilinmeyen rol sayfası) ve dışında (`*`) aynı içerik. */
export function NotFoundContent() {
  useDocumentTitle('Sayfa bulunamadı')
  return (
    <div className="empty-page flex flex-col items-start gap-3 rounded-card border bg-surface p-8">
      <span className="text-xs font-semibold tracking-[1.5px] text-brand-ink">404</span>
      <h1 className="text-3xl font-semibold tracking-[-0.8px]">Bu sayfa kampüste bulunamadı.</h1>
      <p className="text-base text-muted-foreground">
        Bağlantı değişmiş olabilir. Ana sayfadan devam edebilirsiniz.
      </p>
      <Link to="/" className={buttonVariants()}>
        Ana sayfaya dön
      </Link>
    </div>
  )
}

export function NotFoundPage() {
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-[720px] place-items-center p-6">
      <NotFoundContent />
    </main>
  )
}
