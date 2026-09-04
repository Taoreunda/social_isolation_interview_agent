import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiProvider } from '@/app/api-context'
import type { AppApi, InterviewDetail, InterviewListItem } from '@/app/contracts'
import { AdminDashboardPage } from './AdminDashboardPage'
import { InterviewReviewPage } from './InterviewReviewPage'

const detail: InterviewDetail = {
  id: 'interview-001',
  participantCode: 'P-001',
  status: 'completed',
  progress: 100,
  reviewStatus: 'unreviewed',
  updatedAt: '2026-08-25T09:00:00.000Z',
  messages: [{
    id: 'message-001',
    role: 'assistant',
    content: '첫 줄입니다.\n둘째 줄입니다.',
    createdAt: '2026-08-25T09:00:00.000Z',
  }],
  scorecard: [{
    questionId: 'q1',
    question: '최근 한 달간 혼자 지내는 시간이 얼마나 되었나요?',
    value: '하루 대부분',
    rationale: '응답에서 혼자 지내는 시간이 길다고 언급했습니다.',
    aiStatus: 'positive',
    expertStatus: null,
    expertRationale: null,
  }],
}

const queue: InterviewListItem[] = [detail]

function clone<T>(value: T): T {
  return structuredClone(value)
}

function createApi(overrides: Partial<AppApi> = {}): AppApi {
  return {
    login: vi.fn(), logout: vi.fn(), getCurrentUser: vi.fn(), changePassword: vi.fn(),
    getCurrentInterview: vi.fn(), sendMessage: vi.fn(), listParticipants: vi.fn(),
    createParticipant: vi.fn(), resetParticipantPassword: vi.fn(), disableParticipant: vi.fn(),
    unlockParticipant: vi.fn(),
    listInterviews: vi.fn().mockResolvedValue(clone(queue)),
    getInterview: vi.fn().mockResolvedValue(clone(detail)),
    reviewScorecard: vi.fn().mockResolvedValue(clone({
      ...detail,
      reviewStatus: 'reviewed',
      scorecard: [{ ...detail.scorecard[0], expertStatus: 'positive' }],
    })),
    exportInterviewCsv: vi.fn().mockResolvedValue(new Blob(['id,participantCode\n1,P-001'])),
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
    expect(within(link).getByText('검토')).not.toHaveClass('sr-only')
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

  it('shows transcript and scorecard without nested explanatory cards', async () => {
    const api = createApi()
    renderReview(api)

    expect(await screen.findByRole('heading', { name: '인터뷰 검토' })).toBeInTheDocument()
    expect(screen.getByLabelText('진행자 메시지')).toHaveClass('whitespace-pre-wrap')
    expect(screen.getByText('q1')).toBeInTheDocument()
    expect(screen.getByTestId('review-split')).toHaveClass('lg:grid-cols-2')
  })

  it('approves an item and renders only the API committed response', async () => {
    const committed = clone({ ...detail, scorecard: [{ ...detail.scorecard[0], value: '서버 값', expertStatus: 'positive' }] })
    const api = createApi({ reviewScorecard: vi.fn().mockResolvedValue(committed) })
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: 'q1 동의' }))
    await waitFor(() => expect(api.reviewScorecard).toHaveBeenCalledWith({ interviewId: 'interview-001', questionId: 'q1', action: 'approve' }))
    expect(await screen.findByText('서버 값')).toBeInTheDocument()
    expect(screen.queryByText('하루 대부분')).not.toBeInTheDocument()
  })

  it('requires a trimmed rationale when overriding an item', async () => {
    const api = createApi()
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: 'q1 변경' }))
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(screen.getByRole('alert')).toHaveTextContent('근거를 입력하세요')
    expect(api.reviewScorecard).not.toHaveBeenCalled()

    await user.click(screen.getByLabelText('부정'))
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
    const approve = screen.getByRole('button', { name: 'q1 동의' })
    act(() => { fireEvent.click(approve); fireEvent.click(approve) })
    expect(api.reviewScorecard).toHaveBeenCalledOnce()
    const exportButton = screen.getByRole('button', { name: 'CSV 다운로드' })
    act(() => { fireEvent.click(exportButton); fireEvent.click(exportButton) })
    expect(api.exportInterviewCsv).toHaveBeenCalledOnce()
    await act(async () => { review.reject(new Error('failed')); exported.reject(new Error('failed')) })
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0)
    expect(approve).not.toBeDisabled()

    await userEvent.setup().click(screen.getByRole('button', { name: 'q1 변경' }))
    await userEvent.setup().type(screen.getByLabelText('근거'), '임시 근거')
    await userEvent.setup().click(screen.getByRole('button', { name: '대화상자 닫기' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'q1 변경' }))
    expect(screen.getByLabelText('근거')).toHaveValue('')
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
    fireEvent.click(screen.getByRole('button', { name: 'q1 동의' }))
    fireEvent.click(screen.getByRole('button', { name: 'B 열기' }))
    expect(await screen.findByText('P-002')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'q1 동의' }))
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

  it('rejects whitespace rationale and preserves required error semantics', async () => {
    const api = createApi()
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: 'q1 변경' }))
    const rationale = screen.getByRole('textbox', { name: '근거' })
    await user.type(rationale, '   ')
    await user.click(screen.getByRole('button', { name: '저장' }))

    const error = screen.getByRole('alert')
    expect(api.reviewScorecard).not.toHaveBeenCalled()
    expect(rationale).toBeRequired()
    expect(rationale).toHaveAttribute('aria-required', 'true')
    expect(rationale).toHaveAttribute('aria-invalid', 'true')
    expect(rationale).toHaveAttribute('aria-describedby', error.id)
    expect(error).toHaveTextContent('근거를 입력하세요')
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

    await user.click(screen.getByRole('button', { name: 'q1 변경' }))
    await user.click(screen.getByRole('radio', { name: '부정' }))
    await user.type(screen.getByRole('textbox', { name: '근거' }), '  전문가 판단  ')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(api.reviewScorecard).toHaveBeenCalledWith({
      interviewId: 'interview-001',
      questionId: 'q1',
      action: 'override',
      expertStatus: 'negative',
      rationale: '전문가 판단',
    }))
    expect(await screen.findByText('서버 확정 값')).toBeInTheDocument()
    expect(screen.queryByText('하루 대부분')).not.toBeInTheDocument()
  })

  it('keeps the decision group accessible and disables editing controls while busy', async () => {
    const pending = deferred<InterviewDetail>()
    const api = createApi({ reviewScorecard: vi.fn(() => pending.promise) })
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    const approve = screen.getByRole('button', { name: 'q1 동의' })
    const change = screen.getByRole('button', { name: 'q1 변경' })
    expect(approve).toHaveClass('min-h-11', 'sm:min-h-8')
    expect(change).toHaveClass('min-h-11', 'sm:min-h-8')
    await user.click(change)
    const group = screen.getByRole('group', { name: '판정' })
    const positive = screen.getByRole('radio', { name: '긍정' })
    const negative = screen.getByRole('radio', { name: '부정' })
    expect(group).toBeInstanceOf(HTMLFieldSetElement)
    expect(positive.closest('label')).toHaveClass('min-h-11', 'sm:min-h-0')
    expect(negative.closest('label')).toHaveClass('min-h-11', 'sm:min-h-0')

    await user.click(negative)
    await user.type(screen.getByRole('textbox', { name: '근거' }), '잠금 테스트')
    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(positive).toBeDisabled()
    expect(negative).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '근거' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '취소' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'q1 동의', hidden: true })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'q1 변경', hidden: true })).toBeDisabled()
    await act(async () => pending.resolve(clone(detail)))
  })

  it('keeps a closed override dialog closed when its late result succeeds', async () => {
    const pending = deferred<InterviewDetail>()
    const committed = clone({ ...detail, scorecard: [{ ...detail.scorecard[0], value: '늦은 확정 값', expertStatus: 'negative' as const }] })
    const api = createApi({ reviewScorecard: vi.fn(() => pending.promise) })
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: 'q1 변경' }))
    await user.click(screen.getByRole('radio', { name: '부정' }))
    await user.type(screen.getByRole('textbox', { name: '근거' }), '늦은 성공 근거')
    await user.click(screen.getByRole('button', { name: '저장' }))
    await user.click(screen.getByRole('button', { name: '대화상자 닫기' }))
    await act(async () => pending.resolve(committed))

    expect(await screen.findByText('늦은 확정 값')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'q1 변경' })).not.toBeDisabled()
  })

  it('clears decision, rationale, and validation errors whenever the dialog closes', async () => {
    const api = createApi()
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: 'q1 변경' }))
    await user.click(screen.getByRole('radio', { name: '부정' }))
    await user.type(screen.getByRole('textbox', { name: '근거' }), '삭제되어야 하는 근거')
    await user.clear(screen.getByRole('textbox', { name: '근거' }))
    await user.type(screen.getByRole('textbox', { name: '근거' }), '   ')
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '대화상자 닫기' }))

    await user.click(screen.getByRole('button', { name: 'q1 변경' }))
    expect(screen.getByRole('textbox', { name: '근거' })).toHaveValue('')
    expect(screen.getByRole('radio', { name: '긍정' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '부정' })).not.toBeChecked()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('releases the action lock after a pending override dialog closes and settles', async () => {
    const first = deferred<InterviewDetail>()
    const committed = clone({ ...detail, scorecard: [{ ...detail.scorecard[0], value: '재시도 확정 값', expertStatus: 'negative' as const }] })
    const api = createApi({
      reviewScorecard: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce(committed),
    })
    const user = userEvent.setup()
    renderReview(api)
    await screen.findByText('q1')

    await user.click(screen.getByRole('button', { name: 'q1 변경' }))
    await user.click(screen.getByRole('radio', { name: '부정' }))
    await user.type(screen.getByRole('textbox', { name: '근거' }), '첫 번째 근거')
    await user.click(screen.getByRole('button', { name: '저장' }))
    await user.click(screen.getByRole('button', { name: '대화상자 닫기' }))
    await act(async () => first.reject(new Error('late failure')))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('검토를 저장하지 못했습니다')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'q1 변경' })).not.toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'q1 변경' }))
    expect(screen.getByRole('textbox', { name: '근거' })).toHaveValue('')
    expect(screen.getByRole('button', { name: '저장' })).not.toBeDisabled()
    await user.click(screen.getByRole('radio', { name: '부정' }))
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
    const approve = screen.getByRole('button', { name: 'q1 동의' })

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
    fireEvent.click(screen.getByRole('button', { name: 'q1 동의' }))

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

    fireEvent.click(screen.getByRole('button', { name: 'q1 동의' }))
    await user.click(screen.getByRole('button', { name: 'B 열기' }))
    expect(await screen.findByText('P-002')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'A 열기' }))
    expect(await screen.findByText('A 재방문 기본 값')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'q1 동의' }))
    expect(api.reviewScorecard).toHaveBeenCalledTimes(2)

    await act(async () => firstAReview.resolve(clone({ ...detail, scorecard: [{ ...detail.scorecard[0], value: 'A 이전 방문 늦은 값' }] })))
    expect(screen.queryByText('A 이전 방문 늦은 값')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'q1 동의' })).toBeDisabled()

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
