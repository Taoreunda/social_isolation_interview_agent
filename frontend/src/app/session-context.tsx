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
import { AlertCircle, LoaderCircle, RefreshCw } from 'lucide-react'

import { ApiProvider, useApi } from './api-context'
import { hasApiStatus } from './api-error'
import type { AppApi, CurrentUser, LoginInput } from './contracts'
import { Button } from '@/components/ui/button'

type SessionStatus = 'loading' | 'restore_error' | 'guest' | 'authenticated'

interface SessionContextValue {
  user: CurrentUser | null
  status: SessionStatus
  isLoggingOut: boolean
  announcement: string | null
  login: (input: LoginInput, signal?: AbortSignal) => Promise<CurrentUser>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  refresh: () => Promise<CurrentUser | null>
}

const SessionContext = createContext<SessionContextValue | null>(null)

function LoadingSession() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status">
      <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
      <span className="sr-only">불러오는 중</span>
    </div>
  )
}

function RestoreError({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm items-center px-4">
      <div className="w-full">
        <p className="inline-flex items-center gap-2" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />
          세션을 확인하지 못했습니다
        </p>
        <Button className="mt-4" onClick={onRetry} type="button" variant="outline">
          <RefreshCw aria-hidden="true" />
          다시 시도
        </Button>
      </div>
    </main>
  )
}

type AuthorizedRequest = <T>(request: () => Promise<T>) => Promise<T>

function withSessionErrors(api: AppApi, authorizedRequest: AuthorizedRequest): AppApi {
  return {
    login: (input, signal) => api.login(input, signal),
    logout: () => api.logout(),
    getCurrentUser: () => api.getCurrentUser(),
    changePassword: (currentPassword, newPassword) => authorizedRequest(
      () => api.changePassword(currentPassword, newPassword),
    ),
    getCurrentInterview: () => authorizedRequest(() => api.getCurrentInterview()),
    sendMessage: (interviewId, clientTurnId, content) => authorizedRequest(
      () => api.sendMessage(interviewId, clientTurnId, content),
    ),
    listParticipants: () => authorizedRequest(() => api.listParticipants()),
    createParticipant: (input) => authorizedRequest(() => api.createParticipant(input)),
    resetParticipantPassword: (participantId) => authorizedRequest(
      () => api.resetParticipantPassword(participantId),
    ),
    disableParticipant: (participantId) => authorizedRequest(() => api.disableParticipant(participantId)),
    unlockParticipant: (participantId) => authorizedRequest(() => api.unlockParticipant(participantId)),
    listInterviews: () => authorizedRequest(() => api.listInterviews()),
    getInterview: (interviewId) => authorizedRequest(() => api.getInterview(interviewId)),
    reviewScorecard: (input) => authorizedRequest(() => api.reviewScorecard(input)),
    exportInterviewCsv: (interviewId) => authorizedRequest(() => api.exportInterviewCsv(interviewId)),
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const api = useApi()
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const mounted = useRef(false)
  const generation = useRef(0)
  const logoutRequest = useRef<Promise<void> | null>(null)

  const nextOperation = useCallback(() => ++generation.current, [])

  const synchronize = useCallback((operation: number, currentUser: CurrentUser | null) => {
    if (!mounted.current || operation !== generation.current) return
    setUser(currentUser)
    setStatus(currentUser ? 'authenticated' : 'guest')
  }, [])

  const requestCurrentUser = useCallback(async (showRestoreError: boolean) => {
    const operation = nextOperation()
    if (showRestoreError) setStatus('loading')
    try {
      const currentUser = await api.getCurrentUser()
      synchronize(operation, currentUser)
      return currentUser
    } catch (error) {
      if (mounted.current && operation === generation.current) {
        if (hasApiStatus(error, 401)) {
          synchronize(operation, null)
        } else if (showRestoreError) {
          setUser(null)
          setStatus('restore_error')
        }
      }
      throw error
    }
  }, [api, nextOperation, synchronize])

  const refresh = useCallback(
    () => requestCurrentUser(false),
    [requestCurrentUser],
  )

  useEffect(() => {
    mounted.current = true
    void requestCurrentUser(true).catch(() => undefined)

    return () => {
      mounted.current = false
      nextOperation()
    }
  }, [nextOperation, requestCurrentUser])

  const login = useCallback(async (input: LoginInput, signal?: AbortSignal) => {
    const operation = nextOperation()
    let canceled = signal?.aborted ?? false
    const cancel = () => {
      canceled = true
      if (operation === generation.current) nextOperation()
    }
    signal?.addEventListener('abort', cancel, { once: true })

    try {
      const currentUser = await api.login(input, signal)
      if (canceled) {
        return currentUser
      }
      setAnnouncement(null)
      synchronize(operation, currentUser)
      return currentUser
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  }, [api, nextOperation, synchronize])

  const logout = useCallback((): Promise<void> => {
    if (logoutRequest.current) return logoutRequest.current

    const operation = nextOperation()
    setAnnouncement(null)
    setIsLoggingOut(true)
    let response: Promise<void>
    try {
      response = api.logout()
    } catch (error) {
      response = Promise.reject(error)
    }
    let request: Promise<void>
    request = response
      .then(() => synchronize(operation, null))
      .catch((error: unknown) => {
        if (hasApiStatus(error, 401)) {
          synchronize(operation, null)
          return
        }
        throw error
      })
      .finally(() => {
        if (logoutRequest.current !== request) return
        logoutRequest.current = null
        if (mounted.current) setIsLoggingOut(false)
      })
    logoutRequest.current = request
    return request
  }, [api, nextOperation, synchronize])

  const changePassword = useCallback(async (
    currentPassword: string,
    newPassword: string,
  ): Promise<void> => {
    const operation = nextOperation()
    try {
      await api.changePassword(currentPassword, newPassword)
    } catch (error) {
      if (hasApiStatus(error, 401)) synchronize(operation, null)
      throw error
    }
    setAnnouncement('비밀번호를 변경했습니다. 다시 로그인하세요.')
    synchronize(operation, null)
  }, [api, nextOperation, synchronize])

  const authorizedRequest = useCallback<AuthorizedRequest>(async (request) => {
    const operation = generation.current
    try {
      return await request()
    } catch (error) {
      if (hasApiStatus(error, 401) && mounted.current && operation === generation.current) {
        const expiration = nextOperation()
        synchronize(expiration, null)
      }
      throw error
    }
  }, [nextOperation, synchronize])

  const sessionApi = useMemo(
    () => withSessionErrors(api, authorizedRequest),
    [api, authorizedRequest],
  )

  const value = useMemo<SessionContextValue>(() => ({
    user,
    status,
    isLoggingOut,
    announcement,
    changePassword,
    login,
    logout,
    refresh,
  }), [announcement, changePassword, isLoggingOut, login, logout, refresh, status, user])

  if (status === 'loading') return <LoadingSession />
  if (status === 'restore_error') {
    return <RestoreError onRetry={() => void requestCurrentUser(true).catch(() => undefined)} />
  }

  return (
    <SessionContext.Provider value={value}>
      <ApiProvider api={sessionApi}>{children}</ApiProvider>
    </SessionContext.Provider>
  )
}

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used within a SessionProvider')
  return session
}
