import { useMemo } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import {
  SENSITIVE_INFO_NOTICE,
  useParentAccounts,
  useStartConversation,
} from '@kampus/react-shared/use-communication.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import {
  COUNTERPART_STUDENT,
  newConversationBody,
  newConversationSchema,
  parentCounterpart,
  type NewConversationValues,
} from '@kampus/react-shared/conversation-model.ts'

const FORM_ID = 'yeni-yazisma-formu'
const NONE: readonly never[] = []

type Props = {
  open: boolean
  onClose: () => void
  /** Yazışma açıldı (ya da zaten vardı); kimliği ile akış seçilir. */
  onStarted: (conversationId: string) => void
}

/**
 * Yeni yazışma (sağ panel). Öğretmen: öğrenci, sonra muhatap (öğrenci ya da o öğrencinin bir veli
 * hesabı). Öğrenci ve veli: öğretmen (veli için ayrıca çocuk). Aynı taraflar için yazışma varsa
 * yenisi açılmaz, mevcut yazışma açılır. Yönetici ve ön büro yazışma başlatmaz.
 */
export function NewConversationPanel({ open, onClose, onStarted }: Props) {
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Yeni yazışma"
      description="Mesajlar yalnız sizin ve karşı tarafın görebileceği birebir yazışmadır."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form={FORM_ID}>
            Yazışmayı başlat
          </Button>
        </>
      }
    >
      {open ? <NewConversationForm onStarted={onStarted} /> : null}
    </SidePanel>
  )
}

function NewConversationForm({ onStarted }: Pick<Props, 'onStarted'>) {
  const { session } = useAuth()
  const role = session?.role ?? 'ogrenci'
  const students = useCoreAll('students')
  const teachers = useCoreAll('teachers', {}, { enabled: role !== 'ogretmen' })
  const start = useStartConversation()
  const ownStudentId = session?.links.find((link) => link.kind === 'student')?.recordId ?? ''

  const studentOptions = useMemo(
    () =>
      (students.data ?? NONE)
        .map((row) => ({ value: row.record.id, label: row.record.name }))
        .sort((a, b) => a.label.localeCompare(b.label, 'tr')),
    [students.data],
  )
  const teacherOptions = useMemo(
    () =>
      (teachers.data ?? NONE)
        .map((row) => ({ value: row.record.id, label: row.record.name }))
        .sort((a, b) => a.label.localeCompare(b.label, 'tr')),
    [teachers.data],
  )

  const resolver = useMemo(() => zodResolver(newConversationSchema(role)), [role])
  const form = useForm<NewConversationValues>({
    resolver,
    defaultValues: {
      studentId: role === 'ogrenci' ? ownStudentId : '',
      teacherId: '',
      counterpart: '',
      text: '',
    },
  })
  const errors = form.formState.errors
  const busy = start.isPending || form.formState.isSubmitting
  const studentId = useWatch({ control: form.control, name: 'studentId' })
  const parents = useParentAccounts(studentId || null, { enabled: role === 'ogretmen' })
  const studentField = form.register('studentId')

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await start.submit(newConversationBody(role, values), {
      setError: form.setError,
    })
    if (outcome.status !== 'success') return
    notify.success('Yazışma hazır.')
    const id = outcome.data.data.entity?.id
    if (id) onStarted(id)
  })

  return (
    <form id={FORM_ID} noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-5">
      {role === 'ogrenci' ? null : (
        <FormField
          id="yazisma-ogrenci"
          label={role === 'veli' ? 'Çocuğunuz' : 'Öğrenci'}
          error={errors.studentId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...studentField}
              disabled={busy}
              onChange={(event) => {
                void studentField.onChange(event)
                form.setValue('counterpart', '')
              }}
            >
              <NativeSelectOption value="">Seçin</NativeSelectOption>
              {studentOptions.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      )}
      {role === 'ogretmen' ? (
        <FormField id="yazisma-muhatap" label="Kiminle yazışacaksınız?" error={errors.counterpart}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('counterpart')}
              disabled={busy || studentId === ''}
            >
              <NativeSelectOption value="">Seçin</NativeSelectOption>
              {studentId ? (
                <NativeSelectOption value={COUNTERPART_STUDENT}>Öğrenci</NativeSelectOption>
              ) : null}
              {(parents.data?.data ?? NONE).map((parent) => (
                <NativeSelectOption key={parent.userId} value={parentCounterpart(parent.userId)}>
                  {parent.name} (veli)
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : (
        <FormField id="yazisma-ogretmen" label="Öğretmen" error={errors.teacherId}>
          {(control) => (
            <NativeSelect {...control} {...form.register('teacherId')} disabled={busy}>
              <NativeSelectOption value="">Seçin</NativeSelectOption>
              {teacherOptions.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      )}
      <FormField id="yazisma-ilk-mesaj" label="İlk mesajınız" error={errors.text}>
        {(control) => <Textarea {...control} {...form.register('text')} rows={5} disabled={busy} />}
      </FormField>
      <p
        role="note"
        className="rounded-card bg-surface-soft px-3 py-2 text-xs text-muted-foreground"
      >
        {SENSITIVE_INFO_NOTICE}
      </p>
    </form>
  )
}
