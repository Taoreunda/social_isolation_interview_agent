import { ApiError } from './api-error'
import type {
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

  async createParticipant(input: CreateParticipantInput): Promise<ParticipantRecord> {
    const result = await this.requestJson<ParticipantCredentialResponse>(
      '/api/admin/participants',
      this.withCsrf({
        body: JSON.stringify({ ...input, generatePassword: false }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    )
    return this.toParticipantRecord(result.participant)
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

  async disableParticipant(participantId: string): Promise<ParticipantRecord> {
    return this.updateParticipantState(participantId, 'disable')
  }

  async unlockParticipant(participantId: string): Promise<ParticipantRecord> {
    return this.updateParticipantState(participantId, 'unlock')
  }

  async getCurrentInterview(): Promise<ParticipantInterview> {
    return this.researchUnavailable()
  }

  async sendMessage(
    _interviewId: string,
    _clientTurnId: string,
    _content: string,
  ): Promise<ParticipantInterview> {
    return this.researchUnavailable()
  }

  async listInterviews(): Promise<InterviewListItem[]> {
    return this.researchUnavailable()
  }

  async getInterview(_interviewId: string): Promise<InterviewDetail> {
    return this.researchUnavailable()
  }

  async reviewScorecard(_input: ReviewScorecardInput): Promise<InterviewDetail> {
    return this.researchUnavailable()
  }

  async exportInterviewCsv(_interviewId: string): Promise<Blob> {
    return this.researchUnavailable()
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
    return {
      ...participant,
      interviewStatus: 'not_started',
    }
  }

  private async updateParticipantState(
    participantId: string,
    action: 'disable' | 'unlock',
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

  private researchUnavailable(): never {
    throw new ApiError(501, '인터뷰 기능은 아직 연결되지 않았습니다.')
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
