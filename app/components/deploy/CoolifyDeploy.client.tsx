import { toast } from 'react-toastify';
import { useStore } from '@nanostores/react';
import { coolifyConnection } from '~/lib/stores/coolify';
import { workbenchStore } from '~/lib/stores/workbench';
import { webcontainer } from '~/lib/webcontainer';
import { path } from '~/utils/path';
import { useState } from 'react';
import type { ActionCallbackData } from '~/lib/runtime/message-parser';
import { chatId } from '~/lib/persistence/useChatHistory';

export function useCoolifyDeploy() {
  const [isDeploying, setIsDeploying] = useState(false);
  const coolifyConn = useStore(coolifyConnection);
  const currentChatId = useStore(chatId);

  const handleCoolifyDeploy = async () => {
    if (!coolifyConn.user || !coolifyConn.token) {
      toast.error('Please connect to your Coolify instance first in the Settings → Connections tab!');
      return false;
    }

    if (!coolifyConn.instanceUrl) {
      toast.error('Coolify instance URL is not configured. Please check Settings → Connections.');
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
        throw new Error('No active project found. Please generate an app first.');
      }

      // Visual feedback artifact
      const deploymentId = `deploy-coolify-project`;
      workbenchStore.addArtifact({
        id: deploymentId,
        messageId: deploymentId,
        title: 'Coolify Deployment',
        type: 'standalone',
      });

      const deployArtifact = workbenchStore.artifacts.get()[deploymentId];

      // ── Build phase ──────────────────────────────────────────────────────────
      deployArtifact.runner.handleDeployAction('building', 'running', { source: 'netlify' });

      const actionId = 'build-coolify-' + Date.now();
      const actionData: ActionCallbackData = {
        messageId: 'coolify build',
        artifactId: artifact.id,
        actionId,
        action: {
          type: 'build' as const,
          content: 'npm run build',
        },
      };

      artifact.runner.addAction(actionData);
      await artifact.runner.runAction(actionData);

      if (!artifact.runner.buildOutput) {
        deployArtifact.runner.handleDeployAction('building', 'failed', {
          error: 'Build failed. Check the terminal for details.',
          source: 'netlify',
        });
        throw new Error('Build failed');
      }

      // ── Collect build files ──────────────────────────────────────────────────
      deployArtifact.runner.handleDeployAction('deploying', 'running', { source: 'netlify' });

      const container = await webcontainer;
      const buildPath = artifact.runner.buildOutput.path.replace('/home/project', '');

      let finalBuildPath = buildPath;
      const commonOutputDirs = [buildPath, '/dist', '/build', '/out', '/output', '/.next', '/public'];
      let buildPathExists = false;

      for (const dir of commonOutputDirs) {
        try {
          await container.fs.readdir(dir);
          finalBuildPath = dir;
          buildPathExists = true;
          break;
        } catch {
          continue;
        }
      }

      if (!buildPathExists) {
        throw new Error('Could not find build output directory. Please check your build configuration.');
      }

      async function getAllFiles(dirPath: string): Promise<Record<string, string>> {
        const files: Record<string, string> = {};
        const entries = await container.fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);

          if (entry.isFile()) {
            const content = await container.fs.readFile(fullPath, 'utf-8');
            const deployPath = fullPath.replace(finalBuildPath, '');
            files[deployPath] = content;
          } else if (entry.isDirectory()) {
            const subFiles = await getAllFiles(fullPath);
            Object.assign(files, subFiles);
          }
        }

        return files;
      }

      const fileContents = await getAllFiles(finalBuildPath);

      // ── Call server-side deploy route ────────────────────────────────────────
      const existingAppUuid = localStorage.getItem(`coolify-app-${currentChatId}`);

      const response = await fetch('/api/coolify-deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: coolifyConn.token,
          instanceUrl: coolifyConn.instanceUrl,
          files: fileContents,
          chatId: currentChatId,
          applicationUuid: existingAppUuid || undefined,
        }),
      });

      const data = (await response.json()) as any;

      if (!response.ok || !data.deploy || !data.site) {
        deployArtifact.runner.handleDeployAction('deploying', 'failed', {
          error: data.error || 'Invalid deployment response from Coolify',
          source: 'netlify',
        });
        throw new Error(data.error || 'Invalid deployment response');
      }

      // Persist app UUID for future re-deploys
      if (data.site?.uuid) {
        localStorage.setItem(`coolify-app-${currentChatId}`, data.site.uuid);
      }

      deployArtifact.runner.handleDeployAction('complete', 'complete', {
        url: data.deploy.url,
        source: 'netlify',
      });

      toast.success(`Deployed to Coolify! 🚀 ${data.deploy.url}`);

      return true;
    } catch (error) {
      console.error('Coolify deploy error:', error);
      toast.error(error instanceof Error ? error.message : 'Coolify deployment failed');

      return false;
    } finally {
      setIsDeploying(false);
    }
  };

  return {
    isDeploying,
    handleCoolifyDeploy,
    isConnected: !!coolifyConn.user,
  };
}
