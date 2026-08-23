import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from './lib/realtime.js';
import {
  Archive, Bell, BellOff, Check, ChevronDown, Download, Edit3, FileText,
  Image as ImageIcon, Lock, LockKeyhole, LogOut, Menu, MessageCircle, Mic,
  MoreHorizontal, Paperclip, Pin, Plus, Reply, Search, Send, Settings,
  Shield, ShieldCheck, Smile, Sparkles, Trash2, UserPlus, Users, X, Phone, Video, WandSparkles, CalendarClock
} from 'lucide-react';
import { api, API_URL } from './lib/api.js';
import { decryptFile, decryptText, encryptFile, encryptText, hashLocalPin } from './lib/crypto.js';
import AdvancedTools from './AdvancedTools.jsx';
import CallOverlay from './CallOverlay.jsx';

const DEFAULT_UI = {
  theme: 'dark',
  accent: '#7c5cff',
  fontSize: 15,
  bubbleRadius: 18,
  density: 'comfortable',
  wallpaper: 'aurora'
};

const WALLPAPERS = [
  ['aurora', 'Aurora'],
  ['midnight', 'Midnight'],
  ['mesh', 'Soft Mesh'],
  ['plain', 'Plain']
];

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function initials(name = '?') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || '?';
}

function formatTime(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function formatChatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? formatTime(iso)
    : new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' }).format(date);
}

function chatName(chat, me) {
  if (!chat) return '';
  if (chat.type === 'saved') return 'Saved Messages';
  if (chat.type === 'group') return chat.title;
  return chat.members?.find(m => m.id !== me?.id)?.displayName || 'Direct message';
}

function chatSubtitle(chat, me, onlineUsers) {
  if (!chat) return '';
  if (chat.type === 'saved') return 'Private notes to yourself';
  if (chat.type === 'group') return `${chat.members?.length || 0} members`;
  const other = chat.members?.find(m => m.id !== me?.id);
  return onlineUsers.has(other?.id) ? 'online' : `@${other?.username || 'user'}`;
}

function Avatar({ name, src, size = 42 }) {
  return (
    <div className="avatar" style={{ width: size, height: size, minWidth: size }}>
      {src ? <img src={src} alt="" /> : <span>{initials(name)}</span>}
    </div>
  );
}

function Modal({ title, children, onClose, wide = false }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose}><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', displayName: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = mode === 'register'
        ? form
        : { username: form.username, password: form.password };
      const data = await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) });
      localStorage.setItem('privora_token', data.token);
      onAuth(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-glow glow-one" />
      <div className="auth-glow glow-two" />
      <section className="auth-card glass">
        <div className="brand brand-large"><span className="brand-mark"><ShieldCheck size={24} /></span> PRIVORA</div>
        <h1>Private conversations,<br />your way.</h1>
        <p className="muted">A Telegram-inspired messenger starter with live chat, secure rooms and deep appearance controls.</p>
        <form onSubmit={submit}>
          {mode === 'register' && (
            <label>Display name<input value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} placeholder="Alex" autoComplete="name" /></label>
          )}
          <label>Username<input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="alex_01" autoComplete="username" /></label>
          <label>Password<input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
          {error && <div className="error-box">{error}</div>}
          <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        <button className="text-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
        <div className="privacy-note"><LockKeyhole size={16} /> Secure Room Codes never need to be sent to the server.</div>
      </section>
    </main>
  );
}

function LockScreen({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  async function unlock(e) {
    e.preventDefault();
    const hash = await hashLocalPin(pin);
    if (hash === localStorage.getItem('privora_lock_hash')) onUnlock();
    else { setError('Incorrect app PIN.'); setPin(''); }
  }
  return (
    <main className="auth-shell lock-shell">
      <section className="lock-card glass">
        <div className="lock-orb"><Lock size={30} /></div>
        <h1>Privora is locked</h1>
        <p className="muted">Enter the local app PIN for this browser.</p>
        <form onSubmit={unlock}>
          <input className="pin-input" type="password" inputMode="numeric" maxLength={12} value={pin} onChange={e => setPin(e.target.value)} autoFocus placeholder="••••" />
          {error && <div className="error-box">{error}</div>}
          <button className="primary-button">Unlock</button>
        </form>
      </section>
    </main>
  );
}

function NewChatModal({ me, onClose, onCreated }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]);
  const [mode, setMode] = useState('direct');
  const [groupName, setGroupName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState('');
  const community = mode !== 'direct';

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.trim().length < 2) return setResults([]);
      try { setResults(await api(`/api/users?q=${encodeURIComponent(query.trim())}`)); }
      catch { setResults([]); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  async function direct(user) {
    try { onCreated(await api('/api/chats/direct', { method: 'POST', body: JSON.stringify({ userId: user.id }) })); }
    catch (err) { setError(err.message); }
  }

  async function createCommunity() {
    try {
      const chat = await api('/api/chats/community', { method: 'POST', body: JSON.stringify({ type: mode, title: groupName, description, public: isPublic, memberIds: selected.map(u => u.id) }) });
      onCreated(chat);
    } catch (err) { setError(err.message); }
  }

  return <Modal title={mode === 'direct' ? 'New conversation' : mode === 'channel' ? 'New channel' : 'New group'} onClose={onClose} wide>
    <div className="segmented segmented-three">
      <button className={mode==='direct'?'active':''} onClick={()=>setMode('direct')}><MessageCircle size={16}/> Direct</button>
      <button className={mode==='group'?'active':''} onClick={()=>setMode('group')}><Users size={16}/> Group</button>
      <button className={mode==='channel'?'active':''} onClick={()=>setMode('channel')}><Bell size={16}/> Channel</button>
    </div>
    {community && <><label>Name<input value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder={mode==='channel'?'News & updates':'Weekend plans'}/></label><label>Description<textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="What is this community for?"/></label><label className="check-row"><input type="checkbox" checked={isPublic} onChange={e=>setIsPublic(e.target.checked)}/> Public / auto-approve invite links</label></>}
    <label>Find by username or name<div className="search-input"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search people…"/></div></label>
    {selected.length>0&&<div className="chips">{selected.map(u=><span key={u.id}>{u.displayName}<button onClick={()=>setSelected(selected.filter(x=>x.id!==u.id))}>×</button></span>)}</div>}
    <div className="user-results">{results.map(user=><button className="user-row" key={user.id} onClick={()=>community?setSelected(v=>v.some(x=>x.id===user.id)?v.filter(x=>x.id!==user.id):[...v,user]):direct(user)}><Avatar name={user.displayName} src={user.avatar}/><span><strong>{user.displayName}</strong><small>@{user.username}</small></span>{community&&selected.some(x=>x.id===user.id)&&<Check size={18}/>}</button>)}{query.length>=2&&results.length===0&&<div className="empty-small">No matching users.</div>}</div>
    {error&&<div className="error-box">{error}</div>}
    {community&&<button className="primary-button" disabled={groupName.trim().length<2} onClick={createCommunity}>Create {mode}</button>}
  </Modal>;
}

function SecureModal({ chat, code, setCode, onClose }) {
  const [value, setValue] = useState(code || '');
  function save() {
    setCode(value.trim());
    onClose();
  }
  return (
    <Modal title="Secure Room Code" onClose={onClose}>
      <div className="secure-hero"><ShieldCheck size={30} /><div><strong>Client-side encrypted mode</strong><p>The room code stays in this browser. Share it with the other person through a different trusted channel.</p></div></div>
      <label>Room code / passphrase<input type="password" value={value} onChange={e => setValue(e.target.value)} placeholder="Use a long unique phrase" /></label>
      <div className="info-box">Messages and new attachments sent while this code is active are AES-GCM encrypted before upload. This starter does <strong>not</strong> implement Signal-style identity verification, forward secrecy or automatic key exchange.</div>
      <div className="modal-actions">
        {code && <button className="danger-button" onClick={() => { setCode(''); onClose(); }}>Forget code</button>}
        <button className="primary-button" disabled={value.trim().length < 8} onClick={save}>Use secure mode</button>
      </div>
    </Modal>
  );
}

function SettingsModal({ me, setMe, ui, setUi, onClose, onLockNow }) {
  const [tab, setTab] = useState('appearance');
  const [profile, setProfile] = useState({ displayName: me.displayName, bio: me.bio || '', avatar: me.avatar || '' });
  const [pin, setPin] = useState('');
  const [saved, setSaved] = useState('');

  async function updateProfile() {
    try {
      const next = await api('/api/me', { method: 'PUT', body: JSON.stringify(profile) });
      setMe(next); setSaved('Profile saved.');
    } catch (err) { setSaved(err.message); }
  }

  async function updatePrivacy(key, value) {
    const settings = await api('/api/me/settings', { method: 'PUT', body: JSON.stringify({ [key]: value }) });
    setMe({ ...me, settings });
  }

  async function setLockPin() {
    if (pin.length < 4) return setSaved('PIN must be at least 4 characters.');
    localStorage.setItem('privora_lock_hash', await hashLocalPin(pin));
    setPin(''); setSaved('Local app lock enabled.');
  }

  function removeLock() {
    localStorage.removeItem('privora_lock_hash');
    setSaved('Local app lock removed.');
  }

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="settings-layout">
        <nav className="settings-nav">
          <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}><UserPlus size={17} /> Profile</button>
          <button className={tab === 'appearance' ? 'active' : ''} onClick={() => setTab('appearance')}><Sparkles size={17} /> Appearance</button>
          <button className={tab === 'privacy' ? 'active' : ''} onClick={() => setTab('privacy')}><Shield size={17} /> Privacy</button>
          <button className={tab === 'lock' ? 'active' : ''} onClick={() => setTab('lock')}><Lock size={17} /> App lock</button>
        </nav>
        <section className="settings-content">
          {tab === 'profile' && <>
            <h3>Your profile</h3>
            <label>Display name<input value={profile.displayName} onChange={e => setProfile({ ...profile, displayName: e.target.value })} /></label>
            <label>Bio<textarea rows="3" value={profile.bio} onChange={e => setProfile({ ...profile, bio: e.target.value })} placeholder="A little about you…" /></label>
            <label>Avatar URL<input value={profile.avatar} onChange={e => setProfile({ ...profile, avatar: e.target.value })} placeholder="https://…" /></label>
            <button className="primary-button" onClick={updateProfile}>Save profile</button>
          </>}

          {tab === 'appearance' && <>
            <h3>Make Privora yours</h3>
            <div className="setting-row"><div><strong>Theme</strong><small>Dark, light or follow the browser.</small></div><select value={ui.theme} onChange={e => setUi({ ...ui, theme: e.target.value })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></div>
            <div className="setting-row"><div><strong>Accent color</strong><small>Changes buttons, active chats and your bubbles.</small></div><input className="color-picker" type="color" value={ui.accent} onChange={e => setUi({ ...ui, accent: e.target.value })} /></div>
            <div className="setting-slider"><div><strong>Font size</strong><small>{ui.fontSize}px</small></div><input type="range" min="13" max="19" value={ui.fontSize} onChange={e => setUi({ ...ui, fontSize: Number(e.target.value) })} /></div>
            <div className="setting-slider"><div><strong>Bubble roundness</strong><small>{ui.bubbleRadius}px</small></div><input type="range" min="6" max="28" value={ui.bubbleRadius} onChange={e => setUi({ ...ui, bubbleRadius: Number(e.target.value) })} /></div>
            <div className="setting-row"><div><strong>Density</strong><small>Choose how tightly chats are packed.</small></div><select value={ui.density} onChange={e => setUi({ ...ui, density: e.target.value })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div>
            <div className="wallpaper-grid">{WALLPAPERS.map(([id, label]) => <button key={id} className={`wallpaper-card wallpaper-${id} ${ui.wallpaper === id ? 'active' : ''}`} onClick={() => setUi({ ...ui, wallpaper: id })}><span>{label}</span></button>)}</div>
          </>}

          {tab === 'privacy' && <>
            <h3>Privacy controls</h3>
            <ToggleRow label="Read receipts" hint="Tell other participants when you read a chat." value={me.settings?.readReceipts !== false} onChange={v => updatePrivacy('readReceipts', v)} />
            <ToggleRow label="Typing indicators" hint="Allow other participants to see when you type." value={me.settings?.typingIndicators !== false} onChange={v => updatePrivacy('typingIndicators', v)} />
            <ToggleRow label="Discoverable by username" hint="Let people find you using search." value={me.settings?.discoverByUsername !== false} onChange={v => updatePrivacy('discoverByUsername', v)} />
            <div className="setting-row"><div><strong>Last seen</strong><small>Who should be able to infer your activity?</small></div><select value={me.settings?.lastSeen || 'contacts'} onChange={e => updatePrivacy('lastSeen', e.target.value)}><option value="nobody">Nobody</option><option value="contacts">Contacts</option><option value="everyone">Everyone</option></select></div>
            <div className="setting-row"><div><strong>Default auto-delete</strong><small>Applied to new messages you send.</small></div><select value={me.settings?.defaultAutoDeleteSeconds || 0} onChange={e => updatePrivacy('defaultAutoDeleteSeconds', Number(e.target.value))}><option value="0">Off</option><option value="60">1 minute</option><option value="3600">1 hour</option><option value="86400">24 hours</option><option value="604800">7 days</option></select></div>
          </>}

          {tab === 'lock' && <>
            <h3>Local app lock</h3>
            <p className="muted">This locks Privora in this browser. It is separate from your account password.</p>
            <label>New PIN<input type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} placeholder="4+ characters" /></label>
            <div className="button-row"><button className="primary-button" onClick={setLockPin}>Enable / change PIN</button>{localStorage.getItem('privora_lock_hash') && <button className="secondary-button" onClick={removeLock}>Remove lock</button>}</div>
            {localStorage.getItem('privora_lock_hash') && <button className="secondary-button full" onClick={onLockNow}><Lock size={16} /> Lock now</button>}
          </>}
          {saved && <div className="info-box compact-info">{saved}</div>}
        </section>
      </div>
    </Modal>
  );
}

function ToggleRow({ label, hint, value, onChange }) {
  return <div className="setting-row"><div><strong>{label}</strong><small>{hint}</small></div><button className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)}><span /></button></div>;
}

function AttachmentView({ attachment, secureCode }) {
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const fullUrl = attachment?.url?.startsWith('http') ? attachment.url : `${API_URL}${attachment?.url}`;
  const originalType = attachment?.originalType || attachment?.type || attachment?.mimetype || '';
  const name = attachment?.originalName || attachment?.name || 'attachment';
  const isImage = originalType.startsWith('image/');

  async function fetchProtectedFile() {
    const response = await fetch(fullUrl, {
      headers: { Authorization: `Bearer ${localStorage.getItem('privora_token')}` }
    });
    if (!response.ok) throw new Error('File is unavailable.');
    return response.arrayBuffer();
  }

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    if (!attachment?.encrypted && isImage) {
      fetchProtectedFile()
        .then(buffer => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(new Blob([buffer], { type: originalType }));
          setPreviewUrl(objectUrl);
        })
        .catch(() => setError('Could not load image.'));
    }
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [fullUrl, attachment?.encrypted, isImage, originalType]);

  async function openFile() {
    if (attachment?.encrypted && !secureCode) return setError('Enter the Secure Room Code to open this encrypted file.');
    setBusy(true); setError('');
    try {
      const buffer = await fetchProtectedFile();
      const blob = attachment?.encrypted
        ? await decryptFile(secureCode, buffer, attachment)
        : new Blob([buffer], { type: originalType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      if (isImage) {
        setPreviewUrl(previous => { if (previous) URL.revokeObjectURL(previous); return url; });
      } else {
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      setError(attachment?.encrypted ? 'Could not decrypt file. Check the room code.' : 'Could not download file.');
    } finally { setBusy(false); }
  }

  if (attachment?.encrypted) {
    return <div className="attachment encrypted-attachment">
      {previewUrl && isImage ? <img className="message-image" src={previewUrl} alt={name} /> : <ShieldCheck size={20} />}
      <div><strong>{name}</strong><small>Encrypted attachment</small>{error && <em>{error}</em>}</div>
      <button className="icon-button" onClick={openFile} disabled={busy}><Download size={17} /></button>
    </div>;
  }

  if (isImage) return <div className="image-link">{previewUrl ? <img className="message-image" src={previewUrl} alt={name} /> : <button className="secondary-button" onClick={openFile}>Load image</button>}{error && <em>{error}</em>}</div>;
  return <button className="attachment attachment-button" onClick={openFile} disabled={busy}><FileText size={22} /><div><strong>{name}</strong><small>{attachment.size ? `${Math.round(attachment.size / 1024)} KB` : 'File'}</small></div><Download size={17} /></button>;
}

function MessageBubble({ message, me, members, secureCode, onReact, onEdit, onDelete, onReply, onPollVote }) {
  const mine = message.senderId === me.id;
  const sender = members?.find(m => m.id === message.senderId) || (message.senderId === 'bot:privora' ? { displayName: 'Privora Bot' } : null);
  const [plain, setPlain] = useState(message.encrypted ? '' : message.content);
  const [decryptError, setDecryptError] = useState('');
  const [showActions, setShowActions] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!message.encrypted) { setPlain(message.content); setDecryptError(''); return; }
    if (!secureCode) { setPlain(''); setDecryptError('Secure Room Code required'); return; }
    decryptText(secureCode, message.content, message.crypto)
      .then(text => { if (!cancelled) { setPlain(text); setDecryptError(''); } })
      .catch(() => { if (!cancelled) { setPlain(''); setDecryptError('Unable to decrypt'); } });
    return () => { cancelled = true; };
  }, [message.content, message.crypto, message.encrypted, secureCode]);

  const reactions = Object.entries(message.reactions || {}).filter(([, ids]) => ids.length);
  return (
    <div className={`message-line ${mine ? 'mine' : ''}`} onMouseEnter={() => setShowActions(true)} onMouseLeave={() => setShowActions(false)}>
      {!mine && <Avatar size={28} name={sender?.displayName || 'User'} src={sender?.avatar} />}
      <div className={`message-wrap ${mine ? 'mine' : ''}`}>
        {message.deletedAt ? <div className="message-bubble deleted-message">Message deleted</div> : <>
          {!mine && <div className="sender-name">{sender?.displayName || 'Unknown'}</div>}
          <div className={`message-bubble ${message.encrypted ? 'secure-bubble' : ''}`}>
            {message.encrypted && <span className="secure-mini"><LockKeyhole size={11} /> encrypted</span>}
            {message.forwardOfId && <div className="forward-label">↪ Forwarded</div>}
            {message.scheduledFor && !message.deliveredAt && <div className="scheduled-label"><CalendarClock size={12}/> Scheduled</div>}
            {message.kind === 'sticker' ? <div className="big-sticker">{message.meta?.sticker || plain}</div> : decryptError ? <span className="decrypt-error"><Lock size={15} /> {decryptError}</span> : plain && <div className="message-text">{plain}</div>}
            {message.kind === 'location' && message.meta && <a className="special-card" href={`https://www.openstreetmap.org/?mlat=${message.meta.lat}&mlon=${message.meta.lng}#map=16/${message.meta.lat}/${message.meta.lng}`} target="_blank" rel="noreferrer"><strong>📍 Shared location</strong><small>{Number(message.meta.lat).toFixed(5)}, {Number(message.meta.lng).toFixed(5)}</small></a>}
            {message.kind === 'contact' && message.meta && <div className="special-card"><strong>👤 {message.meta.name}</strong><small>{message.meta.value}</small></div>}
            {message.kind === 'poll' && message.poll && <div className="poll-card"><strong>{message.poll.quiz ? '🧠 ' : '📊 '}{message.poll.question}</strong>{message.poll.options.map(option => { const total = message.poll.options.reduce((n,o)=>n+(o.voters?.length||0),0); const pct = total ? Math.round((option.voters?.length||0)/total*100) : 0; const voted = option.voters?.includes(me.id); return <button key={option.id} className={voted?'voted':''} onClick={()=>onPollVote(message.id, option.id)}><span>{option.text}<em>{option.voters?.length||0}</em></span><i style={{width:`${pct}%`}}/></button>; })}<small>{message.poll.options.reduce((n,o)=>n+(o.voters?.length||0),0)} votes</small></div>}
            {message.attachment && <AttachmentView attachment={message.attachment} secureCode={secureCode} />}
            <div className="message-meta"><span>{formatTime(message.createdAt)}</span>{message.silent && <span>🔕</span>}{message.editedAt && <span>edited</span>}{mine && <Check size={12} />}</div>
          </div>
          {reactions.length > 0 && <div className="reactions">{reactions.map(([emoji, ids]) => <button key={emoji} className={ids.includes(me.id) ? 'mine-reaction' : ''} onClick={() => onReact(message.id, emoji)}>{emoji} {ids.length}</button>)}</div>}
        </>}
      </div>
      {showActions && !message.deletedAt && <div className={`message-actions ${mine ? 'actions-left' : ''}`}>
        <button title="React" onClick={() => onReact(message.id, '❤️')}>❤️</button>
        <button title="Reply" onClick={() => onReply(message)}><Reply size={14} /></button>
        {mine && <button title="Edit" onClick={() => onEdit(message, plain)}><Edit3 size={14} /></button>}
        {mine && <button title="Delete" onClick={() => onDelete(message.id)}><Trash2 size={14} /></button>}
      </div>}
    </div>
  );
}

function ChatSidebar({ me, chats, selectedId, setSelectedId, onlineUsers, onNewChat, onSettings, onLogout, onTogglePin, onToggleMute }) {
  const [search, setSearch] = useState('');
  const [menuChat, setMenuChat] = useState(null);
  const filtered = chats.filter(chat => chatName(chat, me).toLowerCase().includes(search.toLowerCase()));
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand"><span className="brand-mark"><ShieldCheck size={18} /></span> PRIVORA</div>
        <button className="icon-button" onClick={onNewChat} title="New conversation"><Plus size={20} /></button>
      </div>
      <div className="sidebar-search"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chats" /><kbd>⌘K</kbd></div>
      <div className="chat-list">
        {filtered.map(chat => {
          const name = chatName(chat, me);
          const other = chat.type === 'dm' ? chat.members?.find(m => m.id !== me.id) : null;
          const preview = chat.lastMessage?.deletedAt ? 'Message deleted' : chat.lastMessage?.encrypted ? '🔒 Encrypted message' : chat.lastMessage?.content || (chat.type === 'saved' ? 'Your private space' : 'No messages yet');
          const pinned = chat.pinnedBy?.includes(me.id);
          const muted = chat.mutedBy?.includes(me.id);
          return <button key={chat.id} className={`chat-row ${selectedId === chat.id ? 'active' : ''}`} onClick={() => setSelectedId(chat.id)}>
            <div className="avatar-wrap"><Avatar name={name} src={other?.avatar} />{onlineUsers.has(other?.id) && <span className="online-dot" />}</div>
            <div className="chat-row-main"><div className="chat-row-title"><strong>{name}</strong><span>{formatChatDate(chat.lastMessage?.createdAt || chat.createdAt)}</span></div><div className="chat-row-preview"><span>{preview}</span>{pinned && <Pin size={12} />}{muted && <BellOff size={12} />}</div></div>
            <button className="chat-menu-trigger" onClick={e => { e.stopPropagation(); setMenuChat(menuChat === chat.id ? null : chat.id); }}><MoreHorizontal size={17} /></button>
            {menuChat === chat.id && <div className="chat-context" onClick={e => e.stopPropagation()}>
              <button onClick={() => { onTogglePin(chat, !pinned); setMenuChat(null); }}><Pin size={14} /> {pinned ? 'Unpin' : 'Pin'}</button>
              <button onClick={() => { onToggleMute(chat, !muted); setMenuChat(null); }}>{muted ? <Bell size={14} /> : <BellOff size={14} />} {muted ? 'Unmute' : 'Mute'}</button>
            </div>}
          </button>;
        })}
        {filtered.length === 0 && <div className="sidebar-empty"><MessageCircle size={28} /><span>No chats found</span></div>}
      </div>
      <div className="sidebar-account">
        <Avatar size={36} name={me.displayName} src={me.avatar} />
        <div><strong>{me.displayName}</strong><small>@{me.username}</small></div>
        <button className="icon-button" onClick={onSettings}><Settings size={18} /></button>
        <button className="icon-button" onClick={onLogout}><LogOut size={18} /></button>
      </div>
    </aside>
  );
}

function Messenger({ me, setMe, onLogout, onLock }) {
  const [chats, setChats] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [composer, setComposer] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [autoDelete, setAutoDelete] = useState(me.settings?.defaultAutoDeleteSeconds || 0);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [secureOpen, setSecureOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [call, setCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [ui, setUi] = useState(() => loadJson('privora_ui', DEFAULT_UI));
  const [secureCodes, setSecureCodes] = useState(() => loadJson('privora_secure_codes', {}));
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState('');
  const socketRef = useRef(null);
  const endRef = useRef(null);
  const typingTimer = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const selected = useMemo(() => chats.find(c => c.id === selectedId) || null, [chats, selectedId]);
  const secureCode = selected ? secureCodes[selected.id] || '' : '';

  useEffect(() => {
    const resolvedTheme = ui.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : ui.theme;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.setProperty('--accent', ui.accent);
    document.documentElement.style.setProperty('--font-size', `${ui.fontSize}px`);
    document.documentElement.style.setProperty('--bubble-radius', `${ui.bubbleRadius}px`);
    document.documentElement.dataset.density = ui.density;
    document.documentElement.dataset.wallpaper = ui.wallpaper;
    localStorage.setItem('privora_ui', JSON.stringify(ui));
  }, [ui]);

  useEffect(() => { localStorage.setItem('privora_secure_codes', JSON.stringify(secureCodes)); }, [secureCodes]);

  async function loadChats(preferredId) {
    try {
      const data = await api('/api/chats');
      setChats(data);
      const next = preferredId || selectedId || data[0]?.id || '';
      if (next) setSelectedId(next);
    } catch (err) { showToast(err.message); }
  }

  useEffect(() => { loadChats(); }, []);

  useEffect(() => { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); }, []);

  useEffect(() => {
    const socket = io(API_URL || undefined, { auth: { token: localStorage.getItem('privora_token') } });
    socketRef.current = socket;
    socket.on('chat-created', chat => {
      setChats(current => current.some(c => c.id === chat.id) ? current : [chat, ...current]);
    });
    socket.on('message', msg => {
      setMessages(current => current.some(m => m.id === msg.id) ? current : [...current, msg]);
      loadChats();
      if (document.hidden && msg.senderId !== me.id && 'Notification' in window && Notification.permission === 'granted') new Notification('Privora', { body: msg.encrypted ? 'New encrypted message' : (msg.content || 'New message') });
    });
    socket.on('webrtc-signal', payload => {
      if (payload.signal?.type === 'offer' && !call) setIncomingCall(payload);
    });
    socket.on('chat-updated', () => loadChats());
    socket.on('topic-created', () => loadChats());
    socket.on('connect', () => {
      const queue = loadJson('privora_offline_queue', []);
      if (queue.length) { queue.forEach(item => socket.emit('send-message', item)); localStorage.setItem('privora_offline_queue', '[]'); showToast(`Sent ${queue.length} queued message${queue.length === 1 ? '' : 's'}.`); }
    });
    socket.on('message-updated', msg => {
      setMessages(current => current.map(m => m.id === msg.id ? msg : m));
      loadChats();
    });
    socket.on('typing', ({ chatId, userId, typing }) => {
      if (chatId !== selectedId) return;
      setTypingUsers(prev => { const next = new Set(prev); typing ? next.add(userId) : next.delete(userId); return next; });
    });
    socket.on('presence', ({ userId, online }) => {
      setOnlineUsers(prev => { const next = new Set(prev); online ? next.add(userId) : next.delete(userId); return next; });
    });
    socket.on('connect_error', err => { if (err.message === 'unauthorized') showToast('Session expired. Please sign in again.'); });
    return () => socket.disconnect();
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return setMessages([]);
    let active = true;
    api(`/api/chats/${selectedId}/messages`).then(data => { if (active) setMessages(data); }).catch(err => showToast(err.message));
    socketRef.current?.emit('join-chat', selectedId);
    setTypingUsers(new Set());
    return () => { active = false; };
  }, [selectedId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'instant' });
    const last = messages[messages.length - 1];
    if (last && selectedId && me.settings?.readReceipts !== false) socketRef.current?.emit('read', { chatId: selectedId, messageId: last.id });
  }, [messages, selectedId]);

  function showToast(text) {
    setToast(text);
    setTimeout(() => setToast(''), 2800);
  }

  function setRoomCode(value) {
    setSecureCodes(current => {
      const next = { ...current };
      if (value) next[selected.id] = value;
      else delete next[selected.id];
      return next;
    });
  }

  function emitTyping(value) {
    if (me.settings?.typingIndicators === false || !selectedId) return;
    socketRef.current?.emit('typing', { chatId: selectedId, typing: value });
  }

  function onComposerChange(value) {
    setComposer(value);
    emitTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => emitTyping(false), 900);
  }

  async function buildEncryptedPayload(text) {
    if (!secureCode) return { content: text, encrypted: false, crypto: null };
    const encrypted = await encryptText(secureCode, text);
    return { ...encrypted, encrypted: true };
  }

  async function sendMessage(e) {
    e?.preventDefault();
    if (!selected || !composer.trim()) return;
    const originalText = composer.trim();
    setComposer(''); emitTyping(false);
    try {
      if (editing) {
        const body = editing.encrypted
          ? await encryptText(secureCode, originalText).then(x => ({ ...x, encrypted: true }))
          : { content: originalText, encrypted: false, crypto: null };
        socketRef.current.emit('edit-message', { messageId: editing.id, content: body.content, crypto: body.crypto }, result => {
          if (!result?.ok) showToast(result?.error || 'Edit failed.');
        });
        setEditing(null);
      } else {
        const body = await buildEncryptedPayload(originalText);
        const outgoing = { chatId: selected.id, ...body, replyToId: replyTo?.id || null, autoDeleteSeconds: Number(autoDelete) };
        if (!socketRef.current?.connected) {
          const queue = loadJson('privora_offline_queue', []); queue.push(outgoing); localStorage.setItem('privora_offline_queue', JSON.stringify(queue)); showToast('Offline — message queued for reconnect.');
        } else socketRef.current.emit('send-message', outgoing, result => { if (!result?.ok) showToast(result?.error || 'Message failed.'); });
        setReplyTo(null);
      }
    } catch (err) { setComposer(originalText); showToast(err.message); }
  }

  function editMessage(message, plainText) {
    if (message.encrypted && !secureCode) return showToast('Enter the Secure Room Code before editing.');
    setEditing(message); setComposer(plainText || ''); setReplyTo(null);
  }

  function deleteMessage(messageId) {
    socketRef.current.emit('delete-message', { messageId }, result => { if (!result?.ok) showToast(result?.error || 'Delete failed.'); });
  }

  function react(messageId, emoji) { socketRef.current.emit('react', { messageId, emoji }); }
  function pollVote(messageId, optionId) { socketRef.current.emit('poll-vote', { messageId, optionId }, result => { if (!result?.ok) showToast(result?.error || 'Vote failed.'); }); }

  async function uploadAttachment(file) {
    if (!selected || !file) return;
    setUploading(true);
    try {
      let toUpload = file;
      let cryptoMeta = {};
      if (secureCode) {
        const encrypted = await encryptFile(secureCode, file);
        toUpload = new File([encrypted.blob], `${file.name}.privora`, { type: 'application/octet-stream' });
        cryptoMeta = encrypted.meta;
      }
      const form = new FormData(); form.append('file', toUpload);
      const uploaded = await api('/api/upload', { method: 'POST', body: form });
      const attachment = {
        url: uploaded.url,
        storedName: uploaded.storedName,
        size: uploaded.size,
        name: file.name,
        type: file.type,
        ...cryptoMeta
      };
      const encryptedLabel = secureCode ? await encryptText(secureCode, `Attachment: ${file.name}`) : null;
      socketRef.current.emit('send-message', {
        chatId: selected.id,
        content: encryptedLabel?.content || '',
        encrypted: Boolean(secureCode),
        crypto: encryptedLabel?.crypto || null,
        attachment,
        autoDeleteSeconds: Number(autoDelete)
      }, result => { if (!result?.ok) showToast(result?.error || 'Upload message failed.'); });
    } catch (err) { showToast(err.message); }
    finally { setUploading(false); }
  }

  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
        await uploadAttachment(file);
      };
      recorder.start(); mediaRecorderRef.current = recorder; setRecording(true);
    } catch { showToast('Microphone permission is required for voice notes.'); }
  }

  async function toggleChatPreference(chat, key, value) {
    try {
      await api(`/api/chats/${chat.id}/preferences`, { method: 'PUT', body: JSON.stringify({ [key]: value }) });
      loadChats();
    } catch (err) { showToast(err.message); }
  }

  if (!selected && chats.length === 0) {
    return <div className="app-shell"><ChatSidebar me={me} chats={[]} selectedId="" setSelectedId={setSelectedId} onlineUsers={onlineUsers} onNewChat={() => setNewChatOpen(true)} onSettings={() => setSettingsOpen(true)} onLogout={onLogout} onTogglePin={() => {}} onToggleMute={() => {}} /><main className="empty-chat"><div className="empty-orb"><MessageCircle size={34} /></div><h2>Start a private conversation</h2><p>Create a DM or group, then customize it exactly how you like.</p><button className="primary-button" onClick={() => setNewChatOpen(true)}><Plus size={17} /> New chat</button>{newChatOpen && <NewChatModal me={me} onClose={() => setNewChatOpen(false)} onCreated={chat => { setNewChatOpen(false); loadChats(chat.id); }} />}{settingsOpen && <SettingsModal me={me} setMe={setMe} ui={ui} setUi={setUi} onClose={() => setSettingsOpen(false)} onLockNow={() => { setSettingsOpen(false); onLock(); }} />}</main></div>;
  }

  return (
    <div className="app-shell">
      <ChatSidebar me={me} chats={chats} selectedId={selectedId} setSelectedId={setSelectedId} onlineUsers={onlineUsers} onNewChat={() => setNewChatOpen(true)} onSettings={() => setSettingsOpen(true)} onLogout={onLogout} onTogglePin={(chat, pinned) => toggleChatPreference(chat, 'pinned', pinned)} onToggleMute={(chat, muted) => toggleChatPreference(chat, 'muted', muted)} />
      <main className="chat-pane">
        <header className="chat-header">
          <div className="chat-identity"><Avatar name={chatName(selected, me)} /><div><strong>{chatName(selected, me)}</strong><small>{chatSubtitle(selected, me, onlineUsers)}</small></div></div>
          <div className="header-actions">
            <button className={`secure-button ${secureCode ? 'active' : ''}`} onClick={() => setSecureOpen(true)}><ShieldCheck size={17} /><span>{secureCode ? 'Secure mode on' : 'Secure room'}</span></button>
            <button className="icon-button" onClick={() => toggleChatPreference(selected, 'pinned', !selected.pinnedBy?.includes(me.id))}><Pin size={18} /></button>
            <button className="icon-button" title="Voice call" onClick={() => setCall({ kind: 'voice', initiator: true })}><Phone size={18} /></button><button className="icon-button" title="Video call" onClick={() => setCall({ kind: 'video', initiator: true })}><Video size={18} /></button><button className="icon-button" title="Power tools" onClick={() => setAdvancedOpen(true)}><WandSparkles size={19} /></button>
          </div>
        </header>

        <section className="messages-scroll">
          <div className="messages-column">
            <div className="privacy-banner"><Shield size={16} /><span>{secureCode ? 'Secure Room Code active — new message content and attachments are client-side encrypted.' : 'Standard chat mode — turn on Secure Room Code for client-side encryption.'}</span></div>
            {messages.length === 0 && <div className="conversation-empty"><div className="empty-orb small"><Sparkles size={24} /></div><h3>No messages yet</h3><p>Say hello, share a file, or switch on Secure Room mode first.</p></div>}
            {messages.map(msg => <MessageBubble key={msg.id} message={msg} me={me} members={selected.members} secureCode={secureCode} onReact={react} onEdit={editMessage} onDelete={deleteMessage} onReply={setReplyTo} onPollVote={pollVote} />)}
            <div ref={endRef} />
          </div>
        </section>

        {typingUsers.size > 0 && <div className="typing-indicator"><span /><span /><span /> Someone is typing…</div>}
        <section className="composer-area">
          {(replyTo || editing) && <div className="composer-context"><div>{editing ? <Edit3 size={15} /> : <Reply size={15} />}<span><strong>{editing ? 'Editing message' : 'Replying'}</strong><small>{editing ? 'Change the message and send again.' : 'Your next message will be linked as a reply.'}</small></span></div><button onClick={() => { setReplyTo(null); setEditing(null); setComposer(''); }}><X size={16} /></button></div>}
          <form className="composer" onSubmit={sendMessage}>
            <label className={`icon-button file-button ${uploading ? 'disabled' : ''}`} title="Attach file"><Paperclip size={20} /><input type="file" disabled={uploading} onChange={e => { const file = e.target.files?.[0]; if (file) uploadAttachment(file); e.target.value = ''; }} /></label>
            <button type="button" className="icon-button" title="Emoji" onClick={() => setComposer(c => `${c} 😊`)}><Smile size={20} /></button>
            <textarea rows="1" value={composer} onChange={e => onComposerChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder={secureCode ? 'Encrypted message…' : 'Message…'} />
            <select className="timer-select" title="Auto-delete" value={autoDelete} onChange={e => setAutoDelete(Number(e.target.value))}><option value="0">∞</option><option value="60">1m</option><option value="3600">1h</option><option value="86400">1d</option><option value="604800">7d</option></select>
            {!composer.trim() && <button type="button" className={`icon-button ${recording ? 'recording' : ''}`} onClick={toggleRecording} title="Voice note"><Mic size={20} /></button>}
            {composer.trim() && <button className="send-button" title="Send"><Send size={18} /></button>}
          </form>
        </section>
      </main>

      {newChatOpen && <NewChatModal me={me} onClose={() => setNewChatOpen(false)} onCreated={chat => { setNewChatOpen(false); loadChats(chat.id); socketRef.current?.emit('join-chat', chat.id); }} />}
      {settingsOpen && <SettingsModal me={me} setMe={setMe} ui={ui} setUi={setUi} onClose={() => setSettingsOpen(false)} onLockNow={() => { setSettingsOpen(false); onLock(); }} />}
      {secureOpen && <SecureModal chat={selected} code={secureCode} setCode={setRoomCode} onClose={() => setSecureOpen(false)} />}
      {advancedOpen && <AdvancedTools chat={selected} chats={chats} me={me} socketRef={socketRef} showToast={showToast} onReload={loadChats} onClose={() => setAdvancedOpen(false)} onStartCall={kind => setCall({ kind, initiator: true })} />}
      {incomingCall && !call && <div className="incoming-call"><div><Phone size={20}/><span><strong>Incoming {incomingCall.kind || 'video'} call</strong><small>from this chat</small></span></div><button className="primary-button" onClick={() => { setCall({ kind: incomingCall.kind || 'video', initiator: false, initialSignal: incomingCall }); setIncomingCall(null); }}>Answer</button><button className="danger-button" onClick={() => setIncomingCall(null)}>Decline</button></div>}
      {call && selected && <CallOverlay chat={selected} me={me} socketRef={socketRef} kind={call.kind} initiator={call.initiator} initialSignal={call.initialSignal} onClose={() => setCall(null)} showToast={showToast} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(Boolean(localStorage.getItem('privora_lock_hash')));

  useEffect(() => {
    const token = localStorage.getItem('privora_token');
    if (!token) return setLoading(false);
    api('/api/me').then(setMe).catch(() => localStorage.removeItem('privora_token')).finally(() => setLoading(false));
  }, []);

  function logout() {
    localStorage.removeItem('privora_token');
    setMe(null);
  }

  if (loading) return <div className="loading-screen"><div className="loading-logo"><ShieldCheck size={26} /></div><span>PRIVORA</span></div>;
  if (me && locked) return <LockScreen onUnlock={() => setLocked(false)} />;
  if (!me) return <AuthScreen onAuth={user => { setMe(user); setLocked(false); }} />;
  return <Messenger me={me} setMe={setMe} onLogout={logout} onLock={() => setLocked(true)} />;
}
