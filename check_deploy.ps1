$file = 'app\routes\api.coolify-deploy.ts'
$content = Get-Content $file -Raw -Encoding UTF8

# Also replace the entire Step 2 (file injection) block — no longer needed.
# Now the SITE_B64 env var flows to the container at runtime via the CMD in the Dockerfile.
# We only need to POST the env var (already done) and trigger deployment.

$oldStep2 = @'
    // ── Step 2: Push files via Coolify's build_command ─────────────────────────
    // Coolify v4 API doesn't fully support a generic ZIP file upload for static apps yet.
    // We construct a ZIP payload, base64 encode it, and inject it as a build_command.

    // Intercept deployed HTML files to inject a floating "Edit with Rivinity" button
'@

$newStep2_check = $content.Contains($oldStep2)
Write-Host "Step 2 block found: $newStep2_check"

# Just print surrounding lines to verify
$lines = Get-Content $file
Write-Host "Lines 218-225:"
for ($i = 217; $i -lt 225; $i++) {
    Write-Host "${i}: $($lines[$i])"
}
