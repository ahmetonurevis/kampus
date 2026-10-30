import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { SENSITIVE_INFO_NOTICE, useSendMessage } from '@kampus/react-shared/use-communication.ts'
import { sendMessageSchema } from '@kampus/school-core/lib/communication.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type FormInput = z.input<typeof sendMessageSchema>
type FormOutput = z.output<typeof sendMessageSchema>

/**
 * Mesaj yazma alanı. Başarıdan sonra akış sunucudan yeniden okunur (iyimser güncelleme yok;
 * mesaj sunucu saatiyle ve okundu durumuyla gelir). Ctrl/Cmd+Enter gönderir. DOM-ILT-014:
 * özel nitelikli bilgi mesajla paylaşılmaz; sabit not alanın üstündedir.
 */
export function MessageComposer({ conversationId }: { conversationId: string }) {
  const send = useSendMessage()
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(sendMessageSchema),
    defaultValues: { text: '' },
  })
  const busy = send.isPending || form.formState.isSubmitting
  const { onChange, onBlur, name, ref } = form.register('text')

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await send.submit(
      { conversationId, text: values.text },
      { setError: form.setError },
    )
    if (outcome.status === 'success') form.reset({ text: '' })
  })

  return (
    <form
      noValidate
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-2 border-t bg-surface p-3"
    >
      <p
        role="note"
        className="flex items-start gap-2 rounded-card bg-surface-soft px-3 py-2 text-xs text-muted-foreground"
      >
        <Icon name="ShieldCheck" size={14} className="mt-0.5 shrink-0" />
        <span>{SENSITIVE_INFO_NOTICE}</span>
      </p>
      <FormField id="mesaj-metni" label="Mesajınız" error={form.formState.errors.text}>
        {(control) => (
          <Textarea
            {...control}
            name={name}
            ref={ref}
            onBlur={onBlur}
            onChange={onChange}
            rows={3}
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void onSubmit()
              }
            }}
          />
        )}
      </FormField>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Ctrl/Cmd + Enter ile gönderin.</span>
        <Button type="submit" disabled={busy} aria-busy={busy}>
          <Icon name="Send" size={16} />
          Gönder
        </Button>
      </div>
    </form>
  )
}
