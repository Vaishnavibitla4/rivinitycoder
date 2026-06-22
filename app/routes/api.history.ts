import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { query } from '~/lib/db.server';
import { encryptField, safeDecryptField } from '~/lib/encryption.server';

/*
 * Shape of a row in rivinity_webbuilder_chats — gives `rows`/`chat` real types
 * instead of `unknown`, which is what request.json() and query() return by default.
 */
interface ChatRow {
  id: string;
  urlId: string | null;
  description: string | null;
  messages: any;
  timestamp: string | Date;
  metadata: any;
  snapshot: any;
}

interface HistoryPostBody {
  id: string;
  urlId?: string | null;
  description?: string | null;
  messages: any;
  timestamp?: string | number | Date;
  metadata?: any;
  snapshot?: any;
}

function encryptForJson(value: any): string {
  return JSON.stringify(encryptField(JSON.stringify(value)));
}

function decryptFromJson(raw: any): any {
  if (raw == null) {
    return null;
  }

  try {
    const encrypted = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const decrypted = safeDecryptField(encrypted);

    return decrypted ? JSON.parse(decrypted) : null;
  } catch {
    return raw;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  try {
    if (id) {
      const rows = await query<ChatRow>('SELECT * FROM rivinity_webbuilder_chats WHERE id = $1 OR "urlId" = $2', [
        id,
        id,
      ]);

      if (rows.length === 0) {
        return Response.json(null);
      }

      const chat = rows[0];

      chat.messages = decryptFromJson(chat.messages);
      chat.metadata = decryptFromJson(chat.metadata);
      chat.snapshot = decryptFromJson(chat.snapshot);

      return Response.json(chat);
    }

    const rows = await query<Pick<ChatRow, 'id' | 'urlId' | 'description' | 'timestamp'>>(
      'SELECT id, "urlId", description, timestamp FROM rivinity_webbuilder_chats ORDER BY timestamp DESC',
    );

    return Response.json(rows);
  } catch (error) {
    console.error('Database error in loader:', error);
    return Response.json({ error: 'Database error' }, { status: 500 });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const method = request.method;

  try {
    if (method === 'DELETE') {
      let id: string | null = null;

      try {
        const data = (await request.json()) as { id?: string };
        id = data.id ?? null;
      } catch {
        const url = new URL(request.url);
        id = url.searchParams.get('id');
      }

      if (!id) {
        return Response.json({ error: 'Missing ID' }, { status: 400 });
      }

      await query('DELETE FROM rivinity_webbuilder_chats WHERE id = $1', [id]);

      return Response.json({ success: true });
    }

    /*
     * Fix: cast request.json() to a known shape — without this, `data` is
     * `unknown` and every destructured property below errors with
     * "Property 'X' does not exist on type 'unknown'".
     */
    const data = (await request.json()) as HistoryPostBody;

    if (method === 'POST') {
      const { id, urlId, description, messages, timestamp, metadata, snapshot } = data;

      if (messages === undefined || messages === null) {
        return Response.json({ error: 'messages field is required' }, { status: 400 });
      }

      await query(
        `
        INSERT INTO rivinity_webbuilder_chats
        (
          id,
          "urlId",
          description,
          messages,
          timestamp,
          metadata,
          snapshot
        )
        VALUES
        (
          $1, $2, $3, $4, $5, $6, $7
        )
        ON CONFLICT (id)
        DO UPDATE SET
          "urlId" = EXCLUDED."urlId",
          description = EXCLUDED.description,
          messages = EXCLUDED.messages,
          timestamp = EXCLUDED.timestamp,
          metadata = EXCLUDED.metadata,
          snapshot = EXCLUDED.snapshot
        `,
        [
          id,
          urlId || null,
          description || null,
          encryptForJson(messages),
          timestamp ? new Date(timestamp) : new Date(),
          metadata ? encryptForJson(metadata) : null,
          snapshot ? encryptForJson(snapshot) : null,
        ],
      );

      return Response.json({ success: true });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  } catch (error) {
    console.error('Database error in action:', error);
    return Response.json({ error: 'Database error' }, { status: 500 });
  }
}
