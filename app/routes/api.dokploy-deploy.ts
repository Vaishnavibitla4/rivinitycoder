/*
 * app/routes/api.dokploy-deploy.ts
 *
 * Deploys (or redeploys) a Rivinity-generated app to Dokploy using the
 * native "drop deployment" mechanism — a real ZIP file uploaded as
 * multipart/form-data, no base64 / env-var smuggling involved.
 *
 * First deploy:  project.all/create -> application.create ->
 *                application.update(sourceType:"drop") ->
 *                domain.generateDomain -> domain.create ->
 *                application.dropDeployment -> application.deploy
 *
 * Redeploy:      application.dropDeployment -> application.redeploy
 *                (same applicationId, same domain — just new code)
 */

import { type ActionFunctionArgs } from '@remix-run/cloudflare';

export async function action({ request }: ActionFunctionArgs) {
  try {
    const formData = await request.formData();

    const token = formData.get('token') as string | null;
    const instanceUrlRaw = formData.get('instanceUrl') as string | null;
    const chatId = formData.get('chatId') as string | null;
    const applicationId = formData.get('applicationId') as string | null;
    const zipFile = formData.get('zip') as File | null;

    if (!token) {
      return Response.json({ error: 'No Dokploy API token provided.' }, { status: 401 });
    }

    if (!instanceUrlRaw) {
      return Response.json({ error: 'Dokploy instance URL not configured.' }, { status: 400 });
    }

    if (!chatId) {
      return Response.json({ error: 'No chat id provided.' }, { status: 400 });
    }

    if (!zipFile) {
      return Response.json({ error: 'No zip file provided.' }, { status: 400 });
    }

    /*
     * Dokploy's dropDeployment endpoint has a known bug where uploads larger
     * than ~1MB fail with a generic 500 (Next.js API route bodyParser limit).
     * Fail early with a clear message instead of a cryptic server error.
     */
    const ONE_MB = 1024 * 1024;

    if (zipFile.size > ONE_MB) {
      return Response.json(
        {
          error: `Build output is ${(zipFile.size / ONE_MB).toFixed(1)}MB, which exceeds Dokploy's ~1MB drop-deployment upload limit. Consider reducing bundle size, or use a Git-based deployment instead.`,
        },
        { status: 413 },
      );
    }

    const instanceUrl = instanceUrlRaw.replace(/\/$/, '');
    const jsonHeaders = { 'x-api-key': token, 'Content-Type': 'application/json' };
    const fileHeaders = { 'x-api-key': token }; // no Content-Type — browser/runtime sets multipart boundary

    /*
     * ─────────────────────────────────────────────────────────────────
     * REDEPLOYMENT PATH — applicationId already exists for this chat
     * ─────────────────────────────────────────────────────────────────
     */
    if (applicationId) {
      const dropForm = new FormData();
      dropForm.append('applicationId', applicationId);
      dropForm.append('zip', zipFile, 'site.zip');

      const dropRes = await fetch(`${instanceUrl}/api/trpc/application.dropDeployment`, {
        method: 'POST',
        headers: fileHeaders,
        body: dropForm,
      });

      if (!dropRes.ok) {
        const body = await dropRes.text();
        return Response.json({ error: `Failed to upload zip: ${body}` }, { status: 500 });
      }

      const redeployRes = await fetch(`${instanceUrl}/api/application.redeploy`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ applicationId }),
      });

      if (!redeployRes.ok) {
        const body = await redeployRes.text();
        return Response.json({ error: `Failed to trigger redeploy: ${body}` }, { status: 500 });
      }

      // Look up the existing domain to return the same URL
      const domainsRes = await fetch(`${instanceUrl}/api/domain.byApplicationId?applicationId=${applicationId}`, {
        headers: fileHeaders,
      });
      const domains = domainsRes.ok ? ((await domainsRes.json()) as any[]) : [];
      const host = domains?.[0]?.host;
      const url = host ? `http://${host}` : instanceUrl;

      return Response.json({
        success: true,
        applicationId,
        appName: applicationId,
        url,
        redeployed: true,
      });
    }

    /*
     * ─────────────────────────────────────────────────────────────────
     * FIRST DEPLOY PATH — create everything from scratch
     * ─────────────────────────────────────────────────────────────────
     */

    // 1. Find or create a project + get its environmentId
    const projectsRes = await fetch(`${instanceUrl}/api/project.all`, { headers: fileHeaders });

    if (!projectsRes.ok) {
      return Response.json({ error: 'Failed to list Dokploy projects' }, { status: 400 });
    }

    const projects = (await projectsRes.json()) as any[];

    let environmentId: string | undefined = projects?.[0]?.environments?.[0]?.environmentId;

    if (!environmentId) {
      const createProjRes = await fetch(`${instanceUrl}/api/project.create`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          name: `rivinity-${chatId.slice(0, 8)}`,
          description: 'Created by Rivinity AI',
        }),
      });

      if (!createProjRes.ok) {
        const body = await createProjRes.text();
        return Response.json({ error: `Failed to create Dokploy project: ${body}` }, { status: 400 });
      }

      const newProject = (await createProjRes.json()) as any;
      environmentId = newProject?.environments?.[0]?.environmentId;
    }

    if (!environmentId) {
      return Response.json({ error: 'Could not resolve a Dokploy environmentId.' }, { status: 500 });
    }

    // 2. Create the application
    const appName = `rivinity-${chatId.slice(0, 8)}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const createAppRes = await fetch(`${instanceUrl}/api/application.create`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: appName, environmentId }),
    });

    if (!createAppRes.ok) {
      const body = await createAppRes.text();
      return Response.json({ error: `Failed to create Dokploy app: ${body}` }, { status: 400 });
    }

    const newApp = (await createAppRes.json()) as any;
    const appId: string = newApp.applicationId;
    const appNameSlug: string = newApp.appName ?? appName;

    /*
     * 3. Set sourceType to "drop" and buildType to "static"
     *    (static = serve the unzipped files directly, no build step on Dokploy's side
     *     since Rivinity already built the project inside WebContainer)
     *
     *    publishDirectory: "." — the ZIP we upload already contains the built
     *    output at its root (index.html etc. live at the top level of the zip,
     *    not inside a nested "dist" folder), so we tell Dokploy to serve from
     *    the extraction root rather than looking for a "dist" subfolder.
     *
     *    isStaticSpa: true — enables SPA fallback (serves index.html for all
     *    routes), which most Vite/React/Vue apps need for client-side routing.
     */
    const updateRes = await fetch(`${instanceUrl}/api/application.update`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        applicationId: appId,
        sourceType: 'drop',
        buildType: 'static',
        publishDirectory: '.',
        isStaticSpa: true,
      }),
    });

    if (!updateRes.ok) {
      const body = await updateRes.text();
      return Response.json({ error: `Failed to configure app source: ${body}` }, { status: 500 });
    }

    // 4. Generate a free traefik.me domain for this app
    const genDomainRes = await fetch(`${instanceUrl}/api/domain.generateDomain`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ appName: appNameSlug }),
    });

    if (!genDomainRes.ok) {
      const body = await genDomainRes.text();
      return Response.json({ error: `Failed to generate domain: ${body}` }, { status: 500 });
    }

    /*
     * domain.generateDomain returns the full URL as a raw string, e.g.
     * "http://myapp-abc123.192.168.1.100.traefik.me" — NOT a JSON object
     * with a `.domain` or `.host` field. Read as text and strip the protocol.
     */
    const rawDomainResponse = (await genDomainRes.text()).trim();

    /*
     * The response may come back as a bare string or as a JSON-quoted string
     * ("http://...") depending on Dokploy version — handle both.
     */
    let fullUrl: string;

    try {
      const parsed = JSON.parse(rawDomainResponse);
      fullUrl = typeof parsed === 'string' ? parsed : (parsed.domain ?? parsed.host ?? rawDomainResponse);
    } catch {
      fullUrl = rawDomainResponse;
    }

    const generatedHost = fullUrl.replace(/^https?:\/\//, '');

    if (!generatedHost) {
      return Response.json({ error: 'Dokploy did not return a usable domain.' }, { status: 500 });
    }

    // 5. Attach the generated domain to the application
    const createDomainRes = await fetch(`${instanceUrl}/api/domain.create`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        host: generatedHost,
        applicationId: appId,
        port: 80,
        https: false,
        certificateType: 'none',
      }),
    });

    if (!createDomainRes.ok) {
      const body = await createDomainRes.text();
      return Response.json({ error: `Failed to attach domain: ${body}` }, { status: 500 });
    }

    // 6. Upload the ZIP via dropDeployment (multipart — real file, no base64)
    const dropForm = new FormData();
    dropForm.append('applicationId', appId);
    dropForm.append('zip', zipFile, 'site.zip');

    const dropRes = await fetch(`${instanceUrl}/api/trpc/application.dropDeployment`, {
      method: 'POST',
      headers: fileHeaders,
      body: dropForm,
    });

    if (!dropRes.ok) {
      const body = await dropRes.text();
      return Response.json({ error: `Failed to upload zip: ${body}` }, { status: 500 });
    }

    // 7. Trigger the deploy
    const deployRes = await fetch(`${instanceUrl}/api/application.deploy`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ applicationId: appId }),
    });

    if (!deployRes.ok) {
      const body = await deployRes.text();
      return Response.json({ error: `Failed to trigger deploy: ${body}` }, { status: 500 });
    }

    const url = `http://${generatedHost}`;

    return Response.json({
      success: true,
      applicationId: appId,
      appName: appNameSlug,
      url,
      redeployed: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Deployment failed';
    console.error('Dokploy deploy error:', error);

    return Response.json({ error: message }, { status: 500 });
  }
}
