import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'

import { ApiProvider, useApi } from '../app/api-context'
import { ApiError, MockAppApi } from './mock-api'

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

  it('logs in the participant and admin fixtures', async () => {
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

  it('disables a participant account', async () => {
    const api = new MockAppApi()
    await api.login(adminLogin)
    const participant = (await api.listParticipants())[0]

    const disabled = await api.disableParticipant(participant.id)

    expect(disabled.status).toBe('disabled')
    await api.logout()
    await expect(api.login(participantLogin)).rejects.toMatchObject({ status: 401 })
  })

  it('rejects participant access to administrator methods', async () => {
    const api = new MockAppApi()
    await api.login(participantLogin)

    await expect(api.listParticipants()).rejects.toBeInstanceOf(ApiError)
    await expect(api.listParticipants()).rejects.toMatchObject({ status: 403 })
    await expect(api.listInterviews()).rejects.toMatchObject({ status: 403 })
  })

  it('updates a scorecard review in the administrator fixture', async () => {
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

    expect(reviewed.reviewStatus).toBe('reviewed')
    expect(reviewed.scorecard.find((row) => row.questionId === 'q1')).toMatchObject({
      expertStatus: 'negative',
      expertRationale: '전문가 재검토',
    })
  })

  it('exports a deterministic interview CSV blob', async () => {
    const api = new MockAppApi()
    await api.login(adminLogin)

    const first = await (await api.exportInterviewCsv('interview-001')).text()
    const second = await (await api.exportInterviewCsv('interview-001')).text()

    expect(second).toBe(first)
    expect(first).toBe(
      'interviewId,participantCode,status,progress,reviewStatus,questionId,question,value,aiStatus,expertStatus,expertRationale\n' +
      'interview-001,P-001,completed,100,unreviewed,q1,최근 한 달간 혼자 지내는 시간이 얼마나 되었나요?,하루 대부분,positive,,\n' +
      'interview-001,P-001,completed,100,unreviewed,q2,도움을 요청할 수 있는 사람이 있나요?,한 명 있습니다,recorded,,'
    )
  })
})
