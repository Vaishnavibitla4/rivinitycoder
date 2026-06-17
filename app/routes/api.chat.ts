import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamText } from '~/lib/.server/llm/stream-text';

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const { messages, apiKeys, files, promptId, contextOptimization, chatMode, designScheme } = await request.json<any>();

  try {
    const result = await streamText({
      messages,
      env: context.cloudflare?.env, 
      apiKeys,
      files,
      promptId,
      contextOptimization,
      chatMode,
      designScheme,
    });

    return result.toDataStreamResponse();
  } catch (error: any) {
    console.error('Chat error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Unknown error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
