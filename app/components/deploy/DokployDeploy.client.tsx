// app/components/deploy/DokployDeploy.client.tsx

import { toast } from 'react-toastify';
import { useStore } from '@nanostores/react';
import { dokployConnection } from '~/lib/stores/dokploy';
import { workbenchStore } from '~/lib/stores/workbench';
import { webcontainer } from '~/lib/webcontainer';
import { path } from '~/utils/path';
import { useState } from 'react';
import type { ActionCallbackData } from '~/lib/runtime/message-parser';
import { chatId } from '~/lib/persistence/useChatHistory';

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
      if (!artifact) throw new Error('No active project. Generate an app first.');

      const deploymentId = 'deploy-dokploy-project';
      workbenchStore.addArtifact({
        id: deploymentId,
        messageId: deploymentId,
        title: 'Dokploy Deployment',
        type: 'standalone',
      });
      const deployArtifact = workbenchStore.artifacts.get()[deploymentId];

      // Build
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
        deployArtifact.runner.handleDeployAction('building', 'failed', { error: 'Build failed', source: 'netlify' });
        throw new Error('Build failed');
      }

      // Collect files
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
            files[fullPath.replace(finalBuildPath, '')] = await container.fs.readFile(fullPath, 'utf-8');
          } else if (entry.isDirectory()) {
            Object.assign(files, await getAllFiles(fullPath));
          }
        }
        return files;
      }

      const fileContents = await getAllFiles(finalBuildPath);

      // Pass existing applicationId for redeployment
      const existingAppId = localStorage.getItem(`dokploy-app-${currentChatId}`);

      const response = await fetch('/api/dokploy-deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: dokployConn.token,
          instanceUrl: dokployConn.instanceUrl,
          files: fileContents,
          chatId: currentChatId,
          applicationId: existingAppId || undefined, // ← redeployment key
        }),
      });

      const data = (await response.json()) as any;

      if (!response.ok || !data.site) {
        deployArtifact.runner.handleDeployAction('deploying', 'failed', { error: data.error, source: 'netlify' });
        throw new Error(data.error || 'Deployment failed');
      }

      // Persist app ID for future redeploys from this chat
      if (data.site?.id) {
        localStorage.setItem(`dokploy-app-${currentChatId}`, data.site.id);
      }

      deployArtifact.runner.handleDeployAction('deploying', 'complete', {
        url: `${dokployConn.instanceUrl}`,
        source: 'netlify',
      });

      const isRedeploy = !!existingAppId;
      toast.success(isRedeploy ? '✅ Redeployed to Dokploy successfully!' : '🚀 Deployed to Dokploy successfully!');

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
