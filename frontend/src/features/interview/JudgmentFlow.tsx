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
            <li className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5" key={key}>
              <span className="font-semibold">{key}</span>
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
      <ol aria-label="판정 흐름" className="mt-3 space-y-1">
        {steps.map((step) => (
          <li className="grid grid-cols-[6.5rem_3rem_minmax(0,1fr)] items-baseline gap-2" key={step.questionId}>
            <span className={`truncate font-mono text-xs ${step.state === 'pending' || step.state === 'skipped' ? 'text-muted-foreground' : ''}`} title={step.question}>{step.questionId}</span>
            <span className={`rounded px-1.5 py-0.5 text-center text-xs ${stateClass(step.state)}`}>{STATE_LABEL[step.state]}</span>
            <span className="min-w-0 break-words">
              {step.value && <span className="mr-2 font-medium">{step.value}</span>}
              {step.rationale && <span className="text-muted-foreground">{step.rationale}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
