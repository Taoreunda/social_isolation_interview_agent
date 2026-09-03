import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { LoaderCircle } from 'lucide-react'

import { useApi } from './api-context'
import type { CurrentUser, LoginInput } from './contracts'

type SessionStatus = 'loading' | 'guest' | 'authenticated'

interface SessionContextValue {
  user: CurrentUser | null
  status: SessionStatus
  login: (input: LoginInput) => Promise<CurrentUser>
  logout: () => Promise<void>
  refresh: () => Promise<CurrentUser | null>
}

const SessionContext = createContext<SessionContextValue | null>(null)

function LoadingSession() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status">
      <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
      <span className="sr-only">불러오는 중</span>
    </div>
  )
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const api = useApi()
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [status, setStatus] = useState<SessionStatus>('loading')

  const refresh = useCallback(async () => {
    const currentUser = await api.getCurrentUser()
    setUser(currentUser)
    setStatus(currentUser ? 'authenticated' : 'guest')
    return currentUser
  }, [api])

  useEffect(() => {
    let active = true

    void api.getCurrentUser().then((currentUser) => {
      if (!active) return
      setUser(currentUser)
      setStatus(currentUser ? 'authenticated' : 'guest')
    })

    return () => {
      active = false
    }
  }, [api])

  const login = useCallback(async (input: LoginInput) => {
    const currentUser = await api.login(input)
    setUser(currentUser)
    setStatus('authenticated')
    return currentUser
  }, [api])

  const logout = useCallback(async () => {
    await api.logout()
    setUser(null)
    setStatus('guest')
  }, [api])

  const value = useMemo<SessionContextValue>(() => ({
    user,
    status,
    login,
    logout,
    refresh,
  }), [login, logout, refresh, status, user])

  if (status === 'loading') return <LoadingSession />

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used within a SessionProvider')
  return session
}
