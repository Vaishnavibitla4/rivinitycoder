import { atom } from 'nanostores';
import type { CoolifyConnection, CoolifyUser } from '~/types/coolify';
import { logStore } from './logs';
import { toast } from 'react-toastify';

// Initialize with stored connection or environment variables
const storedConnection = typeof window !== 'undefined' ? localStorage.getItem('coolify_connection') : null;
const envToken = import.meta.env.VITE_COOLIFY_API_TOKEN;
const envInstanceUrl = import.meta.env.VITE_COOLIFY_INSTANCE_URL || '';

const initialConnection: CoolifyConnection = storedConnection
  ? JSON.parse(storedConnection)
  : {
      user: null,
      token: envToken || '',
      instanceUrl: envInstanceUrl,
      stats: undefined,
    };

export const coolifyConnection = atom<CoolifyConnection>(initialConnection);
export const isConnecting = atom<boolean>(false);
export const isFetchingStats = atom<boolean>(false);

/**
 * Auto-initialise from env vars if we have a token + instanceUrl but no user yet.
 */
export async function initializeCoolifyConnection() {
  const currentState = coolifyConnection.get();

  if (currentState.user || !envToken || !envInstanceUrl) {
    return;
  }

  try {
    isConnecting.set(true);

    const baseUrl = envInstanceUrl.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/api/v1/profile`, {
      headers: {
        Authorization: `Bearer ${envToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to connect to Coolify: ${response.statusText}`);
    }

    const userData = (await response.json()) as CoolifyUser;

    const connectionData: Partial<CoolifyConnection> = {
      user: userData,
      token: envToken,
      instanceUrl: envInstanceUrl,
    };

    localStorage.setItem('coolify_connection', JSON.stringify(connectionData));
    updateCoolifyConnection(connectionData);

    await fetchCoolifyStats(envToken, envInstanceUrl);
  } catch (error) {
    console.error('Error initialising Coolify connection:', error);
    logStore.logError('Failed to initialise Coolify connection', { error });
  } finally {
    isConnecting.set(false);
  }
}

export const updateCoolifyConnection = (updates: Partial<CoolifyConnection>) => {
  const currentState = coolifyConnection.get();
  const newState = { ...currentState, ...updates };
  coolifyConnection.set(newState);

  if (typeof window !== 'undefined') {
    localStorage.setItem('coolify_connection', JSON.stringify(newState));
  }
};

export async function fetchCoolifyStats(token: string, instanceUrl: string) {
  try {
    isFetchingStats.set(true);

    const baseUrl = instanceUrl.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/api/v1/applications`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Coolify applications: ${response.status}`);
    }

    const apps = (await response.json()) as any[];
    const sites = apps.map((app: any) => ({
      id: String(app.id),
      uuid: app.uuid || String(app.id),
      name: app.name || 'Unnamed App',
      fqdn: app.fqdn,
      domains: app.fqdn ? [app.fqdn] : [],
      status: app.status,
    }));

    const currentState = coolifyConnection.get();
    updateCoolifyConnection({
      ...currentState,
      stats: {
        sites,
        totalSites: sites.length,
      },
    });
  } catch (error) {
    console.error('Coolify API Error:', error);
    logStore.logError('Failed to fetch Coolify stats', { error });
    toast.error('Failed to fetch Coolify statistics');
  } finally {
    isFetchingStats.set(false);
  }
}
