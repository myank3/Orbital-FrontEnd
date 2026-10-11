/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Image as ImageIcon,
  Video as VideoIcon,
  Music,
  FileText,
  Download,
  Loader2,
  Search,
  X,
  Play,
  Inbox,
  ArrowRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { Avatar } from './Avatar';
import {
  DirectMessageDto,
  FriendDto,
  GroupDto,
  GroupMessageDto,
  MediaType,
} from '../types/api';

/* ────────────────────────────────────────────────────────── */
/* Types                                                      */
/* ────────────────────────────────────────────────────────── */

type MediaKind = 'image' | 'video' | 'audio' | 'file';

interface MediaItem {
  id: string;
  url: string;
  kind: MediaKind;
  mediaType: number;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  context: string;
  contextKind: 'dm' | 'group';
  contextId: string;
  sentAt: string;
}

function mediaKindOf(mediaType: number): MediaKind | null {
  switch (mediaType) {
    case MediaType.Image:
      return 'image';
    case MediaType.Video:
      return 'video';
    case MediaType.Audio:
      return 'audio';
    case MediaType.File:
      return 'file';
    default:
      return null;
  }
}

/* ────────────────────────────────────────────────────────── */
/* Pane                                                       */
/* ────────────────────────────────────────────────────────── */

function NotificationsPane(): React.JSX.Element {
  const navigate = useNavigate();

  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState('Loading…');
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'all' | MediaKind>('all');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<MediaItem | null>(null);

  /* ── Load every DM + group, collect media ─────────────── */
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      const collected: MediaItem[] = [];

      try {
        setProgress('Loading friends…');
        const friends: FriendDto[] = await apiService.getFriends().catch(() => []);

        setProgress('Loading groups…');
        const groups: GroupDto[] = await apiService.getMyGroups().catch(() => []);

        // DM media
        let dmDone = 0;
        if (friends.length > 0) {
          setProgress(`Loading DMs (0/${friends.length})…`);
          await Promise.all(
            friends.map(async (friend) => {
              try {
                const msgs: DirectMessageDto[] = await apiService.getDmHistory(
                  friend.userId,
                  100,
                );
                for (const m of msgs) {
                  if (!m.mediaUrl) continue;
                  const kind = mediaKindOf(m.mediaType);
                  if (!kind) continue;
                  const isMe = m.senderId !== friend.userId;
                  collected.push({
                    id: `dm-${m.id}`,
                    url: m.mediaUrl,
                    kind,
                    mediaType: m.mediaType,
                    senderId: m.senderId,
                    senderName: isMe ? 'You' : friend.displayName,
                    senderAvatar: isMe ? null : friend.avatarUrl,
                    context: friend.displayName,
                    contextKind: 'dm',
                    contextId: friend.userId,
                    sentAt: m.sentAt,
                  });
                }
              } catch {
                /* ignore per-friend failures */
              } finally {
                dmDone += 1;
                if (!cancelled) {
                  setProgress(`Loading DMs (${dmDone}/${friends.length})…`);
                }
              }
            }),
          );
        }

        // Group media
        let grpDone = 0;
        if (groups.length > 0) {
          setProgress(`Loading groups (0/${groups.length})…`);
          await Promise.all(
            groups.map(async (group) => {
              try {
                const msgs: GroupMessageDto[] = await apiService.getGroupMessages(
                  group.id,
                  100,
                );
                for (const m of msgs) {
                  if (!m.mediaUrl) continue;
                  const kind = mediaKindOf(m.mediaType);
                  if (!kind) continue;
                  collected.push({
                    id: `grp-${m.id}`,
                    url: m.mediaUrl,
                    kind,
                    mediaType: m.mediaType,
                    senderId: m.senderId,
                    senderName: m.senderDisplayName || 'User',
                    senderAvatar: m.senderAvatarUrl ?? null,
                    context: `# ${group.name}`,
                    contextKind: 'group',
                    contextId: String(group.id),
                    sentAt: m.sentAt,
                  });
                }
              } catch {
                /* ignore per-group failures */
              } finally {
                grpDone += 1;
                if (!cancelled) {
                  setProgress(`Loading groups (${grpDone}/${groups.length})…`);
                }
              }
            }),
          );
        }

        if (cancelled) return;

        collected.sort(
          (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
        );
        setItems(collected);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load media.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    return {
      all: items.length,
      image: items.filter((i) => i.kind === 'image').length,
      video: items.filter((i) => i.kind === 'video').length,
      audio: items.filter((i) => i.kind === 'audio').length,
      file: items.filter((i) => i.kind === 'file').length,
    };
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (tab !== 'all' && i.kind !== tab) return false;
      if (!q) return true;
      return (
        i.senderName.toLowerCase().includes(q) ||
        i.context.toLowerCase().includes(q)
      );
    });
  }, [items, tab, query]);

  return (
    <div className="h-full flex flex-col bg-[#0B0A08] text-[#EDE5D4] overflow-hidden">
      {/* Header */}
      <div className="h-16 px-4 sm:px-6 border-b border-white/[0.05] flex items-center gap-3 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[#D97706] shrink-0">
          <ImageIcon className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] sm:text-[15.5px] font-semibold text-[#EDE5D4] tracking-tight truncate">
            Media
          </h2>
          <p className="text-[11px] sm:text-[11.5px] text-[#6B6259] truncate mt-0.5">
            {loading
              ? progress
              : `${counts.all} item${counts.all === 1 ? '' : 's'} across your chats`}
          </p>
        </div>
      </div>

      {/* Tabs + search */}
      <div className="px-4 sm:px-6 py-3 border-b border-white/[0.05] flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto">
          <Tab
            label="All"
            icon={Inbox}
            active={tab === 'all'}
            count={counts.all}
            onClick={() => setTab('all')}
          />
          <Tab
            label="Images"
            icon={ImageIcon}
            active={tab === 'image'}
            count={counts.image}
            onClick={() => setTab('image')}
          />
          <Tab
            label="Videos"
            icon={VideoIcon}
            active={tab === 'video'}
            count={counts.video}
            onClick={() => setTab('video')}
          />
          <Tab
            label="Audio"
            icon={Music}
            active={tab === 'audio'}
            count={counts.audio}
            onClick={() => setTab('audio')}
          />
          <Tab
            label="Files"
            icon={FileText}
            active={tab === 'file'}
            count={counts.file}
            onClick={() => setTab('file')}
          />
        </div>

        <div className="flex-1 sm:max-w-xs sm:ml-auto flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#0F0D0A] border border-white/[0.08] focus-within:border-[#D97706]/50 transition-colors">
          <Search className="w-3.5 h-3.5 text-[#6B6259] shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by sender or chat..."
            className="flex-1 bg-transparent text-[12.5px] text-[#EDE5D4] placeholder-[#6B6259] outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-0.5 rounded text-[#6B6259] hover:text-[#EDE5D4]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {error ? (
          <div className="max-w-md mx-auto mt-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#B91C1C]/10 border border-[#B91C1C]/20 flex items-center justify-center mx-auto">
              <X className="w-7 h-7 text-[#F87171]" />
            </div>
            <p className="text-[14.5px] text-[#F87171] font-semibold tracking-tight mt-4">
              Could not load media
            </p>
            <p className="text-[12.5px] text-[#6B6259] mt-1">{error}</p>
          </div>
        ) : loading ? (
          <div className="h-40 flex items-center justify-center text-[12.5px] text-[#6B6259]">
            <Loader2 className="w-4 h-4 animate-spin mr-2 text-[#D97706]" />
            {progress}
          </div>
        ) : filtered.length === 0 ? (
          <div className="max-w-md mx-auto mt-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto">
              <ImageIcon className="w-7 h-7 text-[#6B6259]" />
            </div>
            <p className="text-[14.5px] text-[#EDE5D4] font-semibold tracking-tight mt-4">
              {items.length === 0 ? 'No media yet' : 'No matches'}
            </p>
            <p className="text-[12.5px] text-[#6B6259] mt-1 leading-relaxed max-w-sm mx-auto">
              {items.length === 0
                ? 'Images, videos, audio, and files from your DMs and groups will appear here.'
                : 'Try a different tab or search term.'}
            </p>
            {items.length === 0 && (
              <button
                onClick={() => navigate('/app/dm')}
                className="mt-5 h-9 px-4 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors"
              >
                <span>Open Messages</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map((item) => (
              <MediaTile key={item.id} item={item} onOpen={() => setPreview(item)} />
            ))}
          </div>
        )}
      </div>

      {/* Preview modal */}
      {preview && <PreviewModal item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Tab                                                        */
/* ────────────────────────────────────────────────────────── */

function Tab({
  label,
  icon: Icon,
  active,
  count,
  onClick,
}: {
  label: string;
  icon: React.ElementType;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 h-8 px-3 rounded-lg text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5 ${
        active
          ? 'bg-white/[0.06] text-[#EDE5D4] border border-white/[0.08]'
          : 'text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.035] border border-transparent'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
      <span className="text-[11px] tabular-nums text-[#6B6259]">{count}</span>
    </button>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Tile                                                       */
/* ────────────────────────────────────────────────────────── */

function MediaTile({ item, onOpen }: { item: MediaItem; onOpen: () => void }) {
  const KindIcon =
    item.kind === 'image'
      ? ImageIcon
      : item.kind === 'video'
      ? VideoIcon
      : item.kind === 'audio'
      ? Music
      : FileText;

  return (
    <button
      onClick={onOpen}
      className="group relative aspect-square rounded-xl overflow-hidden bg-[#1A1816] border border-white/[0.06] hover:border-white/[0.14] transition-colors"
    >
      {item.kind === 'image' ? (
        <img
          src={item.url}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : item.kind === 'video' ? (
        <div className="relative w-full h-full bg-[#131A20]">
          <video
            src={item.url}
            className="w-full h-full object-cover"
            preload="metadata"
            muted
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur flex items-center justify-center">
              <Play className="w-4 h-4 text-white fill-white ml-0.5" />
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-[#131A20]">
          <KindIcon className="w-8 h-8 text-[#6B6259]" />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/85 to-transparent">
        <p className="text-[11px] text-white/90 truncate font-medium">
          {item.senderName}
        </p>
        <p className="text-[10px] text-white/60 truncate">{item.context}</p>
      </div>

      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        download
        onClick={(e) => e.stopPropagation()}
        className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-black/60 backdrop-blur flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
        title="Download"
      >
        <Download className="w-3.5 h-3.5" />
      </a>
    </button>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Preview modal                                              */
/* ────────────────────────────────────────────────────────── */

function PreviewModal({
  item,
  onClose,
}: {
  item: MediaItem;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={item.senderName} src={item.senderAvatar} size="sm" />
            <div className="min-w-0">
              <p className="text-[13px] text-white font-medium truncate">
                {item.senderName}
              </p>
              <p className="text-[11px] text-white/60 truncate">
                {item.context} ·{' '}
                {new Date(item.sentAt).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              download
              className="h-9 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Download</span>
            </a>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex items-center justify-center bg-[#0F0D0A] rounded-2xl overflow-hidden border border-white/[0.06]">
          {item.kind === 'image' && (
            <img
              src={item.url}
              alt=""
              className="max-w-full max-h-[80vh] object-contain"
            />
          )}
          {item.kind === 'video' && (
            <video
              src={item.url}
              controls
              autoPlay
              className="max-w-full max-h-[80vh]"
            />
          )}
          {item.kind === 'audio' && (
            <div className="p-8 w-full">
              <audio src={item.url} controls autoPlay className="w-full" />
            </div>
          )}
          {item.kind === 'file' && (
            <div className="p-8 text-center">
              <FileText className="w-12 h-12 text-[#6B6259] mx-auto mb-3" />
              <p className="text-[13px] text-[#EDE5D4] mb-1">Attached file</p>
              <p className="text-[11.5px] text-[#6B6259] mb-4 break-all max-w-md">
                {item.url}
              </p>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                download
                className="h-9 px-4 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default NotificationsPane;