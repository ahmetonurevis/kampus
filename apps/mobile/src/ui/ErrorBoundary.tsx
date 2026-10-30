import { Component, type ReactNode } from 'react'
import { View } from 'react-native'
import { recordError } from '../store/SchoolProvider.tsx'
import { Button, T } from './components.tsx'

// Çizim hatası uygulamayı kapatmaz; ayrıntı yalnız yerel loga yazılır.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(error: unknown) {
    recordError(error, 'render')
  }
  override render() {
    return this.state.failed ? (
      <View style={{ flex: 1, padding: 28, justifyContent: 'center', gap: 18 }}>
        <T bold size={22}>
          Ekran açılamadı
        </T>
        <T>Kayıtlı verileriniz korunuyor. Ekranı yeniden açabilirsiniz.</T>
        <Button onPress={() => this.setState({ failed: false })}>Yeniden dene</Button>
      </View>
    ) : (
      this.props.children
    )
  }
}
