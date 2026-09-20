import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiProvider } from '@/app/api-context'
import { InterviewTranscriptPage } from './InterviewTranscriptPage'
import { createApi, detail } from './admin-screens-harness'

afterEach(() => {
  document.querySelectorAll('a[download]').forEach((anchor) => anchor.remove())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('interview transcript screen', () => {
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

  it('marks an answer that was tapped from the suggested replies', async () => {
    const tapped = {
      ...detail,
      messages: [
        ...detail.messages,
        { id: 'u-tap', role: 'user' as const, content: '예, 대부분 집이나 방에서 보냈어요', createdAt: '2026-08-25T09:01:00.000Z', source: 'suggested' as const },
        { id: 'u-typed', role: 'user' as const, content: '직접 쓴 답변입니다', createdAt: '2026-08-25T09:02:00.000Z', source: 'typed' as const },
      ],
    }
    const api = createApi({ getInterview: vi.fn().mockResolvedValue(tapped) })
    render(
      <ApiProvider api={api}>
        <MemoryRouter initialEntries={['/admin/interviews/interview-001/transcript']}>
          <Routes>
            <Route path="/admin/interviews/:interviewId/transcript" element={<InterviewTranscriptPage />} />
          </Routes>
        </MemoryRouter>
      </ApiProvider>,
    )

    const tappedBubble = (await screen.findByText('예, 대부분 집이나 방에서 보냈어요')).closest('li')!
    expect(tappedBubble).toHaveTextContent('보기에서 선택')
    expect(screen.getByText('직접 쓴 답변입니다').closest('li')).not.toHaveTextContent('보기에서 선택')
  })
})
