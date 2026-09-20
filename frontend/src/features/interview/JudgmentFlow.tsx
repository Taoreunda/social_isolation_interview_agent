import { useState } from 'react'

import type { InterviewDetail } from '@/app/contracts'

type LampState = 'true' | 'false' | 'empty' | 'current' | 'skipped' | 'recorded'

const STATE_NAME: Record<LampState, string> = {
  true: 'True',
  false: 'False',
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
  { name: '히키코모리', needs: { A: true, B: true, C: true, D: true }, rule: 'A·B·C·D 모두 True' },
  { name: '사회적 고립', needs: { A: false, B: true, C: true, D: true }, rule: 'B·C·D True, A False' },
  { name: '일반', needs: null, rule: '그 외 (A·B·C 모두 False이면 D·E를 묻지 않고 종료)' },
]

interface Rule {
  whenTrue: string
  whenFalse: string
  note?: string
}

const RULE: Record<string, Rule> = {
  A1: { whenTrue: '예', whenFalse: '아니요' },
  A2: { whenTrue: '주 4회 미만', whenFalse: '주 4회 이상' },
  A3: { whenTrue: '6개월 이상', whenFalse: '6개월 미만' },
  B1: { whenTrue: '0명', whenFalse: '1명 이상' },
  B2: { whenTrue: '3개월 이상', whenFalse: '3개월 미만' },
  C1: { whenTrue: '0명', whenFalse: '1명 이상' },
  C2: { whenTrue: '3개월 이상', whenFalse: '3개월 미만' },
  D1: { whenTrue: '고통 있음 또는 5점 이상', whenFalse: '고통 없음 또는 4점 이하' },
  D1_duration: { whenTrue: '3개월 이상', whenFalse: '3개월 미만', note: 'D1이 True일 때만 묻습니다' },
  D2: { whenTrue: '영향 있음 또는 5점 이상', whenFalse: '영향 없음 또는 4점 이하' },
  D2_duration: { whenTrue: '3개월 이상', whenFalse: '3개월 미만', note: 'D2가 True일 때만 묻습니다' },
}

// E1 and E2 are written down as spoken; nothing about them is True or False.
const FREE_RESPONSE = new Set(['E1', 'E2'])

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

function RuleLine({ fired, kind, text }: { fired: boolean; kind: 'true' | 'false'; text: string }) {
  return (
    <p
      className={`flex items-center gap-2 ${fired ? 'font-semibold' : 'text-muted-foreground'}`}
      data-fired={fired ? 'true' : 'false'}
      data-testid={kind === 'true' ? 'when-true' : 'when-false'}
    >
      <Light state={fired ? kind : 'empty'} />
      <span>{kind === 'true' ? 'True' : 'False'} → {text}</span>
    </p>
  )
}

function DetailOf({ rowState, selected }: { rowState: LampState; selected: InterviewDetail['scorecard'][number] }) {
  const rule = RULE[selected.questionId]
  return (
    <>
      <p className="leading-6">
        <span className="mr-2 font-mono font-semibold">{shortLabel(selected.questionId)}</span>
        <span>{selected.question}</span>
      </p>
      {rule && <div className="mt-2 space-y-1">
        <RuleLine fired={rowState === 'true'} kind="true" text={rule.whenTrue} />
        <RuleLine fired={rowState === 'false'} kind="false" text={rule.whenFalse} />
      </div>}
      {FREE_RESPONSE.has(selected.questionId) && <p className="mt-2 text-xs text-muted-foreground">판정 없음 · 말한 그대로 기록합니다</p>}
      {rule?.note && <p className="mt-2 text-xs text-muted-foreground">{rule.note}</p>}
      {rowState === 'skipped' && <p className="mt-2 text-xs text-muted-foreground">묻지 않고 건너뛰었습니다</p>}
      {(selected.value || selected.rationale) && <p className="mt-2 text-xs leading-5">
        {selected.value && <span className="mr-2 font-semibold">{selected.value}</span>}
        {selected.rationale && <span className="text-muted-foreground">{selected.rationale}</span>}
      </p>}
    </>
  )
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
      <div className="mt-4 min-h-20 border-t border-border pt-3 text-sm" data-testid="lamp-detail">
        {selected
          ? <DetailOf rowState={states.get(selected.questionId) ?? 'empty'} selected={selected} />
          : <p className="text-xs text-muted-foreground">불을 누르면 그 문항의 질문과 True·False 기준, 값, 근거가 보입니다.</p>}
      </div>
    </section>
  )
}
