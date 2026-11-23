import { useState } from 'react'
import { Pressable, View } from 'react-native'
import type { State } from '@kampus/school-core/data/seed.ts'
import type { CollectionRow } from '@kampus/react-shared/collections.ts'
import { Avatar, Button, Icon, Sheet, T, useColors } from '../../ui/components.tsx'

type StudentRecord = State['students'][number]
type ClassRecord = State['classes'][number]

export type ChildOption = { id: string; name: string; className: string | undefined }

/** Veli çocuk seçici: tek çocukta düz özet, çoklu çocukta seçim penceresi. */
export function ChildPicker({
  options,
  value,
  onChange,
}: {
  options: readonly ChildOption[]
  value: string
  onChange: (id: string) => void
}) {
  const c = useColors()
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.id === value)
  if (!selected) return null
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Çocuk değiştir: ${selected.name}`}
        disabled={options.length < 2}
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 64,
          padding: 14,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
        }}
      >
        <Avatar name={selected.name} size={36} />
        <View style={{ flex: 1, gap: 4 }}>
          <T bold size={16}>
            {selected.name}
          </T>
          <T muted size={13}>
            {[selected.className, options.length > 1 ? 'Çocuk değiştir' : undefined]
              .filter(Boolean)
              .join(' · ')}
          </T>
        </View>
        {options.length > 1 && <Icon name="ChevronDown" size={18} color={c.primary} />}
      </Pressable>
      {open && (
        <Sheet
          compact
          visible
          title="Çocuk seç"
          onClose={() => setOpen(false)}
          footer={<Button onPress={() => setOpen(false)}>Vazgeç</Button>}
        >
          <View accessibilityRole="radiogroup" accessibilityLabel="Çocuk" style={{ gap: 4 }}>
            {options.map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="radio"
                accessibilityLabel={`${option.name} seç`}
                accessibilityState={{ checked: option.id === value }}
                aria-checked={option.id === value}
                onPress={() => {
                  onChange(option.id)
                  setOpen(false)
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 16,
                  minHeight: 72,
                  paddingBottom: 16,
                  borderBottomWidth: 1,
                  borderColor: c.border,
                }}
              >
                <Avatar name={option.name} />
                <View style={{ flex: 1, gap: 4 }}>
                  <T bold size={17}>
                    {option.name}
                  </T>
                  <T muted size={14}>
                    {[option.className, option.id === value ? 'Seçili' : undefined]
                      .filter(Boolean)
                      .join(' · ')}
                  </T>
                </View>
                <Icon name={option.id === value ? 'Check' : 'Circle'} color={c.primary} />
              </Pressable>
            ))}
          </View>
        </Sheet>
      )}
    </>
  )
}

/** Sunucunun veli kapsamından gelen çocuklar ve sınıf adları. */
export function childOptions(
  students: readonly CollectionRow<StudentRecord>[],
  classes: readonly CollectionRow<ClassRecord>[],
): ChildOption[] {
  const classNames = new Map(classes.map((row) => [row.id, row.record.name]))
  return students.map((row) => ({
    id: row.id,
    name: row.record.name,
    className: row.record.classId ? classNames.get(row.record.classId) : undefined,
  }))
}
