import type { InterviewDetail, ScorecardRow } from '@/app/contracts'

type StepState = 'positive' | 'negative' | 'recorded' | 'current' | 'skipped' | 'pending'

interface Step {
  questionId: string
  question: string
  state: StepState
  value: string | null
  rationale: string | null
}

const STATE_LABEL: Record<StepState, string> = {
  positive: '긍정',
  negative: '부정',
  recorded: '기록',
  current: '현재',
  skipped: '건너뜀',
  pending: '대기',
}

const CRITERIA = ['A', 'B', 'C', 'D']

const CRITERION_NAME: Record<string, string> = {
  A: '칩거',
  B: '상호작용 결핍',
  C: '지지 결핍',
  D: '고통·기능 손상',
}

// Cut-offs as the interviewer applies them; keep in step with
// backend/interview/prompts.py and docs/interview-flow.md.
const CUT_OFF: Record<string, string> = {
  A1: '예 → 긍정 · 아니요 → 부정',
  A2: '주 4회 미만 → 긍정 · 4회 이상 → 부정',
  A3: '6개월 이상 → 긍정 · 미만 → 부정',
  B1: '0명 → 긍정 · 1명 이상 → 부정',
  B2: '3개월 이상 → 긍정 · 미만 → 부정',
  C1: '0명 → 긍정 · 1명 이상 → 부정',
  C2: '3개월 이상 → 긍정 · 미만 → 부정',
  D1: '고통 있음 또는 5점 이상 → 긍정 · 없음 또는 4점 이하 → 부정',
  D1_duration: 'D1 긍정일 때만 · 3개월 이상 → 긍정',
  D2: '영향 있음 또는 5점 이상 → 긍정 · 없음 또는 4점 이하 → 부정',
  D2_duration: 'D2 긍정일 때만 · 3개월 이상 → 긍정',
  E1: '판정 없음 · 말한 그대로 기록',
  E2: '판정 없음 · 말한 그대로 기록',
}

// A duration question is only asked when its gate question was positive.
const GATE_OF: Record<string, string> = { D1_duration: 'D1', D2_duration: 'D2' }

function criterionLabel(met: boolean | null): string {
  return met === null ? '미평가' : met ? '충족' : '미충족'
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

export function deriveSteps(detail: InterviewDetail): Step[] {
  const byId = new Map(detail.scorecard.map((row) => [row.questionId, row]))
  const earlyStop = stoppedEarly(detail)
  let currentFound = false
  return detail.scorecard.map((row: ScorecardRow) => {
    const base = { questionId: row.questionId, question: row.question, value: row.value, rationale: row.rationale }
    if (row.aiStatus !== null) return { ...base, state: row.aiStatus }
    const gate = GATE_OF[row.questionId]
    if (gate && byId.get(gate)?.aiStatus === 'negative') return { ...base, state: 'skipped' }
    if (earlyStop && /^[DE]/.test(row.questionId)) return { ...base, state: 'skipped' }
    if (detail.status === 'active' && !currentFound) {
      currentFound = true
      return { ...base, state: 'current' }
    }
    return { ...base, state: 'pending' }
  })
}

function stateClass(state: StepState): string {
  switch (state) {
    case 'current': return 'bg-primary text-primary-foreground'
    case 'positive': return 'bg-muted font-medium'
    case 'negative': return 'bg-muted'
    case 'recorded': return 'bg-muted'
    case 'skipped': return 'text-muted-foreground line-through'
    default: return 'text-muted-foreground'
  }
}

export function JudgmentFlow({ detail, showOutcome = true }: { detail: InterviewDetail; showOutcome?: boolean }) {
  const steps = deriveSteps(detail)
  const recorded = detail.scorecard.filter((row) => row.aiStatus !== null).length
  const earlyStop = stoppedEarly(detail)

  return (
    <section aria-label="판정 흐름" className="text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {showOutcome && <ul aria-label="기준" className="flex flex-wrap gap-1.5">
          {CRITERIA.map((key) => (
            <li className="inline-flex items-baseline gap-1.5 rounded-md border border-border px-2 py-0.5" key={key}>
              <span className="font-semibold">{key}</span>
              <span>{CRITERION_NAME[key]}</span>
              <span className="text-muted-foreground">{criterionLabel(detail.criteria[key] ?? null)}</span>
            </li>
          ))}
        </ul>}
        {showOutcome && <span className="inline-flex items-center gap-1">
          <span className="text-muted-foreground">진단</span>
          <span className="font-semibold">{detail.finalDiagnosis ?? '미산출'}</span>
        </span>}
        {showOutcome && earlyStop && <span className="rounded-md border border-border px-2 py-0.5 text-xs">조기 종료</span>}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{recorded} / {steps.length} 기입</span>
      </div>
      <ol aria-label="판정 흐름" className="mt-3 divide-y divide-border">
        {steps.map((step) => {
          const quiet = step.state === 'pending' || step.state === 'skipped'
          return (
            <li className={`grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 py-2 ${quiet ? 'text-muted-foreground' : ''}`} key={step.questionId}>
              <span className="font-mono text-xs leading-6" title={step.question}>{step.questionId}</span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${stateClass(step.state)}`}>{STATE_LABEL[step.state]}</span>
                  {step.value && <span className="font-medium text-foreground">{step.value}</span>}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{CUT_OFF[step.questionId] ?? step.question}</span>
                {step.rationale && <span className="mt-0.5 block text-xs text-muted-foreground">{step.rationale}</span>}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
