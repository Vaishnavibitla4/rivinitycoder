/*
 * app/components/deploy/DokployDeploy.client.tsx
 *
 * Builds the project, packs it into a real ZIP file (no base64), and uploads
 * it directly to Dokploy via /api/dokploy-deploy, which uses
 * application.dropDeployment + application.deploy (first deploy) or
 * application.dropDeployment + application.redeploy (subsequent deploys
 * from the same chat). Shows the resulting live URL to the user.
 */

import { toast } from 'react-toastify';
import { useStore } from '@nanostores/react';
import { dokployConnection } from '~/lib/stores/dokploy';
import { workbenchStore } from '~/lib/stores/workbench';
import { webcontainer } from '~/lib/webcontainer';
import { path } from '~/utils/path';
import { buildZip } from '~/utils/buildZip';
import { useState } from 'react';
import type { ActionCallbackData } from '~/lib/runtime/message-parser';
import { chatId } from '~/lib/persistence/useChatHistory';
import type { DokployDeployResponse } from '~/types/dokploy';

export function useDokployDeploy() {
  const [isDeploying, setIsDeploying] = useState(false);
  const dokployConn = useStore(dokployConnection);
  const currentChatId = useStore(chatId);

  const handleDokployDeploy = async () => {
    if (!dokployConn.user || !dokployConn.token) {
      toast.error('Please connect to your Dokploy instance first in Settings → Connections!');
      return false;
    }

    if (!currentChatId) {
      toast.error('No active chat found');
      return false;
    }

    try {
      setIsDeploying(true);

      const artifact = workbenchStore.firstArtifact;

      if (!artifact) {
        throw new Error('No active project. Generate an app first.');
      }

      const deploymentId = 'deploy-dokploy-project';
      workbenchStore.addArtifact({
        id: deploymentId,
        messageId: deploymentId,
        title: 'Dokploy Deployment',
        type: 'standalone',
      });

      const deployArtifact = workbenchStore.artifacts.get()[deploymentId];

      // ── Build ────────────────────────────────────────────────────────────
      deployArtifact.runner.handleDeployAction('building', 'running', { source: 'netlify' });

      const actionId = 'build-dokploy-' + Date.now();
      const actionData: ActionCallbackData = {
        messageId: 'dokploy build',
        artifactId: artifact.id,
        actionId,
        action: { type: 'build' as const, content: 'npm run build' },
      };
      artifact.runner.addAction(actionData);
      await artifact.runner.runAction(actionData);

      if (!artifact.runner.buildOutput) {
        deployArtifact.runner.handleDeployAction('building', 'failed', {
          error: 'Build failed',
          source: 'netlify',
        });
        throw new Error('Build failed');
      }

      // ── Collect built files from WebContainer ──────────────────────────────
      deployArtifact.runner.handleDeployAction('deploying', 'running', { source: 'netlify' });

      const container = await webcontainer;
      const buildPath = artifact.runner.buildOutput.path.replace('/home/project', '');
      let finalBuildPath = buildPath;

      for (const dir of [buildPath, '/dist', '/build', '/out', '/output', '/.next', '/public']) {
        try {
          await container.fs.readdir(dir);
          finalBuildPath = dir;
          break;
        } catch {
          continue;
        }
      }

      async function getAllFiles(dirPath: string): Promise<Record<string, string>> {
        const files: Record<string, string> = {};
        const entries = await container.fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);

          if (entry.isFile()) {
            const content = await container.fs.readFile(fullPath, 'utf-8');
            files[fullPath.replace(finalBuildPath, '')] = content;
          } else if (entry.isDirectory()) {
            Object.assign(files, await getAllFiles(fullPath));
          }
        }

        return files;
      }

      const fileContents = await getAllFiles(finalBuildPath);

      // ── Build a real ZIP file in-browser — no base64 conversion ────────────
      const zipBytes = await buildZip(fileContents);

      /*
       * Re-wrap in a plain ArrayBuffer-backed Uint8Array to satisfy BlobPart's
       * strict ArrayBuffer typing (zipBytes.buffer is typed ArrayBufferLike).
       */
      const zipBuffer = new Uint8Array(zipBytes).buffer as ArrayBuffer;
      const zipBlob = new Blob([zipBuffer], { type: 'application/zip' });

      // ── Check for an existing applicationId (redeployment) ─────────────────
      const existingAppId = localStorage.getItem(`dokploy-app-${currentChatId}`);

      // ── Send as multipart/form-data — no JSON, no base64 ────────────────────
      const formData = new FormData();
      formData.append('token', dokployConn.token);
      formData.append('instanceUrl', dokployConn.instanceUrl);
      formData.append('chatId', currentChatId);
      formData.append('zip', zipBlob, 'site.zip');

      if (existingAppId) {
        formData.append('applicationId', existingAppId);
      }

      const response = await fetch('/api/dokploy-deploy', {
        method: 'POST',

        // Do NOT set Content-Type — the browser sets the multipart boundary automatically
        body: formData,
      });

      const data = (await response.json()) as DokployDeployResponse;

      if (!response.ok || !data.success) {
        deployArtifact.runner.handleDeployAction('deploying', 'failed', {
          error: data.error,
          source: 'netlify',
        });
        throw new Error(data.error || 'Deployment failed');
      }

      // Persist applicationId for future redeploys from this same chat
      if (data.applicationId) {
        localStorage.setItem(`dokploy-app-${currentChatId}`, data.applicationId);
      }

      // Reset file modification tracking so DeployButton switches back from
      // "Redeploy Changes" to "Deployed — Deploy Again" after a successful deploy.
      workbenchStore.resetAllFileModifications();

      deployArtifact.runner.handleDeployAction('deploying', 'complete', {
        url: data.url,
        source: 'netlify',
      });

      toast.success(data.redeployed ? `✅ Redeployed to Dokploy! ${data.url}` : `🚀 Deployed to Dokploy! ${data.url}`, {
        autoClose: 8000,
      });

      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Dokploy deployment failed');
      return false;
    } finally {
      setIsDeploying(false);
    }
  };

  return { handleDokployDeploy, isDeploying };
}
