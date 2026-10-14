/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Smile,
  Image as ImageIcon,
  Sparkles,
  Camera,
  Mic,
  MicOff,
  Send,
  Trash2,
  Search,
  Loader2,
  StopCircle,
  FileText,
  Film,
  Music,
  TrendingUp,
  Clock,
  Heart,
  Zap,
  Play,
  Pause,
} from 'lucide-react';

/* ────────────────────────────────────────────────────────── */
/* Emoji data                                                 */
/* ────────────────────────────────────────────────────────── */

const EMOJI_CATEGORIES: Array<{
  name: string;
  icon: string;
  gradient: string;
  items: string[];
}> = [
  {
    name: 'Smileys',
    icon: '😀',
    gradient: 'from-amber-400 to-orange-500',
    items: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  },
  {
    name: 'Gestures',
    icon: '👋',
    gradient: 'from-yellow-400 to-amber-500',
    items: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄','💋','🩸','🫶'],
  },
  {
    name: 'Hearts',
    icon: '❤️',
    gradient: 'from-rose-400 to-pink-600',
    items: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💌','💋','💐','🌹','🌷','🌺','🌸','🌼','🌻','🪷'],
  },
  {
    name: 'Animals',
    icon: '🐶',
    gradient: 'from-emerald-400 to-teal-500',
    items: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🕷️','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦀','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🐘','🦒','🐪','🐫','🦘','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐈','🐓','🦃','🦚','🦜','🦢','🐇','🦝','🦨','🦡','🦦','🦥','🐿️','🦔'],
  },
  {
    name: 'Food',
    icon: '🍕',
    gradient: 'from-red-400 to-orange-500',
    items: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🥪','🥙','🌮','🌯','🥗','🥘','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🍾','🧊'],
  },
  {
    name: 'Activities',
    icon: '⚽',
    gradient: 'from-sky-400 to-blue-600',
    items: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🏒','🏑','🏏','⛳','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🎿','🏂','🪂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏇','🧘','🏄','🏊','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🎻','🎲','🎯','🎳','🎮','🎰','🧩'],
  },
  {
    name: 'Nature',
    icon: '🌟',
    gradient: 'from-cyan-400 to-indigo-500',
    items: ['🌟','⭐','✨','⚡','🔥','💫','🌈','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄','🌬️','💨','🌪️','🌫️','🌊','💧','💦','☔','☂️','🌙','🌛','🌜','🌚','🌝','🌞','🌕','🌖','🌗','🌘','🌑','🌒','🌓','🌔','🪐','☄️','🌠','🌌','🌍','🌎','🌏','🌋','🌁','🌉','🌃','🏙️','🌆','🌇','🌅','🌄','🏞️'],
  },
  {
    name: 'Objects',
    icon: '📱',
    gradient: 'from-slate-400 to-zinc-600',
    items: ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🕹️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🧯','💸','💵','💰','💳','💎','⚖️','🧰','🔧','🔨','🛠️','⚙️','🧱','⛓️','🧲','💣','🧨','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🏺','🔮','📿','🧿','🔭','🔬','💊','💉','🧬','🦠','🧪','🌡️','🧹','🧺','🚽','🚿','🛁','🧼','🪥','🧽','🧴','🔑','🚪','🪑','🛋️','🛏️','🧸','🖼️','🛍️','🛒','🎁','🎈','🎀','🎊','🎉','🏮','🎐','🧧','✉️','📩','📨','📧','💌','📥','📤','📦','📜','📃','📄','📑','🧾','📊','📈','📉','📆','📅','📇','🗃️','🗳️','🗄️','📋','📁','📂','📰','📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','🔗','📎','📐','📏','🧮','📌','📍','✂️','🖊️','🖋️','✒️','🖌️','🖍️','📝','✏️','🔍','🔎','🔏','🔐','🔒','🔓'],
  },
  {
    name: 'Symbols',
    icon: '💯',
    gradient: 'from-fuchsia-400 to-purple-600',
    items: ['💯','💢','💥','💫','💦','💨','💬','💭','💤','✅','❌','⭕','🚫','⛔','📛','♨️','⚠️','☢️','☣️','⬆️','⬇️','⬅️','➡️','↗️','↘️','↙️','↖️','↕️','↔️','↩️','↪️','⤴️','⤵️','🔃','🔄','🔙','🔚','🔛','🔜','🔝','🛐','⚛️','🕉️','✡️','☸️','☯️','✝️','☦️','☪️','☮️','🕎','🔯','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','⛎','🔀','🔁','🔂','▶️','⏩','◀️','⏪','🔼','⏫','🔽','⏬','⏸️','⏹️','⏺️','🎦','🔅','🔆','📶','📳','📴','♀️','♂️','✖️','➕','➖','➗','♾️','‼️','⁉️','❓','❔','❕','❗','💱','💲','♻️','⚜️','🔱','🔰','☑️','✔️','❎','➰','➿','〽️','✳️','✴️','❇️','©️','®️','™️'],
  },
];

const QUICK_REACTIONS = ['❤️', '😂', '🔥', '👍', '😮', '😢', '🎉', '💯'];

/* ────────────────────────────────────────────────────────── */
/* KLIPY API                                                  */
/* ────────────────────────────────────────────────────────── */

const KLIPY_API_KEY = (import.meta.env.VITE_KLIPY_API_KEY as string | undefined) ?? '';
const KLIPY_BASE = 'https://api.klipy.com/api/v1';

if (!KLIPY_API_KEY) {
  console.warn('[KLIPY] VITE_KLIPY_API_KEY is missing — GIFs and stickers will not load.');
}

interface GifItem {
  id: string;
  url: string;
  preview: string;
}

async function klipyFetch(
  type: 'gifs' | 'stickers',
  mode: 'search' | 'trending',
  query?: string,
): Promise<GifItem[]> {
  if (!KLIPY_API_KEY) return [];

  const q = query?.trim();
  const endpoint =
    mode === 'search' && q
      ? `${KLIPY_BASE}/${KLIPY_API_KEY}/${type}/search?q=${encodeURIComponent(q)}&perPage=24`
      : `${KLIPY_BASE}/${KLIPY_API_KEY}/${type}/trending?perPage=24`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const items: any[] =
      json?.data?.data ?? json?.data ?? json?.results ?? json?.items ?? [];

    return items
      .map((r: any) => {
        const file = r.file ?? r.images ?? {};
        const full =
          file.md?.gif?.url ??
          file.hd?.gif?.url ??
          file.original?.url ??
          file.downsized_large?.url ??
          file.fixed_height?.url ??
          file.sm?.gif?.url;
        const preview =
          file.sm?.gif?.url ??
          file.xs?.gif?.url ??
          file.preview_gif?.url ??
          file.fixed_height_small?.url ??
          full;
        return {
          id: String(r.id ?? r.slug ?? Math.random()),
          url: full,
          preview,
        };
      })
      .filter((g: GifItem) => Boolean(g.url) && Boolean(g.preview));
  } catch (err) {
    console.warn(`[KLIPY] ${type}/${mode} fetch failed:`, err);
    return [];
  }
}

const fetchGifs = (q: string) =>
  klipyFetch('gifs', q.trim() ? 'search' : 'trending', q);
const fetchStickers = (q: string) =>
  klipyFetch('stickers', q.trim() ? 'search' : 'trending', q);

/* ────────────────────────────────────────────────────────── */
/* Recent emojis persistence                                  */
/* ────────────────────────────────────────────────────────── */

const RECENT_EMOJI_KEY = 'orbital.recentEmojis';

function loadRecentEmojis(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_EMOJI_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecentEmojis(list: string[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(list.slice(0, 24)));
  } catch {
    /* quota */
  }
}

/* ────────────────────────────────────────────────────────── */
/* Emoji / GIF / Sticker panel                                */
/* ────────────────────────────────────────────────────────── */

type PanelTab = 'emoji' | 'gif' | 'stickers';

const TABS: Array<{ k: PanelTab; label: string; icon: React.ReactNode }> = [
  { k: 'emoji', label: 'Emoji', icon: <Smile className="w-4 h-4" /> },
  { k: 'gif', label: 'GIFs', icon: <Film className="w-4 h-4" /> },
  { k: 'stickers', label: 'Stickers', icon: <Sparkles className="w-4 h-4" /> },
];

export function EmojiPanel({
  onPickEmoji,
  onSendGif,
  onSendSticker,
  onClose,
}: {
  onPickEmoji: (e: string) => void;
  onSendGif: (url: string) => void;
  onSendSticker: (url: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<PanelTab>('emoji');
  const [activeCategory, setActiveCategory] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => loadRecentEmojis());

  const handlePick = (emoji: string) => {
    onPickEmoji(emoji);
    setRecent((prev) => {
      const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, 24);
      saveRecentEmojis(next);
      return next;
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 400 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="relative border-t border-white/[0.06] bg-gradient-to-b from-[#0F0D0A] to-[#0A0908] overflow-hidden"
    >
      {/* Ambient glow */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          background:
            'radial-gradient(60% 40% at 50% 0%, rgba(217,119,6,0.08), transparent 70%), radial-gradient(40% 40% at 100% 100%, rgba(168,85,247,0.06), transparent 70%)',
        }}
      />

      {/* Header */}
      <div className="relative flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-1 p-0.5 rounded-2xl bg-white/[0.03] border border-white/[0.05]">
          {TABS.map((t) => {
            const active = tab === t.k;
            return (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`relative h-8 px-3.5 rounded-xl text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
                  active ? 'text-[#171106]' : 'text-[#A8A29E] hover:text-[#EDE5D4]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="emoji-tab-pill"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className="absolute inset-0 rounded-xl bg-gradient-to-br from-[#F59E0B] to-[#D97706] shadow-[0_2px_12px_-2px_rgba(217,119,6,0.5)]"
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  {t.icon}
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-[#7A6F65] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {tab === 'emoji' && (
        <>
          {/* Quick reactions row */}
          <div className="relative px-3 py-2 border-b border-white/[0.04]">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-[#5A524A] font-semibold mr-1">
                Quick
              </span>
              {QUICK_REACTIONS.map((e, i) => (
                <motion.button
                  key={e}
                  onClick={() => handlePick(e)}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.03, type: 'spring', stiffness: 400, damping: 20 }}
                  whileHover={{ scale: 1.18, rotate: [0, -8, 8, 0] }}
                  whileTap={{ scale: 0.9 }}
                  className="shrink-0 w-11 h-11 rounded-2xl bg-white/[0.04] border border-white/[0.06] hover:border-[#D97706]/40 hover:bg-[#D97706]/[0.08] flex items-center justify-center text-[26px] transition-colors"
                >
                  {e}
                </motion.button>
              ))}
              {recent.length > 0 && (
                <>
                  <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-[#5A524A] font-semibold ml-2 mr-1 inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Recent
                  </span>
                  {recent.slice(0, 6).map((e) => (
                    <motion.button
                      key={`recent-${e}`}
                      onClick={() => handlePick(e)}
                      whileHover={{ scale: 1.18 }}
                      whileTap={{ scale: 0.9 }}
                      className="shrink-0 w-9 h-9 rounded-xl bg-white/[0.03] border border-white/[0.05] hover:border-[#D97706]/30 flex items-center justify-center text-[20px] transition-colors"
                    >
                      {e}
                    </motion.button>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Category pills */}
          <div className="relative flex gap-1.5 px-3 py-2 border-b border-white/[0.04] overflow-x-auto">
            {EMOJI_CATEGORIES.map((c, i) => {
              const active = activeCategory === i;
              return (
                <button
                  key={c.name}
                  onClick={() => setActiveCategory(i)}
                  className={`shrink-0 h-9 px-3 rounded-2xl text-[12px] font-semibold inline-flex items-center gap-1.5 transition-all ${
                    active
                      ? `bg-gradient-to-br ${c.gradient} text-white shadow-[0_4px_12px_-2px_rgba(0,0,0,0.4)]`
                      : 'bg-white/[0.03] border border-white/[0.06] text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="text-[16px] leading-none">{c.icon}</span>
                  <span>{c.name}</span>
                </button>
              );
            })}
          </div>

          {/* Emoji grid */}
          <div className="relative h-[250px] overflow-y-auto px-3 py-2">
            <div className="grid grid-cols-7 sm:grid-cols-9 gap-1">
              {EMOJI_CATEGORIES[activeCategory].items.map((emoji, i) => (
                <motion.button
                  key={`${emoji}-${i}`}
                  onClick={() => handlePick(emoji)}
                  whileHover={{ scale: 1.25, y: -2 }}
                  whileTap={{ scale: 0.85 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                  className="aspect-square rounded-xl flex items-center justify-center text-[26px] hover:bg-white/[0.08] transition-colors"
                >
                  {emoji}
                </motion.button>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'gif' && <KlipyTab kind="gifs" onSend={onSendGif} />}
      {tab === 'stickers' && <KlipyTab kind="stickers" onSend={onSendSticker} />}

      {/* Attribution */}
      <div className="relative px-3 py-1.5 border-t border-white/[0.04] text-center">
        <a
          href="https://klipy.com"
          target="_blank"
          rel="noreferrer"
          className="text-[9.5px] uppercase tracking-[0.14em] text-[#5A524A] hover:text-[#D97706] font-semibold transition-colors"
        >
          Powered by KLIPY
        </a>
      </div>
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* GIF / Sticker tab                                          */
/* ────────────────────────────────────────────────────────── */

function KlipyTab({
  kind,
  onSend,
}: {
  kind: 'gifs' | 'stickers';
  onSend: (url: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<GifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const isSticker = kind === 'stickers';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEmpty(false);
    setError(false);

    const run = async () => {
      const results =
        kind === 'gifs' ? await fetchGifs(query) : await fetchStickers(query);
      if (cancelled) return;
      setItems(results);
      setEmpty(results.length === 0);
      setLoading(false);
      if (results.length === 0 && !KLIPY_API_KEY) setError(true);
    };

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(run, 350);
    return () => {
      cancelled = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, kind]);

  return (
    <div className="relative flex flex-col h-[290px]">
      {/* Search bar */}
      <div className="px-3 py-2.5 border-b border-white/[0.04]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5A524A] pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isSticker ? 'Search stickers…' : 'Search GIFs…'}
            className={`w-full h-10 pl-10 pr-3 rounded-2xl bg-white/[0.04] border border-white/[0.06] text-[13px] text-[#EDE5D4] placeholder:text-[#5A524A] focus:outline-none focus:border-[#D97706]/40 focus:bg-white/[0.06] transition-colors`}
          />
          {query.length === 0 && (
            <span
              className={`absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] font-bold ${
                isSticker ? 'text-[#A78BFA]' : 'text-[#22D3EE]'
              }`}
            >
              {isSticker ? (
                <>
                  <Sparkles className="w-3 h-3" />
                  Stickers
                </>
              ) : (
                <>
                  <TrendingUp className="w-3 h-3" />
                  Trending
                </>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className={`${
                  isSticker ? 'aspect-square' : 'aspect-video'
                } rounded-xl bg-white/[0.03] border border-white/[0.05] animate-pulse`}
                style={{ animationDelay: `${i * 60}ms` }}
              />
            ))}
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2">
            <div className="w-12 h-12 rounded-2xl bg-[#B91C1C]/[0.10] border border-[#B91C1C]/30 flex items-center justify-center">
              <Zap className="w-5 h-5 text-[#F87171]" />
            </div>
            <p className="text-[12px] text-[#F87171] font-medium">
              API key missing
            </p>
            <p className="text-[10.5px] text-[#5A524A]">
              Set VITE_KLIPY_API_KEY
            </p>
          </div>
        ) : empty ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
              <Heart className="w-5 h-5 text-[#5A524A]" />
            </div>
            <p className="text-[12px] text-[#7A6F65]">
              No {isSticker ? 'stickers' : 'GIFs'} found
            </p>
            <p className="text-[10.5px] text-[#5A524A]">
              Try a different search
            </p>
          </div>
        ) : (
          <div
            className={
              isSticker
                ? 'grid grid-cols-3 sm:grid-cols-4 gap-1.5'
                : 'grid grid-cols-2 sm:grid-cols-3 gap-1.5'
            }
          >
            {items.map((g, i) => (
              <motion.button
                key={g.id}
                onClick={() => onSend(g.url)}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  delay: Math.min(i * 0.02, 0.3),
                  type: 'spring',
                  stiffness: 400,
                  damping: 26,
                }}
                whileHover={{ scale: 1.04, zIndex: 10 }}
                whileTap={{ scale: 0.94 }}
                className={`relative ${
                  isSticker ? 'aspect-square' : 'aspect-video'
                } rounded-xl overflow-hidden border transition-all ${
                  isSticker
                    ? 'bg-white/[0.02] border-white/[0.05] hover:border-[#A78BFA]/40 hover:shadow-[0_4px_16px_-4px_rgba(168,85,247,0.5)]'
                    : 'bg-black/40 border-white/[0.05] hover:border-[#22D3EE]/40 hover:shadow-[0_4px_16px_-4px_rgba(34,211,238,0.5)]'
                }`}
              >
                <img
                  src={g.preview}
                  alt=""
                  loading="lazy"
                  className={`w-full h-full ${
                    isSticker ? 'object-contain p-1.5' : 'object-cover'
                  }`}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.opacity = '0.3';
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 hover:opacity-100 transition-opacity pointer-events-none" />
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Attachment sheet                                           */
/* ────────────────────────────────────────────────────────── */

export function AttachmentSheet({
  open,
  onClose,
  onPhoto,
  onCamera,
  onDocument,
  onAudioFile,
}: {
  open: boolean;
  onClose: () => void;
  onPhoto: () => void;
  onCamera: () => void;
  onDocument: () => void;
  onAudioFile: () => void;
}) {
  const opts = [
    {
      key: 'photo',
      label: 'Photos',
      sub: 'Gallery',
      icon: <ImageIcon className="w-6 h-6" />,
      gradient: 'from-[#A78BFA] via-[#8B5CF6] to-[#7C3AED]',
      glow: 'rgba(167,139,250,0.5)',
      onClick: onPhoto,
    },
    {
      key: 'camera',
      label: 'Camera',
      sub: 'Capture',
      icon: <Camera className="w-6 h-6" />,
      gradient: 'from-[#FB7185] via-[#F43F5E] to-[#E11D48]',
      glow: 'rgba(251,113,133,0.5)',
      onClick: onCamera,
    },
    {
      key: 'doc',
      label: 'Document',
      sub: 'Files',
      icon: <FileText className="w-6 h-6" />,
      gradient: 'from-[#38BDF8] via-[#0EA5E9] to-[#0284C7]',
      glow: 'rgba(56,189,248,0.5)',
      onClick: onDocument,
    },
    {
      key: 'audio',
      label: 'Audio',
      sub: 'Music',
      icon: <Music className="w-6 h-6" />,
      gradient: 'from-[#4ADE80] via-[#22C55E] to-[#16A34A]',
      glow: 'rgba(74,222,128,0.5)',
      onClick: onAudioFile,
    },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-md flex items-end sm:items-center justify-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 60, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 60, opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full sm:max-w-md rounded-t-[28px] sm:rounded-[28px] bg-gradient-to-b from-[#1F1D1A] to-[#141210] border-t sm:border border-white/[0.10] shadow-[0_-24px_60px_-12px_rgba(0,0,0,0.95)] sm:shadow-[0_32px_80px_-16px_rgba(0,0,0,0.95)] overflow-hidden"
          >
            {/* Ambient glow */}
            <div
              className="absolute inset-0 pointer-events-none opacity-50"
              style={{
                background:
                  'radial-gradient(60% 40% at 50% 0%, rgba(217,119,6,0.12), transparent 70%)',
              }}
            />

            {/* Grabber for mobile */}
            <div className="relative pt-3 flex justify-center sm:hidden">
              <span className="w-10 h-1 rounded-full bg-white/[0.15]" />
            </div>

            {/* Header */}
            <div className="relative px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-[17px] font-bold text-[#EDE5D4] tracking-tight">
                  Share
                </h3>
                <p className="text-[11.5px] text-[#7A6F65] mt-0.5">
                  Pick what to send
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-2xl flex items-center justify-center text-[#7A6F65] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
                aria-label="Close"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Grid */}
            <div className="relative p-4 pt-0 grid grid-cols-2 gap-3">
              {opts.map((o, i) => (
                <motion.button
                  key={o.key}
                  onClick={() => {
                    o.onClick();
                    onClose();
                  }}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: i * 0.05,
                    type: 'spring',
                    stiffness: 380,
                    damping: 26,
                  }}
                  whileHover={{ y: -3, scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                  className="group relative flex flex-col items-start gap-3 p-4 rounded-[22px] bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.10] transition-colors text-left overflow-hidden"
                >
                  {/* Icon */}
                  <span
                    className={`relative w-14 h-14 rounded-2xl bg-gradient-to-br ${o.gradient} flex items-center justify-center text-white shadow-lg`}
                    style={{ boxShadow: `0 8px 24px -8px ${o.glow}` }}
                  >
                    {o.icon}
                  </span>
                  {/* Label */}
                  <div className="relative">
                    <p className="text-[14px] font-bold text-[#EDE5D4] tracking-tight">
                      {o.label}
                    </p>
                    <p className="text-[11px] text-[#7A6F65] mt-0.5">
                      {o.sub}
                    </p>
                  </div>
                  {/* Corner accent */}
                  <span
                    className={`absolute top-0 right-0 w-20 h-20 rounded-full bg-gradient-to-br ${o.gradient} opacity-0 group-hover:opacity-20 transition-opacity blur-2xl -translate-y-8 translate-x-8 pointer-events-none`}
                  />
                </motion.button>
              ))}
            </div>

            {/* Footer hint */}
            <div className="relative px-5 pb-5 pt-1">
              <p className="text-center text-[10.5px] text-[#5A524A] uppercase tracking-[0.16em] font-semibold">
                Max 5 MB per file
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Voice recorder                                             */
/* ────────────────────────────────────────────────────────── */

export interface VoiceRecording {
  blob: Blob;
  durationSec: number;
  mimeType: string;
}

export function VoiceRecorder({
  onComplete,
  onCancel,
}: {
  onComplete: (rec: VoiceRecording) => void;
  onCancel: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<number[]>(Array(20).fill(4));
  const [preview, setPreview] = useState<{
    url: string;
    blob: Blob;
    mime: string;
    durationSec: number;
  } | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const finalElapsedRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Live waveform analyser
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        src.connect(analyser);
        analyserRef.current = analyser;

        const dataArr = new Uint8Array(analyser.frequencyBinCount);
        const draw = () => {
          analyser.getByteFrequencyData(dataArr);
          const bars: number[] = [];
          for (let i = 0; i < 20; i++) {
            const v = dataArr[i] ?? 0;
            bars.push(Math.max(4, Math.min(28, (v / 255) * 28)));
          }
          setLevel(bars);
          rafRef.current = requestAnimationFrame(draw);
        };
        draw();
      } catch (err) {
        console.warn('Waveform analyser failed:', err);
      }

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const mr = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: mr.mimeType || 'audio/webm',
        });
        const url = URL.createObjectURL(blob);

        let durationSec = finalElapsedRef.current;
        try {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          const ctx = new AudioCtx();
          const arrayBuffer = await blob.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          if (audioBuffer.duration && isFinite(audioBuffer.duration)) {
            durationSec = audioBuffer.duration;
          }
          await ctx.close();
        } catch (err) {
          console.warn('Duration decode failed, using elapsed:', err);
        }

        setPreview({
          url,
          blob,
          mime: mr.mimeType || 'audio/webm',
          durationSec: Math.max(1, durationSec),
        });

        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        analyserRef.current = null;
        if (audioCtxRef.current) {
          try {
            await audioCtxRef.current.close();
          } catch {
            /* ignore */
          }
          audioCtxRef.current = null;
        }
      };

      startTimeRef.current = Date.now();
      finalElapsedRef.current = 0;
      setElapsed(0);
      mr.start();
      setRecording(true);

      tickRef.current = window.setInterval(() => {
        const sec = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setElapsed(sec);
        finalElapsedRef.current = sec;
      }, 200);
    } catch (err) {
      setError('Microphone access denied');
      console.warn('Voice recorder error', err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop();
    }
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setRecording(false);
  }, []);

  const cancelAll = useCallback(() => {
    try {
      stopRecording();
    } catch {
      /* ignore */
    }
    if (preview) URL.revokeObjectURL(preview.url);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCancel();
  }, [onCancel, preview, stopRecording]);

  const sendRecording = useCallback(() => {
    if (!preview) return;
    onComplete({
      blob: preview.blob,
      durationSec: preview.durationSec,
      mimeType: preview.mime,
    });
    URL.revokeObjectURL(preview.url);
  }, [onComplete, preview]);

  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (preview) URL.revokeObjectURL(preview.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 px-4 py-3 rounded-[24px] bg-gradient-to-br from-[#B91C1C]/[0.15] to-[#7F1D1D]/[0.10] border border-[#B91C1C]/30"
      >
        <span className="shrink-0 w-9 h-9 rounded-full bg-[#B91C1C]/[0.20] flex items-center justify-center">
          <MicOff className="w-4 h-4 text-[#F87171]" />
        </span>
        <span className="text-[13px] text-[#F87171] flex-1 font-medium">
          {error}
        </span>
        <button
          onClick={cancelAll}
          className="text-[12px] text-[#EDE5D4] hover:text-[#F87171] font-semibold transition-colors"
        >
          Close
        </button>
      </motion.div>
    );
  }

  if (preview) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className="flex items-center gap-3 px-3 py-2.5 rounded-[24px] bg-gradient-to-br from-[#7C3AED]/[0.08] to-[#A855F7]/[0.04] border border-[#A855F7]/20"
      >
        <button
          onClick={cancelAll}
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-[#F87171] hover:bg-[#B91C1C]/[0.15] transition-colors"
          title="Delete recording"
        >
          <Trash2 className="w-4.5 h-4.5" />
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <span className="shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-[#7C3AED] to-[#A855F7] flex items-center justify-center shadow-[0_4px_12px_-2px_rgba(168,85,247,0.5)]">
            <Mic className="w-4 h-4 text-white" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-[#EDE5D4] tabular-nums tracking-tight">
              {Math.floor(preview.durationSec / 60)}:
              {Math.floor(preview.durationSec % 60)
                .toString()
                .padStart(2, '0')}
            </p>
            <p className="text-[10.5px] text-[#A78BFA] font-semibold uppercase tracking-[0.14em] mt-0.5">
              Ready to send
            </p>
          </div>
          <audio src={preview.url} controls className="flex-1 h-8 min-w-0" />
        </div>
        <motion.button
          onClick={sendRecording}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.94 }}
          className="shrink-0 w-11 h-11 rounded-full bg-gradient-to-br from-[#F59E0B] to-[#D97706] hover:from-[#FBBF24] hover:to-[#F59E0B] text-[#171106] flex items-center justify-center shadow-[0_4px_16px_-2px_rgba(217,119,6,0.5)] transition-colors"
          title="Send voice message"
        >
          <Send className="w-[18px] h-[18px]" />
        </motion.button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-[24px] border transition-colors ${
        recording
          ? 'bg-gradient-to-br from-[#F87171]/[0.12] to-[#DC2626]/[0.06] border-[#F87171]/30'
          : 'bg-white/[0.04] border-white/[0.06]'
      }`}
    >
      <button
        onClick={cancelAll}
        className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-[#A8A29E] hover:bg-white/[0.06] transition-colors"
        title="Cancel"
      >
        <X className="w-4.5 h-4.5" />
      </button>

      {recording ? (
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <div className="relative shrink-0">
            <span className="w-3 h-3 rounded-full bg-[#F87171] block relative z-10" />
            <span
              className="absolute inset-0 rounded-full bg-[#F87171] animate-ping"
              style={{ animationDuration: '1.4s' }}
            />
          </div>
          <span className="text-[15px] font-bold text-[#EDE5D4] tabular-nums tracking-tight">
            {Math.floor(elapsed / 60)}:
            {(elapsed % 60).toString().padStart(2, '0')}
          </span>
          {/* Live waveform */}
          <div className="flex-1 flex items-center justify-center gap-0.5 h-8">
            {level.map((h, i) => (
              <motion.span
                key={i}
                animate={{ height: h }}
                transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                className="w-[3px] rounded-full bg-gradient-to-t from-[#F87171] to-[#FBBF24]"
                style={{ minHeight: 4 }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-[#EDE5D4] tracking-tight">
            Voice message
          </p>
          <p className="text-[10.5px] text-[#5A524A] mt-0.5">
            Tap the mic to start recording
          </p>
        </div>
      )}

      {!recording ? (
        <motion.button
          onClick={startRecording}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          className="relative shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-[#F87171] to-[#DC2626] text-white flex items-center justify-center shadow-[0_6px_20px_-4px_rgba(248,113,113,0.6)]"
          title="Start recording"
        >
          <span className="absolute inset-0 rounded-full bg-[#F87171] opacity-40 animate-ping" style={{ animationDuration: '2s' }} />
          <Mic className="w-5 h-5 relative z-10" />
        </motion.button>
      ) : (
        <motion.button
          onClick={stopRecording}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.94 }}
          className="shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-[#F59E0B] to-[#D97706] text-[#171106] flex items-center justify-center shadow-[0_4px_16px_-2px_rgba(217,119,6,0.5)]"
          title="Stop recording"
        >
          <StopCircle className="w-5 h-5" />
        </motion.button>
      )}
    </motion.div>
  );
}