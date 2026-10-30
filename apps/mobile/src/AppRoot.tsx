import { Component, useState, type ReactNode } from 'react'
import { View, ScrollView, Pressable, useWindowDimensions } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { NavigationContainer, DefaultTheme, DarkTheme, type Route } from '@react-navigation/native'
import {
  createNativeStackNavigator,
  type NativeStackHeaderProps,
} from '@react-navigation/native-stack'
import { StatusBar } from 'expo-status-bar'
import type { Role } from '@kampus/school-core/modules/navigation.ts'
import { SchoolProvider, useSchool, useActiveSchool, recordError } from './store/SchoolProvider.tsx'
import { roles, availablePages } from './model/school.ts'
import { moduleNavigationState } from './model/navigation.ts'
import { accountPages, categoryLabel, pageTitle } from './model/hub.ts'
import type { RootStackParamList } from './route-types.ts'
import { KeyboardScope } from './ui/KeyboardLayout.tsx'
import { toIconName } from './ui/icons.ts'
import {
  Avatar,
  Button,
  Card,
  Icon,
  IconButton,
  Loading,
  Sheet,
  T,
  styles,
  useColors,
} from './ui/components.tsx'
import { ThemePreference } from './ui/SchoolLayout.tsx'
import Home from './screens/Home.tsx'
import ModuleScreen from './screens/ModuleScreen.jsx'
import CategoryScreen from './screens/CategoryScreen.tsx'
import Detail from './screens/Detail.tsx'
import Quiz from './screens/Quiz.tsx'
import Video from './screens/Video.tsx'

const Stack = createNativeStackNavigator<RootStackParamList>()
function RoleChoices({ onSelect }: { onSelect: (role: Role) => void }) {
  const { session } = useSchool(),
    c = useColors()
  const order: Role[] = ['ogrenci', 'veli', 'ogretmen', 'yonetici', 'onburo']
  const descriptions: Record<Role, string> = {
    ogrenci: 'Derslerim ve öğrenme yolculuğum',
    veli: 'Çocuğumun okul hayatı',
    ogretmen: 'Sınıflarım ve günlük planım',
    yonetici: 'Okulum ve yönetim süreçleri',
    onburo: 'Görüşmeler ve öğrenci kayıtları',
  }
  return (
    <View style={{ gap: 10 }}>
      {order.map((key) => {
        const role = roles[key],
          selected = session.role === key
        return (
          <Card
            soft
            key={key}
            onPress={() => onSelect(key)}
            label={`${role.label} olarak devam et`}
            style={{ padding: 15, backgroundColor: selected ? c.primarySoft : c.soft }}
          >
            <View style={[styles.row, { gap: 14 }]}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 15,
                  backgroundColor: c.surface,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Icon name={toIconName(role.icon)} color={c.primary} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <T bold size={15}>
                  {role.label}
                </T>
                <T muted size={12}>
                  {session.role ? role.name : descriptions[key]}
                </T>
              </View>
              <Icon
                name={selected ? 'Check' : 'ArrowUpRight'}
                size={18}
                color={selected ? c.primary : c.muted}
              />
            </View>
          </Card>
        )
      })}
    </View>
  )
}
function Login() {
  const { preference } = useSchool(),
    c = useColors()
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.page,
          { paddingTop: 26, gap: 24, maxWidth: 600, width: '100%', alignSelf: 'center' },
        ]}
      >
        <View style={styles.between}>
          <View style={[styles.row, { gap: 8 }]}>
            <Icon name="GraduationCap" color={c.primary} size={29} />
            <T bold size={27} style={{ letterSpacing: -1 }}>
              kampüs
              <T size={27} style={{ color: c.accent }}>
                .
              </T>
            </T>
          </View>
          <T muted size={12}>
            Okul hayatı, bir arada.
          </T>
        </View>
        <View style={{ backgroundColor: c.hero, borderRadius: 28, padding: 24, gap: 12 }}>
          <View style={styles.between}>
            <T size={12} bold style={{ color: c.heroMuted }}>
              KAMPÜS'E HOŞ GELDİN
            </T>
            <Icon name="School" color={c.heroMuted} size={23} />
          </View>
          <T bold size={30} style={{ color: c.heroText, letterSpacing: -0.8 }}>
            Birlikte öğren.{'\n'}Birlikte büyü.
          </T>
          <T size={14} style={{ color: c.heroMuted }}>
            Dersler, gelişim ve okuldan haberler. İhtiyacın olan her şey yanında.
          </T>
        </View>
        <View style={{ gap: 14 }}>
          <T bold size={18}>
            Sana ait alanı seç
          </T>
          <RoleChoices onSelect={(role) => preference({ role })} />
        </View>
        <View style={[styles.row, { alignItems: 'flex-start', justifyContent: 'center' }]}>
          <Icon name="ShieldCheck" size={16} />
          <T muted size={12} style={{ flex: 1 }}>
            Örnek okul verileriyle keşfet. İşlemlerin bu cihazda saklanır; internet olmadan da
            kullanabilirsin.
          </T>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
// TODO(ts): başlık özelliği rotayı parametresiz (ParamListBase) verir; ad eşleşince parametre tipi kök listeden gelir.
function isScreen<Name extends keyof RootStackParamList>(
  route: Route<string>,
  name: Name,
): route is Route<Name, RootStackParamList[Name]> {
  return route.name === name
}
const screenTitles: Partial<Record<string, string>> = { Video: 'Ders videosu', Quiz: 'Quiz' }
function Header({ navigation, route, back }: NativeStackHeaderProps) {
  const { data, session, preference } = useActiveSchool(),
    c = useColors()
  const [roleMenu, setRoleMenu] = useState(false),
    { fontScale } = useWindowDimensions()
  const pages = availablePages(data, session.role)
  const isHome = route.name === 'Home'
  const currentPage = isScreen(route, 'Module') ? route.params?.page : undefined
  const currentRow = isScreen(route, 'Detail') ? route.params?.row : undefined
  const foundPage = pages.find((p) => p.path === currentPage)
  const title = isHome
    ? 'Kampüs'
    : isScreen(route, 'Category')
      ? categoryLabel(route.params.category)
      : isScreen(route, 'Detail')
        ? currentRow?.kind === 'homework' && session.role === 'ogrenci'
          ? 'Ödev detayı'
          : currentRow?.kind === 'question' && session.role === 'ogretmen'
            ? 'Soruyu yanıtla'
            : currentRow?.kind === 'conversation'
              ? currentRow.title
              : 'Ayrıntılar'
        : (foundPage ? pageTitle(session.role, foundPage) : undefined) ||
          screenTitles[route.name] ||
          (currentPage === 'mesajlar' ? 'Mesajlar' : '') ||
          'Kampüs'
  function navigate(page: string) {
    if (page === currentPage || (page === 'dashboard' && isHome)) return
    navigation.reset(moduleNavigationState(navigation.getState(), page))
  }
  return (
    <>
      <SafeAreaView edges={['top']} style={{ backgroundColor: c.hero }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          {isHome ? (
            <View style={[styles.row, { flex: 1, gap: 8, paddingLeft: 10, minHeight: 48 }]}>
              <Icon name="GraduationCap" color={c.heroText} size={26} />
              <T bold size={22} style={{ color: c.heroText, letterSpacing: -0.8 }}>
                kampüs
                <T bold size={22} style={{ color: c.accent }}>
                  .
                </T>
              </T>
            </View>
          ) : (
            <>
              <IconButton
                name="ChevronLeft"
                label="Geri"
                color={c.heroText}
                onPress={() => (back ? navigation.goBack() : navigate('dashboard'))}
              />
              <T bold size={19} numberOfLines={1} style={{ flex: 1, color: c.heroText }}>
                {title}
              </T>
              <IconButton
                name="LayoutGrid"
                label="Modüller"
                color={c.heroText}
                onPress={() => navigate('dashboard')}
              />
            </>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Hesap: ${roles[session.role].name}`}
            onPress={() => setRoleMenu(true)}
            style={{
              minHeight: 48,
              minWidth: 48,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {isHome && fontScale <= 1.3 && (
              <T bold size={13} numberOfLines={1} style={{ color: c.heroText, maxWidth: 130 }}>
                {roles[session.role].name}
              </T>
            )}
            <Avatar name={roles[session.role].name} size={34} />
          </Pressable>
        </View>
      </SafeAreaView>
      {roleMenu && (
        <Sheet visible title="Hesap ve görünüm" onClose={() => setRoleMenu(false)}>
          <View style={{ gap: 5 }}>
            <T bold size={20}>
              {roles[session.role].name}
            </T>
            <T muted>{roles[session.role].subtitle}</T>
          </View>
          <ThemePreference />
          {accountPages(data, session.role).map((page) => (
            <Button
              key={page.path}
              icon={toIconName(page.icon)}
              onPress={() => {
                setRoleMenu(false)
                navigate(page.path)
              }}
            >
              {page.title}
            </Button>
          ))}
          {session.role === 'veli' && (
            <Button
              onPress={() => {
                setRoleMenu(false)
                navigate('cocuk-secici')
              }}
            >
              Çocuk değiştir
            </Button>
          )}
          <T bold>Rol değiştir</T>
          <RoleChoices
            onSelect={(role) => {
              setRoleMenu(false)
              preference({ role })
            }}
          />
          <Button onPress={() => preference({ role: '' })}>Oturumu kapat</Button>
        </Sheet>
      )}
    </>
  )
}
function Application() {
  const { data, session, resolvedTheme, error, load, reset, toast, setToast, reduceMotion } =
      useSchool(),
    c = useColors(),
    { width } = useWindowDimensions(),
    [confirmReset, setConfirmReset] = useState(false)
  const theme = {
    ...(resolvedTheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(resolvedTheme === 'dark' ? DarkTheme : DefaultTheme).colors,
      background: c.background,
      card: c.surface,
      text: c.text,
      border: c.border,
      primary: c.primary,
    },
  }
  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: c.background }}>
      <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
      {error ? (
        <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 18 }}>
          <T bold size={22}>
            Veriler açılamadı
          </T>
          <T>{error}</T>
          <Button primary onPress={load}>
            Yeniden dene
          </Button>
          {confirmReset ? (
            <>
              <T>Yerel değişiklikler sıfırlanacak. Devam edilsin mi?</T>
              <Button danger onPress={reset}>
                Evet, sıfırla
              </Button>
            </>
          ) : (
            <Button onPress={() => setConfirmReset(true)}>Demoyu sıfırla</Button>
          )}
        </SafeAreaView>
      ) : !data ? (
        <Loading />
      ) : !session.role ? (
        <Login />
      ) : (
        <View
          style={{
            flex: 1,
            width: '100%',
            maxWidth: width >= 900 ? 900 : undefined,
            alignSelf: 'center',
          }}
        >
          <NavigationContainer
            theme={theme}
            onStateChange={() => setToast(null)}
            linking={{
              prefixes: ['kampus://'],
              config: {
                screens: { Home: '', Category: 'kategori/:category', Module: 'sayfa/:page' },
              },
            }}
          >
            <Stack.Navigator
              screenOptions={{
                header: (props) => <Header {...props} />,
                contentStyle: { backgroundColor: c.background },
                animation: reduceMotion ? 'none' : 'fade',
                gestureEnabled: true,
                freezeOnBlur: true,
              }}
            >
              <Stack.Group navigationKey={session.role}>
                <Stack.Screen name="Home" component={Home} />
                <Stack.Screen name="Category" component={CategoryScreen} />
                <Stack.Screen name="Module" component={ModuleScreen} />
                <Stack.Screen name="Detail" component={Detail} />
                <Stack.Screen name="Quiz" component={Quiz} />
                <Stack.Screen name="Video" component={Video} />
              </Stack.Group>
            </Stack.Navigator>
          </NavigationContainer>
        </View>
      )}
      {toast && (
        <SafeAreaView
          edges={['bottom']}
          pointerEvents="box-none"
          style={{ paddingHorizontal: 14, paddingVertical: 10 }}
        >
          <Pressable
            accessibilityRole="alert"
            onPress={() => setToast(null)}
            style={{
              backgroundColor: toast.type === 'error' ? c.redSoft : c.primarySoft,
              padding: 16,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: c.border,
            }}
          >
            <T style={{ color: toast.type === 'error' ? c.red : c.text }}>{toast.message}</T>
          </Pressable>
        </SafeAreaView>
      )}
    </SafeAreaView>
  )
}
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
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
export default function App() {
  return (
    <SafeAreaProvider>
      <KeyboardScope>
        <SchoolProvider>
          <ErrorBoundary>
            <Application />
          </ErrorBoundary>
        </SchoolProvider>
      </KeyboardScope>
    </SafeAreaProvider>
  )
}
