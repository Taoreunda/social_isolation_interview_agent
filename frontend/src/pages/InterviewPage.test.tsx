import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiProvider } from '@/app/api-context'
import { ApiError } from '@/app/api-error'
import type { AppApi, InterviewDetail, ParticipantInterview } from '@/app/contracts'
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

function detailOf(current: ParticipantInterview = interview): InterviewDetail {
  return {
    ...structuredClone(current), participantCode: '관리자 (testadmin)', reviewStatus: 'unreviewed',
    scorecard: [{ questionId: 'A1', question: '집에 있었습니까?', answer: null, value: null, rationale: null, aiStatus: null, expertStatus: null, expertRationale: null }],
    finalDiagnosis: null, criteria: { A: null, B: null, C: null, D: null }, report: null, algorithmVersion: 'react-scorecard-v1', completedAt: null,
  }
}

function createApi(overrides: Partial<AppApi> = {}): AppApi {
  return {
    login: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    changePassword: vi.fn(),
    getCurrentInterview: vi.fn().mockResolvedValue(cloneInterview()),
    startInterview: vi.fn().mockResolvedValue(cloneInterview()),
    sendMessage: vi.fn().mockResolvedValue(cloneInterview()),
    listParticipants: vi.fn(),
    createParticipant: vi.fn(),
    resetParticipantPassword: vi.fn(),
    disableParticipant: vi.fn(),
    enableParticipant: vi.fn(),
    unlockParticipant: vi.fn(),
    listInterviews: vi.fn(),
    getInterview: vi.fn().mockImplementation(async () => detailOf()),
    reviewScorecard: vi.fn(),
    archiveInterview: vi.fn(),
    exportInterviewCsv: vi.fn(),
    exportInterviewsCsv: vi.fn(),
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

    expect(await screen.findByRole('heading', { name: '인터뷰 진행 중' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '진행률' })).toHaveAttribute('aria-valuenow', '40')
    expect(screen.getByLabelText('인터뷰 진행자 메시지')).toHaveTextContent('최근 한 달간 일상을 이야기해 주세요.')
  })

  it('submits a non-empty answer with a UUID turn id', async () => {
    const api = createApi()
    const user = userEvent.setup()
    renderInterview(api)
    await screen.findByRole('heading', { name: '인터뷰 진행 중' })

    await user.type(screen.getByLabelText('답변 입력'), '  혼자 지냈습니다  ')
    await user.click(screen.getByRole('button', { name: '답변 전송' }))

    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith(
      'interview-001',
      'ed7d20c9-392d-48ea-9e8f-e1e965991edc',
      '혼자 지냈습니다',
    ))
    expect(crypto.randomUUID).toHaveBeenCalledOnce()
  })

  it('offers no send until there is something to send', async () => {
    const api = createApi()
    const user = userEvent.setup()
    renderInterview(api)
    await screen.findByRole('heading', { name: '인터뷰 진행 중' })

    expect(screen.getByRole('button', { name: '답변 전송' })).toBeDisabled()

    await user.type(screen.getByLabelText('답변 입력'), '   ')
    expect(screen.getByRole('button', { name: '답변 전송' })).toBeDisabled()

    await user.type(screen.getByLabelText('답변 입력'), '실제 답변')
    expect(screen.getByRole('button', { name: '답변 전송' })).toBeEnabled()
  })

  it('rejects whitespace-only answers', async () => {
    const api = createApi()
    const user = userEvent.setup()
    renderInterview(api)
    await screen.findByRole('heading', { name: '인터뷰 진행 중' })

    await user.type(screen.getByLabelText('답변 입력'), '   ')
    await user.click(screen.getByRole('button', { name: '답변 전송' }))

    expect(api.sendMessage).not.toHaveBeenCalled()
    expect(crypto.randomUUID).not.toHaveBeenCalled()
  })

  it('disables duplicate submission while sending', async () => {
    const response = deferred<ParticipantInterview>()
    const api = createApi({ sendMessage: vi.fn(() => response.promise) })
    renderInterview(api)
    await screen.findByRole('heading', { name: '인터뷰 진행 중' })
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
    await screen.findByRole('heading', { name: '인터뷰 진행 중' })
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
    await screen.findByRole('heading', { name: '인터뷰 진행 중' })

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
    await screen.findByRole('heading', { name: '인터뷰 진행 중' })
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
    expect(await screen.findByRole('heading', { name: '인터뷰 진행 중' })).toBeInTheDocument()
  })

  it('ignores a load result after unmount', async () => {
    const load = deferred<ParticipantInterview>()
    const api = createApi({ getCurrentInterview: vi.fn(() => load.promise) })
    const page = renderInterview(api)
    page.unmount()

    await act(async () => load.resolve(cloneInterview()))
    expect(screen.queryByRole('heading', { name: '인터뷰 진행 중' })).not.toBeInTheDocument()
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

  it('docks the composer under a scrollable conversation', async () => {
    const api = createApi()
    renderInterview(api)
    await screen.findByRole('heading', { name: '인터뷰 진행 중' })

    const main = screen.getByRole('main')
    expect(main).toHaveClass('flex', 'flex-col', 'flex-1')

    const scroller = screen.getByRole('list', { name: '인터뷰 대화' }).parentElement
    expect(scroller).toHaveClass('flex-1', 'overflow-y-auto')

    // The composer closes the chat column, whatever sits beside that column.
    const form = screen.getByLabelText('답변 입력').closest('form')!
    expect(form.parentElement?.lastElementChild).toBe(form)
    expect(main).toContainElement(form)
  })

  it('shows the answer and a generating status while the turn is in flight', async () => {
    const response = deferred<ParticipantInterview>()
    const api = createApi({ sendMessage: vi.fn(() => response.promise) })
    const user = userEvent.setup()
    renderInterview(api)
    await screen.findByRole('heading', { name: '인터뷰 진행 중' })
    await user.type(screen.getByLabelText('답변 입력'), '보내는 중인 답변')
    await user.click(screen.getByRole('button', { name: '답변 전송' }))

    expect(screen.getByLabelText('참여자 메시지')).toHaveTextContent('보내는 중인 답변')
    expect(screen.getByLabelText('답변 입력')).toHaveValue('')
    expect(screen.getByText('답변을 생성하는 중')).toHaveAttribute('role', 'status')

    await act(async () => response.resolve(cloneInterview()))
    expect(screen.queryByText('답변을 생성하는 중')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('참여자 메시지')).not.toBeInTheDocument()
  })

  it('keeps an unsent answer visible after a send error', async () => {
    const api = createApi({ sendMessage: vi.fn().mockRejectedValue(new Error('lost response')) })
    const user = userEvent.setup()
    renderInterview(api)
    await screen.findByRole('heading', { name: '인터뷰 진행 중' })
    await user.type(screen.getByLabelText('답변 입력'), '잃으면 안 되는 답변')
    await user.click(screen.getByRole('button', { name: '답변 전송' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByLabelText('참여자 메시지')).toHaveTextContent('잃으면 안 되는 답변')
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    expect(screen.queryByText('답변을 생성하는 중')).not.toBeInTheDocument()
  })

  it('separates interviewer and participant turns onto distinct surfaces', async () => {
    const conversation = cloneInterview({
      ...interview,
      messages: [
        { id: 'message-001', role: 'assistant', content: '질문입니다.', createdAt: '2026-08-25T09:00:00.000Z' },
        { id: 'message-002', role: 'user', content: '답변입니다.', createdAt: '2026-08-25T09:01:00.000Z' },
      ],
    })
    const api = createApi({ getCurrentInterview: vi.fn().mockResolvedValue(conversation) })
    renderInterview(api)

    const interviewer = (await screen.findByLabelText('인터뷰 진행자 메시지')).querySelector('p')
    const participant = screen.getByLabelText('참여자 메시지').querySelector('p')

    expect(interviewer).toHaveClass('bg-muted')
    expect(participant).toHaveClass('bg-primary', 'text-primary-foreground')
    expect(interviewer).not.toHaveClass('bg-primary')
    expect(participant).not.toHaveClass('bg-muted')
    expect(interviewer).toHaveClass('whitespace-pre-wrap')
    expect(participant).toHaveClass('whitespace-pre-wrap')
  })

  it('renders multiline messages and a completion state that only offers a new interview', async () => {
    const complete = cloneInterview({ ...interview, status: 'completed', progress: 100 })
    const api = createApi({ getCurrentInterview: vi.fn().mockResolvedValue(complete) })
    renderInterview(api)

    expect(await screen.findByText('완료했습니다')).toBeInTheDocument()
    expect(screen.getByLabelText('인터뷰 진행자 메시지').querySelector('p')).toHaveClass('whitespace-pre-wrap')
    expect(screen.queryByLabelText('답변 입력')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '초기화' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '새 인터뷰 시작' })).toBeInTheDocument()
  })
})

describe('starting an interview', () => {
  it('waits to be asked instead of creating one on arrival', async () => {
    const startInterview = vi.fn().mockResolvedValue(cloneInterview())
    const api = createApi({
      getCurrentInterview: vi.fn().mockRejectedValue(new ApiError(404, '인터뷰를 찾을 수 없습니다.')),
      startInterview,
    })
    renderInterview(api)

    const start = await screen.findByRole('button', { name: '인터뷰 시작' })
    expect(startInterview).not.toHaveBeenCalled()

    await userEvent.click(start)

    expect(startInterview).toHaveBeenCalledOnce()
    expect(await screen.findByRole('heading', { name: '인터뷰 진행 중' })).toBeInTheDocument()
  })

  it('lets a participant who finished begin a new one', async () => {
    const startInterview = vi.fn().mockResolvedValue(cloneInterview())
    const api = createApi({
      getCurrentInterview: vi.fn().mockResolvedValue(
        cloneInterview({ ...interview, status: 'completed' }),
      ),
      startInterview,
    })
    renderInterview(api)
    await screen.findByRole('heading', { name: '완료했습니다' })

    await userEvent.click(screen.getByRole('button', { name: '새 인터뷰 시작' }))

    expect(startInterview).toHaveBeenCalledOnce()
    expect(await screen.findByRole('heading', { name: '인터뷰 진행 중' })).toBeInTheDocument()
  })

  it('says so when an interview cannot be started', async () => {
    const api = createApi({
      getCurrentInterview: vi.fn().mockRejectedValue(new ApiError(404, '없음')),
      startInterview: vi.fn().mockRejectedValue(new ApiError(503, '사용할 수 없음')),
    })
    renderInterview(api)

    await userEvent.click(await screen.findByRole('button', { name: '인터뷰 시작' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('인터뷰를 시작하지 못했습니다')
  })
})

describe('starting an interview over', () => {
  function renderRestartable(api: AppApi) {
    return render(<ApiProvider api={api}><InterviewPage adminTools debug /></ApiProvider>)
  }

  it('lets an administrator start over from a running interview', async () => {
    const fresh = cloneInterview({
      ...interview,
      id: 'interview-002',
      messages: [{ ...interview.messages[0], id: 'message-new', content: '새로 시작합니다.' }],
    })
    const archiveInterview = vi.fn().mockResolvedValue({})
    const startInterview = vi.fn().mockResolvedValue(fresh)
    const api = createApi({ archiveInterview, startInterview })
    const user = userEvent.setup()
    renderRestartable(api)
    await screen.findByRole('heading', { name: '인터뷰 진행 중' })

    await user.click(screen.getByRole('button', { name: '처음부터 다시' }))
    await user.click(await screen.findByRole('button', { name: '다시 시작' }))

    await waitFor(() => expect(startInterview).toHaveBeenCalledOnce())
    expect(archiveInterview).toHaveBeenCalledWith('interview-001')
    expect(archiveInterview.mock.invocationCallOrder[0])
      .toBeLessThan(startInterview.mock.invocationCallOrder[0])
    expect(await screen.findByText('새로 시작합니다.')).toBeInTheDocument()
  })

  it('keeps the running interview when the administrator cancels', async () => {
    const api = createApi({ archiveInterview: vi.fn() })
    const user = userEvent.setup()
    renderRestartable(api)
    await screen.findByRole('heading', { name: '인터뷰 진행 중' })

    await user.click(screen.getByRole('button', { name: '처음부터 다시' }))
    await user.click(await screen.findByRole('button', { name: '취소' }))

    expect(api.archiveInterview).not.toHaveBeenCalled()
    expect(screen.getByLabelText('답변 입력')).toBeInTheDocument()
  })

  it('does not offer a participant a way to start over', async () => {
    renderInterview(createApi())
    await screen.findByRole('heading', { name: '인터뷰 진행 중' })

    expect(screen.queryByRole('button', { name: '처음부터 다시' })).not.toBeInTheDocument()
  })

  it('says so when starting over fails', async () => {
    const api = createApi({ archiveInterview: vi.fn().mockRejectedValue(new ApiError(503, '사용할 수 없음')) })
    const user = userEvent.setup()
    renderRestartable(api)
    await screen.findByRole('heading', { name: '인터뷰 진행 중' })

    await user.click(screen.getByRole('button', { name: '처음부터 다시' }))
    await user.click(await screen.findByRole('button', { name: '다시 시작' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('다시 시작하지 못했습니다')
  })
})

describe('chat layout', () => {
  it('keeps a short conversation next to the composer instead of floating at the top', async () => {
    renderInterview(createApi())
    await screen.findByLabelText('답변 입력')

    const list = screen.getByRole('list', { name: '인터뷰 대화' })
    expect(list.parentElement).toHaveClass('flex', 'flex-col', 'flex-1', 'overflow-y-auto')
    expect(list).toHaveClass('mt-auto')
  })

  it('puts the title and progress on one strip and keeps administrator tools out of it', async () => {
    render(<ApiProvider api={createApi()}><InterviewPage adminTools debug /></ApiProvider>)
    await screen.findByLabelText('답변 입력')

    const strip = screen.getByRole('heading', { name: '인터뷰 진행 중' }).parentElement!
    expect(within(strip).getByRole('progressbar', { name: '진행률' })).toBeInTheDocument()
    expect(within(strip).getByText('40%')).toBeInTheDocument()
    expect(within(strip).queryByRole('button', { name: '처음부터 다시' })).not.toBeInTheDocument()
    const panel = await screen.findByRole('region', { name: '디버깅' })
    expect(within(panel).getByRole('button', { name: '처음부터 다시' })).toBeInTheDocument()
  })

  it('keeps the composer two lines tall instead of growing with the text', async () => {
    renderInterview(createApi())
    const input = await screen.findByLabelText('답변 입력')

    expect(input).toHaveAttribute('rows', '2')
    expect(input).toHaveClass('field-sizing-fixed', 'resize-none')
    expect(input).not.toHaveClass('field-sizing-content')
  })

  it('sends on Enter and keeps Shift+Enter for a new line', async () => {
    const api = createApi()
    const user = userEvent.setup()
    renderInterview(api)
    const input = await screen.findByLabelText('답변 입력')

    await user.type(input, '첫 줄{Shift>}{Enter}{/Shift}둘째 줄')
    expect(api.sendMessage).not.toHaveBeenCalled()
    expect(input).toHaveValue('첫 줄\n둘째 줄')

    await user.type(input, '{Enter}')
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith('interview-001', expect.any(String), '첫 줄\n둘째 줄'))
  })

  it('does not send while Korean input is still being composed', async () => {
    const api = createApi()
    renderInterview(api)
    const input = await screen.findByLabelText('답변 입력')

    fireEvent.change(input, { target: { value: '작성 중' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })

    expect(api.sendMessage).not.toHaveBeenCalled()
  })

  it('shows the generating notice in the interviewer column', async () => {
    const pending = deferred<ParticipantInterview>()
    const api = createApi({ sendMessage: vi.fn().mockReturnValue(pending.promise) })
    const user = userEvent.setup()
    renderInterview(api)
    await user.type(await screen.findByLabelText('답변 입력'), '응답')
    await user.click(screen.getByRole('button', { name: '답변 전송' }))

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('답변을 생성하는 중')
    expect(screen.getByRole('list', { name: '인터뷰 대화' })).toContainElement(notice)

    await act(async () => pending.resolve(cloneInterview()))
  })
})

describe('debug mode', () => {
  it('shows the judgment flow while debugging is on and refreshes it after a turn', async () => {
    const api = createApi()
    const user = userEvent.setup()
    render(<ApiProvider api={api}><InterviewPage adminTools debug /></ApiProvider>)

    const panel = await screen.findByRole('region', { name: '디버깅' })
    expect(within(panel).getByRole('list', { name: '판정 흐름' })).toBeInTheDocument()
    expect(api.getInterview).toHaveBeenCalledWith('interview-001')

    await user.type(screen.getByLabelText('답변 입력'), '네')
    await user.click(screen.getByRole('button', { name: '답변 전송' }))

    await waitFor(() => expect(api.getInterview).toHaveBeenCalledTimes(2))
  })

  it('docks the panel to the right edge as a sidebar', async () => {
    render(<ApiProvider api={createApi()}><InterviewPage adminTools debug /></ApiProvider>)

    const panel = await screen.findByRole('region', { name: '디버깅' })
    const main = screen.getByRole('main')
    expect(main.lastElementChild).toBe(panel)
    expect(main).toHaveClass('lg:grid')
    expect(main).not.toHaveClass('max-w-6xl', 'max-w-3xl')
    expect(panel).toHaveClass('lg:border-l', 'lg:overflow-y-auto')
    const chatColumn = screen.getByRole('list', { name: '인터뷰 대화' }).closest('[data-chat-column]')
    expect(chatColumn).toHaveClass('max-w-3xl', 'mx-auto')
  })

  it('shows nothing of the sort while debugging is off, even to an administrator', async () => {
    const api = createApi()
    render(<ApiProvider api={api}><InterviewPage adminTools /></ApiProvider>)
    await screen.findByLabelText('답변 입력')

    expect(screen.queryByRole('region', { name: '디버깅' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '처음부터 다시' })).not.toBeInTheDocument()
    expect(api.getInterview).not.toHaveBeenCalled()
  })

  it('never shows the panel to a participant, whatever the flag says', async () => {
    const api = createApi()
    render(<ApiProvider api={api}><InterviewPage debug /></ApiProvider>)
    await screen.findByLabelText('답변 입력')

    expect(screen.queryByRole('region', { name: '디버깅' })).not.toBeInTheDocument()
    expect(api.getInterview).not.toHaveBeenCalled()
  })

  it('says so when the flow cannot be loaded', async () => {
    const api = createApi({ getInterview: vi.fn().mockRejectedValue(new ApiError(503, '불가')) })
    render(<ApiProvider api={api}><InterviewPage adminTools debug /></ApiProvider>)

    expect(await screen.findByRole('alert')).toHaveTextContent('판정 흐름을 불러오지 못했습니다')
  })
})
