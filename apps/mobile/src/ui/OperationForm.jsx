import { usePersistentDraft } from '../store/use-persistent-draft.js'
import DraftStatus from './DraftStatus.jsx'
import React, { useState } from 'react'
import { View, Pressable } from 'react-native'
import { useSchool, recordError } from '../store/SchoolProvider.jsx'
import { operation, normalizeFields } from '../model/operations.ts'
import { Button, DateField, Field, Icon, Select, Sheet, T, useColors } from './components.jsx'
import { pickFile, fileSelectionMessage } from '../lib/files.js'

export default function OperationForm({ descriptor, onClose }) {
  const { data, session, commit, busy, notify } = useSchool(),
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
  const change = (key, value) => {
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
      setFormError(error.message)
      notify(error.message, 'error')
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
  async function chooseFile(key) {
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
                value={values[fieldKey]}
                onChange={(value) => change(fieldKey, value)}
              />
            ) : field.type === 'file' ? (
              <View style={{ gap: 8 }}>
                <T bold>{field.label}</T>
                <Button icon="Paperclip" disabled={picking} onPress={() => chooseFile(fieldKey)}>
                  {values[fieldKey]?.name || 'Dosya seç'}
                </Button>
                <T muted size={12}>
                  PDF, JPG, PNG veya DOCX · En fazla 10 MB
                </T>
              </View>
            ) : field.type === 'multi' ? (
              <View style={{ gap: 10 }}>
                <T bold>
                  {field.label} ({values[fieldKey]?.length || 0} seçili)
                </T>
                {field.options.map((option) => {
                  const selected = values[fieldKey]?.includes(option.value)
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: !!selected }}
                      onPress={() =>
                        change(
                          fieldKey,
                          selected
                            ? values[fieldKey].filter((id) => id !== option.value)
                            : [...(values[fieldKey] || []), option.value],
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
