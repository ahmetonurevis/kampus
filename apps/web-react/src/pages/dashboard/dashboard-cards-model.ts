// Genel Bakış kart yuvasının saf mantığı: kart kaydı tipi, rol/modül süzmesi ve yerleşim. React
// çizimi `DashboardCardGrid.tsx`, kart listesi `dashboard-cards.tsx`'tedir; burada çizim yoktur
// ki birim testi doğrudan koşsun.
import type { ComponentType } from 'react'
import type { Dashboard, DashboardOf, DashboardRole } from '@kampus/react-shared/dashboard.ts'
import type { Session } from '@/auth/auth-port.ts'
import type { CardState } from './DashboardParts.tsx'
import { sectionVisible } from './dashboard-model.ts'

/**
 * Kartın yeri: `stat` sayaç ızgarasında; `main` 2:1 ızgaranın geniş (sol), `side` dar (sağ)
 * sütununda. Dar ekranda ızgara tek sütundur ve kartlar sırayla alt alta iner.
 */
export type DashboardCardArea = 'stat' | 'main' | 'side'

/** Süzmenin okuduğu görünüm: rol, oturumdaki modül bayrakları ve (geldiyse) özet yanıtı. */
export type CardView<D = Dashboard> = {
  role: DashboardRole
  modules: Readonly<Record<string, boolean>>
  /** Özet yanıtı; gelene kadar `null` (iskelet oturumdaki modül bayraklarıyla çizilir). */
  data: D | null
}

/** Kart bileşenine verilen bağlam: her kart kendi bölümünü `data`'dan okur. */
export type DashboardCardContext<D = Dashboard> = CardView<D> & {
  session: Session
  /** Sorgu durumu (yükleniyor/hata/yeniden dene); kart iskeletini ve hatasını kendisi çizer. */
  state: CardState
  /** Sayfa açıldığı an: "bugün" ve son teslim karşılaştırmaları aynı ana dayanır. */
  now: Date
}

export interface DashboardCard {
  /** Kalıcı kimlik (`<grup>.<ad>`); kayıtta tekildir. */
  id: string
  /** Kartı gören roller. */
  roles: readonly DashboardRole[]
  /** Kartın bağlı olduğu modül; kapalıysa kart çizilmez (menü ve API kapanışıyla aynı kural). */
  module?: string
  /**
   * `module` ile birlikte: kartın okuduğu özet bölümü. Yanıt geldiyse sunucunun kararı geçerlidir
   * (kapalı modülün bölümü `null`); gelmediyse oturumdaki modül bayrağı.
   */
  section?: (data: Dashboard) => unknown
  /** Modül dışında ek koşul (ör. başka bir kartın bölümüne bağlı kart). */
  when?: (view: CardView) => boolean
  area: DashboardCardArea
  /** Rol içinde artan sıra; eşitlikte kayıt sırası korunur. */
  order: number
  component: ComponentType<{ ctx: DashboardCardContext }>
}

/** `defineCard` girdisi: bileşen ve bölüm seçicisi rollerin özet tipiyle yazılır. */
export type DashboardCardInput<R extends DashboardRole> = Omit<
  DashboardCard,
  'roles' | 'section' | 'when' | 'component'
> & {
  roles: readonly R[]
  section?: (data: DashboardOf<R>) => unknown
  when?: (view: CardView<DashboardOf<R>>) => boolean
  component: ComponentType<{ ctx: DashboardCardContext<DashboardOf<R>> }>
}

/**
 * Tipli kart tanımı. Süzme bileşeni ve seçiciyi yalnız `roles` içindeki bir rolün özetiyle
 * çağırır (sayfa yanıtın rolünü zaten doğrular), bu yüzden tip burada tek yerde daraltılır.
 */
export function defineCard<R extends DashboardRole>(card: DashboardCardInput<R>): DashboardCard {
  return card as unknown as DashboardCard
}

/** Birden çok kaynağın (Oğuzhan, Onur) kartlarını birleştirir; yinelenen kimlik hatadır. */
export function buildDashboardCards(
  ...sources: readonly (readonly DashboardCard[])[]
): readonly DashboardCard[] {
  const cards = sources.flat()
  const seen = new Set<string>()
  for (const card of cards) {
    if (seen.has(card.id)) throw new Error(`Pano kartı kimliği yinelendi: ${card.id}`)
    seen.add(card.id)
  }
  return cards
}

/** Kartın bu görünümde çizilip çizilmeyeceği: rol, modül ve ek koşul tek yerde. */
export function isCardVisible(card: DashboardCard, view: CardView): boolean {
  if (!card.roles.includes(view.role)) return false
  if (card.module !== undefined) {
    const flag = view.modules[card.module] === true
    const section = card.section && view.data ? card.section(view.data) : undefined
    const visible = card.section ? sectionVisible(section, view.data !== null, flag) : flag
    if (!visible) return false
  }
  return card.when ? card.when(view) : true
}

/** Görünümde çizilecek kartlar, `order` sırasıyla. */
export function visibleCards(
  cards: readonly DashboardCard[],
  view: CardView,
): readonly DashboardCard[] {
  return cards.filter((card) => isCardVisible(card, view)).toSorted((a, b) => a.order - b.order)
}

export type DashboardLayout = {
  /** Sayaç kartları. */
  stats: readonly DashboardCard[]
  /** 2:1 ızgara satırları; her satır bir ya da iki kart, ana kart önce. */
  rows: readonly (readonly DashboardCard[])[]
}

/**
 * Sıralı kartları satırlara böler: `main` kart yeni satır açar; ondan sonra gelen ilk `side` kart
 * aynı satıra girer. Açık satırı olmayan (ya da yan kartı dolu) `side` kart tek başına satır
 * açar ve ilk sütunda durur; bir kartın gizlenmesi komşu satırları kaydırmaz.
 */
export function layoutCards(ordered: readonly DashboardCard[]): DashboardLayout {
  const stats: DashboardCard[] = []
  const rows: DashboardCard[][] = []
  let open: DashboardCard[] | null = null
  for (const card of ordered) {
    if (card.area === 'stat') {
      stats.push(card)
    } else if (card.area === 'main') {
      open = [card]
      rows.push(open)
    } else if (open && open.length === 1 && open[0]?.area === 'main') {
      open.push(card)
      open = null
    } else {
      open = null
      rows.push([card])
    }
  }
  return { stats, rows }
}
