import { Component, type ReactNode } from 'react'
import { View } from 'react-native'
import { recordError } from '../lib/error-log.ts'
import { Button, T } from './components.tsx'

type ErrorBoundaryProps = {
  children: ReactNode
  /** Yapılandırılmış logdaki bağlam (ör. `screen:ParentGrades`); varsayılan `render`. */
  context?: string
  /** Verilirse "Geri dön" düğmesi görünür (ekran düzeyi sınır: kabuk ayakta kalır). */
  onBack?: () => void
}

// Çizim hatası uygulamayı kapatmaz; ayrıntı yalnız yerel loga yazılır, kullanıcı Türkçe ve teknik
// ayrıntısız mesaj görür.
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(error: unknown) {
    recordError(error, this.props.context ?? 'render')
  }
  override render() {
    const { onBack } = this.props
    return this.state.failed ? (
      <View style={{ flex: 1, padding: 28, justifyContent: 'center', gap: 18 }}>
        <T bold size={22}>
          Ekran açılamadı
        </T>
        <T>Kayıtlı verileriniz korunuyor. Ekranı yeniden açabilirsiniz.</T>
        <Button primary={Boolean(onBack)} onPress={() => this.setState({ failed: false })}>
          Yeniden dene
        </Button>
        {onBack ? <Button onPress={onBack}>Geri dön</Button> : null}
      </View>
    ) : (
      this.props.children
    )
  }
}
