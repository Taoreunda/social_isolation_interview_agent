import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { InterviewDetail, ScorecardRow } from '@/app/contracts'
import { JudgmentFlow } from './JudgmentFlow'

function row(questionId: string, aiStatus: ScorecardRow['aiStatus'] = null, value: string | null = null): ScorecardRow {
  return { questionId, question: `${questionId} 질문`, answer: null, value, rationale: aiStatus ? `${questionId} 근거` : null, aiStatus, expertStatus: null, expertRationale: null }
}

const order = ['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2', 'D1', 'D1_duration', 'D2', 'D2_duration', 'E1', 'E2']

function detailWith(rows: ScorecardRow[], overrides: Partial<InterviewDetail> = {}): InterviewDetail {
  return {
    id: 'interview-001', participantCode: 'KU-001', status: 'active', progress: 30, reviewStatus: 'unreviewed',
    updatedAt: '2026-09-19T00:00:00.000Z', messages: [], scorecard: rows, finalDiagnosis: null,
    criteria: { A: null, B: null, C: null, D: null }, report: null, algorithmVersion: 'react-scorecard-v1', completedAt: null,
    ...overrides,
  }
}

describe('JudgmentFlow', () => {
  it('walks the questions in order and marks the one that is open', () => {
    const rows = order.map((id) => id === 'A1' ? row('A1', 'positive', '예') : id === 'A2' ? row('A2', 'negative', '주 5회') : row(id))
    render(<JudgmentFlow detail={detailWith(rows)} />)

    const steps = within(screen.getByRole('list', { name: '판정 흐름' })).getAllByRole('listitem')
    expect(steps).toHaveLength(13)
    expect(steps[0]).toHaveTextContent('A1')
    expect(steps[0]).toHaveTextContent('긍정')
    expect(steps[0]).toHaveTextContent('예')
    expect(steps[1]).toHaveTextContent('부정')
    expect(steps[2]).toHaveTextContent('현재')
    expect(steps[3]).toHaveTextContent('대기')
  })

  it('shows a duration step as skipped when its gate question was negative', () => {
    const rows = order.map((id) => ['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2'].includes(id) ? row(id, 'positive', '예')
      : id === 'D1' ? row('D1', 'negative', '없음') : row(id))
    render(<JudgmentFlow detail={detailWith(rows)} />)

    const steps = within(screen.getByRole('list', { name: '판정 흐름' })).getAllByRole('listitem')
    expect(steps[8]).toHaveTextContent('D1_duration')
    expect(steps[8]).toHaveTextContent('건너뜀')
    expect(steps[9]).toHaveTextContent('현재')
  })

  it('shows criteria, the diagnosis and an early stop', () => {
    const rows = order.map((id) => ['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2'].includes(id) ? row(id, 'negative', '아니요') : row(id))
    render(<JudgmentFlow detail={detailWith(rows, {
      status: 'completed', finalDiagnosis: '일반', criteria: { A: false, B: false, C: false, D: null },
    })} />)

    const criteria = screen.getByRole('list', { name: '기준' })
    expect(within(criteria).getByText('A')).toBeInTheDocument()
    expect(within(criteria).getAllByText('미충족')).toHaveLength(3)
    expect(within(criteria).getByText('미평가')).toBeInTheDocument()
    expect(screen.getByText('일반')).toBeInTheDocument()
    expect(screen.getByText(/조기 종료/)).toBeInTheDocument()
    const steps = within(screen.getByRole('list', { name: '판정 흐름' })).getAllByRole('listitem')
    expect(steps[7]).toHaveTextContent('건너뜀')
    expect(steps[12]).toHaveTextContent('건너뜀')
  })

  it('reports how far the interview has come', () => {
    const rows = order.map((id) => ['A1', 'A2'].includes(id) ? row(id, 'positive', '예') : row(id))
    render(<JudgmentFlow detail={detailWith(rows)} />)

    expect(screen.getByText('2 / 13 기입')).toBeInTheDocument()
  })
})
