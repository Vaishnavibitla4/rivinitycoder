export interface CoolifyUser {
  id: string;
  uuid?: string;
  name: string;
  email: string;
}

export interface CoolifySite {
  id: string;
  uuid: string;
  name: string;
  fqdn?: string;
  domains: string[];
  status?: string;
}

export interface CoolifyStats {
  sites: CoolifySite[];
  totalSites: number;
}

export interface CoolifyConnection {
  user: CoolifyUser | null;
  token: string;
  instanceUrl: string;
  stats?: CoolifyStats;
}

export interface CoolifyDeployResponse {
  site: {
    id: string;
    uuid: string;
    name: string;
    fqdn?: string;
  };
  deploy: {
    id: string;
    url: string;
  };
}
