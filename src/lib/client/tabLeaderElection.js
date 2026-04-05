/**
 * Cross-Tab Leader Election via BroadcastChannel
 *
 * When the owner dashboard is open in multiple tabs, only the LEADER tab
 * should hold Firestore onSnapshot listeners (which are expensive).
 * Other tabs receive realtime updates through the BroadcastChannel relay.
 *
 * Protocol:
 *   1. On mount, tab sends 'CLAIM_LEADER' with a random tabId
 *   2. If no 'LEADER_HEARTBEAT' is received within ELECTION_TIMEOUT_MS,
 *      the tab becomes leader
 *   3. Leader sends 'LEADER_HEARTBEAT' every HEARTBEAT_INTERVAL_MS
 *   4. If a follower stops receiving heartbeats, it calls a new election
 *   5. Leader relays data via 'DATA_UPDATE' messages to followers
 *
 * Usage:
 *   const election = useTabLeaderElection('live-orders');
 *   // election.isLeader → true if this tab should hold listeners
 *   // election.broadcast(data) → send data to follower tabs
 *   // election.onData(callback) → receive data from leader tab
 */

const ELECTION_TIMEOUT_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_STALE_MS = 5000;

function generateTabId() {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a leader election instance for a specific channel/feature.
 * @param {string} channelName - e.g. 'live-orders', 'whatsapp-chat'
 * @returns {{ isLeader: boolean, tabId: string, broadcast: Function, onData: Function, destroy: Function }}
 */
export function createTabLeaderElection(channelName) {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    // SSR or unsupported browser — always act as leader
    return {
      isLeader: true,
      tabId: 'ssr',
      broadcast: () => {},
      onData: () => () => {},
      destroy: () => {},
    };
  }

  const fullChannelName = `servizephyr_leader_${channelName}`;
  const channel = new BroadcastChannel(fullChannelName);
  const tabId = generateTabId();

  let _isLeader = false;
  let _heartbeatInterval = null;
  let _electionTimeout = null;
  let _staleCheckInterval = null;
  let _lastHeartbeatAt = 0;
  let _dataListeners = [];
  let _destroyed = false;

  function _becomeLeader() {
    if (_isLeader || _destroyed) return;
    _isLeader = true;
    console.log(`[TabLeader:${channelName}] 👑 This tab is now the LEADER (${tabId})`);

    // Start heartbeat
    _heartbeatInterval = setInterval(() => {
      if (_destroyed) return;
      channel.postMessage({ type: 'LEADER_HEARTBEAT', tabId, ts: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);

    // Send immediate heartbeat
    channel.postMessage({ type: 'LEADER_HEARTBEAT', tabId, ts: Date.now() });
  }

  function _stepDown() {
    if (!_isLeader) return;
    _isLeader = false;
    if (_heartbeatInterval) {
      clearInterval(_heartbeatInterval);
      _heartbeatInterval = null;
    }
    console.log(`[TabLeader:${channelName}] This tab stepped down from leader (${tabId})`);
  }

  function _startElection() {
    if (_destroyed) return;
    // Send claim
    channel.postMessage({ type: 'CLAIM_LEADER', tabId, ts: Date.now() });

    // Wait for existing leader to respond
    _electionTimeout = setTimeout(() => {
      if (_destroyed) return;
      // No leader responded — become leader
      _becomeLeader();
    }, ELECTION_TIMEOUT_MS);
  }

  // Listen for messages
  channel.onmessage = (event) => {
    if (_destroyed) return;
    const msg = event.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'LEADER_HEARTBEAT':
        if (msg.tabId !== tabId) {
          // Another tab is the leader
          _lastHeartbeatAt = Date.now();
          if (_electionTimeout) {
            clearTimeout(_electionTimeout);
            _electionTimeout = null;
          }
          if (_isLeader) {
            // Two leaders detected — the one with the lower tabId wins
            if (tabId < msg.tabId) {
              // We keep leadership
            } else {
              _stepDown();
            }
          }
        }
        break;

      case 'CLAIM_LEADER':
        if (msg.tabId !== tabId && _isLeader) {
          // We're the leader — respond with heartbeat to prevent their election
          channel.postMessage({ type: 'LEADER_HEARTBEAT', tabId, ts: Date.now() });
        }
        break;

      case 'DATA_UPDATE':
        if (msg.tabId !== tabId) {
          _dataListeners.forEach((fn) => {
            try { fn(msg.payload); } catch (e) { console.warn('[TabLeader] Data listener error:', e); }
          });
        }
        break;
    }
  };

  // Check for stale heartbeats (leader tab closed)
  _staleCheckInterval = setInterval(() => {
    if (_destroyed || _isLeader) return;
    if (_lastHeartbeatAt > 0 && Date.now() - _lastHeartbeatAt > HEARTBEAT_STALE_MS) {
      console.log(`[TabLeader:${channelName}] Leader heartbeat stale — starting new election`);
      _lastHeartbeatAt = 0;
      _startElection();
    }
  }, HEARTBEAT_STALE_MS);

  // Start initial election
  _startElection();

  return {
    get isLeader() { return _isLeader; },
    tabId,

    /** Leader sends data to all follower tabs */
    broadcast(payload) {
      if (!_isLeader || _destroyed) return;
      channel.postMessage({ type: 'DATA_UPDATE', tabId, payload, ts: Date.now() });
    },

    /** Follower subscribes to data from the leader. Returns unsubscribe function. */
    onData(callback) {
      if (typeof callback !== 'function') return () => {};
      _dataListeners.push(callback);
      return () => {
        _dataListeners = _dataListeners.filter((fn) => fn !== callback);
      };
    },

    /** Cleanup on unmount */
    destroy() {
      _destroyed = true;
      if (_heartbeatInterval) clearInterval(_heartbeatInterval);
      if (_electionTimeout) clearTimeout(_electionTimeout);
      if (_staleCheckInterval) clearInterval(_staleCheckInterval);
      _dataListeners = [];
      try { channel.close(); } catch {}
    },
  };
}
