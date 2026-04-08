'use client';

import { useState, useCallback } from 'react';

interface UseBatchRefreshOptions {
  onCompleted?: () => void;
}

export function useBatchRefresh({ onCompleted }: UseBatchRefreshOptions = {}) {
  const [isRunning, setIsRunning] = useState(false);

  const trigger = useCallback(async () => {
    setIsRunning(true);
    try {
      await fetch('/api/v1/prices/refresh', { method: 'POST' });
      onCompleted?.();
    } finally {
      setIsRunning(false);
    }
  }, [onCompleted]);

  return { trigger, isRunning };
}
