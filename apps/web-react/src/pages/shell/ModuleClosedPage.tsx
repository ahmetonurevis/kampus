import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'

/**
 * Kapalı iş akışı modülünün doğrudan adresi (Vue `SchoolWorkflows.vue`): kabuk içinde kalır,
 * veri istenmez. Modül kurum ayarından ya da kurum türünden (dil okulunda hedef planı) kapalıdır.
 */
export function ModuleClosedPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  return (
    <section
      aria-labelledby="modul-kapali"
      className="panel rounded-card border bg-surface px-6 py-8 max-[650px]:px-4"
    >
      <h2 id="modul-kapali" className="text-lg font-semibold">
        Modül kullanıma kapalı
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Yönetici modül ayarlarını değiştirebilir.
      </p>
    </section>
  )
}
