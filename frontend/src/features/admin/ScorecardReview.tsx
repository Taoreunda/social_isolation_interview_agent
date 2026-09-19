import { AlertCircle, CheckCircle2, Circle, FileText, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { ReviewScorecardInput, ScoreDecision, ScorecardRow } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

function Decision({ value }: { value: ScoreDecision | null }) {
  const label = value === 'positive'
    ? '긍정'
    : value === 'negative'
      ? '부정'
      : value === 'recorded'
        ? '기록'
        : '미검토'
  const Icon = value === 'positive'
    ? CheckCircle2
    : value === 'negative'
      ? XCircle
      : value === 'recorded'
        ? FileText
        : Circle

  return <span className="inline-flex items-center gap-1 whitespace-nowrap"><Icon aria-hidden="true" className="size-4" data-testid="decision-icon" />{label}</span>
}

function MobileLabel({ children }: { children: string }) {
  return <span className="mr-1 sm:hidden">{children}</span>
}

interface ScorecardReviewProps {
  interviewId: string
  scorecard: ScorecardRow[]
  onReview: (input: ReviewScorecardInput) => Promise<boolean>
}

export function ScorecardReview({ interviewId, scorecard, onReview }: ScorecardReviewProps) {
  const [selected, setSelected] = useState<ScorecardRow | null>(null)
  const [rationale, setRationale] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mounted = useRef(false)
  const actionLock = useRef<symbol | null>(null)
  const dialogGeneration = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      dialogGeneration.current += 1
    }
  }, [])

  function clearDialog(): void {
    dialogGeneration.current += 1
    setSelected(null)
    setRationale('')
    setError(null)
  }

  async function submit(input: ReviewScorecardInput, closeOnSuccess: boolean): Promise<void> {
    if (actionLock.current) return

    const action = Symbol('scorecard-review')
    const dialog = dialogGeneration.current
    actionLock.current = action
    setBusy(true)
    setError(null)

    try {
      const committed = await onReview(input)
      const isCurrentAction = actionLock.current === action
      const isCurrentDialog = dialogGeneration.current === dialog
      if (committed && mounted.current && isCurrentAction && (!closeOnSuccess || isCurrentDialog)) {
        clearDialog()
      }
    } catch {
      if (mounted.current && actionLock.current === action && dialogGeneration.current === dialog) {
        setError('검토를 저장하지 못했습니다')
      }
    } finally {
      if (actionLock.current === action) {
        actionLock.current = null
        if (mounted.current) setBusy(false)
      }
    }
  }

  function submitRationale(): void {
    if (!selected || !selected.expertStatus) return
    const agreed = selected.expertStatus === selected.aiStatus
    void submit({
      interviewId,
      questionId: selected.questionId,
      action: agreed ? 'approve' : 'override',
      ...(agreed ? {} : { expertStatus: selected.expertStatus as Exclude<ScoreDecision, 'recorded'> }),
      rationale: rationale.trim(),
    }, true)
  }

  const actionClass = 'h-auto min-h-11 min-w-11 whitespace-normal sm:min-h-8 sm:min-w-0'
  const errorId = 'review-rationale-error'

  return <>
    <Table aria-label="점수표">
      <TableHeader className="sr-only sm:not-sr-only sm:table-header-group">
        <TableRow>
          <TableHead className="w-[30%]">문항</TableHead>
          <TableHead className="w-[24%]">답변</TableHead>
          <TableHead className="w-[20%]">AI 판정</TableHead>
          <TableHead className="w-[13%]">전문가 판정</TableHead>
          <TableHead className="w-[13%] min-w-[11rem]">작업</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className="block sm:table-row-group">
        {scorecard.map((row) => <TableRow className="block sm:table-row" key={row.questionId}>
          <TableCell className="block break-words whitespace-normal sm:table-cell">
            <MobileLabel>문항:</MobileLabel>
            <span className="font-medium">{row.questionId}</span>
            <span className="ml-2 break-words text-muted-foreground">{row.question}</span>
          </TableCell>
          <TableCell className="block break-words whitespace-normal sm:table-cell">
            <MobileLabel>답변:</MobileLabel>
            {row.answer ?? (row.value ? null : <span className="text-muted-foreground">기록 없음</span>)}
            {row.value && row.value !== row.answer && (
              <span className="mt-1 inline-block rounded-md border border-border px-2 py-0.5 text-sm text-muted-foreground">
                {row.value}
              </span>
            )}
          </TableCell>
          <TableCell className="block break-words whitespace-normal sm:table-cell">
            <MobileLabel>AI:</MobileLabel><Decision value={row.aiStatus} />
            {row.rationale && <span className="mt-1 block text-sm text-muted-foreground">{row.rationale}</span>}
          </TableCell>
          <TableCell className="block break-words whitespace-normal sm:table-cell">
            <MobileLabel>전문가:</MobileLabel><Decision value={row.expertStatus} />
            {row.expertRationale && <span className="mt-1 block text-sm text-muted-foreground">{row.expertRationale}</span>}
          </TableCell>
          <TableCell className="block break-words whitespace-normal sm:table-cell">
            <MobileLabel>작업:</MobileLabel>
            <div className="flex flex-wrap gap-2">
              <Button
                aria-label={`${row.questionId} 맞음`}
                className={actionClass}
                disabled={busy || row.aiStatus === null}
                onClick={() => void submit({ interviewId, questionId: row.questionId, action: 'approve' }, false)}
                size="sm"
                type="button"
                variant="outline"
              >
                맞음
              </Button>
              <Button
                aria-label={`${row.questionId} 틀림`}
                className={actionClass}
                disabled={busy || row.aiStatus === null || row.aiStatus === 'recorded'}
                onClick={() => void submit({
                  interviewId,
                  questionId: row.questionId,
                  action: 'override',
                  expertStatus: row.aiStatus === 'positive' ? 'negative' : 'positive',
                }, false)}
                size="sm"
                type="button"
                variant="outline"
              >
                틀림
              </Button>
              <Button
                aria-label={`${row.questionId} 근거`}
                className={actionClass}
                disabled={busy || row.expertStatus === null}
                onClick={() => {
                  setSelected(row)
                  setRationale(row.expertRationale ?? '')
                  setError(null)
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                근거
              </Button>
            </div>
          </TableCell>
        </TableRow>)}
      </TableBody>
    </Table>
    {error && !selected && <p className="mt-3 inline-flex items-center gap-2" role="alert">
      <AlertCircle aria-hidden="true" className="size-4" />{error}
    </p>}
    <Dialog onOpenChange={(open) => !open && clearDialog()} open={Boolean(selected)}>
      <DialogContent>
        <DialogHeader><DialogTitle>판정 근거</DialogTitle></DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="review-rationale">근거</Label>
          <Textarea
            aria-describedby={error ? errorId : undefined}
            aria-invalid={Boolean(error)}
            disabled={busy}
            id="review-rationale"
            onChange={(event) => setRationale(event.target.value)}
            value={rationale}
          />
          {error && <p className="inline-flex items-center gap-2" id={errorId} role="alert">
            <AlertCircle aria-hidden="true" className="size-4" />{error}
          </p>}
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={clearDialog} type="button" variant="outline">취소</Button>
          <Button aria-busy={busy} disabled={busy} onClick={submitRationale} type="button">저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
