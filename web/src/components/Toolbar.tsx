import { ERASER_WIDTHS, PEN_COLORS, PEN_WIDTHS, type Tool } from '@draw-guess/shared';
import { localClear } from '../socket';

interface Props {
  tool: Tool;
  color: string;
  penWidth: number;
  eraserWidth: number;
  onTool(t: Tool): void;
  onColor(c: string): void;
  onPenWidth(w: number): void;
  onEraserWidth(w: number): void;
}

/** 画者工具栏:颜色/粗细/橡皮/清空 */
export function Toolbar(p: Props): JSX.Element {
  const widths = p.tool === 'eraser' ? ERASER_WIDTHS : PEN_WIDTHS;
  const activeWidth = p.tool === 'eraser' ? p.eraserWidth : p.penWidth;

  return (
    <div className="toolbar">
      <div className="tool-colors">
        {PEN_COLORS.map((c) => (
          <button
            key={c}
            className={`swatch ${p.tool === 'pen' && p.color === c ? 'swatch-on' : ''}`}
            style={{ background: c }}
            onClick={() => {
              p.onTool('pen');
              p.onColor(c);
            }}
            aria-label={`颜色 ${c}`}
          />
        ))}
      </div>
      <div className="tool-actions">
        <div className="tool-widths">
          {widths.map((w) => (
            <button
              key={w}
              className={`width-btn ${activeWidth === w ? 'width-on' : ''}`}
              onClick={() => (p.tool === 'eraser' ? p.onEraserWidth(w) : p.onPenWidth(w))}
              aria-label={`粗细 ${w}`}
            >
              <span
                className="width-dot"
                style={{ width: Math.min(22, w * 1.2), height: Math.min(22, w * 1.2) }}
              />
            </button>
          ))}
        </div>
        <button
          className={`btn btn-sm ${p.tool === 'eraser' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => p.onTool(p.tool === 'eraser' ? 'pen' : 'eraser')}
        >
          🧽 橡皮
        </button>
        <button
          className="btn btn-sm btn-danger"
          onClick={() => {
            if (window.confirm('确定清空画板吗?')) localClear();
          }}
        >
          🗑️ 清空
        </button>
      </div>
    </div>
  );
}
