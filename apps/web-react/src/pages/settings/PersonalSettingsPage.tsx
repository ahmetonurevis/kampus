import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useTheme } from '@/hooks/use-theme.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ChildNoticeSection } from './ChildNoticeSection.tsx'
import { ConsentsSection } from './ConsentsSection.tsx'
import { NotificationPreferencesSection } from './NotificationPreferencesSection.tsx'

/**
 * Öğrenci ve veli Ayarlar sayfası: görünüm (tema) tercihi cihazda saklanır; bildirim tercihleri
 * ve sessiz saatler sunucuda hesaba kaydedilir (OG-107, `NotificationPreferencesSection`).
 */
export function PersonalSettingsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { theme, setTheme } = useTheme()
  const { session } = useAuth()
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
        {session ? <NotificationPreferencesSection session={session} /> : null}
        {session?.role === 'ogrenci' ? <ChildNoticeSection session={session} /> : null}
        {session ? <ConsentsSection session={session} /> : null}
      </div>
    </>
  )
}
