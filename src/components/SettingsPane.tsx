/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import {
  API_BASE_URL,
  extractErrorMessage,
  getAccessToken,
  apiService,
} from '../services/api';
import { compressAvatar } from '../services/imageCompress';
import { Avatar } from './Avatar';
import { UserProfileModal } from './UserProfileModal';
import type { UserProfileDto } from '../types/api';
import {
  Copy,
  Check,
  Loader2,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Shield,
  Lock,
  KeyRound,
  Mail,
  Camera,
  Upload,
  X,
  ShieldOff,
  Inbox,
  ChevronRight,
  AtSign,
  Calendar,
  LifeBuoy,
  FileText,
  ScrollText,
} from 'lucide-react';

const SPRING = { type: 'spring' as const, stiffness: 240, damping: 26 };

/* Support inbox — change here if it ever moves */
const SUPPORT_EMAIL = 'prolium7@outlook.com';

function toAbsoluteAvatar(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const base = API_BASE_URL.replace(/\/+$/, '');
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

function memberSince(createdAt?: string): string {
  if (!createdAt) return '';
  try {
    const d = new Date(createdAt);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString([], { month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
}

function SettingsPane(): React.JSX.Element {
  const navigate = useNavigate();
  const { user, refreshUser, logout } = useAuth();
  const reduceMotion = useReducedMotion();

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  /* Avatar modal state */
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /* Blocked users modal */
  const [blockedModalOpen, setBlockedModalOpen] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<UserProfileDto[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [blockedError, setBlockedError] = useState<string | null>(null);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [blockedProfileModalUserId, setBlockedProfileModalUserId] = useState<string | null>(null);

  useEffect(() => {
    if (user?.displayName && displayName === '') {
      setDisplayName(user.displayName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.displayName]);

  const openAvatarModal = () => {
    setPendingFile(null);
    setPendingPreview(null);
    setUploadError(null);
    setAvatarModalOpen(true);
  };

  const closeAvatarModal = useCallback(() => {
    if (uploading) return;
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null);
    setPendingPreview(null);
    setUploadError(null);
    setAvatarModalOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [pendingPreview, uploading]);

  useEffect(() => {
    return () => {
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    };
  }, [pendingPreview]);

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setSaveError('Display name cannot be empty.');
      return;
    }

    setSaving(true);
    setSaveSuccess(false);
    setSaveError(null);

    try {
      await apiService.updateProfile({ displayName: displayName.trim() });
      await refreshUser();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(extractErrorMessage(err, 'Could not save. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const validateFile = (file: File): string | null => {
    if (!file.type.startsWith('image/')) return 'Only image files are allowed.';
    if (file.size > 10 * 1024 * 1024) return 'Image must be under 10 MB.';
    return null;
  };

  const pickFile = (file: File) => {
    const err = validateFile(file);
    if (err) {
      setUploadError(err);
      setPendingFile(null);
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
      setPendingPreview(null);
      return;
    }
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(file);
    setPendingPreview(URL.createObjectURL(file));
    setUploadError(null);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) pickFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) pickFile(file);
  };

  const handleUpload = async () => {
    if (!pendingFile) return;

    setUploading(true);
    setUploadError(null);

    try {
      let toSend = pendingFile;
      try {
        toSend = await compressAvatar(pendingFile);
      } catch {
        toSend = pendingFile;
      }

      const form = new FormData();
      form.append('file', toSend);

      const res = await fetch(
        `${API_BASE_URL.replace(/\/+$/, '')}/api/User/avatar`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getAccessToken() ?? ''}`,
          },
          body: form,
        },
      );

      if (!res.ok) {
        const raw = await res.text();
        let detail: unknown = raw;
        try {
          detail = JSON.parse(raw);
        } catch {
          /* not JSON — keep raw */
        }
        throw new Error(extractErrorMessage(detail, 'Upload failed.'));
      }

      await refreshUser();
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
      setPendingFile(null);
      setPendingPreview(null);
      setAvatarModalOpen(false);
    } catch (err) {
      setUploadError(extractErrorMessage(err, 'Upload failed.'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /* ── Blocked users ──────────────────────────────────────── */
  const openBlockedModal = useCallback(async () => {
    setBlockedModalOpen(true);
    setBlockedLoading(true);
    setBlockedError(null);
    try {
      const list = await apiService.getBlockedUsers();
      setBlockedUsers(list);
    } catch (err) {
      setBlockedError(extractErrorMessage(err, 'Could not load blocked users.'));
      setBlockedUsers([]);
    } finally {
      setBlockedLoading(false);
    }
  }, []);

  const handleUnblock = useCallback(async (targetId: string) => {
    setUnblockingId(targetId);
    try {
      await apiService.unblockUser(targetId);
      setBlockedUsers((prev) => prev.filter((u) => u.id !== targetId));
    } catch (err) {
      alert(`Could not unblock: ${extractErrorMessage(err)}`);
    } finally {
      setUnblockingId(null);
    }
  }, []);

  const handleSignOut = async () => {
    await logout();
    navigate('/login');
  };

  const stagger = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: { ...SPRING, delay },
        };

  return (
    <div className="h-full overflow-y-auto bg-[#0F0D0A] text-[#EDE5D4]">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Hero profile card ─────────────────────────── */}
        <motion.div {...stagger(0)}>
          <div className="relative overflow-hidden rounded-[24px] border border-white/[0.08] bg-gradient-to-b from-[#1C1A17] to-[#131110]">
            <div className="h-24 bg-gradient-to-br from-[#D97706]/25 via-[#D97706]/[0.06] to-transparent" />

            <div className="px-5 sm:px-6 pb-6 -mt-12">
              <div className="flex items-end gap-4">
                <button
                  type="button"
                  onClick={openAvatarModal}
                  className="relative shrink-0 group rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/60"
                  aria-label="Change avatar"
                >
                  <div className="p-[3px] rounded-full bg-gradient-to-tr from-[#D97706] via-[#D97706]/40 to-transparent">
                    <div className="p-[3px] rounded-full bg-[#131110]">
                      <Avatar
                        name={displayName || user?.displayName || 'User'}
                        src={toAbsoluteAvatar(user?.avatarUrl)}
                        size="xl"
                        isOnline={false}
                      />
                    </div>
                  </div>
                  <span className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-[#D97706] hover:bg-[#B45309] text-[#171106] flex items-center justify-center border-[3px] border-[#131110] transition-colors">
                    <Camera className="w-3.5 h-3.5" />
                  </span>
                </button>

                <div className="min-w-0 flex-1 pb-1.5">
                  <h1 className="text-[20px] font-semibold text-[#EDE5D4] tracking-tight truncate">
                    {user?.displayName || 'Your name'}
                  </h1>
                  <p className="text-[12.5px] text-[#7A6F65] truncate mt-0.5">
                    @{user?.userHandle || 'guest'}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-4 flex-wrap">
                {user?.createdAt && (
                  <div className="inline-flex items-center gap-1.5 text-[11.5px] text-[#7A6F65]">
                    <Calendar className="w-3.5 h-3.5" />
                    Joined {memberSince(user.createdAt)}
                  </div>
                )}
                <div className="inline-flex items-center gap-1.5 text-[11.5px] text-[#4ADE80]">
                  <Lock className="w-3.5 h-3.5" />
                  
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Edit profile section ──────────────────────── */}
        <motion.section
          {...stagger(0.06)}
          className="rounded-2xl bg-[#14120F] border border-white/[0.06] overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center gap-2">
            <h2 className="text-[14px] font-semibold text-[#EDE5D4] tracking-tight">
              Edit profile
            </h2>
          </div>

          <form onSubmit={handleSaveProfile} className="p-5 space-y-5">
            <div className="space-y-1.5">
              <label className="block text-[11px] uppercase tracking-[0.16em] text-[#7A6F65] font-medium">
                Display name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (saveError) setSaveError(null);
                }}
                placeholder="Your name"
                className="w-full h-11 px-3.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-[14px] text-[#EDE5D4] placeholder:text-[#5A524A] focus:outline-none focus:border-[#D97706]/40 focus:bg-white/[0.06] transition-colors"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] uppercase tracking-[0.16em] text-[#7A6F65] font-medium">
                Email
              </label>
              <div className="flex items-center gap-2 h-11 px-3.5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                <Mail className="w-3.5 h-3.5 text-[#5A524A] shrink-0" />
                <span className="text-[13.5px] text-[#A8A29E] truncate flex-1">
                  {user?.email || 'Not available'}
                </span>
              </div>
            </div>

            <AnimatePresence>
              {saveError && (
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="rounded-xl bg-[#B91C1C]/10 border border-[#B91C1C]/25 px-3.5 py-2.5 text-[12.5px] text-[#F87171] flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{saveError}</span>
                </motion.div>
              )}

              {saveSuccess && (
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="rounded-xl bg-[#15803D]/10 border border-[#15803D]/25 px-3.5 py-2.5 text-[12.5px] text-[#4ADE80] flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Saved.</span>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving || displayName.trim() === (user?.displayName ?? '')}
                className="h-10 px-5 rounded-xl bg-[#D97706] hover:bg-[#B45309] disabled:opacity-30 disabled:cursor-not-allowed text-[#171106] text-[13px] font-semibold inline-flex items-center gap-2 transition-colors"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{saving ? 'Saving…' : 'Save'}</span>
              </button>
            </div>
          </form>
        </motion.section>

        {/* ── Account section ───────────────────────────── */}
        <motion.section
          {...stagger(0.12)}
          className="rounded-2xl bg-[#14120F] border border-white/[0.06] overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-white/[0.06]">
            <h2 className="text-[14px] font-semibold text-[#EDE5D4] tracking-tight">
              Account
            </h2>
          </div>

          <div className="divide-y divide-white/[0.04]">
            <Row
              icon={<AtSign className="w-4 h-4 text-[#D97706]" />}
              label="Handle"
              hint="Used by others to find you"
            >
              <div className="flex items-center gap-1">
                <span className="text-[13px] text-[#EDE5D4] font-medium truncate max-w-[180px] tabular-nums">
                  {user?.userHandle || 'guest'}@orbit
                </span>
                <button
                  type="button"
                  onClick={() =>
                    user?.userHandle &&
                    handleCopy(
                      user.fullHandle || `${user.userHandle}@orbit`,
                      'handle',
                    )
                  }
                  className="p-1.5 rounded-lg text-[#5A524A] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
                  title="Copy handle"
                >
                  {copiedField === 'handle' ? (
                    <Check className="w-3.5 h-3.5 text-[#4ADE80]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </Row>

            <Row
              icon={<KeyRound className="w-4 h-4 text-[#A8A29E]" />}
              label="Password"
              hint="Change your account password"
            >
              <Link
                to="/forgot-password"
                className="text-[13px] text-[#D97706] hover:text-[#B45309] font-medium transition-colors"
              >
                Change
              </Link>
            </Row>
          </div>
        </motion.section>

        {/* ── Privacy section ───────────────────────────── */}
        <motion.section
          {...stagger(0.18)}
          className="rounded-2xl bg-[#14120F] border border-white/[0.06] overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-white/[0.06]">
            <h2 className="text-[14px] font-semibold text-[#EDE5D4] tracking-tight">
              Privacy
            </h2>
          </div>

          <div className="divide-y divide-white/[0.04]">
            <Row
              icon={<Lock className="w-4 h-4 text-[#4ADE80]" />}
              label="End-to-end encrypted"
              hint="Messages and calls are encrypted on your device"
            >
              <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-[#4ADE80] font-medium">
                <CheckCircle2 className="w-3 h-3" />
                On
              </span>
            </Row>

            <Row
              icon={<ShieldOff className="w-4 h-4 text-[#A8A29E]" />}
              label="Blocked users"
              hint="Manage people you've blocked"
            >
              <button
                type="button"
                onClick={() => void openBlockedModal()}
                className="text-[13px] text-[#D97706] hover:text-[#B45309] font-medium inline-flex items-center gap-1 transition-colors"
              >
                Manage
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </Row>

            <Row
              icon={<Shield className="w-4 h-4 text-[#5A524A]" />}
              label="Data export"
              hint="Download a copy of your account data"
            >
              <button
                type="button"
                disabled
                title="Coming soon"
                className="text-[13px] text-[#5A524A] cursor-not-allowed"
              >
                Soon
              </button>
            </Row>
          </div>
        </motion.section>

        {/* ── Support section ───────────────────────────── */}
        <motion.section
          {...stagger(0.22)}
          className="rounded-2xl bg-[#14120F] border border-white/[0.06] overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-white/[0.06]">
            <h2 className="text-[14px] font-semibold text-[#EDE5D4] tracking-tight">
              Support
            </h2>
          </div>

          <div className="divide-y divide-white/[0.04]">
            <Row
              icon={<LifeBuoy className="w-4 h-4 text-[#D97706]" />}
              label="Contact support"
              hint="We usually reply within 24 hours"
            >
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=Orbital%20Support%20Request`}
                className="text-[13px] text-[#D97706] hover:text-[#B45309] font-medium inline-flex items-center gap-1 transition-colors"
              >
                Email us
                <ChevronRight className="w-3.5 h-3.5" />
              </a>
            </Row>
          </div>
        </motion.section>

        {/* ── Legal & Info section ──────────────────────── */}
        <motion.section
          {...stagger(0.24)}
          className="rounded-2xl bg-[#14120F] border border-white/[0.06] overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-[#EDE5D4] tracking-tight">
              Legal &amp; Info
            </h2>
            <span className="text-[9.5px] font-mono uppercase tracking-[0.18em] text-[#5A524A] px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.05]">
              v1.0
            </span>
          </div>

          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Terms card */}
            <Link
              to="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-[#D97706]/30 p-4 transition-all duration-200"
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background:
                    'radial-gradient(circle at top right, rgba(217,119,6,0.10) 0%, transparent 60%)',
                }}
              />

              <div className="relative flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#D97706]/10 border border-[#D97706]/20 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-[#D97706]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13.5px] font-semibold text-[#EDE5D4]">
                      Terms of Service
                    </p>
                    <ChevronRight className="w-4 h-4 text-[#5A524A] group-hover:text-[#D97706] group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                  <p className="text-[11px] text-[#7A6F65] mt-1 leading-snug">
                    The agreement between you and Orbital
                  </p>
                  <p className="text-[9.5px] font-mono uppercase tracking-[0.16em] text-[#5A524A] mt-2.5">
                    2 min read · Oct 2026
                  </p>
                </div>
              </div>
            </Link>

            {/* Privacy card */}
            <Link
              to="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-[#4ADE80]/30 p-4 transition-all duration-200"
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background:
                    'radial-gradient(circle at top right, rgba(74,222,128,0.08) 0%, transparent 60%)',
                }}
              />

              <div className="relative flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#4ADE80]/10 border border-[#4ADE80]/20 flex items-center justify-center shrink-0">
                  <ScrollText className="w-4 h-4 text-[#4ADE80]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13.5px] font-semibold text-[#EDE5D4]">
                      Privacy Policy
                    </p>
                    <ChevronRight className="w-4 h-4 text-[#5A524A] group-hover:text-[#4ADE80] group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                  <p className="text-[11px] text-[#7A6F65] mt-1 leading-snug">
                    What we do with your data — and don&apos;t
                  </p>
                  <p className="text-[9.5px] font-mono uppercase tracking-[0.16em] text-[#5A524A] mt-2.5">
                    3 min read · Oct 2026
                  </p>
                </div>
              </div>
            </Link>
          </div>
        </motion.section>

        {/* ── Danger zone ───────────────────────────────── */}
        <motion.section
          {...stagger(0.28)}
          className="rounded-2xl bg-[#B91C1C]/[0.05] border border-[#B91C1C]/20 overflow-hidden"
        >
          <div className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-[14.5px] font-semibold text-[#EDE5D4] tracking-tight">
                Sign out
              </h3>
              <p className="text-[12.5px] text-[#A8A29E] mt-0.5">
                Log out of this device. You can sign back in any time.
              </p>
            </div>

            <button
              onClick={() => void handleSignOut()}
              className="shrink-0 h-10 px-4 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] text-white text-[13px] font-semibold inline-flex items-center gap-2 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </motion.section>

        {/* ── Footer ────────────────────────────────────── */}
        <motion.div
          {...stagger(0.32)}
          className="text-center pt-2 pb-4 space-y-2"
        >
          <p className="text-[11px] text-[#5A524A]">
            © {new Date().getFullYear()} Orbital · Private &amp; Direct
          </p>
          <p className="flex items-center justify-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em]">
            <Link
              to="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#5A524A] hover:text-[#D97706] transition-colors"
            >
              Terms
            </Link>
            <span aria-hidden className="text-[#3A342E]">·</span>
            <Link
              to="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#5A524A] hover:text-[#D97706] transition-colors"
            >
              Privacy
            </Link>
            <span aria-hidden className="text-[#3A342E]">·</span>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-[#5A524A] hover:text-[#D97706] transition-colors"
            >
              Support
            </a>
          </p>
        </motion.div>
      </div>

      {/* ── Avatar modal ────────────────────────────────── */}
      <AnimatePresence>
        {avatarModalOpen && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={closeAvatarModal}
          >
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-[22px] bg-[#1C1A17] border border-white/[0.08] overflow-hidden shadow-2xl"
            >
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
                <h3 className="text-[14.5px] font-semibold text-[#EDE5D4] tracking-tight">
                  Change profile photo
                </h3>
                <button
                  type="button"
                  onClick={closeAvatarModal}
                  disabled={uploading}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7A6F65] hover:text-[#EDE5D4] hover:bg-white/[0.05] disabled:opacity-40 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  className={`relative rounded-2xl border-2 border-dashed transition-colors cursor-pointer flex flex-col items-center justify-center py-10 px-4 ${
                    dragActive
                      ? 'border-[#D97706]/70 bg-[#D97706]/[0.06]'
                      : 'border-white/[0.10] hover:border-white/[0.18] bg-white/[0.02]'
                  }`}
                >
                  {pendingPreview ? (
                    <img
                      src={pendingPreview}
                      alt="Preview"
                      className="w-32 h-32 rounded-full object-cover border-2 border-white/[0.10]"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-3">
                      <Upload className="w-6 h-6 text-[#7A6F65]" />
                    </div>
                  )}

                  <p className="text-[13px] text-[#A8A29E] mt-3 text-center max-w-[260px] truncate">
                    {pendingFile ? pendingFile.name : 'Drag & drop or click to browse'}
                  </p>
                  <p className="text-[11px] text-[#5A524A] mt-1 text-center">
                    Resized to 256px · ~200 KB
                  </p>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileInput}
                    className="hidden"
                  />
                </div>

                <AnimatePresence>
                  {uploadError && (
                    <motion.div
                      initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="rounded-xl bg-[#B91C1C]/10 border border-[#B91C1C]/25 px-3 py-2.5 text-[12.5px] text-[#F87171] flex items-center gap-2"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{uploadError}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-end gap-2 bg-[#0F0D0A]/40">
                <button
                  type="button"
                  onClick={closeAvatarModal}
                  disabled={uploading}
                  className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[12.5px] text-[#EDE5D4] disabled:opacity-40 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleUpload()}
                  disabled={!pendingFile || uploading}
                  className="h-9 px-4 rounded-xl bg-[#D97706] hover:bg-[#B45309] disabled:opacity-30 disabled:cursor-not-allowed text-[#171106] text-[12.5px] font-semibold inline-flex items-center gap-2 transition-colors"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5" />
                      Save
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Blocked users modal ─────────────────────────── */}
      <AnimatePresence>
        {blockedModalOpen && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setBlockedModalOpen(false)}
          >
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-[22px] bg-[#1C1A17] border border-white/[0.08] overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
            >
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#B91C1C]/10 border border-[#B91C1C]/25 flex items-center justify-center text-[#F87171]">
                    <ShieldOff className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-[14.5px] font-semibold text-[#EDE5D4] tracking-tight">
                      Blocked users
                    </h3>
                    <p className="text-[11px] text-[#7A6F65] mt-0.5">
                      {blockedUsers.length} blocked
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setBlockedModalOpen(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7A6F65] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {blockedLoading ? (
                  <div className="py-12 flex items-center justify-center text-[12.5px] text-[#7A6F65]">
                    <Loader2 className="w-4 h-4 animate-spin mr-2 text-[#D97706]" />
                    Loading…
                  </div>
                ) : blockedError ? (
                  <div className="p-6 text-center">
                    <AlertCircle className="w-8 h-8 text-[#F87171] mx-auto mb-3" />
                    <p className="text-[13px] text-[#F87171]">{blockedError}</p>
                  </div>
                ) : blockedUsers.length === 0 ? (
                  <div className="py-12 text-center px-6">
                    <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto">
                      <Inbox className="w-6 h-6 text-[#7A6F65]" />
                    </div>
                    <p className="text-[14px] text-[#EDE5D4] font-semibold mt-3 tracking-tight">
                      No blocked users
                    </p>
                    <p className="text-[12px] text-[#7A6F65] mt-1">
                      Anyone you block will appear here.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.04]">
                    {blockedUsers.map((u) => (
                      <div
                        key={u.id}
                        className="px-5 py-3 flex items-center gap-3"
                      >
                        <button
                          type="button"
                          onClick={() => setBlockedProfileModalUserId(u.id)}
                          className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/50"
                          aria-label={`View ${u.displayName}'s profile`}
                        >
                          <Avatar
                            name={u.displayName}
                            src={toAbsoluteAvatar(u.avatarUrl)}
                            size="sm"
                          />
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] text-[#EDE5D4] truncate font-medium">
                            {u.displayName}
                          </p>
                          <p className="text-[11px] text-[#7A6F65] truncate mt-0.5">
                            @{u.userHandle}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleUnblock(u.id)}
                          disabled={unblockingId === u.id}
                          className="shrink-0 h-8 px-3 rounded-lg bg-white/[0.04] hover:bg-[#15803D]/[0.12] border border-white/[0.06] hover:border-[#15803D]/30 disabled:opacity-40 text-[12px] font-medium text-[#4ADE80] inline-flex items-center gap-1.5 transition-colors"
                        >
                          {unblockingId === u.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Shield className="w-3.5 h-3.5" />
                          )}
                          <span>Unblock</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-end bg-[#0F0D0A]/40 shrink-0">
                <button
                  type="button"
                  onClick={() => setBlockedModalOpen(false)}
                  className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[12.5px] text-[#EDE5D4] transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <UserProfileModal
        userId={blockedProfileModalUserId}
        onClose={() => setBlockedProfileModalUserId(null)}
      />
    </div>
  );
}

function Row({
  icon,
  label,
  hint,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-white/[0.015] transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[13.5px] text-[#EDE5D4] font-medium">{label}</p>
          {hint && (
            <p className="text-[11.5px] text-[#7A6F65] mt-0.5 truncate">
              {hint}
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default SettingsPane;