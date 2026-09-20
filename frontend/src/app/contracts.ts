export type Role = 'participant' | 'reviewer' | 'admin'
// Reviewers and administrators: accounts that work on the study rather than take part in it.
export type StaffRole = Exclude<Role, 'participant'>
export type AccountStatus = 'active' | 'disabled' | 'admin_locked'
type InterviewStatus = 'active' | 'completed' | 'archived'

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
  username?: string
  participantCode?: string
  password?: string
}

export interface CreatedParticipant {
  participant: ParticipantRecord
  assignedPassword: string | null
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
  temporaryLockedUntil?: string | null
}

// How a participant gave an answer; absent for the interviewer and for older records.
type AnswerSource = 'typed' | 'suggested'

export interface StaffRecord {
  id: string
  username: string
  role: StaffRole
  status: AccountStatus
  temporaryLockedUntil?: string | null
}

export interface CreateStaffInput {
  username: string
  role: StaffRole
}

export interface CreatedStaff {
  staff: StaffRecord
  assignedPassword: string
}

export interface InterviewMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  source?: AnswerSource | null
}

export type ScoreDecision = 'positive' | 'negative' | 'recorded'

export interface ScorecardRow {
  questionId: string
  question: string
  answer: string | null
  answerSource?: AnswerSource | null
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

export interface ExportSelection {
  interviewIds?: string[]
  participantIds?: string[]
}

export interface InterviewDetail extends InterviewListItem {
  messages: InterviewMessage[]
  scorecard: ScorecardRow[]
  finalDiagnosis: string | null
  criteria: Record<string, boolean | null>
  report: string | null
  algorithmVersion: string
  completedAt: string | null
}

// A reply the participant can tap; send=false puts it in the composer to be finished first.
export interface SuggestedReply {
  text: string
  send: boolean
}

export interface ParticipantInterview {
  id: string
  status: InterviewStatus
  progress: number
  updatedAt: string
  messages: InterviewMessage[]
  suggestedReplies?: SuggestedReply[]
}

export interface ReviewScorecardInput {
  interviewId: string
  questionId: string
  action: 'approve' | 'override'
  expertStatus?: Exclude<ScoreDecision, 'recorded'>
  rationale?: string
}

export interface AppApi {
  login(input: LoginInput, signal?: AbortSignal): Promise<CurrentUser>
  logout(): Promise<void>
  getCurrentUser(): Promise<CurrentUser | null>
  changePassword(currentPassword: string, newPassword: string): Promise<void>
  getCurrentInterview(): Promise<ParticipantInterview>
  startInterview(): Promise<ParticipantInterview>
  sendMessage(interviewId: string, clientTurnId: string, content: string, suggested?: boolean): Promise<ParticipantInterview>
  listParticipants(): Promise<ParticipantRecord[]>
  createParticipant(input: CreateParticipantInput): Promise<CreatedParticipant>
  resetParticipantPassword(participantId: string): Promise<PasswordResult>
  disableParticipant(participantId: string): Promise<ParticipantRecord>
  enableParticipant(participantId: string): Promise<ParticipantRecord>
  unlockParticipant(participantId: string): Promise<ParticipantRecord>
  listStaff(): Promise<StaffRecord[]>
  createStaff(input: CreateStaffInput): Promise<CreatedStaff>
  changeStaffRole(staffId: string, role: StaffRole): Promise<StaffRecord>
  resetStaffPassword(staffId: string): Promise<PasswordResult>
  disableStaff(staffId: string): Promise<StaffRecord>
  enableStaff(staffId: string): Promise<StaffRecord>
  unlockStaff(staffId: string): Promise<StaffRecord>
  listInterviews(): Promise<InterviewListItem[]>
  getInterview(interviewId: string): Promise<InterviewDetail>
  reviewScorecard(input: ReviewScorecardInput): Promise<InterviewDetail>
  archiveInterview(interviewId: string): Promise<InterviewDetail>
  exportInterviewCsv(interviewId: string): Promise<Blob>
  exportInterviewsCsv(selection: ExportSelection): Promise<Blob>
}
