import { useMemo, useState } from 'react'
import {
  SENSITIVE_INFO_NOTICE,
  useParentAccounts,
  useStartConversation,
} from '@kampus/react-shared/use-communication.ts'
import { Button, Field, Select, Sheet, type SelectOption } from '../../ui/components.tsx'
import { Notice } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import {
  COUNTERPART_STUDENT,
  newConversationBody,
  parentCounterpart,
} from '@kampus/react-shared/conversation-model.ts'
import { validateNewConversation } from '../communication.ts'
import { useConversationNames } from './use-conversation-names.ts'

type Props = {
  onClose: () => void
  /** Yazışma açıldı (ya da zaten vardı); kimliği ile akış açılır. */
  onStarted: (conversationId: string) => void
}

type Errors = Partial<Record<'studentId' | 'teacherId' | 'counterpart' | 'text', string>>

const NONE: readonly never[] = []

function sortedOptions(entries: Iterable<[string, string]>): SelectOption[] {
  return [...entries]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr'))
}

/**
 * Yeni yazışma (alt pencere). Öğretmen: öğrenci, sonra muhatap (öğrenci ya da o öğrencinin bir
 * veli hesabı). Öğrenci: öğretmen. Veli: çocuk ve öğretmen. Aynı taraflar için yazışma varsa
 * yenisi açılmaz, mevcut yazışma açılır. İlk mesaj zorunludur. Metin cihaza yazılmaz.
 */
export function NewConversationSheet({ onClose, onStarted }: Props) {
  const { role } = useApiSession()
  const { names, students } = useConversationNames(role)
  const start = useStartConversation()
  const [studentPick, setStudentPick] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [counterpart, setCounterpart] = useState('')
  const [text, setText] = useState('')
  const [errors, setErrors] = useState<Errors>({})

  // Öğrenci hesabında kapsam yalnız kendisidir; seçici gösterilmez.
  const ownStudent = role === 'ogrenci' ? ([...names.students.keys()][0] ?? '') : ''
  const studentId = role === 'ogrenci' ? ownStudent : studentPick
  const parents = useParentAccounts(studentId || null, { enabled: role === 'ogretmen' })
  const studentOptions = useMemo(() => sortedOptions(names.students), [names.students])
  const teacherOptions = useMemo(() => sortedOptions(names.teachers), [names.teachers])
  const counterpartOptions: SelectOption[] = [
    ...(studentId ? [{ value: COUNTERPART_STUDENT, label: 'Öğrenci' }] : []),
    ...(parents.data?.data ?? NONE).map((parent) => ({
      value: parentCounterpart(parent.userId),
      label: `${parent.name} (veli)`,
    })),
  ]

  async function submit() {
    const result = validateNewConversation(role, { studentId, teacherId, counterpart, text })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    const outcome = await start.submit(newConversationBody(role, result.values))
    if (outcome.status !== 'success') return
    const id = outcome.data.data.entity?.id
    if (id) onStarted(id)
    else onClose()
  }

  return (
    <Sheet
      visible
      title="Yeni yazışma"
      onClose={onClose}
      footer={
        <Button primary icon="Send" disabled={start.isPending} onPress={() => void submit()}>
          {start.isPending ? 'Başlatılıyor…' : 'Yazışmayı başlat'}
        </Button>
      }
    >
      {role !== 'ogrenci' && (
        <Select
          label={role === 'veli' ? 'Çocuğunuz' : 'Öğrenci'}
          value={studentPick}
          options={studentOptions}
          required
          onChange={(value) => {
            setStudentPick(value)
            setCounterpart('')
            setErrors({ ...errors, studentId: undefined })
          }}
        />
      )}
      {errors.studentId && <Notice title={errors.studentId} tone="red" />}
      {role === 'ogretmen' ? (
        <Select
          label="Kiminle yazışacaksınız?"
          value={counterpart}
          options={counterpartOptions}
          required
          onChange={(value) => {
            setCounterpart(value)
            setErrors({ ...errors, counterpart: undefined })
          }}
        />
      ) : (
        <Select
          label="Öğretmen"
          value={teacherId}
          options={teacherOptions}
          required
          onChange={(value) => {
            setTeacherId(value)
            setErrors({ ...errors, teacherId: undefined })
          }}
        />
      )}
      {(errors.counterpart ?? errors.teacherId) && (
        <Notice title={errors.counterpart ?? errors.teacherId ?? ''} tone="red" />
      )}
      <Field
        label="İlk mesajınız"
        value={text}
        onChange={(value) => {
          setText(value)
          setErrors({ ...errors, text: undefined })
        }}
        multiline
        maxLength={2000}
        editable={!start.isPending}
        {...(errors.text ? { error: errors.text } : {})}
      />
      <Notice title="Hassas bilgi paylaşmayın" text={SENSITIVE_INFO_NOTICE} />
      {students.error && <Notice title="Öğrenci listesi alınamadı" tone="red" />}
    </Sheet>
  )
}
