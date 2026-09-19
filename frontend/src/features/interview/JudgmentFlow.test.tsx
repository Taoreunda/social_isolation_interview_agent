import { render, screen, within } from '@testing-library/react'
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

const step = (id: string) => screen.getByTestId(`step-${id}`)
const group = (key: string) => screen.getByTestId(`criterion-${key}`)
const rule = (name: string) => screen.getByTestId(`diagnosis-${name}`)
const lamp = (scope: HTMLElement, key: string) => within(scope).getByTestId(`lamp-${key}`)

describe('JudgmentFlow questions', () => {
  it('keeps the thirteen questions in order and marks the open one', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({ A1: ['positive', '예'], A2: ['negative', '주 5회'] }))} />)

    expect(screen.getAllByTestId(/^step-/).map((node) => node.getAttribute('data-testid'))).toEqual(order.map((id) => `step-${id}`))
    expect(step('A1')).toHaveTextContent('긍정')
    expect(step('A1')).toHaveTextContent('예')
    expect(step('A1')).toHaveAttribute('data-lit', 'true')
    expect(step('A2')).toHaveTextContent('부정')
    expect(step('A2')).toHaveAttribute('data-lit', 'false')
    expect(step('A3')).toHaveTextContent('현재')
    expect(step('B1')).toHaveTextContent('대기')
    expect(screen.getByText('2 / 13 기입')).toBeInTheDocument()
  })

  it('shows a duration question as skipped when its gate was negative', () => {
    const answered = Object.fromEntries(['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2'].map((id) => [id, ['positive', '예']])) as Record<string, [ScorecardRow['aiStatus'], string]>
    render(<JudgmentFlow detail={detailWith(rowsWith({ ...answered, D1: ['negative', '없음'] }))} />)

    expect(step('D1_duration')).toHaveTextContent('건너뜀')
    expect(step('D2')).toHaveTextContent('현재')
  })

  it('carries the cut-off next to every question', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({}))} />)

    expect(step('A1')).toHaveTextContent('예 → 긍정')
    expect(step('A2')).toHaveTextContent('주 4회 미만 → 긍정')
    expect(step('A3')).toHaveTextContent('6개월 이상 → 긍정')
    expect(step('B1')).toHaveTextContent('0명 → 긍정')
    expect(step('D1')).toHaveTextContent('5점 이상 → 긍정')
    expect(step('D1_duration')).toHaveTextContent('D1 긍정일 때만')
    expect(step('E1')).toHaveTextContent('판정 없음')
  })
})

describe('JudgmentFlow criteria', () => {
  it('names each criterion and states when it is met and when it is not', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({}))} />)

    expect(group('A')).toHaveTextContent('칩거')
    expect(group('A')).toHaveTextContent('충족: A3 긍정 그리고 (A1 또는 A2 긍정)')
    expect(group('A')).toHaveTextContent('미충족: A3 부정, 또는 A1·A2 모두 부정')
    expect(group('B')).toHaveTextContent('상호작용 결핍')
    expect(group('B')).toHaveTextContent('충족: B1 긍정 그리고 B2 긍정')
    expect(group('C')).toHaveTextContent('지지 결핍')
    expect(group('D')).toHaveTextContent('고통·기능 손상')
    expect(group('D')).toHaveTextContent('충족: (D1 그리고 D1_duration 긍정) 또는 (D2 그리고 D2_duration 긍정)')
    expect(group('A')).toHaveAttribute('data-state', 'unknown')
    expect(within(group('A')).getByText('미평가')).toBeInTheDocument()
  })

  it('lights a criterion when it is met and marks it when it is not', () => {
    render(<JudgmentFlow detail={detailWith(
      rowsWith({ A1: ['positive', '예'], A2: ['negative', '주 5회'], A3: ['positive', '1년'], B1: ['negative', '2명'], B2: ['positive', '6개월'] }),
      { criteria: { A: true, B: false, C: null, D: null } },
    )} />)

    expect(group('A')).toHaveAttribute('data-state', 'met')
    expect(within(group('A')).getByText('충족')).toBeInTheDocument()
    expect(group('B')).toHaveAttribute('data-state', 'unmet')
    expect(within(group('B')).getByText('미충족')).toBeInTheDocument()
    expect(group('C')).toHaveAttribute('data-state', 'unknown')
  })
})

describe('JudgmentFlow diagnosis rules', () => {
  it('lists the three rules with the combination each one needs', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({}))} />)

    const rules = screen.getByRole('list', { name: '진단 규칙' })
    expect(within(rules).getAllByRole('listitem')).toHaveLength(3)
    expect(rule('히키코모리')).toHaveTextContent('A·B·C·D 모두 충족')
    expect(rule('사회적 고립')).toHaveTextContent('B·C·D 충족, A 미충족')
    expect(rule('일반')).toHaveTextContent('그 외')
    expect(rule('히키코모리')).toHaveAttribute('data-state', 'possible')
    expect(lamp(rule('히키코모리'), 'A')).toHaveAttribute('data-lit', 'false')
  })

  it('turns lamps on as criteria are met and rules out what can no longer happen', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({}), { criteria: { A: true, B: true, C: null, D: null } })} />)

    expect(lamp(rule('히키코모리'), 'A')).toHaveAttribute('data-lit', 'true')
    expect(lamp(rule('히키코모리'), 'B')).toHaveAttribute('data-lit', 'true')
    expect(lamp(rule('히키코모리'), 'C')).toHaveAttribute('data-lit', 'false')
    expect(rule('히키코모리')).toHaveAttribute('data-state', 'possible')
    expect(rule('사회적 고립')).toHaveAttribute('data-state', 'excluded')
    expect(rule('사회적 고립')).toHaveTextContent('제외')
  })

  it('confirms the rule that the final diagnosis matches', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({}), {
      status: 'completed', finalDiagnosis: '사회적 고립', criteria: { A: false, B: true, C: true, D: true },
    })} />)

    expect(rule('사회적 고립')).toHaveAttribute('data-state', 'met')
    expect(rule('사회적 고립')).toHaveTextContent('확정')
    expect(lamp(rule('사회적 고립'), 'A')).toHaveAttribute('data-lit', 'true')
    expect(rule('히키코모리')).toHaveAttribute('data-state', 'excluded')
    expect(rule('일반')).toHaveAttribute('data-state', 'excluded')
  })

  it('confirms 일반 on an early stop and skips what was never asked', () => {
    const answered = Object.fromEntries(['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2'].map((id) => [id, ['negative', '아니요']])) as Record<string, [ScorecardRow['aiStatus'], string]>
    render(<JudgmentFlow detail={detailWith(rowsWith(answered), {
      status: 'completed', finalDiagnosis: '일반', criteria: { A: false, B: false, C: false, D: null },
    })} />)

    expect(rule('일반')).toHaveAttribute('data-state', 'met')
    expect(rule('일반')).toHaveTextContent('조기 종료')
    expect(rule('히키코모리')).toHaveAttribute('data-state', 'excluded')
    expect(step('D1')).toHaveTextContent('건너뜀')
    expect(step('E2')).toHaveTextContent('건너뜀')
  })

  it('can hide the rules where the outcome is already shown elsewhere', () => {
    render(<JudgmentFlow detail={detailWith(rowsWith({}))} showOutcome={false} />)

    expect(screen.queryByRole('list', { name: '진단 규칙' })).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: '판정 흐름' })).toBeInTheDocument()
  })
})
