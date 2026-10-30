import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  ACCESS_MINUTES,
  ACCESS_REASON_MIN_LENGTH,
  useOpenConversationAccess,
} from '@kampus/react-shared/use-communication.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { remainingLabel } from './conversation-model.ts'

const REASON_MAX_LENGTH = 500

// Sunucu kuralıyla (core `accessDecision`) aynı alt sınır; kısa gerekçe istek atılmadan alanda
// açıklanır. Sunucu yine de doğrular.
const accessReasonSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(ACCESS_REASON_MIN_LENGTH, `Gerekçe en az ${ACCESS_REASON_MIN_LENGTH} karakter olmalıdır.`)
    .max(REASON_MAX_LENGTH, `En fazla ${REASON_MAX_LENGTH} karakter girebilirsiniz.`),
})
type ReasonInput = z.input<typeof accessReasonSchema>
type ReasonOutput = z.output<typeof accessReasonSchema>

type GateProps = {
  conversationId: string
  /** Veli yazışmasında erişim açılamaz; düğme gösterilmez. */
  canOpen: boolean
  onOpened: (expiresAt: string) => void
}

/**
 * Yöneticinin kilit ekranı (DOM-YTK-052): yazışmanın içeriği kapalıdır; gerekçe verilince
 * 30 dakika açılır ve denetim kaydına yazılır. Veli yazışmasında yalnız açıklama
 * vardır, düğme yoktur.
 */
export function AccessGate({ conversationId, canOpen, onOpened }: GateProps) {
  const [dialog, setDialog] = useState(false)
  return (
    <div className="grid flex-1 place-content-center justify-items-center gap-3 p-8 text-center">
      <span className="grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
        <Icon name="Lock" size={22} />
      </span>
      <h2 className="text-lg font-semibold">Yazışmanın içeriği kapalı</h2>
      <p className="max-w-[48ch] text-sm text-muted-foreground">
        {canOpen
          ? `Yönetici olarak yazışmayı yalnız gerekçe vererek ${ACCESS_MINUTES} dakikalığına açabilirsiniz. Erişim denetim kaydına yazılır.`
          : 'Veli yazışmaları yönetici erişimine kapalıdır; yalnız üst veri görünür.'}
      </p>
      {canOpen ? (
        <Button type="button" onClick={() => setDialog(true)}>
          Gerekçeyle aç
        </Button>
      ) : null}
      {canOpen ? (
        <Modal
          open={dialog}
          onOpenChange={setDialog}
          title="Yazışmayı gerekçeyle aç"
          description={`Gerekçe denetim kaydına yazılır. Erişim ${ACCESS_MINUTES} dakika sürer.`}
        >
          {dialog ? (
            <ReasonForm
              conversationId={conversationId}
              onCancel={() => setDialog(false)}
              onOpened={(expiresAt) => {
                setDialog(false)
                onOpened(expiresAt)
              }}
            />
          ) : null}
        </Modal>
      ) : null}
    </div>
  )
}

function ReasonForm({
  conversationId,
  onCancel,
  onOpened,
}: {
  conversationId: string
  onCancel: () => void
  onOpened: (expiresAt: string) => void
}) {
  const access = useOpenConversationAccess({ onSuccess: (data) => onOpened(data.expiresAt) })
  const form = useForm<ReasonInput, unknown, ReasonOutput>({
    resolver: zodResolver(accessReasonSchema),
    defaultValues: { reason: '' },
  })
  const busy = access.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    await access.submit({ conversationId, reason: values.reason }, { setError: form.setError })
  })
  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
      <FormField
        id="erisim-gerekcesi"
        label="Erişim gerekçesi"
        description="Örneğin şikâyet veya inceleme numarası ve nedeni."
        error={form.formState.errors.reason}
      >
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={4} disabled={busy} />
        )}
      </FormField>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Vazgeç
        </Button>
        <Button type="submit" disabled={busy} aria-busy={busy}>
          Erişimi aç
        </Button>
      </div>
    </form>
  )
}

/** Açık erişimin şeridi: kalan süre canlı sayılır (`role="timer"`), bitince üst bileşen kilitler. */
export function AccessBanner({ remainingMs }: { remainingMs: number }) {
  return (
    <p
      role="timer"
      aria-label="Gerekçeli erişimin kalan süresi"
      className="flex items-center gap-2 border-b bg-warning-soft px-4 py-2 text-xs text-warning"
    >
      <Icon name="LockOpen" size={14} />
      Gerekçeli erişim açık. Kalan süre:{' '}
      <strong className="tabular-nums">{remainingLabel(remainingMs)}</strong>
    </p>
  )
}
