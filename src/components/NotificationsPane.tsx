/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image as ImageIcon,
  Video as VideoIcon,
  Music,
  FileText,
  Loader2,
  Eye,
  Search,
  X,
  Play,
  Inbox,
  ArrowRight,
  Trash2,
  CheckSquare,
  Square,
  AlertCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { apiService, applyPresignedUrls } from '../services/api';
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
const TAB_ORDER = ['all', 'image', 'video', 'audio', 'file'] as const;

interface MediaItem {
  id: string;
  rawId: string | number;
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

function applyHistoryPresign(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  const messages = raw?.messages ?? [];
  const presigned = raw?.presignedUrls ?? {};
  if (messages.length === 0) return [];
  if (!presigned || Object.keys(presigned).length === 0) return messages;
  return applyPresignedUrls(messages, presigned);
}

/** Run async tasks with a maximum parallel limit. */
async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  limit: number,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= tasks.length) return;
        try {
          await tasks[idx]();
        } catch {
          /* individual task already guards itself */
        }
      }
    },
  );
  await Promise.all(workers);
}

/* ────────────────────────────────────────────────────────── */
/* Pane                                                       */
/* ────────────────────────────────────────────────────────── */

function NotificationsPane(): React.JSX.Element {
  const navigate = useNavigate();

  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doneTasks, setDoneTasks] = useState(0);
  const [totalTasks, setTotalTasks] = useState(0);
  const [tab, setTab] = useState<'all' | MediaKind>('all');
  const [direction, setDirection] = useState(1); // 1 = next, -1 = prev
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<MediaItem | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({
    active: false,
    startX: 0,
    startY: 0,
    axis: '' as '' | 'x' | 'y',
  });

  /* Live ref so the tab badge can update the header without extra renders */
  const countsRef = useRef({ total: 0 });

  useEffect(() => {
    let cancelled = false;
    let flushTimer: number | null = null;

    // Local accumulating array — pushed to state in throttled flushes.
    const collected: MediaItem[] = [];
    let doneLocal = 0;

    const flush = () => {
      if (flushTimer != null) return;
      flushTimer = window.setTimeout(() => {
        flushTimer = null;
        if (cancelled) return;
        collected.sort(
          (a, b) =>
            new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
        );
        countsRef.current.total = collected.length;
        setDoneTasks(doneLocal);
        setItems([...collected]);
      }, 80);
    };

    const load = async () => {
      setLoading(true);
      setError(null);
      setItems([]);
      setDoneTasks(0);
      setTotalTasks(0);
      countsRef.current.total = 0;

      try {
        // Kick off friends + groups in parallel
        const [friends, groups] = await Promise.all([
          apiService.getFriends().catch(() => [] as FriendDto[]),
          apiService.getMyGroups().catch(() => [] as GroupDto[]),
        ]);
        if (cancelled) return;

        const total = friends.length + groups.length;
        setTotalTasks(total);

        const fetchDm = async (friend: FriendDto) => {
          try {
            const raw = await apiService.getDmHistory(friend.userId, 100);
            const msgs: DirectMessageDto[] = applyHistoryPresign(raw);
            for (const m of msgs) {
              if (!m.mediaUrl) continue;
              const mt = m.mediaType;
              if (typeof mt !== 'number') continue;
              const kind = mediaKindOf(mt);
              if (!kind) continue;
              const isMe = m.senderId !== friend.userId;
              collected.push({
                id: `dm-${m.id}`,
                rawId: m.id,
                url: m.mediaUrl,
                kind,
                mediaType: mt,
                senderId: m.senderId,
                senderName: isMe ? 'You' : friend.displayName,
                senderAvatar: isMe ? null : friend.avatarUrl ?? null,
                context: friend.displayName,
                contextKind: 'dm',
                contextId: friend.userId,
                sentAt: m.sentAt,
              });
            }
          } catch {
            /* ignore per-friend failures */
          } finally {
            doneLocal += 1;
            flush();
          }
        };

        const fetchGrp = async (group: GroupDto) => {
          try {
            const raw = await apiService.getGroupMessages(group.id, 100);
            const msgs: GroupMessageDto[] = applyHistoryPresign(raw);
            for (const m of msgs) {
              if (!m.mediaUrl) continue;
              const mt = m.mediaType;
              if (typeof mt !== 'number') continue;
              const kind = mediaKindOf(mt);
              if (!kind) continue;
              collected.push({
                id: `grp-${m.id}`,
                rawId: m.id,
                url: m.mediaUrl,
                kind,
                mediaType: mt,
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
            doneLocal += 1;
            flush();
          }
        };

        await runWithConcurrency(
          [
            ...friends.map((f) => () => fetchDm(f)),
            ...groups.map((g) => () => fetchGrp(g)),
          ],
          8,
        );

        if (cancelled) return;

        // Final synchronous flush so nothing is stuck in the throttle buffer
        if (flushTimer != null) {
          window.clearTimeout(flushTimer);
          flushTimer = null;
        }
        collected.sort(
          (a, b) =>
            new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
        );
        countsRef.current.total = collected.length;
        setItems([...collected]);
        setDoneTasks(doneLocal);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load media.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (flushTimer != null) window.clearTimeout(flushTimer);
    };
  }, []);

  // Auto-scroll to top when changing tabs
  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
  }, [tab]);

  /* ── Swipe to change tabs ── */
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      if (selectionMode || preview) return; // disable swipe in selection mode
      const t = e.touches[0];
      dragState.current = {
        active: true,
        startX: t.clientX,
        startY: t.clientY,
        axis: '',
      };
    };

    const onMove = (e: TouchEvent) => {
      const s = dragState.current;
      if (!s.active) return;
      const t = e.touches[0];
      const dx = t.clientX - s.startX;
      const dy = t.clientY - s.startY;

      if (!s.axis) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        }
      }

      if (s.axis === 'x') {
        e.preventDefault();
      }
    };

    const onEnd = (e: TouchEvent) => {
      const s = dragState.current;
      if (!s.active) return;
      s.active = false;
      if (s.axis !== 'x') return;

      const t = e.changedTouches[0];
      const dx = t.clientX - s.startX;

      const currentIndex = TAB_ORDER.indexOf(tab);

      if (dx < -60 && currentIndex < TAB_ORDER.length - 1) {
        changeTab(TAB_ORDER[currentIndex + 1]);
      } else if (dx > 60 && currentIndex > 0) {
        changeTab(TAB_ORDER[currentIndex - 1]);
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [tab, selectionMode, preview]);

  const changeTab = (newTab: 'all' | MediaKind) => {
    const currentIndex = TAB_ORDER.indexOf(tab);
    const newIndex = TAB_ORDER.indexOf(newTab);
    if (newIndex > currentIndex) setDirection(1);
    else if (newIndex < currentIndex) setDirection(-1);
    setTab(newTab);
  };

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

  const selectableItems = useMemo(
    () => filtered.filter((i) => i.contextKind === 'dm'),
    [filtered],
  );
  const unselectableCount = filtered.length - selectableItems.length;

  const allSelectableSelected =
    selectableItems.length > 0 &&
    selectableItems.every((i) => selectedIds.has(i.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () =>
    setSelectedIds(new Set(selectableItems.map((i) => i.id)));
  const deselectAll = () => setSelectedIds(new Set());

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setDeleteError(null);
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);

    const targets = items.filter(
      (i) => selectedIds.has(i.id) && i.contextKind === 'dm',
    );

    const results = await Promise.allSettled(
      targets.map((t) => apiService.deleteDm(t.rawId)),
    );

    const succeededIds = new Set<string>();
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') succeededIds.add(targets[i].id);
    });

    const failures = results.filter((r) => r.status === 'rejected').length;

    setItems((prev) => prev.filter((i) => !succeededIds.has(i.id)));
    setSelectedIds(new Set());
    setDeleting(false);
    setConfirmDeleteOpen(false);

    if (failures > 0) {
      setDeleteError(
        `${failures} item${failures === 1 ? '' : 's'} could not be deleted.`,
      );
    } else {
      setSelectionMode(false);
    }
  };

  /* ── VIEW HANDLER — opens media in a new tab (no download) ── */
  const handleViewMedia = (url: string) => {
    if (typeof window === 'undefined') return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const loadingLabel =
    totalTasks > 0
      ? `Loading ${doneTasks} of ${totalTasks} chats…`
      : 'Loading your media…';

  const progressPct =
    totalTasks > 0
      ? Math.min(100, Math.round((doneTasks / totalTasks) * 100))
      : 0;

  return (
    <div className="h-full flex flex-col bg-[#0B0A08] text-[#EDE5D4] overflow-hidden">
      <style>{`
        @keyframes mediaShimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @keyframes mediaPulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
      `}</style>

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
              ? loadingLabel
              : `${counts.all} item${counts.all === 1 ? '' : 's'} across your chats`}
          </p>
        </div>

        {!loading && items.length > 0 && !selectionMode && (
          <button
            onClick={() => setSelectionMode(true)}
            className="shrink-0 h-9 px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[12.5px] text-[#EDE5D4] font-medium inline-flex items-center gap-1.5 transition-colors"
            title="Select items to delete"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Select</span>
          </button>
        )}
      </div>

      {/* Thin progress bar while loading */}
      {loading && (
        <div className="h-[2px] w-full bg-white/[0.03] overflow-hidden shrink-0">
          <div
            className="h-full bg-gradient-to-r from-[#D97706] via-[#F59E0B] to-[#D97706] transition-[width] duration-500 ease-out"
            style={{
              width: totalTasks > 0 ? `${progressPct}%` : '35%',
              animation:
                totalTasks === 0 ? 'mediaPulse 1.4s ease-in-out infinite' : undefined,
            }}
          />
        </div>
      )}

      {/* Tabs + search */}
      <div className="px-4 sm:px-6 py-3 border-b border-white/[0.05] flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto">
          <Tab label="All" icon={Inbox} active={tab === 'all'} count={counts.all} onClick={() => changeTab('all')} />
          <Tab label="Images" icon={ImageIcon} active={tab === 'image'} count={counts.image} onClick={() => changeTab('image')} />
          <Tab label="Videos" icon={VideoIcon} active={tab === 'video'} count={counts.video} onClick={() => changeTab('video')} />
          <Tab label="Audio" icon={Music} active={tab === 'audio'} count={counts.audio} onClick={() => changeTab('audio')} />
          <Tab label="Files" icon={FileText} active={tab === 'file'} count={counts.file} onClick={() => changeTab('file')} />
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
            <button onClick={() => setQuery('')} className="p-0.5 rounded text-[#6B6259] hover:text-[#EDE5D4]">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Selection toolbar */}
      <AnimatePresence initial={false}>
        {selectionMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="border-b border-white/[0.05] bg-[#0F0D0A] overflow-hidden shrink-0"
          >
            <div className="px-4 sm:px-6 py-3 flex items-center gap-2 flex-wrap">
              <button
                onClick={allSelectableSelected ? deselectAll : selectAll}
                disabled={selectableItems.length === 0}
                className="h-8 px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-[12.5px] text-[#EDE5D4] font-medium inline-flex items-center gap-1.5 transition-colors"
              >
                {allSelectableSelected ? <Square className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
                <span>{allSelectableSelected ? 'Deselect all' : 'Select all'}</span>
              </button>

              <span className="text-[12.5px] text-[#A8A29E] tabular-nums">
                <span className="text-[#EDE5D4] font-semibold">{selectedIds.size}</span> selected
              </span>

              {unselectableCount > 0 && (
                <span className="text-[11px] text-[#6B6259] hidden sm:inline" title="Group messages can't be deleted from this page">
                  · {unselectableCount} group item{unselectableCount === 1 ? '' : 's'} not selectable
                </span>
              )}

              <div className="flex-1" />

              <button
                onClick={exitSelection}
                disabled={deleting}
                className="h-8 px-3 rounded-lg text-[12.5px] text-[#A8A29E] hover:text-[#EDE5D4] disabled:opacity-40 transition-colors"
              >
                Cancel
              </button>

              <button
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={selectedIds.size === 0 || deleting}
                className="h-8 px-3 rounded-lg bg-[#B91C1C] hover:bg-[#991B1B] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}</span>
              </button>
            </div>

            {deleteError && (
              <div className="px-4 sm:px-6 pb-3">
                <p className="text-[11.5px] text-[#F87171] flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{deleteError}</span>
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Body */}
      <div
        ref={bodyRef}
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-4"
        style={{ touchAction: 'pan-y' }}
      >
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={tab}
            custom={direction}
            variants={{
              enter: (dir: number) => ({
                x: dir > 0 ? 40 : -40,
                opacity: 0,
              }),
              center: {
                x: 0,
                opacity: 1,
              },
              exit: (dir: number) => ({
                x: dir < 0 ? 40 : -40,
                opacity: 0,
              }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="w-full"
          >
            {error ? (
              <div className="max-w-md mx-auto mt-12 text-center">
                <div className="w-16 h-16 rounded-2xl bg-[#B91C1C]/10 border border-[#B91C1C]/20 flex items-center justify-center mx-auto">
                  <X className="w-7 h-7 text-[#F87171]" />
                </div>
                <p className="text-[14.5px] text-[#F87171] font-semibold tracking-tight mt-4">Could not load media</p>
                <p className="text-[12.5px] text-[#6B6259] mt-1">{error}</p>
              </div>
            ) : loading && items.length === 0 ? (
              <div>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0 text-[12px] text-[#A8A29E]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D97706] shrink-0" />
                    <span className="truncate">{loadingLabel}</span>
                  </div>
                  {totalTasks > 0 && (
                    <span className="shrink-0 text-[11px] tabular-nums text-[#6B6259]">
                      {progressPct}%
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <SkeletonTile key={i} delay={i * 90} />
                  ))}
                </div>
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
                {filtered.map((item) => {
                  const selectable = item.contextKind === 'dm';
                  return (
                    <MediaTile
                      key={item.id}
                      item={item}
                      selectionMode={selectionMode}
                      selected={selectedIds.has(item.id)}
                      selectable={selectable}
                      onView={() => handleViewMedia(item.url)}
                      onOpen={() => {
                        if (selectionMode) {
                          if (selectable) toggleSelect(item.id);
                        } else {
                          setPreview(item);
                        }
                      }}
                      onToggle={() => selectable && toggleSelect(item.id)}
                    />
                  );
                })}
                {/* Trailing skeletons while more media streams in */}
                {loading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <SkeletonTile key={`tail-sk-${i}`} delay={i * 120} />
                  ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Preview modal */}
      {preview && (
        <PreviewModal
          item={preview}
          onClose={() => setPreview(null)}
          onView={() => handleViewMedia(preview.url)}
        />
      )}

      {/* Delete confirmation */}
      <AnimatePresence>
        {confirmDeleteOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !deleting && setConfirmDeleteOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 6 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 6 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl bg-[#1A1816] border border-white/[0.08] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.95)] overflow-hidden"
            >
              <div className="p-5">
                <div className="w-11 h-11 rounded-xl bg-[#B91C1C]/10 border border-[#B91C1C]/20 flex items-center justify-center mb-3">
                  <Trash2 className="w-5 h-5 text-[#F87171]" />
                </div>
                <h3 className="text-[14.5px] font-semibold text-[#EDE5D4] mb-1.5">
                  Delete {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'}?
                </h3>
                <p className="text-[12.5px] text-[#A8A29E] leading-relaxed">
                  The message{selectedIds.size === 1 ? '' : 's'} will be removed from
                  your view. Media shared in group chats is not affected.
                </p>
              </div>

              <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmDeleteOpen(false)}
                  disabled={deleting}
                  className="h-9 px-4 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-[12.5px] text-[#EDE5D4] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="h-9 px-4 rounded-lg bg-[#B91C1C] hover:bg-[#991B1B] disabled:opacity-50 text-white text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors"
                >
                  {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{deleting ? 'Deleting…' : 'Delete'}</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Skeleton tile                                              */
/* ────────────────────────────────────────────────────────── */

function SkeletonTile({ delay = 0 }: { delay?: number }) {
  return (
    <div className="relative aspect-square rounded-xl overflow-hidden bg-[#131A20] border border-white/[0.04]">
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] via-transparent to-white/[0.02]" />
      <div
        className="absolute inset-y-0 -left-1/2 w-[200%]"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.07) 50%, transparent 100%)',
          animation: `mediaShimmer 1.6s ease-in-out infinite`,
          animationDelay: `${delay}ms`,
        }}
      />
      <div className="absolute inset-x-2 bottom-2 flex flex-col gap-1.5">
        <div className="h-2 w-3/5 rounded-full bg-white/[0.05]" />
        <div className="h-1.5 w-2/5 rounded-full bg-white/[0.03]" />
      </div>
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

function MediaTile({
  item,
  onOpen,
  onView,
  selectionMode,
  selected,
  selectable,
  onToggle,
}: {
  item: MediaItem;
  onOpen: () => void;
  onView: () => void;
  selectionMode: boolean;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
}) {
  const KindIcon =
    item.kind === 'image'
      ? ImageIcon
      : item.kind === 'video'
      ? VideoIcon
      : item.kind === 'audio'
      ? Music
      : FileText;

  const dimmed = selectionMode && !selectable;

  return (
    <button
      onClick={onOpen}
      className={`group relative aspect-square rounded-xl overflow-hidden bg-[#1A1816] border transition-all duration-150 ${
        selected
          ? 'border-[#D97706] ring-2 ring-[#D97706]/40'
          : 'border-white/[0.06] hover:border-white/[0.14]'
      } ${dimmed ? 'opacity-40 cursor-not-allowed' : ''}`}
      title={dimmed ? 'Group messages can\'t be deleted from here' : undefined}
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

      {/* Selection checkbox */}
      {selectionMode && selectable && (
        <div
          role="checkbox"
          aria-checked={selected}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={`absolute top-2 left-2 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
            selected
              ? 'bg-[#D97706] border-[#D97706]'
              : 'bg-black/50 border-white/70 backdrop-blur'
          }`}
        >
          {selected && (
            <svg
              viewBox="0 0 16 16"
              fill="none"
              className="w-3.5 h-3.5 text-[#0F0D0A]"
            >
              <path
                d="M3 8L6.5 11.5L13 5"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
      )}

      {/* Group label when unselectable and selecting */}
      {selectionMode && !selectable && (
        <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur text-[9.5px] text-white/70 uppercase tracking-wider font-medium">
          Group
        </span>
      )}

      {/* View (hidden in selection mode) */}
      {!selectionMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onView();
          }}
          className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-black/60 backdrop-blur flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
          title="View"
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
      )}
    </button>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Preview modal                                              */
/* ────────────────────────────────────────────────────────── */

function PreviewModal({
  item,
  onClose,
  onView,
}: {
  item: MediaItem;
  onClose: () => void;
  onView: () => void;
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
            <button
              onClick={onView}
              className="h-9 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">View</span>
            </button>
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
              <button
                onClick={onView}
                className="h-9 px-4 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>View</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default NotificationsPane;