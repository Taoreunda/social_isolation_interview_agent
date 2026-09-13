import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiProvider } from '@/app/api-context'
import { InterviewTranscriptPage } from './InterviewTranscriptPage'
import { createApi } from './admin-screens-harness'

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
})
