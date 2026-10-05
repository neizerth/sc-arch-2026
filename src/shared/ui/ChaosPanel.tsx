import type { Backend } from '../contract';

const styles = {
  container: { display: 'flex', gap: '8px', padding: '12px', background: '#f5f5f5', borderTop: '1px solid #ddd' },
  button: { padding: '8px 16px', background: '#6c757d', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: '4px' },
};

export function ChaosPanel({ backend }: { backend: Backend }) {
  return (
    <div style={styles.container}>
      <button style={styles.button} onClick={() => backend.chaos.dropConnection(5000)}>
        Обрыв 5 с
      </button>
      <button style={styles.button} onClick={() => backend.chaos.burst(20)}>
        Burst 20
      </button>
      <button style={styles.button} onClick={() => backend.chaos.setLatency(1500)}>
        Latency 1500
      </button>
    </div>
  );
}
