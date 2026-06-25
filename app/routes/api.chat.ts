import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamText } from '~/lib/.server/llm/stream-text';
import { createSummary } from '~/lib/.server/llm/create-summary';
import { selectContext } from '~/lib/.server/llm/select-context';
import type { FileMap } from '~/lib/.server/llm/constants';
import type { Message } from 'ai';

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const { messages, apiKeys, files, promptId, contextOptimization, chatMode, designScheme } = await request.json<any>();

  const serverEnv = context.cloudflare?.env;

  try {
    // ─── Context optimization ────────────────────────────────────────────────
    // Root cause of lag: the original route forwarded contextOptimization=true
    // to streamText but NEVER called createSummary or selectContext — so the
    // full conversation history (with all file contents) was sent on every
    // request, growing unboundedly. We now actually run these here.
    //
    // Only activate when:
    //  - chatMode is 'build' (not discuss)
    //  - contextOptimization is enabled by user
    //  - there are files in the workbench
    //  - conversation is long enough that it matters (> 6 messages)
    let summary: string | undefined;
    let messageSliceId: number | undefined;
    let contextFiles: FileMap | undefined;

    const shouldOptimize =
      chatMode === 'build' &&
      contextOptimization &&
      files &&
      Object.keys(files).length > 0 &&
      (messages as Message[]).length > 6;

    if (shouldOptimize) {
      try {
        // Run summary and context selection in parallel — not sequentially.
        // Both are separate LLM calls; doing them in parallel saves ~1-2s.
        const [summaryResult, contextResult] = await Promise.all([
          createSummary({
            messages: messages as Message[],
            env: serverEnv,
            apiKeys,
          }),
          selectContext({
            messages: messages as Message[],
            env: serverEnv,
            apiKeys,
            files,
            summary: '',
            contextOptimization,
          }),
        ]);

        summary = summaryResult as string;
        contextFiles = contextResult as FileMap;

        // messageSliceId: only send the last message to the model when we have
        // a full summary — older messages are captured in the summary already.
        messageSliceId = (messages as Message[]).length > 2 ? (messages as Message[]).length - 2 : undefined;
      } catch (optimizationError) {
        // If optimization fails, fall through to unoptimized streaming.
        // A slower response is better than a broken one.
        console.warn('[api.chat] Context optimization failed, continuing without it:', optimizationError);
      }
    }

    const result = await streamText({
      messages,
      env: serverEnv,
      apiKeys,
      files,
      promptId,
      contextOptimization: shouldOptimize,
      contextFiles,
      summary,
      messageSliceId,
      chatMode,
      designScheme,
    });

    // Add explicit no-buffer headers so tokens stream to the browser immediately
    // instead of being held by nginx or any intermediate proxy layer.
    const streamResponse = result.toDataStreamResponse();
    const headers = new Headers(streamResponse.headers);
    headers.set('X-Accel-Buffering', 'no');
    headers.set('Cache-Control', 'no-cache');
    headers.set('Connection', 'keep-alive');

    return new Response(streamResponse.body, {
      status: streamResponse.status,
      headers,
    });
  } catch (error: any) {
    console.error('Chat error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Unknown error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
