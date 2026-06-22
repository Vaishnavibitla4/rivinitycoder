// app/lib/stores/dokploy.ts

import { atom } from 'nanostores';
import type { DokployConnection, DokployUser } from '~/types/dokploy';
import { logStore } from './logs';
import { toast } from 'react-toastify';

const storedConnection = typeof window !== 'undefined' ? localStorage.getItem('dokploy_connection') : null;

const envToken = import.meta.env.VITE_DOKPLOY_API_TOKEN;
const envInstanceUrl = import.meta.env.VITE_DOKPLOY_INSTANCE_URL || '';

const initialConnection: DokployConnection = storedConnection
  ? JSON.parse(storedConnection)
  : { user: null, token: envToken || '', instanceUrl: envInstanceUrl };

export const dokployConnection = atom<DokployConnection>(initialConnection);
export const isConnecting = atom<boolean>(false);
export const isFetchingStats = atom<boolean>(false);

export const updateDokployConnection = (updates: Partial<DokployConnection>) => {
  const newState = { ...dokployConnection.get(), ...updates };
  dokployConnection.set(newState);

  if (typeof window !== 'undefined') {
    localStorage.setItem('dokploy_connection', JSON.stringify(newState));
  }
};

/*
 * Bug fix: route through /api/dokploy-connect (server-side) to avoid CORS block.
 * The browser cannot directly fetch http://localhost:3000 from a different origin.
 */
export async function connectToDokploy(token: string, instanceUrl: string): Promise<DokployUser> {
  const res = await fetch('/api/dokploy-connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, instanceUrl, action: 'connect' }),
  });

  const data = (await res.json()) as any;

  if (!res.ok) {
    throw new Error(data.error || `Connection failed (${res.status})`);
  }

  return data.user as DokployUser;
}

export async function fetchDokployStats(token: string, instanceUrl: string) {
  try {
    isFetchingStats.set(true);

    const res = await fetch('/api/dokploy-connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, instanceUrl, action: 'stats' }),
    });

    const data = (await res.json()) as any;

    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch stats');
    }

    const sites = (data.apps as any[]).map((app: any) => ({
      id: app.applicationId,
      name: app.name,
      appName: app.appName,
      domains: app.domains?.map((d: any) => d.host) ?? [],
      status: app.applicationStatus,
    }));

    updateDokployConnection({ stats: { sites, totalSites: sites.length } });
  } catch (error) {
    logStore.logError('Failed to fetch Dokploy stats', { error });
    toast.error('Failed to fetch Dokploy apps');
  } finally {
    isFetchingStats.set(false);
  }
}
