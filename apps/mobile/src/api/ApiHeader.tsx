import { useState } from 'react'
import { Pressable, View, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackHeaderProps } from '@react-navigation/native-stack'
import { useActiveInstitution } from '@kampus/react-shared/use-active-institution.ts'
import { roles } from '@kampus/school-core/modules/navigation.ts'
import { categoryLabel } from '../model/hub.ts'
import { Avatar, Button, Icon, IconButton, Sheet, T, styles, useColors } from '../ui/components.tsx'
import { ThemePreference } from '../ui/SchoolLayout.tsx'
import { useApiAuth, useApiSession } from './auth.tsx'
import { apiPages } from './pages.ts'
import { institutionChoices, type MobileSession } from './session-state.ts'
import { useNotify } from './toast.tsx'

function routeTitle(session: MobileSession, name: string, params: unknown): string {
  if (name === 'ApiCategory' && typeof params === 'object' && params !== null) {
    const category: unknown = Reflect.get(params, 'category')
    if (typeof category === 'string') return categoryLabel(category)
  }
  return apiPages(session).find((page) => page.screen === name)?.title ?? 'Kampüs'
}

/** Safir üst başlık: geri, başlık, "Modüller" ve sağ üstte isim/avatar hesap menüsü. */
export function ApiHeader({ navigation, route, back }: NativeStackHeaderProps) {
  const session = useApiSession()
  const c = useColors()
  const { fontScale } = useWindowDimensions()
  const [menu, setMenu] = useState(false)
  const isHome = route.name === 'ApiHome'
  const name = session.user.name
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
                onPress={() => (back ? navigation.goBack() : navigation.navigate('ApiHome'))}
              />
              <T bold size={19} numberOfLines={1} style={{ flex: 1, color: c.heroText }}>
                {routeTitle(session, route.name, route.params)}
              </T>
              <IconButton
                name="LayoutGrid"
                label="Modüller"
                color={c.heroText}
                onPress={() => navigation.popTo('ApiHome')}
              />
            </>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Hesap: ${name}`}
            onPress={() => setMenu(true)}
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
                {name}
              </T>
            )}
            <Avatar name={name} size={34} />
          </Pressable>
        </View>
      </SafeAreaView>
      {menu && <AccountSheet session={session} onClose={() => setMenu(false)} />}
    </>
  )
}

function AccountSheet({ session, onClose }: { session: MobileSession; onClose: () => void }) {
  const c = useColors()
  const notify = useNotify()
  const { signOut } = useApiAuth()
  const { switchInstitution } = useActiveInstitution()
  const [signingOut, setSigningOut] = useState(false)
  const busy = switchInstitution.isPending || signingOut
  const choices = institutionChoices(session)

  async function choose(institutionId: string) {
    if (busy) return
    try {
      await switchInstitution.mutateAsync(institutionId)
      onClose()
    } catch (error) {
      // `ApiError` mesajı Türkçedir ("Kurum değiştirilemedi…"); ayrıntı loga yazılmıştır.
      notify(error instanceof Error ? error.message : 'Kurum değiştirilemedi.', 'error')
    }
  }

  return (
    <Sheet visible title="Hesap ve görünüm" onClose={() => !busy && onClose()}>
      <View style={{ gap: 5 }}>
        <T bold size={20}>
          {session.user.name}
        </T>
        <T muted>
          {roles[session.role].label} · {session.institution.name}
        </T>
      </View>
      <ThemePreference />
      {choices.length > 1 && (
        <View accessibilityRole="radiogroup" accessibilityLabel="Kurum" style={{ gap: 4 }}>
          <T bold>Kurum değiştir</T>
          {choices.map((choice) => (
            <Pressable
              key={choice.id}
              accessibilityRole="radio"
              accessibilityLabel={`${choice.institutionName}, ${roles[choice.role].label}`}
              accessibilityState={{ checked: choice.active, disabled: busy }}
              aria-checked={choice.active}
              disabled={busy || choice.active}
              onPress={() => void choose(choice.institutionId)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                minHeight: 64,
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderColor: c.border,
              }}
            >
              <Icon name="Building2" color={c.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <T bold size={16}>
                  {choice.institutionName}
                </T>
                <T muted size={13}>
                  {roles[choice.role].label}
                  {choice.active ? ' · Etkin' : ''}
                </T>
              </View>
              <Icon name={choice.active ? 'Check' : 'Circle'} color={c.primary} />
            </Pressable>
          ))}
          {switchInstitution.isPending && (
            <T muted size={13} accessibilityLiveRegion="polite">
              Kurum değiştiriliyor…
            </T>
          )}
        </View>
      )}
      <Button
        icon="LogOut"
        danger
        disabled={busy}
        onPress={async () => {
          setSigningOut(true)
          await signOut()
        }}
      >
        {signingOut ? 'Çıkış yapılıyor…' : 'Oturumu kapat'}
      </Button>
    </Sheet>
  )
}
