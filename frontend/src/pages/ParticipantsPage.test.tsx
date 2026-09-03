import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiProvider } from '@/app/api-context'
import type { CreateParticipantInput, ParticipantRecord } from '@/app/contracts'
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

class DeferredParticipantApi extends MockAppApi {
  readonly createInputs: CreateParticipantInput[] = []
  readonly createRequests: Deferred<ParticipantRecord>[] = []
  readonly disableRequests: Deferred<ParticipantRecord>[] = []
  readonly listRequests: Deferred<ParticipantRecord[]>[] = []

  override createParticipant(input: CreateParticipantInput): Promise<ParticipantRecord> {
    this.createInputs.push(input)
    const request = deferred<ParticipantRecord>()
    this.createRequests.push(request)
    return request.promise
  }

  override listParticipants(): Promise<ParticipantRecord[]> {
    const request = deferred<ParticipantRecord[]>()
    this.listRequests.push(request)
    return request.promise
  }

  override disableParticipant(): Promise<ParticipantRecord> {
    const request = deferred<ParticipantRecord>()
    this.disableRequests.push(request)
    return request.promise
  }
}

function participant(overrides: Partial<ParticipantRecord> = {}): ParticipantRecord {
  return {
    id: 'participant-002',
    username: 'participant02',
    participantCode: 'P-002',
    status: 'active',
    interviewStatus: 'not_started',
    ...overrides,
  }
}

function renderWithApi(api: MockAppApi) {
  return render(
    <ApiProvider api={api}>
      <ParticipantsPage />
    </ApiProvider>,
  )
}

describe('ParticipantsPage', () => {
  beforeEach(installBrowserStorage)
  afterEach(() => {
    vi.unstubAllGlobals()
    installBrowserStorage()
  })

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

  it('normalizes whitespace and case before filtering participant rows', async () => {
    await renderParticipantsPage()
    const user = userEvent.setup()

    await user.type(screen.getByRole('searchbox', { name: '참여자 검색' }), '  p-001  ')

    expect(await screen.findByText('P-001')).toBeInTheDocument()
  })

  it('submits the administrator-edited assigned password', async () => {
    await renderParticipantsPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '계정 생성' }))
    const password = screen.getByLabelText('할당 비밀번호')
    await user.clear(password)
    await user.type(password, 'edited-password-123!')
    await user.type(screen.getByLabelText('사용자 이름'), 'participant02')
    await user.type(screen.getByLabelText('참여자 코드'), 'P-002')
    await user.click(screen.getByRole('button', { name: '생성' }))

    expect(await screen.findByLabelText('할당된 비밀번호')).toHaveTextContent('edited-password-123!')
  })

  it('locks duplicate create activation synchronously', async () => {
    const api = new DeferredParticipantApi()
    renderWithApi(api)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: '참여자' })
    await user.click(screen.getByRole('button', { name: '계정 생성' }))
    await user.type(screen.getByLabelText('사용자 이름'), 'participant02')
    await user.type(screen.getByLabelText('참여자 코드'), 'P-002')

    const form = screen.getByRole('button', { name: '생성' }).closest('form')!
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(api.createRequests).toHaveLength(1)
  })

  it('does not let a late list request overwrite a newly created returned record', async () => {
    const api = new DeferredParticipantApi()
    renderWithApi(api)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: '참여자' })
    await user.click(screen.getByRole('button', { name: '계정 생성' }))
    await user.type(screen.getByLabelText('사용자 이름'), 'participant02')
    await user.type(screen.getByLabelText('참여자 코드'), 'P-002')
    await user.click(screen.getByRole('button', { name: '생성' }))

    await act(async () => {
      api.createRequests[0].resolve(participant())
    })
    expect(await screen.findByText('P-002')).toBeInTheDocument()
    await act(async () => {
      api.listRequests[0].resolve([])
    })

    expect(screen.getByText('P-002')).toBeInTheDocument()
  })

  it('ignores a late create result after its dialog closes', async () => {
    const api = new DeferredParticipantApi()
    renderWithApi(api)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: '참여자' })
    await user.click(screen.getByRole('button', { name: '계정 생성' }))
    await user.type(screen.getByLabelText('사용자 이름'), 'participant02')
    await user.type(screen.getByLabelText('참여자 코드'), 'P-002')
    await user.click(screen.getByRole('button', { name: '생성' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await act(async () => {
      api.createRequests[0].resolve(participant())
    })

    expect(screen.queryByText('P-002')).not.toBeInTheDocument()
  })

  it('releases a dismissed disable request lock when that request settles', async () => {
    const api = new DeferredParticipantApi()
    renderWithApi(api)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: '참여자' })
    await act(async () => {
      api.listRequests[0].resolve([participant({ id: 'participant-001', participantCode: 'P-001', username: 'participant01' })])
    })

    await user.click(screen.getByRole('button', { name: '비활성화' }))
    await user.click(screen.getByRole('button', { name: '비활성화' }))
    expect(api.disableRequests).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: '비활성화' }))
    expect(screen.getByRole('button', { name: '비활성화' })).toBeDisabled()

    await act(async () => {
      api.disableRequests[0].resolve(participant({ id: 'participant-001', participantCode: 'P-001', username: 'participant01', status: 'disabled' }))
    })
    expect(screen.getByRole('button', { name: '비활성화' })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '비활성화' }))
    expect(api.disableRequests).toHaveLength(2)
  })

})
