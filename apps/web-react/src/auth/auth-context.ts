import { createContext } from 'react'
import type { AuthPort } from './auth-port.ts'

export const AuthContext = createContext<AuthPort | null>(null)
