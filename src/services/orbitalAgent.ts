/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import { toast } from 'sonner';
import { apiService, applyPresignedUrls } from './api';
import { signalRService } from './signalr';
import { presenceStore } from './presenceStore';
import { decryptBatch, encryptFor, getPublicKeyFor } from './cryptoService';
import { playSend } from './sounds';
import { CallType, DirectMessageDto, FriendDto, GroupDto } from '../types/api';

const AGENT_TOOLS: FunctionDeclaration[] = [
  {
    name: 'send_dm',
    description: 'Send an end-to-end encrypted direct message to a friend in Orbital.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        friendId: { type: Type.STRING },
        friendName: { type: Type.STRING },
        message: { type: Type.STRING },
      },
      required: ['friendId', 'friendName', 'message'],
    },
  },
  {
    name: 'send_group_message',
    description: 'Send a message to an Orbital group channel.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        groupId: { type: Type.NUMBER },
        groupName: { type: Type.STRING },
        message: { type: Type.STRING },
      },
      required: ['groupId', 'groupName', 'message'],
    },
  },
  {
    name: 'start_dm_call',
    description: 'Start a 1-on-1 audio or video call with an Orbital friend.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        friendId: { type: Type.STRING },
        friendName: { type: Type.STRING },
        callType: { type: Type.STRING, enum: ['audio', 'video'] },
      },
      required: ['friendId', 'friendName', 'callType'],
    },
  },
  {
    name: 'join_group_call',
    description: 'Initiate or join a group audio voice call in Orbital.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        groupId: { type: Type.NUMBER },
        groupName: { type: Type.STRING },
      },
      required: ['groupId', 'groupName'],
    },
  },
  {
    name: 'summarize_chat',
    description: 'Summarize recent messages in an Orbital DM or group.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetType: { type: Type.STRING, enum: ['dm', 'group'] },
        targetId: { type: Type.STRING },
        targetName: { type: Type.STRING },
      },
      required: ['targetType', 'targetId', 'targetName'],
    },
  },
  {
    name: 'create_group',
    description: 'Create a new Orbital group channel.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        description: { type: Type.STRING },
      },
      required: ['name'],
    },
  },
  {
    name: 'open_chat',
    description: 'Navigate to a DM, group, or Orbital page.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetType: { type: Type.STRING, enum: ['dm', 'group', 'page'] },
        targetId: { type: Type.STRING },
        targetName: { type: Type.STRING },
      },
      required: ['targetType', 'targetId', 'targetName'],
    },
  },
];

export interface AgentContextHandlers {
  currentUserId: string;
  userName?: string;
  activePath: string;
  viaVoice?: boolean;
  navigate: (path: string) => void;
  initiateDmCall: (peerId: string, type: CallType) => Promise<void>;
  joinGroupCall: (groupId: number, groupName?: string) => Promise<void>;
}

export interface AgentQuickAction {
  label: string;
  subtitle?: string;
  avatarUrl?: string;
  path?: string;
  prefill?: string;
  prompt?: string;
}

export interface AgentResult {
  reply: string;
  actionTaken?: boolean;
  quickActions?: AgentQuickAction[];
  pendingContext?: string | null;
  voiceDraft?: {
    kind: 'dm' | 'group';
    targetId: string | number;
    targetName: string;
    message: string;
  };
}

interface TargetRef {
  kind: 'dm' | 'group';
  id: string | number;
  name: string;
}

export interface ScheduledOrbitalMessage {
  id: string;
  userId: string;
  runAt: number;
  kind: 'dm' | 'group';
  targetId: string | number;
  targetName: string;
  message: string;
}

const SCHEDULE_STORAGE_PREFIX = 'orbital.agent.scheduledMsgs.';
let schedulePollerId: number | null = null;

let activeUserSessionId: string | null = null;
let lastTargetByUser: TargetRef | null = null;
let pendingMessageTarget: TargetRef | null = null;
let pendingScheduleDraft: {
  step: 'awaiting_who' | 'awaiting_body' | 'awaiting_when';
  target?: TargetRef;
  message?: string;
} | null = null;

let cachedContext: {
  userId: string;
  fetchedAt: number;
  friends: FriendDto[];
  groups: GroupDto[];
} | null = null;
let inflightListsPromise: Promise<{ friends: FriendDto[]; groups: GroupDto[] }> | null = null;
let cachedAiClient: GoogleGenAI | null = null;

function setLastTarget(ref: TargetRef) {
  lastTargetByUser = ref;
}

export function getScheduledMessagesForUser(userId: string): ScheduledOrbitalMessage[] {
  try {
    const raw = localStorage.getItem(`${SCHEDULE_STORAGE_PREFIX}${userId}`);
    return raw ? (JSON.parse(raw) as ScheduledOrbitalMessage[]) : [];
  } catch {
    return [];
  }
}

export function cancelScheduledMessageById(userId: string, id: string) {
  const remaining = getScheduledMessagesForUser(userId).filter((t) => t.id !== id);
  saveScheduledMessages(userId, remaining);
}

export function clearPendingAgentState() {
  pendingMessageTarget = null;
  pendingScheduleDraft = null;
}

function saveScheduledMessages(userId: string, list: ScheduledOrbitalMessage[]) {
  try {
    localStorage.setItem(`${SCHEDULE_STORAGE_PREFIX}${userId}`, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('orbital:scheduled-updated'));
  } catch { /* ignore */ }
}

function parseScheduleTime(phrase: string): number | null {
  const now = Date.now();
  const rel = phrase.match(
    /\b(?:in|after)\s+(\d+)\s*(sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours)\b/i,
  );
  if (rel) {
    const val = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    if (val <= 0) return null;
    if (unit.startsWith('sec')) return now + val * 1000;
    if (unit.startsWith('min')) return now + val * 60_000;
    if (unit.startsWith('hr') || unit.startsWith('hour')) return now + val * 3_600_000;
  }

  const abs = phrase.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (abs) {
    let hour = Number(abs[1]);
    const minute = abs[2] ? Number(abs[2]) : 0;
    const meridiem = abs[3]?.toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;

    const target = new Date();
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() <= now) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }
  return null;
}

function extractTrailingSchedule(text: string): { body: string; runAt: number } | null {
  const relMatch = text.match(
    /^(.*?)\s+((?:in|after)\s+\d+\s*(?:sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours))$/i,
  );
  if (relMatch) {
    const runAt = parseScheduleTime(relMatch[2]);
    if (runAt) {
      return { body: relMatch[1].trim(), runAt };
    }
  }

  const absMatch = text.match(/^(.*?)\s+(at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i);
  if (absMatch) {
    const runAt = parseScheduleTime(absMatch[2]);
    if (runAt) {
      return { body: absMatch[1].trim(), runAt };
    }
  }

  return null;
}

function isBareTimePhrase(text: string): boolean {
  return /^(?:(?:in|after)\s+)?\d+\s*(?:sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours)$|^at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i.test(
    text.trim(),
  );
}

const inflightScheduledIds = new Set<string>();
const failedScheduledIds = new Set<string>();

function isTransientNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /websocket|signalr|disconnected|closed|network|fetch|timeout|connection|state\s*'/i.test(msg);
}

async function waitForOnlineAndSignalR(maxWaitMs = 8000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (typeof navigator !== 'undefined' && !navigator.onLine && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  while (Date.now() < deadline) {
    if (signalRService.isConnected()) return;
    try {
      await signalRService.start();
      if (signalRService.isConnected()) return;
    } catch {
      // keep retrying until deadline
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

function flushDueScheduledMessages() {
  if (typeof window === 'undefined') return;
  const uid = activeUserSessionId;
  if (!uid) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const list = getScheduledMessagesForUser(uid);
  if (list.length === 0) return;

  const now = Date.now();
  const due = list.filter(
    (t) => t.runAt <= now && !inflightScheduledIds.has(t.id) && !failedScheduledIds.has(t.id),
  );
  if (due.length === 0) return;

  for (const item of due) {
    inflightScheduledIds.add(item.id);
    void (async () => {
      try {
        await waitForOnlineAndSignalR(8000);
        await dispatchOrbitalMessage(
          {
            kind: item.kind,
            targetId: item.targetId,
            targetName: item.targetName,
            message: item.message,
          },
          uid,
        );
        const latest = getScheduledMessagesForUser(uid).filter((t) => t.id !== item.id);
        saveScheduledMessages(uid, latest);
        const label = item.kind === 'group' ? `#${item.targetName}` : item.targetName;
        toast.success(`Scheduled message sent to ${label}`, { description: item.message });
      } catch (err) {
        if (isTransientNetworkError(err)) {
          // Keep in storage so it automatically retries once connection settles
          console.warn('[OrbitalAgent Scheduled Send Deferred - Reconnecting]', err);
        } else {
          failedScheduledIds.add(item.id);
          const latest = getScheduledMessagesForUser(uid).filter((t) => t.id !== item.id);
          saveScheduledMessages(uid, latest);
          console.error('[OrbitalAgent Scheduled Send Error]', err);
          toast.error(`Failed to send scheduled message to ${item.targetName}`, {
            description: formatAgentError(err),
          });
        }
      } finally {
        inflightScheduledIds.delete(item.id);
      }
    })();
  }
}

function ensureSchedulePoller() {
  if (schedulePollerId !== null || typeof window === 'undefined') return;
  schedulePollerId = window.setInterval(flushDueScheduledMessages, 1500);
  const onResume = () => {
    void signalRService.start().catch(() => {});
    window.setTimeout(flushDueScheduledMessages, 600);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onResume();
  });
  window.addEventListener('online', onResume);
  window.addEventListener('focus', onResume);
}

if (typeof window !== 'undefined') {
  ensureSchedulePoller();
}
function buildSmartFallback(
  rawPrompt: string,
  friends: FriendDto[],
  groups: GroupDto[],
  reason?: string,
): AgentResult {
  const lower = rawPrompt.trim().toLowerCase();
  const topFriend = friends[0];
  const topGroup = groups[0];

  const chips: AgentQuickAction[] = [
    { label: 'Make a Call', prefill: 'call ' },
    {
      label: 'Send a Message',
      prefill: topFriend ? `send hi to ${topFriend.displayName.split(' ')[0]} ` : 'send hi to ',
    },
    {
      label: topGroup ? `#${topGroup.name}` : 'Groups',
      path: topGroup ? `/app/groups/${topGroup.id}` : '/app/groups',
    },
  ];

  let suggestion = 'Did you mean make a call or send a message?';
  if (/^(?:car|cal|khal|kola|ring|dial|phone)$/i.test(lower)) {
    suggestion = 'Did you mean make a call? Who would you like to call?';
  } else if (/^(?:msg|txt|text|dm|tell|say|ping)$/i.test(lower)) {
    suggestion = 'Did you mean send a message? Who should I message?';
  } else if (/^(?:pic|photo|dp|avatar|profile)$/i.test(lower)) {
    suggestion = 'Want to change your profile pic in Settings?';
    chips.unshift({ label: 'Open Settings', path: '/app/settings' });
  } else if (reason) {
    suggestion = `Didn't catch "${rawPrompt.slice(0, 36)}". Did you mean one of these?`;
  }

  return {
    reply: suggestion,
    quickActions: chips.slice(0, 3),
    pendingContext: null,
    actionTaken: false,
  };
}

export function formatAgentError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  console.error('[OrbitalAgent Error]', err);
  if (raw.includes('VITE_GEMINI_API_KEY')) return 'Gemini API key is missing in .env.local.';
  if (raw.includes('API_KEY_INVALID') || raw.includes('403') || raw.includes('401')) {
    return 'Invalid Gemini API key. Check your key in Google AI Studio.';
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED') || raw.includes('quota')) {
    return 'Rate limit reached — wait a moment and retry.';
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE')) {
    return 'AI servers are briefly busy. Try again.';
  }
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError')) {
    return 'No internet connection. Check your network.';
  }
  const clean = raw.replace(/^Error:\s*/i, '').trim();
  return clean ? clean.slice(0, 140) : 'Could not complete that request. Try again.';
}

export function syncAgentUserSession(userId: string | undefined) {
  if (activeUserSessionId && activeUserSessionId !== userId) {
    activeUserSessionId = null;
    lastTargetByUser = null;
    pendingMessageTarget = null;
    pendingScheduleDraft = null;
    cachedContext = null;
    inflightListsPromise = null;
  }
  activeUserSessionId = userId ?? null;
  if (userId) {
    ensureSchedulePoller();
    void getUserLists(userId);
  }
}

export function getCachedListsSync(userId: string): { friends: FriendDto[]; groups: GroupDto[] } | null {
  if (cachedContext && cachedContext.userId === userId) {
    return { friends: cachedContext.friends, groups: cachedContext.groups };
  }
  try {
    const fRaw = localStorage.getItem(`orbital.cachedFriends.v2.${userId}`);
    const gRaw = localStorage.getItem(`orbital.cachedGroups.${userId}`);
    if (fRaw || gRaw) {
      return {
        friends: fRaw ? (JSON.parse(fRaw) as FriendDto[]) : [],
        groups: gRaw ? (JSON.parse(gRaw) as GroupDto[]) : [],
      };
    }
  } catch { /* ignore */ }
  return null;
}

export async function getUserLists(userId: string): Promise<{ friends: FriendDto[]; groups: GroupDto[] }> {
  const now = Date.now();
  if (cachedContext && cachedContext.userId === userId && now - cachedContext.fetchedAt < 60_000) {
    return { friends: cachedContext.friends, groups: cachedContext.groups };
  }
  if (inflightListsPromise) return inflightListsPromise;

  inflightListsPromise = Promise.all([
    apiService.getFriends().catch(() => []),
    apiService.getMyGroups().catch(() => []),
  ])
    .then(([friends, groups]) => {
      cachedContext = { userId, fetchedAt: now, friends, groups };
      return { friends, groups };
    })
    .finally(() => {
      inflightListsPromise = null;
    });

  const instant = getCachedListsSync(userId);
  if (instant && (instant.friends.length > 0 || instant.groups.length > 0)) {
    return instant;
  }
  return inflightListsPromise;
}

const FAST_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
];

async function generateWithFallback(
  ai: GoogleGenAI,
  params: {
    contents: string;
    systemInstruction?: string;
    tools?: any[];
    temperature?: number;
  },
) {
  let lastError: unknown;
  for (const model of FAST_MODELS) {
    try {
      return await ai.models.generateContent({
        model,
        contents: params.contents,
        config: {
          systemInstruction: params.systemInstruction,
          tools: params.tools,
          temperature: params.temperature ?? 0.15,
          maxOutputTokens: 180,
        },
      });
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message ?? err ?? '');
      if (
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('429') ||
        msg.includes('404') ||
        msg.includes('400')
      ) {
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function getClient() {
  if (cachedAiClient) return cachedAiClient;
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!apiKey) throw new Error('Missing VITE_GEMINI_API_KEY in .env.local');
  cachedAiClient = new GoogleGenAI({ apiKey });
  return cachedAiClient;
}

export async function dispatchOrbitalMessage(
  payload: { kind: 'dm' | 'group'; targetId: string | number; targetName: string; message: string },
  currentUserId: string,
): Promise<string> {
  if (!currentUserId || activeUserSessionId !== currentUserId) {
    throw new Error('User session changed. Please retry.');
  }

  pendingMessageTarget = null;
  setLastTarget({
    kind: payload.kind,
    id: payload.targetId,
    name: payload.targetName,
  });

  await signalRService.start().catch(() => {});

  if (payload.kind === 'dm') {
    const recipientId = String(payload.targetId);
    const pub = await getPublicKeyFor(recipientId);
    const enc = await encryptFor(pub, payload.message);
    const dto = {
      recipientId,
      ciphertext: enc.ciphertext,
      nonce: enc.nonce,
      mediaUrl: undefined,
      mediaType: undefined,
    };
    try {
      await signalRService.sendDirectMessage(dto);
    } catch {
      await apiService.sendDm(dto);
    }
    playSend();
    return `Sent to ${payload.targetName}`;
  } else {
    const groupId = Number(payload.targetId);
    const clientId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dto = {
      groupId,
      content: `[client:${clientId}]${payload.message}`,
      mediaUrl: undefined,
      mediaType: undefined,
    };
    try {
      await signalRService.joinGroupChannel(groupId);
      await signalRService.sendGroupMessage(dto);
    } catch {
      await apiService.sendGroupMessage(dto);
    }
    playSend();
    return `Sent to #${payload.targetName}`;
  }
}

function scheduleMessage(
  userId: string,
  target: TargetRef,
  message: string,
  runAt: number,
): AgentResult {
  const list = getScheduledMessagesForUser(userId);
  list.push({
    id: `smsg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    userId,
    runAt,
    kind: target.kind,
    targetId: target.id,
    targetName: target.name,
    message,
  });
  saveScheduledMessages(userId, list);
  ensureSchedulePoller();
  flushDueScheduledMessages();
  setLastTarget(target);
  const timeStr = new Date(runAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const label = target.kind === 'group' ? `#${target.name}` : target.name;
  return {
    reply: `Scheduled "${message}" to ${label} for ${timeStr}.`,
    quickActions: [{ label: 'View Scheduled', prompt: 'show scheduled messages' }],
    pendingContext: null,
    actionTaken: true,
  };
}

function normalizeInput(raw: string): string {
  return raw
    .replace(/\b(bro|yaar|bhai|please|kindly|just|actually|basically|umm|uh)\b/gi, ' ')
    .replace(/\bkaro\b/gi, '')
    .replace(/\bbhej\s*do\b/gi, 'send')
    .replace(/\bkhol\s*do\b/gi, 'open')
    .replace(/\bcall\s*lagao\b/gi, 'call')
    .replace(/\bvideo\s*call\s*lagao\b/gi, 'video call')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarityScore(a: string, b: string): number {
  const s1 = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s2.startsWith(s1) || s1.startsWith(s2)) return 0.9;
  if (s2.includes(s1)) return 0.85;

  if (s1.length < 2 || s2.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < s1.length - 1; i++) {
    const bg = s1.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
  }
  let matches = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bg = s2.slice(i, i + 2);
    const count = bigrams.get(bg) ?? 0;
    if (count > 0) {
      bigrams.set(bg, count - 1);
      matches++;
    }
  }
  return (2 * matches) / (s1.length + s2.length - 2);
}

function scoreFriendMatch(q: string, f: FriendDto): number {
  if (q === f.userId.toLowerCase()) return 1.05;
  const firstName = f.displayName.split(/\s+/)[0] ?? '';
  return Math.max(
    similarityScore(q, f.displayName),
    similarityScore(q, firstName),
    similarityScore(q, f.handle),
    similarityScore(q, f.fullHandle ?? ''),
  );
}

function findMatchingFriends(query: string, friends: FriendDto[]): FriendDto[] {
  const q = query.trim().replace(/^@/, '').toLowerCase();
  if (!q) return [];
  const scored = friends
    .map((f) => ({ friend: f, score: scoreFriendMatch(q, f) }))
    .filter((x) => x.score >= 0.78)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];
  const topScore = scored[0].score;
  const tied = scored.filter((x) => Math.abs(x.score - topScore) <= 0.05);
  return (tied.length > 1 ? tied : scored.slice(0, 1)).map((x) => x.friend);
}

function formatFriendChip(
  f: FriendDto,
  promptText: string,
  forceHandle = false,
): AgentQuickAction {
  const online = presenceStore.isOnline(f.userId) || Boolean(f.isOnline);
  const rawHandle = (f.fullHandle || f.handle || '').trim();
  const handleText = rawHandle ? `@${rawHandle.replace(/^@/, '')}` : `#${f.userId.slice(0, 4)}`;
  return {
    label: forceHandle ? `${f.displayName} (${handleText})` : f.displayName,
    subtitle: `${handleText} · ${online ? 'Online' : 'Offline'}`,
    avatarUrl: f.avatarUrl,
    prompt: promptText,
  };
}

let pendingDisambiguation: {
  matches: FriendDto[];
  actionVerb: 'call' | 'message' | 'schedule';
  extraBody?: string;
} | null = null;

function buildFriendDisambiguationResult(
  matches: FriendDto[],
  actionVerb: 'call' | 'message' | 'schedule',
  extraBody?: string,
): AgentResult {
  const sliced = matches.slice(0, 5);
  pendingDisambiguation = { matches: sliced, actionVerb, extraBody };

  const chips: AgentQuickAction[] = sliced.map((f) => {
    const uniqueIdentifier = (f.fullHandle || f.handle || f.userId).trim();
    const promptText =
      actionVerb === 'call'
        ? `call ${uniqueIdentifier}`
        : actionVerb === 'schedule'
          ? `schedule a message to ${uniqueIdentifier}`
          : extraBody
            ? `message ${uniqueIdentifier} ${extraBody}`
            : `message ${uniqueIdentifier}`;
    return formatFriendChip(f, promptText, true);
  });

  return {
    reply: `Found ${sliced.length} people named "${sliced[0].displayName.split(' ')[0]}". Which one?`,
    quickActions: chips,
    pendingContext: `Pick ${sliced[0].displayName.split(' ')[0]}`,
    actionTaken: false,
  };
}

function matchFriend(query: string, friends: FriendDto[]): FriendDto | undefined {
  return findMatchingFriends(query, friends)[0];
}

function matchGroup(query: string, groups: GroupDto[]): GroupDto | undefined {
  const q = query.trim().replace(/^#/, '').toLowerCase();
  if (!q) return undefined;
  let best: { group: GroupDto; score: number } | null = null;
  for (const g of groups) {
    const score = similarityScore(q, g.name);
    if (score >= 0.70 && (!best || score > best.score)) {
      best = { group: g, score };
    }
  }
  return best?.group;
}

function askForMessageBody(target: TargetRef): AgentResult {
  pendingMessageTarget = target;
  setLastTarget(target);
  const label = target.kind === 'group' ? `#${target.name}` : target.name;
  return {
    reply: `What message do you wanna send to ${label}?`,
    pendingContext: `Writing to ${label}`,
    actionTaken: false,
  };
}

async function triggerGroupCall(
  group: GroupDto,
  handlers: AgentContextHandlers,
): Promise<AgentResult> {
  if (!Number.isInteger(group.id) || group.id <= 0) {
    return {
      reply: 'Could not find a valid group to start a call in.',
      pendingContext: null,
      actionTaken: false,
    };
  }

  pendingMessageTarget = null;
  pendingScheduleDraft = null;
  setLastTarget({ kind: 'group', id: group.id, name: group.name });
  handlers.navigate(`/app/groups/${group.id}`);

  await new Promise((resolve) => window.setTimeout(resolve, 150));

  try {
    await signalRService.joinGroupChannel(group.id);
    await handlers.joinGroupCall(group.id, group.name);
    return { reply: `Started call in #${group.name}.`, pendingContext: null, actionTaken: true };
  } catch (err) {
    return {
      reply: `Opened #${group.name}, but couldn't start the call: ${formatAgentError(err)}`,
      pendingContext: null,
      actionTaken: false,
    };
  }
}

function resolveTargetAndBuildSendResult(
  targetRaw: string,
  rawBody: string,
  friends: FriendDto[],
  groups: GroupDto[],
  handlers: AgentContextHandlers,
): Promise<AgentResult> | AgentResult | null {
  const friend = matchFriend(targetRaw, friends);
  const group = matchGroup(targetRaw, groups);
  if (!friend && !group) return null;

  const target: TargetRef =
    friend && !group
      ? { kind: 'dm', id: friend.userId, name: friend.displayName }
      : { kind: 'group', id: group!.id, name: group!.name };

  // Strip leading "saying / that / :" from body
  const cleanedBody = rawBody.replace(/^(?:saying|that|:|-)\s+/i, '').trim();

  // Check if the body ends with a schedule time ("saying hi after 1 min", "hi in 5 mins", "hi at 11:30 pm")
  const sched = extractTrailingSchedule(cleanedBody);
  if (sched) {
    const cleanMsg = sched.body.replace(/^(?:saying|that|:|-)\s+/i, '').trim();
    if (!cleanMsg) {
      pendingScheduleDraft = { step: 'awaiting_body', target };
      const label = target.kind === 'group' ? `#${target.name}` : target.name;
      return {
        reply: `What message do you wanna schedule for ${label}?`,
        pendingContext: `Scheduling to ${label}`,
        actionTaken: false,
      };
    }
    pendingMessageTarget = null;
    pendingScheduleDraft = null;
    return scheduleMessage(handlers.currentUserId, target, cleanMsg, sched.runAt);
  }

  if (!cleanedBody) return askForMessageBody(target);

  setLastTarget(target);
  pendingMessageTarget = null;

  if (handlers.viaVoice) {
    const label = target.kind === 'group' ? `#${target.name}` : target.name;
    return {
      reply: `Message to ${label}:`,
      voiceDraft: { kind: target.kind, targetId: target.id, targetName: target.name, message: cleanedBody },
      pendingContext: null,
      actionTaken: true,
    };
  }

  return dispatchOrbitalMessage(
    { kind: target.kind, targetId: target.id, targetName: target.name, message: cleanedBody },
    handlers.currentUserId,
  ).then((sent) => ({
    reply: `${sent}: "${cleanedBody}"`,
    quickActions: [
      {
        label: target.kind === 'group' ? `Open #${target.name}` : `Open ${target.name}`,
        path: target.kind === 'group' ? `/app/groups/${target.id}` : `/app/dm/${target.id}`,
      },
    ],
    pendingContext: null,
    actionTaken: true,
  }));
}

async function tryZeroTokenIntent(
  prompt: string,
  friends: FriendDto[],
  groups: GroupDto[],
  activeChat: { type: 'dm' | 'group'; id: string; name: string } | null,
  handlers: AgentContextHandlers,
): Promise<AgentResult | null> {
  const cleaned = normalizeInput(prompt.replace(/[.?!]+$/, ''));
  const lower = cleaned.toLowerCase();
  const displayUser = handlers.userName?.trim() || 'there';

  // 1. Global cancel ("cancel", "cancel it", "cancel schedule message", "nevermind", "stop")
  if (/^(?:cancel|clear|delete|remove)\s+(?:all\s+)?(?:schedul(?:e|ed)\s+)?(?:messages?|msgs?|tasks?|schedules?)$/i.test(lower)) {
    saveScheduledMessages(handlers.currentUserId, []);
    pendingScheduleDraft = null;
    pendingMessageTarget = null;
    pendingDisambiguation = null;
    return { reply: 'Cancelled all scheduled messages.', pendingContext: null, actionTaken: true };
  }

  if (/^(?:cancel(?:\s+(?:it|that|this))?|nevermind|stop|forget\s+it)$/i.test(lower)) {
    if (pendingScheduleDraft || pendingMessageTarget) {
      pendingScheduleDraft = null;
      pendingMessageTarget = null;
      return { reply: 'Cancelled.', pendingContext: null, actionTaken: false };
    }
    const scheduled = getScheduledMessagesForUser(handlers.currentUserId);
    if (scheduled.length > 0) {
      const last = scheduled[scheduled.length - 1];
      cancelScheduledMessageById(handlers.currentUserId, last.id);
      return {
        reply: `Cancelled scheduled message "${last.message}" to ${last.targetName}.`,
        pendingContext: null,
        actionTaken: true,
      };
    }
    return { reply: 'Nothing active to cancel right now.', pendingContext: null, actionTaken: false };
  }

  // 2. Open Media (/app/notifications)
  if (/^(?:show\s+(?:me\s+)?|take\s+me\s+to\s+|open\s+|go\s+to\s+)?media(?:\s+(?:gallery|files|photos|tab|page))?$/i.test(lower)) {
    handlers.navigate('/app/notifications');
    return { reply: 'Opened Media.', pendingContext: null, actionTaken: true };
  }

  // 2B. Active disambiguation follow-up ("first one", "second one", "1", "2", or handle)
  if (pendingDisambiguation) {
    const ordinalMap: Record<string, number> = {
      '1': 0, 'first': 0, 'first one': 0, '1st': 0, '1st one': 0, 'top one': 0,
      '2': 1, 'second': 1, 'second one': 1, '2nd': 1, '2nd one': 1, 'last one': 1,
      '3': 2, 'third': 2, 'third one': 2, '3rd': 2,
      '4': 3, 'fourth': 3, 'fourth one': 3, '4th': 3,
    };
    let chosen: FriendDto | undefined;
    if (lower in ordinalMap) {
      chosen = pendingDisambiguation.matches[ordinalMap[lower]];
    } else {
      const exact = findMatchingFriends(cleaned, pendingDisambiguation.matches);
      if (exact.length === 1) chosen = exact[0];
    }

    if (chosen) {
      const { actionVerb, extraBody } = pendingDisambiguation;
      pendingDisambiguation = null;
      const uid = (chosen.fullHandle || chosen.handle || chosen.userId).trim();
      if (actionVerb === 'call') {
        return await runOrbitalAgent(`call ${uid}`, handlers);
      }
      if (actionVerb === 'schedule') {
        pendingScheduleDraft = {
          step: 'awaiting_body',
          target: { kind: 'dm', id: chosen.userId, name: chosen.displayName },
        };
        return {
          reply: `What message do you wanna schedule for ${chosen.displayName}?`,
          pendingContext: `Scheduling for ${chosen.displayName}`,
          actionTaken: false,
        };
      }
      if (extraBody) {
        return await runOrbitalAgent(`message ${uid} ${extraBody}`, handlers);
      }
      return askForMessageBody({ kind: 'dm', id: chosen.userId, name: chosen.displayName });
    }
    pendingDisambiguation = null;
  }

  // 3. List scheduled messages / tasks (including bare "scheduled task" or "scheduled messages")
  if (/^(?:(?:show|list|view|my|check)\s+)?schedul(?:e|ed)\s+(?:messages?|msgs?|tasks?|schedules?)$/i.test(lower)) {
    const list = getScheduledMessagesForUser(handlers.currentUserId);
    if (list.length === 0) {
      return { reply: 'No scheduled messages right now.', pendingContext: null, actionTaken: false };
    }
    const lines = list.map((t, idx) => {
      const timeStr = new Date(t.runAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const label = t.kind === 'group' ? `#${t.targetName}` : t.targetName;
      return `${idx + 1}. "${t.message}" to ${label} at ${timeStr}`;
    });
    return {
      reply: lines.join('\n'),
      quickActions: [{ label: 'Cancel Scheduled', prompt: 'cancel scheduled messages' }],
      pendingContext: null,
      actionTaken: false,
    };
  }

  // 3. Multi-turn message scheduling ("schedule a message" -> who -> what -> when)
  if (pendingScheduleDraft) {
    if (/^(?:cancel|nevermind|stop|forget it)$/i.test(lower)) {
      pendingScheduleDraft = null;
      return { reply: 'Cancelled scheduled message.', pendingContext: null, actionTaken: false };
    }

    if (pendingScheduleDraft.step === 'awaiting_who') {
      const friendMatches = findMatchingFriends(cleaned, friends);
      const friend = friendMatches[0];
      const group = matchGroup(cleaned, groups);
      if (friendMatches.length > 1 && !group) {
        pendingScheduleDraft = null;
        return buildFriendDisambiguationResult(friendMatches, 'schedule');
      }
      if (!friend && !group) {
        const nameCounts = new Map<string, number>();
        for (const f of friends) {
          const key = f.displayName.trim().toLowerCase();
          nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
        }
        return {
          reply: 'Who do you want to send the scheduled message to?',
          quickActions: friends.slice(0, 4).map((f) => {
            const isDup = (nameCounts.get(f.displayName.trim().toLowerCase()) ?? 0) > 1;
            const uid = (f.fullHandle || f.handle || f.userId).trim();
            return formatFriendChip(f, uid, isDup);
          }),
          pendingContext: 'Scheduling · Pick recipient',
          actionTaken: false,
        };
      }
      const target: TargetRef = friend
        ? { kind: 'dm', id: friend.userId, name: friend.displayName }
        : { kind: 'group', id: group!.id, name: group!.name };
      pendingScheduleDraft = { step: 'awaiting_body', target };
      const label = target.kind === 'group' ? `#${target.name}` : target.name;
      return {
        reply: `What message do you wanna schedule for ${label}?`,
        pendingContext: `Scheduling to ${label}`,
        actionTaken: false,
      };
    }

    if (pendingScheduleDraft.step === 'awaiting_body' && pendingScheduleDraft.target) {
      if (/^(?:(?:make\s+a\s+)?(?:call|video\s+call|audio\s+call|voice\s+call)|(?:sch?edule|send)\s+(?:a\s+)?(?:message|msg|text|dm))\b/i.test(lower)) {
        pendingScheduleDraft = null;
      }
    }

    if (pendingScheduleDraft && pendingScheduleDraft.step === 'awaiting_body' && pendingScheduleDraft.target) {
      const msgBody = cleaned.replace(/^(?:send|say|tell|saying)\s+/i, '').trim();
      if (!msgBody) {
        const label =
          pendingScheduleDraft.target.kind === 'group'
            ? `#${pendingScheduleDraft.target.name}`
            : pendingScheduleDraft.target.name;
        return {
          reply: `What message do you wanna schedule for ${label}?`,
          pendingContext: `Scheduling to ${label}`,
          actionTaken: false,
        };
      }
      const label =
        pendingScheduleDraft.target.kind === 'group'
          ? `#${pendingScheduleDraft.target.name}`
          : pendingScheduleDraft.target.name;
      pendingScheduleDraft = { step: 'awaiting_when', target: pendingScheduleDraft.target, message: msgBody };
      return {
        reply: 'When should I send it?',
        quickActions: [
          { label: 'In 1 min', prompt: 'in 1 min' },
          { label: 'In 5 mins', prompt: 'in 5 mins' },
          { label: 'In 15 mins', prompt: 'in 15 mins' },
        ],
        pendingContext: `Scheduling "${msgBody}" to ${label}`,
        actionTaken: false,
      };
    }

    if (pendingScheduleDraft.step === 'awaiting_when' && pendingScheduleDraft.target && pendingScheduleDraft.message) {
      const bareDuration = cleaned.match(
        /^(\d+)\s*(sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours)$/i,
      );
      const timeCandidate = bareDuration ? `in ${bareDuration[1]} ${bareDuration[2]}` : cleaned;
      const runAt = parseScheduleTime(timeCandidate);
      if (!runAt) {
        return {
          reply: 'When should I send it? (e.g. "in 5 mins", "after 1 min", or "at 11:30 pm")',
          quickActions: [
            { label: 'In 1 min', prompt: 'in 1 min' },
            { label: 'In 5 mins', prompt: 'in 5 mins' },
          ],
          pendingContext: 'Scheduling · Pick time',
          actionTaken: false,
        };
      }

      const { target, message } = pendingScheduleDraft;
      pendingScheduleDraft = null;
      return scheduleMessage(handlers.currentUserId, target, message, runAt);
    }
  }

  // 3B. "can you please schedule a message to/for <name>" (without message body yet)
  const scheduleToTargetMatch = cleaned.match(
    /^(?:can\s+you\s+(?:please\s+)?|please\s+)?(?:sch?edule|set\s+up|create)\s+(?:a\s+)?(?:new\s+)?(?:message|msg|text|dm)\s+(?:to|for)\s+(.+)$/i,
  );
  if (scheduleToTargetMatch) {
    const afterTarget = scheduleToTargetMatch[1].trim();
    const withoutSaying = afterTarget.split(/\s+(?:saying|that|:|-)\s+/i)[0].trim();
    const schedSplit = extractTrailingSchedule(withoutSaying);
    const targetRaw = schedSplit ? schedSplit.body.trim() : withoutSaying;
    const friend = matchFriend(targetRaw, friends);
    const group = matchGroup(targetRaw, groups);
    if (friend || group) {
      const target: TargetRef = friend
        ? { kind: 'dm', id: friend.userId, name: friend.displayName }
        : { kind: 'group', id: group!.id, name: group!.name };
      pendingMessageTarget = null;
      pendingScheduleDraft = { step: 'awaiting_body', target };
      const label = target.kind === 'group' ? `#${target.name}` : target.name;
      return {
        reply: `What message do you wanna schedule for ${label}?`,
        pendingContext: `Scheduling to ${label}`,
        actionTaken: false,
      };
    }
  }

  // 4. Bare "schedule a message" / "schedule a task"
  if (/^(?:sch?edule|add|set|create)\s+(?:a\s+)?(?:new\s+)?(?:message|msg|task)$/i.test(lower)) {
    pendingMessageTarget = null;
    pendingScheduleDraft = { step: 'awaiting_who' };
    const nameCounts = new Map<string, number>();
    for (const f of friends) {
      const key = f.displayName.trim().toLowerCase();
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    return {
      reply: 'Who do you want to schedule a message to?',
      quickActions: friends.slice(0, 4).map((f) => {
        const isDup = (nameCounts.get(f.displayName.trim().toLowerCase()) ?? 0) > 1;
        const uid = (f.fullHandle || f.handle || f.userId).trim();
        return formatFriendChip(f, uid, isDup);
      }),
      pendingContext: 'Scheduling · Pick recipient',
      actionTaken: false,
    };
  }

  // 5A. "send [a] message to <name> saying <msg> [in/after <time>]"
  const sendMsgToSayingMatch = cleaned.match(
    /^(?:schedule\s+)?(?:send|deliver)\s+(?:a\s+)?(?:message|msg|text|dm)\s+to\s+(.+?)\s+(?:saying|that|:|-)\s+(.+)$/i,
  );
  if (sendMsgToSayingMatch) {
    const targetRaw = sendMsgToSayingMatch[1].trim();
    const bodyPart = sendMsgToSayingMatch[2].trim();
    const res = resolveTargetAndBuildSendResult(targetRaw, bodyPart, friends, groups, handlers);
    if (res) return await res;
  }

  // 5B. "send <msg> to <name> [in/after <time>]"
  const sendToMatch = cleaned.match(/^(?:schedule\s+)?(?:send|say)\s+(.+?)\s+to\s+(.+)$/i);
  if (sendToMatch) {
    const rawFirst = sendToMatch[1].replace(/^["']|["']$/g, '').trim();
    const afterTo = sendToMatch[2].trim();
    const isEmptyMsgKeyword = /^(?:a\s+)?(?:message|msg|text|dm)$/i.test(rawFirst);

    // Check if afterTo is "<name> saying <msg> [after 1 min]"
    const sayingSplit = afterTo.match(/^(.+?)\s+(?:saying|that|:|-)\s+(.+)$/i);
    if (sayingSplit) {
      const res = resolveTargetAndBuildSendResult(sayingSplit[1], sayingSplit[2], friends, groups, handlers);
      if (res) return await res;
    }

    // Check if afterTo is "<name> in/after <time>"
    const schedSplit = extractTrailingSchedule(afterTo);
    if (schedSplit) {
      const targetRaw = schedSplit.body;
      const friend = matchFriend(targetRaw, friends);
      const group = matchGroup(targetRaw, groups);
      if (friend || group) {
        const target: TargetRef = friend
          ? { kind: 'dm', id: friend.userId, name: friend.displayName }
          : { kind: 'group', id: group!.id, name: group!.name };
        if (isEmptyMsgKeyword) {
          pendingScheduleDraft = { step: 'awaiting_body', target };
          const label = target.kind === 'group' ? `#${target.name}` : target.name;
          return {
            reply: `What message do you wanna schedule for ${label}?`,
            pendingContext: `Scheduling to ${label}`,
            actionTaken: false,
          };
        }
        return scheduleMessage(handlers.currentUserId, target, rawFirst, schedSplit.runAt);
      }
    }

    const body = isEmptyMsgKeyword ? '' : rawFirst;
    const res = resolveTargetAndBuildSendResult(afterTo, body, friends, groups, handlers);
    if (res) return await res;
  }

  // 6. Pending direct message body ("message Paras" -> next utterance is the message)
  if (
    pendingMessageTarget &&
    !/^(cancel|nevermind|stop|forget it)$/i.test(lower) &&
    !/^(call|video call|open|go to|settings|who is online|online|pulse|sch?edule\s+(?:a\s+)?message|send\s+(?:a\s+)?message)\b/i.test(lower)
  ) {
    const target = pendingMessageTarget;
    const label = target.kind === 'group' ? `#${target.name}` : target.name;

    // Guard: if user replied with ONLY a time phrase like "after 1 min", ask for message instead of sending "after 1 min"
    if (isBareTimePhrase(cleaned)) {
      pendingMessageTarget = null;
      pendingScheduleDraft = { step: 'awaiting_body', target };
      return {
        reply: `What message do you wanna schedule for ${label}?`,
        pendingContext: `Scheduling to ${label}`,
        actionTaken: false,
      };
    }

    // Check if user replied "<msg> after 1 min"
    const sched = extractTrailingSchedule(cleaned);
    if (sched && sched.body) {
      pendingMessageTarget = null;
      const cleanMsg = sched.body.replace(/^(?:send|say|tell|saying)\s+/i, '').trim();
      return scheduleMessage(handlers.currentUserId, target, cleanMsg, sched.runAt);
    }

    const msgBody = cleaned.replace(/^(?:send|say|tell|saying)\s+/i, '').trim();
    if (msgBody) {
      if (handlers.viaVoice) {
        pendingMessageTarget = null;
        return {
          reply: `Message to ${label}:`,
          voiceDraft: { kind: target.kind, targetId: target.id, targetName: target.name, message: msgBody },
          pendingContext: null,
          actionTaken: true,
        };
      }
      const sent = await dispatchOrbitalMessage(
        { kind: target.kind, targetId: target.id, targetName: target.name, message: msgBody },
        handlers.currentUserId,
      );
      return {
        reply: `${sent}: "${msgBody}"`,
        quickActions: [
          {
            label: target.kind === 'group' ? `Open #${target.name}` : `Open ${target.name}`,
            path: target.kind === 'group' ? `/app/groups/${target.id}` : `/app/dm/${target.id}`,
          },
        ],
        pendingContext: null,
        actionTaken: true,
      };
    }
  }

  if (/^(cancel|nevermind|stop)$/i.test(lower) && pendingMessageTarget) {
    pendingMessageTarget = null;
    return { reply: 'Cancelled that message.', pendingContext: null, actionTaken: false };
  }

  // 7. "make a call" / "place a call" / "start a call"
  if (/^(?:make|place|start|do)\s+(?:a\s+)?(?:call|voice\s+call|video\s+call)$/i.test(lower)) {
    const online = friends.filter((f) => presenceStore.isOnline(f.userId));
    const chips: AgentQuickAction[] = (online.length > 0 ? online : friends)
      .slice(0, 3)
      .map((f) => ({ label: `Call ${f.displayName.split(' ')[0]}`, prefill: `call ${f.displayName}` }));
    return {
      reply: 'Who do you wanna call?',
      quickActions: chips,
      pendingContext: null,
      actionTaken: false,
    };
  }

  // 8. Ambiguous call pronouns
  if (/^(?:video\s+call|audio\s+call|voice\s+call|call|ring)\s*(?:him|her|them|someone|somebody)?$/i.test(lower)) {
    const online = friends.filter((f) => presenceStore.isOnline(f.userId));
    const chips: AgentQuickAction[] = (online.length > 0 ? online : friends)
      .slice(0, 3)
      .map((f) => ({ label: `Call ${f.displayName.split(' ')[0]}`, prefill: `call ${f.displayName}` }));
    return {
      reply: 'Who would you like to call?',
      quickActions: chips,
      pendingContext: null,
      actionTaken: false,
    };
  }

  // 9. Ambiguous message pronouns
  if (/^(?:tell|message|text|dm|send(?:\s+(?:a\s+)?message)?)\s*(?:him|her|them|someone|somebody)?$/i.test(lower)) {
    if (lastTargetByUser) {
      return askForMessageBody(lastTargetByUser);
    }
    const nameCounts = new Map<string, number>();
    for (const f of friends) {
      const key = f.displayName.trim().toLowerCase();
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    const chips: AgentQuickAction[] = friends.slice(0, 4).map((f) => {
      const isDup = (nameCounts.get(f.displayName.trim().toLowerCase()) ?? 0) > 1;
      const uid = (f.fullHandle || f.handle || f.userId).trim();
      return formatFriendChip(f, `message ${uid}`, isDup);
    });
    return {
      reply: 'Who should I send a message to?',
      quickActions: chips,
      pendingContext: null,
      actionTaken: false,
    };
  }

  // 9B. Standalone greeting (only when NOT in the middle of writing/scheduling a message)
  if (/^(?:hi|hello|hey|yo|namaste|good\s+(?:morning|afternoon|evening))$/i.test(lower)) {
    return {
      reply: `Hey ${displayUser}! How can I help you in Orbital today?`,
      quickActions: [
        { label: 'Who is online', prompt: 'who is online' },
        { label: 'Send a message', prefill: 'message ' },
        { label: 'Watch a movie', prompt: 'I want to watch a movie' },
      ],
      pendingContext: null,
      actionTaken: false,
    };
  }

  // 9C. Watch a movie / Chalachitra intent (handles both "chalachitra" and "chalchitra")
  if (/\b(?:watch\s+(?:a\s+)?movie|watch\s+film|cinema|chala?chitra)\b/i.test(lower)) {
    return {
      reply: `Want to open Media or jump to Chalachitra to watch together?`,
      quickActions: [
        { label: 'Open Media', path: '/app/notifications' },
        { label: 'Open Orbit', path: '/app/orbit' },
        { label: 'Open Chalachitra', path: 'https://orbitalhq.vercel.app' },
      ],
      pendingContext: null,
      actionTaken: false,
    };
  }

  // 10. Change profile pic / avatar -> open Settings
  if (/^(?:change|update|set|edit)\s+(?:my\s+)?(?:profile\s+)?(?:pic|picture|photo|avatar|dp)$/i.test(lower)) {
    handlers.navigate('/app/settings');
    return { reply: 'Opened Settings so you can change your profile pic.', pendingContext: null, actionTaken: true };
  }

  if (/^(?:car|cal|khal|kola)$/i.test(lower)) {
    return buildSmartFallback(prompt, friends, groups);
  }

  if (/^ring\s+(.+)$/i.test(cleaned)) {
    const targetName = cleaned.replace(/^ring\s+/i, '').trim();
    const friend = matchFriend(targetName, friends);
    if (friend) {
      if (!presenceStore.isOnline(friend.userId)) {
        return {
          reply: `${friend.displayName} is offline right now.`,
          quickActions: [
            { label: `Message ${friend.displayName.split(' ')[0]}`, prompt: `message ${friend.displayName}` },
            { label: 'Open Chat', path: `/app/dm/${friend.userId}` },
          ],
          pendingContext: null,
          actionTaken: false,
        };
      }
      await handlers.initiateDmCall(friend.userId, CallType.Audio);
      return { reply: `Calling ${friend.displayName}…`, pendingContext: null, actionTaken: true };
    }
    return { reply: 'Who would you like to call?', pendingContext: null, actionTaken: false };
  }

  if (/^(pulse|quick reach|who is online|online|who's around)$/.test(lower)) {
    const online = friends.filter((f) => presenceStore.isOnline(f.userId));
    const chips: AgentQuickAction[] = [
      ...online.slice(0, 3).map((f) => ({ label: `● ${f.displayName.split(' ')[0]}`, path: `/app/dm/${f.userId}` })),
      ...groups.slice(0, 2).map((g) => ({ label: `#${g.name}`, path: `/app/groups/${g.id}` })),
    ];
    const summary =
      online.length > 0
        ? `${online.length} online now: ${online.map((f) => f.displayName).join(', ')}.`
        : 'No friends online right now.';
    return { reply: summary, quickActions: chips, pendingContext: null, actionTaken: false };
  }

  const groupCallMatch = cleaned.match(/^(?:start|initiate|join)?\s*group\s*(?:call|voice)(?:\s+(?:in|for)\s+(.+))?$/i);
  if (groupCallMatch) {
    const specified = groupCallMatch[1]?.trim();
    const targetGroup =
      (specified ? matchGroup(specified, groups) : undefined) ??
      (activeChat?.type === 'group' ? groups.find((g) => String(g.id) === activeChat.id) : undefined) ??
      (lastTargetByUser?.kind === 'group' ? groups.find((g) => g.id === Number(lastTargetByUser?.id)) : undefined) ??
      groups[0];

    if (targetGroup) {
      return await triggerGroupCall(targetGroup, handlers);
    }
  }

  const callMatch = cleaned.match(/^(video\s+call|audio\s+call|voice\s+call|call)\s+(.+)$/i);
  if (callMatch) {
    const isVideo = /video/i.test(callMatch[1]);
    const targetRaw = callMatch[2].trim();
    const friendMatches = findMatchingFriends(targetRaw, friends);
    const friend = friendMatches[0];
    const group = matchGroup(targetRaw, groups);

    if (friendMatches.length > 1 && !group) {
      return buildFriendDisambiguationResult(friendMatches, 'call');
    }

    if (group && !friend) {
      return await triggerGroupCall(group, handlers);
    }

    if (friend && !group) {
      setLastTarget({ kind: 'dm', id: friend.userId, name: friend.displayName });
      if (!presenceStore.isOnline(friend.userId)) {
        return {
          reply: `${friend.displayName} is offline right now. Want to send a message instead?`,
          quickActions: [
            { label: `Message ${friend.displayName.split(' ')[0]}`, prompt: `message ${friend.displayName}` },
            { label: 'Open Chat', path: `/app/dm/${friend.userId}` },
          ],
          pendingContext: null,
          actionTaken: false,
        };
      }
      await handlers.initiateDmCall(friend.userId, isVideo ? CallType.Video : CallType.Audio);
      return { reply: `Calling ${friend.displayName}…`, pendingContext: null, actionTaken: true };
    }
  }

  if (/^(?:open|go to)\s+(?:that|last)\s+chat$/i.test(lower) && lastTargetByUser) {
    const path = lastTargetByUser.kind === 'dm' ? `/app/dm/${lastTargetByUser.id}` : `/app/groups/${lastTargetByUser.id}`;
    handlers.navigate(path);
    return { reply: `Opened ${lastTargetByUser.name}.`, pendingContext: null, actionTaken: true };
  }

  const openMatch = cleaned.match(/^(?:open|go to|chat with|talk to|switch to)(?:\s+chat\s+with|\s+dm|\s+group)?\s+(.+)$/i);
  if (openMatch) {
    const targetRaw = openMatch[1].trim();
    const pageRoutes: Record<string, string> = {
      orbit: '/app/orbit',
      messages: '/app/dm',
      chats: '/app/dm',
      groups: '/app/groups',
      friends: '/app/friends',
      calls: '/app/calls',
      settings: '/app/settings',
      media: '/app/notifications',
      notifications: '/app/notifications',
    };
    if (pageRoutes[targetRaw.toLowerCase()]) {
      handlers.navigate(pageRoutes[targetRaw.toLowerCase()]);
      return { reply: `Opened ${targetRaw}.`, pendingContext: null, actionTaken: true };
    }

    const friend = matchFriend(targetRaw, friends);
    const group = matchGroup(targetRaw, groups);
    if (friend && !group) {
      setLastTarget({ kind: 'dm', id: friend.userId, name: friend.displayName });
      handlers.navigate(`/app/dm/${friend.userId}`);
      return { reply: `Opened chat with ${friend.displayName}.`, pendingContext: null, actionTaken: true };
    }
    if (group && !friend) {
      setLastTarget({ kind: 'group', id: group.id, name: group.name });
      handlers.navigate(`/app/groups/${group.id}`);
      return { reply: `Opened #${group.name}.`, pendingContext: null, actionTaken: true };
    }
  }

  // "tell/message/text/dm/send [name]" or "tell/message/text/dm/send [name] [message]"
  const msgMatch = cleaned.match(/^(?:tell|message|text|dm|send)\s+(.+)$/i);
  if (msgMatch) {
    const rest = msgMatch[1].trim();
    if (/^(?:them|him|her)$/i.test(rest) && lastTargetByUser) {
      return askForMessageBody(lastTargetByUser);
    }

    if (/^(?:them|him|her)\s+/i.test(rest) && lastTargetByUser) {
      const body = rest.replace(/^(?:them|him|her)\s+(?:that|saying|:|-)?\s*/i, '').trim();
      if (!body) return askForMessageBody(lastTargetByUser);
      const sched = extractTrailingSchedule(body);
      if (sched && sched.body) {
        return scheduleMessage(handlers.currentUserId, lastTargetByUser, sched.body, sched.runAt);
      }
      if (handlers.viaVoice) {
        return {
          reply: `Message to ${lastTargetByUser.name}:`,
          voiceDraft: {
            kind: lastTargetByUser.kind,
            targetId: lastTargetByUser.id,
            targetName: lastTargetByUser.name,
            message: body,
          },
          pendingContext: null,
          actionTaken: true,
        };
      }
      const sent = await dispatchOrbitalMessage(
        {
          kind: lastTargetByUser.kind,
          targetId: lastTargetByUser.id,
          targetName: lastTargetByUser.name,
          message: body,
        },
        handlers.currentUserId,
      );
      return { reply: `${sent}: "${body}"`, pendingContext: null, actionTaken: true };
    }

    const wholeFriendMatches = findMatchingFriends(rest, friends);
    const wholeFriend = wholeFriendMatches[0];
    const wholeGroup = matchGroup(rest, groups);
    if (wholeFriendMatches.length > 1 && !wholeGroup) {
      return buildFriendDisambiguationResult(wholeFriendMatches, 'message');
    }
    if (wholeFriend && !wholeGroup) {
      return askForMessageBody({ kind: 'dm', id: wholeFriend.userId, name: wholeFriend.displayName });
    }
    if (wholeGroup && !wholeFriend) {
      return askForMessageBody({ kind: 'group', id: wholeGroup.id, name: wholeGroup.name });
    }

    const words = rest.split(/\s+/);
    for (const wordCount of [2, 1]) {
      if (words.length <= wordCount) continue;
      const candidateName = words.slice(0, wordCount).join(' ');
      const body = words.slice(wordCount).join(' ').trim();
      if (!body) continue;

      const res = resolveTargetAndBuildSendResult(candidateName, body, friends, groups, handlers);
      if (res) return await res;
    }
  }

  return null;
}

export async function runOrbitalAgent(
  prompt: string,
  handlers: AgentContextHandlers,
): Promise<AgentResult> {
  if (/\b(who\s+(made|built|created|developed|owns)|creator\s+of|developer\s+of|founder\s+of)\s+(orbital|this\s+app|you)\b/i.test(prompt.trim())) {
    return { reply: 'Orbital was made by Mayank Pal.', pendingContext: null, actionTaken: false };
  }
  syncAgentUserSession(handlers.currentUserId);
  const { friends, groups } = await getUserLists(handlers.currentUserId);

  let activeChat: { type: 'dm' | 'group'; id: string; name: string } | null = null;
  const dmMatch = handlers.activePath.match(/^\/app\/dm\/([^/]+)/);
  if (dmMatch) {
    const f = friends.find((x) => x.userId === dmMatch[1]);
    if (f) activeChat = { type: 'dm', id: f.userId, name: f.displayName };
  }
  const groupMatch = handlers.activePath.match(/^\/app\/groups\/(\d+)/);
  if (groupMatch) {
    const g = groups.find((x) => String(x.id) === groupMatch[1]);
    if (g) activeChat = { type: 'group', id: String(g.id), name: g.name };
  }

  const localResult = await tryZeroTokenIntent(prompt, friends, groups, activeChat, handlers);
  if (localResult) return localResult;

  try {
    const ai = getClient();
    const compactFriends = friends
      .slice(0, 40)
      .map((f) => `${f.userId}|${f.displayName}|@${f.handle}|${presenceStore.isOnline(f.userId) ? 'on' : 'off'}`)
      .join('; ');
    const compactGroups = groups
      .slice(0, 30)
      .map((g) => `${g.id}|${g.name}`)
      .join('; ');

    const systemInstruction = `
You are Orbital Assistant, strictly an in-app action assistant for Orbital (chat & calling app), created by Mayank Pal.
- Greet the user naturally using their name/username when appropriate (${handlers.userName || 'User'}).
- STRICT SCOPE: ONLY handle Orbital app actions: sending/scheduling DMs or group messages, starting/joining calls, opening chats/pages (messages, groups, settings, media), checking who is online, summarizing chats, or answering who made Orbital ("Orbital was made by Mayank Pal.").
- REFUSE ALL OFF-TOPIC QUESTIONS: Never answer general knowledge, geography, trivia, history, math, coding, definitions, or world facts (e.g. "where is Texas", "what is Odisha", "who is president"). For ANY non-Orbital question, do NOT call any tool and reply ONLY: "I can only help with Orbital chats, calls, and scheduled messages."
- If the user wants to send a message without specifying the message text, ask "What message do you wanna send to <name>?" instead of sending an empty message.
- Never call start_dm_call if status is "off".
- Keep replies clear, natural, and under 16 words.

OpenChat: ${activeChat ? `${activeChat.type}:${activeChat.id}:${activeChat.name}` : 'none'}
Friends(id|name|handle|status): ${compactFriends || 'none'}
Groups(id|name): ${compactGroups || 'none'}
`.trim();

    const response = await generateWithFallback(ai, {
      contents: prompt.slice(0, 300),
      systemInstruction,
      tools: [{ functionDeclarations: AGENT_TOOLS }],
      temperature: 0.15,
    });

    const call = response.functionCalls?.[0];
    if (!call) {
      const text = response.text?.trim();
      if (!text) {
        return buildSmartFallback(prompt, friends, groups, 'no-tool');
      }
      return { reply: text, pendingContext: null, actionTaken: false };
    }

    const args = (call.args ?? {}) as Record<string, unknown>;

    switch (call.name) {
      case 'send_dm': {
        const friendId = String(args.friendId);
        const friendName = String(args.friendName);
        const message = String(args.message ?? '').trim();
        const ref: TargetRef = { kind: 'dm', id: friendId, name: friendName };
        if (!message) return askForMessageBody(ref);
        setLastTarget(ref);
        if (handlers.viaVoice) {
          return {
            reply: `Message to ${friendName}:`,
            voiceDraft: { kind: 'dm', targetId: friendId, targetName: friendName, message },
            pendingContext: null,
            actionTaken: true,
          };
        }
        const reply = await dispatchOrbitalMessage(
          { kind: 'dm', targetId: friendId, targetName: friendName, message },
          handlers.currentUserId,
        );
        return {
          reply: `${reply}: "${message}"`,
          quickActions: [{ label: `Open ${friendName}`, path: `/app/dm/${friendId}` }],
          pendingContext: null,
          actionTaken: true,
        };
      }

      case 'send_group_message': {
        const groupId = Number(args.groupId);
        const groupName = String(args.groupName);
        const message = String(args.message ?? '').trim();
        const ref: TargetRef = { kind: 'group', id: groupId, name: groupName };
        if (!message) return askForMessageBody(ref);
        setLastTarget(ref);
        if (handlers.viaVoice) {
          return {
            reply: `Message to #${groupName}:`,
            voiceDraft: { kind: 'group', targetId: groupId, targetName: groupName, message },
            pendingContext: null,
            actionTaken: true,
          };
        }
        const reply = await dispatchOrbitalMessage(
          { kind: 'group', targetId: groupId, targetName: groupName, message },
          handlers.currentUserId,
        );
        return {
          reply: `${reply}: "${message}"`,
          quickActions: [{ label: `Open #${groupName}`, path: `/app/groups/${groupId}` }],
          pendingContext: null,
          actionTaken: true,
        };
      }

      case 'create_group': {
        const name = String(args.name).trim();
        const description = args.description ? String(args.description).trim() : undefined;
        const created = await apiService.createGroup({ name, description });
        cachedContext = null;
        setLastTarget({ kind: 'group', id: created.id, name: created.name });
        handlers.navigate(`/app/groups/${created.id}`);
        return { reply: `Created and opened #${created.name}.`, pendingContext: null, actionTaken: true };
      }

      case 'start_dm_call': {
        const friendId = String(args.friendId);
        const friendName = String(args.friendName);
        const isVideo = args.callType === 'video';
        setLastTarget({ kind: 'dm', id: friendId, name: friendName });
        if (!presenceStore.isOnline(friendId)) {
          return {
            reply: `${friendName} is offline right now. Want to send a message instead?`,
            quickActions: [
              { label: `Message ${friendName.split(' ')[0]}`, prompt: `message ${friendName}` },
              { label: 'Open Chat', path: `/app/dm/${friendId}` },
            ],
            pendingContext: null,
            actionTaken: false,
          };
        }
        await handlers.initiateDmCall(friendId, isVideo ? CallType.Video : CallType.Audio);
        return { reply: `Calling ${friendName}…`, pendingContext: null, actionTaken: true };
      }

      case 'join_group_call': {
        const groupId = Number(args.groupId);
        const groupName = String(args.groupName);
        const matched = groups.find((g) => g.id === groupId) ?? {
          id: groupId,
          name: groupName || `Group ${groupId}`,
          memberCount: 0,
        };
        return await triggerGroupCall(matched, handlers);
      }

      case 'open_chat': {
        const targetType = String(args.targetType);
        const targetId = String(args.targetId);
        const targetName = String(args.targetName);
        if (targetType === 'page') {
          handlers.navigate(targetId.startsWith('/') ? targetId : `/app/${targetId}`);
        } else {
          setLastTarget({ kind: targetType === 'dm' ? 'dm' : 'group', id: targetId, name: targetName });
          handlers.navigate(targetType === 'dm' ? `/app/dm/${targetId}` : `/app/groups/${targetId}`);
        }
        return { reply: `Opened ${targetName}.`, pendingContext: null, actionTaken: true };
      }

      case 'summarize_chat': {
        const targetType = String(args.targetType);
        const targetId = String(args.targetId);
        const targetName = String(args.targetName);

        let transcript = '';
        if (targetType === 'dm') {
          const res = await apiService.getDmHistory(targetId, 18);
          const hydrated = applyPresignedUrls(res.messages, res.presignedUrls);
          const decrypted: DirectMessageDto[] = await decryptBatch(hydrated, handlers.currentUserId);
          transcript = decrypted
            .reverse()
            .map((m) => `${m.senderId === handlers.currentUserId ? 'Me' : targetName}: ${(m.plaintext ?? m.content ?? '[media]').slice(0, 140)}`)
            .join('\n');
        } else {
          const res = await apiService.getGroupMessages(Number(targetId), 18);
          transcript = res.messages
            .reverse()
            .filter((m) => m.content && !m.content.startsWith('[react:') && !m.content.startsWith('[del:'))
            .map((m) => `${m.senderDisplayName}: ${m.content.replace(/^\[client:[^\]]+\]/, '').slice(0, 140)}`)
            .join('\n');
        }

        if (!transcript.trim()) {
          return { reply: `No recent messages in ${targetName}.`, pendingContext: null, actionTaken: false };
        }

        const summaryRes = await generateWithFallback(ai, {
          contents: `Summarize this chat with ${targetName} in 3 brief bullet points:\n\n${transcript}`,
        });

        return { reply: summaryRes.text || 'Could not summarize chat.', pendingContext: null, actionTaken: false };
      }

      default:
        return buildSmartFallback(prompt, friends, groups);
    }
  } catch {
    return buildSmartFallback(prompt, friends, groups, 'fallback');
  }
}



