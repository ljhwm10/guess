import { useEffect, useRef, useState } from 'react';
import { CHAT_MAX_LEN } from '@draw-guess/shared';
import { useStore } from '../store';
import { sendChat } from '../socket';

export function ChatPanel({ placeholder }: { placeholder?: string }): JSX.Element {
  const chats = useStore((s) => s.chats);
  const playerId = useStore((s) => s.playerId);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chats]);

  const submit = (): void => {
    const t = text.trim();
    if (!t) return;
    sendChat(t, () => setText(''));
  };

  return (
    <div className="chat-panel">
      <div className="chat-list" ref={listRef}>
        {chats.map((m) => {
          if (m.kind === 'system') {
            return (
              <div key={m.id} className="chat-msg chat-system">
                {m.text}
              </div>
            );
          }
          if (m.kind === 'correct') {
            return (
              <div key={m.id} className="chat-msg chat-correct">
                🎉 {m.text}
              </div>
            );
          }
          if (m.kind === 'close') {
            return (
              <div key={m.id} className="chat-msg chat-close">
                💡 {m.text}
              </div>
            );
          }
          return (
            <div key={m.id} className={`chat-msg ${m.playerId === playerId ? 'chat-mine' : ''}`}>
              <span className="chat-name">{m.name}:</span>
              <span>{m.text}</span>
            </div>
          );
        })}
      </div>
      <div className="chat-input-row">
        <input
          className="input chat-input"
          value={text}
          maxLength={CHAT_MAX_LEN}
          placeholder={placeholder ?? '输入猜测或聊天…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          }}
        />
        <button className="btn btn-primary" onClick={submit}>
          发送
        </button>
      </div>
    </div>
  );
}
