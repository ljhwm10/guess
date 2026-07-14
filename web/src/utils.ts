const AVATARS = ['🦊', '🐼', '🐸', '🐯', '🐰', '🐨', '🦁', '🐙', '🐧', '🦄', '🐳', '🦉', '🐹', '🐢', '🦖', '🐝'];

export function avatarFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATARS[h % AVATARS.length];
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function formatSeconds(ms: number): string {
  return String(Math.max(0, Math.ceil(ms / 1000)));
}

/** 生成携带房间号的分享链接;私密房间可附带密码(pw)以便直达 */
export function buildRoomShareUrl(roomId: string, password?: string | null): string {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  if (password) url.searchParams.set('pw', password);
  else url.searchParams.delete('pw');
  url.hash = '';
  return url.toString();
}

/** 复制文本到剪贴板;安全上下文用 Clipboard API,否则回退 execCommand(兼容局域网 http) */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 回退到下方兜底方案 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
