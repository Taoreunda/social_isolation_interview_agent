import type { AppApi } from './contracts'
import { HttpAppApi } from './http-api'
import { MockAppApi } from '@/mocks/mock-api'

export function createDefaultApi(mode = import.meta.env.VITE_APP_MODE): AppApi {
  return mode === 'mock' ? new MockAppApi() : new HttpAppApi()
}
