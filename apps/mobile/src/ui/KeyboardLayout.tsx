import type { ReactNode, RefObject } from 'react'
import { Platform, ScrollView, View, type ScrollViewProps, type ViewProps } from 'react-native'
import {
  KeyboardAwareScrollView,
  KeyboardProvider,
  KeyboardAvoidingView,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller'

// Tek sağlayıcı uygulama ve native modal pencerelerinin klavye olaylarını birlikte izler.
export function KeyboardScope({ children }: { children: ReactNode }) {
  return Platform.OS === 'web' ? (
    children
  ) : (
    <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
      {children}
    </KeyboardProvider>
  )
}
// Ref tipi native bileşenin tipidir; web'de düz ScrollView'a bağlanır ve yalnız ortak ScrollView yöntemleri çağrılmalıdır.
type FormScrollViewProps = ScrollViewProps & { ref?: RefObject<KeyboardAwareScrollViewRef | null> }
export function FormScrollView({ ref, ...props }: FormScrollViewProps) {
  if (Platform.OS === 'web')
    return <ScrollView ref={ref} keyboardShouldPersistTaps="handled" {...props} />
  return (
    <KeyboardAwareScrollView
      ref={ref}
      mode="layout"
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      {...props}
    />
  )
}

export function KeyboardFrame({ children, ...props }: ViewProps) {
  if (Platform.OS === 'web') return <View {...props}>{children}</View>
  return (
    <KeyboardAvoidingView behavior="padding" automaticOffset {...props}>
      {children}
    </KeyboardAvoidingView>
  )
}
