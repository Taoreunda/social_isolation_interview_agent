import type {
  CreatedParticipant,
  ExportSelection,
  AppApi,
  CreateParticipantInput,
  CurrentUser,
  InterviewDetail,
  InterviewListItem,
  LoginInput,
  ParticipantInterview,
  ParticipantRecord,
  PasswordResult,
  ReviewScorecardInput,
} from '../app/contracts'
import { ApiError } from '../app/api-error'
import {
  createMockFixtureState,
  type MockAccountFixture,
  type MockFixtureState,
  type MockInterviewFixture,
} from './fixtures'

const CURRENT_MOCK_USER_KEY = 'dabom.mock-user'

function participantPassword(participantCode: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let tail = ''
  while (`${participantCode.toLowerCase()}-${tail}`.length < 10 || tail.length < 4) {
    tail += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return `${participantCode.toLowerCase()}-${tail}`
}

export class MockAppApi implements AppApi {
  private readonly state: MockFixtureState
  private readonly committedTurns = new Map<string, ParticipantInterview>()
  private currentUserId: string | null = null

  constructor(state: MockFixtureState = createMockFixtureState()) {
    this.state = this.clone(state)
  }

  async login(input: LoginInput, signal?: AbortSignal): Promise<CurrentUser> {
    this.throwIfAborted(signal)
    const account = this.state.accounts.find((candidate) => candidate.username === input.username)
    if (!account || account.status === 'disabled' || !await this.matchesPassword(account, input.password)) {
      throw new ApiError(401, 'Invalid credentials')
    }

    await Promise.resolve()
    this.throwIfAborted(signal)
    this.currentUserId = account.id
    this.storeCurrentUser(account.id, input.remember)
    return this.toCurrentUser(account)
  }

  async logout(): Promise<void> {
    this.currentUserId = null
    window.sessionStorage.removeItem(CURRENT_MOCK_USER_KEY)
    window.localStorage.removeItem(CURRENT_MOCK_USER_KEY)
  }

  async getCurrentUser(): Promise<CurrentUser | null> {
    const account = this.currentAccount()
    return account ? this.toCurrentUser(account) : null
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const account = this.requireCurrentAccount()
    if (!await this.matchesPassword(account, currentPassword)) throw new ApiError(400, 'Invalid current password')
    account.passwordVerifier = await this.passwordVerifier(newPassword)
    await this.logout()
  }

  async getCurrentInterview(): Promise<ParticipantInterview> {
    const account = this.requireParticipant()
    const interview = this.state.interviews.find((candidate) => candidate.participantId === account.id)
    if (!interview) throw new ApiError(404, 'Interview not found')
    return this.toParticipantInterview(interview)
  }

  async sendMessage(
    interviewId: string,
    clientTurnId: string,
    content: string,
  ): Promise<ParticipantInterview> {
    const account = this.requireParticipant()
    const interview = this.findInterview(interviewId)
    if (interview.participantId !== account.id) throw new ApiError(403, 'Interview is not available')

    const turnKey = this.turnKey(interviewId, clientTurnId)
    const committed = this.committedTurns.get(turnKey)
    if (committed) return this.clone(committed)

    const messageNumber = interview.messages.length + 1
    const createdAt = '2026-08-25T09:01:00.000Z'
    interview.messages.push(
      {
        id: `message-${messageNumber.toString().padStart(3, '0')}`,
        role: 'user',
        content,
        createdAt,
      },
      {
        id: `message-${(messageNumber + 1).toString().padStart(3, '0')}`,
        role: 'assistant',
        content: '말씀해 주셔서 감사합니다. 조금 더 이야기해 주세요.',
        createdAt,
      },
    )
    interview.updatedAt = createdAt
    const response = this.toParticipantInterview(interview)
    this.committedTurns.set(turnKey, response)
    return this.clone(response)
  }

  async listParticipants(): Promise<ParticipantRecord[]> {
    this.requireAdmin()
    return this.state.accounts
      .filter((account) => account.role === 'participant')
      .map((account) => this.toParticipantRecord(account))
  }

  async createParticipant(input: CreateParticipantInput): Promise<CreatedParticipant> {
    this.requireAdmin()
    const participantCode = input.participantCode || this.nextResearchCode()
    const username = input.username || participantCode.toLowerCase()
    if (this.state.accounts.some((account) => account.participantCode === participantCode)) {
      throw new ApiError(409, 'Participant code already exists')
    }
    if (this.state.accounts.some((account) => account.username === username)) {
      throw new ApiError(409, 'Username already exists')
    }

    const assignedPassword = input.password ?? participantPassword(participantCode)
    const account: MockAccountFixture = {
      id: `participant-${(this.state.accounts.filter((item) => item.role === 'participant').length + 1)
        .toString()
        .padStart(3, '0')}`,
      username,
      passwordVerifier: await this.passwordVerifier(assignedPassword),
      role: 'participant',
      participantCode,
      status: 'active',
    }
    this.state.accounts.push(account)
    return {
      participant: this.toParticipantRecord(account),
      assignedPassword: input.password ? null : assignedPassword,
    }
  }

  private nextResearchCode(): string {
    const highest = this.state.accounts.reduce((top, account) => {
      const match = /^KU-(\d{3,})$/.exec(account.participantCode ?? '')
      return match ? Math.max(top, Number(match[1])) : top
    }, 0)
    return `KU-${String(highest + 1).padStart(3, '0')}`
  }

  async resetParticipantPassword(participantId: string): Promise<PasswordResult> {
    this.requireAdmin()
    const account = this.findParticipant(participantId)
    const assignedPassword = `reset-${account.participantCode}-password`
    account.passwordVerifier = await this.passwordVerifier(assignedPassword)
    return { assignedPassword }
  }

  async enableParticipant(participantId: string): Promise<ParticipantRecord> {
    this.requireAdmin()
    const account = this.findParticipant(participantId)
    if (account.status !== 'disabled') throw new ApiError(409, 'Account is not disabled')
    account.status = 'active'
    return this.toParticipantRecord(account)
  }

  async disableParticipant(participantId: string): Promise<ParticipantRecord> {
    this.requireAdmin()
    const account = this.findParticipant(participantId)
    account.status = 'disabled'
    return this.toParticipantRecord(account)
  }

  async unlockParticipant(participantId: string): Promise<ParticipantRecord> {
    this.requireAdmin()
    const account = this.findParticipant(participantId)
    if (account.status !== 'admin_locked') {
      throw new ApiError(409, 'Account is not administrator locked')
    }
    account.status = 'active'
    return this.toParticipantRecord(account)
  }

  async listInterviews(): Promise<InterviewListItem[]> {
    this.requireAdmin()
    return this.state.interviews.map(({ messages: _messages, scorecard: _scorecard, participantId: _participantId, ...item }) =>
      this.clone(item),
    )
  }

  async getInterview(interviewId: string): Promise<InterviewDetail> {
    this.requireAdmin()
    return this.clone(this.findInterview(interviewId))
  }

  async reviewScorecard(input: ReviewScorecardInput): Promise<InterviewDetail> {
    this.requireAdmin()
    const interview = this.findInterview(input.interviewId)
    const row = interview.scorecard.find((candidate) => candidate.questionId === input.questionId)
    if (!row) throw new ApiError(404, 'Scorecard row not found')
    if (row.aiStatus === null) throw new ApiError(400, 'AI decision is required for review')

    if (input.action === 'override') {
      if (row.aiStatus === 'recorded') {
        throw new ApiError(400, 'Recorded items can only be approved')
      }
      if (!input.expertStatus) {
        throw new ApiError(400, 'Override needs an expert status')
      }
      if (input.expertStatus === row.aiStatus) {
        throw new ApiError(400, 'Override must change the AI decision')
      }
      row.expertStatus = input.expertStatus
      row.expertRationale = input.rationale?.trim() || null
    } else {
      row.expertStatus = row.aiStatus
      row.expertRationale = input.rationale?.trim() || null
    }
    interview.reviewStatus = this.reviewStatus(interview)
    return this.clone(interview)
  }

  async archiveInterview(interviewId: string): Promise<InterviewDetail> {
    this.requireAdmin()
    const interview = this.findInterview(interviewId)
    if (interview.status !== 'completed') throw new ApiError(409, 'Interview is not finished')
    interview.status = 'archived'
    return this.clone(interview)
  }

  async exportInterviewCsv(interviewId: string): Promise<Blob> {
    this.requireAdmin()
    return this.csvBlob([this.findInterview(interviewId)])
  }

  async exportInterviewsCsv(selection: ExportSelection): Promise<Blob> {
    this.requireAdmin()
    const byInterview = new Set(selection.interviewIds ?? [])
    const byParticipant = new Set(selection.participantIds ?? [])
    let chosen = this.state.interviews
    if (byInterview.size) chosen = chosen.filter((row) => byInterview.has(row.id))
    if (byParticipant.size) chosen = chosen.filter((row) => byParticipant.has(row.participantId))
    return this.csvBlob(chosen)
  }

  private csvBlob(interviews: MockInterviewFixture[]): Blob {
    const header = [
      'interviewId',
      'participantCode',
      'status',
      'progress',
      'reviewStatus',
      'finalDiagnosis',
      'criteriaA',
      'criteriaB',
      'criteriaC',
      'criteriaD',
      'completedAt',
      'algorithmVersion',
      'report',
      'questionId',
      'question',
      'value',
      'aiStatus',
      'expertStatus',
      'expertRationale',
    ]
    const rows = interviews.flatMap((interview) => interview.scorecard.map((row) => [
      interview.id,
      interview.participantCode,
      interview.status,
      interview.progress,
      interview.reviewStatus,
      interview.finalDiagnosis,
      interview.criteria.A,
      interview.criteria.B,
      interview.criteria.C,
      interview.criteria.D,
      interview.completedAt,
      interview.algorithmVersion,
      interview.report,
      row.questionId,
      row.question,
      row.value,
      row.aiStatus,
      row.expertStatus,
      row.expertRationale,
    ].map(this.csvValue).join(',')))
    return new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' })
  }

  private currentAccount(): MockAccountFixture | null {
    const storedUserId = window.sessionStorage.getItem(CURRENT_MOCK_USER_KEY)
      ?? window.localStorage.getItem(CURRENT_MOCK_USER_KEY)
    const userId = storedUserId ?? this.currentUserId
    const account = userId ? this.state.accounts.find((candidate) => candidate.id === userId) ?? null : null
    if (!account || account.status === 'disabled') {
      this.currentUserId = null
      return null
    }
    this.currentUserId = account.id
    return account
  }

  private requireCurrentAccount(): MockAccountFixture {
    const account = this.currentAccount()
    if (!account) throw new ApiError(401, 'Authentication required')
    return account
  }

  private requireParticipant(): MockAccountFixture {
    const account = this.requireCurrentAccount()
    if (account.role !== 'participant') throw new ApiError(403, 'Participant access required')
    return account
  }

  private requireAdmin(): MockAccountFixture {
    const account = this.requireCurrentAccount()
    if (account.role !== 'admin') throw new ApiError(403, 'Administrator access required')
    return account
  }

  private findParticipant(participantId: string): MockAccountFixture {
    const account = this.state.accounts.find((candidate) => candidate.id === participantId && candidate.role === 'participant')
    if (!account) throw new ApiError(404, 'Participant not found')
    return account
  }

  private findInterview(interviewId: string): MockInterviewFixture {
    const interview = this.state.interviews.find((candidate) => candidate.id === interviewId)
    if (!interview) throw new ApiError(404, 'Interview not found')
    return interview
  }

  private storeCurrentUser(userId: string, remember: boolean): void {
    window.sessionStorage.removeItem(CURRENT_MOCK_USER_KEY)
    window.localStorage.removeItem(CURRENT_MOCK_USER_KEY)
    const storage = remember ? window.localStorage : window.sessionStorage
    storage.setItem(CURRENT_MOCK_USER_KEY, userId)
  }

  private toCurrentUser(account: MockAccountFixture): CurrentUser {
    return {
      id: account.id,
      username: account.username,
      role: account.role,
      participantCode: account.participantCode,
    }
  }

  private toParticipantRecord(account: MockAccountFixture): ParticipantRecord {
    const interview = this.state.interviews.find((candidate) => candidate.participantId === account.id)
    return {
      id: account.id,
      username: account.username,
      participantCode: account.participantCode!,
      status: account.status,
      interviewStatus: interview?.status ?? 'not_started',
    }
  }

  private toParticipantInterview(interview: MockInterviewFixture): ParticipantInterview {
    return this.clone({
      id: interview.id,
      status: interview.status,
      progress: interview.progress,
      updatedAt: interview.updatedAt,
      messages: interview.messages,
    })
  }

  private reviewStatus(interview: MockInterviewFixture): InterviewListItem['reviewStatus'] {
    const reviewableRows = interview.scorecard.filter((row) => row.aiStatus !== null)
    const reviewedRows = reviewableRows.filter((row) => row.expertStatus !== null).length
    if (reviewedRows === 0) return 'unreviewed'
    return reviewedRows === reviewableRows.length ? 'reviewed' : 'in_review'
  }

  private turnKey(interviewId: string, clientTurnId: string): string {
    return JSON.stringify([interviewId, clientTurnId])
  }

  private async matchesPassword(account: MockAccountFixture, password: string): Promise<boolean> {
    return account.passwordVerifier === await this.passwordVerifier(password)
  }

  private async passwordVerifier(password: string): Promise<string> {
    const bytes = new TextEncoder().encode(password)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
  }

  private throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw new DOMException('Login aborted', 'AbortError')
  }

  private csvValue(value: string | number | boolean | null): string {
    if (value === null) return ''
    const text = String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  private clone<T>(value: T): T {
    return structuredClone(value)
  }
}
