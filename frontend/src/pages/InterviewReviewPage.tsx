import { AlertCircle, Download, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import { useApi } from '@/app/api-context'
import type { InterviewDetail, ReviewScorecardInput } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { ScorecardReview } from '@/features/admin/ScorecardReview'

export function InterviewReviewPage() {
  const api = useApi()
  const { interviewId = '' } = useParams()
  const [detail, setDetail] = useState<InterviewDetail | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [exportError, setExportError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const mounted = useRef(false)
  const generation = useRef(0)
  const reviewInFlight = useRef(false)
  const exportInFlight = useRef(false)
  const urls = useRef(new Set<string>())

  const load = useCallback(async () => {
    const current = ++generation.current
    setPhase('loading')
    try {
      const loaded = await api.getInterview(interviewId)
      if (!mounted.current || current !== generation.current) return
      setDetail(loaded); setPhase('ready')
    } catch {
      if (mounted.current && current === generation.current) setPhase('error')
    }
  }, [api, interviewId])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => {
      mounted.current = false
      generation.current += 1
      for (const url of urls.current) URL.revokeObjectURL?.(url)
      urls.current.clear()
    }
  }, [load])

  async function reviewScorecard(input: ReviewScorecardInput): Promise<void> {
    if (reviewInFlight.current || !detail) return
    reviewInFlight.current = true
    const current = ++generation.current
    try {
      const committed = await api.reviewScorecard({ ...input, interviewId: detail.id })
      if (mounted.current && current === generation.current) setDetail(committed)
    } finally {
      reviewInFlight.current = false
    }
  }

  async function exportCsv(): Promise<void> {
    if (exportInFlight.current || !detail) return
    if (typeof URL.createObjectURL !== 'function' || typeof URL.revokeObjectURL !== 'function') { setExportError('CSV를 다운로드할 수 없습니다'); return }
    exportInFlight.current = true
    setExporting(true); setExportError(null)
    try {
      const blob = await api.exportInterviewCsv(detail.id)
      if (!mounted.current) return
      const url = URL.createObjectURL(blob)
      urls.current.add(url)
      const link = document.createElement('a')
      const code = detail.participantCode.replace(/[^A-Za-z0-9._-]/g, '_') || 'interview'
      link.href = url; link.download = `${code}.csv`; link.click()
      URL.revokeObjectURL(url); urls.current.delete(url)
    } catch {
      if (mounted.current) setExportError('CSV를 다운로드하지 못했습니다')
    } finally {
      exportInFlight.current = false
      if (mounted.current) setExporting(false)
    }
  }

  if (phase === 'loading') return <main aria-busy="true" className="mx-auto w-full max-w-6xl px-4 py-6"><p role="status">인터뷰를 불러오는 중</p></main>
  if (phase === 'error') return <main className="mx-auto w-full max-w-6xl px-4 py-6"><p className="inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />인터뷰를 불러오지 못했습니다</p><Button className="mt-3" onClick={() => void load()} type="button" variant="outline"><RefreshCw aria-hidden="true" />다시 시도</Button></main>
  if (!detail) return null

  return <main className="mx-auto w-full max-w-6xl px-4 py-6">
    <div className="flex flex-wrap items-center gap-3"><div><h1 className="text-xl font-semibold">인터뷰 검토</h1><p className="mt-1 text-sm text-muted-foreground">{detail.participantCode}</p></div><Button className="ml-auto" aria-busy={exporting} disabled={exporting} onClick={() => void exportCsv()} type="button" variant="outline"><Download aria-hidden="true" />CSV 다운로드</Button></div>
    {exportError && <p className="mt-3 inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />{exportError}</p>}
    <div className="mt-6 grid gap-8 lg:grid-cols-2" data-testid="review-split">
      <section aria-labelledby="transcript-heading"><h2 className="text-lg font-semibold" id="transcript-heading">대화</h2><ol className="mt-3 divide-y divide-border border-y border-border">{detail.messages.map((message) => <li className="py-3" key={message.id}><p className="text-sm font-medium">{message.role === 'user' ? '참여자' : '진행자'}</p><p aria-label={message.role === 'user' ? '참여자 메시지' : '진행자 메시지'} className="mt-1 whitespace-pre-wrap break-words">{message.content}</p></li>)}</ol></section>
      <section aria-labelledby="scorecard-heading"><h2 className="text-lg font-semibold" id="scorecard-heading">점수표</h2><div className="mt-3"><ScorecardReview scorecard={detail.scorecard} onReview={reviewScorecard} /></div></section>
    </div>
  </main>
}
