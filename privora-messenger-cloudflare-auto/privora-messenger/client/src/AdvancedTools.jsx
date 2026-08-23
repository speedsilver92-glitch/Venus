import React, { useEffect, useMemo, useState } from 'react';
import { api, API_URL } from './lib/api.js';
import { AppWindow, CalendarClock, Contact, Copy, Forward, Image, Link2, MapPin, MoreHorizontal, Settings2, Sparkles, Users, Vote, X } from 'lucide-react';

function emitAck(socketRef, event, payload, showToast, success) {
  socketRef.current?.emit(event, payload, result => {
    if (!result?.ok) showToast(result?.error || 'Action failed.');
    else if (success) success(result);
  });
}

export default function AdvancedTools({ chat, chats, me, socketRef, showToast, onReload, onClose, onStartCall }) {
  const [tab, setTab] = useState('send');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [quiz, setQuiz] = useState(false);
  const [multiple, setMultiple] = useState(false);
  const [scheduleText, setScheduleText] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [silent, setSilent] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactValue, setContactValue] = useState('');
  const [topicTitle, setTopicTitle] = useState('');
  const [invite, setInvite] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [media, setMedia] = useState([]);
  const [members, setMembers] = useState([]);
  const [miniApps, setMiniApps] = useState([]);
  const [note, setNote] = useState(() => localStorage.getItem('privora_mini_note') || '');
  const [tasks, setTasks] = useState(() => { try { return JSON.parse(localStorage.getItem('privora_mini_tasks')) || []; } catch { return []; } });
  const [taskText, setTaskText] = useState('');
  const [generated, setGenerated] = useState('');
  const isCommunity = ['group','channel'].includes(chat?.type);
  const isAdmin = Boolean(chat?.admins?.includes(me.id));

  useEffect(() => {
    api('/api/mini-apps').then(setMiniApps).catch(() => {});
    if (chat) {
      api(`/api/chats/${chat.id}/media`).then(setMedia).catch(() => {});
      api(`/api/chats/${chat.id}/members`).then(setMembers).catch(() => {});
    }
  }, [chat?.id]);

  function sendPoll() {
    const options = pollOptions.map((text, i) => ({ id: `o${i}`, text: text.trim() })).filter(o => o.text);
    if (pollQuestion.trim().length < 2 || options.length < 2) return showToast('Add a question and at least two options.');
    emitAck(socketRef, 'send-message', { chatId: chat.id, kind: 'poll', poll: { question: pollQuestion, options, quiz, multiple, correctOptionId: quiz ? options[0]?.id : null }, content: pollQuestion }, showToast, () => { showToast('Poll sent.'); onClose(); });
  }

  function sendScheduled() {
    if (!scheduleText.trim()) return;
    emitAck(socketRef, 'send-message', { chatId: chat.id, content: scheduleText.trim(), scheduledAt: scheduleAt ? new Date(scheduleAt).toISOString() : null, silent }, showToast, () => { showToast(scheduleAt ? 'Message scheduled.' : silent ? 'Silent message sent.' : 'Message sent.'); onClose(); });
  }

  function sendContact() {
    if (!contactName.trim() || !contactValue.trim()) return showToast('Add a contact name and phone/email.');
    emitAck(socketRef, 'send-message', { chatId: chat.id, kind: 'contact', content: `Contact: ${contactName}`, meta: { name: contactName, value: contactValue } }, showToast, () => onClose());
  }

  function sendLocation() {
    if (!navigator.geolocation) return showToast('Location is not supported by this browser.');
    navigator.geolocation.getCurrentPosition(pos => {
      emitAck(socketRef, 'send-message', { chatId: chat.id, kind: 'location', content: 'Shared location', meta: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } }, showToast, () => onClose());
    }, () => showToast('Location permission was denied.'));
  }

  function sendSticker(value) {
    emitAck(socketRef, 'send-message', { chatId: chat.id, kind: 'sticker', content: value, meta: { sticker: value } }, showToast, () => onClose());
  }

  async function createInvite(rotate = false) {
    try { const data = await api(`/api/chats/${chat.id}/invite`, { method: 'POST', body: JSON.stringify({ rotate }) }); setInvite(data.code); } catch (err) { showToast(err.message); }
  }

  async function joinInvite() {
    try { const r = await api(`/api/invites/${joinCode.trim()}/join`, { method: 'POST', body: '{}' }); showToast(r.joined ? 'Joined community.' : 'Join request sent.'); onReload(); } catch (err) { showToast(err.message); }
  }

  async function addTopic() {
    try { await api(`/api/chats/${chat.id}/topics`, { method: 'POST', body: JSON.stringify({ title: topicTitle, icon: '💬' }) }); setTopicTitle(''); onReload(); showToast('Topic created.'); } catch (err) { showToast(err.message); }
  }

  async function updatePermissions(key, value) {
    try { await api(`/api/chats/${chat.id}/manage`, { method: 'PUT', body: JSON.stringify({ permissions: { [key]: value } }) }); onReload(); } catch (err) { showToast(err.message); }
  }

  async function setRole(userId, role) {
    try { await api(`/api/chats/${chat.id}/manage`, { method: 'PUT', body: JSON.stringify({ memberId: userId, role }) }); setMembers(await api(`/api/chats/${chat.id}/members`)); onReload(); } catch (err) { showToast(err.message); }
  }

  function forwardLast(targetChatId) {
    const recent = chat.lastMessage;
    if (!recent) return showToast('No recent message to forward from the chat preview.');
    emitAck(socketRef, 'send-message', { chatId: targetChatId, content: recent.content || 'Forwarded attachment', attachment: recent.attachment || null, forwardOfId: recent.id, kind: recent.kind || 'text', meta: recent.meta || null }, showToast, () => showToast('Forwarded.'));
  }

  function saveMiniData() { localStorage.setItem('privora_mini_note', note); localStorage.setItem('privora_mini_tasks', JSON.stringify(tasks)); showToast('Mini-app data saved locally.'); }
  function generateSecret() { const a = new Uint8Array(24); crypto.getRandomValues(a); setGenerated(Array.from(a, x => x.toString(36).padStart(2,'0')).join('').slice(0, 32)); }

  return <div className="advanced-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <section className="advanced-modal">
      <header><div><Sparkles size={20}/><strong>Privora Power Tools</strong></div><button className="icon-button" onClick={onClose}><X size={18}/></button></header>
      <nav className="advanced-tabs">
        <button className={tab==='send'?'active':''} onClick={()=>setTab('send')}><Vote size={15}/> Send+</button>
        <button className={tab==='community'?'active':''} onClick={()=>setTab('community')}><Users size={15}/> Community</button>
        <button className={tab==='media'?'active':''} onClick={()=>setTab('media')}><Image size={15}/> Media</button>
        <button className={tab==='apps'?'active':''} onClick={()=>setTab('apps')}><AppWindow size={15}/> Mini Apps</button>
      </nav>

      {tab === 'send' && <div className="advanced-body two-col">
        <div className="tool-card"><h3>Poll / quiz</h3><input value={pollQuestion} onChange={e=>setPollQuestion(e.target.value)} placeholder="Question"/>{pollOptions.map((o,i)=><input key={i} value={o} onChange={e=>setPollOptions(v=>v.map((x,j)=>j===i?e.target.value:x))} placeholder={`Option ${i+1}`}/>)}<button className="secondary-button" onClick={()=>setPollOptions(v=>[...v,''])}>+ option</button><div className="inline-options"><label><input type="checkbox" checked={multiple} onChange={e=>setMultiple(e.target.checked)}/> Multiple choice</label><label><input type="checkbox" checked={quiz} onChange={e=>setQuiz(e.target.checked)}/> Quiz</label></div><button className="primary-button" onClick={sendPoll}>Send poll</button></div>
        <div className="tool-card"><h3>Schedule / silent</h3><textarea value={scheduleText} onChange={e=>setScheduleText(e.target.value)} placeholder="Message…"/><input type="datetime-local" value={scheduleAt} onChange={e=>setScheduleAt(e.target.value)}/><label className="check-row"><input type="checkbox" checked={silent} onChange={e=>setSilent(e.target.checked)}/> Send silently</label><button className="primary-button" onClick={sendScheduled}><CalendarClock size={16}/> {scheduleAt?'Schedule':'Send'}</button></div>
        <div className="tool-card"><h3>Share</h3><input value={contactName} onChange={e=>setContactName(e.target.value)} placeholder="Contact name"/><input value={contactValue} onChange={e=>setContactValue(e.target.value)} placeholder="Phone or email"/><div className="tool-row"><button className="secondary-button" onClick={sendContact}><Contact size={16}/> Contact</button><button className="secondary-button" onClick={sendLocation}><MapPin size={16}/> Location</button></div></div>
        <div className="tool-card"><h3>Sticker pack</h3><div className="sticker-grid">{['😎','🔥','💜','👻','🤖','🫡','🦊','🐸','✨','🚀','💀','🛡️'].map(x=><button key={x} onClick={()=>sendSticker(x)}>{x}</button>)}</div><h3>Forward latest</h3><select onChange={e=>e.target.value && forwardLast(e.target.value)} defaultValue=""><option value="">Choose destination…</option>{chats.filter(c=>c.id!==chat.id).map(c=><option key={c.id} value={c.id}>{c.title || c.members?.find(m=>m.id!==me.id)?.displayName || 'Chat'}</option>)}</select></div>
      </div>}

      {tab === 'community' && <div className="advanced-body">
        <div className="tool-card"><h3>Join by invite code</h3><div className="tool-row"><input value={joinCode} onChange={e=>setJoinCode(e.target.value)} placeholder="Invite code"/><button className="secondary-button" onClick={joinInvite}>Join</button></div></div>
        {isCommunity ? <>
          <div className="tool-card"><h3>Invite link</h3><div className="tool-row"><input readOnly value={invite || chat.inviteCode || ''}/><button className="icon-button" onClick={()=>{ navigator.clipboard?.writeText(invite || chat.inviteCode || ''); showToast('Invite code copied.'); }}><Copy size={17}/></button><button className="secondary-button" onClick={()=>createInvite(false)}>Get</button>{isAdmin&&<button className="secondary-button" onClick={()=>createInvite(true)}>Rotate</button>}</div></div>
          <div className="tool-card"><h3>Topics</h3><div className="topic-chips">{(chat.topics||[]).map(t=><span key={t.id}>{t.icon} {t.title}</span>)}</div>{isAdmin&&<div className="tool-row"><input value={topicTitle} onChange={e=>setTopicTitle(e.target.value)} placeholder="New topic"/><button className="secondary-button" onClick={addTopic}>Create</button></div>}</div>
          {isAdmin && <div className="tool-card"><h3>Permissions</h3><label className="manage-row">Only admins can post <input type="checkbox" checked={Boolean(chat.permissions?.onlyAdminsCanPost)} onChange={e=>updatePermissions('onlyAdminsCanPost',e.target.checked)}/></label><label className="manage-row">Allow media <input type="checkbox" checked={chat.permissions?.allowMedia!==false} onChange={e=>updatePermissions('allowMedia',e.target.checked)}/></label><label className="manage-row">Allow polls <input type="checkbox" checked={chat.permissions?.allowPolls!==false} onChange={e=>updatePermissions('allowPolls',e.target.checked)}/></label><label className="manage-row">Slow mode <select value={chat.permissions?.slowModeSeconds||0} onChange={e=>updatePermissions('slowModeSeconds',Number(e.target.value))}><option value="0">Off</option><option value="10">10 sec</option><option value="30">30 sec</option><option value="60">1 min</option><option value="300">5 min</option></select></label></div>}
          <div className="tool-card"><h3>Members & roles</h3>{members.map(m=><div className="member-role" key={m.id}><span><strong>{m.displayName}</strong><small>@{m.username}</small></span>{isAdmin&&m.id!==me.id?<select value={m.role||'member'} onChange={e=>setRole(m.id,e.target.value)}><option value="member">Member</option><option value="moderator">Moderator</option><option value="admin">Admin</option></select>:<em>{m.role}</em>}</div>)}</div>
        </> : <div className="info-box">Community controls appear in groups and channels.</div>}
      </div>}

      {tab === 'media' && <div className="advanced-body"><div className="media-browser">{media.length===0&&<div className="empty-small">No shared media yet.</div>}{media.map(item=><a key={item.messageId} className="media-item" href={`${API_URL}${item.attachment.url}`} onClick={e=>e.preventDefault()}><Image size={18}/><span><strong>{item.attachment.name||item.attachment.originalName||'File'}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span></a>)}</div><div className="info-box">Downloads stay protected by chat membership. Large-scale resumable uploads/transcoding are scaffolded in the production config rather than faked locally.</div></div>}

      {tab === 'apps' && <div className="advanced-body two-col">
        <div className="tool-card"><h3>📝 Private Notes</h3><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Local browser note…"/><button className="secondary-button" onClick={saveMiniData}>Save locally</button></div>
        <div className="tool-card"><h3>✅ Task Board</h3><div className="tool-row"><input value={taskText} onChange={e=>setTaskText(e.target.value)} placeholder="New task"/><button className="secondary-button" onClick={()=>{ if(taskText.trim()){setTasks(v=>[...v,{id:Date.now(),text:taskText.trim(),done:false}]);setTaskText('');}}}>Add</button></div>{tasks.map(t=><label className="task-row" key={t.id}><input type="checkbox" checked={t.done} onChange={()=>setTasks(v=>v.map(x=>x.id===t.id?{...x,done:!x.done}:x))}/>{t.text}</label>)}<button className="secondary-button" onClick={saveMiniData}>Save</button></div>
        <div className="tool-card"><h3>🔐 Vault Generator</h3><button className="primary-button" onClick={generateSecret}>Generate secret</button>{generated&&<div className="secret-output">{generated}<button className="icon-button" onClick={()=>navigator.clipboard?.writeText(generated)}><Copy size={15}/></button></div>}</div>
        <div className="tool-card"><h3>Available mini apps</h3>{miniApps.map(a=><div className="mini-row" key={a.id}><span>{a.icon}</span><div><strong>{a.name}</strong><small>{a.description}</small></div></div>)}</div>
      </div>}
    </section>
  </div>;
}
