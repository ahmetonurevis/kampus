import type { ReactNode } from 'react'

type Props = {
  id: string
  title: string
  description?: string
  actions?: ReactNode
  /** Tablo gibi kendi iç boşluğu olan içerik için ek boşluk eklenmez. */
  flush?: boolean
  children: ReactNode
}

/** Optik ve etüt sayfalarının bölüm yüzeyi: opak panel, başlık ve kısa açıklama. */
export function AssessmentPanel({ id, title, description, actions, flush, children }: Props) {
  return (
    <section
      aria-labelledby={id}
      className="panel mb-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-end justify-between gap-3 px-6 pt-6 pb-2 max-[650px]:px-4">
        <div className="min-w-0">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </header>
      {flush ? children : <div className="px-6 pt-2 pb-6 max-[650px]:px-4">{children}</div>}
    </section>
  )
}
