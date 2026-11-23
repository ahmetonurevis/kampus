import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon } from '@/components/Icon.tsx'

/** Giriş dışındaki oturumsuz sayfaların (parola unutma/sıfırlama) sade, ortalanmış düzeni. */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-10 max-[650px]:p-5">
      <main id="main" className="flex w-full max-w-[430px] flex-col gap-7">
        <Link
          to="/giris"
          className="inline-flex min-h-6 items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
        >
          <Icon name="ArrowLeft" size={16} />
          Girişe dön
        </Link>
        <div className="flex flex-col gap-3">
          <h1 className="text-[28px] font-semibold tracking-[-0.8px]">{title}</h1>
          <p className="text-base text-muted-foreground">{description}</p>
        </div>
        {children}
      </main>
    </div>
  )
}
