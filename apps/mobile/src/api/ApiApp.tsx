// API modunun kökü (`EXPO_PUBLIC_API_URL` verildiğinde `AppRoot` tembel yükler). Demo
// kalıcılığı (AsyncStorage snapshot'ı) bu modda hiç açılmaz.
import { useCallback, useState, type ReactNode } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { StatusBar } from 'expo-status-bar'
import { KampusProvider } from '@kampus/react-shared/KampusProvider.tsx'
import type { ApiStackParamList } from '../route-types.ts'
import { AppearanceContext, useAppearance } from '../ui/appearance.ts'
import { Button, Loading, T, useColors } from '../ui/components.tsx'
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx'
import { ApiHeader } from './ApiHeader.tsx'
import { ApiAuthProvider, useApiAuth } from './auth.tsx'
import { createApiClients } from './clients.ts'
import Announcements from './screens/Announcements.tsx'
import ApiCategory from './screens/ApiCategory.tsx'
import ApiHome from './screens/ApiHome.tsx'
import ApiLogin from './screens/ApiLogin.tsx'
import Conversation from './screens/Conversation.tsx'
import Messages from './screens/Messages.tsx'
import ParentGrades from './screens/ParentGrades.tsx'
import TeacherClasses from './screens/TeacherClasses.tsx'
import { sessionScopeKey, type MobileSession } from './session-state.ts'
import { ToastProvider, useNotify } from './toast.tsx'
import { useApiAppearance } from './use-api-appearance.ts'
import { ViewMemoryProvider } from './view-memory.tsx'

const Stack = createNativeStackNavigator<ApiStackParamList>()

function SignedIn({ session }: { session: MobileSession }) {
  const c = useColors()
  const { resolvedTheme, reduceMotion } = useAppearance()
  const { width } = useWindowDimensions()
  const base = resolvedTheme === 'dark' ? DarkTheme : DefaultTheme
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      background: c.background,
      card: c.surface,
      text: c.text,
      border: c.border,
      primary: c.primary,
    },
  }
  return (
    <View
      style={{
        flex: 1,
        width: '100%',
        maxWidth: width >= 900 ? 900 : undefined,
        alignSelf: 'center',
      }}
    >
      <NavigationContainer theme={theme}>
        <Stack.Navigator
          screenOptions={{
            header: (props) => <ApiHeader {...props} />,
            contentStyle: { backgroundColor: c.background },
            animation: reduceMotion ? 'none' : 'fade',
            gestureEnabled: true,
            freezeOnBlur: true,
          }}
        >
          {/* Kurum veya rol değişince yığın baştan kurulur; eski kurumun ekranı kalmaz. */}
          <Stack.Group navigationKey={sessionScopeKey(session)}>
            <Stack.Screen name="ApiHome" component={ApiHome} />
            <Stack.Screen name="ApiCategory" component={ApiCategory} />
            <Stack.Screen name="TeacherClasses" component={TeacherClasses} />
            <Stack.Screen name="ParentGrades" component={ParentGrades} />
            <Stack.Screen name="Announcements" component={Announcements} />
            <Stack.Screen name="Messages" component={Messages} />
            <Stack.Screen name="ApiConversation" component={Conversation} />
          </Stack.Group>
        </Stack.Navigator>
      </NavigationContainer>
    </View>
  )
}

function StatusScreen({
  title,
  text,
  children,
}: {
  title: string
  text: string
  children?: ReactNode
}) {
  return (
    <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 18 }}>
      <T bold size={22}>
        {title}
      </T>
      <T>{text}</T>
      {children}
    </SafeAreaView>
  )
}

function Gate() {
  const { state, retry, signOut } = useApiAuth()
  switch (state.status) {
    case 'loading':
      return <Loading />
    case 'signed-out':
      return <ApiLogin />
    case 'no-membership':
      return (
        <StatusScreen
          title="Kurum üyeliği bulunamadı"
          text="Hesabın şu an hiçbir kuruma bağlı değil. Okul yönetimine başvur."
        >
          <Button onPress={() => void signOut()}>Oturumu kapat</Button>
        </StatusScreen>
      )
    case 'error':
      return (
        <StatusScreen title="Hesap bilgileri alınamadı" text={state.message}>
          <Button primary onPress={retry}>
            Yeniden dene
          </Button>
          <Button onPress={() => void signOut()}>Oturumu kapat</Button>
        </StatusScreen>
      )
    case 'signed-in':
      return (
        // Oturum veya kurum değişince bellekteki görünüm durumu (seçili çocuk, liste) silinir.
        <ViewMemoryProvider key={sessionScopeKey(state.session)}>
          <SignedIn session={state.session} />
        </ViewMemoryProvider>
      )
    default:
      return state satisfies never
  }
}

function Shell({ clients }: { clients: ReturnType<typeof createApiClients> }) {
  const c = useColors()
  const notify = useNotify()
  const { resolvedTheme } = useAppearance()
  // Sabit kimlik: sağlayıcı her çizimde hata dinleyicisini yeniden kurmasın.
  const notifyError = useCallback((message: string) => notify(message, 'error'), [notify])
  return (
    <KampusProvider
      client={clients.apiClient}
      auth={clients.authClient}
      queryClient={clients.queryClient}
      notifyError={notifyError}
    >
      <ApiAuthProvider authClient={clients.authClient}>
        <View style={{ flex: 1, backgroundColor: c.background }}>
          <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
          <Gate />
        </View>
      </ApiAuthProvider>
    </KampusProvider>
  )
}

export default function ApiApp({ url }: { url: string }) {
  // İstemciler uygulama ömrü boyunca bir kez kurulur (oturum deposu ve önbellek tek).
  const [clients] = useState(() => createApiClients(url))
  const appearance = useApiAppearance()
  return (
    <AppearanceContext.Provider value={appearance}>
      <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
        <ErrorBoundary>
          <ToastProvider>
            <Shell clients={clients} />
          </ToastProvider>
        </ErrorBoundary>
      </SafeAreaView>
    </AppearanceContext.Provider>
  )
}
