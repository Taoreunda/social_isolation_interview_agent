import type { InterviewDetail, ScorecardRow } from '@/app/contracts'

type StepState = 'positive' | 'negative' | 'recorded' | 'current' | 'skipped' | 'pending'
type CriterionState = 'met' | 'unmet' | 'unknown'
type RuleState = 'met' | 'possible' | 'excluded'

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

const CRITERION_LABEL: Record<CriterionState, string> = { met: '충족', unmet: '미충족', unknown: '미평가' }
const RULE_LABEL: Record<RuleState, string> = { met: '확정', possible: '가능', excluded: '제외' }

// Criteria, their rules and cut-offs as the interviewer applies them; keep in
// step with backend/interview/scorecard.py, prompts.py and docs/interview-flow.md.
const GROUPS: { key: string; name: string; met: string | null; unmet: string | null }[] = [
  { key: 'A', name: '칩거', met: 'A3 긍정 그리고 (A1 또는 A2 긍정)', unmet: 'A3 부정, 또는 A1·A2 모두 부정' },
  { key: 'B', name: '상호작용 결핍', met: 'B1 긍정 그리고 B2 긍정', unmet: 'B1 또는 B2 부정' },
  { key: 'C', name: '지지 결핍', met: 'C1 긍정 그리고 C2 긍정', unmet: 'C1 또는 C2 부정' },
  { key: 'D', name: '고통·기능 손상', met: '(D1 그리고 D1_duration 긍정) 또는 (D2 그리고 D2_duration 긍정)', unmet: '두 경로 모두 성립하지 않음' },
  { key: 'E', name: '추가 정보', met: null, unmet: null },
]

const RULES: { name: string; summary: string; needs: Record<string, boolean> | null }[] = [
  { name: '히키코모리', summary: 'A·B·C·D 모두 충족', needs: { A: true, B: true, C: true, D: true } },
  { name: '사회적 고립', summary: 'B·C·D 충족, A 미충족', needs: { A: false, B: true, C: true, D: true } },
  { name: '일반', summary: '그 외 (A·B·C 모두 미충족이면 D·E를 묻지 않고 종료)', needs: null },
]

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

function criterionState(value: boolean | null | undefined): CriterionState {
  return value === true ? 'met' : value === false ? 'unmet' : 'unknown'
}

function ruleState(detail: InterviewDetail, rule: (typeof RULES)[number]): RuleState {
  if (detail.finalDiagnosis) return detail.finalDiagnosis === rule.name ? 'met' : 'excluded'
  const { A, B, C, D } = detail.criteria
  if (rule.needs === null) {
    if (B === false || C === false || D === false) return 'met'
    if (B === true && C === true && D === true) return 'excluded'
    return 'possible'
  }
  const actual: Record<string, boolean | null | undefined> = { A, B, C, D }
  const keys = Object.keys(rule.needs)
  if (keys.some((key) => actual[key] !== null && actual[key] !== undefined && actual[key] !== rule.needs![key])) return 'excluded'
  return keys.every((key) => actual[key] === rule.needs![key]) ? 'met' : 'possible'
}

const LAMP = {
  on: 'border-primary bg-primary text-primary-foreground',
  off: 'border-border text-muted-foreground',
  struck: 'border-border text-muted-foreground line-through',
}

function stepLamp(state: StepState): string {
  if (state === 'positive') return 'border-primary bg-primary'
  if (state === 'current') return 'border-primary ring-2 ring-primary/30'
  if (state === 'recorded') return 'border-foreground bg-foreground/40'
  return 'border-border'
}

export function JudgmentFlow({ detail, showOutcome = true }: { detail: InterviewDetail; showOutcome?: boolean }) {
  const steps = deriveSteps(detail)
  const recorded = detail.scorecard.filter((row) => row.aiStatus !== null).length
  const earlyStop = stoppedEarly(detail)
  const known = new Set(GROUPS.map((group) => group.key))
  const groups = [
    ...GROUPS.map((group) => ({ ...group, steps: steps.filter((step) => step.questionId.startsWith(group.key)) })),
    { key: '기타', name: '기타', met: null, unmet: null, steps: steps.filter((step) => !known.has(step.questionId[0])) },
  ].filter((group) => group.steps.length > 0)

  return (
    <section aria-label="판정 흐름" className="text-sm">
      {showOutcome && <ul aria-label="진단 규칙" className="space-y-2">
        {RULES.map((rule) => {
          const state = ruleState(detail, rule)
          return (
            <li
              className={`rounded-md border px-3 py-2 ${state === 'met' ? 'border-primary' : 'border-border'} ${state === 'excluded' ? 'opacity-60' : ''}`}
              data-state={state}
              data-testid={`diagnosis-${rule.name}`}
              key={rule.name}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={`font-semibold ${state === 'excluded' ? 'line-through' : ''}`}>{rule.name}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${state === 'met' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {RULE_LABEL[state]}
                </span>
                {rule.needs === null && state === 'met' && earlyStop && <span className="text-xs text-muted-foreground">조기 종료</span>}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{rule.summary}</p>
              {rule.needs && <div className="mt-1.5 flex flex-wrap gap-1">
                {Object.entries(rule.needs).map(([key, needed]) => {
                  const actual = detail.criteria[key]
                  const lit = actual === needed
                  const struck = actual !== null && actual !== undefined && actual !== needed
                  return (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${lit ? LAMP.on : struck ? LAMP.struck : LAMP.off}`}
                      data-lit={lit ? 'true' : 'false'}
                      data-testid={`lamp-${key}`}
                      key={key}
                    >
                      {key} {needed ? '충족' : '미충족'}
                    </span>
                  )
                })}
              </div>}
            </li>
          )
        })}
      </ul>}
      <p className={`text-right text-xs tabular-nums text-muted-foreground ${showOutcome ? 'mt-3' : ''}`}>{recorded} / {steps.length} 기입</p>
      <ol aria-label="판정 흐름" className="mt-2 space-y-4">
        {groups.map((group) => {
          const state = criterionState(detail.criteria[group.key])
          const judged = group.met !== null
          return (
            <li data-state={judged ? state : 'none'} data-testid={`criterion-${group.key}`} key={group.key}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${judged && state === 'met' ? LAMP.on : judged && state === 'unmet' ? LAMP.struck : LAMP.off}`}>
                  {group.key}
                </span>
                <span className="font-semibold">{group.name}</span>
                {judged && <span className={`rounded px-1.5 py-0.5 text-xs ${state === 'met' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {CRITERION_LABEL[state]}
                </span>}
              </div>
              {judged && <dl className="mt-1 space-y-0.5 pl-8 text-xs text-muted-foreground">
                <div><dt className="inline">충족: </dt><dd className="inline">{group.met}</dd></div>
                <div><dt className="inline">미충족: </dt><dd className="inline">{group.unmet}</dd></div>
              </dl>}
              <ul aria-label={`${group.key} 문항`} className="mt-1.5 divide-y divide-border border-y border-border">
                {group.steps.map((step) => {
                  const quiet = step.state === 'pending' || step.state === 'skipped'
                  return (
                    <li
                      className={`grid grid-cols-[0.75rem_6rem_minmax(0,1fr)] items-baseline gap-x-2 py-1.5 ${quiet ? 'text-muted-foreground' : ''}`}
                      data-lit={step.state === 'positive' ? 'true' : 'false'}
                      data-testid={`step-${step.questionId}`}
                      key={step.questionId}
                    >
                      <span aria-hidden="true" className={`size-2.5 self-center rounded-full border ${stepLamp(step.state)}`} />
                      <span className={`font-mono text-xs ${step.state === 'skipped' ? 'line-through' : ''}`} title={step.question}>{step.questionId}</span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className={`text-xs ${step.state === 'current' ? 'rounded bg-primary px-1.5 py-0.5 text-primary-foreground' : step.state === 'positive' ? 'font-semibold text-foreground' : ''}`}>
                            {STATE_LABEL[step.state]}
                          </span>
                          {step.value && <span className="font-medium text-foreground">{step.value}</span>}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{CUT_OFF[step.questionId] ?? step.question}</span>
                        {step.rationale && <span className="mt-0.5 block text-xs text-muted-foreground">{step.rationale}</span>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
