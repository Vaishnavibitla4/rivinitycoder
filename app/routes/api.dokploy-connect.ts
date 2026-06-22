// app/routes/api.dokploy-connect.ts

import { type ActionFunctionArgs } from '@remix-run/cloudflare';

interface ConnectBody {
  token: string;
  instanceUrl: string;
  action: 'connect' | 'stats';
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { token, instanceUrl, action } = (await request.json()) as ConnectBody;

    if (!token) {
      return Response.json({ error: 'No API token provided.' }, { status: 401 });
    }

    if (!instanceUrl) {
      return Response.json({ error: 'Instance URL is required.' }, { status: 400 });
    }

    const baseUrl = instanceUrl.replace(/\/$/, '');

    // Dokploy API uses x-api-key header (confirmed from official docs)
    const headers = { 'x-api-key': token, 'Content-Type': 'application/json' };

    if (action === 'connect') {
      /*
       * auth.get does not exist in Dokploy's API.
       * Use project.all as the token verification call — it's the simplest
       * authenticated endpoint. 401 = bad token, 200 = valid token.
       */
      const res = await fetch(`${baseUrl}/api/project.all`, { headers });

      if (res.status === 401 || res.status === 403) {
        return Response.json({ error: 'Invalid API token.' }, { status: 401 });
      }

      if (!res.ok) {
        return Response.json({ error: `Dokploy returned ${res.status}: ${res.statusText}` }, { status: res.status });
      }

      /*
       * project.all succeeded — token is valid.
       * Return a minimal user object so the store has something to set.
       * We don't have the user's email from this endpoint, so use a placeholder.
       */
      return Response.json({ user: { id: 'connected', email: 'Connected to Dokploy' } });
    }

    if (action === 'stats') {
      const res = await fetch(`${baseUrl}/api/application.all`, { headers });

      if (!res.ok) {
        return Response.json({ error: `Failed to fetch apps: ${res.status}` }, { status: res.status });
      }

      const apps = (await res.json()) as any[];

      return Response.json({ apps });
    }

    return Response.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server error';
    console.error('[api.dokploy-connect]', err);

    return Response.json({ error: message }, { status: 500 });
  }
}
