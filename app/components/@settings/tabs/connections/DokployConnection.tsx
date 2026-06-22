// app/components/@settings/tabs/connections/DokployConnection.tsx

import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { useStore } from '@nanostores/react';
import {
  dokployConnection,
  isConnecting,
  updateDokployConnection,
  connectToDokploy,
  fetchDokployStats,
} from '~/lib/stores/dokploy';

export default function DokployConnection() {
  const connection = useStore(dokployConnection);
  const connecting = useStore(isConnecting);
  const [instanceUrl, setInstanceUrl] = useState(connection.instanceUrl || 'http://127.0.0.1:3000');
  const [token, setToken] = useState(connection.token || '');

  useEffect(() => {
    if (connection.user && connection.token && connection.instanceUrl) {
      fetchDokployStats(connection.token, connection.instanceUrl);
    }
  }, []);

  const handleConnect = async () => {
    if (!instanceUrl || !token) {
      toast.error('Please fill in both fields');
      return;
    }

    isConnecting.set(true);

    try {
      const userData = await connectToDokploy(token, instanceUrl);
      updateDokployConnection({ user: userData, token, instanceUrl });
      await fetchDokployStats(token, instanceUrl);
      toast.success('Connected to Dokploy! 🎉');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect');
      updateDokployConnection({ user: null });
    } finally {
      isConnecting.set(false);
    }
  };

  const handleDisconnect = () => {
    updateDokployConnection({ user: null, token: '', instanceUrl: '' });
    toast.success('Disconnected from Dokploy');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConnect();
    }
  };

  if (connection.user) {
    return (
      <div className="p-4 border border-bolt-elements-borderColor rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-bolt-elements-textPrimary">Connected to Dokploy</span>
          <button onClick={handleDisconnect} className="text-xs text-red-500 hover:underline">
            Disconnect
          </button>
        </div>
        <p className="text-sm text-bolt-elements-textSecondary">{connection.instanceUrl}</p>
        {connection.stats && (
          <p className="text-xs text-bolt-elements-textTertiary mt-1">{connection.stats.totalSites} app(s) deployed</p>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 border border-bolt-elements-borderColor rounded-lg space-y-3">
      <h3 className="font-medium text-bolt-elements-textPrimary">Connect to Dokploy</h3>
      <div>
        <label className="block text-xs text-bolt-elements-textSecondary mb-1">Instance URL</label>
        <input
          value={instanceUrl}
          onChange={(e) => setInstanceUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="http://127.0.0.1:3000"
          className="w-full px-3 py-2 text-sm bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor rounded"
        />
      </div>
      <div>
        <label className="block text-xs text-bolt-elements-textSecondary mb-1">API Token</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Dokploy Settings → Profile → API/CLI"
          className="w-full px-3 py-2 text-sm bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor rounded"
        />
      </div>
      <button
        type="button"
        disabled={connecting}
        onClick={handleConnect}
        className="w-full py-2 text-sm bg-accent-500 text-white rounded hover:bg-accent-600 disabled:opacity-60"
      >
        {connecting ? 'Connecting...' : 'Connect'}
      </button>
    </div>
  );
}
