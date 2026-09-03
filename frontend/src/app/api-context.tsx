import { createContext, useContext, type ReactNode } from 'react'

import type { AppApi } from './contracts'

const ApiContext = createContext<AppApi | null>(null)

interface ApiProviderProps {
  api: AppApi
  children: ReactNode
}

export function ApiProvider({ api, children }: ApiProviderProps): ReactNode {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
}

export function useApi(): AppApi {
  const api = useContext(ApiContext)
  if (!api) throw new Error('useApi must be used within an ApiProvider')
  return api
}
