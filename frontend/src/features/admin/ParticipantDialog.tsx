import { Copy, KeyRound, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { useApi } from '@/app/api-context'
import type { ParticipantRecord } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ParticipantDialogMode = 'create' | 'reset'

interface ParticipantDialogProps {
  mode: ParticipantDialogMode
  onOpenChange: (open: boolean) => void
  onParticipantCreated: (participant: ParticipantRecord) => void
  open: boolean
  participant?: ParticipantRecord
}

const passwordCharacters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'

function generatePassword(): string {
  const values = new Uint32Array(18)
  crypto.getRandomValues(values)
  return Array.from(values, (value) => passwordCharacters[value % passwordCharacters.length]).join('')
}

export function ParticipantDialog({
  mode,
  onOpenChange,
  onParticipantCreated,
  open,
  participant,
}: ParticipantDialogProps) {
  const api = useApi()
  const [username, setUsername] = useState('')
  const [participantCode, setParticipantCode] = useState('')
  const [assignedPassword, setAssignedPassword] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isCreate = mode === 'create'
  const title = isCreate ? '계정 생성' : '비밀번호 재설정'

  function clearSecretState(): void {
    setUsername('')
    setParticipantCode('')
    setAssignedPassword(null)
    setError(null)
    setCopied(false)
    setIsSubmitting(false)
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) clearSecretState()
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (isSubmitting) return

    if (isCreate && (!username.trim() || !participantCode.trim())) {
      setError('입력 내용을 확인하세요')
      return
    }

    setError(null)
    setIsSubmitting(true)
    try {
      if (isCreate) {
        const password = generatePassword()
        const created = await api.createParticipant({
          username: username.trim(),
          participantCode: participantCode.trim(),
          password,
        })
        onParticipantCreated(created)
        setAssignedPassword(password)
      } else if (participant) {
        const password = await api.resetParticipantPassword(participant.id)
        setAssignedPassword(password.assignedPassword)
      }
    } catch {
      setError(isCreate ? '계정을 만들지 못했습니다' : '비밀번호를 재설정하지 못했습니다')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function copyPassword(): Promise<void> {
    if (!assignedPassword) return
    try {
      await navigator.clipboard?.writeText(assignedPassword)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {assignedPassword ? (
          <div className="space-y-3">
            <output aria-label="할당된 비밀번호" className="block break-all border border-border px-3 py-2 font-mono text-sm">
              {assignedPassword}
            </output>
            <Button onClick={() => void copyPassword()} type="button" variant="outline">
              <Copy aria-hidden="true" />
              {copied ? '복사했습니다' : '복사'}
            </Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            {isCreate ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="participant-username">사용자 이름</Label>
                  <Input
                    autoComplete="off"
                    id="participant-username"
                    onChange={(event) => setUsername(event.target.value)}
                    value={username}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="participant-code">참여자 코드</Label>
                  <Input
                    autoComplete="off"
                    id="participant-code"
                    onChange={(event) => setParticipantCode(event.target.value)}
                    value={participantCode}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm">{participant?.participantCode}</p>
            )}
            {error && <p role="alert">{error}</p>}
            <DialogFooter>
              <Button disabled={isSubmitting} onClick={() => handleOpenChange(false)} type="button" variant="outline">
                취소
              </Button>
              <Button aria-busy={isSubmitting} disabled={isSubmitting} type="submit">
                {isCreate ? <UserPlus aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
                {isCreate ? '생성' : '재설정'}
              </Button>
            </DialogFooter>
          </form>
        )}
        {assignedPassword && (
          <DialogFooter>
            <Button onClick={() => handleOpenChange(false)} type="button">닫기</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
