import { money } from '@kampus/school-core/lib/format.ts'
import type { RenewalQuote } from '@kampus/school-core/lib/school-workflows.ts'

/**
 * Yeni dönem ödeme özeti (Vue `quote` bölümü): tutarlar core `renewalQuote` sonucudur (kuruş);
 * burada yalnız biçimlenir. Yenileme ve sınıf geçişi ayrı işlemlerdir; özet yalnız yenilemeyi anlatır.
 */
export function RenewalSummary({ quote }: { quote: RenewalQuote }) {
  return (
    <section aria-labelledby="yenileme-ozeti" className="grid gap-1.5 rounded-md border p-3">
      <h3 id="yenileme-ozeti" className="text-sm font-semibold">
        Yeni dönem ödeme özeti
      </h3>
      <p className="text-sm text-muted-foreground">
        Brüt {money(quote.gross)} · Burs {money(quote.scholarshipAmount)} · Ek indirim{' '}
        {money(quote.discountAmount)}
      </p>
      <p className="text-sm font-semibold">Net eğitim bedeli: {money(quote.amount)}</p>
      <p className="text-sm text-muted-foreground">
        {quote.installments.length} taksit · Toplam {money(quote.amount)}
      </p>
    </section>
  )
}
