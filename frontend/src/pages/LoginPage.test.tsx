import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { ApiProvider } from '@/app/api-context'
import type { AppApi, CurrentUser, LoginInput } from '@/app/contracts'
import { SessionProvider } from '@/app/session-context'
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

function Location() {
  const location = useLocation()
  const announcement = (location.state as { announcement?: string } | null)?.announcement
  return (
    <>
      <p data-testid="location">{location.pathname}</p>
      {announcement && <p role="status">{announcement}</p>}
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

async function fillLogin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('사용자 이름'), 'account-user')
  await user.type(screen.getByLabelText('비밀번호'), 'account-password')
}

async function fillPasswordChange(user: ReturnType<typeof userEvent.setup>, newPassword = 'changed-password') {
  await user.type(screen.getByLabelText('현재 비밀번호'), 'current-password')
  await user.type(screen.getByLabelText('새 비밀번호'), newPassword)
  await user.type(screen.getByLabelText('새 비밀번호 확인'), newPassword)
}

describe('LoginPage', () => {
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

  it('prevents duplicate login submission while busy', async () => {
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
    await user.click(submit)
    await user.click(submit)

    expect(api.loginMock).toHaveBeenCalledTimes(1)
    expect(submit).toHaveAttribute('aria-busy', 'true')
    resolveLogin(participant)
    expect(await screen.findByTestId('location')).toHaveTextContent('/interview')
  })
})

describe('PasswordPage', () => {
  it('changes a password without a first-login prompt', async () => {
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
    expect(await screen.findByTestId('location')).toHaveTextContent('/interview')
    expect(screen.getByRole('status')).toHaveTextContent('변경했습니다')
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
})
