import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiProvider } from '@/app/api-context'
import type { AppApi, CurrentUser, LoginInput } from '@/app/contracts'
import { RequireGuest } from '@/app/route-guards'
import { SessionProvider, useSession } from '@/app/session-context'
import { mockCredentials } from '@/mocks/fixtures'
import { MockAppApi } from '@/mocks/mock-api'

import { LoginPage } from './LoginPage'
import { PasswordPage } from './PasswordPage'

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

vi.stubGlobal('ResizeObserver', TestResizeObserver)

const participant: CurrentUser = {
  id: 'participant-001',
  username: 'participant',
  role: 'participant',
  participantCode: 'P-001',
}

const admin: CurrentUser = {
  id: 'admin-001',
  username: 'administrator',
  role: 'admin',
  participantCode: null,
}

class AccountScreenApi extends MockAppApi {
  loginMock = vi.fn<(input: LoginInput) => Promise<CurrentUser>>()
  changePasswordMock = vi.fn<(currentPassword: string, newPassword: string) => Promise<void>>()
  currentUser: CurrentUser | null = null

  override getCurrentUser(): Promise<CurrentUser | null> {
    return Promise.resolve(this.currentUser)
  }

  override login(input: LoginInput): Promise<CurrentUser> {
    return this.loginMock(input)
  }

  override changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.changePasswordMock(currentPassword, newPassword)
  }
}

class DeferredPersistentLoginApi extends MockAppApi {
  readonly loginRequests: Array<{
    input: LoginInput
    signal: AbortSignal | undefined
    resolve: (user: CurrentUser) => void
    reject: (reason: unknown) => void
  }> = []

  override login(input: LoginInput, signal?: AbortSignal): Promise<CurrentUser> {
    return new Promise((resolve, reject) => {
      this.loginRequests.push({ input, signal, resolve, reject })
    })
  }

  async resolveLogin(index = 0): Promise<void> {
    const request = this.loginRequests[index]
    if (!request) throw new Error('No login request to resolve')
    try {
      request.resolve(await super.login(request.input, request.signal))
    } catch (error) {
      request.reject(error)
    }
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

function Location() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname}</p>
}

function SessionState() {
  const { status, user } = useSession()
  return <p data-testid="session-state">{`${status}:${user?.username ?? 'guest'}`}</p>
}

function SessionProbe({ onSession }: { onSession: (session: ReturnType<typeof useSession>) => void }) {
  const session = useSession()
  onSession(session)
  return <p>{`${session.status}:${session.user?.username ?? 'guest'}`}</p>
}

function LeaveLoginPage() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/else')} type="button">다른 화면</button>
}

function UnmountableLogin() {
  const [mounted, setMounted] = useState(true)
  return (
    <>
      {mounted && <LoginPage />}
      <button onClick={() => setMounted(false)} type="button">로그인 화면 닫기</button>
      <Location />
    </>
  )
}

function UnmountablePassword() {
  const [mounted, setMounted] = useState(true)
  return (
    <>
      {mounted && <PasswordPage />}
      <button onClick={() => setMounted(false)} type="button">비밀번호 화면 닫기</button>
      <Location />
    </>
  )
}

function renderAccountScreen(api: AppApi, initialEntry: string, page: 'login' | 'password') {
  return render(
    <ApiProvider api={api}>
      <SessionProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/login" element={page === 'login' ? <LoginPage /> : <Location />} />
            <Route path="/password" element={page === 'password' ? <PasswordPage /> : <Location />} />
            <Route path="/interview" element={<Location />} />
            <Route path="/admin" element={<Location />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </ApiProvider>,
  )
}

function renderUnmountableScreen(api: AppApi, page: 'login' | 'password') {
  return render(
    <ApiProvider api={api}>
      <SessionProvider>
        <MemoryRouter initialEntries={[page === 'login' ? '/login' : '/password']}>
          <Routes>
            <Route path="/login" element={page === 'login' ? <UnmountableLogin /> : <Location />} />
            <Route path="/password" element={page === 'password' ? <UnmountablePassword /> : <Location />} />
            <Route path="/interview" element={<Location />} />
            <Route path="/admin" element={<Location />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </ApiProvider>,
  )
}

function renderGuardedLogin(api: AppApi) {
  return render(
    <ApiProvider api={api}>
      <SessionProvider>
        <MemoryRouter initialEntries={['/login']}>
          <SessionState />
          <Routes>
            <Route path="/login" element={<RequireGuest><><LoginPage /><LeaveLoginPage /></></RequireGuest>} />
            <Route path="/else" element={<Location />} />
            <Route path="/interview" element={<Location />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </ApiProvider>,
  )
}

function fixtureLogin(role: 'participant' | 'admin'): LoginInput {
  const account = mockCredentials[role]
  return { username: account.username, password: account.password, remember: false }
}

function participantCredentials(): LoginInput {
  return fixtureLogin('participant')
}

async function fillLogin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('사용자 이름'), 'account-user')
  await user.type(screen.getByLabelText('비밀번호'), 'account-password')
}

async function fillFixtureLogin(user: ReturnType<typeof userEvent.setup>) {
  const credentials = participantCredentials()
  await user.type(screen.getByLabelText('사용자 이름'), credentials.username)
  await user.type(screen.getByLabelText('비밀번호'), credentials.password)
}

async function fillPasswordChange(user: ReturnType<typeof userEvent.setup>, newPassword = 'changed-password') {
  await user.type(screen.getByLabelText('현재 비밀번호'), 'current-password')
  await user.type(screen.getByLabelText('새 비밀번호'), newPassword)
  await user.type(screen.getByLabelText('새 비밀번호 확인'), newPassword)
}

describe('LoginPage', () => {
  beforeEach(() => {
    installBrowserStorage()
  })

  it('requires username and password before it submits', async () => {
    const api = new AccountScreenApi()
    api.loginMock.mockResolvedValue(participant)
    const user = userEvent.setup()
    renderAccountScreen(api, '/login', 'login')

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '로그인' }))

    expect(screen.getByRole('alert')).toHaveTextContent('입력 내용을 확인하세요')
    expect(api.loginMock).not.toHaveBeenCalled()
  })

  it('confirms a completed password change on the returned login screen', async () => {
    const api = new AccountScreenApi()
    render(
      <ApiProvider api={api}>
        <SessionProvider>
          <MemoryRouter initialEntries={[{
            pathname: '/login',
            state: { announcement: '비밀번호를 변경했습니다. 다시 로그인하세요.' },
          }]}>
            <LoginPage />
          </MemoryRouter>
        </SessionProvider>
      </ApiProvider>,
    )

    await screen.findByRole('heading', { name: '로그인' })
    expect(screen.getByRole('status')).toHaveTextContent(
      '비밀번호를 변경했습니다. 다시 로그인하세요.',
    )
  })

  it('routes a participant to the interview returned by login', async () => {
    const api = new AccountScreenApi()
    api.loginMock.mockResolvedValue(participant)
    const user = userEvent.setup()
    renderAccountScreen(api, '/login', 'login')
    await screen.findByRole('heading', { name: '로그인' })

    await fillLogin(user)
    await user.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByTestId('location')).toHaveTextContent('/interview')
  })

  it('routes an admin to the admin home returned by login', async () => {
    const api = new AccountScreenApi()
    api.loginMock.mockResolvedValue(admin)
    const user = userEvent.setup()
    renderAccountScreen(api, '/login', 'login')
    await screen.findByRole('heading', { name: '로그인' })

    await fillLogin(user)
    await user.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByTestId('location')).toHaveTextContent('/admin')
  })

  it('shows one generic error when credentials are rejected', async () => {
    const api = new AccountScreenApi()
    api.loginMock.mockRejectedValue(new Error('rejected'))
    const user = userEvent.setup()
    renderAccountScreen(api, '/login', 'login')
    await screen.findByRole('heading', { name: '로그인' })

    await fillLogin(user)
    await user.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('로그인에 실패했습니다')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('passes the automatic-login checkbox value unchanged', async () => {
    const api = new AccountScreenApi()
    api.loginMock.mockResolvedValue(participant)
    const user = userEvent.setup()
    renderAccountScreen(api, '/login', 'login')
    await screen.findByRole('heading', { name: '로그인' })

    await fillLogin(user)
    await user.click(screen.getByRole('checkbox', { name: '자동 로그인' }))
    await user.click(screen.getByRole('button', { name: '로그인' }))

    await waitFor(() => {
      expect(api.loginMock).toHaveBeenCalledWith({
        username: 'account-user',
        password: 'account-password',
        remember: true,
      })
    })
  })

  it('prevents same-tick duplicate login submissions', async () => {
    let resolveLogin!: (user: CurrentUser) => void
    const api = new AccountScreenApi()
    api.loginMock.mockImplementation(() => new Promise((resolve) => {
      resolveLogin = resolve
    }))
    const user = userEvent.setup()
    renderAccountScreen(api, '/login', 'login')
    await screen.findByRole('heading', { name: '로그인' })

    await fillLogin(user)
    const submit = screen.getByRole('button', { name: '로그인' })
    act(() => {
      submit.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      submit.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(api.loginMock).toHaveBeenCalledTimes(1)
    expect(submit).toHaveAttribute('aria-busy', 'true')
    resolveLogin(participant)
    expect(await screen.findByTestId('location')).toHaveTextContent('/interview')
  })

  it('allows login retry after a failure', async () => {
    const api = new AccountScreenApi()
    api.loginMock
      .mockRejectedValueOnce(new Error('rejected'))
      .mockResolvedValueOnce(participant)
    const user = userEvent.setup()
    renderAccountScreen(api, '/login', 'login')
    await screen.findByRole('heading', { name: '로그인' })

    await fillLogin(user)
    await user.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('로그인에 실패했습니다')
    await user.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByTestId('location')).toHaveTextContent('/interview')
    expect(api.loginMock).toHaveBeenCalledTimes(2)
  })

  it('does not navigate when a login succeeds after its page unmounts', async () => {
    let resolveLogin!: (user: CurrentUser) => void
    const api = new AccountScreenApi()
    api.loginMock.mockImplementation(() => new Promise((resolve) => {
      resolveLogin = resolve
    }))
    const user = userEvent.setup()
    renderUnmountableScreen(api, 'login')
    await screen.findByRole('heading', { name: '로그인' })

    await fillLogin(user)
    fireEvent.submit(screen.getByRole('button', { name: '로그인' }).closest('form')!)
    await user.click(screen.getByRole('button', { name: '로그인 화면 닫기' }))
    await act(async () => {
      resolveLogin(participant)
    })

    expect(screen.getByTestId('location')).toHaveTextContent('/login')
  })

  it('does not surface a login failure after its page unmounts', async () => {
    let rejectLogin!: (reason: Error) => void
    const api = new AccountScreenApi()
    api.loginMock.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectLogin = reject
    }))
    const user = userEvent.setup()
    renderUnmountableScreen(api, 'login')
    await screen.findByRole('heading', { name: '로그인' })

    await fillLogin(user)
    fireEvent.submit(screen.getByRole('button', { name: '로그인' }).closest('form')!)
    await user.click(screen.getByRole('button', { name: '로그인 화면 닫기' }))
    await act(async () => {
      rejectLogin(new Error('rejected'))
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('cancels a deferred real mock login after leaving a RequireGuest route', async () => {
    const api = new DeferredPersistentLoginApi()
    const user = userEvent.setup()
    renderGuardedLogin(api)
    await screen.findByRole('heading', { name: '로그인' })
    expect(screen.getByTestId('session-state')).toHaveTextContent('guest:guest')

    await fillFixtureLogin(user)
    await user.click(screen.getByRole('button', { name: '로그인' }))
    await user.click(screen.getByRole('button', { name: '다른 화면' }))
    await act(async () => {
      await api.resolveLogin()
    })

    expect(screen.getByTestId('location')).toHaveTextContent('/else')
    expect(screen.getByTestId('session-state')).toHaveTextContent('guest:guest')
    expect(await api.getCurrentUser()).toBeNull()
  })

  it('keeps login B authenticated and persisted after abandoned login A settles', async () => {
    const api = new DeferredPersistentLoginApi()
    let session!: ReturnType<typeof useSession>
    render(
      <ApiProvider api={api}>
        <SessionProvider>
          <SessionProbe onSession={(value) => { session = value }} />
        </SessionProvider>
      </ApiProvider>,
    )
    expect(await screen.findByText('guest:guest')).toBeInTheDocument()

    const abandonedController = new AbortController()
    const abandoned = session.login(fixtureLogin('participant'), abandonedController.signal)
    const canceled = abandoned.then(
      () => null,
      (error: unknown) => error,
    )
    abandonedController.abort()
    const active = session.login(fixtureLogin('admin'))
    expect(api.loginRequests).toHaveLength(2)

    await act(async () => {
      await api.resolveLogin(1)
    })
    await expect(active).resolves.toMatchObject({ role: 'admin' })
    expect(screen.getByText('authenticated:admin')).toBeInTheDocument()
    expect(await api.getCurrentUser()).toMatchObject({ role: 'admin' })

    await act(async () => {
      await api.resolveLogin(0)
    })
    await expect(canceled).resolves.toMatchObject({ name: 'AbortError' })

    expect(screen.getByText('authenticated:admin')).toBeInTheDocument()
    expect(await api.getCurrentUser()).toMatchObject({ role: 'admin' })
  })
})

describe('PasswordPage', () => {
  it('returns to login after changing a password without a first-login prompt', async () => {
    const api = new AccountScreenApi()
    api.currentUser = participant
    api.changePasswordMock.mockResolvedValue()
    const user = userEvent.setup()
    renderAccountScreen(api, '/password', 'password')

    expect(await screen.findByRole('heading', { name: '비밀번호 변경' })).toBeInTheDocument()
    expect(screen.queryByText(/첫 로그인/)).not.toBeInTheDocument()
    await fillPasswordChange(user)
    await user.click(screen.getByRole('button', { name: '변경' }))

    await waitFor(() => {
      expect(api.changePasswordMock).toHaveBeenCalledWith('current-password', 'changed-password')
    })
    expect(await screen.findByTestId('location')).toHaveTextContent('/login')
  })

  it('validates password length and confirmation before it submits', async () => {
    const api = new AccountScreenApi()
    api.currentUser = participant
    const user = userEvent.setup()
    renderAccountScreen(api, '/password', 'password')
    await screen.findByRole('heading', { name: '비밀번호 변경' })

    await user.type(screen.getByLabelText('현재 비밀번호'), 'current-password')
    await user.type(screen.getByLabelText('새 비밀번호'), 'short')
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'different')
    await user.click(screen.getByRole('button', { name: '변경' }))

    expect(screen.getByRole('alert')).toHaveTextContent('새 비밀번호는 10~128자여야 합니다')
    expect(api.changePasswordMock).not.toHaveBeenCalled()
  })

  it('requires an exact password confirmation before it submits', async () => {
    const api = new AccountScreenApi()
    api.currentUser = participant
    const user = userEvent.setup()
    renderAccountScreen(api, '/password', 'password')
    await screen.findByRole('heading', { name: '비밀번호 변경' })

    await user.type(screen.getByLabelText('현재 비밀번호'), 'current-password')
    await user.type(screen.getByLabelText('새 비밀번호'), 'changed-password')
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'other-password')
    await user.click(screen.getByRole('button', { name: '변경' }))

    expect(screen.getByRole('alert')).toHaveTextContent('새 비밀번호가 일치하지 않습니다')
    expect(api.changePasswordMock).not.toHaveBeenCalled()
  })

  it('returns to the admin home when cancelled', async () => {
    const api = new AccountScreenApi()
    api.currentUser = admin
    const user = userEvent.setup()
    renderAccountScreen(api, '/password', 'password')
    await screen.findByRole('heading', { name: '비밀번호 변경' })

    await user.click(screen.getByRole('button', { name: '취소' }))

    expect(await screen.findByTestId('location')).toHaveTextContent('/admin')
  })

  it('prevents same-tick duplicate password changes', async () => {
    let resolveChange!: () => void
    const api = new AccountScreenApi()
    api.currentUser = participant
    api.changePasswordMock.mockImplementation(() => new Promise((resolve) => {
      resolveChange = resolve
    }))
    const user = userEvent.setup()
    renderAccountScreen(api, '/password', 'password')
    await screen.findByRole('heading', { name: '비밀번호 변경' })

    await fillPasswordChange(user)
    const submit = screen.getByRole('button', { name: '변경' })
    act(() => {
      submit.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      submit.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(api.changePasswordMock).toHaveBeenCalledTimes(1)
    resolveChange()
    expect(await screen.findByTestId('location')).toHaveTextContent('/login')
  })

  it('allows password-change retry after a failure', async () => {
    const api = new AccountScreenApi()
    api.currentUser = participant
    api.changePasswordMock
      .mockRejectedValueOnce(new Error('rejected'))
      .mockResolvedValueOnce()
    const user = userEvent.setup()
    renderAccountScreen(api, '/password', 'password')
    await screen.findByRole('heading', { name: '비밀번호 변경' })

    await fillPasswordChange(user)
    await user.click(screen.getByRole('button', { name: '변경' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('변경에 실패했습니다')
    await user.click(screen.getByRole('button', { name: '변경' }))

    expect(await screen.findByTestId('location')).toHaveTextContent('/login')
    expect(api.changePasswordMock).toHaveBeenCalledTimes(2)
  })

  it('does not navigate when a password change succeeds after its page unmounts', async () => {
    let resolveChange!: () => void
    const api = new AccountScreenApi()
    api.currentUser = participant
    api.changePasswordMock.mockImplementation(() => new Promise((resolve) => {
      resolveChange = resolve
    }))
    const user = userEvent.setup()
    renderUnmountableScreen(api, 'password')
    await screen.findByRole('heading', { name: '비밀번호 변경' })

    await fillPasswordChange(user)
    fireEvent.submit(screen.getByRole('button', { name: '변경' }).closest('form')!)
    await user.click(screen.getByRole('button', { name: '비밀번호 화면 닫기' }))
    await act(async () => {
      resolveChange()
    })

    expect(screen.getByTestId('location')).toHaveTextContent('/password')
  })

  it('does not surface a password-change failure after its page unmounts', async () => {
    let rejectChange!: (reason: Error) => void
    const api = new AccountScreenApi()
    api.currentUser = participant
    api.changePasswordMock.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectChange = reject
    }))
    const user = userEvent.setup()
    renderUnmountableScreen(api, 'password')
    await screen.findByRole('heading', { name: '비밀번호 변경' })

    await fillPasswordChange(user)
    fireEvent.submit(screen.getByRole('button', { name: '변경' }).closest('form')!)
    await user.click(screen.getByRole('button', { name: '비밀번호 화면 닫기' }))
    await act(async () => {
      rejectChange(new Error('rejected'))
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
