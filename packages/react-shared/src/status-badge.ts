/**
 * Rozet tonu ve metni: web `StatusBadge` ve mobil `ToneBadge` aynı değeri çizer. Saf modül arayüz
 * dosyasına bağlanmaz (testler JSX'siz derlenir).
 */
export type BadgeTone = 'primary' | 'green' | 'amber' | 'red'

export type StatusBadge = { text: string; tone: BadgeTone }

/** Yanıt bekleme rozetinin tonları; web `StatusBadge` bu iki tonu da tanır, `primary` yoktur. */
export type AlertBadge = { text: string; tone: Extract<BadgeTone, 'amber' | 'red'> }
