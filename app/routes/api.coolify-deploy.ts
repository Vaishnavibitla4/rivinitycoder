import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';

interface CoolifyDeployRequestBody {
  token: string;
  instanceUrl: string;
  files: Record<string, string>;
  chatId: string;
  applicationUuid?: string;
}

/**
 * Derives a publicly-reachable base URL from the Coolify instance URL.
 * For local instances (localhost / 127.0.0.1 / WSL2 host.docker.internal),
 * we fall through to sslip.io so the browser can actually resolve the address.
 */
function derivePublicHost(instanceUrl: string): string {
  try {
    const { hostname } = new URL(instanceUrl);
    // Resolve WSL2 / Docker internal hostname aliases to loopback
    if (hostname === 'host.docker.internal' || hostname === 'localhost' || hostname === '127.0.0.1') {
      return '127.0.0.1';
    }
    return hostname;
  } catch {
    return '127.0.0.1';
  }
}


/**
 * Server-side API route that bridges the WebContainer build output to Coolify's REST API.
 *
 * Flow:
 *  1. If no applicationUuid → create a new Static HTML application in Coolify
 *  2. Build a ZIP of the files, base64-encode it, inject it as a build_command
 *  3. Trigger a deployment via /api/v1/deploy
 *  4. Return { site, deploy } to the client
 *
 * Coolify API reference: https://coolify.io/docs/api-reference
 */

/** Retry a fetch-based callback up to `maxAttempts` times with a delay between attempts. */
async function retryFetch(
  fn: () => Promise<Response>,
  maxAttempts = 3,
  delayMs = 1200,
): Promise<Response> {
  let lastRes: Response | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastRes = await fn();
    if (lastRes.ok) return lastRes;
    // If it's a definitive client error (not 404/503 which can be transient), stop early
    if (lastRes.status !== 404 && lastRes.status !== 503 && lastRes.status < 500) break;
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return lastRes!;
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { token, instanceUrl, files, chatId, applicationUuid } =
      (await request.json()) as CoolifyDeployRequestBody;

    let activeToken = token;
    let activeInstanceUrl = instanceUrl;

    if (!activeToken || activeToken === 'local-dev-token') {
      activeToken = process.env.VITE_COOLIFY_API_TOKEN || activeToken;
    }
    
    if (!activeInstanceUrl || activeInstanceUrl === 'http://localhost:8000') {
      activeInstanceUrl = process.env.VITE_COOLIFY_INSTANCE_URL || activeInstanceUrl;
    }

    if (!activeToken) {
      return json({ error: 'Not connected to Coolify — no API token provided.' }, { status: 401 });
    }

    if (!activeInstanceUrl) {
      return json({ error: 'Coolify instance URL is not configured.' }, { status: 400 });
    }

    const baseUrl = activeInstanceUrl.replace(/\/$/, '');
    const headers = {
      Authorization: `Bearer ${activeToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    // ── Step 1: Resolve or create the Coolify application ──────────────────────

    let appUuid = applicationUuid;
    let appFqdn: string | undefined;

    if (!appUuid) {
      // Create a new Static HTML application on Coolify.
      // We first need a server UUID and environment UUID.
      const [serversRes, teamsRes] = await Promise.all([
        fetch(`${baseUrl}/api/v1/servers`, { headers }),
        fetch(`${baseUrl}/api/v1/teams`, { headers }),
      ]);

      if (!serversRes.ok) {
        const body = await serversRes.text();
        return json({ error: `Failed to list Coolify servers: ${body}` }, { status: 400 });
      }

      const servers = (await serversRes.json()) as any[];

      if (!servers || servers.length === 0) {
        return json(
          { error: 'No servers found in your Coolify instance. Please add a server first.' },
          { status: 400 },
        );
      }

      const server = servers[0];
      const serverUuid: string = server.uuid;

      // Get environments for the first (default) project
      const projectsRes = await fetch(`${baseUrl}/api/v1/projects`, { headers });

      if (!projectsRes.ok) {
        const body = await projectsRes.text();
        return json({ error: `Failed to list Coolify projects: ${body}` }, { status: 400 });
      }

      const projects = (await projectsRes.json()) as any[];
      let projectUuid: string;
      let environmentName: string;

      if (projects && projects.length > 0) {
        projectUuid = projects[0].uuid;
        environmentName = projects[0].environments?.[0]?.name ?? 'production';
      } else {
        // Create a project
        const createProjectRes = await fetch(`${baseUrl}/api/v1/projects`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: `rivinity-${chatId}`, description: 'Created by Rivinity AI' }),
        });

        if (!createProjectRes.ok) {
          return json({ error: 'Failed to create a Coolify project.' }, { status: 400 });
        }

        const newProject = (await createProjectRes.json()) as any;
        projectUuid = newProject.uuid;
        environmentName = 'production';
      }

      // ── Dockerfile buildpack: file injection at CONTAINER RUNTIME ─────────────
      //
      // Using build_pack:'static' + build_command was broken because:
      //   • build_command is stored in a MySQL TEXT col (65 KB max) → truncated for real sites
      //   • Runtime env vars (SITE_B64) are NOT passed to the Nixpacks BUILD phase
      //   • is_build_time flag is rejected by Coolify v4 API validation
      //
      // Solution: custom Dockerfile whose CMD decodes SITE_B64 at container startup.
      // Runtime env vars ARE always injected into running containers. The Dockerfile
      // itself is < 300 bytes — no column limit issues.

      const appName = `rivinity-${chatId.slice(0, 8)}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

      // Inline Dockerfile: nginx:alpine + unzip; on start, decode env var and serve.
      const inlineDockerfile = [
  'FROM nginx:alpine',
  'RUN apk add --no-cache unzip bash',
  'EXPOSE 80',
  `CMD bash -c 'printf "%s" "$SITE_B64" | base64 -d > /tmp/s.zip && unzip -o /tmp/s.zip -d /usr/share/nginx/html/ && rm /tmp/s.zip && exec nginx -g "daemon off;"'`,
].join('\n');

// Coolify v4 requires dockerfile content to be Base64 encoded
const dockerfileBase64 =
  typeof Buffer !== 'undefined'
    ? Buffer.from(inlineDockerfile, 'utf8').toString('base64')
    : btoa(inlineDockerfile);

      const createAppRes = await fetch(`${baseUrl}/api/v1/applications/dockerfile`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: appName,
          description: `Deployed by Rivinity AI`,
          project_uuid: projectUuid,
          environment_name: environmentName,
          server_uuid: serverUuid,
          git_repository: 'https://github.com/octocat/Hello-World',
          git_branch: 'master',
          ports_exposes: '80',
          dockerfile: dockerfileBase64,
          install_command: '',
          build_command: '',
          start_command: '',
        }),
      });

      if (!createAppRes.ok) {
        const body = await createAppRes.text();
        return json({ error: `Failed to create Coolify application: ${body}` }, { status: 400 });
      }

      const newApp = (await createAppRes.json()) as any;
      appUuid = newApp.uuid ?? newApp.data?.uuid;

      if (!appUuid) {
        return json({ error: 'Coolify did not return an application UUID.' }, { status: 500 });
      }

      // Always force the FQDN to 127.0.0.1.sslip.io.
      //
      // Coolify's auto-assigned FQDN uses its own wildcard domain, which for local Docker
      // setups is the Docker bridge/WSL2 IP (e.g. 45.x.x.x) — NOT accessible from the
      // Windows browser. sslip.io resolves *.127.0.0.1.sslip.io → 127.0.0.1 (localhost),
      // which IS reachable and goes through Traefik on port 80.
      // appFqdn = `http://${appName}.127.0.0.1.sslip.io`;
      const publicHost = derivePublicHost(activeInstanceUrl);

      appFqdn = `http://${appName}.${publicHost}.sslip.io`;

      // PATCH the app to set this explicit FQDN so Traefik creates the correct routing rule.
      await retryFetch(() =>
        fetch(`${baseUrl}/api/v1/applications/${appUuid}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ fqdn: appFqdn }),
        }),
      );
    } else {
      // Get existing app info
      const appRes = await fetch(`${baseUrl}/api/v1/applications/${appUuid}`, { headers });

      if (appRes.ok) {
        const appData = (await appRes.json()) as any;
        appFqdn = appData.fqdn;
      }
    }

    // ── Step 2: Push files via Coolify's build_command ─────────────────────────
    // Coolify v4 API doesn't fully support a generic ZIP file upload for static apps yet.
    // We construct a ZIP payload, base64 encode it, and inject it as a build_command.

    // Intercept deployed HTML files to inject a floating "Edit with Rivinity" button
    // It redirects backwards gracefully via the host's active domain root to access the builder
    const requestUrl = new URL(request.url);
    const rivinityOrigin = requestUrl.origin;
    
    const filesToDeploy = { ...files };
    const editButtonHtml = `\n<div style="position: fixed; bottom: 20px; right: 20px; z-index: 999999;"><a href="${rivinityOrigin}/test/chat/${chatId}" target="_blank" style="background-color: #8b5cf6; color: white; padding: 10px 16px; border-radius: 8px; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; text-decoration: none; font-weight: 500; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); display: flex; align-items: center; gap: 8px; transition: all 0.2s ease-in-out;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>Edit with Rivinity</a></div>\n`;

    for (const [path, content] of Object.entries(filesToDeploy)) {
      if (path.endsWith('.html') && typeof content === 'string') {
        const insertionPoint = content.lastIndexOf('</body>');
        if (insertionPoint !== -1) {
          filesToDeploy[path] = content.slice(0, insertionPoint) + editButtonHtml + content.slice(insertionPoint);
        } else {
          filesToDeploy[path] = content + editButtonHtml;
        }
      }
    }

    const zipBytes = await buildZip(filesToDeploy);

    // Safely encode Uint8Array to base64 for Cloudflare environments where Buffer might be missing
    let binaryString = '';
    for (let i = 0; i < zipBytes.length; i++) {
      binaryString += String.fromCharCode(zipBytes[i]);
    }
    const zipBase64 = btoa(binaryString);

    // ── Step 2: Store the zip as a runtime environment variable ──────────────────────
    // The Dockerfile CMD reads SITE_B64 at container runtime (not build time),
    // so a plain runtime env var is all we need — no is_build_time flag required.
    const envRes = await retryFetch(() =>
      fetch(`${baseUrl}/api/v1/applications/${appUuid}/envs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ key: 'SITE_B64', value: zipBase64 }),
      }),
    );

    if (!envRes.ok) {
      const envBody = await envRes.text();
      return json(
        { error: `Failed to store site files as Coolify env var (${envRes.status}): ${envBody}` },
        { status: 500 },
      );
    }

    // ── Step 3: Trigger deployment ──────────────────────────────────────────────
    // Different Coolify versions accept GET or POST — try POST first (more reliable),
    // fall back to GET if POST returns 404/405.
    let deployRes = await fetch(`${baseUrl}/api/v1/deploy?uuid=${appUuid}&force=false`, {
      method: 'POST',
      headers,
    });

    if (deployRes.status === 404 || deployRes.status === 405) {
      console.warn(`POST /api/v1/deploy returned ${deployRes.status}, retrying with GET...`);
      deployRes = await fetch(`${baseUrl}/api/v1/deploy?uuid=${appUuid}&force=false`, {
        method: 'GET',
        headers,
      });
    }

    if (!deployRes.ok) {
      const body = await deployRes.text();
      return json(
        { error: `Failed to trigger Coolify deployment (${deployRes.status}): ${body}` },
        { status: 500 },
      );
    }

    const deployData = (await deployRes.json()) as any;
    const deploymentUuid = deployData.deployments?.[0]?.deployment_uuid ?? deployData.deployment_uuid ?? 'pending';

    // ── Step 4: Build public URL ────────────────────────────────────────────────
    // Fetch updated app info to get the assigned FQDN
    let publicUrl = appFqdn;

    if (!publicUrl) {
      const updatedAppRes = await fetch(`${baseUrl}/api/v1/applications/${appUuid}`, { headers });

      if (updatedAppRes.ok) {
        const updatedApp = (await updatedAppRes.json()) as any;
        publicUrl = updatedApp.fqdn;
      }
    }

    const finalUrl = publicUrl ? (publicUrl.startsWith('http') ? publicUrl : `https://${publicUrl}`) : baseUrl;

    return json({
      success: true,
      site: {
        id: appUuid,
        uuid: appUuid,
        name: `rivinity-${chatId.slice(0, 8)}`,
        fqdn: publicUrl,
      },
      deploy: {
        id: deploymentUuid,
        url: finalUrl,
      },
    });
  } catch (error) {
    let errorMessage = error instanceof Error ? error.message : 'Deployment failed';

    // Provide a better error for connection issues (e.g., local instance not running)
    if (errorMessage.includes('fetch failed') || errorMessage.includes('ECONNREFUSED')) {
      errorMessage = `Could not connect to Coolify at the targeted instance URL. Please ensure your Coolify instance is running and accessible.`;
      // Log a clean warning to the backend console without the massive stack trace
      console.warn(`[Coolify Deploy] Local connection failed: ${errorMessage}`);
    } else {
      // Log full stack trace for actual unexpected bugs
      console.error('Coolify deploy error:', error);
    }

    return json({ error: errorMessage }, { status: 500 });
  }
}

// ── ZIP builder (pure, no Node.js deps) ────────────────────────────────────────
// Uses the ZIP format spec directly since Cloudflare Workers don't have Node.js fs.

async function buildZip(files: Record<string, string>): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const crc32Table = makeCrc32Table();

  const entries: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let offset = 0;

  for (const [rawPath, content] of Object.entries(files)) {
    const filePath = rawPath.startsWith('/') ? rawPath.slice(1) : rawPath;
    const fileData = encoder.encode(content);
    const crc = crc32(crc32Table, fileData);
    const pathData = encoder.encode(filePath);

    // Local file header
    const localHeader = new DataView(new ArrayBuffer(30 + pathData.length));
    localHeader.setUint32(0, 0x04034b50, true); // signature
    localHeader.setUint16(4, 20, true); // version needed
    localHeader.setUint16(6, 0, true); // flags
    localHeader.setUint16(8, 0, true); // compression (stored)
    localHeader.setUint16(10, 0, true); // mod time
    localHeader.setUint16(12, 0, true); // mod date
    localHeader.setUint32(14, crc, true); // crc32
    localHeader.setUint32(18, fileData.length, true); // compressed size
    localHeader.setUint32(22, fileData.length, true); // uncompressed size
    localHeader.setUint16(26, pathData.length, true); // filename length
    localHeader.setUint16(28, 0, true); // extra field length
    new Uint8Array(localHeader.buffer).set(pathData, 30);

    const localHeaderBytes = new Uint8Array(localHeader.buffer);
    entries.push(localHeaderBytes, fileData);

    // Central directory entry
    const centralEntry = new DataView(new ArrayBuffer(46 + pathData.length));
    centralEntry.setUint32(0, 0x02014b50, true); // signature
    centralEntry.setUint16(4, 20, true); // version made by
    centralEntry.setUint16(6, 20, true); // version needed
    centralEntry.setUint16(8, 0, true); // flags
    centralEntry.setUint16(10, 0, true); // compression
    centralEntry.setUint16(12, 0, true); // mod time
    centralEntry.setUint16(14, 0, true); // mod date
    centralEntry.setUint32(16, crc, true); // crc32
    centralEntry.setUint32(20, fileData.length, true); // compressed size
    centralEntry.setUint32(24, fileData.length, true); // uncompressed size
    centralEntry.setUint16(28, pathData.length, true); // filename length
    centralEntry.setUint16(30, 0, true); // extra field length
    centralEntry.setUint16(32, 0, true); // comment length
    centralEntry.setUint16(34, 0, true); // disk start
    centralEntry.setUint16(36, 0, true); // internal attrs
    centralEntry.setUint32(38, 0, true); // external attrs
    centralEntry.setUint32(42, offset, true); // relative offset
    new Uint8Array(centralEntry.buffer).set(pathData, 46);

    centralDirectory.push(new Uint8Array(centralEntry.buffer));
    offset += localHeaderBytes.length + fileData.length;
  }

  const centralDirSize = centralDirectory.reduce((s, e) => s + e.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); // signature
  eocd.setUint16(4, 0, true); // disk number
  eocd.setUint16(6, 0, true); // disk with central dir
  eocd.setUint16(8, centralDirectory.length, true); // entries on disk
  eocd.setUint16(10, centralDirectory.length, true); // total entries
  eocd.setUint32(12, centralDirSize, true); // central dir size
  eocd.setUint32(16, offset, true); // central dir offset
  eocd.setUint16(20, 0, true); // comment length

  const all = [...entries, ...centralDirectory, new Uint8Array(eocd.buffer)];
  const totalSize = all.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(totalSize);
  let pos = 0;

  for (const chunk of all) {
    result.set(chunk, pos);
    pos += chunk.length;
  }

  return result;
}

function makeCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i++) {
    let c = i;

    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[i] = c;
  }

  return table;
}

function crc32(table: Uint32Array, data: Uint8Array): number {
  let crc = 0xffffffff;

  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}
