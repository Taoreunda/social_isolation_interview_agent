import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

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

    const link = await screen.findByRole('link', { name: /P-001/ })
    expect(link).toHaveAttribute('href', '/admin/interviews/interview-001')
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
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'q1 변경' }))
    expect(screen.getByLabelText('근거')).toHaveValue('')
    page.unmount()
  })
})
