import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useTheme } from '@/hooks/use-theme.ts'
import type { NavPage } from '@/lib/navigation.ts'

/**
 * Öğrenci ve veli Ayarlar sayfası: görünüm (tema) tercihi cihazda saklanır. Bildirim
 * tercihleri için sunucuda depo yoktur; sahte anahtar gösterilmez, durum açıkça yazılır.
 * TODO(bildirim-tercihleri): bildirim merkezi ve tercih ucu gelince kanal/konu seçimi eklenir.
 */
export function PersonalSettingsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { theme, setTheme } = useTheme()
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <div className="grid gap-6">
        <section
          aria-labelledby="gorunum-baslik"
          className="panel rounded-card border bg-surface p-6"
        >
          <h2 id="gorunum-baslik" className="text-lg font-semibold">
            Görünüm
          </h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">Tercihiniz bu cihazda saklanır.</p>
          <div role="group" aria-label="Tema" className="flex flex-wrap gap-2">
            <Button
              variant={theme === 'light' ? 'default' : 'secondary'}
              aria-pressed={theme === 'light'}
              onClick={() => setTheme('light')}
            >
              <Icon name="Sun" size={17} aria-hidden="true" />
              Açık
            </Button>
            <Button
              variant={theme === 'dark' ? 'default' : 'secondary'}
              aria-pressed={theme === 'dark'}
              onClick={() => setTheme('dark')}
            >
              <Icon name="Moon" size={17} aria-hidden="true" />
              Koyu
            </Button>
          </div>
        </section>
        <section
          aria-labelledby="bildirim-baslik"
          className="panel rounded-card border bg-surface p-6"
        >
          <h2 id="bildirim-baslik" className="text-lg font-semibold">
            Bildirimler
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bildirim tercihleri bildirim merkeziyle gelecek; şimdilik kanal ve konu seçimi
            saklanmıyor.
          </p>
        </section>
      </div>
    </>
  )
}
