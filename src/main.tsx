import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './shared/ui/App';
import { createFakeBackend } from './shared/backend';
import { createChat } from './create-chat';

const backend = createFakeBackend();
const chat = createChat(backend);
chat.start();

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App chat={chat} backend={backend} /></StrictMode>);
