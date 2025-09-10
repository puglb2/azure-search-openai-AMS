import React, { useState } from 'react';

export default function App() {
  const [messages, setMessages] = useState<{role:'user'|'assistant', content:string}[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', content: text }]);
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json().catch(() => ({}));
      const reply = data?.reply || data?.error || '(no response)';
      setMessages(m => [...m, { role: 'assistant', content: reply }]);
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Sorry, something went wrong.' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '0 auto', padding: 16 }}>
      <h3>AMS Intake Assistant</h3>
      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, height: 360, overflowY: 'auto', background: '#fff' }}>
        {messages.length === 0 ? (
          <div style={{ color: '#666' }}>
            Welcome! This is a test build. Type anything to check connectivity with /api/chat.
          </div>
        ) : messages.map((m, i) => (
          <div key={i} style={{ margin: '8px 0' }}>
            <strong>{m.role === 'user' ? 'You' : 'Assistant'}:</strong> {m.content}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }}
          placeholder={busy ? 'Working…' : 'Type a message'}
          disabled={busy}
          style={{ flex: 1, padding: 10, borderRadius: 6, border: '1px solid #ccc' }}
        />
        <button onClick={send} disabled={busy} style={{ padding: '10px 16px', borderRadius: 6, border: '1px solid #333', background: '#111', color: '#fff' }}>
          Send
        </button>
      </div>
    </div>
  );
}
