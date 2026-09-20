import { useState } from 'react'

import type { InterviewDetail } from '@/app/contracts'

type LampState = 'true' | 'false' | 'empty' | 'current' | 'skipped' | 'recorded'

const STATE_NAME: Record<LampState, string> = {
  true: '참',
  false: '거짓',
  empty: '아직',
  current: '지금 묻는 문항',
  skipped: '건너뜀',
  recorded: '기록됨',
}

// Criteria, rules and cut-offs as the interviewer applies them; keep in step
// with backend/interview/scorecard.py, prompts.py and docs/interview-flow.md.
const ROWS: { key: string; rule: string | null }[] = [
  { key: 'A', rule: 'A3 그리고 (A1 또는 A2)' },
  { key: 'B', rule: 'B1 그리고 B2' },
  { key: 'C', rule: 'C1 그리고 C2' },
  { key: 'D', rule: '(D1 그리고 D1기간) 또는 (D2 그리고 D2기간)' },
  { key: 'E', rule: null },
]

const DIAGNOSES: { name: string; needs: Record<string, boolean> | null; rule: string }[] = [
  { name: '히키코모리', needs: { A: true, B: true, C: true, D: true }, rule: 'A·B·C·D 모두 참' },
  { name: '사회적 고립', needs: { A: false, B: true, C: true, D: true }, rule: 'B·C·D 참, A 거짓' },
  { name: '일반', needs: null, rule: '그 외 (A·B·C 모두 거짓이면 D·E를 묻지 않고 종료)' },
]

const CUT_OFF: Record<string, string> = {
  A1: '예 → 참 · 아니요 → 거짓',
  A2: '주 4회 미만 → 참 · 4회 이상 → 거짓',
  A3: '6개월 이상 → 참 · 미만 → 거짓',
  B1: '0명 → 참 · 1명 이상 → 거짓',
  B2: '3개월 이상 → 참 · 미만 → 거짓',
  C1: '0명 → 참 · 1명 이상 → 거짓',
  C2: '3개월 이상 → 참 · 미만 → 거짓',
  D1: '고통 있음 또는 5점 이상 → 참 · 없음 또는 4점 이하 → 거짓',
  D1_duration: 'D1이 참일 때만 묻는다 · 3개월 이상 → 참',
  D2: '영향 있음 또는 5점 이상 → 참 · 없음 또는 4점 이하 → 거짓',
  D2_duration: 'D2가 참일 때만 묻는다 · 3개월 이상 → 참',
  E1: '판정 없음 · 말한 그대로 기록',
  E2: '판정 없음 · 말한 그대로 기록',
}

// A duration question is only asked when its gate question was true.
const GATE_OF: Record<string, string> = { D1_duration: 'D1', D2_duration: 'D2' }

function shortLabel(questionId: string): string {
  return questionId.replace('_duration', '기간')
}

// The interviewer stops after C2 when none of A, B, C can be met.
function stoppedEarly(detail: InterviewDetail): boolean {
  if (detail.status === 'active') return false
  const { A, B, C } = detail.criteria
  if (A !== false || B !== false || C !== false) return false
  return detail.scorecard
    .filter((row) => /^[DE]/.test(row.questionId))
    .every((row) => row.aiStatus === null)
}

export function questionStates(detail: InterviewDetail): Map<string, LampState> {
  const byId = new Map(detail.scorecard.map((row) => [row.questionId, row]))
  const earlyStop = stoppedEarly(detail)
  const states = new Map<string, LampState>()
  let currentFound = false
  for (const row of detail.scorecard) {
    const gate = GATE_OF[row.questionId]
    if (row.aiStatus === 'positive') states.set(row.questionId, 'true')
    else if (row.aiStatus === 'negative') states.set(row.questionId, 'false')
    else if (row.aiStatus === 'recorded') states.set(row.questionId, 'recorded')
    else if (gate && byId.get(gate)?.aiStatus === 'negative') states.set(row.questionId, 'skipped')
    else if (earlyStop && /^[DE]/.test(row.questionId)) states.set(row.questionId, 'skipped')
    else if (detail.status === 'active' && !currentFound) {
      currentFound = true
      states.set(row.questionId, 'current')
    } else states.set(row.questionId, 'empty')
  }
  return states
}

function criterionState(value: boolean | null | undefined): LampState {
  return value === true ? 'true' : value === false ? 'false' : 'empty'
}

function diagnosisState(detail: InterviewDetail, diagnosis: (typeof DIAGNOSES)[number]): LampState {
  if (detail.finalDiagnosis) return detail.finalDiagnosis === diagnosis.name ? 'true' : 'false'
  const { A, B, C, D } = detail.criteria
  if (diagnosis.needs === null) {
    if (B === false || C === false || D === false) return 'true'
    return B === true && C === true && D === true ? 'false' : 'empty'
  }
  const actual: Record<string, boolean | null | undefined> = { A, B, C, D }
  const keys = Object.keys(diagnosis.needs)
  if (keys.some((key) => typeof actual[key] === 'boolean' && actual[key] !== diagnosis.needs![key])) return 'false'
  return keys.every((key) => actual[key] === diagnosis.needs![key]) ? 'true' : 'empty'
}

function lightClass(state: LampState): string {
  switch (state) {
    case 'true': return 'border-signal-true bg-signal-true'
    case 'false': return 'border-signal-false bg-signal-false'
    case 'current': return 'border-foreground ring-2 ring-foreground/20'
    case 'recorded': return 'border-foreground bg-foreground/50'
    case 'skipped': return 'border-dashed border-border opacity-50'
    default: return 'border-border'
  }
}

function Light({ state, large = false }: { state: LampState; large?: boolean }) {
  return <span aria-hidden="true" className={`${large ? 'size-5' : 'size-4'} shrink-0 rounded-full border-2 ${lightClass(state)}`} data-testid="light" />
}

export function JudgmentFlow({ detail, showOutcome = true }: { detail: InterviewDetail; showOutcome?: boolean }) {
  const states = questionStates(detail)
  const current = detail.scorecard.find((row) => states.get(row.questionId) === 'current')?.questionId ?? null
  const [picked, setPicked] = useState<string | null>(null)
  const selectedId = picked && states.has(picked) ? picked : current
  const selected = detail.scorecard.find((row) => row.questionId === selectedId) ?? null
  const recorded = detail.scorecard.filter((row) => row.aiStatus !== null).length
  const rowKeys = new Set(ROWS.map((row) => row.key))
  const rows = [
    ...ROWS.map((row) => ({ ...row, questions: detail.scorecard.filter((item) => item.questionId.startsWith(row.key)) })),
    { key: '기타', rule: null, questions: detail.scorecard.filter((item) => !rowKeys.has(item.questionId[0])) },
  ].filter((row) => row.questions.length > 0)

  return (
    <section aria-label="판정 흐름" className="text-sm">
      {showOutcome && <ul aria-label="진단" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3">
        {DIAGNOSES.map((diagnosis) => {
          const state = diagnosisState(detail, diagnosis)
          return (
            <li
              className="inline-flex items-center gap-1.5"
              data-state={state}
              data-testid={`lamp-${diagnosis.name}`}
              key={diagnosis.name}
              title={diagnosis.rule}
            >
              <Light large state={state} />
              <span className={state === 'false' ? 'text-muted-foreground' : 'font-medium'}>{diagnosis.name}</span>
              <span className="sr-only">{STATE_NAME[state]}</span>
            </li>
          )
        })}
        <li className="ml-auto text-xs tabular-nums text-muted-foreground">{recorded} / {detail.scorecard.length}</li>
      </ul>}
      <ol aria-label="판정 흐름" className={`space-y-3 ${showOutcome ? 'mt-3' : ''}`}>
        {rows.map((row) => {
          const state = criterionState(detail.criteria[row.key])
          return (
            <li className="flex items-start gap-4" key={row.key}>
              {row.rule
                ? <span
                    className="inline-flex w-10 shrink-0 flex-col items-center gap-1"
                    data-state={state}
                    data-testid={`lamp-${row.key}`}
                    title={row.rule}
                  >
                    <Light large state={state} />
                    <span className="text-xs font-semibold">{row.key}</span>
                    <span className="sr-only">{STATE_NAME[state]}</span>
                  </span>
                : <span className="inline-flex w-10 shrink-0 flex-col items-center gap-1 pt-6 text-xs font-semibold text-muted-foreground">{row.key}</span>}
              <span className="flex flex-wrap gap-x-3 gap-y-2 border-l border-border pl-4">
                {row.questions.map((question) => {
                  const questionState = states.get(question.questionId) ?? 'empty'
                  const label = shortLabel(question.questionId)
                  return (
                    <button
                      aria-label={`${label} ${STATE_NAME[questionState]}`}
                      aria-pressed={selectedId === question.questionId}
                      className={`inline-flex w-12 flex-col items-center gap-1 rounded-md px-1 py-1 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${selectedId === question.questionId ? 'bg-accent' : ''}`}
                      data-state={questionState}
                      data-testid={`lamp-${question.questionId}`}
                      key={question.questionId}
                      onClick={() => setPicked(question.questionId)}
                      type="button"
                    >
                      <Light state={questionState} />
                      <span className={`font-mono text-xs ${questionState === 'skipped' ? 'text-muted-foreground line-through' : ''}`}>{label}</span>
                    </button>
                  )
                })}
              </span>
            </li>
          )
        })}
      </ol>
      <div className="mt-4 min-h-16 border-t border-border pt-3 text-xs" data-testid="lamp-detail">
        {selected
          ? <>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono font-semibold">{shortLabel(selected.questionId)}</span>
                <span>{STATE_NAME[states.get(selected.questionId) ?? 'empty']}</span>
                {selected.value && <span className="font-medium">{selected.value}</span>}
              </p>
              <p className="mt-1 text-muted-foreground">{CUT_OFF[selected.questionId] ?? ''}</p>
              <p className="mt-1 text-muted-foreground">{selected.question}</p>
              {selected.rationale && <p className="mt-1">{selected.rationale}</p>}
            </>
          : <p className="text-muted-foreground">불을 누르면 그 문항의 기준과 값, 근거가 보입니다.</p>}
      </div>
    </section>
  )
}
