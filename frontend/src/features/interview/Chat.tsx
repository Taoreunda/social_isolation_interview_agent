import { Send } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { FormEvent } from 'react'

import type { InterviewMessage } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'

interface ChatProps {
  answer: string
  isSending: boolean
  messages: InterviewMessage[]
  onAnswerChange: (answer: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  pendingMessage: string | null
  progress: number
  retrying: boolean
  showComposer: boolean
}

function roleName(role: InterviewMessage['role']): string {
  return role === 'assistant' ? '인터뷰 진행자' : '참여자'
}

function bubbleClass(role: InterviewMessage['role']): string {
  const shared = 'max-w-[75ch] whitespace-pre-wrap rounded-lg px-4 py-3 text-sm leading-6'
  return role === 'user'
    ? `${shared} bg-primary text-primary-foreground`
    : `${shared} bg-muted`
}

export function Chat({
  answer,
  isSending,
  messages,
  onAnswerChange,
  onSubmit,
  pendingMessage,
  progress,
  retrying,
  showComposer,
}: ChatProps) {
  const submitLabel = retrying ? '다시 시도' : '답변 전송'
  const conversation = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = conversation.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages.length, pendingMessage, isSending])

  return (
    <>
      <Progress aria-label="진행률" aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress} value={progress} />
      <div className="mt-6 min-h-0 flex-1 overflow-y-auto" ref={conversation}>
      <ol aria-label="인터뷰 대화" className="space-y-4">
        {messages.map((message) => (
          <li
            aria-label={`${roleName(message.role)} 메시지`}
            className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
            key={message.id}
          >
            <p className={bubbleClass(message.role)}>
              {message.content}
            </p>
          </li>
        ))}
        {pendingMessage !== null && <li aria-label="참여자 메시지" className="flex justify-end">
          <p className={bubbleClass('user')}>{pendingMessage}</p>
        </li>}
      </ol>
      {isSending && <p className="mt-4 text-sm leading-6 text-muted-foreground" role="status">답변을 생성하는 중</p>}
      </div>
      {showComposer && <form className="mt-4 flex min-w-0 items-end gap-2" onSubmit={onSubmit}>
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor="interview-answer">답변 입력</label>
          <Textarea
            disabled={isSending || retrying}
            id="interview-answer"
            onChange={(event) => onAnswerChange(event.target.value)}
            placeholder="답변 입력"
            value={answer}
          />
        </div>
        <Button
          aria-busy={isSending}
          aria-label={submitLabel}
          disabled={isSending || (!retrying && !answer.trim())}
          size={retrying ? 'default' : 'icon'}
          type="submit"
        >
          <Send aria-hidden="true" />
          <span className={retrying ? undefined : 'sr-only'}>{submitLabel}</span>
        </Button>
      </form>}
    </>
  )
}
