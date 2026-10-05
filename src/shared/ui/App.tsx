import type { Backend, Chat } from '../contract';
import { ChatView } from './ChatView';
import { ChaosPanel } from './ChaosPanel';

export function App({ chat, backend }: { chat: Chat; backend: Backend }) {
  const model = chat.useChat();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <ChatView model={model} />
      <ChaosPanel backend={backend} />
    </div>
  );
}
