'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createTabLeaderElection } from '@/lib/client/tabLeaderElection';

/**
 * React hook for cross-tab leader election.
 *
 * When USE_CROSS_TAB_LIVE_LEADER feature flag is OFF, this hook always
 * returns isLeader=true (every tab is independent — legacy behavior).
 *
 * @param {string} channelName - Unique channel name, e.g. 'live-orders'
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true] - Set to false to disable election
 * @returns {{ isLeader: boolean, broadcast: (data: any) => void, onData: (cb: Function) => Function }}
 */
export function useTabLeaderElection(channelName, { enabled = true } = {}) {
  const [isLeader, setIsLeader] = useState(true); // default true for SSR / disabled
  const electionRef = useRef(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setIsLeader(true);
      return;
    }

    const election = createTabLeaderElection(channelName);
    electionRef.current = election;

    // Poll isLeader state (the election mutates internally)
    const interval = setInterval(() => {
      if (election.isLeader !== isLeader) {
        setIsLeader(election.isLeader);
      }
    }, 500);

    // Initial sync
    setIsLeader(election.isLeader);

    return () => {
      clearInterval(interval);
      election.destroy();
      electionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, enabled]);

  const broadcast = useCallback((data) => {
    electionRef.current?.broadcast(data);
  }, []);

  const onData = useCallback((callback) => {
    if (!electionRef.current) return () => {};
    return electionRef.current.onData(callback);
  }, []);

  return { isLeader, broadcast, onData };
}
