import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ApiProvider } from '@/app/api-context'
import { MockAppApi } from '@/mocks/mock-api'
import { ParticipantsPage } from './ParticipantsPage'

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

function clearStorage(): void {
  window.localStorage.clear()
  window.sessionStorage.clear()
}

async function renderParticipantsPage() {
  const api = new MockAppApi()
  await api.login({ username: 'admin', password: 'research123!', remember: false })
  render(
    <ApiProvider api={api}>
      <ParticipantsPage />
    </ApiProvider>,
  )
  await screen.findByRole('heading', { name: '참여자' })
  return api
}

describe('ParticipantsPage', () => {
  beforeEach(installBrowserStorage)
  afterEach(installBrowserStorage)

  it('lists participant code, username, status, and interview status', async () => {
    await renderParticipantsPage()

    const row = await screen.findByRole('row', { name: /P-001.*participant01/i })
    expect(within(row).getByText('활성')).toBeInTheDocument()
    expect(within(row).getByText('완료')).toBeInTheDocument()
  })

  it('filters rows by code or username', async () => {
    await renderParticipantsPage()
    const user = userEvent.setup()

    await user.type(screen.getByRole('searchbox', { name: '참여자 검색' }), 'participant01')
    expect(await screen.findByText('P-001')).toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox', { name: '참여자 검색' }))
    await user.type(screen.getByRole('searchbox', { name: '참여자 검색' }), 'P-999')
    expect(screen.getByText('참여자가 없습니다')).toBeInTheDocument()
  })

  it('creates an account with username, code, and assigned password', async () => {
    await renderParticipantsPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '계정 생성' }))
    await user.type(screen.getByLabelText('사용자 이름'), 'participant02')
    await user.type(screen.getByLabelText('참여자 코드'), 'P-002')
    await user.click(screen.getByRole('button', { name: '생성' }))

    expect(await screen.findByText('P-002')).toBeInTheDocument()
    expect(screen.getByText('participant02')).toBeInTheDocument()
    expect(screen.getByLabelText('할당된 비밀번호')).toBeInTheDocument()
  })

  it('generates a password of at least 16 characters', async () => {
    await renderParticipantsPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '계정 생성' }))
    await user.type(screen.getByLabelText('사용자 이름'), 'participant02')
    await user.type(screen.getByLabelText('참여자 코드'), 'P-002')
    await user.click(screen.getByRole('button', { name: '생성' }))

    expect((await screen.findByLabelText('할당된 비밀번호')).textContent).toHaveLength(18)
  })

  it('shows an assigned password once after create or reset', async () => {
    await renderParticipantsPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '비밀번호 재설정' }))
    await user.click(screen.getByRole('button', { name: '재설정' }))
    expect(await screen.findByLabelText('할당된 비밀번호')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByLabelText('할당된 비밀번호')).not.toBeInTheDocument()
  })

  it('does not offer public registration or forced-change controls', async () => {
    await renderParticipantsPage()

    expect(screen.queryByText(/회원가입|공개 등록|강제 변경/)).not.toBeInTheDocument()
  })
})
