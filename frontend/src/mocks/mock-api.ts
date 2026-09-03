import type {
  AppApi,
  CreateParticipantInput,
  CurrentUser,
  InterviewDetail,
  InterviewListItem,
  LoginInput,
  ParticipantRecord,
  PasswordResult,
  ReviewScorecardInput,
  ScoreDecision,
} from '../app/contracts'
import {
  createMockFixtureState,
  type MockAccountFixture,
  type MockFixtureState,
  type MockInterviewFixture,
} from './fixtures'

const CURRENT_MOCK_USER_KEY = 'dabom.mock-user'

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export class MockAppApi implements AppApi {
  private readonly state: MockFixtureState
  private readonly committedTurns = new Map<string, InterviewDetail>()
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
    if (!await this.matchesPassword(account, currentPassword)) throw new ApiError(401, 'Invalid credentials')
    account.passwordVerifier = await this.passwordVerifier(newPassword)
  }

  async getCurrentInterview(): Promise<InterviewDetail> {
    const account = this.requireParticipant()
    const interview = this.state.interviews.find((candidate) => candidate.participantId === account.id)
    if (!interview) throw new ApiError(404, 'Interview not found')
    return this.clone(interview)
  }

  async sendMessage(
    interviewId: string,
    clientTurnId: string,
    content: string,
  ): Promise<InterviewDetail> {
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
    const response = this.clone(interview)
    this.committedTurns.set(turnKey, response)
    return this.clone(response)
  }

  async listParticipants(): Promise<ParticipantRecord[]> {
    this.requireAdmin()
    return this.state.accounts
      .filter((account) => account.role === 'participant')
      .map((account) => this.toParticipantRecord(account))
  }

  async createParticipant(input: CreateParticipantInput): Promise<ParticipantRecord> {
    this.requireAdmin()
    if (this.state.accounts.some((account) => account.participantCode === input.participantCode)) {
      throw new ApiError(409, 'Participant code already exists')
    }
    if (this.state.accounts.some((account) => account.username === input.username)) {
      throw new ApiError(409, 'Username already exists')
    }

    const account: MockAccountFixture = {
      id: `participant-${(this.state.accounts.filter((item) => item.role === 'participant').length + 1)
        .toString()
        .padStart(3, '0')}`,
      username: input.username,
      passwordVerifier: await this.passwordVerifier(input.password),
      role: 'participant',
      participantCode: input.participantCode,
      status: 'active',
    }
    this.state.accounts.push(account)
    return this.toParticipantRecord(account)
  }

  async resetParticipantPassword(participantId: string): Promise<PasswordResult> {
    this.requireAdmin()
    const account = this.findParticipant(participantId)
    const assignedPassword = `reset-${account.participantCode}-password`
    account.passwordVerifier = await this.passwordVerifier(assignedPassword)
    return { assignedPassword }
  }

  async disableParticipant(participantId: string): Promise<ParticipantRecord> {
    this.requireAdmin()
    const account = this.findParticipant(participantId)
    account.status = 'disabled'
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

    if (input.action === 'override') {
      if (!input.expertStatus || !input.rationale) {
        throw new ApiError(400, 'Override needs an expert status and rationale')
      }
      row.expertStatus = input.expertStatus
      row.expertRationale = input.rationale
    } else {
      row.expertStatus = this.approvedStatus(row.aiStatus)
      row.expertRationale = input.rationale ?? null
    }
    interview.reviewStatus = 'reviewed'
    return this.clone(interview)
  }

  async exportInterviewCsv(interviewId: string): Promise<Blob> {
    this.requireAdmin()
    const interview = this.findInterview(interviewId)
    const header = [
      'interviewId',
      'participantCode',
      'status',
      'progress',
      'reviewStatus',
      'questionId',
      'question',
      'value',
      'aiStatus',
      'expertStatus',
      'expertRationale',
    ]
    const rows = interview.scorecard.map((row) => [
      interview.id,
      interview.participantCode,
      interview.status,
      interview.progress,
      interview.reviewStatus,
      row.questionId,
      row.question,
      row.value,
      row.aiStatus,
      row.expertStatus,
      row.expertRationale,
    ].map(this.csvValue).join(','))
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

  private approvedStatus(aiStatus: ScoreDecision | null): ScoreDecision | null {
    return aiStatus === 'positive' || aiStatus === 'negative' ? aiStatus : null
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

  private csvValue(value: string | number | null): string {
    if (value === null) return ''
    const text = String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  private clone<T>(value: T): T {
    return structuredClone(value)
  }
}
