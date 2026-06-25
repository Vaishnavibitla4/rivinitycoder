import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useStore } from '@nanostores/react';
import { netlifyConnection } from '~/lib/stores/netlify';
import { vercelConnection } from '~/lib/stores/vercel';
import { dokployConnection } from '~/lib/stores/dokploy';
import { workbenchStore } from '~/lib/stores/workbench';
import { streamingState } from '~/lib/stores/streaming';
import { classNames } from '~/utils/classNames';
import { useState, useEffect } from 'react';
import { NetlifyDeploymentLink } from '~/components/chat/NetlifyDeploymentLink.client';
import { VercelDeploymentLink } from '~/components/chat/VercelDeploymentLink.client';
import { useVercelDeploy } from '~/components/deploy/VercelDeploy.client';
import { useNetlifyDeploy } from '~/components/deploy/NetlifyDeploy.client';
import { useDokployDeploy } from '~/components/deploy/DokployDeploy.client';
import { chatId } from '~/lib/persistence/useChatHistory';

interface DeployButtonProps {
  onVercelDeploy?: () => Promise<void>;
  onNetlifyDeploy?: () => Promise<void>;
}

export const DeployButton = ({ onVercelDeploy, onNetlifyDeploy }: DeployButtonProps) => {
  const netlifyConn = useStore(netlifyConnection);
  const vercelConn = useStore(vercelConnection);
  const dokployConn = useStore(dokployConnection);
  const currentChatId = useStore(chatId);
  const [activePreviewIndex] = useState(0);
  const previews = useStore(workbenchStore.previews);
  const activePreview = previews[activePreviewIndex];

  // Single isDeploying guard — prevents any second trigger while in flight
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployingTo, setDeployingTo] = useState<'netlify' | 'vercel' | 'dokploy' | null>(null);
  const isStreaming = useStore(streamingState);

  const { handleVercelDeploy } = useVercelDeploy();
  const { handleNetlifyDeploy } = useNetlifyDeploy();
  const { handleDokployDeploy } = useDokployDeploy();

  // Track whether the app has been modified since last deploy.
  // workbenchStore.getModifiedFiles() returns the set of files changed
  // since the last save — we use this to switch to "Redeploy Changes".
  const [hasModifications, setHasModifications] = useState(false);
  const [lastDeployedChatId, setLastDeployedChatId] = useState<string | null>(null);

  useEffect(() => {
    // Check on every render if there are unsaved/modified files
    const unsaved = workbenchStore.unsavedFiles.get();
    const modified = workbenchStore.getModifiedFiles();
    const hasDeployed = currentChatId ? !!localStorage.getItem(`dokploy-app-${currentChatId}`) : false;

    setHasModifications(hasDeployed && (unsaved.size > 0 || (modified != null && Object.keys(modified).length > 0)));
    setLastDeployedChatId(currentChatId && hasDeployed ? currentChatId : null);
  });

  const dokployLabel = () => {
    if (!dokployConn.user) return 'No Dokploy Instance Connected';
    if (hasModifications) return '🔄 Redeploy Changes to Dokploy';
    if (lastDeployedChatId) return '✅ Deployed — Deploy Again';
    return 'Deploy to Dokploy';
  };

  const handleVercelDeployClick = async () => {
    if (isDeploying) return; // hard guard against double-trigger
    setIsDeploying(true);
    setDeployingTo('vercel');

    try {
      if (onVercelDeploy) {
        await onVercelDeploy();
      } else {
        await handleVercelDeploy();
      }
    } finally {
      setIsDeploying(false);
      setDeployingTo(null);
    }
  };

  const handleNetlifyDeployClick = async () => {
    if (isDeploying) return;
    setIsDeploying(true);
    setDeployingTo('netlify');

    try {
      if (onNetlifyDeploy) {
        await onNetlifyDeploy();
      } else {
        await handleNetlifyDeploy();
      }
    } finally {
      setIsDeploying(false);
      setDeployingTo(null);
    }
  };

  const handleDokployDeployClick = async () => {
    if (isDeploying) return; // hard guard — prevents double-click / double-trigger
    setIsDeploying(true);
    setDeployingTo('dokploy');

    try {
      await handleDokployDeploy();
      // After a successful deploy, reset modification indicator
      setHasModifications(false);
    } finally {
      setIsDeploying(false);
      setDeployingTo(null);
    }
  };

  return (
    <div className="flex border border-bolt-elements-borderColor rounded-md overflow-hidden text-sm">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          disabled={isDeploying || !activePreview || isStreaming}
          className="rounded-md items-center justify-center [&:is(:disabled,.disabled)]:cursor-not-allowed [&:is(:disabled,.disabled)]:opacity-60 px-3 py-1.5 text-xs bg-accent-500 text-white hover:text-bolt-elements-item-contentAccent [&:not(:disabled,.disabled)]:hover:bg-bolt-elements-button-primary-backgroundHover outline-accent-500 flex gap-1.7"
        >
          {isDeploying ? `Deploying to ${deployingTo}...` : 'Deploy'}
          <span className={classNames('i-ph:caret-down transition-transform')} />
        </DropdownMenu.Trigger>

        <DropdownMenu.Content
          className={classNames(
            'z-[250]',
            'bg-bolt-elements-background-depth-2',
            'rounded-lg shadow-lg',
            'border border-bolt-elements-borderColor',
            'animate-in fade-in-0 zoom-in-95',
            'py-1',
          )}
          sideOffset={5}
          align="end"
        >
          {/* ── Dokploy ── */}
          <DropdownMenu.Item
            className={classNames(
              'cursor-pointer flex items-center w-full px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive gap-2 rounded-md',
              { 'opacity-60 cursor-not-allowed': isDeploying || !activePreview || !dokployConn.user },
            )}
            disabled={isDeploying || !activePreview || !dokployConn.user}
            // FIX: onSelect preventDefault stops Radix firing its own selection
            // event after onClick, which was causing the deploy to trigger twice.
            onSelect={(e) => e.preventDefault()}
            onClick={handleDokployDeployClick}
          >
            <div
              className={classNames(
                'w-5 h-5 rounded flex items-center justify-center flex-shrink-0',
                hasModifications
                  ? 'bg-gradient-to-br from-orange-400 to-orange-600'
                  : 'bg-gradient-to-br from-blue-500 to-blue-700',
              )}
            >
              <div
                className={classNames(
                  hasModifications ? 'i-ph:arrow-clockwise' : 'i-ph:rocket-launch',
                  'w-3 h-3 text-white',
                )}
              />
            </div>
            <span className="mx-auto">{dokployLabel()}</span>
          </DropdownMenu.Item>

          {/* ── Vercel ── */}
          <DropdownMenu.Item
            className={classNames(
              'cursor-pointer flex items-center w-full px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive gap-2 rounded-md group relative',
              { 'opacity-60 cursor-not-allowed': isDeploying || !activePreview || !vercelConn.user },
            )}
            disabled={isDeploying || !activePreview || !vercelConn.user}
            onSelect={(e) => e.preventDefault()}
            onClick={handleVercelDeployClick}
          >
            <img
              className="w-5 h-5 bg-black p-1 rounded"
              height="24"
              width="24"
              crossOrigin="anonymous"
              src="https://cdn.simpleicons.org/vercel/white"
              alt="vercel"
            />
            <span className="mx-auto">{!vercelConn.user ? 'No Vercel Account Connected' : 'Deploy to Vercel'}</span>
            {vercelConn.user && <VercelDeploymentLink />}
          </DropdownMenu.Item>

          {/* ── Netlify ── */}
          <DropdownMenu.Item
            className={classNames(
              'cursor-pointer flex items-center w-full px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive gap-2 rounded-md group relative',
              { 'opacity-60 cursor-not-allowed': isDeploying || !activePreview || !netlifyConn.user },
            )}
            disabled={isDeploying || !activePreview || !netlifyConn.user}
            onSelect={(e) => e.preventDefault()}
            onClick={handleNetlifyDeployClick}
          >
            <img
              className="w-5 h-5"
              height="24"
              width="24"
              crossOrigin="anonymous"
              src="https://cdn.simpleicons.org/netlify"
            />
            <span className="mx-auto">{!netlifyConn.user ? 'No Netlify Account Connected' : 'Deploy to Netlify'}</span>
            {netlifyConn.user && <NetlifyDeploymentLink />}
          </DropdownMenu.Item>

          {/* ── Cloudflare (coming soon) ── */}
          <DropdownMenu.Item
            disabled
            className="flex items-center w-full rounded-md px-4 py-2 text-sm text-bolt-elements-textTertiary gap-2 opacity-60 cursor-not-allowed"
          >
            <img
              className="w-5 h-5"
              height="24"
              width="24"
              crossOrigin="anonymous"
              src="https://cdn.simpleicons.org/cloudflare"
              alt="cloudflare"
            />
            <span className="mx-auto">Deploy to Cloudflare (Coming Soon)</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
};
