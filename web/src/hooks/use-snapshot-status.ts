'use client'

import { useState, useEffect, useCallback } from 'react'

/** /api/v1/stock-ranking/status 응답 형태 */
interface SnapshotStatus {
  updating: boolean
  last_updated: string | null
}

/**
 * 스냅샷 갱신 상태를 주기적으로 폴링하는 훅.
 * enabled가 true일 때 intervalMs마다 상태를 재조회한다.
 *
 * @param enabled   폴링 활성화 여부 (기본값: true)
 * @param intervalMs 폴링 주기(ms) (기본값: 30000)
 */
export function useSnapshotStatus(enabled: boolean = true, intervalMs: number = 30000) {
  const [status, setStatus] = useState<SnapshotStatus>({ updating: false, last_updated: null })

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/stock-ranking/status')
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
      }
    } catch {
      // 네트워크 오류는 무시하고 이전 상태 유지
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    fetchStatus()
    const id = setInterval(fetchStatus, intervalMs)
    return () => clearInterval(id)
  }, [enabled, intervalMs, fetchStatus])

  return status
}
