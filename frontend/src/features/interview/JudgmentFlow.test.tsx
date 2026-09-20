import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { InterviewDetail, ScorecardRow } from '@/app/contracts'
import { JudgmentFlow } from './JudgmentFlow'

function row(questionId: string, aiStatus: ScorecardRow['aiStatus'] = null, value: string | null = null): ScorecardRow {
  return { questionId, question: `${questionId} 질문`, answer: null, value, rationale: aiStatus ? `${questionId} 근거` : null, aiStatus, expertStatus: null, expertRationale: null }
}

const order = ['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2', 'D1', 'D1_duration', 'D2', 'D2_duration', 'E1', 'E2']

function rowsWith(statuses: Record<string, [ScorecardRow['aiStatus'], string]>): ScorecardRow[] {
  return order.map((id) => statuses[id] ? row(id, statuses[id][0], statuses[id][1]) : row(id))
}

function detailWith(rows: ScorecardRow[], overrides: Partial<InterviewDetail> = {}): InterviewDetail {
  return {
    id: 'interview-001', participantCode: 'KU-001', status: 'active', progress: 30, reviewStatus: 'unreviewed',
    updatedAt: '2026-09-19T00:00:00.000Z', messages: [], scorecard: rows, finalDiagnosis: null,
    criteria: { A: null, B: null, C: null, D: null }, report: null, algorithmVersion: 'react-scorecard-v1', completedAt: null,
    ...overrides,
  }
}

const lamp = (id: string) => screen.getByTestId(`lamp-${id}`)
const light = (id: string) => within(lamp(id)).getByTestId('light')

describe('JudgmentFlow lamps', () => {
  it('shows one round lamp per question, in order, labelled by id only', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({}))} />)

    expect(screen.getAllByTestId(/^lamp-[A-E]\d/).map((node) => node.getAttribute('data-testid')))
      .toEqual(order.map((id) => `lamp-${id}`))
    expect(lamp('A1')).toHaveTextContent('A1')
    expect(lamp('D1_duration')).toHaveTextContent('D1기간')
    expect(light('A1')).toHaveClass('rounded-full')
    expect(screen.queryByText('칩거')).not.toBeInTheDocument()
    expect(screen.queryByText('상호작용 결핍')).not.toBeInTheDocument()
  })

  it('lights true green, false red, and leaves the rest empty', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({ A1: ['positive', '예'], A2: ['negative', '주 5회'] }))} />)

    expect(lamp('A1')).toHaveAttribute('data-state', 'true')
    expect(light('A1')).toHaveClass('bg-signal-true')
    expect(lamp('A2')).toHaveAttribute('data-state', 'false')
    expect(light('A2')).toHaveClass('bg-signal-false')
    expect(lamp('A3')).toHaveAttribute('data-state', 'current')
    expect(light('A3')).not.toHaveClass('bg-signal-true', 'bg-signal-false')
    expect(lamp('B1')).toHaveAttribute('data-state', 'empty')
    expect(light('B1')).not.toHaveClass('bg-signal-true', 'bg-signal-false')
  })

  it('says what each lamp means to a screen reader, since colour alone does not', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({ A1: ['positive', '예'], A2: ['negative', '주 5회'] }))} />)

    expect(screen.getByRole('button', { name: 'A1 True' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A2 False' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A3 지금 묻는 문항' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'B1 아직' })).toBeInTheDocument()
  })

  it('marks a skipped question and a recorded free response without calling them true or false', () => {
    const answered = Object.fromEntries(['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2'].map((id) => [id, ['positive', '예']])) as Record<string, [ScorecardRow['aiStatus'], string]>
    render(<JudgmentFlow detail={detailWith(rowsWith({ ...answered, D1: ['negative', '없음'], D2: ['negative', '없음'], E1: ['recorded', '없습니다'] }))} />)

    expect(lamp('D1_duration')).toHaveAttribute('data-state', 'skipped')
    expect(lamp('E1')).toHaveAttribute('data-state', 'recorded')
    expect(light('E1')).not.toHaveClass('bg-signal-true', 'bg-signal-false')
    expect(lamp('E2')).toHaveAttribute('data-state', 'current')
  })
})

describe('JudgmentFlow criteria and diagnosis', () => {
  it('lights A to D the same way: met green, not met red, unknown empty', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({}), { criteria: { A: true, B: false, C: null, D: null } })} />)

    expect(lamp('A')).toHaveAttribute('data-state', 'true')
    expect(within(lamp('A')).getByTestId('light')).toHaveClass('bg-signal-true')
    expect(lamp('B')).toHaveAttribute('data-state', 'false')
    expect(within(lamp('B')).getByTestId('light')).toHaveClass('bg-signal-false')
    expect(lamp('C')).toHaveAttribute('data-state', 'empty')
  })

  it('keeps the rule for a criterion on its lamp as a hint, not as text on screen', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({}))} />)

    expect(lamp('A')).toHaveAttribute('title', 'A3 그리고 (A1 또는 A2)')
    expect(lamp('D')).toHaveAttribute('title', '(D1 그리고 D1기간) 또는 (D2 그리고 D2기간)')
  })

  it('lights the diagnosis that was reached and turns the others red', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({}), {
      status: 'completed', finalDiagnosis: '사회적 고립', criteria: { A: false, B: true, C: true, D: true },
    })} />)

    expect(lamp('사회적 고립')).toHaveAttribute('data-state', 'true')
    expect(lamp('히키코모리')).toHaveAttribute('data-state', 'false')
    expect(lamp('일반')).toHaveAttribute('data-state', 'false')
  })

  it('rules a diagnosis out as soon as a criterion goes the other way', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({}), { criteria: { A: true, B: true, C: null, D: null } })} />)

    expect(lamp('히키코모리')).toHaveAttribute('data-state', 'empty')
    expect(lamp('사회적 고립')).toHaveAttribute('data-state', 'false')
    expect(lamp('일반')).toHaveAttribute('data-state', 'empty')
  })

  it('skips what an early stop never asked', () => {
    const answered = Object.fromEntries(['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2'].map((id) => [id, ['negative', '아니요']])) as Record<string, [ScorecardRow['aiStatus'], string]>
    render(<JudgmentFlow detail={detailWith(rowsWith(answered), {
      status: 'completed', finalDiagnosis: '일반', criteria: { A: false, B: false, C: false, D: null },
    })} />)

    expect(lamp('일반')).toHaveAttribute('data-state', 'true')
    expect(lamp('D1')).toHaveAttribute('data-state', 'skipped')
    expect(lamp('E2')).toHaveAttribute('data-state', 'skipped')
  })

  it('can hide the diagnosis row where the outcome is already shown elsewhere', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({}))} showOutcome={false} />)

    expect(screen.queryByTestId('lamp-히키코모리')).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: '판정 흐름' })).toBeInTheDocument()
  })
})

describe('JudgmentFlow detail', () => {
  it('reads as the question, then what makes it True and what makes it False', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({ A1: ['positive', '예'] }))} />)

    const detail = screen.getByTestId('lamp-detail')
    expect(detail).toHaveTextContent('A2')
    expect(detail).toHaveTextContent('A2 질문')
    expect(within(detail).getByTestId('when-true')).toHaveTextContent('True → 주 4회 미만')
    expect(within(detail).getByTestId('when-false')).toHaveTextContent('False → 주 4회 이상')
    expect(detail).not.toHaveTextContent('지금 묻는 문항')
    expect(within(detail).getByTestId('when-true')).toHaveAttribute('data-fired', 'false')
    expect(within(detail).getByTestId('when-false')).toHaveAttribute('data-fired', 'false')
  })

  it('lights the line that fired and adds the value and the rationale', async () => {
    const user = userEvent.setup()
    render(<JudgmentFlow detail={detailWith(rowsWith({ A1: ['positive', '예'], A2: ['negative', '주 5회'] }))} />)
    const detail = screen.getByTestId('lamp-detail')

    await user.click(screen.getByRole('button', { name: 'A1 True' }))

    expect(detail).toHaveTextContent('A1 질문')
    expect(within(detail).getByTestId('when-true')).toHaveTextContent('True → 예')
    expect(within(detail).getByTestId('when-false')).toHaveTextContent('False → 아니요')
    expect(within(detail).getByTestId('when-true')).toHaveAttribute('data-fired', 'true')
    expect(within(detail).getByTestId('when-false')).toHaveAttribute('data-fired', 'false')
    expect(detail).toHaveTextContent('A1 근거')
    expect(screen.getByRole('button', { name: 'A1 True' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'A2 False' }))

    expect(within(detail).getByTestId('when-false')).toHaveAttribute('data-fired', 'true')
    expect(within(detail).getByTestId('when-false')).toHaveTextContent('False → 주 4회 이상')
    expect(detail).toHaveTextContent('주 5회')
  })

  it('says a free response is recorded as spoken instead of inventing True and False', async () => {
    const user = userEvent.setup()
    render(<JudgmentFlow detail={detailWith(rowsWith({}))} />)

    await user.click(screen.getByRole('button', { name: 'E1 아직' }))

    const detail = screen.getByTestId('lamp-detail')
    expect(detail).toHaveTextContent('판정 없음')
    expect(within(detail).queryByTestId('when-true')).not.toBeInTheDocument()
  })

  it('notes when a question is only asked after another one was True', async () => {
    const user = userEvent.setup()
    render(<JudgmentFlow detail={detailWith(rowsWith({}))} />)

    await user.click(screen.getByRole('button', { name: 'D1기간 아직' }))

    const detail = screen.getByTestId('lamp-detail')
    expect(within(detail).getByTestId('when-true')).toHaveTextContent('True → 3개월 이상')
    expect(detail).toHaveTextContent('D1이 True일 때만 묻습니다')
  })
})
