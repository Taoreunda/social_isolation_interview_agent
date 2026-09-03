import { AlertCircle, Ban, CircleCheck, CircleOff, Clock3, KeyRound, Search, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ParticipantDialog } from '@/features/admin/ParticipantDialog'

type DialogState =
  | { mode: 'create' }
  | { mode: 'reset'; participant: ParticipantRecord }
  | null

function interviewStatusLabel(status: ParticipantRecord['interviewStatus']): string {
  const labels: Record<ParticipantRecord['interviewStatus'], string> = {
    active: '진행 중',
    archived: '보관',
    completed: '완료',
    not_started: '미시작',
  }
  return labels[status]
}

function InterviewStatus({ status }: { status: ParticipantRecord['interviewStatus'] }) {
  const Icon = status === 'completed' ? CircleCheck : status === 'active' ? Clock3 : CircleOff
  return <span className="inline-flex items-center gap-1"><Icon aria-hidden="true" className="size-4" />{interviewStatusLabel(status)}</span>
}

function AccountStatus({ status }: { status: ParticipantRecord['status'] }) {
  const active = status === 'active'
  const Icon = active ? CircleCheck : CircleOff
  return <span className="inline-flex items-center gap-1"><Icon aria-hidden="true" className="size-4" />{active ? '활성' : '비활성'}</span>
}

export function ParticipantsPage() {
  const api = useApi()
  const [participants, setParticipants] = useState<ParticipantRecord[]>([])
  const [query, setQuery] = useState('')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [participantToDisable, setParticipantToDisable] = useState<ParticipantRecord | null>(null)
  const [disableError, setDisableError] = useState<string | null>(null)
  const [isDisabling, setIsDisabling] = useState(false)
  const mounted = useRef(false)
  const operation = useRef(0)
  const disableInFlight = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      operation.current += 1
    }
  }, [])

  const loadParticipants = useCallback(async (): Promise<void> => {
    const currentOperation = ++operation.current
    setPhase('loading')
    try {
      const listed = await api.listParticipants()
      if (!mounted.current || currentOperation !== operation.current) return
      setParticipants(listed)
      setPhase('ready')
    } catch {
      if (mounted.current && currentOperation === operation.current) setPhase('error')
    }
  }, [api])

  useEffect(() => {
    void loadParticipants()
  }, [loadParticipants])

  const visibleParticipants = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return participants
    return participants.filter((participant) =>
      participant.participantCode.toLowerCase().includes(normalized)
      || participant.username.toLowerCase().includes(normalized),
    )
  }, [participants, query])

  function updateParticipant(updated: ParticipantRecord): void {
    if (!mounted.current) return
    operation.current += 1
    setParticipants((current) => [...current.filter((item) => item.id !== updated.id), updated]
      .sort((left, right) => left.participantCode.localeCompare(right.participantCode)))
    setPhase('ready')
  }

  async function disableParticipant(): Promise<void> {
    if (!participantToDisable || disableInFlight.current) return
    const currentOperation = ++operation.current
    disableInFlight.current = true
    setDisableError(null)
    setIsDisabling(true)
    try {
      const updated = await api.disableParticipant(participantToDisable.id)
      if (!mounted.current || currentOperation !== operation.current) return
      setParticipants((current) => [...current.filter((item) => item.id !== updated.id), updated]
        .sort((left, right) => left.participantCode.localeCompare(right.participantCode)))
      setPhase('ready')
      setParticipantToDisable(null)
    } catch {
      if (mounted.current && currentOperation === operation.current) setDisableError('참여자를 비활성화하지 못했습니다')
    } finally {
      disableInFlight.current = false
      if (mounted.current && currentOperation === operation.current) setIsDisabling(false)
    }
  }

  function closeDisableDialog(): void {
    operation.current += 1
    setParticipantToDisable(null)
    setDisableError(null)
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">참여자</h1>
        <div className="relative min-w-0 flex-1 basis-48">
          <Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            aria-label="참여자 검색"
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="코드 또는 사용자 이름"
            role="searchbox"
            value={query}
          />
        </div>
        <Button className="h-auto min-h-9 whitespace-normal text-center" onClick={() => setDialog({ mode: 'create' })} type="button">
          <UserPlus aria-hidden="true" />
          계정 생성
        </Button>
      </div>

      {phase === 'loading' && <p className="mt-6" role="status">참여자를 불러오는 중</p>}
      {phase === 'error' && (
        <div className="mt-6">
          <p className="inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />참여자를 불러오지 못했습니다</p>
          <Button className="mt-3" onClick={() => void loadParticipants()} type="button" variant="outline">다시 시도</Button>
        </div>
      )}
      {phase === 'ready' && (
        <Table className="mt-5">
          <TableHeader className="hidden sm:table-header-group">
            <TableRow>
              <TableHead>코드</TableHead>
              <TableHead>사용자 이름</TableHead>
              <TableHead>계정</TableHead>
              <TableHead>인터뷰</TableHead>
              <TableHead><span className="sr-only">작업</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="block sm:table-row-group">
            {visibleParticipants.map((participant) => (
              <TableRow className="block sm:table-row" key={participant.id}>
                <TableCell className="block break-words whitespace-normal sm:table-cell"><span className="mr-1 font-medium sm:hidden">코드:</span>{participant.participantCode}</TableCell>
                <TableCell className="block break-words whitespace-normal sm:table-cell"><span className="mr-1 font-medium sm:hidden">사용자:</span>{participant.username}</TableCell>
                <TableCell className="block break-words whitespace-normal sm:table-cell"><span className="mr-1 font-medium sm:hidden">계정:</span><AccountStatus status={participant.status} /></TableCell>
                <TableCell className="block break-words whitespace-normal sm:table-cell"><span className="mr-1 font-medium sm:hidden">인터뷰:</span><InterviewStatus status={participant.interviewStatus} /></TableCell>
                <TableCell className="block break-words whitespace-normal sm:table-cell">
                  <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
                    <Button className="h-auto min-h-8 whitespace-normal" onClick={() => setDialog({ mode: 'reset', participant })} size="sm" type="button" variant="outline">
                      <KeyRound aria-hidden="true" />
                      비밀번호 재설정
                    </Button>
                    {participant.status === 'active' && (
                      <Button className="h-auto min-h-8 whitespace-normal" onClick={() => setParticipantToDisable(participant)} size="sm" type="button" variant="outline">
                        <Ban aria-hidden="true" />
                        비활성화
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {visibleParticipants.length === 0 && (
              <TableRow><TableCell className="py-8 text-center text-muted-foreground" colSpan={5}>참여자가 없습니다</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      )}

      {dialog && (
        <ParticipantDialog
          mode={dialog.mode}
          onOpenChange={(open) => !open && setDialog(null)}
          onParticipantCreated={updateParticipant}
          open
          participant={dialog.mode === 'reset' ? dialog.participant : undefined}
        />
      )}

      <Dialog onOpenChange={(open) => !open && closeDisableDialog()} open={Boolean(participantToDisable)}>
        <DialogContent>
          <DialogHeader><DialogTitle>참여자 비활성화</DialogTitle></DialogHeader>
          <p className="text-sm">{participantToDisable?.participantCode}</p>
          {disableError && <p role="alert">{disableError}</p>}
          <DialogFooter>
            <Button disabled={isDisabling} onClick={closeDisableDialog} type="button" variant="outline">취소</Button>
            <Button aria-busy={isDisabling} disabled={isDisabling} onClick={() => void disableParticipant()} type="button">
              <Ban aria-hidden="true" />
              비활성화
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
