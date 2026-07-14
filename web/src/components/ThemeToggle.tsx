import { useStore } from '../store';

/** 日间/夜间主题切换按钮(可在任意视图头部复用) */
export function ThemeToggle(): JSX.Element {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const isDark = theme === 'dark';
  const label = isDark ? '切换到日间模式' : '切换到夜间模式';
  return (
    <button className="theme-toggle" onClick={toggleTheme} title={label} aria-label={label}>
      {isDark ? '☀️' : '🌙'}
    </button>
  );
}
