import { Send } from 'lucide-react'
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
  progress: number
  retrying: boolean
  showComposer: boolean
}

function roleName(role: InterviewMessage['role']): string {
  return role === 'assistant' ? '인터뷰 진행자' : '참여자'
}

export function Chat({
  answer,
  isSending,
  messages,
  onAnswerChange,
  onSubmit,
  progress,
  retrying,
  showComposer,
}: ChatProps) {
  const submitLabel = retrying ? '다시 시도' : '답변 전송'

  return (
    <>
      <Progress aria-label="진행률" aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress} value={progress} />
      <ol aria-label="인터뷰 대화" className="mt-6 space-y-4">
        {messages.map((message) => (
          <li
            aria-label={`${roleName(message.role)} 메시지`}
            className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
            key={message.id}
          >
            <p className="max-w-[75ch] whitespace-pre-wrap border-b border-border pb-2 text-sm leading-6">
              {message.content}
            </p>
          </li>
        ))}
      </ol>
      {showComposer && <form className="mt-6 flex min-w-0 items-end gap-2" onSubmit={onSubmit}>
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
        <Button aria-busy={isSending} aria-label={submitLabel} disabled={isSending} size="icon" type="submit">
          <Send aria-hidden="true" />
          <span className="sr-only">{submitLabel}</span>
        </Button>
      </form>}
    </>
  )
}
