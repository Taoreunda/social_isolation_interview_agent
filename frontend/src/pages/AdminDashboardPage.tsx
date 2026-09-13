import { AlertCircle, CircleCheck, Clock3, Download, FileText, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useApi } from '@/app/api-context'
import { canSaveBlob, saveBlob } from '@/app/download'
import type { InterviewListItem } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function MobileLabel({ children }: { children: string }) {
  return <span className="mr-1 sm:hidden">{children}</span>
}

function InterviewState({ item }: { item: InterviewListItem }) {
  const active = item.status === 'active'
  const Icon = active ? Clock3 : CircleCheck
  const label = active ? '진행 중' : item.status === 'completed' ? '완료' : '보관'
  return <span className="inline-flex items-center gap-1"><Icon aria-hidden="true" className="size-4" />{label}</span>
}

function ReviewState({ status }: { status: InterviewListItem['reviewStatus'] }) {
  const label = status === 'unreviewed' ? '미검토' : status === 'in_review' ? '검토 중' : '검토 완료'
  return <span className="inline-flex items-center gap-1"><FileText aria-hidden="true" className="size-4" />{label}</span>
}

export function AdminDashboardPage() {
  const api = useApi()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [items, setItems] = useState<InterviewListItem[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const mounted = useRef(false)
  const token = useRef(0)

  const load = useCallback(async () => {
    const id = ++token.current
    setPhase('loading')
    try {
      const result = await api.listInterviews()
      if (mounted.current && id === token.current) {
        setItems(result)
        setPhase('ready')
      }
    } catch {
      if (mounted.current && id === token.current) {
        setPhase('error')
      }
    }
  }, [api])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => {
      mounted.current = false
      token.current += 1
    }
  }, [load])

  const metrics = [
    ['전체', items.length],
    ['진행 중', items.filter((item) => item.status === 'active').length],
    ['완료', items.filter((item) => item.status === 'completed').length],
    ['미검토', items.filter((item) => item.reviewStatus === 'unreviewed').length],
  ] as const

  if (phase === 'loading') {
    return <main className="mx-auto w-full max-w-[96rem] px-4 py-6"><p role="status">인터뷰를 불러오는 중</p></main>
  }

  if (phase === 'error') {
    return (
      <main className="mx-auto w-full max-w-[96rem] px-4 py-6">
        <p className="inline-flex items-center gap-2" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />
          인터뷰를 불러오지 못했습니다
        </p>
        <Button className="mt-3" onClick={() => void load()} type="button" variant="outline">
          <RefreshCw aria-hidden="true" />
          다시 시도
        </Button>
      </main>
    )
  }

  const allSelected = items.length > 0 && items.every((item) => selected.includes(item.id))

  function toggleAll(): void {
    setSelected(allSelected ? [] : items.map((item) => item.id))
  }

  function toggle(id: string): void {
    setSelected((current) => (
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    ))
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
      const blob = await api.exportInterviewsCsv({ interviewIds: selected })
      saveBlob(blob, selected.length ? 'interviews-selected.csv' : 'interviews-all.csv')
    } catch {
      setExportError('CSV를 다운로드하지 못했습니다')
    } finally {
      setExporting(false)
    }
  }

  const exportLabel = selected.length ? `선택 ${selected.length}건 CSV 다운로드` : '전체 CSV 다운로드'

  return (
    <main className="mx-auto w-full max-w-[96rem] px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">검토</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            aria-busy={exporting}
            className="min-h-11 sm:min-h-9"
            disabled={exporting || items.length === 0}
            onClick={() => void exportCsv()}
            type="button"
            variant="outline"
          >
            <Download aria-hidden="true" />{exportLabel}
          </Button>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-3 border-y border-border py-4 sm:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {exportError && <p className="mt-3 inline-flex items-center gap-2" role="alert">
        <AlertCircle aria-hidden="true" className="size-4" />{exportError}
      </p>}
      {items.length === 0 ? (
        <p className="mt-6 text-muted-foreground">인터뷰가 없습니다</p>
      ) : (
        <Table aria-label="인터뷰 대기열" className="mt-5">
          <TableHeader className="sr-only sm:not-sr-only sm:table-header-group">
            <TableRow>
              <TableHead>
                <Checkbox
                  aria-label="전체 선택"
                  checked={allSelected}
                  onCheckedChange={() => toggleAll()}
                />
              </TableHead>
              <TableHead>참여자 코드</TableHead>
              <TableHead>진행률</TableHead>
              <TableHead>인터뷰 상태</TableHead>
              <TableHead>검토 상태</TableHead>
              <TableHead>수정 시각</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="block sm:table-row-group">
            {items.map((item) => (
              <TableRow
                className="block cursor-pointer hover:bg-accent sm:table-row"
                key={item.id}
                onClick={() => navigate(`/admin/interviews/${item.id}`)}
              >
                <TableCell className="block sm:table-cell" onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    aria-label={`${item.participantCode} 선택`}
                    checked={selected.includes(item.id)}
                    onCheckedChange={() => toggle(item.id)}
                  />
                </TableCell>
                <TableCell className="block break-words whitespace-normal sm:table-cell">
                  <MobileLabel>참여자 코드:</MobileLabel>
                  <Link
                    aria-label={`${item.participantCode} 인터뷰 검토`}
                    className="font-medium text-foreground underline underline-offset-4"
                    to={`/admin/interviews/${item.id}`}
                  >
                    {item.participantCode}
                  </Link>
                </TableCell>
                <TableCell className="block sm:table-cell">
                  <MobileLabel>진행률:</MobileLabel>
                  {item.progress}%
                </TableCell>
                <TableCell className="block sm:table-cell">
                  <MobileLabel>인터뷰 상태:</MobileLabel>
                  <InterviewState item={item} />
                </TableCell>
                <TableCell className="block sm:table-cell">
                  <MobileLabel>검토 상태:</MobileLabel>
                  <ReviewState status={item.reviewStatus} />
                </TableCell>
                <TableCell className="block sm:table-cell">
                  <MobileLabel>수정 시각:</MobileLabel>
                  {new Date(item.updatedAt).toLocaleString('ko-KR')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  )
}
