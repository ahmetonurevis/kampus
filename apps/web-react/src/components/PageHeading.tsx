import type { ReactNode } from 'react'

type PageHeadingProps = {
  title: string
  description?: string
  /** Sayfanın ana ve ikincil işlemleri. */
  actions?: ReactNode
}

/** Sayfa başlığı: h1, kısa açıklama ve sağda işlemler (Vue `PageHeading.vue`). */
export function PageHeading({ title, description, actions }: PageHeadingProps) {
  return (
    <div className="page-heading mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-[-0.8px] max-[650px]:text-2xl">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-[70ch] text-base text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="heading-actions flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}
