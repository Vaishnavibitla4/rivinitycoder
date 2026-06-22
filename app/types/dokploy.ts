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

/*
 * Response shape returned by /api/dokploy-deploy after switching to
 * application.dropDeployment + application.redeploy.
 */
export interface DokployDeployResponse {
  success: boolean;
  applicationId: string;
  appName: string;
  url: string; // the real, reachable deployed app URL (traefik.me domain)
  redeployed: boolean; // false on first deploy, true on subsequent redeploys
  error?: string;
}
