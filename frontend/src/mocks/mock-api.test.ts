import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'

import { ApiProvider, useApi } from '../app/api-context'
import { ApiError } from '../app/api-error'
import { createMockFixtureState } from './fixtures'
import { MockAppApi } from './mock-api'

const participantLogin = {
  username: 'participant01',
  password: 'research123!',
  remember: false,
}

const adminLogin = {
  username: 'admin',
  password: 'research123!',
  remember: false,
}

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

function installBrowserStorage(): void {
  Object.defineProperties(window, {
    localStorage: { configurable: true, value: createStorage() },
    sessionStorage: { configurable: true, value: createStorage() },
  })
}

describe('MockAppApi', () => {
  beforeEach(() => {
    installBrowserStorage()
  })

  afterEach(() => {
    installBrowserStorage()
  })

  it('logs in the participant and admin fixtures with one-argument calls', async () => {
    const participantApi = new MockAppApi()
    const participant = await participantApi.login(participantLogin)
    const adminApi = new MockAppApi()
    const admin = await adminApi.login(adminLogin)

    expect(participant).toMatchObject({
      username: 'participant01',
      role: 'participant',
      participantCode: 'P-001',
    })
    expect(admin).toMatchObject({
      username: 'admin',
      role: 'admin',
      participantCode: null,
    })
  })

  it('aborts login before and after the mock transport boundary without storing identity', async () => {
    const beforeApi = new MockAppApi()
    const before = new AbortController()
    before.abort()

    await expect(beforeApi.login(participantLogin, before.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(await beforeApi.getCurrentUser()).toBeNull()
    expect(window.sessionStorage.length).toBe(0)

    const afterApi = new MockAppApi()
    const after = new AbortController()
    const pending = afterApi.login(participantLogin, after.signal)
    after.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(await afterApi.getCurrentUser()).toBeNull()
    expect(window.sessionStorage.length).toBe(0)
  })

  it('stores only the current mock user in the selected browser storage', async () => {
    const api = new MockAppApi()

    await api.login(participantLogin)

    expect(window.sessionStorage.length).toBe(1)
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.key(0)).toContain('mock-user')
    expect(window.sessionStorage.getItem(window.sessionStorage.key(0)!)).not.toContain('research123!')

    await api.login({ ...adminLogin, remember: true })

    expect(window.sessionStorage.length).toBe(0)
    expect(window.localStorage.length).toBe(1)
    expect(window.localStorage.key(0)).toContain('mock-user')
    expect(window.localStorage.getItem(window.localStorage.key(0)!)).not.toContain('research123!')
  })

  it('provides the injected API to consumers', () => {
    const api = new MockAppApi()
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(ApiProvider, { api, children })

    const { result } = renderHook(() => useApi(), { wrapper })

    expect(result.current).toBe(api)
  })

  it('returns the same committed response for a repeated clientTurnId', async () => {
    const api = new MockAppApi()
    await api.login(participantLogin)
    const interview = await api.getCurrentInterview()

    const first = await api.sendMessage(interview.id, 'turn-001', '요즘 혼자 지내는 시간이 많아요.')
    const retried = await api.sendMessage(interview.id, 'turn-001', '다른 내용이어야 합니다.')

    expect(retried).toEqual(first)
    expect(retried.messages).toHaveLength(3)
    expect(retried.messages[retried.messages.length - 2]).toMatchObject({
      role: 'user',
      content: '요즘 혼자 지내는 시간이 많아요.',
    })
  })

  it('returns participant interview data without administrator-only fields', async () => {
    const api = new MockAppApi()
    await api.login(participantLogin)

    const current = await api.getCurrentInterview()
    const committed = await api.sendMessage(current.id, 'participant-safe-turn', '참여자 응답')

    expect(current).toEqual({
      id: 'interview-001',
      status: 'active',
      progress: 50,
      updatedAt: '2026-08-25T09:00:00.000Z',
      messages: [{
        id: 'message-001',
        role: 'assistant',
        content: '안녕하세요. 최근 한 달간 일상을 이야기해 주세요.',
        createdAt: '2026-08-25T09:00:00.000Z',
      }],
    })
    for (const result of [current, committed]) {
      expect(result).not.toHaveProperty('participantCode')
      expect(result).not.toHaveProperty('reviewStatus')
      expect(result).not.toHaveProperty('scorecard')
      expect(result).not.toHaveProperty('participantId')
    }
  })

  it('rejects a cached turn retry after logout and administrator login', async () => {
    const api = new MockAppApi()
    await api.login(participantLogin)
    const interview = await api.getCurrentInterview()
    await api.sendMessage(interview.id, 'turn-after-logout', '첫 응답')
    await api.logout()
    await api.login(adminLogin)

    await expect(api.sendMessage(interview.id, 'turn-after-logout', '재시도')).rejects.toMatchObject({ status: 403 })
  })

  it('rejects a cached turn retry for a disabled participant session', async () => {
    const api = new MockAppApi()
    await api.login(participantLogin)
    const interview = await api.getCurrentInterview()
    await api.sendMessage(interview.id, 'turn-after-disable', '첫 응답')
    await api.login(adminLogin)
    await api.disableParticipant('participant-001')
    window.sessionStorage.setItem('dabom.mock-user', 'participant-001')

    await expect(api.sendMessage(interview.id, 'turn-after-disable', '재시도')).rejects.toMatchObject({ status: 401 })
  })

  it('keeps committed turn retries separate for different interviews', async () => {
    const seed = createMockFixtureState()
    seed.interviews.push({
      ...structuredClone(seed.interviews[0]),
      id: 'interview-002',
      status: 'active',
    })
    const api = new MockAppApi(seed)
    await api.login(participantLogin)

    await api.sendMessage('interview-001', 'shared-turn-id', '첫 인터뷰 응답')
    const second = await api.sendMessage('interview-002', 'shared-turn-id', '두 번째 인터뷰 응답')

    expect(second.id).toBe('interview-002')
    expect(second.messages[1]).toMatchObject({
      role: 'user',
      content: '두 번째 인터뷰 응답',
    })
  })

  it('isolates all mutations between instances built from the same fixture seed', async () => {
    const seed = createMockFixtureState()
    const changed = new MockAppApi(seed)
    const untouched = new MockAppApi(seed)

    await changed.login(adminLogin)
    await changed.createParticipant({
      username: 'participant02',
      participantCode: 'P-002',
      password: 'temporary123!',
    })
    await changed.reviewScorecard({
      interviewId: 'interview-001',
      questionId: 'q1',
      action: 'override',
      expertStatus: 'negative',
      rationale: '변경 인스턴스 검토',
    })
    await changed.login(participantLogin)
    await changed.sendMessage('interview-001', 'isolated-turn', '변경 인스턴스 응답')
    await changed.changePassword('research123!', 'changed-password!')

    await untouched.login(adminLogin)
    expect(await untouched.listParticipants()).toHaveLength(1)
    const untouchedInterview = await untouched.getInterview('interview-001')
    expect(untouchedInterview.messages).toHaveLength(1)
    expect(untouchedInterview.reviewStatus).toBe('unreviewed')
    expect(untouchedInterview.scorecard[0]).toMatchObject({
      expertStatus: null,
      expertRationale: null,
    })
    await untouched.logout()
    await expect(untouched.login(participantLogin)).resolves.toMatchObject({ role: 'participant' })
  })

  it('creates a participant with a unique participant code', async () => {
    const api = new MockAppApi()
    await api.login(adminLogin)

    const created = await api.createParticipant({
      username: 'participant02',
      participantCode: 'P-002',
      password: 'temporary123!',
    })

    expect(created).toMatchObject({
      username: 'participant02',
      participantCode: 'P-002',
      status: 'active',
      interviewStatus: 'not_started',
    })
    await expect(api.createParticipant({
      username: 'duplicate-code',
      participantCode: 'P-002',
      password: 'temporary123!',
    })).rejects.toMatchObject({ status: 409 })
  })

  it('resets a password without marking it for forced change', async () => {
    const api = new MockAppApi()
    await api.login(adminLogin)
    const participant = (await api.listParticipants())[0]

    const result = await api.resetParticipantPassword(participant.id)

    expect(result.assignedPassword).toBe('reset-P-001-password')
    await api.logout()
    await expect(api.login({
      username: 'participant01',
      password: result.assignedPassword,
      remember: false,
    })).resolves.toMatchObject({ role: 'participant' })
  })

  it('keeps created and reset plaintext passwords out of runtime account records', async () => {
    const api = new MockAppApi()
    await api.login(adminLogin)
    const createdPassword = 'created-password-123!'
    const created = await api.createParticipant({
      username: 'participant02',
      participantCode: 'P-002',
      password: createdPassword,
    })

    const state = (api as unknown as { state: { accounts: Array<Record<string, unknown>> } }).state
    expect(state.accounts.find((account) => account.id === created.id)).not.toHaveProperty('password')
    expect(JSON.stringify(state)).not.toContain(createdPassword)

    const reset = await api.resetParticipantPassword('participant-001')
    expect(JSON.stringify(state)).not.toContain(reset.assignedPassword)
    await api.logout()
    await expect(api.login({ username: 'participant02', password: createdPassword, remember: false }))
      .resolves.toMatchObject({ id: created.id })
    await api.logout()
    await expect(api.login({ username: 'participant01', password: reset.assignedPassword, remember: false }))
      .resolves.toMatchObject({ id: 'participant-001' })
  })

  it('disables a participant account', async () => {
    const api = new MockAppApi()
    await api.login(adminLogin)
    const participant = (await api.listParticipants())[0]

    const disabled = await api.disableParticipant(participant.id)

    expect(disabled.status).toBe('disabled')
    await api.logout()
    await expect(api.login(participantLogin)).rejects.toMatchObject({ status: 401 })
  })

  it('unlocks an administrator-locked participant account', async () => {
    const seed = createMockFixtureState()
    seed.accounts[0].status = 'admin_locked'
    const api = new MockAppApi(seed)
    await api.login(adminLogin)

    const unlocked = await api.unlockParticipant(seed.accounts[0].id)

    expect(unlocked.status).toBe('active')
    await api.logout()
    await expect(api.login(participantLogin)).resolves.toMatchObject({ role: 'participant' })
  })

  it('rejects participant access to administrator methods', async () => {
    const api = new MockAppApi()
    await api.login(participantLogin)

    await expect(api.listParticipants()).rejects.toBeInstanceOf(ApiError)
    await expect(api.listParticipants()).rejects.toMatchObject({ status: 403 })
    await expect(api.listInterviews()).rejects.toMatchObject({ status: 403 })
  })

  it('derives review state across every row and approves recorded decisions', async () => {
    const api = new MockAppApi()
    await api.login(adminLogin)
    const interview = await api.getInterview('interview-001')

    const reviewed = await api.reviewScorecard({
      interviewId: interview.id,
      questionId: 'q1',
      action: 'override',
      expertStatus: 'negative',
      rationale: '전문가 재검토',
    })

    expect(reviewed.reviewStatus).toBe('in_review')
    expect(reviewed.scorecard.find((row) => row.questionId === 'q1')).toMatchObject({
      expertStatus: 'negative',
      expertRationale: '전문가 재검토',
    })

    const completed = await api.reviewScorecard({
      interviewId: interview.id,
      questionId: 'q2',
      action: 'approve',
    })

    expect(completed.reviewStatus).toBe('reviewed')
    expect(completed.scorecard.find((row) => row.questionId === 'q2')).toMatchObject({
      aiStatus: 'recorded',
      expertStatus: 'recorded',
    })
    expect((await api.listInterviews())[0].reviewStatus).toBe('reviewed')
  })

  it('rejects overrides for recorded or unchanged AI decisions', async () => {
    const api = new MockAppApi()
    await api.login(adminLogin)

    await expect(api.reviewScorecard({
      interviewId: 'interview-001',
      questionId: 'q2',
      action: 'override',
      expertStatus: 'negative',
      rationale: '기록 문항 변경 시도',
    })).rejects.toMatchObject({ status: 400 })
    await expect(api.reviewScorecard({
      interviewId: 'interview-001',
      questionId: 'q1',
      action: 'override',
      expertStatus: 'positive',
      rationale: '같은 판정 변경 시도',
    })).rejects.toMatchObject({ status: 400 })
  })

  it('rejects all review actions for null AI rows and excludes them from status', async () => {
    const seed = createMockFixtureState()
    seed.interviews[0].scorecard.push({
      questionId: 'q3',
      question: 'AI 판정이 없는 문항',
      value: null,
      rationale: null,
      aiStatus: null,
      expertStatus: null,
      expertRationale: null,
    })
    const api = new MockAppApi(seed)
    await api.login(adminLogin)

    await expect(api.reviewScorecard({
      interviewId: 'interview-001',
      questionId: 'q3',
      action: 'approve',
    })).rejects.toMatchObject({ status: 400 })
    await expect(api.reviewScorecard({
      interviewId: 'interview-001',
      questionId: 'q3',
      action: 'override',
      expertStatus: 'negative',
      rationale: '허용되면 안 됨',
    })).rejects.toMatchObject({ status: 400 })

    await api.reviewScorecard({
      interviewId: 'interview-001',
      questionId: 'q1',
      action: 'approve',
    })
    const reviewed = await api.reviewScorecard({
      interviewId: 'interview-001',
      questionId: 'q2',
      action: 'approve',
    })

    expect(reviewed.reviewStatus).toBe('reviewed')
    expect(reviewed.scorecard.find((row) => row.questionId === 'q3')?.expertStatus).toBeNull()
  })

  it('exports a deterministic interview CSV blob', async () => {
    const api = new MockAppApi()
    await api.login(adminLogin)

    const first = await (await api.exportInterviewCsv('interview-001')).text()
    const second = await (await api.exportInterviewCsv('interview-001')).text()

    expect(second).toBe(first)
    expect(first).toBe(
      'interviewId,participantCode,status,progress,reviewStatus,questionId,question,value,aiStatus,expertStatus,expertRationale\n' +
      'interview-001,P-001,active,50,unreviewed,q1,최근 한 달간 혼자 지내는 시간이 얼마나 되었나요?,하루 대부분,positive,,\n' +
      'interview-001,P-001,active,50,unreviewed,q2,도움을 요청할 수 있는 사람이 있나요?,한 명 있습니다,recorded,,'
    )
  })
})
