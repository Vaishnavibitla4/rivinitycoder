// app/lib/stores/dokploy.ts

import { atom } from 'nanostores';
import type { DokployConnection, DokployUser } from '~/types/dokploy';
import { logStore } from './logs';
import { toast } from 'react-toastify';

const storedConnection = typeof window !== 'undefined' ? localStorage.getItem('dokploy_connection') : null;

const envToken = import.meta.env.VITE_DOKPLOY_API_TOKEN;
const envInstanceUrl = import.meta.env.VITE_DOKPLOY_INSTANCE_URL || '';

console.log({
  storedConnection,
  envToken,
  envInstanceUrl,
});

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

export async function connectToDokploy(token: string, instanceUrl: string) {
  const baseUrl = instanceUrl.replace(/\/$/, '');
  // Dokploy auth check — GET /api/auth.get with token in header
  const res = await fetch(`${baseUrl}/api/user.get`, {
    headers: { 'x-api-key': token },
  });

  if (!res.ok) throw new Error(`Auth failed: ${res.statusText}`);

  const userData = (await res.json()) as DokployUser;
  return userData;
}

export async function fetchDokployStats(token: string, instanceUrl: string) {
  try {
    isFetchingStats.set(true);
    const baseUrl = instanceUrl.replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/api/application.all`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch apps: ${res.status}`);

    const apps = (await res.json()) as any[];
    const sites = apps.map((app: any) => ({
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
