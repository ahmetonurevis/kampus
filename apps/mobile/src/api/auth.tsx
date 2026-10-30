import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SignInResult } from '@kampus/react-shared/sign-in-errors.ts'
import { clearSessionData } from '@kampus/react-shared/query-client.ts'
import { useMe } from '@kampus/react-shared/use-active-institution.ts'
import { useSession } from '@kampus/react-shared/use-session.ts'
import { recordError } from '../store/SchoolProvider.tsx'
import type { ApiAuthClient } from './clients.ts'
import {
  apiAuthState,
  sessionExpired,
  type ApiAuthState,
  type SettledStatus,
} from './session-state.ts'
import { signInWithEmail, type LoginInput } from './sign-in.ts'

export const SESSION_EXPIRED_MESSAGE = 'Oturumunuzun süresi doldu. Yeniden giriş yapın.'

type ApiAuthValue = {
  state: ApiAuthState
  /** Oturum kullanıcı çıkış yapmadan kapandı; giriş ekranı bildirir. */
  expired: boolean
  signIn: (input: LoginInput) => Promise<SignInResult>
  signOut: () => Promise<void>
  /** `/me` okunamadıysa yeniden dener. */
  retry: () => void
}

const ApiAuthContext = createContext<ApiAuthValue | null>(null)

/** `KampusProvider` içinde: oturum durumu Better Auth ve `/me` sorgusundan okunur. */
export function ApiAuthProvider({
  authClient,
  children,
}: {
  authClient: ApiAuthClient
  children: ReactNode
}) {
  const queryClient = useQueryClient()
  const { status } = useSession()
  const me = useMe()
  const state = apiAuthState(status, { data: me.data, error: me.error })
  // Kullanıcının kendi çıkışı süre dolması sayılmaz.
  const intentional = useRef(false)
  const previous = useRef<SettledStatus | null>(null)
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    if (state.status === 'loading') return
    // Dış sistemle (oturum deposu) eşitleme: kapanış ancak durum değişince bilinir.
    if (sessionExpired(previous.current, state.status, intentional.current)) setExpired(true)
    // Giriş ekranına her düşüşte (401 dahil) önceki kullanıcının verisi silinir: Better Auth
    // durumu `authenticated` kalsa bile sonraki girişe sızmaz.
    if (previous.current === 'signed-in' && state.status === 'signed-out') {
      void clearSessionData(queryClient)
    }
    if (state.status === 'signed-in') setExpired(false)
    if (state.status === 'signed-out') intentional.current = false
    previous.current = state.status
  }, [state.status, queryClient])

  const { refetch } = me
  const value = useMemo<ApiAuthValue>(
    () => ({
      state,
      expired,
      signIn: (input) =>
        signInWithEmail(authClient, input, (error) => recordError(error, 'sign-in')),
      async signOut() {
        intentional.current = true
        // Expo eklentisi isteği göndermeden önce güvenli depodaki çerezi siler; istek
        // başarısız olsa da cihazda oturum kalmaz. Sunucu oturumu süresiyle kapanır.
        try {
          const { error } = await authClient.signOut()
          if (error) recordError(`sign-out ${error.status}`, 'sign-out', 'warn')
        } catch (error) {
          recordError(error, 'sign-out', 'warn')
        }
      },
      retry: () => {
        void refetch()
      },
    }),
    [state, expired, authClient, refetch],
  )
  return <ApiAuthContext.Provider value={value}>{children}</ApiAuthContext.Provider>
}

export function useApiAuth(): ApiAuthValue {
  const value = useContext(ApiAuthContext)
  if (!value) throw new Error('Oturum yalnızca API uygulaması içinde kullanılabilir.')
  return value
}

/** Giriş yapılmış ekranlar için: oturum dolu gelir. */
export function useApiSession() {
  const { state } = useApiAuth()
  if (state.status !== 'signed-in') throw new Error('Bu ekran için oturum açılmalıdır.')
  return state.session
}
