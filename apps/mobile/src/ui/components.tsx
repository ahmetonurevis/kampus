import { FormScrollView, KeyboardFrame } from './KeyboardLayout.tsx'
import { useState, type ReactNode } from 'react'
import {
  View,
  Text,
  Pressable,
  TextInput,
  Modal,
  FlatList,
  Platform,
  StyleSheet,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import type { LucideProps } from 'lucide-react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { icons, type IconName } from './icons.ts'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useAppearance } from './appearance.ts'
import { palettes, spaces, shape, type Palette } from './theme.ts'
import { initials, dateLabel } from '@kampus/school-core/lib/format.ts'

export const useColors = (): Palette => palettes[useAppearance().resolvedTheme]

type IconProps = Omit<LucideProps, 'ref'> & { name?: IconName }
export function Icon({ name = 'Circle', size = 21, color, ...props }: IconProps) {
  const c = useColors()
  // Veriden gelen ad kayıtlı değilse varsayılan simge çizilir.
  const Component = icons[name] || icons.Circle
  return <Component size={size} color={color || c.muted} strokeWidth={1.8} {...props} />
}
type TProps = Omit<TextProps, 'style'> & {
  muted?: boolean
  bold?: boolean
  size?: number
  style?: StyleProp<TextStyle>
}
export function T({ children, muted, bold, size = 15, style, ...props }: TProps) {
  const c = useColors()
  return (
    <Text
      {...props}
      style={[
        {
          color: muted ? c.muted : c.text,
          fontSize: size,
          lineHeight: size * 1.45,
          fontWeight: bold ? '600' : '400',
        },
        style,
      ]}
    >
      {children}
    </Text>
  )
}
type ButtonProps = {
  children?: ReactNode
  onPress?: () => void
  icon?: IconName
  primary?: boolean
  danger?: boolean
  accent?: boolean
  textColor?: string
  disabled?: boolean
  small?: boolean
  style?: StyleProp<ViewStyle>
  label?: string
}
export function Button({
  children,
  onPress,
  icon,
  primary,
  danger,
  accent,
  textColor,
  disabled,
  small,
  style,
  label,
}: ButtonProps) {
  const c = useColors()
  const foreground =
    textColor || (accent ? c.onAccent : primary ? c.onPrimary : danger ? c.red : c.primary)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label || (typeof children === 'string' ? children : undefined)}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 48,
          paddingHorizontal: small ? 12 : 18,
          paddingVertical: 10,
          borderRadius: shape.button,
          backgroundColor: accent ? c.accent : primary ? c.primary : danger ? c.redSoft : c.soft,
          flexDirection: 'row',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
        },
        style,
      ]}
    >
      {!!icon && <Icon name={icon} size={19} color={foreground} />}
      <T
        bold
        size={16}
        style={{
          color: foreground,
          flexShrink: 1,
          textAlign: 'center',
        }}
      >
        {children}
      </T>
    </Pressable>
  )
}
type IconButtonProps = {
  name: IconName
  label: string
  onPress?: () => void
  disabled?: boolean
  filled?: boolean
  selected?: boolean
  color?: string
}
export function IconButton({
  name,
  label,
  onPress,
  disabled,
  filled = false,
  selected = false,
  color,
}: IconButtonProps) {
  const c = useColors()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected }}
      disabled={disabled}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: shape.button,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: selected
          ? c.primarySoft
          : pressed || filled
            ? color
              ? '#FFFFFF2E'
              : c.soft
            : 'transparent',
        opacity: disabled ? 0.4 : 1,
      })}
      onPress={onPress}
    >
      <Icon name={name} color={color || (selected ? c.primary : c.muted)} />
    </Pressable>
  )
}
type CardProps = {
  children?: ReactNode
  onPress?: () => void
  style?: StyleProp<ViewStyle>
  label?: string
  soft?: boolean
}
export function Card({ children, onPress, style, label, soft = false }: CardProps) {
  const c = useColors()
  const common = [
    {
      backgroundColor: soft ? c.soft : c.surface,
      borderWidth: soft ? 0 : 1,
      borderColor: c.border,
      borderRadius: shape.card,
      padding: spaces.card,
      gap: spaces.gap,
    },
    style,
  ]
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [...common, { opacity: pressed ? 0.75 : 1 }]}
    >
      {children}
    </Pressable>
  ) : (
    <View style={common}>{children}</View>
  )
}
export type Tone = 'primary' | 'green' | 'amber' | 'red'
// Rozet rengi metne göre seçilir; her ton için `<ton>Soft` zemin rengi vardır.
export const toneSoft = (c: Palette, tone: Tone) => c[`${tone}Soft` as const]
export function Badge({ text }: { text?: string }) {
  const c = useColors()
  if (!text) return null
  const tone: Tone = /Gecik|Süre aşıldı|Teslim süresi geçti|Yüksek risk|Gelmedi|Reddedildi/.test(
    text,
  )
    ? 'red'
    : /Ödendi|Yanıtlandı|Tamamlandı|Teslim edildi|Başarılı|Geldi|Onaylandı|Aktif|Değerlendirildi/.test(
          text,
        )
      ? 'green'
      : /Bekli|Yaklaş|azalıyor|Takip|Geç geldi/.test(text)
        ? 'amber'
        : 'primary'
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: toneSoft(c, tone),
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
      }}
    >
      <T size={12} bold style={{ color: c[tone] }}>
        {text}
      </T>
    </View>
  )
}
const avatarTones = ['primary', 'green', 'amber', 'red'] as const
export function Avatar({ name, size = 42 }: { name?: string | null; size?: number }) {
  const c = useColors()
  const hash = [...(name || '').normalize('NFC').trim().toLocaleLowerCase('tr')].reduce(
    (h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0,
    0,
  )
  const tone = avatarTones[hash % 4] ?? 'primary'
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: toneSoft(c, tone),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <T bold size={size / 3} style={{ color: c[tone] }}>
        {initials(name)}
      </T>
    </View>
  )
}
type HeadingProps = { title: string; subtitle?: string; action?: ReactNode }
export function Heading({ title, subtitle, action }: HeadingProps) {
  return (
    <View style={{ gap: 6, marginBottom: 2 }}>
      <View style={styles.between}>
        <T bold size={24} style={{ flex: 1, letterSpacing: -0.5 }}>
          {title}
        </T>
        {action}
      </View>
      {!!subtitle && (
        <T muted size={14}>
          {subtitle}
        </T>
      )}
    </View>
  )
}
type EmptyProps = { title?: string; text?: string; action?: ReactNode }
export function Empty({
  title = 'Kayıt bulunamadı',
  text = 'Filtrelerinizi değiştirebilirsiniz.',
  action,
}: EmptyProps) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
      <Icon name="Inbox" size={36} />
      <T bold>{title}</T>
      <T muted style={{ textAlign: 'center' }}>
        {text}
      </T>
      {action}
    </Card>
  )
}
type FieldProps = {
  label: string
  // Form değerleri taslak depodan serbest tipte gelir; metne çevrilerek gösterilir.
  value: unknown
  onChange: (value: string) => void
  placeholder?: string
  multiline?: boolean
  keyboard?: KeyboardTypeOptions
  hint?: string
  editable?: boolean
  maxLength?: number
  compact?: boolean
  hideLabel?: boolean
}
export function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  keyboard = 'default',
  hint,
  editable = true,
  maxLength,
  compact = false,
  hideLabel = false,
}: FieldProps) {
  const c = useColors()
  const [focused, setFocused] = useState(false)
  return (
    <View style={{ gap: 7 }}>
      {!hideLabel && (
        <T bold size={14}>
          {label}
        </T>
      )}
      <TextInput
        accessibilityLabel={label}
        value={String(value ?? '')}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        keyboardType={keyboard}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        selectionColor={c.primary}
        editable={editable}
        maxLength={maxLength}
        multiline={multiline}
        autoCapitalize={keyboard === 'email-address' ? 'none' : 'sentences'}
        style={{
          borderWidth: 1,
          borderColor: focused ? c.primary : c.border,
          borderRadius: shape.field,
          padding: 14,
          minHeight: 52,
          fontSize: 16,
          color: c.text,
          backgroundColor: focused ? c.surface : c.soft,
          textAlignVertical: multiline ? 'top' : 'center',
          ...(multiline ? { minHeight: compact ? 52 : 120, maxHeight: compact ? 120 : 180 } : {}),
        }}
      />
      {!!hint && (
        <T muted size={12}>
          {hint}
        </T>
      )}
    </View>
  )
}
type SearchFieldProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  style?: StyleProp<ViewStyle>
}
export function SearchField({
  value,
  onChange,
  placeholder = 'Ad, ders veya açıklama',
  style,
}: SearchFieldProps) {
  const c = useColors()
  return (
    <View
      style={[
        {
          flexShrink: 0,
          minWidth: 0,
          minHeight: 50,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingLeft: 14,
          backgroundColor: c.soft,
          borderRadius: shape.field,
        },
        style,
      ]}
    >
      <Icon name="Search" size={19} />
      <TextInput
        accessibilityLabel="Listede ara"
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        returnKeyType="search"
        autoCorrect={false}
        style={{
          flex: 1,
          minWidth: 0,
          paddingVertical: 13,
          paddingRight: value ? 0 : 12,
          fontSize: 14,
          color: c.text,
        }}
      />
      {!!value && <IconButton name="X" label="Aramayı temizle" onPress={() => onChange('')} />}
    </View>
  )
}
type SheetProps = {
  visible: boolean
  title: ReactNode
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  compact?: boolean
}
export function Sheet({ visible, title, onClose, children, footer, compact = false }: SheetProps) {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const { reduceMotion } = useAppearance()
  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType={reduceMotion ? 'none' : 'fade'}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View
        style={{
          flex: 1,
          backgroundColor: c.scrim,
          justifyContent: 'flex-end',
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom,
        }}
      >
        <View
          style={{
            flex: compact ? undefined : 1,
            maxHeight: compact ? '85%' : undefined,
            backgroundColor: c.background,
            borderTopLeftRadius: shape.sheet,
            borderTopRightRadius: shape.sheet,
          }}
        >
          <View
            style={[
              styles.between,
              {
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderBottomWidth: 1,
                borderColor: c.border,
              },
            ]}
          >
            <T bold size={19} style={{ flex: 1, paddingLeft: 8 }}>
              {title}
            </T>
            <IconButton name="X" label="Pencereyi kapat" onPress={onClose} />
          </View>
          <View style={{ flex: compact ? undefined : 1, flexShrink: 1 }}>
            <FormScrollView
              style={compact ? { flexGrow: 0 } : undefined}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 20, gap: 24, paddingBottom: 24 }}
            >
              {children}
              {footer && (
                <View style={{ paddingTop: 16, borderTopWidth: 1, borderColor: c.border }}>
                  {footer}
                </View>
              )}
            </FormScrollView>
          </View>
        </View>
      </View>
    </Modal>
  )
}
export type SelectOption = { value: string; label: string }
type SelectProps = {
  label: string
  // Karşılaştırma için serbest tip; yalnızca seçeneklerin değeriyle eşleşirse seçili görünür.
  value: unknown
  options: readonly SelectOption[]
  onChange: (value: string) => void
  required?: boolean
}
export function Select({ label, value, options, onChange, required = false }: SelectProps) {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const { reduceMotion } = useAppearance()
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('')
  const visible = options.filter((o) =>
    o.label.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr')),
  )
  return (
    <View style={{ gap: 7 }}>
      <T bold size={14}>
        {label}
      </T>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${options.find((o) => o.value === value)?.label || 'Seçin'}`}
        onPress={() => {
          setQuery('')
          setOpen(true)
        }}
        style={[
          styles.between,
          {
            minHeight: 50,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: shape.field,
            padding: 13,
            backgroundColor: c.soft,
          },
        ]}
      >
        <T style={{ flex: 1 }}>{options.find((o) => o.value === value)?.label || 'Seçin'}</T>
        <Icon name="ChevronDown" size={18} />
      </Pressable>
      <Modal
        visible={open}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => setOpen(false)}
      >
        <KeyboardFrame style={{ flex: 1 }}>
          <View
            style={{
              flex: 1,
              backgroundColor: c.background,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
            }}
          >
            <View style={[styles.between, { padding: 12 }]}>
              <T bold size={18} style={{ flex: 1 }}>
                {label}
              </T>
              <IconButton name="X" label="Seçimi kapat" onPress={() => setOpen(false)} />
            </View>
            <View style={{ padding: 16 }}>
              <Field label="Seçeneklerde ara" value={query} onChange={setQuery} />
            </View>
            <FlatList
              keyboardShouldPersistTaps="handled"
              data={[...(!required ? [{ value: '', label: 'Seçimi temizle' }] : []), ...visible]}
              keyExtractor={(i) => String(i.value)}
              ListEmptyComponent={<Empty text="Bu seçim için uygun kayıt bulunmuyor." />}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onChange(item.value)
                    setOpen(false)
                  }}
                  style={[
                    styles.between,
                    {
                      paddingHorizontal: 20,
                      paddingVertical: 16,
                      minHeight: 52,
                      borderBottomWidth: 1,
                      borderColor: c.border,
                    },
                  ]}
                >
                  <T style={{ flex: 1 }}>{item.label}</T>
                  {value === item.value && <Icon name="Check" color={c.primary} />}
                </Pressable>
              )}
            />
          </View>
        </KeyboardFrame>
      </Modal>
    </View>
  )
}
type DateFieldProps = {
  label: string
  value?: string
  onChange: (value: string) => void
  time?: boolean
}
export function DateField({ label, value, onChange, time = false }: DateFieldProps) {
  const [open, setOpen] = useState(false)
  const date = time
    ? new Date(`2026-01-01T${value || '09:00'}:00`)
    : new Date(`${value || '2026-09-28'}T12:00:00`)
  return (
    <View style={{ gap: 7 }}>
      <T bold size={14}>
        {label}
      </T>
      {Platform.OS === 'web' ? (
        <Field
          label={`${label} (${time ? 'SS:DD' : 'YYYY-AA-GG'})`}
          value={value}
          onChange={onChange}
        />
      ) : (
        <Button icon={time ? 'Clock3' : 'CalendarDays'} onPress={() => setOpen(true)}>
          {value ? (time ? value : dateLabel(date, { year: 'numeric' })) : 'Tarih seçin'}
        </Button>
      )}
      {open && (
        <DateTimePicker
          value={Number.isNaN(+date) ? new Date() : date}
          mode={time ? 'time' : 'date'}
          is24Hour
          onChange={(event, selected) => {
            setOpen(false)
            if (event.type === 'set' && selected)
              onChange(
                time
                  ? `${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}`
                  : `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}`,
              )
          }}
        />
      )}
    </View>
  )
}
export function Loading() {
  const c = useColors()
  return (
    <SafeAreaView style={{ flex: 1, padding: 24, gap: 28 }}>
      <T bold size={28} style={{ color: c.primary }}>
        Kampüs
      </T>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Okulunuz hazırlanıyor"
        style={{ gap: 20, paddingTop: 20 }}
      >
        <T muted>Okulunuz hazırlanıyor…</T>
        {[75, 52, 88, 64].map((width) => (
          <View
            key={width}
            style={{ width: `${width}%`, height: 18, borderRadius: 5, backgroundColor: c.soft }}
          />
        ))}
      </View>
    </SafeAreaView>
  )
}
export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  page: { padding: spaces.page, paddingBottom: 40, gap: 18 },
  stack: { gap: 14 },
})
