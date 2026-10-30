import { FormScrollView } from './KeyboardLayout.jsx'
import React, { useRef, useState } from 'react'
import { View, ScrollView, Pressable, useWindowDimensions } from 'react-native'
import { useSchool } from '../store/SchoolProvider.tsx'
import { context, nameOf } from '../model/school.ts'
import { Avatar, Button, Icon, Select, Sheet, T, styles, useColors } from './components.jsx'

export function Screen({ children, footer, scrollRef }) {
  const c = useColors()
  return (
    <View style={{ flex: 1 }}>
      <FormScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: 20,
          paddingTop: 20,
          paddingBottom: 24,
          gap: 24,
          flexGrow: 1,
        }}
      >
        {children}
        {footer && (
          <View style={{ borderTopWidth: 1, borderColor: c.border, paddingTop: 20, gap: 8 }}>
            {footer}
          </View>
        )}
      </FormScrollView>
    </View>
  )
}
export function TextAction({ children, onPress, disabled, label }) {
  const c = useColors()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        label ||
        React.Children.toArray(children)
          .filter((child) => typeof child === 'string' || typeof child === 'number')
          .join('')
      }
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        justifyContent: 'center',
        paddingHorizontal: 4,
        opacity: disabled ? 0.4 : pressed ? 0.65 : 1,
      })}
    >
      <T bold size={14} style={{ color: c.primary, textAlign: 'center', flexShrink: 1 }}>
        {children}
      </T>
    </Pressable>
  )
}
export function Section({ title, action, onPress, children, panel = false }) {
  const { fontScale, width } = useWindowDimensions()
  const c = useColors()
  return (
    <View
      style={[
        { gap: 12 },
        panel && {
          padding: 16,
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: 14,
          backgroundColor: c.surface,
        },
      ]}
    >
      <View
        style={[
          styles.between,
          (fontScale > 1.3 || width < 350) && {
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 0,
          },
        ]}
      >
        <T bold size={17} style={{ flexShrink: 1 }}>
          {title}
        </T>
        {action && <TextAction onPress={onPress}>{action}</TextAction>}
      </View>
      {children}
    </View>
  )
}
export function Divider() {
  const c = useColors()
  return <View style={{ height: 1, backgroundColor: c.border }} />
}
export function ListRow({
  title,
  subtitle,
  eyebrow,
  badge,
  onPress,
  label,
  children,
  card = false,
}) {
  const c = useColors()
  const body = (
    <>
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        {!!eyebrow && (
          <T size={13} style={{ color: c.primary }}>
            {eyebrow}
          </T>
        )}
        <T bold size={16}>
          {title}
        </T>
        {!!subtitle && (
          <T muted size={14}>
            {subtitle}
          </T>
        )}
        {badge}
        {children}
      </View>
      {onPress && <Icon name="ChevronRight" size={19} />}
    </>
  )
  const style = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingVertical: 14,
    paddingHorizontal: card ? 16 : 0,
    borderWidth: card ? 1 : 0,
    borderBottomWidth: 1,
    borderColor: c.border,
    borderRadius: card ? 12 : 0,
    backgroundColor: c.surface,
  }
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [style, { opacity: pressed ? 0.65 : 1 }]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
  )
}
export function Notice({ title, text, tone = 'primary', children }) {
  const c = useColors()
  return (
    <View
      accessibilityRole={tone === 'red' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={{ padding: 16, gap: 8, backgroundColor: c[tone + 'Soft'] || c.soft, borderRadius: 10 }}
    >
      <T bold style={{ color: c[tone] || c.text }}>
        {title}
      </T>
      {!!text && (
        <T size={14} style={{ color: c[tone] || c.muted }}>
          {text}
        </T>
      )}
      {children}
    </View>
  )
}
export function Tabs({ value, onChange, options }) {
  const c = useColors()
  const scrollRef = useRef(null)
  const offsets = useRef({})
  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1, gap: 16 }}
      style={{ flexGrow: 0, borderBottomWidth: 1, borderColor: c.border }}
    >
      {options.map(({ value: key, label }) => (
        <Pressable
          key={key}
          accessibilityRole="tab"
          accessibilityLabel={label}
          accessibilityState={{ selected: value === key }}
          aria-selected={value === key}
          onLayout={({ nativeEvent }) => {
            offsets.current[key] = nativeEvent.layout.x
            if (value === key)
              scrollRef.current?.scrollTo({ x: nativeEvent.layout.x, animated: false })
          }}
          onPress={() => {
            onChange(key)
            scrollRef.current?.scrollTo({ x: offsets.current[key] || 0, animated: false })
          }}
          style={{
            minHeight: 48,
            paddingVertical: 12,
            paddingHorizontal: 2,
            justifyContent: 'center',
            borderBottomWidth: 2,
            borderBottomColor: value === key ? c.primary : 'transparent',
          }}
        >
          <T bold={value === key} size={14} style={{ color: value === key ? c.primary : c.muted }}>
            {label}
          </T>
        </Pressable>
      ))}
    </ScrollView>
  )
}
export function Pagination({ count, index, pageSize = 10, onChange }) {
  const c = useColors()
  if (!count) return null
  const last = Math.max(0, Math.ceil(count / pageSize) - 1)
  return (
    <View style={[styles.between, { flexWrap: 'wrap' }]}>
      <T muted size={13}>
        {index * pageSize + 1}–{Math.min(count, (index + 1) * pageSize)} / {count}
      </T>
      {last > 0 && (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button
            small
            disabled={!index}
            onPress={() => onChange(index - 1)}
            style={{ borderWidth: 1, borderColor: c.border, backgroundColor: c.background }}
          >
            ‹ Önceki
          </Button>
          <Button
            small
            disabled={index >= last}
            onPress={() => onChange(index + 1)}
            style={{ borderWidth: 1, borderColor: c.border, backgroundColor: c.background }}
          >
            Sonraki ›
          </Button>
        </View>
      )}
    </View>
  )
}
export function EmptyResults({ noun, onClear }) {
  const c = useColors()
  return (
    <View
      style={{
        padding: 24,
        gap: 12,
        alignItems: 'center',
        borderRadius: 10,
        backgroundColor: c.soft,
      }}
    >
      <T bold style={{ textAlign: 'center' }}>
        Bu filtrede {noun} bulunamadı
      </T>
      <T muted style={{ textAlign: 'center' }}>
        Aramayı veya filtreyi değiştir.
      </T>
      <TextAction onPress={onClear}>Filtreleri temizle</TextAction>
    </View>
  )
}
export function ChildSelector() {
  const { data, session, preference } = useSchool(),
    c = useColors(),
    scope = context(data, session)
  const [open, setOpen] = useState(false),
    [saving, setSaving] = useState(false)
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Çocuk değiştir: ${scope.student.name}`}
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 14,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
        }}
      >
        <Avatar name={scope.student.name} size={36} />
        <View style={{ flex: 1, gap: 4 }}>
          <T bold size={16}>
            {scope.student.name}
          </T>
          <T muted size={13}>
            {scope.classroom.name} · Çocuk değiştir
          </T>
        </View>
        <Icon name="ChevronDown" size={18} color={c.primary} />
      </Pressable>
      {open && (
        <Sheet
          compact
          visible
          title="Çocuk seç"
          onClose={() => !saving && setOpen(false)}
          footer={
            <Button disabled={saving} onPress={() => setOpen(false)}>
              Vazgeç
            </Button>
          }
        >
          {data.parents[0].studentIds.map((id) => {
            const student = data.students.find((s) => s.id === id)
            if (!student) return null
            return (
              <Pressable
                key={id}
                accessibilityRole="radio"
                accessibilityLabel={`${student.name} seç`}
                accessibilityState={{ checked: session.childId === id, disabled: saving }}
                aria-checked={session.childId === id}
                disabled={saving}
                onPress={async () => {
                  setSaving(true)
                  const ok = await preference({ childId: id })
                  setSaving(false)
                  if (ok) setOpen(false)
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
                <Avatar name={student.name} />
                <View style={{ flex: 1, gap: 4 }}>
                  <T bold size={17}>
                    {student.name}
                  </T>
                  <T muted size={14}>
                    {nameOf(data, 'classes', student.classId)}
                    {session.childId === id ? ' · Seçili' : ''}
                  </T>
                </View>
                <Icon name={session.childId === id ? 'Check' : 'Circle'} color={c.primary} />
              </Pressable>
            )
          })}
        </Sheet>
      )}
    </>
  )
}
export function ThemePreference() {
  const { session, preference } = useSchool()
  return (
    <Select
      label="Tema"
      required
      value={session.theme}
      onChange={(theme) => preference({ theme })}
      options={[
        { value: 'light', label: 'Açık' },
        { value: 'dark', label: 'Koyu' },
        { value: 'system', label: 'Sistem ayarı' },
      ]}
    />
  )
}
export function DetailPair({ label, value }) {
  const { fontScale, width } = useWindowDimensions()
  const narrow = fontScale > 1.3 || width < 350
  return (
    <View
      style={[
        styles.between,
        { alignItems: 'flex-start' },
        narrow && { flexDirection: 'column', gap: 4 },
      ]}
    >
      <T muted size={14}>
        {label}
      </T>
      <T bold size={14} style={{ flexShrink: 1, textAlign: narrow ? 'left' : 'right' }}>
        {value}
      </T>
    </View>
  )
}
