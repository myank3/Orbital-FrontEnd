/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useCallback,
  useEffect,
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
  Play,
  Pause,
} from 'lucide-react';

/* ────────────────────────────────────────────────────────── */
/* Emoji data                                                 */
/* ────────────────────────────────────────────────────────── */

const EMOJI_CATEGORIES: Array<{ name: string; icon: string; items: string[] }> = [
  {
    name: 'Smileys',
    icon: '😀',
    items: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  },
  {
    name: 'Gestures',
    icon: '👋',
    items: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄','💋','🩸','🫶'],
  },
  {
    name: 'Hearts',
    icon: '❤️',
    items: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💌','💋','💐','🌹','🌷','🌺','🌸','🌼','🌻','🪷'],
  },
  {
    name: 'Animals',
    icon: '🐶',
    items: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🕷️','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦀','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🐘','🦒','🐪','🐫','🦘','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐈','🐓','🦃','🦚','🦜','🦢','🐇','🦝','🦨','🦡','🦦','🦥','🐿️','🦔'],
  },
  {
    name: 'Food',
    icon: '🍕',
    items: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🥪','🥙','🌮','🌯','🥗','🥘','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🍾','🧊'],
  },
  {
    name: 'Activities',
    icon: '⚽',
    items: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🏒','🏑','🏏','⛳','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🎿','🏂','🪂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏇','🧘','🏄','🏊','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🎻','🎲','🎯','🎳','🎮','🎰','🧩'],
  },
  {
    name: 'Nature',
    icon: '🌟',
    items: ['🌟','⭐','✨','⚡','🔥','💫','🌈','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄','🌬️','💨','🌪️','🌫️','🌊','💧','💦','☔','☂️','🌙','🌛','🌜','🌚','🌝','🌞','🌕','🌖','🌗','🌘','🌑','🌒','🌓','🌔','🪐','☄️','🌠','🌌','🌍','🌎','🌏','🌋','🌁','🌉','🌃','🏙️','🌆','🌇','🌅','🌄','🏞️'],
  },
  {
    name: 'Objects',
    icon: '📱',
    items: ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🕹️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🧯','💸','💵','💰','💳','💎','⚖️','🧰','🔧','🔨','🛠️','⚙️','🧱','⛓️','🧲','💣','🧨','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🏺','🔮','📿','🧿','🔭','🔬','💊','💉','🧬','🦠','🧪','🌡️','🧹','🧺','🚽','🚿','🛁','🧼','🪥','🧽','🧴','🔑','🚪','🪑','🛋️','🛏️','🧸','🖼️','🛍️','🛒','🎁','🎈','🎀','🎊','🎉','🏮','🎐','🧧','✉️','📩','📨','📧','💌','📥','📤','📦','📜','📃','📄','📑','🧾','📊','📈','📉','📆','📅','📇','🗃️','🗳️','🗄️','📋','📁','📂','📰','📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','🔗','📎','📐','📏','🧮','📌','📍','✂️','🖊️','🖋️','✒️','🖌️','🖍️','📝','✏️','🔍','🔎','🔏','🔐','🔒','🔓'],
  },
  {
    name: 'Symbols',
    icon: '💯',
    items: ['💯','💢','💥','💫','💦','💨','💬','💭','💤','✅','❌','⭕','🚫','⛔','📛','♨️','⚠️','☢️','☣️','⬆️','⬇️','⬅️','➡️','↗️','↘️','↙️','↖️','↕️','↔️','↩️','↪️','⤴️','⤵️','🔃','🔄','🔙','🔚','🔛','🔜','🔝','🛐','⚛️','🕉️','✡️','☸️','☯️','✝️','☦️','☪️','☮️','🕎','🔯','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','⛎','🔀','🔁','🔂','▶️','⏩','◀️','⏪','🔼','⏫','🔽','⏬','⏸️','⏹️','⏺️','🎦','🔅','🔆','📶','📳','📴','♀️','♂️','✖️','➕','➖','➗','♾️','‼️','⁉️','❓','❔','❕','❗','💱','💲','♻️','⚜️','🔱','🔰','☑️','✔️','❎','➰','➿','〽️','✳️','✴️','❇️','©️','®️','™️','#️⃣','*️⃣','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🅰️','🆎','🅱️','🆑','🆒','🆓','ℹ️','🆔','🆕','🆖','🅾️','🆗','🅿️','🆘','🆙','🆚','🈁','🈂️','🈷️','🈶','🈯','🉐','🈹','🈚','🈲','🉑','🈸','🈴','🈳','㊗️','㊙️','🈺','🈵','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫'],
  },
];

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
/* Emoji / GIF / Sticker panel                                */
/* ────────────────────────────────────────────────────────── */

type PanelTab = 'emoji' | 'gif' | 'stickers';

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

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 340 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="border-t border-white/[0.06] bg-[#0D0C0A] overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-1">
          {[
            { k: 'emoji' as const, label: 'Emoji', icon: <Smile className="w-3.5 h-3.5" /> },
            { k: 'gif' as const, label: 'GIF', icon: <Film className="w-3.5 h-3.5" /> },
            { k: 'stickers' as const, label: 'Stickers', icon: <Sparkles className="w-3.5 h-3.5" /> },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`h-7 px-3 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors ${
                tab === t.k
                  ? 'bg-white/[0.08] text-[#EDE5D4]'
                  : 'text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.04]'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#7A6F65] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
          aria-label="Close panel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {tab === 'emoji' && (
        <>
          <div className="flex gap-1 px-3 py-2 border-b border-white/[0.04] overflow-x-auto">
            {EMOJI_CATEGORIES.map((c, i) => (
              <button
                key={c.name}
                onClick={() => setActiveCategory(i)}
                className={`shrink-0 w-8 h-8 rounded-lg text-[18px] flex items-center justify-center transition-colors ${
                  activeCategory === i ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                }`}
                title={c.name}
              >
                {c.icon}
              </button>
            ))}
          </div>
          <div className="h-[210px] overflow-y-auto px-3 py-2">
            <div className="grid grid-cols-8 sm:grid-cols-10 gap-0.5">
              {EMOJI_CATEGORIES[activeCategory].items.map((emoji, i) => (
                <button
                  key={`${emoji}-${i}`}
                  onClick={() => onPickEmoji(emoji)}
                  className="w-8 h-8 rounded-lg text-[20px] flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'gif' && <KlipyTab kind="gifs" onSend={onSendGif} />}
      {tab === 'stickers' && <KlipyTab kind="stickers" onSend={onSendSticker} />}

      {/* Attribution — required by KLIPY */}
      <div className="px-3 py-1 border-t border-white/[0.04] text-center">
        <a
          href="https://klipy.com"
          target="_blank"
          rel="noreferrer"
          className="text-[9px] text-[#5A524A] hover:text-[#A8A29E] transition-colors"
        >
          Powered by KLIPY
        </a>
      </div>
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Unified GIF / Sticker tab                                  */
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

  const isSticker = kind === 'stickers';

  return (
    <div className="flex flex-col h-[230px]">
      <div className="px-3 py-2 border-b border-white/[0.04]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5A524A] pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isSticker ? 'Search stickers' : 'Search GIFs'}
            className="w-full h-8 pl-8 pr-3 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[12px] text-[#EDE5D4] placeholder:text-[#5A524A] focus:outline-none focus:border-white/[0.12]"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="h-full flex items-center justify-center text-[#5A524A]">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-[11.5px] text-[#F87171] px-4 text-center">
            API key missing. Check VITE_KLIPY_API_KEY.
          </div>
        ) : empty ? (
          <div className="h-full flex items-center justify-center text-[11.5px] text-[#5A524A] px-4 text-center">
            No {isSticker ? 'stickers' : 'GIFs'} found
          </div>
        ) : (
          <div
            className={
              isSticker
                ? 'grid grid-cols-3 sm:grid-cols-4 gap-1.5'
                : 'grid grid-cols-2 sm:grid-cols-3 gap-1.5'
            }
          >
            {items.map((g) => (
              <button
                key={g.id}
                onClick={() => onSend(g.url)}
                className={`relative ${
                  isSticker ? 'aspect-square' : 'aspect-video'
                } rounded-lg overflow-hidden bg-white/[0.03] hover:ring-2 hover:ring-[#D97706] transition-all`}
              >
                <img
                  src={g.preview}
                  alt=""
                  loading="lazy"
                  className={`w-full h-full ${
                    isSticker ? 'object-contain' : 'object-cover'
                  }`}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.opacity = '0.3';
                  }}
                />
              </button>
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
      label: 'Photos & Videos',
      icon: <ImageIcon className="w-5 h-5" />,
      color: 'from-[#A78BFA] to-[#7C3AED]',
      onClick: onPhoto,
    },
    {
      key: 'camera',
      label: 'Camera',
      icon: <Camera className="w-5 h-5" />,
      color: 'from-[#FB7185] to-[#E11D48]',
      onClick: onCamera,
    },
    {
      key: 'doc',
      label: 'Document',
      icon: <FileText className="w-5 h-5" />,
      color: 'from-[#38BDF8] to-[#0EA5E9]',
      onClick: onDocument,
    },
    {
      key: 'audio',
      label: 'Audio',
      icon: <Music className="w-5 h-5" />,
      color: 'from-[#22C55E] to-[#16A34A]',
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
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-sm rounded-t-[24px] sm:rounded-[24px] bg-[#1C1A17] border-t sm:border border-white/[0.08] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <span className="text-[14px] font-semibold text-[#EDE5D4] tracking-tight">
                Share
              </span>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7A6F65] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 grid grid-cols-2 gap-2">
              {opts.map((o) => (
                <button
                  key={o.key}
                  onClick={() => {
                    o.onClick();
                    onClose();
                  }}
                  className="flex flex-col items-center gap-3 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-colors"
                >
                  <span
                    className={`w-12 h-12 rounded-full bg-gradient-to-br ${o.color} flex items-center justify-center text-white shadow-lg`}
                  >
                    {o.icon}
                  </span>
                  <span className="text-[12.5px] font-medium text-[#EDE5D4]">
                    {o.label}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Voice recorder — with real duration decoding               */
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

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
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

        // Decode real duration — fixes the 0:00 bug on mobile Safari/Chrome
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (preview) URL.revokeObjectURL(preview.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-2xl bg-[#B91C1C]/[0.10] border border-[#B91C1C]/30">
        <MicOff className="w-4 h-4 text-[#F87171]" />
        <span className="text-[12.5px] text-[#F87171] flex-1">{error}</span>
        <button
          onClick={cancelAll}
          className="text-[12px] text-[#EDE5D4] hover:underline"
        >
          Close
        </button>
      </div>
    );
  }

  if (preview) {
    return (
      <div className="flex items-center gap-2 px-2 py-2 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
        <button
          onClick={cancelAll}
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-[#F87171] hover:bg-[#B91C1C]/[0.10] transition-colors"
          title="Delete recording"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <Mic className="w-4 h-4 text-[#A8A29E] shrink-0" />
          <span className="text-[13px] font-medium text-[#EDE5D4] tabular-nums">
            {Math.floor(preview.durationSec / 60)}:
            {Math.floor(preview.durationSec % 60)
              .toString()
              .padStart(2, '0')}
          </span>
          <span className="text-[11.5px] text-[#7A6F65] truncate">
            Voice message ready
          </span>
        </div>
        <button
          onClick={sendRecording}
          className="shrink-0 w-10 h-10 rounded-full bg-[#D97706] hover:bg-[#B45309] text-[#171106] flex items-center justify-center transition-colors"
          title="Send voice message"
        >
          <Send className="w-[18px] h-[18px]" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
      <button
        onClick={cancelAll}
        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-[#A8A29E] hover:bg-white/[0.06] transition-colors"
        title="Cancel"
      >
        <X className="w-4 h-4" />
      </button>
      {recording ? (
        <div className="flex items-center gap-2 flex-1">
          <span className="w-2.5 h-2.5 rounded-full bg-[#F87171] animate-pulse" />
          <span className="text-[13px] font-medium text-[#EDE5D4] tabular-nums">
            {Math.floor(elapsed / 60)}:
            {(elapsed % 60).toString().padStart(2, '0')}
          </span>
          <span className="text-[11.5px] text-[#7A6F65]">Recording…</span>
        </div>
      ) : (
        <span className="flex-1 text-[12.5px] text-[#A8A29E]">
          Tap the red button to record
        </span>
      )}
      {!recording ? (
        <button
          onClick={startRecording}
          className="shrink-0 w-10 h-10 rounded-full bg-[#F87171] hover:bg-[#E11D48] text-white flex items-center justify-center transition-colors"
          title="Start recording"
        >
          <Mic className="w-[18px] h-[18px]" />
        </button>
      ) : (
        <button
          onClick={stopRecording}
          className="shrink-0 w-10 h-10 rounded-full bg-[#D97706] hover:bg-[#B45309] text-[#171106] flex items-center justify-center transition-colors"
          title="Stop recording"
        >
          <StopCircle className="w-[18px] h-[18px]" />
        </button>
      )}
    </div>
  );
}