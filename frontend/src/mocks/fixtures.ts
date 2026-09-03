import type {
  AccountStatus,
  InterviewDetail,
  InterviewStatus,
  Role,
} from '../app/contracts'

export interface MockAccountFixture {
  id: string
  username: string
  password: string
  role: Role
  participantCode: string | null
  status: AccountStatus
}

export interface MockInterviewFixture extends InterviewDetail {
  participantId: string
}

export interface MockFixtureState {
  accounts: MockAccountFixture[]
  interviews: MockInterviewFixture[]
}

const participantAccount: MockAccountFixture = {
  id: 'participant-001',
  username: 'participant01',
  password: 'research123!',
  role: 'participant',
  participantCode: 'P-001',
  status: 'active',
}

const adminAccount: MockAccountFixture = {
  id: 'admin-001',
  username: 'admin',
  password: 'research123!',
  role: 'admin',
  participantCode: null,
  status: 'active',
}

const completed: InterviewStatus = 'completed'

const participantInterview: MockInterviewFixture = {
  id: 'interview-001',
  participantId: participantAccount.id,
  participantCode: 'P-001',
  status: completed,
  progress: 100,
  reviewStatus: 'unreviewed',
  updatedAt: '2026-08-25T09:00:00.000Z',
  messages: [
    {
      id: 'message-001',
      role: 'assistant',
      content: '안녕하세요. 최근 한 달간 일상을 이야기해 주세요.',
      createdAt: '2026-08-25T09:00:00.000Z',
    },
  ],
  scorecard: [
    {
      questionId: 'q1',
      question: '최근 한 달간 혼자 지내는 시간이 얼마나 되었나요?',
      value: '하루 대부분',
      rationale: '응답에서 혼자 지내는 시간이 길다고 언급했습니다.',
      aiStatus: 'positive',
      expertStatus: null,
      expertRationale: null,
    },
    {
      questionId: 'q2',
      question: '도움을 요청할 수 있는 사람이 있나요?',
      value: '한 명 있습니다',
      rationale: '도움을 요청할 수 있는 지인을 한 명 언급했습니다.',
      aiStatus: 'recorded',
      expertStatus: null,
      expertRationale: null,
    },
  ],
}

const state: MockFixtureState = {
  accounts: [participantAccount, adminAccount],
  interviews: [participantInterview],
}

export function createMockFixtureState(): MockFixtureState {
  return structuredClone(state)
}
