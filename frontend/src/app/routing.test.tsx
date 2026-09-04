import { StrictMode, type ComponentType } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App, * as AppModule from '../App'
import { ApiProvider } from './api-context'
import { ApiError } from './api-error'
import type { AppApi, CurrentUser, InterviewListItem, LoginInput, ParticipantInterview } from './contracts'
import { MockAppApi } from '../mocks/mock-api'
import { createMockFixtureState } from '../mocks/fixtures'
import { AdminLayout } from '../layouts/AdminLayout'
import { ParticipantLayout } from '../layouts/ParticipantLayout'
import { RequireGuest, RequireRole } from './route-guards'
import { SessionProvider, useSession } from './session-context'

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

vi.stubGlobal('ResizeObserver', TestResizeObserver)

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

class DeferredRoutePageApi extends MockAppApi {
  readonly currentInterviewRequests: Deferred<ParticipantInterview>[] = []
  readonly interviewListRequests: Deferred<InterviewListItem[]>[] = []

  override getCurrentInterview(): Promise<ParticipantInterview> {
    const request = deferred<ParticipantInterview>()
    this.currentInterviewRequests.push(request)
    return request.promise
  }

  override listInterviews(): Promise<InterviewListItem[]> {
    const request = deferred<InterviewListItem[]>()
    this.interviewListRequests.push(request)
    return request.promise
  }
}

class FirstSuccessSecondFailureLogoutApi extends MockAppApi {
  logoutCalls = 0

  override logout(): Promise<void> {
    this.logoutCalls += 1
    if (this.logoutCalls === 1) return super.logout()
    return Promise.reject(new ApiError(401, 'Session expired'))
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

function CompleteRouteTree() {
  const moduleWithRoutes = AppModule as unknown as { AppRoutes?: ComponentType }
  const RouteTree = moduleWithRoutes.AppRoutes
  return RouteTree ? <RouteTree /> : <p role="alert">지원되는 라우트 트리가 없습니다</p>
}

function LocationPath() {
  return <output data-testid="location-path">{useLocation().pathname}</output>
}

function renderCompleteRoutes(api: AppApi, entry: string, strict = false) {
  const routeTree = (
    <ApiProvider api={api}>
      <SessionProvider>
        <MemoryRouter initialEntries={[entry]}>
          <CompleteRouteTree />
          <LocationPath />
        </MemoryRouter>
      </SessionProvider>
    </ApiProvider>
  )
  return render(strict ? <StrictMode>{routeTree}</StrictMode> : routeTree)
}

function expectSingleMainLandmark(): void {
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(document.querySelector('main main')).toBeNull()
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

function ReturnState() {
  const location = useLocation()
  const state = location.state as { returnTo?: string } | null
  return <p data-testid="return-state">{state?.returnTo}</p>
}

function SessionControls({
  onRender,
  onSession,
}: {
  onRender?: (value: string) => void
  onSession?: (session: ReturnType<typeof useSession>) => void
}) {
  const session = useSession()
  const { isLoggingOut, login, logout, refresh, status, user } = session
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
      <button aria-busy={isLoggingOut} disabled={isLoggingOut} onClick={() => void logout()}>logout</button>
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

describe('complete application route tree', () => {
  beforeEach(() => {
    installBrowserStorage()
  })

  it('waits for the guest session before redirecting the default route to /login', async () => {
    const api = new DeferredAppApi()
    renderCompleteRoutes(api, '/')

    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중')
    expect(api.currentUserRequests).toHaveLength(1)
    await act(async () => {
      api.currentUserRequests[0].resolve(null)
    })

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(screen.getByTestId('location-path')).toHaveTextContent('/login')
  })

  it('redirects the participant default route to /interview', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: false })

    renderCompleteRoutes(api, '/')

    expect(await screen.findByRole('heading', { name: '인터뷰 시작' })).toBeInTheDocument()
    expect(screen.getByLabelText('답변 입력')).toBeEnabled()
    expect(screen.getByRole('progressbar', { name: '진행률' })).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByTestId('location-path')).toHaveTextContent('/interview')
  })

  it('redirects the admin default route to /admin', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'admin', password: 'research123!', remember: false })

    renderCompleteRoutes(api, '/')

    expect(await screen.findByRole('heading', { name: '검토' })).toBeInTheDocument()
    expect(screen.getByTestId('location-path')).toHaveTextContent('/admin')
  })

  it.each([
    { role: 'participant', entry: '/admin/participants', expectedPath: '/interview', heading: '인터뷰 시작' },
    { role: 'participant', entry: '/admin/interviews/interview-001', expectedPath: '/interview', heading: '인터뷰 시작' },
    { role: 'admin', entry: '/interview', expectedPath: '/admin', heading: '검토' },
    { role: 'admin', entry: '/account/password', expectedPath: '/admin', heading: '검토' },
  ])('redirects a $role away from the cross-role route $entry', async ({ role, entry, expectedPath, heading }) => {
    const api = new MockAppApi()
    await api.login({
      username: role === 'admin' ? 'admin' : 'participant01',
      password: 'research123!',
      remember: false,
    })

    renderCompleteRoutes(api, entry)

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByTestId('location-path')).toHaveTextContent(expectedPath)
  })

  it('renders the participant password route directly', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: false })

    renderCompleteRoutes(api, '/account/password')

    expect(await screen.findByRole('heading', { name: '비밀번호 변경' })).toBeInTheDocument()
    expect(screen.getByTestId('location-path')).toHaveTextContent('/account/password')
  })

  it('opens password change from the participant shell account action', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: false })
    renderCompleteRoutes(api, '/interview')
    await screen.findByRole('heading', { name: '인터뷰 시작' })

    await userEvent.setup().click(screen.getByRole('link', { name: '계정' }))

    expect(await screen.findByRole('heading', { name: '비밀번호 변경' })).toBeInTheDocument()
    expect(screen.getByTestId('location-path')).toHaveTextContent('/account/password')
  })

  it('clears the participant session and returns to login after changing a password', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: false })
    renderCompleteRoutes(api, '/account/password')
    await screen.findByRole('heading', { name: '비밀번호 변경' })
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('현재 비밀번호'), 'research123!')
    await user.type(screen.getByLabelText('새 비밀번호'), 'changed-password!')
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'changed-password!')
    await user.click(screen.getByRole('button', { name: '변경' }))

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(screen.getByText('비밀번호를 변경했습니다. 다시 로그인하세요.')).toBeInTheDocument()
    expect(screen.getByTestId('location-path')).toHaveTextContent('/login')
    await expect(api.getCurrentUser()).resolves.toBeNull()
  })

  it('renders an admin interview detail route directly', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'admin', password: 'research123!', remember: false })

    renderCompleteRoutes(api, '/admin/interviews/interview-001')

    expect(await screen.findByRole('heading', { name: '인터뷰 검토' })).toBeInTheDocument()
    expect(screen.getByTestId('location-path')).toHaveTextContent('/admin/interviews/interview-001')
  })

  it('keeps one main landmark while the participant page loads and becomes ready', async () => {
    const api = new DeferredRoutePageApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: false })
    renderCompleteRoutes(api, '/interview')

    expect(await screen.findByText('인터뷰 시작')).toHaveAttribute('role', 'status')
    expectSingleMainLandmark()

    await act(async () => {
      api.currentInterviewRequests[0].resolve(createMockFixtureState().interviews[0])
    })

    expect(await screen.findByRole('heading', { name: '인터뷰 시작' })).toBeInTheDocument()
    expectSingleMainLandmark()
  })

  it('keeps one main landmark through admin loading, error, and ready states', async () => {
    const api = new DeferredRoutePageApi()
    await api.login({ username: 'admin', password: 'research123!', remember: false })
    renderCompleteRoutes(api, '/admin')

    expect(await screen.findByText('인터뷰를 불러오는 중')).toHaveAttribute('role', 'status')
    expectSingleMainLandmark()

    await act(async () => {
      api.interviewListRequests[0].reject(new Error('load failed'))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('인터뷰를 불러오지 못했습니다')
    expectSingleMainLandmark()

    await userEvent.setup().click(screen.getByRole('button', { name: '다시 시도' }))
    await act(async () => {
      api.interviewListRequests[1].resolve([])
    })

    expect(await screen.findByRole('heading', { name: '검토' })).toBeInTheDocument()
    expectSingleMainLandmark()
  })

  it('logs out from the complete participant route tree', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: true })
    renderCompleteRoutes(api, '/interview')
    await screen.findByRole('heading', { name: '인터뷰 시작' })

    await userEvent.setup().click(screen.getByRole('button', { name: '로그아웃' }))

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(screen.getByTestId('location-path')).toHaveTextContent('/login')
    expect(await api.getCurrentUser()).toBeNull()
  })

  it('expires the route session when an authorized request returns 401', async () => {
    const api = new DeferredRoutePageApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: false })
    renderCompleteRoutes(api, '/interview')
    expect(await screen.findByText('인터뷰 시작')).toHaveAttribute('role', 'status')
    expect(api.currentInterviewRequests).toHaveLength(1)

    await act(async () => {
      api.currentInterviewRequests[0].reject(new ApiError(401, 'Session expired'))
    })

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(screen.getByTestId('location-path')).toHaveTextContent('/login')
  })

  it('keeps the route session and shows an explicit permission error for 403', async () => {
    const api = new DeferredRoutePageApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: false })
    renderCompleteRoutes(api, '/interview')
    expect(await screen.findByText('인터뷰 시작')).toHaveAttribute('role', 'status')
    expect(api.currentInterviewRequests).toHaveLength(1)

    await act(async () => {
      api.currentInterviewRequests[0].reject(new ApiError(403, 'Participant access required'))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('이 인터뷰에 접근할 권한이 없습니다')
    expect(screen.getByText('participant01')).toBeInTheDocument()
    expect(screen.getByTestId('location-path')).toHaveTextContent('/interview')
  })

  it('restores a remembered participant through StrictMode and a fresh API instance', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: true })
    const firstMount = renderCompleteRoutes(api, '/interview', true)

    expect(await screen.findByRole('heading', { name: '인터뷰 시작' })).toBeInTheDocument()
    firstMount.unmount()

    renderCompleteRoutes(new MockAppApi(), '/missing-after-remount', true)

    expect(await screen.findByRole('heading', { name: '인터뷰 시작' })).toBeInTheDocument()
    expect(screen.getByTestId('location-path')).toHaveTextContent('/interview')
  })

  it('sends an unknown guest route through the wildcard to /login', async () => {
    renderCompleteRoutes(new MockAppApi(), '/not-a-route')

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(screen.getByTestId('location-path')).toHaveTextContent('/login')
  })

  it('restores the browser session from auth without requesting a legacy interview endpoint', async () => {
    window.history.replaceState({}, '', '/not-a-route')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 401 }),
    )

    try {
      render(<StrictMode><App /></StrictMode>)

      expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
      expect(window.location.pathname).toBe('/login')
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(0)
      for (const [url, init] of fetchSpy.mock.calls) {
        expect(url).toBe('/api/auth/me')
        expect(init).toMatchObject({ credentials: 'include', method: 'GET' })
      }
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

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
    { entry: '/interview', user: participant },
    { entry: '/admin', user: admin },
  ])('keeps a maximum-length identity bounded beside a non-shrinking logout action on $entry', async ({ entry, user }) => {
    const api = new DeferredAppApi()
    const username = 'u'.repeat(64)
    renderRoutes(api, entry)
    await resolveInitialUser(api, { ...user, username }, username)

    const usernameElement = screen.getByText(username)
    const identityGroup = usernameElement.parentElement
    const logout = screen.getByRole('button', { name: '로그아웃' })

    expect(identityGroup).toHaveClass('min-w-0', 'max-w-full')
    expect(usernameElement).toHaveClass('min-w-0', 'truncate')
    expect(usernameElement).toHaveAttribute('title', username)
    expect(logout).toHaveClass('shrink-0')
  })

  it.each([
    { entry: '/interview', user: participant },
    { entry: '/admin', user: admin },
  ])('disables the $entry logout action while the shared request is pending', async ({ entry, user: currentUser }) => {
    const api = new DeferredAppApi()
    renderRoutes(api, entry)
    await resolveInitialUser(api, currentUser, currentUser.username)

    const logout = screen.getByRole('button', { name: '로그아웃' })
    await userEvent.setup().click(logout)

    expect(logout).toBeDisabled()
    expect(logout).toHaveAttribute('aria-busy', 'true')
    await act(async () => {
      api.logoutRequests[0].resolve()
    })
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
          <MemoryRouter initialEntries={[{
            pathname: entry,
            state: { announcement: '변경했습니다', returnTo: 'kept' },
          }]}>
            <Routes>
              <Route element={<Layout />}>
                <Route path={entry} element={<><NavLink to={next}>next</NavLink><ReturnState /></>} />
                <Route path={next} element={<p>next page</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </ApiProvider>,
    )

    await resolveInitialUser(api, currentUser, currentUser.username)
    expect(await screen.findByText('변경했습니다')).toHaveAttribute('role', 'status')
    expect(screen.getByTestId('return-state')).toHaveTextContent('kept')
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

  it('serializes rapid logout calls when a second transport call would fail', async () => {
    const api = new FirstSuccessSecondFailureLogoutApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: false })
    let session!: ReturnType<typeof useSession>
    renderSession(api, undefined, (currentSession) => {
      session = currentSession
    })
    expect(await screen.findByText('authenticated:participant01')).toBeInTheDocument()

    const first = session.logout()
    const second = session.logout()
    const results = await Promise.allSettled([first, second])

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(api.logoutCalls).toBe(1)
    expect(await screen.findByText('guest:guest')).toBeInTheDocument()
  })
})

describe('session rejection handling', () => {
  it('keeps a retryable initial restore failure distinct and retries it', async () => {
    const api = new DeferredAppApi()
    renderSession(api)

    await act(async () => {
      api.currentUserRequests[0].reject(new ApiError(503, 'Restore unavailable'))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('세션을 확인하지 못했습니다')
    expect(screen.queryByText('불러오는 중')).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: '다시 시도' }))
    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중')
    await act(async () => {
      api.currentUserRequests[1].resolve(participant)
    })

    expect(await screen.findByText('authenticated:participant01')).toBeInTheDocument()
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
