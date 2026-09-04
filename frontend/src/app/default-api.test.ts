import { beforeEach, describe, expect, it } from 'vitest'

import { createDefaultApi } from './default-api'
import { mockCredentials } from '@/mocks/fixtures'

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

describe('createDefaultApi', () => {
  beforeEach(() => {
    Object.defineProperties(window, {
      localStorage: { configurable: true, value: createStorage() },
      sessionStorage: { configurable: true, value: createStorage() },
    })
  })

  it('keeps the fixture application available only when mock mode is explicit', async () => {
    const api = createDefaultApi('mock')

    await expect(api.login({
      ...mockCredentials.participant,
      remember: false,
    })).resolves.toMatchObject({
      role: 'participant',
      username: 'participant01',
    })
    await expect(api.getCurrentInterview()).resolves.toMatchObject({
      id: 'interview-001',
    })
  })
})
