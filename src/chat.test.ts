import { describeChat } from './shared/chat.contract';
import { createChat } from './create-chat';

describeChat(createChat);
