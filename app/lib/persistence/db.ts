import type { Message } from 'ai';
import type { ChatHistoryItem } from './useChatHistory';
import type { Snapshot } from './types';

export interface IChatMetadata {
  gitUrl: string;
  gitBranch?: string;
  netlifySiteId?: string;
}

// Return a dummy object to satisfy consumers, or just true
export async function openDatabase(): Promise<any | undefined> {
  return { type: 'mysql' };
}

export async function getAll(_db: any): Promise<ChatHistoryItem[]> {
  const response = await fetch('/api/history');

  if (!response.ok) {
    throw new Error('Failed to fetch chats');
  }

  return await response.json();
}

export async function setMessages(
  _db: any,
  id: string,
  messages: Message[],
  urlId?: string,
  description?: string,
  timestamp?: string,
  metadata?: IChatMetadata,
): Promise<void> {
  const response = await fetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      messages,
      urlId,
      description,
      timestamp: timestamp ?? new Date().toISOString(),
      metadata,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to save chat');
  }
}

export async function getMessages(_db: any, id: string): Promise<ChatHistoryItem> {
  const response = await fetch(`/api/history?id=${id}`);

  if (!response.ok) {
    return null as any;
  }

  const data = (await response.json()) as ChatHistoryItem;

  return data;
}

export async function getMessagesByUrlId(db: any, id: string): Promise<ChatHistoryItem> {
  return getMessages(db, id);
}

export async function getMessagesById(db: any, id: string): Promise<ChatHistoryItem> {
  return getMessages(db, id);
}

export async function deleteById(_db: any, id: string): Promise<void> {
  await fetch('/api/history', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

export async function getNextId(_db: any): Promise<string> {
  return Date.now().toString();
}

export async function getUrlId(_db: any, id: string): Promise<string> {
  const response = await fetch('/api/history'); // Get all to check urlIds

  if (!response.ok) {
    return id;
  }

  const chats: any[] = await response.json();
  const idList = chats.map((c) => c.urlId);

  if (!idList.includes(id)) {
    return id;
  } else {
    let i = 2;

    while (idList.includes(`${id}-${i}`)) {
      i++;
    }

    return `${id}-${i}`;
  }
}

export async function forkChat(db: any, chatId: string, messageId: string): Promise<string> {
  const chat = await getMessages(db, chatId);

  if (!chat) {
    throw new Error('Chat not found');
  }

  // Find the index of the message to fork at
  const messageIndex = chat.messages.findIndex((msg: any) => msg.id === messageId);

  if (messageIndex === -1) {
    throw new Error('Message not found');
  }

  // Get messages up to and including the selected message
  const messages = chat.messages.slice(0, messageIndex + 1);

  return createChatFromMessages(db, chat.description ? `${chat.description} (fork)` : 'Forked chat', messages);
}

export async function duplicateChat(db: any, id: string): Promise<string> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  return createChatFromMessages(db, `${chat.description || 'Chat'} (copy)`, chat.messages);
}

export async function createChatFromMessages(
  db: any,
  description: string,
  messages: Message[],
  metadata?: IChatMetadata,
): Promise<string> {
  const newId = await getNextId(db);
  const newUrlId = await getUrlId(db, newId);

  await setMessages(db, newId, messages, newUrlId, description, undefined, metadata);

  return newUrlId;
}

export async function updateChatDescription(db: any, id: string, description: string): Promise<void> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  } // No change needed for this logic, just reused getMessages/setMessages which are already API-based.

  await setMessages(db, id, chat.messages, chat.urlId, description, chat.timestamp, chat.metadata);
}

export async function updateChatMetadata(db: any, id: string, metadata: IChatMetadata | undefined): Promise<void> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  await setMessages(db, id, chat.messages, chat.urlId, chat.description, chat.timestamp, metadata);
}

export async function getSnapshot(db: any, chatId: string): Promise<Snapshot | undefined> {
  const chat = await getMessages(db, chatId);
  return (chat as any)?.snapshot;
}

export async function setSnapshot(db: any, chatId: string, snapshot: Snapshot): Promise<void> {
  const chat = await getMessages(db, chatId);

  if (!chat) {
    return;
  } // Or throw

  await fetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: chat.id,
      messages: chat.messages,
      urlId: chat.urlId,
      description: chat.description,
      timestamp: chat.timestamp,
      metadata: chat.metadata,
      snapshot,
    }),
  });
}

export async function deleteSnapshot(db: any, chatId: string): Promise<void> {
  const chat = await getMessages(db, chatId);

  if (!chat) {
    return;
  }
}
