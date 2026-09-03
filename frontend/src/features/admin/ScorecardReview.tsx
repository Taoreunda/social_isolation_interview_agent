import { AlertCircle, CheckCircle2, Circle, FileText, XCircle } from 'lucide-react'
import { useRef, useState } from 'react'

import type { ReviewScorecardInput, ScoreDecision, ScorecardRow } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

function Decision({ value }: { value: ScoreDecision | null }) {
  const label = value === 'positive' ? '긍정' : value === 'negative' ? '부정' : value === 'recorded' ? '기록' : '미검토'
  const Icon = value === 'positive' ? CheckCircle2 : value === 'negative' ? XCircle : value === 'recorded' ? FileText : Circle
  return <span className="inline-flex items-center gap-1"><Icon aria-hidden="true" className="size-4" data-testid="decision-icon" />{label}</span>
}

interface ScorecardReviewProps {
  scorecard: ScorecardRow[]
  onReview: (input: ReviewScorecardInput) => Promise<void>
}

export function ScorecardReview({ scorecard, onReview }: ScorecardReviewProps) {
  const [selected, setSelected] = useState<ScorecardRow | null>(null)
  const [decision, setDecision] = useState<Exclude<ScoreDecision, 'recorded'> | null>(null)
  const [rationale, setRationale] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const requestInFlight = useRef(false)

  function clearDialog(): void {
    setSelected(null); setDecision(null); setRationale(''); setError(null)
  }

  async function submit(input: ReviewScorecardInput, closeOnSuccess: boolean): Promise<void> {
    if (requestInFlight.current) return
    requestInFlight.current = true
    setSubmitting(true)
    setError(null)
    try {
      await onReview(input)
      if (closeOnSuccess) clearDialog()
    } catch {
      setError('검토를 저장하지 못했습니다')
    } finally {
      requestInFlight.current = false
      setSubmitting(false)
    }
  }

  async function submitOverride(): Promise<void> {
    if (!selected || !decision) return
    const trimmed = rationale.trim()
    if (!trimmed) { setError('근거를 입력하세요'); return }
    await submit({ interviewId: '', questionId: selected.questionId, action: 'override', expertStatus: decision, rationale: trimmed }, true)
  }

  return <>
    <Table aria-label="점수표">
      <TableHeader className="hidden sm:table-header-group"><TableRow><TableHead>문항</TableHead><TableHead>값</TableHead><TableHead>AI</TableHead><TableHead>전문가</TableHead><TableHead><span className="sr-only">작업</span></TableHead></TableRow></TableHeader>
      <TableBody className="block sm:table-row-group">
        {scorecard.map((row) => <TableRow className="block sm:table-row" key={row.questionId}>
          <TableCell className="block break-words sm:table-cell"><span className="font-medium">{row.questionId}</span><span className="ml-2 text-muted-foreground">{row.question}</span></TableCell>
          <TableCell className="block break-words whitespace-normal sm:table-cell">{row.value ?? '없음'}</TableCell>
          <TableCell className="block sm:table-cell"><Decision value={row.aiStatus} /></TableCell>
          <TableCell className="block sm:table-cell"><Decision value={row.expertStatus} /></TableCell>
          <TableCell className="block sm:table-cell"><div className="flex flex-wrap gap-2"><Button aria-label={`${row.questionId} 동의`} disabled={submitting} onClick={() => void submit({ interviewId: '', questionId: row.questionId, action: 'approve' }, false)} size="sm" type="button" variant="outline">동의</Button><Button aria-label={`${row.questionId} 변경`} disabled={submitting} onClick={() => { setSelected(row); setDecision(row.aiStatus === 'positive' || row.aiStatus === 'negative' ? row.aiStatus : null); setError(null) }} size="sm" type="button" variant="outline">변경</Button></div></TableCell>
        </TableRow>)}
      </TableBody>
    </Table>
    {error && !selected && <p className="mt-3 inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />{error}</p>}
    <Dialog onOpenChange={(open) => !open && clearDialog()} open={Boolean(selected)}>
      <DialogContent>
        <DialogHeader><DialogTitle>판정 변경</DialogTitle></DialogHeader>
        <fieldset className="grid gap-2" disabled={submitting}><legend className="text-sm font-medium">판정</legend><label className="flex items-center gap-2"><input checked={decision === 'positive'} name="decision" onChange={() => setDecision('positive')} type="radio" />긍정</label><label className="flex items-center gap-2"><input checked={decision === 'negative'} name="decision" onChange={() => setDecision('negative')} type="radio" />부정</label></fieldset>
        <div className="grid gap-2"><Label htmlFor="review-rationale">근거</Label><Textarea disabled={submitting} id="review-rationale" onChange={(event) => setRationale(event.target.value)} value={rationale} /></div>
        {error && <p className="inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />{error}</p>}
        <DialogFooter><Button disabled={submitting} onClick={clearDialog} type="button" variant="outline">취소</Button><Button aria-busy={submitting} disabled={submitting || !decision} onClick={() => void submitOverride()} type="button">저장</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
