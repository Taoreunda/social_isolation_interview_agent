import { Copy, KeyRound, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { useApi } from '@/app/api-context'
import type { ParticipantRecord, Role, StaffRecord } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type AccountDialogMode = 'create' | 'reset'
type ClipboardState = 'idle' | 'success' | 'error'

export const ROLE_LABEL: Record<Role, string> = { participant: '참가자', reviewer: '검토자', admin: '관리자' }
const ROLES: Role[] = ['participant', 'reviewer', 'admin']

// Whose password is on screen, in the terms that account is known by.
interface Revealed {
  rows: [label: string, value: string][]
}

interface AccountDialogProps {
  mode: AccountDialogMode
  onOpenChange: (open: boolean) => void
  onParticipantCreated: (participant: ParticipantRecord) => void
  onStaffCreated?: (staff: StaffRecord) => void
  open: boolean
  // In reset mode, exactly one of these says whose password is reset.
  participant?: ParticipantRecord
  staff?: StaffRecord
}

function describeParticipant(participant: ParticipantRecord): Revealed {
  return { rows: [['참여자 코드', participant.participantCode], ['사용자 이름', participant.username]] }
}

function describeStaff(staff: StaffRecord): Revealed {
  return { rows: [['역할', ROLE_LABEL[staff.role]], ['사용자 이름', staff.username]] }
}

export function AccountDialog({ mode, onOpenChange, onParticipantCreated, onStaffCreated, open, participant, staff }: AccountDialogProps) {
  const api = useApi()
  const isCreate = mode === 'create'
  const [role, setRole] = useState<Role>('participant')
  const [username, setUsername] = useState('')
  const [participantCode, setParticipantCode] = useState('')
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null)
  const [revealedFor, setRevealedFor] = useState<Revealed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clipboardState, setClipboardState] = useState<ClipboardState>('idle')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const mounted = useRef(false)
  const operation = useRef(0)
  const inFlight = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      operation.current += 1
    }
  }, [])

  function clearSecretState(): void {
    operation.current += 1
    setRole('participant')
    setUsername('')
    setParticipantCode('')
    setRevealedPassword(null)
    setRevealedFor(null)
    setError(null)
    setClipboardState('idle')
    setIsSubmitting(false)
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) clearSecretState()
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (inFlight.current) return

    const currentOperation = ++operation.current
    const current = (): boolean => mounted.current && currentOperation === operation.current
    inFlight.current = true
    setError(null)
    setIsSubmitting(true)
    try {
      if (isCreate && role === 'participant') {
        const created = await api.createParticipant({
          username: username.trim() || undefined,
          participantCode: participantCode.trim() || undefined,
        })
        if (!current()) return
        onParticipantCreated(created.participant)
        setRevealedFor(describeParticipant(created.participant))
        setRevealedPassword(created.assignedPassword ?? '')
      } else if (isCreate && role !== 'participant') {
        const created = await api.createStaff({ username: username.trim(), role })
        if (!current()) return
        onStaffCreated?.(created.staff)
        setRevealedFor(describeStaff(created.staff))
        setRevealedPassword(created.assignedPassword)
      } else if (participant) {
        const result = await api.resetParticipantPassword(participant.id)
        if (!current()) return
        setRevealedFor(describeParticipant(participant))
        setRevealedPassword(result.assignedPassword)
      } else if (staff) {
        const result = await api.resetStaffPassword(staff.id)
        if (!current()) return
        setRevealedFor(describeStaff(staff))
        setRevealedPassword(result.assignedPassword)
      }
    } catch {
      if (current()) setError(isCreate ? '계정을 만들지 못했습니다' : '비밀번호를 재설정하지 못했습니다')
    } finally {
      inFlight.current = false
      if (current()) setIsSubmitting(false)
    }
  }

  async function copyPassword(): Promise<void> {
    if (!revealedPassword) return
    setClipboardState('idle')
    try {
      if (!window.navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await window.navigator.clipboard.writeText(revealedPassword)
      if (mounted.current) setClipboardState('success')
    } catch {
      if (mounted.current) setClipboardState('error')
    }
  }

  const title = isCreate ? '계정 생성' : '비밀번호 재설정'
  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {revealedPassword ? (
          <div className="space-y-3">
            {revealedFor && <dl className="grid gap-1 text-sm">
              {revealedFor.rows.map(([label, value]) => (
                <div className="flex gap-2" key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>
              ))}
            </dl>}
            <p className="text-sm text-muted-foreground">할당 비밀번호</p>
            <output aria-label="할당된 비밀번호" className="block break-all border border-border px-3 py-2 font-mono text-sm">{revealedPassword}</output>
            <p className="text-sm text-muted-foreground">이 화면을 닫으면 다시 볼 수 없습니다.</p>
            <Button onClick={() => void copyPassword()} type="button" variant="outline"><Copy aria-hidden="true" />복사</Button>
            {clipboardState !== 'idle' && <p aria-live="polite" role="status">{clipboardState === 'success' ? '복사했습니다' : '복사하지 못했습니다'}</p>}
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            {isCreate ? (
              <>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">역할</legend>
                  <div className="flex flex-wrap gap-2">
                    {ROLES.map((option) => (
                      <label
                        className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm sm:min-h-9 ${role === option ? 'border-primary bg-accent font-medium' : 'border-border'}`}
                        key={option}
                      >
                        <input
                          checked={role === option}
                          className="accent-[var(--accent)]"
                          name="account-role"
                          onChange={() => setRole(option)}
                          type="radio"
                          value={option}
                        />
                        {ROLE_LABEL[option]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {role === 'participant' ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      비워 두면 다음 연구 코드와 비밀번호를 자동으로 배정합니다.
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="participant-code">참여자 코드</Label>
                      <Input autoComplete="off" id="participant-code" onChange={(event) => setParticipantCode(event.target.value)} placeholder="자동 배정" value={participantCode} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="participant-username">사용자 이름</Label>
                      <Input autoComplete="off" id="participant-username" onChange={(event) => setUsername(event.target.value)} placeholder="자동 배정 (코드의 소문자)" value={username} />
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {role === 'reviewer'
                        ? '검토자는 검토와 CSV 내려받기만 할 수 있습니다. 비밀번호는 자동으로 배정합니다.'
                        : '관리자는 계정 관리를 포함해 모든 일을 할 수 있습니다. 비밀번호는 자동으로 배정합니다.'}
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="staff-username">사용자 이름</Label>
                      <Input autoComplete="off" id="staff-username" minLength={3} onChange={(event) => setUsername(event.target.value)} placeholder="영문 소문자·숫자 3자 이상" required value={username} />
                    </div>
                  </>
                )}
              </>
            ) : <p className="text-sm">{participant?.participantCode ?? staff?.username}</p>}
            {error && <p role="alert">{error}</p>}
            <DialogFooter>
              <Button disabled={isSubmitting} onClick={() => handleOpenChange(false)} type="button" variant="outline">취소</Button>
              <Button aria-busy={isSubmitting} disabled={isSubmitting} type="submit">
                {isCreate ? <UserPlus aria-hidden="true" /> : <KeyRound aria-hidden="true" />}{isCreate ? '생성' : '재설정'}
              </Button>
            </DialogFooter>
          </form>
        )}
        {revealedPassword && <DialogFooter><Button onClick={() => handleOpenChange(false)} type="button">닫기</Button></DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
