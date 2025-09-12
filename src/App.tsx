import React, { useState } from 'react'

export default function App() {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
  const text = input.trim();
  if (!text || busy) return;

  setInput('');
  setMessages(m => [...m, { role: 'user', content: text }]);
  setBusy(true);

  // Wrap the user message so the model always returns plain text
  const wrapped =
    `Instruction: Respond in plain text, 1–2 sentences. Do not call tools. ` +
    `This is routine intake (not a crisis). ` +
    `User: ${text}`;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: wrapped })
    });

    const data = await res.json().catch(() => ({} as any));

    const raw = typeof data?.reply === 'string' ? data.reply.trim() : '';
    const err = typeof data?.error === 'string' ? data.error.trim() : '';

    if (!raw && !err) {
      console.debug('Empty AOAI content. Payload:', data);
    }

    const reply =
      raw ||
      (err ? `Sorry — ${err}` :
        "Thanks for reaching out — I can help you decide between therapy, psychiatry, or both. Could you share a bit about what you’re looking for? (If you are in immediate danger, please call 988.)");

    setMessages(m => [...m, { role: 'assistant', content: reply }]);
  } catch {
    setMessages(m => [...m, { role: 'assistant', content: 'Sorry, something went wrong.' }]);
  } finally {
    setBusy(false);
  }
}

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '0 auto', padding: 16 }}>
      <h3>Beep Beep Boop</h3>
      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, height: 360, overflowY: 'auto', background: '#fff' }}>
        {messages.length === 0 ? (
          <div style={{ color: '#666' }}>
            Welcome! Start typing and let me help connect you to a provider.
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} style={{ margin: '8px 0' }}>
              <strong>{m.role === 'user' ? 'You' : 'Bucket O Bolts'}:</strong> {m.content}
            </div>
          ))
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
          placeholder={busy ? 'Working…' : 'Type a message'}
          disabled={busy}
          style={{ flex: 1, padding: 10, borderRadius: 6, border: '1px solid #ccc' }}
        />
        <button
          onClick={send}
          disabled={busy}
          style={{ padding: '10px 16px', borderRadius: 6, border: '1px solid #333', background: '#111', color: '#fff' }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
