$file = 'app\routes\api.coolify-deploy.ts'
$content = Get-Content $file -Raw -Encoding UTF8

# ── OLD section to replace ──────────────────────────────────────────────────
$oldSection = @'
      // Create a Static HTML application using the public repository endpoint
      const appName = `rivinity-${chatId.slice(0, 8)}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const createAppRes = await fetch(`${baseUrl}/api/v1/applications/public`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: appName,
          description: `Deployed by Rivinity AI — chat ${chatId}`,
          project_uuid: projectUuid,
          environment_name: environmentName,
          server_uuid: serverUuid,
          build_pack: 'static',
          publish_directory: '/',
          // We supply a tiny public text repository to bypass Coolify V4's strict Git requirement on creation.
          // This repository will instantly correctly clone in 0.1s, and then our ZIP upload will overwrite the files.
          git_repository: 'https://github.com/octocat/Hello-World',
          git_branch: 'master',
          // Explicitly expose standard web port for static sites
          ports_exposes: '80',
          // This will be overridden immediately by a file-based deploy
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
      appFqdn = `http://${appName}.127.0.0.1.sslip.io`;

      // PATCH the app to set this explicit FQDN so Traefik creates the correct routing rule.
      await retryFetch(() =>
        fetch(`${baseUrl}/api/v1/applications/${appUuid}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ fqdn: appFqdn }),
        }),
      );
'@

$newSection = @'
      // ── Dockerfile-based approach ─────────────────────────────────────────────
      //
      // We use build_pack: 'dockerfile' with an inline Dockerfile so that file
      // injection happens at CONTAINER RUNTIME (via the CMD entrypoint), not during
      // the build phase. This avoids every env-var/build-phase limitation:
      //
      //  • build_command (TEXT, 65 KB limit) → not used
      //  • is_build_time env var flag        → not needed; runtime env vars work
      //  • Nixpacks complexity               → bypassed; plain nginx:alpine image
      //
      // The Dockerfile CMD decodes the SITE_B64 runtime env var on every container
      // start, extracts the zip to nginx's html root, then starts nginx.

      const appName = `rivinity-${chatId.slice(0, 8)}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

      // Tiny inline Dockerfile (<300 bytes) — nginx:alpine + unzip, files injected at runtime.
      const inlineDockerfile = [
        'FROM nginx:alpine',
        'RUN apk add --no-cache unzip bash',
        'EXPOSE 80',
        // On startup: decode $SITE_B64 → zip → extract to nginx html root → start nginx
        `CMD bash -c 'printf "%s" "$SITE_B64" | base64 -d > /tmp/s.zip && unzip -o /tmp/s.zip -d /usr/share/nginx/html/ && rm /tmp/s.zip && exec nginx -g "daemon off;"'`,
      ].join('\n');

      const createAppRes = await fetch(`${baseUrl}/api/v1/applications/dockerfile`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: appName,
          description: `Deployed by Rivinity AI — chat ${chatId}`,
          project_uuid: projectUuid,
          environment_name: environmentName,
          server_uuid: serverUuid,
          // Inline Dockerfile — no real git repo content needed, octocat/Hello-World is
          // cloned but ignored; the inline dockerfile overrides it.
          git_repository: 'https://github.com/octocat/Hello-World',
          git_branch: 'master',
          ports_exposes: '80',
          dockerfile: inlineDockerfile,
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

      // Force FQDN to 127.0.0.1.sslip.io — Coolify's auto-assigned FQDN uses its Docker-
      // internal IP (e.g. 45.x.x.x) which is unreachable from a Windows browser.
      appFqdn = `http://${appName}.127.0.0.1.sslip.io`;

      await retryFetch(() =>
        fetch(`${baseUrl}/api/v1/applications/${appUuid}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ fqdn: appFqdn }),
        }),
      );
'@

if ($content.Contains($oldSection)) {
    $newContent = $content.Replace($oldSection, $newSection)
    Set-Content $file $newContent -Encoding UTF8 -NoNewline
    Write-Host "SUCCESS: App creation section replaced with Dockerfile approach."
} else {
    Write-Host "ERROR: Target section not found. Printing lines 154-210:"
    $lines = Get-Content $file
    for ($i = 153; $i -lt 210; $i++) {
        Write-Host "${i}: $($lines[$i])"
    }
}
