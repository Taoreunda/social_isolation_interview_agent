export type Role = 'participant' | 'admin'
export type AccountStatus = 'active' | 'disabled'
export type InterviewStatus = 'active' | 'completed' | 'archived'

export interface CurrentUser {
  id: string
  username: string
  role: Role
  participantCode: string | null
}

export interface LoginInput {
  username: string
  password: string
  remember: boolean
}

export interface CreateParticipantInput {
  username: string
  participantCode: string
  password: string
}

export interface PasswordResult {
  assignedPassword: string
}

export interface ParticipantRecord {
  id: string
  username: string
  participantCode: string
  status: AccountStatus
  interviewStatus: InterviewStatus | 'not_started'
}

export interface InterviewMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export type ScoreDecision = 'positive' | 'negative' | 'recorded'

export interface ScorecardRow {
  questionId: string
  question: string
  value: string | null
  rationale: string | null
  aiStatus: ScoreDecision | null
  expertStatus: ScoreDecision | null
  expertRationale: string | null
}

export interface InterviewListItem {
  id: string
  participantCode: string
  status: InterviewStatus
  progress: number
  reviewStatus: 'unreviewed' | 'in_review' | 'reviewed'
  updatedAt: string
}

export interface InterviewDetail extends InterviewListItem {
  messages: InterviewMessage[]
  scorecard: ScorecardRow[]
}

export interface ReviewScorecardInput {
  interviewId: string
  questionId: string
  action: 'approve' | 'override'
  expertStatus?: Exclude<ScoreDecision, 'recorded'>
  rationale?: string
}

export interface AppApi {
  login(input: LoginInput): Promise<CurrentUser>
  logout(): Promise<void>
  getCurrentUser(): Promise<CurrentUser | null>
  changePassword(currentPassword: string, newPassword: string): Promise<void>
  getCurrentInterview(): Promise<InterviewDetail>
  sendMessage(interviewId: string, clientTurnId: string, content: string): Promise<InterviewDetail>
  listParticipants(): Promise<ParticipantRecord[]>
  createParticipant(input: CreateParticipantInput): Promise<ParticipantRecord>
  resetParticipantPassword(participantId: string): Promise<PasswordResult>
  disableParticipant(participantId: string): Promise<ParticipantRecord>
  listInterviews(): Promise<InterviewListItem[]>
  getInterview(interviewId: string): Promise<InterviewDetail>
  reviewScorecard(input: ReviewScorecardInput): Promise<InterviewDetail>
  exportInterviewCsv(interviewId: string): Promise<Blob>
}
