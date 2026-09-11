import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiProvider } from '@/app/api-context'
import type { CreatedParticipant, CreateParticipantInput, ParticipantRecord, PasswordResult } from '@/app/contracts'
import { mockCredentials } from '@/mocks/fixtures'
import { MockAppApi } from '@/mocks/mock-api'
import { ParticipantsPage } from './ParticipantsPage'

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard')
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
const originalSessionStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage')

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

function installClipboard(clipboard: Pick<Clipboard, 'writeText'> | undefined): void {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  })
}

function restoreProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor)
    return
  }
  Reflect.deleteProperty(target, key)
}

function storageValues(storage: Storage): string[] {
  return Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index)!) ?? '')
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
  readonly createRequests: Deferred<CreatedParticipant>[] = []
  readonly disableRequests: Deferred<ParticipantRecord>[] = []
  readonly listRequests: Deferred<ParticipantRecord[]>[] = []
  readonly resetRequests: Deferred<PasswordResult>[] = []
  readonly unlockRequests: Deferred<ParticipantRecord>[] = []

  override createParticipant(input: CreateParticipantInput): Promise<CreatedParticipant> {
    this.createInputs.push(input)
    const request = deferred<CreatedParticipant>()
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

  override resetParticipantPassword(): Promise<PasswordResult> {
    const request = deferred<PasswordResult>()
    this.resetRequests.push(request)
    return request.promise
  }

  override unlockParticipant(): Promise<ParticipantRecord> {
    const request = deferred<ParticipantRecord>()
    this.unlockRequests.push(request)
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
  it('says whose password was assigned', async () => {
    const api = new MockAppApi()
    await api.login({ ...mockCredentials.admin, remember: false })
    const user = userEvent.setup()
    renderWithApi(api)
    await screen.findByText('P-001')

    await user.click(screen.getByRole('button', { name: '계정 생성' }))
    await user.click(screen.getByRole('button', { name: '생성' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/^KU-\d{3}$/)).toBeInTheDocument()
    expect(within(dialog).getByText('할당 비밀번호')).toBeInTheDocument()
  })

  it('brings a disabled participant back', async () => {
    const api = new MockAppApi()
    await api.login({ ...mockCredentials.admin, remember: false })
    const enableSpy = vi.spyOn(api, 'enableParticipant')
    const user = userEvent.setup()
    renderWithApi(api)
    await screen.findByText('P-001')

    await user.click(screen.getByRole('button', { name: '비활성화' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '비활성화' }))
    await screen.findByRole('button', { name: '활성화' })

    await user.click(screen.getByRole('button', { name: '활성화' }))
    await waitFor(() => expect(enableSpy).toHaveBeenCalled())
  })

  it('names the participant table for assistive technology', async () => {
    const api = new MockAppApi()
    await api.login({ ...mockCredentials.admin, remember: false })
    renderWithApi(api)

    expect(await screen.findByRole('table', { name: '참여자 목록' })).toBeInTheDocument()
  })

  it('creates an account without asking the reviewer to invent identifiers', async () => {
    const api = new MockAppApi()
    await api.login({ ...mockCredentials.admin, remember: false })
    const user = userEvent.setup()
    renderWithApi(api)
    await screen.findByText('P-001')

    await user.click(screen.getByRole('button', { name: '계정 생성' }))
    await user.click(screen.getByRole('button', { name: '생성' }))

    const revealed = await screen.findByLabelText('할당된 비밀번호')
    expect(revealed.textContent).toMatch(/^ku-\d{3}-[a-z0-9]{4,}$/)
    expect(within(await screen.findByRole('dialog')).getByText(/^KU-\d{3}$/)).toBeInTheDocument()
  })

  it('exports the interviews of the participants a reviewer selects', async () => {
    const api = new MockAppApi()
    await api.login({ ...mockCredentials.admin, remember: false })
    const exportSpy = vi.spyOn(api, 'exportInterviewsCsv')
      .mockResolvedValue(new Blob(['participantCode\nP-001']))
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const user = userEvent.setup()
    renderWithApi(api)
    await screen.findByText('P-001')

    await user.click(screen.getByRole('button', { name: '전체 CSV 다운로드' }))
    await waitFor(() => expect(exportSpy).toHaveBeenCalledWith({ participantIds: [] }))

    await user.click(screen.getByRole('checkbox', { name: 'P-001 선택' }))
    await user.click(screen.getByRole('button', { name: '선택 1명 CSV 다운로드' }))
    await waitFor(() => expect(exportSpy).toHaveBeenLastCalledWith({
      participantIds: [expect.any(String)],
    }))
  })

  it('selects and clears every participant at once', async () => {
    const api = new MockAppApi()
    await api.login({ ...mockCredentials.admin, remember: false })
    const user = userEvent.setup()
    renderWithApi(api)
    await screen.findByText('P-001')

    await user.click(screen.getByRole('checkbox', { name: '전체 선택' }))
    expect(screen.getByRole('checkbox', { name: 'P-001 선택' })).toBeChecked()

    await user.click(screen.getByRole('checkbox', { name: '전체 선택' }))
    expect(screen.getByRole('checkbox', { name: 'P-001 선택' })).not.toBeChecked()
  })

  beforeEach(installBrowserStorage)
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    restoreProperty(window.navigator, 'clipboard', originalClipboardDescriptor)
    restoreProperty(window, 'localStorage', originalLocalStorageDescriptor)
    restoreProperty(window, 'sessionStorage', originalSessionStorageDescriptor)
  })

  it('lists participant code, username, status, and interview status', async () => {
    await renderParticipantsPage()

    const row = await screen.findByRole('row', { name: /P-001.*participant01/i })
    expect(within(row).getByText('활성')).toBeInTheDocument()
    expect(within(row).getByText('진행 중')).toBeInTheDocument()
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

    expect((await screen.findAllByText('P-002')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('participant02').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('할당된 비밀번호')).toBeInTheDocument()
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
      api.createRequests[0].resolve({ participant: participant(), assignedPassword: 'ku-002-ab12' })
    })
    expect((await screen.findAllByText('P-002')).length).toBeGreaterThan(0)
    await act(async () => {
      api.listRequests[0].resolve([])
    })

    expect(screen.getAllByText('P-002').length).toBeGreaterThan(0)
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
    await user.click(screen.getByRole('button', { name: '대화상자 닫기' }))

    await act(async () => {
      api.createRequests[0].resolve({ participant: participant(), assignedPassword: 'ku-002-ab12' })
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
    await user.click(screen.getByRole('button', { name: '대화상자 닫기' }))
    await user.click(screen.getByRole('button', { name: '비활성화' }))
    expect(screen.getByRole('button', { name: '비활성화' })).toBeDisabled()

    await act(async () => {
      api.disableRequests[0].resolve(participant({ id: 'participant-001', participantCode: 'P-001', username: 'participant01', status: 'disabled' }))
    })
    expect(screen.getByRole('button', { name: '비활성화' })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '비활성화' }))
    expect(api.disableRequests).toHaveLength(2)
  })

  it('confirms disable once and renders the returned disabled record', async () => {
    const api = new DeferredParticipantApi()
    renderWithApi(api)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: '참여자' })
    await act(async () => api.listRequests[0].resolve([participant({ id: 'participant-001', participantCode: 'P-001', username: 'participant01' })]))
    await user.click(screen.getByRole('button', { name: '비활성화' }))
    expect(screen.getByRole('heading', { name: '참여자 비활성화' })).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: '비활성화' })
    act(() => {
      fireEvent.click(confirm)
      fireEvent.click(confirm)
    })
    expect(api.disableRequests).toHaveLength(1)
    await act(async () => api.disableRequests[0].resolve(participant({ id: 'participant-001', participantCode: 'P-001', username: 'participant01', status: 'disabled' })))
    expect(await screen.findByText('비활성')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '비활성화' })).not.toBeInTheDocument()
  })

  it('unlocks an administrator-locked participant and renders the committed state', async () => {
    const api = new DeferredParticipantApi()
    renderWithApi(api)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: '참여자' })
    await act(async () => api.listRequests[0].resolve([
      participant({ status: 'admin_locked' }),
    ]))

    expect(screen.getByText('관리자 잠금')).toBeInTheDocument()
    const unlock = screen.getByRole('button', { name: '잠금 해제' })
    await user.click(unlock)

    expect(api.unlockRequests).toHaveLength(1)
    expect(unlock).toBeDisabled()
    await act(async () => api.unlockRequests[0].resolve(participant({ status: 'active' })))

    expect(await screen.findByText('활성')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '잠금 해제' })).not.toBeInTheDocument()
  })

  it('retries a failed disable without mutating the active row', async () => {
    const api = new DeferredParticipantApi()
    renderWithApi(api)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: '참여자' })
    await act(async () => api.listRequests[0].resolve([
      participant({ id: 'participant-001', participantCode: 'P-001', username: 'participant01' }),
    ]))
    const table = screen.getByRole('table')

    await user.click(screen.getByRole('button', { name: '비활성화' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '비활성화' }))
    await act(async () => api.disableRequests[0].reject(new Error('rejected')))

    expect(await screen.findByRole('alert')).toHaveTextContent(/^참여자를 비활성화하지 못했습니다$/)
    const activeRow = within(table).getByText('P-001').closest('tr')!
    expect(within(activeRow).getByText('활성')).toBeInTheDocument()

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '비활성화' }))
    expect(api.disableRequests).toHaveLength(2)
    await act(async () => api.disableRequests[1].resolve(participant({
      id: 'participant-001',
      participantCode: 'P-001-RETURNED',
      status: 'disabled',
      username: 'participant-returned',
    })))

    const returnedRow = await screen.findByRole('row', { name: /P-001-RETURNED.*participant-returned/i })
    expect(within(returnedRow).getByText('비활성')).toBeInTheDocument()
    expect(within(returnedRow).queryByRole('button', { name: '비활성화' })).not.toBeInTheDocument()
  })

  it('allows reset retry after a rejected request and shows only its returned secret', async () => {
    const api = new DeferredParticipantApi()
    renderWithApi(api)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: '참여자' })
    await act(async () => api.listRequests[0].resolve([participant({ id: 'participant-001', participantCode: 'P-001', username: 'participant01' })]))
    await user.click(screen.getByRole('button', { name: '비밀번호 재설정' }))
    const reset = screen.getByRole('button', { name: '재설정' })
    act(() => {
      fireEvent.click(reset)
      fireEvent.click(reset)
    })
    expect(api.resetRequests).toHaveLength(1)
    await act(async () => api.resetRequests[0].reject(new Error('rejected')))
    expect(await screen.findByRole('alert')).toHaveTextContent('비밀번호를 재설정하지 못했습니다')
    await user.click(screen.getByRole('button', { name: '재설정' }))
    expect(api.resetRequests).toHaveLength(2)
    await act(async () => api.resetRequests[1].resolve({ assignedPassword: 'reset-secret-12345!' }))
    expect(await screen.findByLabelText('할당된 비밀번호')).toHaveTextContent('reset-secret-12345!')
  })


  it('announces clipboard success without repeating the assigned password', async () => {
    const api = new DeferredParticipantApi()
    renderWithApi(api)
    const user = userEvent.setup()
    const assignedPassword = 'clipboard-success-secret!'
    const writeText = vi.fn().mockResolvedValue(undefined)
    await screen.findByRole('heading', { name: '참여자' })
    await act(async () => api.listRequests[0].resolve([participant()]))
    await user.click(screen.getByRole('button', { name: '비밀번호 재설정' }))
    await user.click(screen.getByRole('button', { name: '재설정' }))
    await act(async () => api.resetRequests[0].resolve({ assignedPassword }))
    installClipboard({ writeText })

    await user.click(screen.getByRole('button', { name: '복사' }))

    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith(assignedPassword)
    const feedback = await screen.findByText('복사했습니다')
    expect(feedback).toHaveAttribute('role', 'status')
    expect(feedback).toHaveTextContent(/^복사했습니다$/)
    expect(feedback).not.toHaveTextContent(assignedPassword)
  })

  it('announces unavailable clipboard access without repeating the assigned password', async () => {
    const api = new DeferredParticipantApi()
    renderWithApi(api)
    const user = userEvent.setup()
    const assignedPassword = 'clipboard-unavailable-secret!'
    await screen.findByRole('heading', { name: '참여자' })
    await act(async () => api.listRequests[0].resolve([participant()]))
    await user.click(screen.getByRole('button', { name: '비밀번호 재설정' }))
    await user.click(screen.getByRole('button', { name: '재설정' }))
    await act(async () => api.resetRequests[0].resolve({ assignedPassword }))
    installClipboard(undefined)

    await user.click(screen.getByRole('button', { name: '복사' }))

    const feedback = await screen.findByText('복사하지 못했습니다')
    expect(feedback).toHaveAttribute('role', 'status')
    expect(feedback).toHaveTextContent(/^복사하지 못했습니다$/)
    expect(feedback).not.toHaveTextContent(assignedPassword)
  })

  it('announces a rejected clipboard write without repeating the assigned password', async () => {
    const api = new DeferredParticipantApi()
    renderWithApi(api)
    const user = userEvent.setup()
    const assignedPassword = 'clipboard-rejected-secret!'
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    await screen.findByRole('heading', { name: '참여자' })
    await act(async () => api.listRequests[0].resolve([participant()]))
    await user.click(screen.getByRole('button', { name: '비밀번호 재설정' }))
    await user.click(screen.getByRole('button', { name: '재설정' }))
    await act(async () => api.resetRequests[0].resolve({ assignedPassword }))
    installClipboard({ writeText })

    await user.click(screen.getByRole('button', { name: '복사' }))

    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith(assignedPassword)
    const feedback = await screen.findByText('복사하지 못했습니다')
    expect(feedback).toHaveAttribute('role', 'status')
    expect(feedback).toHaveTextContent(/^복사하지 못했습니다$/)
    expect(feedback).not.toHaveTextContent(assignedPassword)
  })

  it('removes a returned reset password from the document, table, and storage after close', async () => {
    const api = new DeferredParticipantApi()
    renderWithApi(api)
    const user = userEvent.setup()
    const assignedPassword = 'reset-lifecycle-secret!'
    await screen.findByRole('heading', { name: '참여자' })
    await act(async () => api.listRequests[0].resolve([participant()]))
    const table = screen.getByRole('table')
    await user.click(screen.getByRole('button', { name: '비밀번호 재설정' }))
    await user.click(screen.getByRole('button', { name: '재설정' }))
    await act(async () => api.resetRequests[0].resolve({ assignedPassword }))

    expect(await screen.findByLabelText('할당된 비밀번호')).toHaveTextContent(assignedPassword)
    expect(table).not.toHaveTextContent(assignedPassword)
    await user.click(screen.getByRole('button', { name: '닫기' }))

    expect(api.resetRequests).toHaveLength(1)
    expect(api.createRequests).toHaveLength(0)
    expect(document.body).not.toHaveTextContent(assignedPassword)
    expect(screen.getByRole('table')).not.toHaveTextContent(assignedPassword)
    expect(storageValues(window.localStorage).every((value) => !value.includes(assignedPassword))).toBe(true)
    expect(storageValues(window.sessionStorage).every((value) => !value.includes(assignedPassword))).toBe(true)
  })

  it('keeps desktop headers and mobile labels with wrapping participant values', async () => {
    await renderParticipantsPage()
    expect(screen.getByRole('columnheader', { name: '코드' })).toBeInTheDocument()
    const row = await screen.findByRole('row', { name: /P-001.*participant01/i })
    expect(within(row).getByText('코드:')).toBeInTheDocument()
    expect(within(row).getByText('사용자:')).toBeInTheDocument()
    expect(within(row).getByText('계정:')).toBeInTheDocument()
    expect(within(row).getByText('인터뷰:')).toBeInTheDocument()
    expect(within(row).getByText('participant01')).toHaveClass('break-words', 'whitespace-normal')
  })

})
