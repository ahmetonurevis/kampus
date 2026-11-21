import { useState } from 'react'
import type { TransportRouteRow } from '@kampus/react-shared/use-finance-transport.ts'
import { useTransportRoster } from '@kampus/react-shared/use-finance-transport-roster.ts'
import {
  canUseTransportRosterPurpose,
  TRANSPORT_ROSTER_PURPOSE_LABELS,
  TRANSPORT_ROSTER_PURPOSES,
  type TransportRosterPurpose,
} from '@kampus/school-core/lib/finance-transport-roster.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { FieldLegend, FieldSet } from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'

// Servis listesi indirme (DOM-FIN-148; ON-148; IST-028; K-500): güzergâh satırındaki "Listeyi indir"
// amaç seçimiyle açılır. Tam telefonlu "sürücüye verilecek liste" yalnız yetkili rolde görünür;
// liste taze oturum ister, PDF tarayıcıda üretilir ve dar ekranda da dosya olarak iner.

const PURPOSE_HINTS = {
  office: 'Okulda kalan liste. Veli telefonları maskeli yazılır.',
  driver:
    'Sürücüye ve rehber personele verilir. Veli telefonları tam yazılır; indirme denetim kaydına düşer.',
} as const satisfies Record<TransportRosterPurpose, string>

export function FinanceTransportRosterButton({ route }: { route: TransportRouteRow }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        className="min-h-11"
        variant="ghost"
        aria-label={`${route.name} servis listesini indir`}
        onClick={() => setOpen(true)}
      >
        <Icon name="Download" size={17} aria-hidden="true" />
        Listeyi indir
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Servis listesini indir">
        {open ? <RosterForm route={route} onDone={() => setOpen(false)} /> : null}
      </Modal>
    </>
  )
}

function RosterForm({ route, onDone }: { route: TransportRouteRow; onDone: () => void }) {
  const { session } = useAuth()
  const learner = useEnrollmentLearner()
  const roster = useTransportRoster()
  const { run, reauthModal } = useReauthRetry()
  const [purpose, setPurpose] = useState<TransportRosterPurpose>('office')
  const [printing, setPrinting] = useState(false)
  const role = session?.role ?? ''
  const purposes = TRANSPORT_ROSTER_PURPOSES.filter((item) =>
    canUseTransportRosterPurpose(role, item),
  )
  const busy = printing || roster.isPending

  async function download() {
    setPrinting(true)
    try {
      const outcome = await run(() => roster.submit({ routeId: route.id, purpose }))
      if (outcome.status !== 'done' || outcome.result.status !== 'success') return
      const data = outcome.result.data.data
      const [{ renderPdf }, template] = await Promise.all([
        import('@/lib/pdf/render.ts'),
        import('@/lib/pdf/templates/finance-transport-roster.ts'),
      ])
      const { blob } = await renderPdf((measurer) =>
        template.transportRosterDocument(measurer, data, {
          institution: session?.institution.name ?? 'Kampüs',
          generatedAt: new Date(),
          learnerTitle: learner.title,
        }),
      )
      saveBlob(blob, template.transportRosterFilename(data))
      notify.success('Servis listesi PDF olarak indirildi.')
      onDone()
    } catch (error) {
      console.error('[kampus]', 'pdf', error)
      notify.error('Servis listesi PDF’i hazırlanamadı. Lütfen tekrar deneyin.')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void download()
        }}
      >
        <p className="text-sm text-muted-foreground">
          {route.name} güzergâhının öğrenci, durak ve acil iletişim listesi. Sağlık ve alerji
          bilgisi listede yer almaz.
        </p>
        <FieldSet className="gap-2">
          <FieldLegend variant="label" className="text-sm font-medium">
            Liste amacı
          </FieldLegend>
          <RadioGroup
            name="servis-listesi-amac"
            value={purpose}
            onValueChange={(value) =>
              setPurpose(value === 'driver' && purposes.includes('driver') ? 'driver' : 'office')
            }
            disabled={busy}
            className="gap-1"
          >
            {purposes.map((item) => (
              <label
                key={item}
                htmlFor={`servis-listesi-${item}`}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-field px-1 py-2 text-sm"
              >
                <RadioGroupItem id={`servis-listesi-${item}`} value={item} className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span className="font-medium">{TRANSPORT_ROSTER_PURPOSE_LABELS[item]}</span>
                  <span className="text-muted-foreground">{PURPOSE_HINTS[item]}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </FieldSet>
        {purposes.includes('driver') ? null : (
          <p className="text-sm text-muted-foreground">
            Tam telefonlu sürücü listesini yalnız yönetici indirebilir.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" className="min-h-11" onClick={onDone}>
            Vazgeç
          </Button>
          <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
            <Icon name="Printer" size={17} aria-hidden="true" />
            PDF indir
          </Button>
        </div>
      </form>
      {/* Parola penceresi formun dışında: iç formun gönderimi bu forma kabarmasın. */}
      {reauthModal}
    </>
  )
}
