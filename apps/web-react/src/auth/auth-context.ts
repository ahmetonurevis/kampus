import { createContext } from 'react'
import type { AuthPort } from './auth-port.ts'

/** Giriş/çıkış işlemlerine ek olarak bilinçli çıkışın sürüp sürmediğini bildirir. */
export interface AuthContextValue extends AuthPort {
  /** Kullanıcının başlattığı çıkış sürüyor ya da oturum az önce onunla kapandı. */
  isSigningOut(): boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)
