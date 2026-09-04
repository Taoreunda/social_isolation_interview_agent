import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiProvider } from '@/app/api-context'
import { ApiError } from '@/app/api-error'
import type { AppApi, ParticipantInterview } from '@/app/contracts'
import { mockCredentials } from '@/mocks/fixtures'
import { MockAppApi } from '@/mocks/mock-api'
import { InterviewPage } from './InterviewPage'

const interview: ParticipantInterview = {
  id: 'interview-001',
  status: 'active',
  progress: 40,
  updatedAt: '2026-08-25T09:00:00.000Z',
  messages: [
    {
      id: 'message-001',
      role: 'assistant',
      content: '안녕하세요.\n최근 한 달간 일상을 이야기해 주세요.',
      createdAt: '2026-08-25T09:00:00.000Z',
    },
  ],
}

function cloneInterview(detail: ParticipantInterview = interview): ParticipantInterview {
  return structuredClone(detail)
}

function createApi(overrides: Partial<AppApi> = {}): AppApi {
  return {
    login: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    changePassword: vi.fn(),
    getCurrentInterview: vi.fn().mockResolvedValue(cloneInterview()),
    sendMessage: vi.fn().mockResolvedValue(cloneInterview()),
    listParticipants: vi.fn(),
    createParticipant: vi.fn(),
    resetParticipantPassword: vi.fn(),
    disableParticipant: vi.fn(),
    unlockParticipant: vi.fn(),
    listInterviews: vi.fn(),
    getInterview: vi.fn(),
    reviewScorecard: vi.fn(),
    exportInterviewCsv: vi.fn(),
    ...overrides,
  }
}

function renderInterview(api: AppApi) {
  return render(<ApiProvider api={api}><InterviewPage /></ApiProvider>)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
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

const nativeCrypto = globalThis.crypto

beforeEach(() => {
  Object.defineProperties(window, {
    localStorage: { configurable: true, value: createStorage() },
    sessionStorage: { configurable: true, value: createStorage() },
  })
  vi.stubGlobal('crypto', {
    getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
    randomUUID: vi.fn(() => 'ed7d20c9-392d-48ea-9e8f-e1e965991edc'),
    subtle: nativeCrypto.subtle,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('InterviewPage', () => {
  it('loads the current interview and progress', async () => {
    const api = createApi()
    renderInterview(api)

    expect(await screen.findByRole('heading', { name: '인터뷰 시작' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '진행률' })).toHaveAttribute('aria-valuenow', '40')
    expect(screen.getByLabelText('인터뷰 진행자 메시지')).toHaveTextContent('최근 한 달간 일상을 이야기해 주세요.')
  })

  it('submits a non-empty answer with a UUID turn id', async () => {
    const api = createApi()
    const user = userEvent.setup()
    renderInterview(api)
    await screen.findByRole('heading', { name: '인터뷰 시작' })

    await user.type(screen.getByLabelText('답변 입력'), '  혼자 지냈습니다  ')
    await user.click(screen.getByRole('button', { name: '답변 전송' }))

    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith(
      'interview-001',
      'ed7d20c9-392d-48ea-9e8f-e1e965991edc',
      '혼자 지냈습니다',
    ))
    expect(crypto.randomUUID).toHaveBeenCalledOnce()
  })

  it('rejects whitespace-only answers', async () => {
    const api = createApi()
    const user = userEvent.setup()
    renderInterview(api)
    await screen.findByRole('heading', { name: '인터뷰 시작' })

    await user.type(screen.getByLabelText('답변 입력'), '   ')
    await user.click(screen.getByRole('button', { name: '답변 전송' }))

    expect(api.sendMessage).not.toHaveBeenCalled()
    expect(crypto.randomUUID).not.toHaveBeenCalled()
  })

  it('disables duplicate submission while sending', async () => {
    const response = deferred<ParticipantInterview>()
    const api = createApi({ sendMessage: vi.fn(() => response.promise) })
    renderInterview(api)
    await screen.findByRole('heading', { name: '인터뷰 시작' })
    fireEvent.change(screen.getByLabelText('답변 입력'), { target: { value: '답변' } })
    const form = screen.getByRole('button', { name: '답변 전송' }).closest('form')!

    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(api.sendMessage).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '답변 전송' })).toBeDisabled()
    await act(async () => response.resolve(cloneInterview()))
  })

  it('retries with the same UUID and answer after a send error', async () => {
    const api = createApi({
      sendMessage: vi.fn()
        .mockRejectedValueOnce(new Error('lost response'))
        .mockResolvedValueOnce(cloneInterview()),
    })
    const user = userEvent.setup()
    renderInterview(api)
    await screen.findByRole('heading', { name: '인터뷰 시작' })
    await user.type(screen.getByLabelText('답변 입력'), '응답')
    await user.click(screen.getByRole('button', { name: '답변 전송' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(2))
    expect(api.sendMessage).toHaveBeenNthCalledWith(1, 'interview-001', 'ed7d20c9-392d-48ea-9e8f-e1e965991edc', '응답')
    expect(api.sendMessage).toHaveBeenNthCalledWith(2, 'interview-001', 'ed7d20c9-392d-48ea-9e8f-e1e965991edc', '응답')
    expect(crypto.randomUUID).toHaveBeenCalledOnce()
  })

  it('retries a committed real mock turn without duplicating it and shows the retry action', async () => {
    const api = new MockAppApi()
    await api.login({ ...mockCredentials.participant, remember: false })
    const commitTurn = api.sendMessage.bind(api)
    let rejectCommittedResponse = true
    vi.spyOn(api, 'sendMessage').mockImplementation(async (...args) => {
      const committed = await commitTurn(...args)
      if (rejectCommittedResponse) {
        rejectCommittedResponse = false
        throw new Error('response lost after commit')
      }
      return committed
    })
    const user = userEvent.setup()
    renderInterview(api)
    await screen.findByRole('heading', { name: '인터뷰 시작' })

    await user.type(screen.getByLabelText('답변 입력'), '커밋 후 재시도 응답')
    await user.click(screen.getByRole('button', { name: '답변 전송' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('답변을 보내지 못했습니다')

    const retry = screen.getByRole('button', { name: '다시 시도' })
    expect(within(retry).getByText('다시 시도')).not.toHaveClass('sr-only')
    await user.click(retry)

    expect(await screen.findByText('커밋 후 재시도 응답')).toBeInTheDocument()
    const latest = await api.getCurrentInterview()
    expect(latest.messages.filter((message) => message.content === '커밋 후 재시도 응답')).toHaveLength(1)
    expect(latest.messages).toHaveLength(3)
  })

  it('restores the latest committed mock turn after remount', async () => {
    const latest = cloneInterview({
      ...interview,
      messages: [...interview.messages, {
        id: 'message-002', role: 'user', content: '새 응답', createdAt: interview.updatedAt,
      }],
    })
    const api = createApi({ getCurrentInterview: vi.fn().mockResolvedValue(latest) })
    const first = renderInterview(api)
    await screen.findByText('새 응답')
    first.unmount()

    renderInterview(api)
    expect(await screen.findByText('새 응답')).toBeInTheDocument()
    expect(api.getCurrentInterview).toHaveBeenCalledTimes(2)
  })

  it('replaces local content only with a committed send response', async () => {
    const committed = cloneInterview({
      ...interview,
      progress: 60,
      messages: [...interview.messages, {
        id: 'message-002', role: 'user', content: '서버 응답', createdAt: interview.updatedAt,
      }],
    })
    const api = createApi({ sendMessage: vi.fn().mockResolvedValue(committed) })
    const user = userEvent.setup()
    renderInterview(api)
    await screen.findByRole('heading', { name: '인터뷰 시작' })
    await user.type(screen.getByLabelText('답변 입력'), '로컬 초안')
    await user.click(screen.getByRole('button', { name: '답변 전송' }))

    expect(await screen.findByText('서버 응답')).toBeInTheDocument()
    expect(screen.queryByText('로컬 초안')).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '진행률' })).toHaveAttribute('aria-valuenow', '60')
  })

  it('shows recoverable load and send errors', async () => {
    const api = createApi({ getCurrentInterview: vi.fn().mockRejectedValueOnce(new Error('load failed')).mockResolvedValue(cloneInterview()) })
    const user = userEvent.setup()
    renderInterview(api)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('heading', { name: '인터뷰 시작' })).toBeInTheDocument()
  })

  it('shows a stable state when the live interview API is not connected', async () => {
    const api = createApi({
      getCurrentInterview: vi.fn().mockRejectedValue(
        new ApiError(501, '인터뷰 기능은 아직 연결되지 않았습니다.'),
      ),
    })

    renderInterview(api)

    expect(await screen.findByText('인터뷰 기능은 아직 연결되지 않았습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
  })

  it('ignores a load result after unmount', async () => {
    const load = deferred<ParticipantInterview>()
    const api = createApi({ getCurrentInterview: vi.fn(() => load.promise) })
    const page = renderInterview(api)
    page.unmount()

    await act(async () => load.resolve(cloneInterview()))
    expect(screen.queryByRole('heading', { name: '인터뷰 시작' })).not.toBeInTheDocument()
  })

  it('hides scorecard and diagnosis from participants', async () => {
    const unsafeResponse = {
      ...cloneInterview(),
      participantCode: 'P-001',
      reviewStatus: 'unreviewed',
      scorecard: [{
        questionId: 'q1',
        question: '연구 전용 질문',
        value: '연구 전용 값',
        rationale: '연구 전용 근거',
        aiStatus: 'positive',
      }],
    }
    const api = createApi({ getCurrentInterview: vi.fn().mockResolvedValue(unsafeResponse) })
    renderInterview(api)
    const page = await screen.findByRole('main')

    expect(page).not.toHaveTextContent('연구 전용 질문')
    expect(page).not.toHaveTextContent('연구 전용 값')
    expect(page).not.toHaveTextContent('연구 전용 근거')
  })

  it('renders multiline messages and a neutral completion state without reset actions', async () => {
    const complete = cloneInterview({ ...interview, status: 'completed', progress: 100 })
    const api = createApi({ getCurrentInterview: vi.fn().mockResolvedValue(complete) })
    renderInterview(api)

    expect(await screen.findByText('완료했습니다')).toBeInTheDocument()
    expect(screen.getByLabelText('인터뷰 진행자 메시지').querySelector('p')).toHaveClass('whitespace-pre-wrap')
    expect(screen.queryByLabelText('답변 입력')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /새 인터뷰|초기화/ })).not.toBeInTheDocument()
  })
})
