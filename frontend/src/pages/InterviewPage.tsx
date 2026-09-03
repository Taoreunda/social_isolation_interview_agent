import { AlertCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { useApi } from '@/app/api-context'
import { hasApiStatus } from '@/app/api-error'
import type { ParticipantInterview } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { Chat } from '@/features/interview/Chat'

type InterviewPhase = 'loading' | 'active' | 'sending' | 'load_error' | 'send_error' | 'completed'

interface PendingTurn {
  clientTurnId: string
  content: string
}

function phaseFor(interview: ParticipantInterview): InterviewPhase {
  return interview.status === 'completed' ? 'completed' : 'active'
}

export function InterviewPage() {
  const api = useApi()
  const [answer, setAnswer] = useState('')
  const [interview, setInterview] = useState<ParticipantInterview | null>(null)
  const [loadError, setLoadError] = useState('인터뷰를 불러오지 못했습니다')
  const [phase, setPhase] = useState<InterviewPhase>('loading')
  const mounted = useRef(false)
  const requestGeneration = useRef(0)
  const inFlight = useRef(false)
  const pendingTurn = useRef<PendingTurn | null>(null)

  const loadInterview = useCallback(async (): Promise<void> => {
    const operation = ++requestGeneration.current
    setPhase('loading')
    setLoadError('인터뷰를 불러오지 못했습니다')
    try {
      const detail = await api.getCurrentInterview()
      if (!mounted.current || operation !== requestGeneration.current) return
      setInterview(detail)
      setPhase(phaseFor(detail))
    } catch (error) {
      if (!mounted.current || operation !== requestGeneration.current) return
      if (hasApiStatus(error, 403)) setLoadError('이 인터뷰에 접근할 권한이 없습니다')
      setPhase('load_error')
    }
  }, [api])

  useEffect(() => {
    mounted.current = true
    void loadInterview()
    return () => {
      mounted.current = false
      requestGeneration.current += 1
    }
  }, [loadInterview])

  async function submitAnswer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!interview || inFlight.current) return

    const turn = pendingTurn.current ?? (() => {
      const content = answer.trim()
      return content ? { clientTurnId: crypto.randomUUID(), content } : null
    })()
    if (!turn) return

    pendingTurn.current = turn
    const operation = ++requestGeneration.current
    inFlight.current = true
    setPhase('sending')
    try {
      const detail = await api.sendMessage(interview.id, turn.clientTurnId, turn.content)
      if (!mounted.current || operation !== requestGeneration.current) return
      pendingTurn.current = null
      setAnswer('')
      setInterview(detail)
      setPhase(phaseFor(detail))
    } catch {
      if (!mounted.current || operation !== requestGeneration.current) return
      setPhase('send_error')
    } finally {
      if (!mounted.current || operation !== requestGeneration.current) return
      inFlight.current = false
    }
  }

  if (phase === 'loading') {
    return <main aria-busy="true" className="mx-auto w-full max-w-3xl px-4 py-6"><p role="status">인터뷰 시작</p></main>
  }

  if (phase === 'load_error') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <p className="inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />{loadError}</p>
        <Button className="mt-4" onClick={() => void loadInterview()} type="button">
          <RefreshCw aria-hidden="true" />
          다시 시도
        </Button>
      </main>
    )
  }

  if (!interview) return null

  if (phase === 'completed') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <h1 className="text-xl font-semibold">완료했습니다</h1>
        <Chat
          answer=""
          isSending={false}
          messages={interview.messages}
          onAnswerChange={() => undefined}
          onSubmit={() => undefined}
          progress={interview.progress}
          retrying={false}
          showComposer={false}
        />
      </main>
    )
  }

  const retrying = phase === 'send_error'
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold">인터뷰 시작</h1>
      {retrying && <p className="mt-3 inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />답변을 보내지 못했습니다</p>}
      <Chat
        answer={answer}
        isSending={phase === 'sending'}
        messages={interview.messages}
        onAnswerChange={setAnswer}
        onSubmit={(event) => void submitAnswer(event)}
        progress={interview.progress}
        retrying={retrying}
        showComposer
      />
    </main>
  )
}
