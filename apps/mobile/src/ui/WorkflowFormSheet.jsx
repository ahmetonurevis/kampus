import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import {
  runWorkflow,
  workflowSchemas,
  renewalQuote,
} from '@kampus/school-core/lib/school-workflows.js'
import {
  workflowForm,
  readFormValue,
  changeFormValue,
  normalizeWorkflowInput,
  csvTemplate,
  workflowCsvReferences,
} from '@kampus/school-core/lib/workflow-presentation.js'
import { money } from '@kampus/school-core/lib/format.js'
import { useSchool, recordError } from '../store/SchoolProvider.jsx'
import { pickTextFile } from '../lib/text-files.js'
import { Button, Card, Sheet, T, useColors } from './components.jsx'
import { TextAction } from './SchoolLayout.jsx'
import WorkflowField from './WorkflowFields.jsx'

const clone = (value) => JSON.parse(JSON.stringify(value))

// Alan değerini kontrol ekranında okunur metne çevirir.
function previewValue(field, values) {
  const value = readFormValue(values, field.key)
  if (field.type === 'select')
    return field.options.find((o) => String(o.value) === String(value))?.label || 'Seçilmedi'
  if (field.type === 'multi')
    return field.options
      .filter((o) => value?.includes(o.value))
      .map((o) => o.label)
      .join(', ')
  if (field.type === 'checkbox') return value ? 'Evet' : 'Hayır'
  return String(value ?? '')
}

function CsvImport({ onText }) {
  const { data, session, notify } = useSchool()
  const [busy, setBusy] = useState(false),
    [showReferences, setShowReferences] = useState(false)
  async function choose() {
    setBusy(true)
    try {
      const file = await pickTextFile({ extensions: ['csv'] })
      if (file) onText(file.text)
    } catch (error) {
      recordError(error, 'exam-csv-read', 'warn')
      notify(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <T muted size={13}>
        Başlık sırası: {csvTemplate.split('\n')[0]}
      </T>
      <Button icon="Paperclip" disabled={busy} onPress={choose}>
        {busy ? 'Dosya okunuyor…' : 'CSV dosyası seç'}
      </Button>
      <TextAction onPress={() => setShowReferences((open) => !open)}>
        {showReferences ? 'Kimlik listesini gizle' : 'CSV kimlik eşleştirme listesi'}
      </TextAction>
      {showReferences &&
        workflowCsvReferences(data, session).map((line) => (
          <T key={line} muted size={12}>
            {line}
          </T>
        ))}
    </View>
  )
}

export default function WorkflowFormSheet({ descriptor, onClose }) {
  const { data, session, commit, busy, notify } = useSchool(),
    c = useColors()
  const { command, recordId } = descriptor
  const definition = workflowForm(data, session, command, recordId, descriptor.initial)
  const [values, setValues] = useState(() => clone(definition.initial)),
    [errors, setErrors] = useState({}),
    [reviewing, setReviewing] = useState(false),
    [formError, setFormError] = useState('')
  const fields = definition.fields(values)
  const quote = useMemo(() => {
    if (command !== 'renewal' || values.mode !== 'renew') return null
    try {
      return renewalQuote(values)
    } catch {
      return null
    }
  }, [command, values])
  function change(key, value) {
    setValues((old) => changeFormValue(old, key, value))
    setErrors({})
    setFormError('')
    setReviewing(false)
  }
  async function submit() {
    const input = normalizeWorkflowInput(definition, values),
      schema = workflowSchemas[command]
    if (schema) {
      const parsed = schema.safeParse(input)
      if (!parsed.success) {
        const next = {}
        for (const issue of parsed.error.issues) next[issue.path.join('.')] ||= issue.message
        setErrors(next)
        notify(parsed.error.issues[0].message, 'error')
        return
      }
    }
    if (fields.length && !reviewing) {
      setReviewing(true)
      return
    }
    setFormError('')
    const ok = await commit(
      (next, makeId) => runWorkflow(next, session, command, input, makeId, recordId),
      `${definition.title}: işlem kaydedildi.`,
      setFormError,
    )
    if (ok) onClose()
  }
  return (
    <Sheet
      visible
      title={definition.title}
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <View style={{ gap: 10 }}>
          <Button primary disabled={busy} onPress={submit}>
            {busy
              ? 'Kaydediliyor…'
              : !fields.length || reviewing
                ? 'Onayla ve kaydet'
                : 'Kontrol et'}
          </Button>
          {reviewing && !!fields.length && (
            <Button disabled={busy} onPress={() => setReviewing(false)}>
              Düzenlemeye dön
            </Button>
          )}
        </View>
      }
    >
      {!!definition.hint && <T muted>{definition.hint}</T>}
      {command === 'exam-import' && !reviewing && (
        <CsvImport onText={(text) => change('csv', text)} />
      )}
      {!reviewing ? (
        fields.map((field) => (
          <WorkflowField
            key={field.key}
            field={field}
            values={values}
            error={errors[field.key]}
            onChange={change}
          />
        ))
      ) : (
        <View style={{ gap: 14 }}>
          <T bold size={17}>
            Kaydetmeden önce kontrol edin
          </T>
          {fields.map((field) => (
            <View key={field.key} style={{ gap: 3 }}>
              <T bold size={13}>
                {field.label}
              </T>
              <T>{previewValue(field, values) || '—'}</T>
            </View>
          ))}
        </View>
      )}
      {!!formError && (
        <T accessibilityRole="alert" style={{ color: c.red }}>
          {formError}
        </T>
      )}
      {quote && (
        <Card soft style={{ backgroundColor: c.primarySoft }}>
          <T bold>Yeni dönem ödeme özeti</T>
          <T size={14}>
            Brüt {money(quote.gross)} · Burs {money(quote.scholarshipAmount)} · Ek indirim{' '}
            {money(quote.discountAmount)}
          </T>
          <T bold>Net eğitim bedeli: {money(quote.amount)}</T>
          <T muted size={13}>
            {quote.installments.length} taksit · Toplam {money(quote.amount)}
          </T>
        </Card>
      )}
    </Sheet>
  )
}
