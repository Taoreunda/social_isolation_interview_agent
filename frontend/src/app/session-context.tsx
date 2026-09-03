import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  const mounted = useRef(false)
  const generation = useRef(0)

  const nextOperation = useCallback(() => ++generation.current, [])

  const synchronize = useCallback((operation: number, currentUser: CurrentUser | null) => {
    if (!mounted.current || operation !== generation.current) return
    setUser(currentUser)
    setStatus(currentUser ? 'authenticated' : 'guest')
  }, [])

  const refresh = useCallback(async () => {
    const operation = nextOperation()
    const currentUser = await api.getCurrentUser()
    synchronize(operation, currentUser)
    return currentUser
  }, [api, nextOperation, synchronize])

  useEffect(() => {
    mounted.current = true
    const operation = nextOperation()

    void api.getCurrentUser().then((currentUser) => {
      synchronize(operation, currentUser)
    })

    return () => {
      mounted.current = false
      nextOperation()
    }
  }, [api, nextOperation, synchronize])

  const login = useCallback(async (input: LoginInput) => {
    const operation = nextOperation()
    const currentUser = await api.login(input)
    synchronize(operation, currentUser)
    return currentUser
  }, [api, nextOperation, synchronize])

  const logout = useCallback(async () => {
    const operation = nextOperation()
    await api.logout()
    synchronize(operation, null)
  }, [api, nextOperation, synchronize])

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
