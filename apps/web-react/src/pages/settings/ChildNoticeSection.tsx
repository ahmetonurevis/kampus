import { useCurrentPrivacyNotice } from '@kampus/react-shared/use-privacy-notice.ts'
import {
  CHILD_NOTICE_TITLE,
  childNoticeSections,
} from '@kampus/school-core/lib/child-privacy-notice.ts'
import { Icon } from '@/components/Icon.tsx'
import type { Session } from '@/auth/auth-port.ts'

/**
 * "Bilgilerim nasıl kullanılıyor?" (IST-018): öğrenciye sade dilli, simgeli aydınlatma. Kurumun
 * öğrenci kitlesi için yayımladığı metin varsa o gösterilir; yoksa (ya da okunamazsa) çocuğa uygun
 * şablon gösterilir. Gösterim kaydı açılmaz; sürümlü gösterim kaydı ayrı bir akıştır.
 */
export function ChildNoticeSection({ session }: { session: Session }) {
  const current = useCurrentPrivacyNotice()
  const published = current.data?.data.notice ?? null
  const sections = childNoticeSections(session.institution.name)
  return (
    <section aria-labelledby="bilgi-baslik" className="panel rounded-card border bg-surface p-6">
      <h2 id="bilgi-baslik" className="text-lg font-semibold">
        Bilgilerim nasıl kullanılıyor?
      </h2>
      {published ? (
        <>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">
            {published.title} · Sürüm {published.version}
          </p>
          <div className="text-sm leading-relaxed whitespace-pre-line">{published.body}</div>
        </>
      ) : (
        <>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">{CHILD_NOTICE_TITLE}</p>
          <ul className="grid gap-4 sm:grid-cols-2">
            {sections.map((section) => (
              <li key={section.topic} className="flex gap-3 rounded-xl border bg-surface-soft p-4">
                <Icon
                  name={section.icon}
                  size={24}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0"
                />
                <div>
                  <h3 className="text-base font-semibold">{section.heading}</h3>
                  <ul className="mt-1 grid gap-1 text-sm">
                    {section.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
