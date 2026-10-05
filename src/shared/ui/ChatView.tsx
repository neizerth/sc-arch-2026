import { useState } from 'react';
import type { ChatModel } from '../contract';

const styles = {
  container: { display: 'flex', flexDirection: 'column' as const, height: '100vh', fontFamily: 'sans-serif' },
  banner: { background: '#ffcc00', padding: '12px', textAlign: 'center' as const, fontSize: '14px' },
  connectionStatus: { background: '#f0f0f0', padding: '8px 12px', fontSize: '12px', color: '#666' },
  loadButton: { padding: '8px 12px', margin: '12px', background: '#007bff', color: '#fff', border: 'none', cursor: 'pointer' },
  messageList: { flex: 1, overflow: 'auto', padding: '12px', borderBottom: '1px solid #ddd' },
  message: { marginBottom: '8px', padding: '8px', borderRadius: '4px', background: '#f9f9f9' },
  ownMessage: { background: '#e3f2fd' },
  statusText: { fontSize: '12px', color: '#666', marginTop: '4px' },
  failedMessage: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  retryButton: { marginLeft: '8px', padding: '4px 8px', background: '#dc3545', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '12px' },
  inputForm: { display: 'flex', padding: '12px', gap: '8px', borderTop: '1px solid #ddd' },
  inputField: { flex: 1, padding: '8px', border: '1px solid #ddd', borderRadius: '4px' },
  sendButton: { padding: '8px 16px', background: '#28a745', color: '#fff', border: 'none', cursor: 'pointer' },
};

export function ChatView({ model }: { model: ChatModel }) {
  const [text, setText] = useState('');

  return (
    <div style={styles.container}>
      {model.showConnectionBanner && <div style={styles.banner}>Нет соединения</div>}
      <div style={styles.connectionStatus}>Соединение: {model.connection}</div>

      <button
        style={styles.loadButton}
        disabled={!model.hasOlder || model.loadingOlder}
        onClick={() => model.loadOlder()}
      >
        Загрузить ещё
      </button>

      <div style={styles.messageList}>
        {model.messages.map((msg) => (
          <div key={msg.id || msg.clientId} style={{ ...styles.message, ...(msg.author === 'me' ? styles.ownMessage : {}) }}>
            <div>{msg.author === 'me' ? 'Я' : 'Other'}: {msg.text}</div>
            {msg.status === 'pending' && <div style={styles.statusText}>отправляется…</div>}
            {msg.status === 'failed' && (
              <div style={{ ...styles.statusText, ...styles.failedMessage }}>
                <span>не доставлено</span>
                <button style={styles.retryButton} onClick={() => model.retry(msg.clientId!)}>
                  Повторить
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <form
        style={styles.inputForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) {
            model.send(text);
            setText('');
          }
        }}
      >
        <input
          style={styles.inputField}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Введите сообщение..."
        />
        <button style={styles.sendButton} type="submit">
          Отправить
        </button>
      </form>
    </div>
  );
}
