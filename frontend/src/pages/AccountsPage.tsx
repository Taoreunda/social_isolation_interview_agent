import { AlertCircle, Ban, CircleCheck, CircleOff, Clock3, Download, KeyRound, LockKeyhole, LockOpen, Search, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useApi } from '@/app/api-context'
import { canSaveBlob, saveBlob } from '@/app/download'
import type { ParticipantRecord } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { AccountDialog } from '@/features/admin/AccountDialog'
import { StaffSection } from '@/features/admin/StaffSection'

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

function AccountStatus({ participant }: { participant: ParticipantRecord }) {
  const labels = {
    active: '활성',
    admin_locked: '관리자 잠금',
    disabled: '비활성',
  } as const
  const status = participant.status
  const Icon = status === 'active' ? CircleCheck : status === 'admin_locked' ? LockKeyhole : CircleOff
  const until = participant.temporaryLockedUntil ? new Date(participant.temporaryLockedUntil) : null
  const locked = until !== null && until.getTime() > Date.now()
  return <span className="inline-flex flex-wrap items-center gap-1">
    <Icon aria-hidden="true" className="size-4" />{labels[status]}
    {locked && <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
      <LockKeyhole aria-hidden="true" className="size-4" />
      임시 잠금 ({until.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 해제)
    </span>}
  </span>
}

export function AccountsPage({ currentUserId }: { currentUserId?: string }) {
  const api = useApi()
  const [staffReloadKey, setStaffReloadKey] = useState(0)
  const [participants, setParticipants] = useState<ParticipantRecord[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [participantToDisable, setParticipantToDisable] = useState<ParticipantRecord | null>(null)
  const [disableError, setDisableError] = useState<string | null>(null)
  const [isDisabling, setIsDisabling] = useState(false)
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [unlockingIds, setUnlockingIds] = useState<Set<string>>(() => new Set())
  const mounted = useRef(false)
  const operation = useRef(0)
  const disableInFlight = useRef(false)
  const disableRequest = useRef(0)
  const activeDisableRequest = useRef<number | null>(null)
  const unlockRequests = useRef(new Map<string, symbol>())

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

  const allSelected = visibleParticipants.length > 0
    && visibleParticipants.every((participant) => selected.includes(participant.id))

  function toggle(id: string): void {
    setSelected((current) => (
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    ))
  }

  function toggleAll(): void {
    setSelected(allSelected ? [] : visibleParticipants.map((participant) => participant.id))
  }

  async function exportCsv(): Promise<void> {
    if (exporting) return
    if (!canSaveBlob()) {
      setExportError('CSV를 다운로드할 수 없습니다')
      return
    }
    setExporting(true)
    setExportError(null)
    try {
      const blob = await api.exportInterviewsCsv({ participantIds: selected })
      saveBlob(blob, selected.length ? 'participants-selected.csv' : 'participants-all.csv')
    } catch {
      setExportError('CSV를 다운로드하지 못했습니다')
    } finally {
      setExporting(false)
    }
  }

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
    const requestId = ++disableRequest.current
    disableInFlight.current = true
    activeDisableRequest.current = requestId
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
      if (activeDisableRequest.current === requestId) {
        activeDisableRequest.current = null
        disableInFlight.current = false
        if (mounted.current) setIsDisabling(false)
      }
    }
  }

  function closeDisableDialog(): void {
    operation.current += 1
    setParticipantToDisable(null)
    setDisableError(null)
  }

  async function enableParticipant(participant: ParticipantRecord): Promise<void> {
    if (unlockRequests.current.has(participant.id)) return
    const request = Symbol('participant-enable')
    unlockRequests.current.set(participant.id, request)
    setUnlockError(null)
    setUnlockingIds((current) => new Set(current).add(participant.id))
    try {
      const updated = await api.enableParticipant(participant.id)
      if (!mounted.current || unlockRequests.current.get(participant.id) !== request) return
      updateParticipant(updated)
    } catch {
      if (mounted.current && unlockRequests.current.get(participant.id) === request) {
        setUnlockError('참여자를 활성화하지 못했습니다')
      }
    } finally {
      if (unlockRequests.current.get(participant.id) === request) {
        unlockRequests.current.delete(participant.id)
        if (mounted.current) {
          setUnlockingIds((current) => {
            const next = new Set(current)
            next.delete(participant.id)
            return next
          })
        }
      }
    }
  }

  async function unlockParticipant(participant: ParticipantRecord): Promise<void> {
    if (unlockRequests.current.has(participant.id)) return
    const request = Symbol('participant-unlock')
    unlockRequests.current.set(participant.id, request)
    setUnlockError(null)
    setUnlockingIds((current) => new Set(current).add(participant.id))
    try {
      const updated = await api.unlockParticipant(participant.id)
      if (!mounted.current || unlockRequests.current.get(participant.id) !== request) return
      updateParticipant(updated)
    } catch {
      if (mounted.current && unlockRequests.current.get(participant.id) === request) {
        setUnlockError('참여자 잠금을 해제하지 못했습니다')
      }
    } finally {
      if (unlockRequests.current.get(participant.id) === request) {
        unlockRequests.current.delete(participant.id)
        if (mounted.current) {
          setUnlockingIds((current) => {
            const next = new Set(current)
            next.delete(participant.id)
            return next
          })
        }
      }
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">계정 관리</h1>
        <Button className="ml-auto min-h-11 sm:min-h-9" onClick={() => setDialog({ mode: 'create' })} type="button">
          <UserPlus aria-hidden="true" />
          계정 생성
        </Button>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">참여자</h2>
        <div className="relative min-w-0 flex-1 basis-48 sm:max-w-xs">
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
        <Button
          aria-busy={exporting}
          className="ml-auto min-h-11 sm:min-h-9"
          disabled={exporting || visibleParticipants.length === 0}
          onClick={() => void exportCsv()}
          type="button"
          variant="outline"
        >
          <Download aria-hidden="true" />
          {selected.length ? `선택 ${selected.length}명 CSV 다운로드` : '전체 CSV 다운로드'}
        </Button>
      </div>

      {exportError && <p className="mt-6 inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />{exportError}</p>}
      {phase === 'loading' && <p className="mt-6" role="status">참여자를 불러오는 중</p>}
      {unlockError && <p className="mt-6 inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />{unlockError}</p>}
      {phase === 'error' && (
        <div className="mt-6">
          <p className="inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />참여자를 불러오지 못했습니다</p>
          <Button className="mt-3" onClick={() => void loadParticipants()} type="button" variant="outline">다시 시도</Button>
        </div>
      )}
      {phase === 'ready' && (
        <Table aria-label="참여자 목록" className="mt-5">
          <TableHeader className="hidden sm:table-header-group">
            <TableRow>
              <TableHead>
                <Checkbox
                  aria-label="전체 선택"
                  checked={allSelected}
                  onCheckedChange={() => toggleAll()}
                />
              </TableHead>
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
                <TableCell className="block sm:table-cell">
                  <Checkbox
                    aria-label={`${participant.participantCode} 선택`}
                    checked={selected.includes(participant.id)}
                    onCheckedChange={() => toggle(participant.id)}
                  />
                </TableCell>
                <TableCell className="block break-words whitespace-normal sm:table-cell"><span className="mr-1 font-medium sm:hidden">코드:</span>{participant.participantCode}</TableCell>
                <TableCell className="block break-words whitespace-normal sm:table-cell"><span className="mr-1 font-medium sm:hidden">사용자:</span>{participant.username}</TableCell>
                <TableCell className="block break-words whitespace-normal sm:table-cell"><span className="mr-1 font-medium sm:hidden">계정:</span><AccountStatus participant={participant} /></TableCell>
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
                    {participant.status === 'disabled' && (
                      <Button
                        aria-busy={unlockingIds.has(participant.id)}
                        className="h-auto min-h-8 whitespace-normal"
                        disabled={unlockingIds.has(participant.id)}
                        onClick={() => void enableParticipant(participant)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <CircleCheck aria-hidden="true" />
                        활성화
                      </Button>
                    )}
                    {participant.status === 'admin_locked' && (
                      <Button
                        aria-busy={unlockingIds.has(participant.id)}
                        className="h-auto min-h-8 whitespace-normal"
                        disabled={unlockingIds.has(participant.id)}
                        onClick={() => void unlockParticipant(participant)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <LockOpen aria-hidden="true" />
                        잠금 해제
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
        <AccountDialog
          mode={dialog.mode}
          onOpenChange={(open) => !open && setDialog(null)}
          onParticipantCreated={updateParticipant}
          onStaffCreated={() => setStaffReloadKey((key) => key + 1)}
          open
          participant={dialog.mode === 'reset' ? dialog.participant : undefined}
        />
      )}

      <StaffSection currentUserId={currentUserId} reloadKey={staffReloadKey} />

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
