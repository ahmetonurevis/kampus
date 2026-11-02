import {
  useActivateAcademicYear,
  useCloseAcademicYear,
  useRemoveAcademicTerm,
} from '@kampus/react-shared/use-academic-years.ts'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify.ts'
import {
  ACTIVATION_NEEDS_TERMS_NOTICE,
  activationDescription,
  closeDescription,
  earlyActivationNotice,
  type ActivationPlan,
  type TermRow,
  type YearRow,
} from './academic-year-rows.ts'

/** Uyarı satırı: geri alınamaz işlemin sonucunu ve engeli açıkça yazar. */
function Notice({ children }: { children: string }) {
  return (
    <p role="note" className="flex gap-2 rounded-card border bg-warning-soft p-3 text-sm">
      <Icon name="TriangleAlert" size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/**
 * Etkinleştirme onayı (DOM-YTK-065): kurumda tek etkin yıl bulunur, önceki etkin yıl aynı
 * işlemde kapanır ve bu geri alınamaz; pencere hangi yılın kapanacağını adıyla yazar. 60 günden
 * erken etkinleştirme sunucuda reddedilir (422); pencere bunu önceden bildirir ama kararı
 * sunucuya bırakır. Başarısızlıkta pencere açık kalır (Türkçe mesaj toast'ta).
 */
export function ActivateYearDialog({
  plan,
  onClose,
}: {
  plan: ActivationPlan | null
  onClose: () => void
}) {
  const activate = useActivateAcademicYear()
  const target = plan?.target
  async function confirm() {
    if (!plan || plan.target.version === null) return
    const outcome = await activate.submit({
      startYear: plan.target.startYear,
      version: plan.target.version,
    })
    if (outcome.status === 'success') {
      notify.success(
        plan.closing
          ? `${plan.target.name} eğitim yılı etkinleştirildi; ${plan.closing.name} kapandı.`
          : `${plan.target.name} eğitim yılı etkinleştirildi.`,
      )
      onClose()
    }
  }
  return (
    <Modal
      open={plan !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={target ? `${target.name} eğitim yılını etkinleştir` : 'Eğitim yılını etkinleştir'}
      description={plan ? activationDescription(plan) : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={activate.isPending}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirm()}
            disabled={activate.isPending || plan?.needsTerms === true}
            aria-busy={activate.isPending || undefined}
          >
            Etkinleştir
          </Button>
        </>
      }
    >
      {plan ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Kurumun güncel yılı bu yıla geçer: yenileme, rıza süresi ve tarife varsayılanı yeni yılı
            kullanır.
          </p>
          {plan.needsTerms ? <Notice>{ACTIVATION_NEEDS_TERMS_NOTICE}</Notice> : null}
          {plan.tooEarly ? <Notice>{earlyActivationNotice(plan)}</Notice> : null}
        </div>
      ) : null}
    </Modal>
  )
}

/** Kapatma onayı (DOM-YTK-066): kapanan yıl değişmez ve yeniden açılmaz. */
export function CloseYearDialog({ row, onClose }: { row: YearRow | null; onClose: () => void }) {
  const close = useCloseAcademicYear()
  async function confirm() {
    if (!row || row.version === null) return
    const outcome = await close.submit({ startYear: row.startYear, version: row.version })
    if (outcome.status === 'success') {
      notify.success(`${row.name} eğitim yılı kapatıldı.`)
      onClose()
    }
  }
  return (
    <Modal
      open={row !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={row ? `${row.name} eğitim yılını kapat` : 'Eğitim yılını kapat'}
      description={row ? closeDescription(row) : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={close.isPending}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirm()}
            disabled={close.isPending}
            aria-busy={close.isPending || undefined}
          >
            Yılı kapat
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Kapanan yıl listede salt okunur kalır; geçmiş kayıtlar (not, yoklama, finans) değişmez.
      </p>
    </Modal>
  )
}

export type TermRemoval = { year: YearRow; term: TermRow }

/** Dönem kaldırma onayı (DOM-YTK-064): dönem arşive gider, yılın tarihleri değişmez. */
export function RemoveTermDialog({
  removal,
  onClose,
}: {
  removal: TermRemoval | null
  onClose: () => void
}) {
  const remove = useRemoveAcademicTerm()
  async function confirm() {
    if (!removal || removal.year.version === null) return
    const outcome = await remove.submit({
      startYear: removal.year.startYear,
      termId: removal.term.id,
      version: removal.year.version,
    })
    if (outcome.status === 'success') {
      notify.success(`Dönem kaldırıldı: ${removal.term.name}.`)
      onClose()
    }
  }
  const pending = remove.isPending
  return (
    <Modal
      open={removal !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={removal ? `Dönemi kaldır: ${removal.term.name}` : 'Dönemi kaldır'}
      description="Dönem eğitim yılından kaldırılır; yılın tarihleri değişmez."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirm()}
            disabled={pending}
            aria-busy={pending || undefined}
          >
            Dönemi kaldır
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        {removal
          ? `${removal.year.name} · ${removal.term.rangeLabel}. Okulda etkin yılın son dönemi kaldırılamaz.`
          : ''}
      </p>
    </Modal>
  )
}
