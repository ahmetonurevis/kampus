// Ekran kaydındaki menü ekranının yığın bileşeni: bileşen ilk açılışta yüklenir, yükleme ya da çizim
// hatası yalnız bu ekranı düşürür. Başlık (`ApiHeader`) ve kabuk ayakta kalır; kullanıcı Türkçe
// "Ekran açılamadı" ile "Yeniden dene" ve "Geri dön" görür, ayrıntı yapılandırılmış loga gider.
import type { ComponentType } from 'react'
import type { ApiScreenProps } from '../route-types.ts'
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx'
import { loadScreenComponent, type ApiScreen } from './pages.ts'
import type { ScreenEntry } from './screen-registry.ts'

type MenuScreenProps = ApiScreenProps<ApiScreen>

function LoadedScreen({ entry, props }: { entry: ScreenEntry; props: MenuScreenProps }) {
  // Kayıt parametresiz ekran tutar; prop tipi ekran adına göre daraltılamadığı için genişletilir.
  const Screen = loadScreenComponent(entry) as ComponentType<MenuScreenProps>
  return <Screen {...props} />
}

/** Kayıt başına bir kez kurulur (sabit kimlik: yığın ekranı yeniden bağlanmaz). */
export function registeredScreen(entry: ScreenEntry): ComponentType<MenuScreenProps> {
  function RegisteredScreen(props: MenuScreenProps) {
    const { navigation } = props
    const back = () => {
      if (navigation.canGoBack()) navigation.goBack()
      else navigation.navigate('ApiHome')
    }
    return (
      <ErrorBoundary context={`screen:${entry.screen}`} onBack={back}>
        <LoadedScreen entry={entry} props={props} />
      </ErrorBoundary>
    )
  }
  RegisteredScreen.displayName = `Registered(${entry.screen})`
  return RegisteredScreen
}
