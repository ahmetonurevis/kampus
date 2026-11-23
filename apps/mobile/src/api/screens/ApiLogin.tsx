import { useRef, useState } from 'react'
import { View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button, Field, Icon, T, styles, useColors } from '../../ui/components.tsx'
import { FormScrollView } from '../../ui/KeyboardLayout.tsx'
import { Notice } from '../../ui/SchoolLayout.tsx'
import { SESSION_EXPIRED_MESSAGE, useApiAuth } from '../auth.tsx'
import { loginIssues, type LoginField } from '../sign-in.ts'

/** API modunun girişi: e-posta + parola (Better Auth). Hesabı kurum açar; kayıt yoktur. */
export default function ApiLogin() {
  const { signIn, expired } = useApiAuth()
  const c = useColors()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<LoginField, string>>>({})
  const [formError, setFormError] = useState('')
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)

  async function submit() {
    // Çift dokunuşta ikinci istek gitmez.
    if (submitting.current) return
    const issues = loginIssues({ email, password })
    setFormError('')
    setFieldErrors(issues ?? {})
    if (issues) return
    submitting.current = true
    setPending(true)
    try {
      const result = await signIn({ email, password })
      if (result.ok) return
      if (result.field) setFieldErrors({ [result.field]: result.message })
      else setFormError(result.message)
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <FormScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.page,
          { paddingTop: 26, gap: 24, maxWidth: 600, width: '100%', alignSelf: 'center' },
        ]}
      >
        <View style={[styles.row, { gap: 8, flexWrap: 'wrap' }]}>
          <Icon name="GraduationCap" color={c.primary} size={29} />
          <T bold size={27} style={{ letterSpacing: -1 }}>
            kampüs
            <T size={27} style={{ color: c.accent }}>
              .
            </T>
          </T>
        </View>
        <View style={{ backgroundColor: c.hero, borderRadius: 28, padding: 24, gap: 10 }}>
          <T bold size={26} style={{ color: c.heroText, letterSpacing: -0.6 }}>
            Hesabına giriş yap
          </T>
          <T size={14} style={{ color: c.heroMuted }}>
            Okulunun sana verdiği e-posta adresi ve parolayla giriş yapabilirsin.
          </T>
        </View>
        {expired && <Notice title={SESSION_EXPIRED_MESSAGE} tone="amber" />}
        {!!formError && <Notice title={formError} tone="red" />}
        <View style={{ gap: 18 }}>
          <Field
            label="E-posta"
            value={email}
            onChange={setEmail}
            keyboard="email-address"
            autoComplete="email"
            editable={!pending}
            maxLength={254}
            {...(fieldErrors.email ? { error: fieldErrors.email } : {})}
          />
          <Field
            label="Parola"
            value={password}
            onChange={setPassword}
            secure
            autoComplete="current-password"
            editable={!pending}
            maxLength={128}
            onSubmit={() => void submit()}
            {...(fieldErrors.password ? { error: fieldErrors.password } : {})}
          />
          <Button primary disabled={pending} onPress={() => void submit()}>
            {pending ? 'Giriş yapılıyor…' : 'Giriş yap'}
          </Button>
        </View>
        <View style={[styles.row, { alignItems: 'flex-start' }]}>
          <Icon name="ShieldCheck" size={16} />
          <T muted size={12} style={{ flex: 1 }}>
            Oturum bilgin yalnızca bu cihazın güvenli deposunda tutulur. Parolanı unuttuysan okul
            yönetimine başvur.
          </T>
        </View>
      </FormScrollView>
    </SafeAreaView>
  )
}
