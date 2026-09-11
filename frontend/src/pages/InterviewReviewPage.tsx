import { AlertCircle, Archive, Download, MessagesSquare, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useApi } from '@/app/api-context'
import { hasApiStatus } from '@/app/api-error'
import type { InterviewDetail, ReviewScorecardInput } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { ScorecardReview } from '@/features/admin/ScorecardReview'

interface RouteVisit {
  id: string
  generation: number
}

interface RequestOwner extends RouteVisit {
  request: symbol
}

function sameVisit(left: RouteVisit, right: RouteVisit): boolean {
  return left.id === right.id && left.generation === right.generation
}

function csvName(code: string): string {
  const safeCode = code
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `${safeCode || 'interview'}.csv`
}

function criterionLabel(key: string, met: boolean | null): string {
  return `${key} ${met === null ? '미평가' : met ? '충족' : '미충족'}`
}

export function InterviewReviewPage() {
  const api = useApi()
  const { interviewId = '' } = useParams()
  const [detail, setDetail] = useState<InterviewDetail | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading')
  const [exportError, setExportError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const mounted = useRef(false)
  const routeGeneration = useRef(0)
  const currentVisit = useRef<RouteVisit>({ id: interviewId, generation: 0 })
  const loadRequest = useRef<RequestOwner | null>(null)
  const reviewLocks = useRef(new Map<string, RequestOwner>())
  const exportLock = useRef<RequestOwner | null>(null)
  const revokeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  if (currentVisit.current.id !== interviewId || currentVisit.current.generation === 0) {
    currentVisit.current = { id: interviewId, generation: ++routeGeneration.current }
  }
  const visit = currentVisit.current

  const isCurrentVisit = useCallback((owner: RouteVisit): boolean => {
    return mounted.current && sameVisit(currentVisit.current, owner)
  }, [])

  const revoke = useCallback((url: string): void => {
    const timer = revokeTimers.current.get(url)
    if (timer !== undefined) clearTimeout(timer)
    revokeTimers.current.delete(url)
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url)
    }
  }, [])

  const load = useCallback(async (owner: RouteVisit): Promise<void> => {
    const request: RequestOwner = { ...owner, request: Symbol('interview-load') }
    loadRequest.current = request
    setPhase('loading')

    try {
      const loaded = await api.getInterview(owner.id)
      if (!isCurrentVisit(request) || loadRequest.current !== request) return
      setDetail(loaded)
      setPhase('ready')
    } catch (error) {
      if (isCurrentVisit(request) && loadRequest.current === request) {
        setPhase(hasApiStatus(error, 404) ? 'missing' : 'error')
      }
    }
  }, [api, isCurrentVisit])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      loadRequest.current = null
      reviewLocks.current.clear()
      exportLock.current = null
      for (const url of [...revokeTimers.current.keys()]) revoke(url)
    }
  }, [revoke])

  useEffect(() => {
    loadRequest.current = null
    reviewLocks.current.clear()
    exportLock.current = null
    setDetail(null)
    setExportError(null)
    setExporting(false)
    void load(visit)
  }, [load, visit])

  async function reviewScorecard(input: ReviewScorecardInput): Promise<boolean> {
    const owner = currentVisit.current
    if (input.interviewId !== owner.id) return false

    const key = `${input.interviewId}:${input.questionId}`
    const existing = reviewLocks.current.get(key)
    if (existing && sameVisit(existing, owner)) return false

    const request: RequestOwner = { ...owner, request: Symbol('scorecard-review') }
    reviewLocks.current.set(key, request)
    try {
      const committed = await api.reviewScorecard(input)
      if (!isCurrentVisit(request)) return false
      setDetail(committed)
      return true
    } finally {
      if (reviewLocks.current.get(key) === request) reviewLocks.current.delete(key)
    }
  }

  async function archive(): Promise<void> {
    if (!detail || archiving) return
    setArchiving(true)
    setExportError(null)
    try {
      const updated = await api.archiveInterview(detail.id)
      if (!mounted.current) return
      setDetail(updated)
    } catch {
      if (mounted.current) setExportError('인터뷰를 보관하지 못했습니다')
    } finally {
      if (mounted.current) setArchiving(false)
    }
  }

  async function exportCsv(): Promise<void> {
    const owner = currentVisit.current
    if (!detail || detail.id !== owner.id) return

    const existing = exportLock.current
    if (existing && sameVisit(existing, owner)) return

    if (
      typeof document === 'undefined'
      || !document.body
      || typeof URL === 'undefined'
      || typeof URL.createObjectURL !== 'function'
      || typeof URL.revokeObjectURL !== 'function'
    ) {
      if (isCurrentVisit(owner)) setExportError('CSV를 다운로드할 수 없습니다')
      return
    }

    const request: RequestOwner = { ...owner, request: Symbol('csv-export') }
    const participantCode = detail.participantCode
    exportLock.current = request
    setExporting(true)
    setExportError(null)
    let url: string | null = null
    let link: HTMLAnchorElement | null = null

    try {
      const blob = await api.exportInterviewCsv(owner.id)
      if (!isCurrentVisit(request) || exportLock.current !== request) return

      url = URL.createObjectURL(blob)
      link = document.createElement('a')
      link.href = url
      link.download = csvName(participantCode)
      document.body.appendChild(link)
      link.click()
      link.remove()
      link = null

      const completedUrl = url
      revokeTimers.current.set(completedUrl, setTimeout(() => revoke(completedUrl), 0))
      url = null
    } catch {
      if (link) link.remove()
      if (url) revoke(url)
      if (isCurrentVisit(request) && exportLock.current === request) {
        setExportError('CSV를 다운로드하지 못했습니다')
      }
    } finally {
      if (exportLock.current === request) {
        exportLock.current = null
        if (isCurrentVisit(request)) setExporting(false)
      }
    }
  }

  if (phase === 'loading') {
    return <main aria-busy="true" className="mx-auto w-full max-w-[96rem] px-4 py-6">
      <p role="status">인터뷰를 불러오는 중</p>
    </main>
  }
  if (phase === 'missing') {
    return <main className="mx-auto w-full max-w-[96rem] px-4 py-6">
      <p className="inline-flex items-center gap-2" role="alert">
        <AlertCircle aria-hidden="true" className="size-4" />인터뷰를 찾을 수 없습니다
      </p>
      <Link
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm no-underline hover:bg-accent sm:min-h-9"
        to="/admin"
      >
        검토 목록
      </Link>
    </main>
  }
  if (phase === 'error') {
    return <main className="mx-auto w-full max-w-[96rem] px-4 py-6">
      <p className="inline-flex items-center gap-2" role="alert">
        <AlertCircle aria-hidden="true" className="size-4" />인터뷰를 불러오지 못했습니다
      </p>
      <Button className="mt-3" onClick={() => void load(currentVisit.current)} type="button" variant="outline">
        <RefreshCw aria-hidden="true" />다시 시도
      </Button>
    </main>
  }
  if (!detail) return null

  return <main className="mx-auto w-full max-w-[96rem] px-4 py-6">
    <div className="flex flex-wrap items-center gap-3">
      <div>
        <h1 className="text-xl font-semibold">인터뷰 검토</h1>
        <p className="mt-1 text-sm text-muted-foreground">{detail.participantCode}</p>
      </div>
      {detail.status === 'completed' && <Button
        aria-busy={archiving}
        className="ml-auto min-h-11 sm:min-h-9"
        disabled={archiving}
        onClick={() => void archive()}
        type="button"
        variant="outline"
      >
        <Archive aria-hidden="true" />보관
      </Button>}
      <Link
        className={`inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm no-underline hover:bg-accent sm:min-h-9 ${detail.status === 'completed' ? '' : 'ml-auto'}`}
        to={`/admin/interviews/${detail.id}/transcript`}
      >
        <MessagesSquare aria-hidden="true" className="size-4" />인터뷰 해보기
      </Link>
      <Button
        aria-busy={exporting}
        className={detail.status === 'completed' ? 'min-h-11 sm:min-h-9' : 'ml-auto min-h-11 sm:min-h-9'}
        disabled={exporting}
        onClick={() => void exportCsv()}
        type="button"
        variant="outline"
      >
        <Download aria-hidden="true" />CSV 다운로드
      </Button>
    </div>
    {exportError && <p className="mt-3 inline-flex items-center gap-2" role="alert">
      <AlertCircle aria-hidden="true" className="size-4" />{exportError}
    </p>}
    <section aria-labelledby="outcome-heading" className="mt-6 border-y border-border py-4">
      <h2 className="sr-only" id="outcome-heading">판정 결과</h2>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted-foreground">진단</dt>
          <dd className="font-semibold">{detail.finalDiagnosis ?? '미산출'}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">기준</dt>
          <dd className="flex flex-wrap gap-x-3 gap-y-1">
            {['A', 'B', 'C', 'D'].map((key) => (
              <span key={key}>{criterionLabel(key, detail.criteria[key] ?? null)}</span>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">완료</dt>
          <dd>
            {detail.completedAt ? new Date(detail.completedAt).toLocaleString('ko-KR') : '진행 중'}
            <span className="ml-2 text-sm text-muted-foreground">{detail.algorithmVersion}</span>
          </dd>
        </div>
      </dl>
      {detail.report && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{detail.report}</p>}
    </section>
    <div className="mt-6 grid gap-8" data-testid="review-split">
      <section aria-labelledby="scorecard-heading">
        <h2 className="text-lg font-semibold" id="scorecard-heading">점수표</h2>
        <div className="mt-3">
          <ScorecardReview
            interviewId={detail.id}
            key={`${detail.id}:${visit.generation}`}
            onReview={reviewScorecard}
            scorecard={detail.scorecard}
          />
        </div>
      </section>
    </div>
  </main>
}
