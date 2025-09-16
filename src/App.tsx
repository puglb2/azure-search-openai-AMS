import React, { useEffect, useRef, useState } from 'react'

type Role = 'user' | 'assistant'
type Msg = { role: Role; content: string }

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll to latest message
  useEffect(() => {
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  async function send() {
    const text = input.trim()
    if (!text || busy) return

    // Optimistically show the user message
    setInput('')
    setMessages(m => [...m, { role: 'user', content: text }])
    setBusy(true)

    try {
      // Include a short transcript so the API can keep context
      const history = messages
        .slice(-8)
        .map(m => ({ role: m.role, content: (m.content || '').toString().trim() }))
        .filter(m => m.content)

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,     // latest turn
          history            // recent context (optional; server will handle if empty)
        })
      })

      const data = await res.json().catch(() => ({} as any))
      const raw = typeof data?.reply === 'string' ? data.reply.trim() : ''
      const err = typeof data?.error === 'string' ? data.error.trim() : ''

      const reply =
        raw ||
        (err
          ? `Sorry — ${err}`
          : "I can help you decide between therapy, psychiatry, or both and match you with a provider. Could you share a bit about your goals, any symptoms, and your insurance? (If you’re in immediate danger, please call 988.)")

      setMessages(m => [...m, { role: 'assistant', content: reply }])
    } catch {
      setMessages(m => [
        ...m,
        { role: 'assistant', content: 'Sorry, something went wrong.' }
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <header style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>AMS Intake Assistant</h3>
        <p style={{ margin: '4px 0 0 0', fontSize: 14, color: '#555' }}>
          I can help you decide between psychiatry and therapy—and match you with an in-network provider.
        </p>
      </header>

      <div
        ref={scrollerRef}
        style={{
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: 12,
          height: 380,
          overflowY: 'auto',
          background: '#fff'
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: '#666' }}>
            Before we start: this assistant isn’t for emergencies. If you’re in immediate danger or considering self-harm, call <strong>988</strong> or your local emergency number.
            With your consent, I can ask a few questions and help match you to care.
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ margin: '10px 0', lineHeight: 1.35 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>
              {m.role === 'user' ? 'You' : 'Assistant'}
            </div>
            <div>{m.content}</div>
          </div>
        ))}

        {busy && (
          <div style={{ marginTop: 8, color: '#777', fontStyle: 'italic' }}>
            Assistant is typing…
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
          placeholder={busy ? 'Working…' : 'Type a message'}
          disabled={busy}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 6,
            border: '1px solid #ccc'
          }}
        />
        <button
          onClick={send}
          disabled={busy}
          style={{
            padding: '10px 16px',
            borderRadius: 6,
            border: '1px solid #333',
            background: busy ? '#555' : '#111',
            color: '#fff',
            cursor: busy ? 'not-allowed' : 'pointer'
          }}
        >
          Send
        </button>
      </div>

      <p style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
        By continuing, you consent to our privacy policy and terms. This chat may store your responses to improve your experience.
      </p>
    </div>
  )
}
