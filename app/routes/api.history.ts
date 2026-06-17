// import { json } from '@remix-run/node';
// import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
// import { query } from '~/lib/db.server';
// import { encryptField, safeDecryptField } from '~/lib/encryption.server';

// /**
//  * Wraps an encrypted string (which is NOT valid JSON) into a JSON string so it
//  * can be stored safely in MySQL's JSON column type.
//  *  store:   encryptField("…") → "iv:base64"  →  JSON.stringify → "\"iv:base64\""
//  *  read:    MySQL auto-parses JSON → plain string "iv:base64" → safeDecryptField → plaintext
//  */
// function encryptForJson(value: any): string {
//   return JSON.stringify(encryptField(JSON.stringify(value)));
// }

// function decryptFromJson(raw: any): any {
//   if (raw == null) return null;
//   try {
//     // mysql2 auto-parses JSON columns — raw may already be a JS value.
//     // If it's a string it's the encrypted payload; otherwise treat as legacy unencrypted data.
//     const encrypted = typeof raw === 'string' ? raw : JSON.stringify(raw);
//     const decrypted = safeDecryptField(encrypted);
//     return decrypted ? JSON.parse(decrypted) : null;
//   } catch {
//     // Legacy unencrypted data — return as-is
//     return raw;
//   }
// }

// export async function loader({ request }: LoaderFunctionArgs) {
//   const url = new URL(request.url);
//   const id = url.searchParams.get('id');

//   try {
//     if (id) {
//       const rows = await query<any[]>('SELECT * FROM builder WHERE id = $1 OR urlId = $2', [id, id]);
//       if (rows.length === 0) return json(null);
//       const chat = rows[0];
//       chat.messages = decryptFromJson(chat.messages);
//       chat.metadata = decryptFromJson(chat.metadata);
//       chat.snapshot = decryptFromJson(chat.snapshot);
//       return json(chat);
//     }

//     const rows = await query<any[]>('SELECT id, urlId, description, timestamp FROM builder ORDER BY timestamp DESC');
//     return json(rows);
//   } catch (error) {
//     console.error('Database error in loader:', error);
//     return json({ error: 'Database error' }, { status: 500 });
//   }
// }

// export async function action({ request }: ActionFunctionArgs) {
//   const method = request.method;

//   try {
//     if (method === 'DELETE') {
//       let id;
//       try {
//         const data = await request.json();
//         id = data.id;
//       } catch {
//         const url = new URL(request.url);
//         id = url.searchParams.get('id');
//       }

//       if (!id) return json({ error: 'Missing ID' }, { status: 400 });

//       await query('DELETE FROM rivinity_webbuilder_chats WHERE id = $1', [id]);
//       return json({ success: true });
//     }

//     const data = (await request.json()) as any;

//     if (method === 'POST') {
//       const { id, urlId, description, messages, timestamp, metadata, snapshot } = data;

//       // Guard: messages must be present and serialisable before touching the DB
//       if (messages === undefined || messages === null) {
//         return json({ error: 'messages field is required' }, { status: 400 });
//       }

//       await query(
//         `INSERT INTO builder (id, urlId, description, messages, timestamp, metadata, snapshot) 
//          VALUES ($1, $2, $3, $4, $5, $6, $7) 
//          ON DUPLICATE KEY UPDATE 
//          messages = VALUES(messages), 
//          description = VALUES(description), 
//          timestamp = VALUES(timestamp), 
//          metadata = VALUES(metadata),
//          snapshot = VALUES(snapshot)`,
//         [
//           id,
//           urlId || null,
//           description || null,
//           // encryptForJson produces a valid JSON string: "\"iv_hex:base64\""
//           encryptForJson(messages),
//           timestamp
//             ? new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ')
//             : new Date().toISOString().slice(0, 19).replace('T', ' '),
//           metadata ? encryptForJson(metadata) : null,
//           snapshot ? encryptForJson(snapshot) : null,
//         ],
//       );
//       return json({ success: true });
//     }

//     return json({ error: 'Method not allowed' }, { status: 405 });
//   } catch (error) {
//     console.error('Database error in action:', error);
//     return json({ error: 'Database error' }, { status: 500 });
//   }
// }

import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { query } from '~/lib/db.server';
import { encryptField, safeDecryptField } from '~/lib/encryption.server';

function encryptForJson(value: any): string {
  return JSON.stringify(encryptField(JSON.stringify(value)));
}

function decryptFromJson(raw: any): any {
  if (raw == null) return null;

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
      const rows = await query<any[]>(
        'SELECT * FROM rivinity_webbuilder_chats WHERE id = $1 OR "urlId" = $2',
        [id, id],
      );

      if (rows.length === 0) {
        return json(null);
      }

      const chat = rows[0];

      chat.messages = decryptFromJson(chat.messages);
      chat.metadata = decryptFromJson(chat.metadata);
      chat.snapshot = decryptFromJson(chat.snapshot);

      return json(chat);
    }

    const rows = await query<any[]>(
      'SELECT id, "urlId", description, timestamp FROM rivinity_webbuilder_chats ORDER BY timestamp DESC',
    );

    return json(rows);
  } catch (error) {
    console.error('Database error in loader:', error);
    return json({ error: 'Database error' }, { status: 500 });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const method = request.method;

  try {
    if (method === 'DELETE') {
      let id;

      try {
        const data = await request.json();
        id = data.id;
      } catch {
        const url = new URL(request.url);
        id = url.searchParams.get('id');
      }

      if (!id) {
        return json({ error: 'Missing ID' }, { status: 400 });
      }

      await query(
        'DELETE FROM rivinity_webbuilder_chats WHERE id = $1',
        [id],
      );

      return json({ success: true });
    }

    const data = await request.json();

    if (method === 'POST') {
      const {
        id,
        urlId,
        description,
        messages,
        timestamp,
        metadata,
        snapshot,
      } = data;

      if (messages === undefined || messages === null) {
        return json(
          { error: 'messages field is required' },
          { status: 400 },
        );
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
          timestamp
            ? new Date(timestamp)
            : new Date(),
          metadata ? encryptForJson(metadata) : null,
          snapshot ? encryptForJson(snapshot) : null,
        ],
      );

      return json({ success: true });
    }

    return json({ error: 'Method not allowed' }, { status: 405 });
  } catch (error) {
    console.error('Database error in action:', error);
    return json({ error: 'Database error' }, { status: 500 });
  }
}
