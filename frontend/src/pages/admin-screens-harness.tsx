/** Fixtures and render helpers shared by the administrator screen tests. */

import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { vi } from 'vitest'

import { ApiProvider } from '@/app/api-context'
import type { AppApi, InterviewDetail, InterviewListItem } from '@/app/contracts'
import { AdminDashboardPage } from './AdminDashboardPage'
import { InterviewReviewPage } from './InterviewReviewPage'

export const detail: InterviewDetail = {
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

export const decided: InterviewDetail = {
  ...detail,
  scorecard: [{ ...detail.scorecard[0], expertStatus: 'negative' }],
}

export const queue: InterviewListItem[] = [detail]

export function clone<T>(value: T): T {
  return structuredClone(value)
}

export function createApi(overrides: Partial<AppApi> = {}): AppApi {
  return {
    login: vi.fn(), logout: vi.fn(), getCurrentUser: vi.fn(), changePassword: vi.fn(),
    getCurrentInterview: vi.fn(), startInterview: vi.fn(), sendMessage: vi.fn(), listParticipants: vi.fn(),
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

export function renderDashboard(api: AppApi) {
  return render(<ApiProvider api={api}><MemoryRouter><AdminDashboardPage /></MemoryRouter></ApiProvider>)
}

export function renderReview(api: AppApi, path = '/admin/interviews/interview-001') {
  return render(
    <ApiProvider api={api}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/admin/interviews/:interviewId" element={<InterviewReviewPage />} /></Routes>
      </MemoryRouter>
    </ApiProvider>,
  )
}

export function RouteHarness() {
  const navigate = useNavigate()
  return <>
    <button onClick={() => navigate('/admin/interviews/interview-001')} type="button">A 열기</button>
    <button onClick={() => navigate('/admin/interviews/interview-002')} type="button">B 열기</button>
    <LocationProbe />
    <InterviewReviewPage />
  </>
}

export function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

export function renderRoutedReview(api: AppApi, path = '/admin/interviews/interview-001') {
  return render(
    <ApiProvider api={api}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/admin/interviews/:interviewId" element={<RouteHarness />} /></Routes>
      </MemoryRouter>
    </ApiProvider>,
  )
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

export function installDownloadMocks(url = 'blob:review') {
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
