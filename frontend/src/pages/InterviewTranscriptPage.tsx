import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useApi } from '@/app/api-context'
import { hasApiStatus } from '@/app/api-error'
import type { InterviewDetail } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { Chat } from '@/features/interview/Chat'

export function InterviewTranscriptPage() {
  const api = useApi()
  const { interviewId = '' } = useParams()
  const [detail, setDetail] = useState<InterviewDetail | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading')
  const mounted = useRef(false)
  const request = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const operation = ++request.current
    setPhase('loading')
    try {
      const loaded = await api.getInterview(interviewId)
      if (!mounted.current || operation !== request.current) return
      setDetail(loaded)
      setPhase('ready')
    } catch (error) {
      if (!mounted.current || operation !== request.current) return
      setPhase(hasApiStatus(error, 404) ? 'missing' : 'error')
    }
  }, [api, interviewId])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false }
  }, [load])

  const back = `/admin/interviews/${interviewId}`
  const backLink = (
    <Link
      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm no-underline hover:bg-accent sm:min-h-9"
      to={back}
    >
      <ArrowLeft aria-hidden="true" className="size-4" />검토로 돌아가기
    </Link>
  )

  if (phase === 'loading') {
    return <main aria-busy="true" className="mx-auto w-full max-w-[96rem] px-4 py-6">
      <p role="status">대화를 불러오는 중</p>
    </main>
  }

  if (phase === 'missing') {
    return <main className="mx-auto w-full max-w-[96rem] px-4 py-6">
      <p className="inline-flex items-center gap-2" role="alert">
        <AlertCircle aria-hidden="true" className="size-4" />인터뷰를 찾을 수 없습니다
      </p>
      <div className="mt-3">{backLink}</div>
    </main>
  }

  if (phase === 'error' || !detail) {
    return <main className="mx-auto w-full max-w-[96rem] px-4 py-6">
      <p className="inline-flex items-center gap-2" role="alert">
        <AlertCircle aria-hidden="true" className="size-4" />대화를 불러오지 못했습니다
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => void load()} type="button" variant="outline">
          <RefreshCw aria-hidden="true" />다시 시도
        </Button>
        {backLink}
      </div>
    </main>
  }

  return <main className="mx-auto w-full max-w-3xl px-4 py-6">
    <div className="flex flex-wrap items-center gap-3">
      <div>
        <h1 className="text-xl font-semibold">대화</h1>
        <p className="mt-1 text-sm text-muted-foreground">{detail.participantCode}</p>
      </div>
      <div className="ml-auto">{backLink}</div>
    </div>
    <div className="mt-6">
      <Chat
        answer=""
        isSending={false}
        messages={detail.messages}
        onAnswerChange={() => undefined}
        onSubmit={() => undefined}
        pendingMessage={null}
        progress={detail.progress}
        retrying={false}
        showComposer={false}
      />
    </div>
  </main>
}
