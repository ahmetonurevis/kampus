import { useState } from 'react'
import { View, Pressable } from 'react-native'
import { useActiveSchool } from '../store/SchoolProvider.tsx'
import { recordError } from '../lib/error-log.ts'
import { usePersistentDraft } from '../store/use-persistent-draft.ts'
import {
  operation,
  normalizeFields,
  pickedFile,
  str,
  stringList,
  type OperationKind,
  type OperationRecord,
} from '../model/operations.ts'
import { pickFile, fileSelectionMessage } from '../lib/files.ts'
import { Button, DateField, Field, Icon, Select, Sheet, T, useColors } from './components.tsx'
import DraftStatus from './DraftStatus.tsx'

export type OperationDescriptor = { kind: OperationKind; record?: OperationRecord | null }
type OperationFormProps = { descriptor: OperationDescriptor; onClose: () => void }

export default function OperationForm({ descriptor, onClose }: OperationFormProps) {
  const { data, session, commit, busy, notify } = useActiveSchool(),
    c = useColors()
  const definition = operation(data, session, descriptor.kind, descriptor.record)
  const draft = usePersistentDraft(
    'form-' + descriptor.kind,
    descriptor.record?.id || '',
    definition.initial,
  )
  const values = draft.value,
    setValues = draft.set
  const [formError, setFormError] = useState(''),
    [picking, setPicking] = useState(false)
  const fields = definition.fields(values)
  const change = (key: string, value: unknown) => {
    setValues((old) => ({
      ...old,
      [key]: value,
      ...(key === 'teacherId' ? { slotId: '' } : {}),
      ...(key === 'classId' ? { questionIds: [] } : {}),
    }))
    setFormError('')
  }
  async function submit() {
    const validated = { ...values }
    try {
      normalizeFields(fields, validated)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'İşlem tamamlanamadı.'
      setFormError(message)
      notify(message, 'error')
      return
    }
    const ok = await commit(
      (s, id) => definition.run(s, validated, id),
      `${definition.title}: işlem kaydedildi.`,
    )
    if (ok) {
      await draft.clear(definition.initial)
      onClose()
    }
  }
  async function chooseFile(key: string) {
    setPicking(true)
    try {
      const file = await pickFile()
      if (file) change(key, file)
    } catch (error) {
      recordError(error, 'file-pick', 'warn')
      notify(fileSelectionMessage(error), 'error')
    } finally {
      setPicking(false)
    }
  }
  return (
    <Sheet
      visible
      title={definition.title}
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <Button primary disabled={busy || picking || !draft.ready} onPress={submit}>
          {busy ? 'Kaydediliyor…' : 'Kaydet'}
        </Button>
      }
    >
      {descriptor.kind === 'collect' && (
        <T muted>Bu ödeme örnek veriyi günceller. Gerçek tahsilat yapılmaz.</T>
      )}
      {descriptor.kind === 'archive' && (
        <T muted>Geçmiş kayıtlar korunur. Bağlı aktif kayıtlar seçtiğiniz hedefe aktarılır.</T>
      )}
      {descriptor.kind === 'remind' && (
        <T muted>Hatırlatma bu cihazda işaretlenir. Gerçek SMS veya e-posta gönderilmez.</T>
      )}
      <DraftStatus draft={draft} />
      {draft.ready &&
        fields.map(({ key: fieldKey, ...field }) => (
          <View key={fieldKey}>
            {field.type === 'select' ? (
              <Select
                {...field}
                value={values[fieldKey]}
                onChange={(value) => change(fieldKey, value)}
              />
            ) : field.type === 'date' || field.type === 'time' ? (
              <DateField
                {...field}
                time={field.type === 'time'}
                value={str(values[fieldKey])}
                onChange={(value) => change(fieldKey, value)}
              />
            ) : field.type === 'file' ? (
              <View style={{ gap: 8 }}>
                <T bold>{field.label}</T>
                <Button icon="Paperclip" disabled={picking} onPress={() => chooseFile(fieldKey)}>
                  {pickedFile(values[fieldKey])?.name || 'Dosya seç'}
                </Button>
                <T muted size={12}>
                  PDF, JPG, PNG veya DOCX · En fazla 10 MB
                </T>
              </View>
            ) : field.type === 'multi' ? (
              <View style={{ gap: 10 }}>
                <T bold>
                  {field.label} ({stringList(values[fieldKey]).length} seçili)
                </T>
                {field.options.map((option) => {
                  const selected = stringList(values[fieldKey]).includes(option.value)
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: !!selected }}
                      onPress={() =>
                        change(
                          fieldKey,
                          selected
                            ? stringList(values[fieldKey]).filter((id) => id !== option.value)
                            : [...stringList(values[fieldKey]), option.value],
                        )
                      }
                      style={{
                        flexDirection: 'row',
                        gap: 12,
                        padding: 14,
                        borderRadius: 12,
                        backgroundColor: selected ? c.primarySoft : c.soft,
                        minHeight: 48,
                      }}
                    >
                      <Icon name={selected ? 'SquareCheck' : 'Square'} color={c.primary} />
                      <T style={{ flex: 1 }}>{option.label}</T>
                    </Pressable>
                  )
                })}
              </View>
            ) : (
              <Field
                {...field}
                value={values[fieldKey]}
                onChange={(value) => change(fieldKey, value)}
              />
            )}
          </View>
        ))}
      {!!formError && (
        <T style={{ color: c.red }} accessibilityRole="alert">
          {formError}
        </T>
      )}
    </Sheet>
  )
}
