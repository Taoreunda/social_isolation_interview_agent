import { AlertCircle, CircleCheck, Clock3, FileText, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { useApi } from '@/app/api-context'
import type { InterviewListItem } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function State({ status }: { status: InterviewListItem['status'] }) {
  const Icon = status === 'active' ? Clock3 : CircleCheck
  const label = status === 'active' ? '진행 중' : status === 'completed' ? '완료' : '보관'
  return <span className="inline-flex items-center gap-1"><Icon aria-hidden="true" className="size-4" />{label}</span>
}
function ReviewState({ status }: { status: InterviewListItem['reviewStatus'] }) { const label = status === 'unreviewed' ? '미검토' : status === 'in_review' ? '검토 중' : '검토 완료'; return <span className="inline-flex items-center gap-1"><FileText aria-hidden="true" className="size-4" />{label}</span> }
function MobileLabel({ children }: { children: string }) { return <span className="mr-1 sm:hidden">{children}</span> }

export function AdminDashboardPage() {
  const api = useApi(); const [interviews, setInterviews] = useState<InterviewListItem[]>([]); const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading'); const mounted = useRef(false); const generation = useRef(0)
  const load = useCallback(async () => { const current = ++generation.current; setPhase('loading'); try { const listed = await api.listInterviews(); if (!mounted.current || current !== generation.current) return; setInterviews(listed); setPhase('ready') } catch { if (mounted.current && current === generation.current) setPhase('error') } }, [api])
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; generation.current += 1 } }, [load])
  const metrics = [['전체', interviews.length], ['진행 중', interviews.filter((item) => item.status === 'active').length], ['완료', interviews.filter((item) => item.status === 'completed').length], ['미검토', interviews.filter((item) => item.reviewStatus === 'unreviewed').length]] as const
  return <main className="mx-auto w-full max-w-6xl px-4 py-6"><h1 className="text-xl font-semibold">검토</h1>{phase === 'loading' && <p className="mt-6" role="status">인터뷰를 불러오는 중</p>}{phase === 'error' && <div className="mt-6"><p className="inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />인터뷰를 불러오지 못했습니다</p><Button className="mt-3" onClick={() => void load()} type="button" variant="outline"><RefreshCw aria-hidden="true" />다시 시도</Button></div>}{phase === 'ready' && <><dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border py-4 sm:grid-cols-4">{metrics.map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold">{value}</dd></div>)}</dl>{interviews.length === 0 ? <p className="mt-6 text-muted-foreground">인터뷰가 없습니다</p> : <Table aria-label="인터뷰 대기열" className="mt-5"><TableHeader className="sr-only sm:table-header-group"><TableRow><TableHead>참여자 코드</TableHead><TableHead>진행률</TableHead><TableHead>인터뷰 상태</TableHead><TableHead>검토 상태</TableHead><TableHead>수정 시각</TableHead></TableRow></TableHeader><TableBody className="block sm:table-row-group">{interviews.map((item) => <TableRow className="block sm:table-row" key={item.id}><TableCell className="block break-words whitespace-normal sm:table-cell"><MobileLabel>참여자 코드:</MobileLabel><Link className="inline-flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline sm:min-h-0" to={`/admin/interviews/${item.id}`}>{item.participantCode}</Link></TableCell><TableCell className="block break-words whitespace-normal sm:table-cell"><MobileLabel>진행률:</MobileLabel>{item.progress}%</TableCell><TableCell className="block break-words whitespace-normal sm:table-cell"><MobileLabel>인터뷰 상태:</MobileLabel><State status={item.status} /></TableCell><TableCell className="block break-words whitespace-normal sm:table-cell"><MobileLabel>검토 상태:</MobileLabel><ReviewState status={item.reviewStatus} /></TableCell><TableCell className="block break-words whitespace-normal sm:table-cell"><MobileLabel>수정 시각:</MobileLabel>{new Date(item.updatedAt).toLocaleString('ko-KR')}</TableCell></TableRow>)}</TableBody></Table>}</>}</main>
}
