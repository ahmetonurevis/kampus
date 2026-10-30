import { Children, useRef, useState, type ReactNode, type RefObject } from 'react'
import { View, ScrollView, Pressable, useWindowDimensions, type ViewStyle } from 'react-native'
import type { KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller'
import { useActiveSchool } from '../store/SchoolProvider.tsx'
import type { ThemePreference as ThemeChoice } from '../model/experience.ts'
import { context, nameOf } from '../model/school.ts'
import { FormScrollView } from './KeyboardLayout.tsx'
import {
  Avatar,
  Button,
  Icon,
  Select,
  Sheet,
  T,
  styles,
  toneSoft,
  useColors,
  type Tone,
} from './components.tsx'

type ScreenProps = {
  children?: ReactNode
  footer?: ReactNode
  scrollRef?: RefObject<KeyboardAwareScrollViewRef | null>
}
export function Screen({ children, footer, scrollRef }: ScreenProps) {
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
type TextActionProps = {
  children?: ReactNode
  onPress?: () => void
  disabled?: boolean
  label?: string
}
export function TextAction({ children, onPress, disabled, label }: TextActionProps) {
  const c = useColors()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        label ||
        Children.toArray(children)
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
type SectionProps = {
  title: string
  action?: string
  onPress?: () => void
  children?: ReactNode
  panel?: boolean
}
export function Section({ title, action, onPress, children, panel = false }: SectionProps) {
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
type ListRowProps = {
  title: ReactNode
  subtitle?: ReactNode
  eyebrow?: ReactNode
  badge?: ReactNode
  onPress?: () => void
  label?: string
  children?: ReactNode
  card?: boolean
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
}: ListRowProps) {
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
  const style: ViewStyle = {
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
type NoticeProps = { title: string; text?: string; tone?: Tone; children?: ReactNode }
export function Notice({ title, text, tone = 'primary', children }: NoticeProps) {
  const c = useColors()
  return (
    <View
      accessibilityRole={tone === 'red' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={{ padding: 16, gap: 8, backgroundColor: toneSoft(c, tone), borderRadius: 10 }}
    >
      <T bold style={{ color: c[tone] }}>
        {title}
      </T>
      {!!text && (
        <T size={14} style={{ color: c[tone] }}>
          {text}
        </T>
      )}
      {children}
    </View>
  )
}
type TabsProps<V extends string> = {
  value: V
  onChange: (value: V) => void
  options: readonly { value: V; label: string }[]
}
export function Tabs<V extends string>({ value, onChange, options }: TabsProps<V>) {
  const c = useColors()
  const scrollRef = useRef<ScrollView>(null)
  const offsets = useRef<Partial<Record<string, number>>>({})
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
type PaginationProps = {
  count: number
  index: number
  pageSize?: number
  onChange: (index: number) => void
}
export function Pagination({ count, index, pageSize = 10, onChange }: PaginationProps) {
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
export function EmptyResults({ noun, onClear }: { noun: string; onClear: () => void }) {
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
  const { data, session, preference } = useActiveSchool(),
    c = useColors(),
    scope = context(data, session)
  const [open, setOpen] = useState(false),
    [saving, setSaving] = useState(false)
  const parent = data.parents[0]
  if (!parent) throw new Error('Veli kaydı bulunamadı.')
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
          {parent.studentIds.map((id) => {
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
const themeOptions: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Açık' },
  { value: 'dark', label: 'Koyu' },
  { value: 'system', label: 'Sistem ayarı' },
]
export function ThemePreference() {
  const { session, preference } = useActiveSchool()
  return (
    <Select
      label="Tema"
      required
      value={session.theme}
      onChange={(value) => {
        const choice = themeOptions.find((option) => option.value === value)
        if (choice) void preference({ theme: choice.value })
      }}
      options={themeOptions}
    />
  )
}
export function DetailPair({ label, value }: { label: string; value: ReactNode }) {
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
