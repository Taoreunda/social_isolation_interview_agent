import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiProvider } from '@/app/api-context'
import { ApiError } from '@/app/api-error'
import type { AppApi, InterviewDetail, InterviewListItem } from '@/app/contracts'
import { AdminDashboardPage } from './AdminDashboardPage'
import { InterviewReviewPage } from './InterviewReviewPage'
import { InterviewTranscriptPage } from './InterviewTranscriptPage'

const detail: InterviewDetail = {
  id: 'interview-001',
  participantCode: 'P-001',
  status: 'completed',
  progress: 100,
  reviewStatus: 'unreviewed',
  updatedAt: '2026-08-25T09:00:00.000Z',
  finalDiagnosis: '히키코모리',
  criteria: { A: true, B: true, C: true, D: false },
  report: '평가를 모두 마쳤습니다.',
  algorithmVersion: 'react-scorecard-v1',
  completedAt: '2026-08-25T09:30:00.000Z',
  messages: [{
    id: 'message-001',
    role: 'assistant',
    content: '첫 줄입니다.\n둘째 줄입니다.',
    createdAt: '2026-08-25T09:00:00.000Z',
  }],
  scorecard: [{
    questionId: 'q1',
    question: '최근 한 달간 혼자 지내는 시간이 얼마나 되었나요?',
    answer: '거의 매일 집에만 있었어요',
    value: '하루 대부분',
    rationale: '응답에서 혼자 지내는 시간이 길다고 언급했습니다.',
    aiStatus: 'positive',
    expertStatus: null,
    expertRationale: null,
  }],
}

const decided: InterviewDetail = {
  ...detail,
  scorecard: [{ ...detail.scorecard[0], expertStatus: 'negative' }],
}

const queue: InterviewListItem[] = [detail]

function clone<T>(value: T): T {
  return structuredClone(value)
}

function createApi(overrides: Partial<AppApi> = {}): AppApi {
  return {
    login: vi.fn(), logout: vi.fn(), getCurrentUser: vi.fn(), changePassword: vi.fn(),
    getCurrentInterview: vi.fn(), sendMessage: vi.fn(), listParticipants: vi.fn(),
    createParticipant: vi.fn(), resetParticipantPassword: vi.fn(), disableParticipant: vi.fn(), enableParticipant: vi.fn(),
    unlockParticipant: vi.fn(),
    listInterviews: vi.fn().mockResolvedValue(clone(queue)),
    getInterview: vi.fn().mockResolvedValue(clone(detail)),
    reviewScorecard: vi.fn().mockResolvedValue(clone({
      ...detail,
      reviewStatus: 'reviewed',
      scorecard: [{ ...detail.scorecard[0], expertStatus: 'positive' }],
    })),
    exportInterviewCsv: vi.fn().mockResolvedValue(new Blob(['id,participantCode\n1,P-001'])),
    exportInterviewsCsv: vi.fn().mockResolvedValue(new Blob(['id,participantCode\n1,P-001'])),
    archiveInterview: vi.fn(),
    ...overrides,
  }
}

function renderDashboard(api: AppApi) {
  return render(<ApiProvider api={api}><MemoryRouter><AdminDashboardPage /></MemoryRouter></ApiProvider>)
}

function renderReview(api: AppApi, path = '/admin/interviews/interview-001') {
  return render(
    <ApiProvider api={api}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/admin/interviews/:interviewId" element={<InterviewReviewPage />} /></Routes>
      </MemoryRouter>
    </ApiProvider>,
  )
}

function RouteHarness() {
  const navigate = useNavigate()
  return <>
    <button onClick={() => navigate('/admin/interviews/interview-001')} type="button">A 열기</button>
    <button onClick={() => navigate('/admin/interviews/interview-002')} type="button">B 열기</button>
    <LocationProbe />
    <InterviewReviewPage />
  </>
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderRoutedReview(api: AppApi, path = '/admin/interviews/interview-001') {
  return render(
    <ApiProvider api={api}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/admin/interviews/:interviewId" element={<RouteHarness />} /></Routes>
      </MemoryRouter>
    </ApiProvider>,
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function installDownloadMocks(url = 'blob:review') {
  const createObjectURL = vi.fn(() => url)
  const revokeObjectURL = vi.fn()
  const NativeURL = URL
  class MockURL extends NativeURL {}
  Object.assign(MockURL, { createObjectURL, revokeObjectURL })
  vi.stubGlobal('URL', MockURL)
  const append = vi.spyOn(document.body, 'appendChild')
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  const remove = vi.spyOn(HTMLAnchorElement.prototype, 'remove')
  return { append, click, createObjectURL, remove, revokeObjectURL }
}

afterEach(() => {
  document.querySelectorAll('a[download]').forEach((anchor) => anchor.remove())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('administrator interview review', () => {
  it('shows total, active, completed, and unreviewed counts', async () => {
    const api = createApi({ listInterviews: vi.fn().mockResolvedValue([
      { ...detail, id: 'one', status: 'active', reviewStatus: 'in_review' },
      { ...detail, id: 'two', status: 'completed', reviewStatus: 'unreviewed' },
    ]) })
    renderDashboard(api)

    expect((await screen.findByText('전체')).parentElement).toHaveTextContent('2')
    expect(screen.getAllByText('진행 중')[0].parentElement).toHaveTextContent('1')
    expect(screen.getAllByText('완료')[0].parentElement).toHaveTextContent('1')
    expect(screen.getAllByText('미검토')[0].parentElement).toHaveTextContent('1')
  })

  it('opens an interview from the keyboard-operable queue', async () => {
    const api = createApi()
    renderDashboard(api)

    const link = await screen.findByRole('link', { name: 'P-001 인터뷰 검토' })
    expect(link).toHaveAttribute('href', '/admin/interviews/interview-001')
    expect(within(link).getByText('P-001')).toBeInTheDocument()
  })

  it('opens an interview when the row itself is clicked', async () => {
    const api = createApi()
    const user = userEvent.setup()
    render(
      <ApiProvider api={api}>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/interviews/:interviewId" element={<p>검토 화면</p>} />
          </Routes>
        </MemoryRouter>
      </ApiProvider>,
    )
    await screen.findByText('P-001')

    await user.click(screen.getByText('100%'))

    expect(await screen.findByText('검토 화면')).toBeInTheDocument()
  })

  it('keeps queue and scorecard headers accessible on mobile-sized layouts', async () => {
    const api = createApi()
    renderDashboard(api)
    expect(await screen.findByRole('table', { name: '인터뷰 대기열' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '수정 시각' })).toBeInTheDocument()

    renderReview(api)
    expect(await screen.findByRole('table', { name: '점수표' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'AI 판정' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '전문가 판정' })).toBeInTheDocument()
    expect(screen.getByText('AI:').className).toContain('sm:hidden')
    expect(screen.getByText('전문가:').className).toContain('sm:hidden')
  })

  it('fully restores both table heads at desktop widths', async () => {
    const api = createApi()
    renderDashboard(api)
    const queueHead = await screen.findByRole('columnheader', { name: '수정 시각' })
    expect(queueHead.closest('thead')).toHaveClass('sm:not-sr-only')
    renderReview(api)
    const scorecardHead = await screen.findByRole('columnheader', { name: 'AI 판정' })
    expect(scorecardHead.closest('thead')).toHaveClass('sm:not-sr-only')
  })

  it('shows participant code rather than personal identity', async () => {
    const api = createApi()
    renderReview(api)

    expect(await screen.findByText('P-001')).toBeInTheDocument()
    expect(screen.queryByText('participant01')).not.toBeInTheDocument()
  })

  it('shows the outcome and scorecard without nested explanatory cards', async () => {
    const api = createApi()
    renderReview(api)

    expect(await screen.findByRole('heading', { name: '인터뷰 검토' })).toBeInTheDocument()
    expect(screen.getByText('q1')).toBeInTheDocument()
    expect(screen.getByTestId('review-split')).not.toHaveClass('lg:grid-cols-2')
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent))
      .toEqual(['판정 결과', '점수표'])
  })

  it('keeps a decision label on one line', async () => {
    const api = createApi()
    renderReview(api)
    await screen.findByText('q1')

    const decision = screen.getAllByText('긍정')[0]
    expect(decision.closest('span')).toHaveClass('whitespace-nowrap')
  })

  it('keeps the row actions side by side', async () => {
    const api = createApi()
    renderReview(api)
    await screen.findByText('q1')

    const actions = screen.getByRole('button', { name: 'q1 맞음' }).parentElement
    expect(actions).not.toHaveClass('flex-wrap')
  })

  it('shows the research outcome on the review screen', async () => {
    const api = createApi()
    renderReview(api)

    const outcome = await screen.findByRole('region', { name: '판정 결과' })
    expect(within(outcome).getByText('히키코모리')).toBeInTheDocument()
    expect(within(outcome).getByText('A 충족')).toBeInTheDocument()
    expect(within(outcome).getByText('D 미충족')).toBeInTheDocument()
    expect(within(outcome).getByText('평가를 모두 마쳤습니다.')).toBeInTheDocument()
    expect(within(outcome).getByText(/react-scorecard-v1/)).toBeInTheDocument()
  })

  it('exports every interview when nothing is selected', async () => {
    const api = createApi()
    const user = userEvent.setup()
    const createObjectURL = vi.fn(() => 'blob:queue')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    renderDashboard(api)
    await screen.findByText('P-001')

    await user.click(screen.getByRole('button', { name: '전체 CSV 다운로드' }))

    await waitFor(() => expect(api.exportInterviewsCsv).toHaveBeenCalledWith({ interviewIds: [] }))
  })

  it('exports only the interviews the reviewer selected', async () => {
    const api = createApi()
    const user = userEvent.setup()
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:queue'), revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    renderDashboard(api)
    await screen.findByText('P-001')

    await user.click(screen.getByRole('checkbox', { name: 'P-001 선택' }))
    await user.click(screen.getByRole('button', { name: '선택 1건 CSV 다운로드' }))

    await waitFor(() => expect(api.exportInterviewsCsv).toHaveBeenCalledWith({ interviewIds: ['interview-001'] }))
  })

  it('selects and clears the whole queue at once', async () => {
    const api = createApi()
    const user = userEvent.setup()
    renderDashboard(api)
    await screen.findByText('P-001')

    await user.click(screen.getByRole('checkbox', { name: '전체 선택' }))
    expect(screen.getByRole('checkbox', { name: 'P-001 선택' })).toBeChecked()

    await user.click(screen.getByRole('checkbox', { name: '전체 선택' }))
    expect(screen.getByRole('checkbox', { name: 'P-001 선택' })).not.toBeChecked()
  })

  it('does not open the review when a row checkbox is used', async () => {
    const api = createApi()
    const user = userEvent.setup()
    render(
      <ApiProvider api={api}>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/interviews/:interviewId" element={<p>검토 화면</p>} />
          </Routes>
        </MemoryRouter>
      </ApiProvider>,
    )
    await screen.findByText('P-001')

    await user.click(screen.getByRole('checkbox', { name: 'P-001 선택' }))

    expect(screen.queryByText('검토 화면')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'P-001 선택' })).toBeChecked()
  })

  it('shows the answer and both rationales so a decision can be judged', async () => {
    const api = createApi()
    renderReview(api)
    await screen.findByText('q1')

    const row = screen.getByText('q1').closest('tr')!
    expect(within(row).getByText('거의 매일 집에만 있었어요')).toBeInTheDocument()
    expect(within(row).getByText('하루 대부분')).toBeInTheDocument()
    expect(within(row).getByText('응답에서 혼자 지내는 시간이 길다고 언급했습니다.')).toBeInTheDocument()
  })

  it('lays answer, value and the AI decision out as separate columns', async () => {
    const api = createApi()
    renderReview(api)
    await screen.findByText('q1')

    expect(screen.getAllByRole('columnheader').map((h) => h.textContent))
      .toEqual(['문항', '답변', '값', 'AI 판정', '전문가 판정', '작업'])
  })

  it('marks a decision right or wrong with a single click', async () => {
    const api = createApi()
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: 'q1 틀림' }))

    await waitFor(() => expect(api.reviewScorecard).toHaveBeenCalledWith({
      interviewId: 'interview-001',
      questionId: 'q1',
      action: 'override',
      expertStatus: 'negative',
    }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('agrees with a single click', async () => {
    const api = createApi()
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: 'q1 맞음' }))

    await waitFor(() => expect(api.reviewScorecard).toHaveBeenCalledWith({
      interviewId: 'interview-001',
      questionId: 'q1',
      action: 'approve',
    }))
  })

  it('does not offer a retry for an interview that does not exist', async () => {
    const missing = new ApiError(404, 'missing')
    const api = createApi({ getInterview: vi.fn().mockRejectedValue(missing) })
    renderReview(api)

    expect(await screen.findByText('인터뷰를 찾을 수 없습니다')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '검토 목록' })).toHaveAttribute('href', '/admin')
  })

  it('archives a finished interview so a new one can begin', async () => {
    const archived = clone({ ...detail, status: 'archived' as const })
    const api = createApi({ archiveInterview: vi.fn().mockResolvedValue(archived) })
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: '보관' }))

    await waitFor(() => expect(api.archiveInterview).toHaveBeenCalledWith('interview-001'))
    expect(screen.queryByRole('button', { name: '보관' })).not.toBeInTheDocument()
  })

  it('offers no archive while an interview is still running', async () => {
    const running = clone({ ...detail, status: 'active' as const })
    const api = createApi({ getInterview: vi.fn().mockResolvedValue(running) })
    renderReview(api)
    await screen.findByText('q1')

    expect(screen.queryByRole('button', { name: '보관' })).not.toBeInTheDocument()
  })

  it('sends the reviewer into a screen of its own for the transcript', async () => {
    const api = createApi()
    renderReview(api)
    await screen.findByText('q1')

    expect(screen.queryByRole('heading', { name: '대화' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('진행자 메시지')).not.toBeInTheDocument()

    const entry = screen.getByRole('link', { name: '대화 보기' })
    expect(entry).toHaveAttribute('href', '/admin/interviews/interview-001/transcript')
  })

  it('shows the whole conversation on the transcript screen', async () => {
    const api = createApi()
    render(
      <ApiProvider api={api}>
        <MemoryRouter initialEntries={['/admin/interviews/interview-001/transcript']}>
          <Routes>
            <Route path="/admin/interviews/:interviewId/transcript" element={<InterviewTranscriptPage />} />
          </Routes>
        </MemoryRouter>
      </ApiProvider>,
    )

    expect(await screen.findByRole('heading', { name: '대화' })).toBeInTheDocument()
    expect(screen.getByText('P-001')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '인터뷰 대화' })).toBeInTheDocument()
    expect(screen.getByLabelText('인터뷰 진행자 메시지')).toHaveTextContent('첫 줄입니다.')
    expect(screen.queryByLabelText('답변 입력')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '검토로 돌아가기' }))
      .toHaveAttribute('href', '/admin/interviews/interview-001')
  })

  it('approves an item and renders only the API committed response', async () => {
    const committed = clone({ ...detail, scorecard: [{ ...detail.scorecard[0], value: '서버 값', expertStatus: 'positive' }] })
    const api = createApi({ reviewScorecard: vi.fn().mockResolvedValue(committed) })
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: 'q1 맞음' }))
    await waitFor(() => expect(api.reviewScorecard).toHaveBeenCalledWith({ interviewId: 'interview-001', questionId: 'q1', action: 'approve' }))
    expect(await screen.findByText('서버 값')).toBeInTheDocument()
    expect(screen.queryByText('하루 대부분')).not.toBeInTheDocument()
  })

  it('saves a trimmed rationale for a decision already made', async () => {
    const api = createApi({ getInterview: vi.fn().mockResolvedValue(clone(decided)) })
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: 'q1 근거' }))
    await user.type(screen.getByLabelText('근거'), '  전문가 판단  ')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(api.reviewScorecard).toHaveBeenCalledWith({
      interviewId: 'interview-001', questionId: 'q1', action: 'override', expertStatus: 'negative', rationale: '전문가 판단',
    }))
  })

  it('shows AI and expert decisions with text and icons', async () => {
    const api = createApi()
    renderReview(api)
    const row = await screen.findByRole('row', { name: /q1/ })

    expect(within(row).getByText('긍정')).toBeInTheDocument()
    expect(within(row).getByText('미검토')).toBeInTheDocument()
    expect(within(row).getAllByTestId('decision-icon').length).toBeGreaterThan(1)
  })

  it('disables review actions until the AI has evaluated an item', async () => {
    const pendingDetail = clone({
      ...detail,
      scorecard: [{
        ...detail.scorecard[0],
        questionId: 'q-pending',
        aiStatus: null,
      }],
    })
    const api = createApi({ getInterview: vi.fn().mockResolvedValue(pendingDetail) })
    renderReview(api)

    expect(await screen.findByRole('button', { name: 'q-pending 맞음' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'q-pending 틀림' })).toBeDisabled()
  })

  it('allows agreement but not change for recorded items', async () => {
    const recordedDetail = clone({
      ...detail,
      scorecard: [{
        ...detail.scorecard[0],
        questionId: 'q-recorded',
        aiStatus: 'recorded' as const,
      }],
    })
    const api = createApi({ getInterview: vi.fn().mockResolvedValue(recordedDetail) })
    renderReview(api)

    expect(await screen.findByRole('button', { name: 'q-recorded 맞음' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'q-recorded 틀림' })).toBeDisabled()
  })

  it('downloads a CSV blob using only the participant code and revokes its URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:review')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const api = createApi()
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('P-001')

    await user.click(screen.getByRole('button', { name: 'CSV 다운로드' }))
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce())
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:review')
  })

  it('handles loading, empty, retry, review lock, export lock, and closed-dialog cleanup', async () => {
    const load = deferred<InterviewListItem[]>()
    const review = deferred<InterviewDetail>()
    const exported = deferred<Blob>()
    const api = createApi({ listInterviews: vi.fn(() => load.promise), reviewScorecard: vi.fn(() => review.promise), exportInterviewCsv: vi.fn(() => exported.promise) })
    renderDashboard(api)
    expect(screen.getByRole('status')).toBeInTheDocument()
    await act(async () => load.resolve([]))
    expect(await screen.findByText('인터뷰가 없습니다')).toBeInTheDocument()

    const page = renderReview(api)
    await screen.findByText('q1')
    const approve = screen.getByRole('button', { name: 'q1 맞음' })
    act(() => { fireEvent.click(approve); fireEvent.click(approve) })
    expect(api.reviewScorecard).toHaveBeenCalledOnce()
    const exportButton = screen.getByRole('button', { name: 'CSV 다운로드' })
    act(() => { fireEvent.click(exportButton); fireEvent.click(exportButton) })
    expect(api.exportInterviewCsv).toHaveBeenCalledOnce()
    await act(async () => { review.reject(new Error('failed')); exported.reject(new Error('failed')) })
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0)
    expect(approve).not.toBeDisabled()

    expect(screen.getByRole('button', { name: 'q1 근거' })).toBeDisabled()
    page.unmount()
  })

  it('does not let a pending A review block or replace B', async () => {
    const reviewA = deferred<InterviewDetail>()
    const reviewB = deferred<InterviewDetail>()
    const detailB = clone({ ...detail, id: 'interview-002', participantCode: 'P-002', scorecard: [{ ...detail.scorecard[0], value: 'B 값' }] })
    const api = createApi({
      getInterview: vi.fn((id: string) => Promise.resolve(id === 'interview-002' ? detailB : clone(detail))),
      reviewScorecard: vi.fn((input) => input.interviewId === 'interview-002' ? reviewB.promise : reviewA.promise),
    })
    render(<ApiProvider api={api}><MemoryRouter initialEntries={['/admin/interviews/interview-001']}><Routes><Route path="/admin/interviews/:interviewId" element={<RouteHarness />} /></Routes></MemoryRouter></ApiProvider>)
    await screen.findByText('P-001')
    fireEvent.click(screen.getByRole('button', { name: 'q1 맞음' }))
    fireEvent.click(screen.getByRole('button', { name: 'B 열기' }))
    expect(await screen.findByText('P-002')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'q1 맞음' }))
    expect(api.reviewScorecard).toHaveBeenCalledTimes(2)
    await act(async () => reviewA.resolve(clone({ ...detail, scorecard: [{ ...detail.scorecard[0], value: 'A 늦은 값' }] })))
    expect(screen.queryByText('A 늦은 값')).not.toBeInTheDocument()
    await act(async () => reviewB.resolve(clone({ ...detailB, scorecard: [{ ...detailB.scorecard[0], value: 'B 확정 값' }] })))
    expect(await screen.findByText('B 확정 값')).toBeInTheDocument()
  })

  it('defers one CSV URL revoke until after one append, click, and removal', async () => {
    const api = createApi()
    renderReview(api)
    await screen.findByText('P-001')
    vi.useFakeTimers()
    const createObjectURL = vi.fn(() => 'blob:review')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const append = vi.spyOn(document.body, 'appendChild')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    fireEvent.click(screen.getByRole('button', { name: 'CSV 다운로드' }))
    await act(async () => { await Promise.resolve() })
    expect(append).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    act(() => vi.runOnlyPendingTimers())
    expect(revokeObjectURL).toHaveBeenCalledOnce()
  })

  it('navigates to the selected interview when its queue link receives Enter', async () => {
    const api = createApi()
    const user = userEvent.setup()
    render(
      <ApiProvider api={api}>
        <MemoryRouter initialEntries={['/admin/interviews']}>
          <LocationProbe />
          <Routes>
            <Route path="/admin/interviews" element={<AdminDashboardPage />} />
            <Route path="/admin/interviews/:interviewId" element={<p>detail destination</p>} />
          </Routes>
        </MemoryRouter>
      </ApiProvider>,
    )
    const link = await screen.findByRole('link', { name: 'P-001 인터뷰 검토' })

    link.focus()
    await user.keyboard('{Enter}')

    expect(screen.getByTestId('location')).toHaveTextContent('/admin/interviews/interview-001')
    expect(screen.getByText('detail destination')).toBeInTheDocument()
  })

  it('retries dashboard load failures and renders only the retry result', async () => {
    const api = createApi({
      listInterviews: vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce([]),
    })
    const user = userEvent.setup()
    renderDashboard(api)

    expect(await screen.findByRole('alert')).toHaveTextContent('인터뷰를 불러오지 못했습니다')
    await user.click(screen.getByRole('button', { name: '다시 시도' }))

    expect(await screen.findByText('인터뷰가 없습니다')).toBeInTheDocument()
    expect(api.listInterviews).toHaveBeenCalledTimes(2)
  })

  it('ignores stale dashboard loads and safely settles an unmounted load', async () => {
    const staleLoad = deferred<InterviewListItem[]>()
    const unmountedLoad = deferred<InterviewListItem[]>()
    const firstApi = createApi({ listInterviews: vi.fn(() => staleLoad.promise) })
    const secondApi = createApi({ listInterviews: vi.fn().mockResolvedValue([]) })
    const view = renderDashboard(firstApi)

    view.rerender(<ApiProvider api={secondApi}><MemoryRouter><AdminDashboardPage /></MemoryRouter></ApiProvider>)
    expect(await screen.findByText('인터뷰가 없습니다')).toBeInTheDocument()
    await act(async () => staleLoad.resolve(clone(queue)))
    expect(screen.queryByText('P-001')).not.toBeInTheDocument()

    view.rerender(<ApiProvider api={createApi({ listInterviews: vi.fn(() => unmountedLoad.promise) })}><MemoryRouter><AdminDashboardPage /></MemoryRouter></ApiProvider>)
    view.unmount()
    await act(async () => unmountedLoad.reject(new Error('late failure')))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('retries detail load failures and ignores stale A to B to A loads', async () => {
    const oldA = deferred<InterviewDetail>()
    const detailB = clone({ ...detail, id: 'interview-002', participantCode: 'P-002', scorecard: [{ ...detail.scorecard[0], value: 'B 기본 값' }] })
    const revisitedA = clone({ ...detail, scorecard: [{ ...detail.scorecard[0], value: 'A 재방문 값' }] })
    let aLoads = 0
    const api = createApi({
      getInterview: vi.fn((id: string) => {
        if (id === 'interview-002') return Promise.resolve(detailB)
        aLoads += 1
        return aLoads === 1 ? oldA.promise : Promise.resolve(revisitedA)
      }),
    })
    const user = userEvent.setup()
    renderRoutedReview(api)

    await user.click(screen.getByRole('button', { name: 'B 열기' }))
    expect(await screen.findByText('P-002')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'A 열기' }))
    expect(await screen.findByText('A 재방문 값')).toBeInTheDocument()
    await act(async () => oldA.resolve(clone({ ...detail, scorecard: [{ ...detail.scorecard[0], value: 'A 늦은 로드' }] })))

    expect(screen.queryByText('A 늦은 로드')).not.toBeInTheDocument()
    expect(screen.getByText('A 재방문 값')).toBeInTheDocument()
  })

  it('retries a failed detail load and safely settles after unmount', async () => {
    const lateLoad = deferred<InterviewDetail>()
    const api = createApi({
      getInterview: vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(clone(detail)),
    })
    const user = userEvent.setup()
    const page = renderReview(api)

    expect(await screen.findByRole('alert')).toHaveTextContent('인터뷰를 불러오지 못했습니다')
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('P-001')).toBeInTheDocument()

    page.unmount()
    const lateApi = createApi({ getInterview: vi.fn(() => lateLoad.promise) })
    const latePage = renderReview(lateApi)
    latePage.unmount()
    await act(async () => lateLoad.reject(new Error('late failure')))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('loads the current route during the application StrictMode lifecycle', async () => {
    const api = createApi()
    render(
      <StrictMode>
        <ApiProvider api={api}>
          <MemoryRouter initialEntries={['/admin/interviews/interview-001']}>
            <Routes><Route path="/admin/interviews/:interviewId" element={<InterviewReviewPage />} /></Routes>
          </MemoryRouter>
        </ApiProvider>
      </StrictMode>,
    )

    expect(await screen.findByText('P-001')).toBeInTheDocument()
    expect(api.getInterview).toHaveBeenCalledTimes(2)
  })

  it('never renders adversarial identity fields returned beside a participant code', async () => {
    const adversarial = {
      ...clone(detail),
      participantCode: 'PUBLIC-CODE',
      username: 'secret-user',
      name: 'Private Person',
      email: 'private@example.com',
    } as InterviewDetail & { username: string; name: string; email: string }
    const api = createApi({
      listInterviews: vi.fn().mockResolvedValue([adversarial]),
      getInterview: vi.fn().mockResolvedValue(adversarial),
    })
    renderDashboard(api)
    renderReview(api)

    expect((await screen.findAllByText('PUBLIC-CODE')).length).toBeGreaterThan(1)
    expect(screen.queryByText('secret-user')).not.toBeInTheDocument()
    expect(screen.queryByText('Private Person')).not.toBeInTheDocument()
    expect(screen.queryByText('private@example.com')).not.toBeInTheDocument()
  })

  it('keeps the rationale optional', async () => {
    const api = createApi({ getInterview: vi.fn().mockResolvedValue(clone(decided)) })
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: 'q1 근거' }))
    await user.type(screen.getByRole('textbox', { name: '근거' }), '   ')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(api.reviewScorecard).toHaveBeenCalledWith({
      interviewId: 'interview-001', questionId: 'q1', action: 'override', expertStatus: 'negative', rationale: '',
    }))
  })

  it('submits the exact override payload and renders the API committed state', async () => {
    const committed = clone({
      ...detail,
      reviewStatus: 'reviewed' as const,
      scorecard: [{ ...detail.scorecard[0], value: '서버 확정 값', expertStatus: 'negative' as const, expertRationale: '전문가 판단' }],
    })
    const api = createApi({ reviewScorecard: vi.fn().mockResolvedValue(committed) })
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: 'q1 틀림' }))

    await waitFor(() => expect(api.reviewScorecard).toHaveBeenCalledWith({
      interviewId: 'interview-001',
      questionId: 'q1',
      action: 'override',
      expertStatus: 'negative',
    }))
    expect(await screen.findByText('서버 확정 값')).toBeInTheDocument()
    expect(screen.queryByText('하루 대부분')).not.toBeInTheDocument()
  })

  it('disables the row and dialog controls while a review is in flight', async () => {
    const pending = deferred<InterviewDetail>()
    const api = createApi({
      getInterview: vi.fn().mockResolvedValue(clone(decided)),
      reviewScorecard: vi.fn(() => pending.promise),
    })
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    const approve = screen.getByRole('button', { name: 'q1 맞음' })
    const rationaleAction = screen.getByRole('button', { name: 'q1 근거' })
    expect(approve).toHaveClass('min-h-11', 'sm:min-h-8')
    expect(rationaleAction).toHaveClass('min-h-11', 'sm:min-h-8')
    await user.click(rationaleAction)

    await user.type(screen.getByRole('textbox', { name: '근거' }), '잠금 테스트')
    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(screen.getByRole('textbox', { name: '근거' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '취소' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'q1 맞음', hidden: true })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'q1 틀림', hidden: true })).toBeDisabled()
    await act(async () => pending.resolve(clone(detail)))
  })

  it('keeps a closed override dialog closed when its late result succeeds', async () => {
    const pending = deferred<InterviewDetail>()
    const committed = clone({ ...detail, scorecard: [{ ...detail.scorecard[0], value: '늦은 확정 값', expertStatus: 'negative' as const }] })
    const api = createApi({
      getInterview: vi.fn().mockResolvedValue(clone(decided)),
      reviewScorecard: vi.fn(() => pending.promise),
    })
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: 'q1 근거' }))
    await user.type(screen.getByRole('textbox', { name: '근거' }), '늦은 성공 근거')
    await user.click(screen.getByRole('button', { name: '저장' }))
    await user.click(screen.getByRole('button', { name: '대화상자 닫기' }))
    await act(async () => pending.resolve(committed))

    expect(await screen.findByText('늦은 확정 값')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'q1 근거' })).not.toBeDisabled()
  })

  it('drops a draft rationale whenever the dialog closes', async () => {
    const api = createApi({ getInterview: vi.fn().mockResolvedValue(clone(decided)) })
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: 'q1 근거' }))
    await user.type(screen.getByRole('textbox', { name: '근거' }), '삭제되어야 하는 근거')
    await user.click(screen.getByRole('button', { name: '대화상자 닫기' }))

    await user.click(screen.getByRole('button', { name: 'q1 근거' }))
    expect(screen.getByRole('textbox', { name: '근거' })).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('releases the action lock after a pending override dialog closes and settles', async () => {
    const first = deferred<InterviewDetail>()
    const committed = clone({ ...detail, scorecard: [{ ...detail.scorecard[0], value: '재시도 확정 값', expertStatus: 'negative' as const }] })
    const api = createApi({
      getInterview: vi.fn().mockResolvedValue(clone(decided)),
      reviewScorecard: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce(committed),
    })
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: 'q1 근거' }))
    await user.type(screen.getByRole('textbox', { name: '근거' }), '첫 번째 근거')
    await user.click(screen.getByRole('button', { name: '저장' }))
    await user.click(screen.getByRole('button', { name: '대화상자 닫기' }))
    await act(async () => first.reject(new Error('late failure')))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('검토를 저장하지 못했습니다')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'q1 근거' })).not.toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'q1 근거' }))
    expect(screen.getByRole('textbox', { name: '근거' })).toHaveValue('')
    expect(screen.getByRole('button', { name: '저장' })).not.toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: '근거' }), '재시도 근거')
    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByText('재시도 확정 값')).toBeInTheDocument()
    expect(api.reviewScorecard).toHaveBeenCalledTimes(2)
  })

  it('allows a failed approval to retry after blocking same-tick duplicates', async () => {
    const committed = clone({ ...detail, scorecard: [{ ...detail.scorecard[0], value: '승인 재시도 값', expertStatus: 'positive' as const }] })
    const api = createApi({
      reviewScorecard: vi.fn()
        .mockRejectedValueOnce(new Error('failed'))
        .mockResolvedValueOnce(committed),
    })
    renderReview(api)
    await screen.findByText('q1')
    const approve = screen.getByRole('button', { name: 'q1 맞음' })

    act(() => { fireEvent.click(approve); fireEvent.click(approve) })
    expect(api.reviewScorecard).toHaveBeenCalledOnce()
    expect(await screen.findByRole('alert')).toHaveTextContent('검토를 저장하지 못했습니다')
    expect(approve).not.toBeDisabled()
    fireEvent.click(approve)

    expect(await screen.findByText('승인 재시도 값')).toBeInTheDocument()
    expect(api.reviewScorecard).toHaveBeenCalledTimes(2)
  })

  it('settles a rejected review after unmount without recreating state', async () => {
    const pending = deferred<InterviewDetail>()
    const api = createApi({ reviewScorecard: vi.fn(() => pending.promise) })
    const page = renderReview(api)
    await screen.findByText('q1')
    fireEvent.click(screen.getByRole('button', { name: 'q1 맞음' }))

    page.unmount()
    await act(async () => pending.reject(new Error('late failure')))

    expect(api.reviewScorecard).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('suppresses an out-of-order review from an earlier A visit', async () => {
    const firstAReview = deferred<InterviewDetail>()
    const secondAReview = deferred<InterviewDetail>()
    const detailB = clone({ ...detail, id: 'interview-002', participantCode: 'P-002', scorecard: [{ ...detail.scorecard[0], value: 'B 값' }] })
    const revisitedA = clone({ ...detail, scorecard: [{ ...detail.scorecard[0], value: 'A 재방문 기본 값' }] })
    let aLoads = 0
    let aReviews = 0
    const api = createApi({
      getInterview: vi.fn((id: string) => {
        if (id === 'interview-002') return Promise.resolve(detailB)
        aLoads += 1
        return Promise.resolve(aLoads === 1 ? clone(detail) : revisitedA)
      }),
      reviewScorecard: vi.fn(() => {
        aReviews += 1
        return aReviews === 1 ? firstAReview.promise : secondAReview.promise
      }),
    })
    const user = userEvent.setup()
    renderRoutedReview(api)
    await screen.findByText('P-001')

    fireEvent.click(screen.getByRole('button', { name: 'q1 맞음' }))
    await user.click(screen.getByRole('button', { name: 'B 열기' }))
    expect(await screen.findByText('P-002')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'A 열기' }))
    expect(await screen.findByText('A 재방문 기본 값')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'q1 맞음' }))
    expect(api.reviewScorecard).toHaveBeenCalledTimes(2)

    await act(async () => firstAReview.resolve(clone({ ...detail, scorecard: [{ ...detail.scorecard[0], value: 'A 이전 방문 늦은 값' }] })))
    expect(screen.queryByText('A 이전 방문 늦은 값')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'q1 맞음' })).toBeDisabled()

    await act(async () => secondAReview.resolve(clone({ ...revisitedA, scorecard: [{ ...revisitedA.scorecard[0], value: 'A 현재 방문 확정 값' }] })))
    expect(await screen.findByText('A 현재 방문 확정 값')).toBeInTheDocument()
  })

  it('uses the exact interview ID and a sanitized participant-only CSV filename', async () => {
    const privateDetail = {
      ...clone(detail),
      participantCode: ' ../P 001/한글 ',
      username: 'secret-user',
    } as InterviewDetail & { username: string }
    const api = createApi({ getInterview: vi.fn().mockResolvedValue(privateDetail) })
    renderReview(api)
    await screen.findByText('../P 001/한글')
    vi.useFakeTimers()
    const { append, click, remove, revokeObjectURL } = installDownloadMocks()

    fireEvent.click(screen.getByRole('button', { name: 'CSV 다운로드' }))
    await act(async () => { await Promise.resolve() })

    expect(api.exportInterviewCsv).toHaveBeenCalledWith('interview-001')
    expect(append).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
    const anchor = append.mock.calls[0][0] as HTMLAnchorElement
    expect(anchor.download).toBe('P_001.csv')
    expect(anchor.download).not.toContain('secret-user')
    expect(revokeObjectURL).not.toHaveBeenCalled()
    act(() => vi.runOnlyPendingTimers())
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    act(() => vi.runOnlyPendingTimers())
    expect(revokeObjectURL).toHaveBeenCalledOnce()
  })

  it('reports unavailable object URL APIs without calling export and permits retry', async () => {
    const api = createApi()
    const user = userEvent.setup()
    vi.stubGlobal('URL', {})
    renderReview(api)
    await screen.findByText('P-001')

    await user.click(screen.getByRole('button', { name: 'CSV 다운로드' }))
    expect(screen.getByRole('alert')).toHaveTextContent('CSV를 다운로드할 수 없습니다')
    expect(api.exportInterviewCsv).not.toHaveBeenCalled()

    const createObjectURL = vi.fn(() => 'blob:retry')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    await user.click(screen.getByRole('button', { name: 'CSV 다운로드' }))
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce())
    expect(api.exportInterviewCsv).toHaveBeenCalledOnce()
  })

  it('immediately removes the anchor and revokes its URL when clicking throws', async () => {
    const api = createApi()
    const { click, remove, revokeObjectURL } = installDownloadMocks('blob:throw')
    click.mockImplementation(() => { throw new Error('click failed') })
    renderReview(api)
    await screen.findByText('P-001')

    fireEvent.click(screen.getByRole('button', { name: 'CSV 다운로드' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('CSV를 다운로드하지 못했습니다')
    expect(remove).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(document.querySelector('a[download]')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CSV 다운로드' })).not.toBeDisabled()
  })

  it('retries a rejected export after blocking same-tick duplicates', async () => {
    const first = deferred<Blob>()
    const api = createApi({
      exportInterviewCsv: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce(new Blob(['retry'])),
    })
    const { click } = installDownloadMocks()
    renderReview(api)
    await screen.findByText('P-001')
    const exportButton = screen.getByRole('button', { name: 'CSV 다운로드' })

    act(() => { fireEvent.click(exportButton); fireEvent.click(exportButton) })
    expect(api.exportInterviewCsv).toHaveBeenCalledOnce()
    await act(async () => first.reject(new Error('failed')))
    expect(await screen.findByRole('alert')).toHaveTextContent('CSV를 다운로드하지 못했습니다')
    expect(exportButton).not.toBeDisabled()
    fireEvent.click(exportButton)

    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(api.exportInterviewCsv).toHaveBeenCalledTimes(2)
  })

  it('revokes a deferred CSV URL exactly once when the page unmounts', async () => {
    const api = createApi()
    const page = renderReview(api)
    await screen.findByText('P-001')
    vi.useFakeTimers()
    const { revokeObjectURL } = installDownloadMocks('blob:unmount')
    fireEvent.click(screen.getByRole('button', { name: 'CSV 다운로드' }))
    await act(async () => { await Promise.resolve() })
    expect(revokeObjectURL).not.toHaveBeenCalled()

    page.unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    act(() => vi.runOnlyPendingTimers())
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('suppresses an old export and keeps the new lock during A to B to A navigation', async () => {
    const firstAExport = deferred<Blob>()
    const secondAExport = deferred<Blob>()
    const detailB = clone({ ...detail, id: 'interview-002', participantCode: 'P-002' })
    let aLoads = 0
    let exportCalls = 0
    const api = createApi({
      getInterview: vi.fn((id: string) => {
        if (id === 'interview-002') return Promise.resolve(detailB)
        aLoads += 1
        return Promise.resolve(clone({ ...detail, scorecard: [{ ...detail.scorecard[0], value: aLoads === 1 ? 'A 첫 방문' : 'A 둘째 방문' }] }))
      }),
      exportInterviewCsv: vi.fn(() => {
        exportCalls += 1
        return exportCalls === 1 ? firstAExport.promise : secondAExport.promise
      }),
    })
    const { click, createObjectURL } = installDownloadMocks()
    const user = userEvent.setup()
    renderRoutedReview(api)
    await screen.findByText('A 첫 방문')

    fireEvent.click(screen.getByRole('button', { name: 'CSV 다운로드' }))
    await user.click(screen.getByRole('button', { name: 'B 열기' }))
    expect(await screen.findByText('P-002')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'A 열기' }))
    expect(await screen.findByText('A 둘째 방문')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'CSV 다운로드' }))
    expect(api.exportInterviewCsv).toHaveBeenCalledTimes(2)

    await act(async () => firstAExport.resolve(new Blob(['old'])))
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'CSV 다운로드' })).toBeDisabled()

    await act(async () => secondAExport.resolve(new Blob(['new'])))
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
  })
})

describe('administrator interview access', () => {
  it('offers a way into the interview from the dashboard', async () => {
    const api = createApi()
    renderDashboard(api)
    await screen.findByText('P-001')

    const entry = screen.getByRole('link', { name: '인터뷰 해보기' })
    expect(entry).toHaveAttribute('href', '/admin/interview')
  })

  it('labels an administrator run in the queue', async () => {
    const adminRun: InterviewListItem = {
      id: 'interview-admin',
      participantCode: '관리자 (testadmin)',
      status: 'active',
      progress: 20,
      reviewStatus: 'unreviewed',
      updatedAt: '2026-09-07T09:00:00.000Z',
    }
    const api = createApi({ listInterviews: vi.fn().mockResolvedValue([adminRun]) })
    renderDashboard(api)

    expect(await screen.findByText('관리자 (testadmin)')).toBeInTheDocument()
  })
})
