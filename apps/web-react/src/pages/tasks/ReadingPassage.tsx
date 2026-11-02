import { useId } from 'react'
import type { TaskAttemptPassage } from '@kampus/react-shared/use-task-attempts.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useScrollable } from '@/hooks/use-scrollable.ts'
import { cn } from '@/lib/utils'

type Props = { passage: TaskAttemptPassage; className?: string }

/**
 * Boş satırla ayrılmış paragraflar; tek satır sonları paragraf içinde korunur. Anahtar metindeki
 * başlangıç konumudur (metin denemede değişmez).
 */
const paragraphsOf = (body: string) =>
  [...body.matchAll(/\S[\s\S]*?(?=\n\s*\n|\s*$)/g)].map((match) => ({
    at: match.index,
    text: match[0],
  }))

/**
 * Okuma-anlama etkinliğinin metni (IST-042; DOM-BEC-006, DOM-KYN-002, DOM-KYN-024): başlık,
 * seviye, sistemin saydığı kelime sayısı, metin, kaynak gösterimi ve sözlükçe. İçerik yüzeyi
 * opaktır (cam yok). Geniş ekranda sorularla yan yana durup kendi içinde kayabilir; yalnız
 * gerçekten kaydığında klavyeyle odaklanır (dar ekranda sayfa kaydığı için Tab durağı eklenmez).
 * Sözlükçe `dl/dt/dd` ile ekran okuyucuya terim-anlam çifti olarak gelir. Başlık sırası: metin
 * başlığı `h2` (deneme başlığıyla kardeş), sözlükçe ve kaynak gösterimi `h3`.
 */
export function ReadingPassage({ passage, className }: Props) {
  const glossaryId = useId()
  const sourceId = useId()
  const { ref, scrollable } = useScrollable<HTMLElement>()
  return (
    <section
      ref={ref}
      aria-label={`Okuma metni: ${passage.title}`}
      // Kayan bölge klavyeyle odaklanmalı (WCAG 2.1.1); okları ve sayfa tuşlarını alır.
      tabIndex={scrollable ? 0 : undefined}
      className={cn(
        'panel rounded-card border bg-surface p-6 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-[650px]:p-4',
        className,
      )}
    >
      <header className="mb-4 grid gap-2">
        <h2 lang="en" className="text-lg font-semibold [overflow-wrap:anywhere]">
          {passage.title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {passage.cefrLevel ? (
            <StatusBadge text={`CEFR ${passage.cefrLevel}`} tone="purple" />
          ) : null}
          <StatusBadge text={`${passage.wordCount} kelime`} tone="gray" />
        </div>
      </header>

      <div lang="en" className="grid max-w-prose gap-3 text-base leading-relaxed">
        {paragraphsOf(passage.body).map((paragraph) => (
          <p key={paragraph.at} className="whitespace-pre-line [overflow-wrap:anywhere]">
            {paragraph.text}
          </p>
        ))}
      </div>

      {passage.glossary.length > 0 ? (
        <section aria-labelledby={glossaryId} className="mt-6 border-t pt-4">
          <h3 id={glossaryId} className="mb-3 text-sm font-semibold">
            Sözlükçe
          </h3>
          <dl className="grid gap-3 text-sm">
            {passage.glossary.map((entry) => (
              <div key={entry.term} className="grid gap-0.5">
                <dt lang="en" className="font-semibold [overflow-wrap:anywhere]">
                  {entry.term}
                </dt>
                <dd className="[overflow-wrap:anywhere]">{entry.meaning}</dd>
                {entry.example ? (
                  <dd className="text-muted-foreground [overflow-wrap:anywhere]">
                    Örnek:{' '}
                    <span lang="en" className="italic">
                      {entry.example}
                    </span>
                  </dd>
                ) : null}
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {passage.attributions.length > 0 ? (
        <section aria-labelledby={sourceId} className="mt-6 border-t pt-4">
          <h3 id={sourceId} className="mb-1 text-sm font-semibold">
            Kaynak gösterimi
          </h3>
          <ul className="grid gap-1 text-sm text-muted-foreground">
            {passage.attributions.map((item) => (
              <li key={`${item.work}:${item.author}:${item.source}`}>
                <span lang="en" className="font-medium text-foreground">
                  {item.work}
                </span>{' '}
                — {item.author}, {item.source}
                {item.year ? ` (${item.year})` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  )
}
