import { ApiError } from './api-error'
import type {
  CreatedParticipant,
  ExportSelection,
  AccountStatus,
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
} from './contracts'

export type HttpFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

interface ParticipantAccountResponse {
  id: string
  username: string
  participantCode: string
  status: AccountStatus
  interviewStatus: ParticipantRecord['interviewStatus']
}

interface ParticipantCredentialResponse {
  participant: ParticipantAccountResponse
  assignedPassword: string | null
}

export class HttpAppApi implements AppApi {
  private readonly fetcher: HttpFetcher
  private readonly csrfCookieName: string

  constructor(
    fetcher?: HttpFetcher,
    csrfCookieName = import.meta.env.VITE_AUTH_CSRF_COOKIE || 'dabom_csrf',
  ) {
    this.fetcher = fetcher ?? ((input, init) => globalThis.fetch(input, init))
    this.csrfCookieName = csrfCookieName
  }

  async login(input: LoginInput, signal?: AbortSignal): Promise<CurrentUser> {
    return this.requestJson<CurrentUser>('/api/auth/login', {
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    })
  }

  async getCurrentUser(): Promise<CurrentUser | null> {
    try {
      return await this.requestJson<CurrentUser>('/api/auth/me', { method: 'GET' })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null
      throw error
    }
  }

  async logout(): Promise<void> {
    await this.requestEmpty('/api/auth/logout', this.withCsrf({ method: 'POST' }))
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.requestEmpty('/api/auth/password', this.withCsrf({
      body: JSON.stringify({ currentPassword, newPassword }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }))
  }

  async listParticipants(): Promise<ParticipantRecord[]> {
    const participants = await this.requestJson<ParticipantAccountResponse[]>(
      '/api/admin/participants',
      { method: 'GET' },
    )
    return participants.map((participant) => this.toParticipantRecord(participant))
  }

  async createParticipant(input: CreateParticipantInput): Promise<CreatedParticipant> {
    const body: Record<string, unknown> = { generatePassword: !input.password }
    if (input.username) body.username = input.username
    if (input.participantCode) body.participantCode = input.participantCode
    if (input.password) body.password = input.password
    const result = await this.requestJson<ParticipantCredentialResponse>(
      '/api/admin/participants',
      this.withCsrf({
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    )
    return {
      participant: this.toParticipantRecord(result.participant),
      assignedPassword: result.assignedPassword ?? null,
    }
  }

  async resetParticipantPassword(participantId: string): Promise<PasswordResult> {
    const result = await this.requestJson<{ assignedPassword: string | null }>(
      `${this.participantPath(participantId)}/password`,
      this.withCsrf({
        body: JSON.stringify({ generatePassword: true }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    )
    if (!result.assignedPassword) {
      throw new ApiError(502, '비밀번호 응답을 확인할 수 없습니다.')
    }
    return { assignedPassword: result.assignedPassword }
  }

  async enableParticipant(participantId: string): Promise<ParticipantRecord> {
    return this.updateParticipantState(participantId, 'enable')
  }

  async disableParticipant(participantId: string): Promise<ParticipantRecord> {
    return this.updateParticipantState(participantId, 'disable')
  }

  async unlockParticipant(participantId: string): Promise<ParticipantRecord> {
    return this.updateParticipantState(participantId, 'unlock')
  }

  async getCurrentInterview(): Promise<ParticipantInterview> {
    try {
      return await this.requestJson<ParticipantInterview>(
        '/api/interviews/current',
        { method: 'GET' },
      )
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error
      return this.requestJson<ParticipantInterview>(
        '/api/interviews',
        this.withCsrf({ method: 'POST' }),
      )
    }
  }

  async sendMessage(
    interviewId: string,
    clientTurnId: string,
    content: string,
  ): Promise<ParticipantInterview> {
    return this.requestJson<ParticipantInterview>(
      `${this.interviewPath(interviewId)}/messages`,
      this.withCsrf({
        body: JSON.stringify({ clientTurnId, content }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    )
  }

  async listInterviews(): Promise<InterviewListItem[]> {
    return this.requestJson<InterviewListItem[]>(
      '/api/admin/interviews',
      { method: 'GET' },
    )
  }

  async getInterview(interviewId: string): Promise<InterviewDetail> {
    return this.requestJson<InterviewDetail>(
      this.adminInterviewPath(interviewId),
      { method: 'GET' },
    )
  }

  async reviewScorecard(input: ReviewScorecardInput): Promise<InterviewDetail> {
    const { interviewId, questionId, ...review } = input
    return this.requestJson<InterviewDetail>(
      `${this.adminInterviewPath(interviewId)}/scorecard/${encodeURIComponent(questionId)}`,
      this.withCsrf({
        body: JSON.stringify(review),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    )
  }

  async archiveInterview(interviewId: string): Promise<InterviewDetail> {
    return this.requestJson<InterviewDetail>(
      `${this.adminInterviewPath(interviewId)}/archive`,
      this.withCsrf({ method: 'POST' }),
    )
  }

  async exportInterviewCsv(interviewId: string): Promise<Blob> {
    const response = await this.request(
      `${this.adminInterviewPath(interviewId)}/csv`,
      this.withCsrf({ method: 'POST' }),
    )
    return response.blob()
  }

  async exportInterviewsCsv(selection: ExportSelection): Promise<Blob> {
    const response = await this.request(
      '/api/admin/interviews/csv',
      this.withCsrf({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selection),
      }),
    )
    return response.blob()
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.request(path, init)
    return response.json() as Promise<T>
  }

  private async requestEmpty(path: string, init: RequestInit): Promise<void> {
    await this.request(path, init)
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await this.fetcher(path, {
      ...init,
      cache: 'no-store',
      credentials: 'include',
    })
    if (!response.ok) throw await this.toApiError(response)
    return response
  }

  private withCsrf(init: RequestInit): RequestInit {
    const csrfToken = this.readCookie(this.csrfCookieName)
    if (!csrfToken) throw new ApiError(403, '요청을 확인할 수 없습니다.')
    const headers = new Headers(init.headers)
    headers.set('X-CSRF-Token', csrfToken)
    return { ...init, headers }
  }

  private readCookie(name: string): string | null {
    const prefix = `${encodeURIComponent(name)}=`
    const encoded = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length)
    if (!encoded) return null
    try {
      return decodeURIComponent(encoded)
    } catch {
      return encoded
    }
  }

  private toParticipantRecord(participant: ParticipantAccountResponse): ParticipantRecord {
    return { ...participant }
  }

  private async updateParticipantState(
    participantId: string,
    action: 'disable' | 'enable' | 'unlock',
  ): Promise<ParticipantRecord> {
    const participant = await this.requestJson<ParticipantAccountResponse>(
      `${this.participantPath(participantId)}/${action}`,
      this.withCsrf({ method: 'POST' }),
    )
    return this.toParticipantRecord(participant)
  }

  private participantPath(participantId: string): string {
    return `/api/admin/participants/${encodeURIComponent(participantId)}`
  }

  private interviewPath(interviewId: string): string {
    return `/api/interviews/${encodeURIComponent(interviewId)}`
  }

  private adminInterviewPath(interviewId: string): string {
    return `/api/admin/interviews/${encodeURIComponent(interviewId)}`
  }

  private async toApiError(response: Response): Promise<ApiError> {
    let message = '요청을 처리하지 못했습니다.'
    try {
      const payload = await response.json() as { detail?: unknown }
      if (typeof payload.detail === 'string') message = payload.detail
    } catch {
      // Keep the safe generic message when an upstream response is not JSON.
    }
    return new ApiError(response.status, message)
  }
}
