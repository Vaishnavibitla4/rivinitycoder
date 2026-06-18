// app/types/dokploy.ts

export interface DokployUser {
  id: string;
  email: string;
}

export interface DokploySite {
  id: string;
  name: string;
  appName: string; // Dokploy's unique app slug, used in URLs
  domains: string[];
  status?: string;
}

export interface DokployStats {
  sites: DokploySite[];
  totalSites: number;
}

export interface DokployConnection {
  user: DokployUser | null;
  token: string;
  instanceUrl: string; // e.g. http://localhost:3000
  stats?: DokployStats;
}

export interface DokployDeployResponse {
  site: {
    id: string;
    appName: string;
    name: string;
  };
  deploy: {
    id: string;
    url: string;
  };
}
