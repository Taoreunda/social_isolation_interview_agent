import { AlertCircle, Ban, CircleCheck, CircleOff, KeyRound, LockKeyhole, LockKeyholeOpen, Repeat, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useApi } from '@/app/api-context'
import type { StaffRecord, StaffRole } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AccountDialog, ROLE_LABEL } from '@/features/admin/AccountDialog'

const STATUS_LABEL: Record<StaffRecord['status'], string> = { active: '활성', admin_locked: '관리자 잠금', disabled: '비활성' }

function otherRole(role: StaffRole): StaffRole {
  return role === 'reviewer' ? 'admin' : 'reviewer'
}

interface StaffSectionProps {
  // The signed-in administrator, whose own role and status are not theirs to change.
  currentUserId?: string
  // Changes whenever a staff account was created elsewhere on the page.
  reloadKey: number
}

export function StaffSection({ currentUserId, reloadKey }: StaffSectionProps) {
  const api = useApi()
  const [staff, setStaff] = useState<StaffRecord[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(() => new Set())
  const [roleChange, setRoleChange] = useState<StaffRecord | null>(null)
  const [passwordReset, setPasswordReset] = useState<StaffRecord | null>(null)
  const mounted = useRef(false)
  const loads = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    const current = ++loads.current
    setPhase('loading')
    try {
      const listed = await api.listStaff()
      if (!mounted.current || current !== loads.current) return
      setStaff(listed)
      setPhase('ready')
    } catch {
      if (mounted.current && current === loads.current) setPhase('error')
    }
  }, [api])

  useEffect(() => { void load() }, [load, reloadKey])

  // One request per account at a time; the server's answer replaces the row.
  async function change(account: StaffRecord, request: () => Promise<StaffRecord>, failure: string): Promise<boolean> {
    if (busy.has(account.id)) return false
    setError(null)
    setBusy((current) => new Set(current).add(account.id))
    try {
      const updated = await request()
      if (mounted.current) setStaff((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      return true
    } catch {
      if (mounted.current) setError(failure)
      return false
    } finally {
      if (mounted.current) setBusy((current) => {
        const next = new Set(current)
        next.delete(account.id)
        return next
      })
    }
  }

  async function confirmRoleChange(): Promise<void> {
    if (!roleChange) return
    const target = otherRole(roleChange.role)
    if (await change(roleChange, () => api.changeStaffRole(roleChange.id, target), '역할을 바꾸지 못했습니다')) {
      setRoleChange(null)
    }
  }

  return (
    <section aria-labelledby="staff-heading" className="mt-10">
      <h2 className="text-lg font-semibold" id="staff-heading">검토자·관리자</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        검토자는 검토와 CSV 내려받기만, 관리자는 모든 일을 할 수 있습니다. 역할은 이 둘 사이에서만 바꿀 수 있습니다.
      </p>
      {error && <p className="mt-3 inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />{error}</p>}
      {phase === 'loading' && <p className="mt-4" role="status">검토자·관리자를 불러오는 중</p>}
      {phase === 'error' && <div className="mt-4">
        <p className="inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />검토자·관리자를 불러오지 못했습니다</p>
        <Button className="mt-3" onClick={() => void load()} type="button" variant="outline"><RotateCcw aria-hidden="true" />다시 시도</Button>
      </div>}
      {phase === 'ready' && (
        <Table aria-label="검토자·관리자 목록" className="mt-4">
          <TableHeader className="sr-only sm:not-sr-only sm:table-header-group">
            <TableRow>
              <TableHead>사용자 이름</TableHead>
              <TableHead>역할</TableHead>
              <TableHead>계정</TableHead>
              <TableHead><span className="sr-only">작업</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="block sm:table-row-group">
            {staff.map((account) => {
              const own = account.id === currentUserId
              const working = busy.has(account.id)
              const StatusIcon = account.status === 'active' ? CircleCheck : account.status === 'admin_locked' ? LockKeyhole : CircleOff
              return (
                <TableRow className="block sm:table-row" key={account.id}>
                  <TableCell className="block break-words whitespace-normal sm:table-cell">
                    <span className="mr-1 font-medium sm:hidden">사용자:</span>{account.username}
                    {own && <span className="ml-2 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground">본인</span>}
                  </TableCell>
                  <TableCell className="block sm:table-cell"><span className="mr-1 font-medium sm:hidden">역할:</span>{ROLE_LABEL[account.role]}</TableCell>
                  <TableCell className="block sm:table-cell">
                    <span className="mr-1 font-medium sm:hidden">계정:</span>
                    <span className="inline-flex items-center gap-1"><StatusIcon aria-hidden="true" className="size-4" />{STATUS_LABEL[account.status]}</span>
                  </TableCell>
                  <TableCell className="block sm:table-cell">
                    <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
                      <Button
                        aria-label={`${account.username} ${ROLE_LABEL[otherRole(account.role)]}로 변경`}
                        className="h-auto min-h-8 whitespace-normal"
                        disabled={own || working}
                        onClick={() => { setError(null); setRoleChange(account) }}
                        size="sm"
                        title={own ? '본인 역할은 바꿀 수 없습니다' : undefined}
                        type="button"
                        variant="outline"
                      >
                        <Repeat aria-hidden="true" />{ROLE_LABEL[otherRole(account.role)]}로 변경
                      </Button>
                      <Button aria-label={`${account.username} 비밀번호 재설정`} className="h-auto min-h-8 whitespace-normal" disabled={working} onClick={() => setPasswordReset(account)} size="sm" type="button" variant="outline">
                        <KeyRound aria-hidden="true" />비밀번호 재설정
                      </Button>
                      {account.status === 'active' && (
                        <Button
                          aria-label={`${account.username} 비활성화`}
                          className="h-auto min-h-8 whitespace-normal"
                          disabled={own || working}
                          onClick={() => void change(account, () => api.disableStaff(account.id), '계정을 비활성화하지 못했습니다')}
                          size="sm"
                          title={own ? '본인 계정은 비활성화할 수 없습니다' : undefined}
                          type="button"
                          variant="outline"
                        >
                          <Ban aria-hidden="true" />비활성화
                        </Button>
                      )}
                      {account.status === 'disabled' && (
                        <Button aria-label={`${account.username} 활성화`} className="h-auto min-h-8 whitespace-normal" disabled={working} onClick={() => void change(account, () => api.enableStaff(account.id), '계정을 활성화하지 못했습니다')} size="sm" type="button" variant="outline">
                          <CircleCheck aria-hidden="true" />활성화
                        </Button>
                      )}
                      {account.status === 'admin_locked' && (
                        <Button aria-label={`${account.username} 잠금 해제`} className="h-auto min-h-8 whitespace-normal" disabled={working} onClick={() => void change(account, () => api.unlockStaff(account.id), '잠금을 해제하지 못했습니다')} size="sm" type="button" variant="outline">
                          <LockKeyholeOpen aria-hidden="true" />잠금 해제
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <Dialog onOpenChange={(open) => { if (!open) setRoleChange(null) }} open={roleChange !== null}>
        <DialogContent>
          <DialogHeader><DialogTitle>역할 변경</DialogTitle></DialogHeader>
          {roleChange && <p className="text-sm leading-6">
            <span className="font-medium">{roleChange.username}</span>의 역할을 {ROLE_LABEL[roleChange.role]}에서{' '}
            <span className="font-medium">{ROLE_LABEL[otherRole(roleChange.role)]}</span>(으)로 바꿉니다. 이 계정은 바로 로그아웃되고, 다시 로그인하면 새 역할이 적용됩니다.
          </p>}
          {error && <p role="alert">{error}</p>}
          <DialogFooter>
            <Button onClick={() => setRoleChange(null)} type="button" variant="outline">취소</Button>
            <Button aria-busy={roleChange ? busy.has(roleChange.id) : false} disabled={roleChange ? busy.has(roleChange.id) : false} onClick={() => void confirmRoleChange()} type="button">
              <Repeat aria-hidden="true" />변경
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {passwordReset && (
        <AccountDialog
          mode="reset"
          onOpenChange={(open) => { if (!open) setPasswordReset(null) }}
          onParticipantCreated={() => undefined}
          open
          staff={passwordReset}
        />
      )}
    </section>
  )
}
