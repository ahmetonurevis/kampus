// Açılış nöbeti ekranının saf yardımcıları (DOM-FIN-061, ON-095): etiketler, pencere seçenekleri
// ve mevcut listelere giden bağlantılar. Sayılar sunucudan gelir; burada değer türetilip saklanmaz.
import type { LearnerWords } from '@kampus/school-core/lib/enrollment-learner.ts'
import type { OpeningChangeKind } from '@kampus/school-core/lib/finance-opening-watch.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'

/** Finans sayfası içindeki görünüm parametresi ve değeri (`FinancePage` `VIEWS`). */
export const OPENING_WATCH_VIEW = 'acilis'

/** Yenileme kaydından gelen olaylar; yenileme modülü kapalıyken gösterilmez. */
export const RENEWAL_CHANGE_KINDS: readonly OpeningChangeKind[] = [
  'renewed',
  'promoted',
  'graduated',
]

export function changeKindLabel(kind: OpeningChangeKind): string {
  switch (kind) {
    case 'enrolled':
      return 'Kesin kayıt'
    case 'renewed':
      return 'Yenileme planı'
    case 'promoted':
      return 'Dönem geçişi'
    case 'graduated':
      return 'Mezuniyet'
    case 'withdrawn':
      return 'Ayrılış'
    default:
      return kind satisfies never
  }
}

/** Sınıf sütununun adı: okulda sınıf, dil okulu ve kursta grup. */
export const classColumnLabel = (type: InstitutionType | undefined) =>
  type === undefined || type === 'school' ? 'Sınıf' : 'Grup'

export interface WindowOption {
  /** Seçim değeri: `yil` ya da `donem:<id>`. */
  value: string
  label: string
}

export const YEAR_WINDOW = 'yil'
const TERM_PREFIX = 'donem:'

/** Pencere seçenekleri: yıl açılışı ve yılın dönemleri (dil okulunda dönem/kur açılışı). */
export function windowOptions(terms: readonly { id: string; name: string }[]): WindowOption[] {
  return [
    { value: YEAR_WINDOW, label: 'Eğitim yılı açılışı' },
    ...terms.map((term) => ({ value: `${TERM_PREFIX}${term.id}`, label: `Dönem: ${term.name}` })),
  ]
}

/** Seçim değerinden dönem kimliği; yıl penceresinde `undefined`. */
export function termIdOf(value: string): string | undefined {
  return value.startsWith(TERM_PREFIX) ? value.slice(TERM_PREFIX.length) : undefined
}

/** Seçilebilecek eğitim yılları: etkin yılın bir öncesi ve sonrası, adresle gelen yıl da. */
export function yearOptions(current: number, selected: number): number[] {
  return [...new Set([current - 1, current, current + 1, selected])].sort((a, b) => a - b)
}

/** "2026–2027" */
export const yearLabel = (year: number) => `${String(year)}–${String(year + 1)}`

/** Finans sayfasının başka görünümüne giden adres (aynı sayfa, yalnız arama parametreleri). */
export function financeViewSearch(view: string, params: Readonly<Record<string, string>> = {}) {
  const search = new URLSearchParams()
  if (view !== '') search.set('gorunum', view)
  for (const [key, value] of Object.entries(params)) search.set(key, value)
  const text = search.toString()
  return text === '' ? '?' : `?${text}`
}

/** Ayrılış satırının "yenilemeden" notu; dil okulunda da aynı söz. */
export function withdrawnNote(withoutRenewal: boolean): string | null {
  return withoutRenewal ? 'Yenilemeden ayrıldı' : null
}

/** Bölümün boş metni: okulda "öğrenci", dil okulunda "kursiyer". */
export const emptyText = (learner: LearnerWords, what: string) =>
  `Bu açılışta ${what} ${learner.noun} yok.`
