import { useEffect, useState } from 'react';
import { adminApi, auth } from '../api.js';

const Status = ({ ok, children }) => <span className={`pill ${ok ? 'paid' : 'pending'}`}>{children}</span>;

export default function AdminNotifications() {
  const isOwner = auth.current()?.role === 'owner';
  const [status, setStatus] = useState(null);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!isOwner) return;
    Promise.all([adminApi.notificationStatus(), adminApi.notificationPreview()])
      .then(([s, p]) => {
        setStatus(s);
        setPreview(p);
      })
      .catch((e) => setErr(e.message));
  }, [isOwner]);

  if (!isOwner) {
    return (
      <div>
        <h1>Notifications</h1>
        <div className="card"><p style={{ margin: 0 }}>Only the owner can set up notifications.</p></div>
      </div>
    );
  }

  const test = async (to, label) => {
    setErr('');
    setMsg('');
    try {
      await adminApi.notificationTest(to);
      setMsg(`Test message sent to ${label}.`);
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div>
      <h1>Notifications</h1>
      <p style={{ color: 'var(--muted)' }}>
        Telegram messages: an evening reminder to each property’s manager when expenses or the stock count haven’t been logged,
        and a nightly summary of both properties to you.
      </p>
      {err && <p style={{ color: '#c92a2a' }}>{err}</p>}
      {msg && <p className="notice ok">{msg}</p>}

      {status && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Setup</h3>
          <table className="table">
            <tbody>
              <tr>
                <td>Telegram bot</td>
                <td><Status ok={status.bot_configured}>{status.bot_configured ? 'Connected' : 'Not set up'}</Status></td>
                <td><code>TELEGRAM_BOT_TOKEN</code></td>
                <td />
              </tr>
              <tr>
                <td>Your nightly summary at {status.summary_at}</td>
                <td><Status ok={status.owner_chat_configured}>{status.owner_chat_configured ? 'On' : 'No chat id'}</Status></td>
                <td><code>TELEGRAM_OWNER_CHAT_ID</code></td>
                <td>
                  {status.bot_configured && status.owner_chat_configured && (
                    <button type="button" className="link-btn" onClick={() => test('owner', 'you')}>Send test</button>
                  )}
                </td>
              </tr>
              {status.properties.map((p) => (
                <tr key={p.id}>
                  <td>{p.name} manager’s reminder at {status.reminder_at}</td>
                  <td><Status ok={p.chat_configured}>{p.chat_configured ? 'On' : 'No chat id'}</Status></td>
                  <td><code>{p.env}</code></td>
                  <td>
                    {status.bot_configured && p.chat_configured && (
                      <button type="button" className="link-btn" onClick={() => test(p.id, `${p.name}'s manager`)}>Send test</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!status.bot_configured && (
            <ol className="setup-steps">
              <li>In Telegram, message <strong>@BotFather</strong>, send <code>/newbot</code>, and copy the token it gives you.</li>
              <li>You and each manager open the new bot and send it any message.</li>
              <li>Open <code>https://api.telegram.org/bot&lt;token&gt;/getUpdates</code> and note each person’s <code>"chat":{'{'}"id": …{'}'}</code>.</li>
              <li>Put the token and chat ids in the server’s <code>.env</code> (see <code>.env.example</code>) and restart: <code>docker compose up -d</code>.</li>
            </ol>
          )}
          {status.sent_today.length > 0 && (
            <p style={{ color: 'var(--muted)' }}>
              Sent today: {status.sent_today.map((s) => `${s.kind} (${s.location_id})`).join(', ')}
            </p>
          )}
        </div>
      )}

      {preview && (
        <div className="analytics-grid">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Tonight’s summary would say</h3>
            <pre className="message-preview">{preview.summary}</pre>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Reminders</h3>
            {preview.reminders.map((r) => (
              <div key={r.location_id} style={{ marginBottom: '0.75rem' }}>
                <strong>{r.name}</strong>
                {r.text ? <pre className="message-preview">{r.text}</pre> : <p style={{ color: 'var(--muted)', margin: '0.25rem 0 0' }}>Everything logged; no reminder needed.</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
