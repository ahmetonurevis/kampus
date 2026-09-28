import React from 'react'
import { Platform, ScrollView, View } from 'react-native'
import {
  KeyboardAwareScrollView,
  KeyboardProvider,
  KeyboardAvoidingView,
} from 'react-native-keyboard-controller'

// Tek sağlayıcı uygulama ve native modal pencerelerinin klavye olaylarını birlikte izler.
export function KeyboardScope({ children }) {
  return Platform.OS === 'web' ? (
    children
  ) : (
    <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
      {children}
    </KeyboardProvider>
  )
}
export function FormScrollView({ ref, ...props }) {
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

export function KeyboardFrame({ children, ...props }) {
  if (Platform.OS === 'web') return <View {...props}>{children}</View>
  return (
    <KeyboardAvoidingView behavior="padding" automaticOffset {...props}>
      {children}
    </KeyboardAvoidingView>
  )
}
