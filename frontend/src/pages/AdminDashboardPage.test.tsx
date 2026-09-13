import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiProvider } from '@/app/api-context'
import type { InterviewDetail, InterviewListItem } from '@/app/contracts'
import { AdminDashboardPage } from './AdminDashboardPage'
import { clone, createApi, deferred, detail, queue, renderDashboard, renderReview } from './admin-screens-harness'

afterEach(() => {
  document.querySelectorAll('a[download]').forEach((anchor) => anchor.remove())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('administrator interview queue', () => {
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

  it('keeps the dashboard header to dashboard actions', async () => {
    const api = createApi()
    renderDashboard(api)
    await screen.findByText('P-001')

    expect(screen.queryByRole('link', { name: '인터뷰 해보기' })).not.toBeInTheDocument()
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
