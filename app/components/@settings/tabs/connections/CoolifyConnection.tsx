import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';
import { useStore } from '@nanostores/react';
import { logStore } from '~/lib/stores/logs';
import { classNames } from '~/utils/classNames';
import {
  coolifyConnection,
  isConnecting,
  isFetchingStats,
  updateCoolifyConnection,
  fetchCoolifyStats,
} from '~/lib/stores/coolify';

export default function CoolifyConnection() {
  const connection = useStore(coolifyConnection);
  const connecting = useStore(isConnecting);
  const fetchingStats = useStore(isFetchingStats);
  const [isSitesExpanded, setIsSitesExpanded] = useState(false);
  const [localInstanceUrl] = useState('http://localhost:8000');
  const [localToken] = useState('local-dev-token');

  // Fetch stats on mount if already connected
  useEffect(() => {
    if (connection.user && connection.token && connection.instanceUrl) {
      fetchCoolifyStats(connection.token, connection.instanceUrl);
    }
  }, [connection.user, connection.token, connection.instanceUrl]);

  const handleConnect = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!localInstanceUrl) {
      toast.error('Please enter your Coolify instance URL');
      return;
    }

    if (!localToken) {
      toast.error('Please enter your Coolify API token');
      return;
    }

    isConnecting.set(true);

    try {
      // Bypass the profile fetch since we are defaulting to local / no token
      const userData = {
        id: 'local',
        name: 'Local Coolify User',
        email: 'local@localhost'
      };

      updateCoolifyConnection({
        user: {
          id: String(userData.id),
          name: userData.name || 'Coolify User',
          email: userData.email || '',
        },
        token: localToken,
        instanceUrl: localInstanceUrl,
      });

      await fetchCoolifyStats(localToken, localInstanceUrl);
      toast.success('Successfully connected to Coolify! 🎉');
    } catch (error) {
      console.error('Coolify auth error:', error);
      logStore.logError('Failed to authenticate with Coolify', { error });
      toast.error(error instanceof Error ? error.message : 'Failed to connect to Coolify');
      updateCoolifyConnection({ user: null });
    } finally {
      isConnecting.set(false);
    }
  };

  const handleDisconnect = () => {
    updateCoolifyConnection({ user: null, token: '', instanceUrl: '' });
    toast.success('Disconnected from Coolify');
  };

  const handleRefreshStats = async () => {
    if (connection.token && connection.instanceUrl) {
      await fetchCoolifyStats(connection.token, connection.instanceUrl);
    }
  };

  return (
    <motion.div
      className="bg-[#FFFFFF] dark:bg-[#0A0A0A] rounded-lg border border-[#E5E5E5] dark:border-[#1A1A1A]"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35 }}
    >
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Coolify logo — using a simple rocket icon since it's self-hosted */}
            <div className="w-5 h-5 rounded bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
              <div className="i-ph:rocket-launch w-3 h-3 text-white" />
            </div>
            <h3 className="text-base font-medium text-bolt-elements-textPrimary">Coolify Connection</h3>
          </div>
          <span className="text-xs text-bolt-elements-textTertiary bg-bolt-elements-background-depth-2 px-2 py-1 rounded">
            Self-hosted
          </span>
        </div>

        <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">
          Connect to your self-hosted{' '}
          <a
            href="https://coolify.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-bolt-elements-borderColorActive hover:underline"
          >
            Coolify
          </a>{' '}
          instance to deploy apps with a real public URL — no SaaS accounts required.
        </p>

        {!connection.user ? (
          /* ── Connect Form ── */
          <div className="space-y-4">
            <div className="p-4 bg-[#F8F8F8] dark:bg-[#1A1A1A] rounded-lg border border-[#E5E5E5] dark:border-[#333333]">
              <p className="text-sm text-bolt-elements-textPrimary font-medium mb-1">Local Deployment Mode</p>
              <p className="text-xs text-bolt-elements-textSecondary">
                Coolify will target <span className="font-mono bg-bolt-elements-background-depth-2 px-1 rounded">http://localhost:8000</span> automatically. No API token is required for local dev setups.
              </p>
            </div>

            <button
              onClick={handleConnect}
              disabled={connecting}
              className={classNames(
                'px-4 py-2 rounded-lg text-sm flex items-center gap-2',
                'bg-purple-600 text-white',
                'hover:bg-purple-700',
                'disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200',
                'transform active:scale-95',
              )}
            >
              {connecting ? (
                <>
                  <div className="i-ph:spinner-gap animate-spin w-4 h-4" />
                  Enabling...
                </>
              ) : (
                <>
                  <div className="i-ph:plug-charging w-4 h-4" />
                  Enable Local Coolify Deployment
                </>
              )}
            </button>
          </div>
        ) : (
          /* ── Connected State ── */
          <div className="space-y-6">
            {/* Status + Disconnect row */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleDisconnect}
                  className="px-4 py-2 rounded-lg text-sm flex items-center gap-2 bg-red-500 text-white hover:bg-red-600 transition-colors"
                >
                  <div className="i-ph:plug w-4 h-4" />
                  Disconnect
                </button>
                <span className="text-sm text-bolt-elements-textSecondary flex items-center gap-1">
                  <div className="i-ph:check-circle w-4 h-4 text-green-500" />
                  Connected
                </span>
              </div>
              <button
                onClick={handleRefreshStats}
                disabled={fetchingStats}
                className="text-xs text-bolt-elements-textTertiary flex items-center gap-1 hover:text-bolt-elements-textSecondary transition-colors disabled:opacity-50"
              >
                <div className={classNames('i-ph:arrows-clockwise w-3.5 h-3.5', fetchingStats ? 'animate-spin' : '')} />
                Refresh
              </button>
            </div>

            {/* User card */}
            <div className="flex items-center gap-4 p-4 bg-[#F8F8F8] dark:bg-[#1A1A1A] rounded-lg">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-lg font-bold">
                  {(connection.user?.name || connection.user?.email || 'C').charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-medium text-bolt-elements-textPrimary truncate">
                  {connection.user?.name || 'Coolify User'}
                </h4>
                <p className="text-sm text-bolt-elements-textSecondary truncate">{connection.user?.email}</p>
                <a
                  href={connection.instanceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-bolt-elements-borderColorActive hover:underline flex items-center gap-1 mt-1"
                >
                  <div className="i-ph:link w-3 h-3" />
                  {connection.instanceUrl}
                </a>
              </div>
            </div>

            {/* Deployed apps list */}
            {fetchingStats ? (
              <div className="flex items-center gap-2 text-sm text-bolt-elements-textSecondary">
                <div className="i-ph:spinner-gap w-4 h-4 animate-spin" />
                Loading deployed apps...
              </div>
            ) : (
              <div>
                <button
                  onClick={() => setIsSitesExpanded(!isSitesExpanded)}
                  className="w-full bg-transparent text-left text-sm font-medium text-bolt-elements-textPrimary mb-3 flex items-center gap-2"
                >
                  <div className="i-ph:rocket-launch w-4 h-4" />
                  Your Deployed Apps ({connection.stats?.totalSites ?? 0})
                  <div
                    className={classNames(
                      'i-ph:caret-down w-4 h-4 ml-auto transition-transform',
                      isSitesExpanded ? 'rotate-180' : '',
                    )}
                  />
                </button>

                {isSitesExpanded && (
                  <>
                    {connection.stats?.sites && connection.stats.sites.length > 0 ? (
                      <div className="grid gap-3">
                        {connection.stats.sites.map((site) => (
                          <div
                            key={site.uuid}
                            className="p-4 rounded-lg border border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <h5 className="text-sm font-medium text-bolt-elements-textPrimary flex items-center gap-2 truncate">
                                  <div className="i-ph:globe w-4 h-4 text-bolt-elements-borderColorActive flex-shrink-0" />
                                  {site.name}
                                </h5>
                                {site.fqdn && (
                                  <a
                                    href={site.fqdn.startsWith('http') ? site.fqdn : `https://${site.fqdn}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-bolt-elements-textTertiary hover:text-bolt-elements-borderColorActive mt-1 flex items-center gap-1"
                                  >
                                    <div className="i-ph:arrow-square-out w-3 h-3" />
                                    {site.fqdn}
                                  </a>
                                )}
                              </div>
                              {site.status && (
                                <span
                                  className={classNames(
                                    'text-xs px-2 py-0.5 rounded-full flex-shrink-0',
                                    site.status === 'running'
                                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                      : site.status === 'stopped'
                                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
                                  )}
                                >
                                  {site.status}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-bolt-elements-textSecondary flex items-center gap-2">
                        <div className="i-ph:info w-4 h-4" />
                        No apps deployed yet. Generate a project and click Deploy → Coolify!
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
