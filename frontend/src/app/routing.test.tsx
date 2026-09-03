import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiProvider } from './api-context'
import type { AppApi, CurrentUser, LoginInput } from './contracts'
import { MockAppApi } from '../mocks/mock-api'
import { AdminLayout } from '../layouts/AdminLayout'
import { ParticipantLayout } from '../layouts/ParticipantLayout'
import { RequireGuest, RequireRole } from './route-guards'
import { SessionProvider, useSession } from './session-context'

const participant: CurrentUser = {
  id: 'participant-001',
  username: 'participant01',
  role: 'participant',
  participantCode: 'P-001',
}

const admin: CurrentUser = {
  id: 'admin-001',
  username: 'admin',
  role: 'admin',
  participantCode: null,
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class DeferredAppApi extends MockAppApi {
  readonly currentUserRequests: Deferred<CurrentUser | null>[] = []
  readonly loginRequests: Deferred<CurrentUser>[] = []
  readonly logoutRequests: Deferred<void>[] = []

  override login(_input: LoginInput): Promise<CurrentUser> {
    const request = deferred<CurrentUser>()
    this.loginRequests.push(request)
    return request.promise
  }

  override logout(): Promise<void> {
    const request = deferred<void>()
    this.logoutRequests.push(request)
    return request.promise
  }

  override getCurrentUser(): Promise<CurrentUser | null> {
    const request = deferred<CurrentUser | null>()
    this.currentUserRequests.push(request)
    return request.promise
  }
}

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

function installBrowserStorage(): void {
  Object.defineProperties(window, {
    localStorage: { configurable: true, value: createStorage() },
    sessionStorage: { configurable: true, value: createStorage() },
  })
}

function renderRoutes(api: AppApi, entry: string) {
  return render(
    <ApiProvider api={api}>
      <SessionProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/login" element={<RequireGuest><p>Login</p></RequireGuest>} />
            <Route element={<RequireRole role="participant"><ParticipantLayout /></RequireRole>}>
              <Route path="/interview" element={<p>Interview</p>} />
            </Route>
            <Route element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
              <Route path="/admin" element={<p>Admin</p>} />
            </Route>
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </ApiProvider>,
  )
}

function SessionControls({
  onRender,
  onSession,
}: {
  onRender?: (value: string) => void
  onSession?: (session: ReturnType<typeof useSession>) => void
}) {
  const session = useSession()
  const { login, logout, refresh, status, user } = session
  const value = `${status}:${user?.username ?? 'guest'}`
  onRender?.(value)
  onSession?.(session)

  return (
    <>
      <p>{value}</p>
      <button onClick={() => void refresh()}>refresh</button>
      <button onClick={() => void login({ username: 'participant01', password: 'research123!', remember: false })}>
        login
      </button>
      <button onClick={() => void logout()}>logout</button>
    </>
  )
}

function renderSession(
  api: AppApi,
  onRender?: (value: string) => void,
  onSession?: (session: ReturnType<typeof useSession>) => void,
) {
  return render(
    <ApiProvider api={api}>
      <SessionProvider>
        <SessionControls onRender={onRender} onSession={onSession} />
      </SessionProvider>
    </ApiProvider>,
  )
}

async function resolveInitialUser(
  api: DeferredAppApi,
  currentUser: CurrentUser | null,
  expectedText = currentUser ? `authenticated:${currentUser.username}` : 'guest:guest',
): Promise<void> {
  expect(api.currentUserRequests).toHaveLength(1)
  await act(async () => {
    api.currentUserRequests[0].resolve(currentUser)
  })
  expect(await screen.findByText(expectedText)).toBeInTheDocument()
}

async function resolveInitialGuest(api: DeferredAppApi): Promise<void> {
  await resolveInitialUser(api, null)
}

describe('role-protected routes', () => {
  beforeEach(() => {
    installBrowserStorage()
  })

  it('redirects a guest from /interview to /login', async () => {
    renderRoutes(new MockAppApi(), '/interview')

    expect(await screen.findByText('Login')).toBeInTheDocument()
  })

  it('redirects a participant away from /admin', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: false })

    renderRoutes(api, '/admin')

    expect(await screen.findByText('Interview')).toBeInTheDocument()
  })

  it('redirects an admin away from /interview', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'admin', password: 'research123!', remember: false })

    renderRoutes(api, '/interview')

    expect(await screen.findByText('Admin')).toBeInTheDocument()
  })

  it('restores the remembered mock user after remount', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: true })
    const firstMount = renderRoutes(api, '/interview')

    expect(await screen.findByText('Interview')).toBeInTheDocument()
    firstMount.unmount()

    renderRoutes(api, '/interview')

    expect(await screen.findByText('Interview')).toBeInTheDocument()
  })

  it('clears the route session on logout', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: true })
    render(
      <ApiProvider api={api}>
        <SessionProvider>
          <MemoryRouter initialEntries={['/interview']}>
            <Routes>
              <Route element={<RequireRole role="participant"><ParticipantLayout /></RequireRole>}>
                <Route path="/interview" element={<p>Interview</p>} />
              </Route>
              <Route path="/login" element={<p>Login</p>} />
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </ApiProvider>,
    )

    await screen.findByText('Interview')
    await userEvent.setup().click(screen.getByRole('button', { name: '로그아웃' }))

    expect(await screen.findByText('Login')).toBeInTheDocument()
    expect(await api.getCurrentUser()).toBeNull()
  })

  it.each([
    { entry: '/interview', user: participant, role: 'participant' as const },
    { entry: '/admin', user: admin, role: 'admin' as const },
  ])('announces a password change once in the $role layout', async ({ entry, user: currentUser, role }) => {
    const api = new DeferredAppApi()
    const next = role === 'admin' ? '/admin/next' : '/interview/next'
    const Layout = role === 'admin' ? AdminLayout : ParticipantLayout

    render(
      <ApiProvider api={api}>
        <SessionProvider>
          <MemoryRouter initialEntries={[{ pathname: entry, state: { announcement: '변경했습니다' } }]}>
            <Routes>
              <Route element={<Layout />}>
                <Route path={entry} element={<NavLink to={next}>next</NavLink>} />
                <Route path={next} element={<p>next page</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </ApiProvider>,
    )

    await resolveInitialUser(api, currentUser, currentUser.username)
    expect(await screen.findByText('변경했습니다')).toHaveAttribute('role', 'status')
    await userEvent.setup().click(screen.getByRole('link', { name: 'next' }))

    expect(await screen.findByText('next page')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it.each([
    { entry: '/interview', user: participant, page: 'Interview' },
    { entry: '/admin', user: admin, page: 'Admin' },
  ])('keeps the protected $entry route and allows retry after logout failure', async ({ entry, user: currentUser, page }) => {
    const api = new DeferredAppApi()
    renderRoutes(api, entry)
    await resolveInitialUser(api, currentUser, currentUser.username)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '로그아웃' }))
    await act(async () => {
      api.logoutRequests[0].reject(new Error('logout failed'))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('로그아웃 실패')
    expect(screen.getByText(page)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '로그아웃' }))
    await act(async () => {
      api.logoutRequests[1].resolve()
    })

    expect(await screen.findByText('Login')).toBeInTheDocument()
  })
})

describe('session operation ordering', () => {
  it('synchronizes the public session after refresh', async () => {
    const api = new DeferredAppApi()
    renderSession(api)
    await resolveInitialGuest(api)

    await userEvent.setup().click(screen.getByRole('button', { name: 'refresh' }))
    await act(async () => {
      api.currentUserRequests[1].resolve(admin)
    })

    expect(await screen.findByText('authenticated:admin')).toBeInTheDocument()
  })

  it('does not let a stale refresh overwrite a later login', async () => {
    const api = new DeferredAppApi()
    renderSession(api)
    await resolveInitialGuest(api)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'refresh' }))
    await user.click(screen.getByRole('button', { name: 'login' }))
    await act(async () => {
      api.loginRequests[0].resolve(participant)
    })
    expect(await screen.findByText('authenticated:participant01')).toBeInTheDocument()

    await act(async () => {
      api.currentUserRequests[1].resolve(admin)
    })

    expect(screen.getByText('authenticated:participant01')).toBeInTheDocument()
  })

  it('does not let a stale login undo logout', async () => {
    const api = new DeferredAppApi()
    renderSession(api)
    await resolveInitialGuest(api)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'login' }))
    await user.click(screen.getByRole('button', { name: 'logout' }))
    await act(async () => {
      api.logoutRequests[0].resolve()
    })
    expect(await screen.findByText('guest:guest')).toBeInTheDocument()

    await act(async () => {
      api.loginRequests[0].resolve(participant)
    })

    expect(screen.getByText('guest:guest')).toBeInTheDocument()
  })

  it('does not let a stale refresh undo logout', async () => {
    const api = new DeferredAppApi()
    renderSession(api)
    await resolveInitialGuest(api)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'refresh' }))
    await user.click(screen.getByRole('button', { name: 'logout' }))
    await act(async () => {
      api.logoutRequests[0].resolve()
    })
    expect(await screen.findByText('guest:guest')).toBeInTheDocument()

    await act(async () => {
      api.currentUserRequests[1].resolve(admin)
    })

    expect(screen.getByText('guest:guest')).toBeInTheDocument()
  })

  it('does not render after an unmounted refresh resolves', async () => {
    const api = new DeferredAppApi()
    const onRender = vi.fn()
    const view = renderSession(api, onRender)
    await resolveInitialGuest(api)

    await userEvent.setup().click(screen.getByRole('button', { name: 'refresh' }))
    const rendersBeforeUnmount = onRender.mock.calls.length
    view.unmount()
    await act(async () => {
      api.currentUserRequests[1].resolve(admin)
    })

    expect(onRender).toHaveBeenCalledTimes(rendersBeforeUnmount)
  })
})

describe('session rejection handling', () => {
  it('handles an initial restore failure as a guest session', async () => {
    const api = new DeferredAppApi()
    renderSession(api)

    await act(async () => {
      api.currentUserRequests[0].reject(new Error('restore failed'))
    })

    expect(await screen.findByText('guest:guest')).toBeInTheDocument()
    expect(screen.queryByText('불러오는 중')).not.toBeInTheDocument()
  })

  it('keeps the latest login after a stale refresh rejects', async () => {
    const api = new DeferredAppApi()
    let session!: ReturnType<typeof useSession>
    renderSession(api, undefined, (currentSession) => {
      session = currentSession
    })
    await resolveInitialGuest(api)

    const refresh = session.refresh()
    const refreshFailure = expect(refresh).rejects.toThrow('refresh failed')
    const login = session.login({ username: 'participant01', password: 'research123!', remember: false })
    await act(async () => {
      api.loginRequests[0].resolve(participant)
    })
    await expect(login).resolves.toEqual(participant)

    await act(async () => {
      api.currentUserRequests[1].reject(new Error('refresh failed'))
    })
    await refreshFailure

    expect(screen.getByText('authenticated:participant01')).toBeInTheDocument()
  })

  it('keeps logout after a stale login rejects', async () => {
    const api = new DeferredAppApi()
    let session!: ReturnType<typeof useSession>
    renderSession(api, undefined, (currentSession) => {
      session = currentSession
    })
    await resolveInitialGuest(api)

    const login = session.login({ username: 'participant01', password: 'research123!', remember: false })
    const loginFailure = expect(login).rejects.toThrow('login failed')
    const logout = session.logout()
    await act(async () => {
      api.logoutRequests[0].resolve()
    })
    await expect(logout).resolves.toBeUndefined()

    await act(async () => {
      api.loginRequests[0].reject(new Error('login failed'))
    })
    await loginFailure

    expect(screen.getByText('guest:guest')).toBeInTheDocument()
  })

  it('rejects a current refresh without changing the committed session', async () => {
    const api = new DeferredAppApi()
    let session!: ReturnType<typeof useSession>
    renderSession(api, undefined, (currentSession) => {
      session = currentSession
    })
    await resolveInitialGuest(api)

    const refresh = session.refresh()
    const failure = expect(refresh).rejects.toThrow('refresh failed')
    await act(async () => {
      api.currentUserRequests[1].reject(new Error('refresh failed'))
    })
    await failure

    expect(screen.getByText('guest:guest')).toBeInTheDocument()
  })

  it('rejects a current login without changing the committed session', async () => {
    const api = new DeferredAppApi()
    let session!: ReturnType<typeof useSession>
    renderSession(api, undefined, (currentSession) => {
      session = currentSession
    })
    await resolveInitialGuest(api)

    const login = session.login({ username: 'participant01', password: 'research123!', remember: false })
    const failure = expect(login).rejects.toThrow('login failed')
    await act(async () => {
      api.loginRequests[0].reject(new Error('login failed'))
    })
    await failure

    expect(screen.getByText('guest:guest')).toBeInTheDocument()
  })

  it('rejects a current logout without changing the committed session', async () => {
    const api = new DeferredAppApi()
    let session!: ReturnType<typeof useSession>
    renderSession(api, undefined, (currentSession) => {
      session = currentSession
    })
    await resolveInitialUser(api, participant)

    const logout = session.logout()
    const failure = expect(logout).rejects.toThrow('logout failed')
    await act(async () => {
      api.logoutRequests[0].reject(new Error('logout failed'))
    })
    await failure

    expect(screen.getByText('authenticated:participant01')).toBeInTheDocument()
  })

  it('handles a rejected initial restore after unmount', async () => {
    const api = new DeferredAppApi()
    const view = renderSession(api)
    expect(api.currentUserRequests).toHaveLength(1)
    view.unmount()

    await act(async () => {
      api.currentUserRequests[0].reject(new Error('restore failed'))
    })
  })
})
