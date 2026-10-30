import type { ReactNode } from 'react'
import { Pressable, View, type KeyboardTypeOptions } from 'react-native'
import { dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import {
  readFormValue,
  type FieldType,
  type FormValues,
  type WorkflowField as WorkflowFieldDefinition,
} from '@kampus/school-core/lib/workflow-presentation.ts'
import { str, stringList } from '../model/operations.ts'
import { DateField, Field, Icon, Select, T, useColors } from './components.tsx'

const KEYBOARDS: Partial<Record<FieldType, KeyboardTypeOptions>> = { number: 'decimal-pad' }

// Tarih+saat alanı iki parçadan oluşur; birleşik değer "YYYY-AA-GGTSS:DD" olarak saklanır.
type DateTimeFieldProps = {
  field: WorkflowFieldDefinition
  value: string
  onChange: (value: string) => void
}
function DateTimeField({ field, value, onChange }: DateTimeFieldProps) {
  const valid = Number.isFinite(Date.parse(value))
  const date = valid ? dayKey(value) : ''
  const time = valid ? timeLabel(value) : ''
  const join = (nextDate: string, nextTime: string) =>
    onChange(`${nextDate || date || dayKey()}T${nextTime || time || '09:00'}`)
  return (
    <View style={{ gap: 12 }}>
      <DateField label={`${field.label} · tarih`} value={date} onChange={(v) => join(v, '')} />
      <DateField label={`${field.label} · saat`} time value={time} onChange={(v) => join('', v)} />
    </View>
  )
}

// Ortak iş akışı formundaki tek bir alanı türüne göre çizer.
type WorkflowFieldProps = {
  field: WorkflowFieldDefinition
  values: FormValues
  error?: string
  onChange: (key: string, value: unknown) => void
}
export default function WorkflowField({ field, values, error, onChange }: WorkflowFieldProps) {
  const c = useColors()
  const value = readFormValue(values, field.key)
  const options = field.options ?? []
  const chosen = stringList(values[field.key])
  let control: ReactNode
  if (field.type === 'select')
    control = (
      <Select
        label={field.label}
        value={value ?? ''}
        options={options}
        onChange={(next) => onChange(field.key, next)}
        required={options.some((option) => option.value === '')}
      />
    )
  else if (field.type === 'date')
    control = (
      <DateField
        label={field.label}
        value={str(value)}
        onChange={(next) => onChange(field.key, next)}
      />
    )
  else if (field.type === 'datetime')
    control = (
      <DateTimeField
        field={field}
        value={str(value)}
        onChange={(next) => onChange(field.key, next)}
      />
    )
  else if (field.type === 'multi')
    control = (
      <View style={{ gap: 10 }}>
        <T bold size={14}>
          {field.label} ({chosen.length} seçili)
        </T>
        {options.map((option) => {
          const selected = chosen.includes(option.value)
          return (
            <Pressable
              key={option.value}
              accessibilityRole="checkbox"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: !!selected }}
              onPress={() =>
                onChange(
                  field.key,
                  selected ? chosen.filter((id) => id !== option.value) : [...chosen, option.value],
                )
              }
              style={{
                flexDirection: 'row',
                gap: 12,
                padding: 14,
                borderRadius: 12,
                backgroundColor: selected ? c.primarySoft : c.soft,
                minHeight: 48,
                alignItems: 'center',
              }}
            >
              <Icon name={selected ? 'SquareCheck' : 'Square'} color={c.primary} />
              <T style={{ flex: 1 }}>{option.label}</T>
            </Pressable>
          )
        })}
      </View>
    )
  else if (field.type === 'checkbox')
    control = (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={field.label}
        accessibilityState={{ checked: !!values[field.key] }}
        onPress={() => onChange(field.key, !values[field.key])}
        style={{
          flexDirection: 'row',
          gap: 12,
          padding: 14,
          borderRadius: 12,
          backgroundColor: values[field.key] ? c.primarySoft : c.soft,
          minHeight: 48,
          alignItems: 'center',
        }}
      >
        <Icon name={values[field.key] ? 'SquareCheck' : 'Square'} color={c.primary} />
        <T style={{ flex: 1 }}>{field.label}</T>
      </Pressable>
    )
  else
    control = (
      <Field
        label={field.label}
        value={value}
        multiline={field.type === 'textarea'}
        keyboard={KEYBOARDS[field.type] || 'default'}
        maxLength={field.maxLength || (field.type === 'textarea' ? 2000 : undefined)}
        hint={field.hint}
        onChange={(next) => onChange(field.key, next)}
      />
    )
  return (
    <View style={{ gap: 6 }}>
      {control}
      {!!error && (
        <T accessibilityRole="alert" size={13} style={{ color: c.red }}>
          {error}
        </T>
      )}
    </View>
  )
}
