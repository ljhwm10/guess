/** 画板逻辑坐标系(所有设备一致,4:3),笔画坐标按 0..1 归一化传输 */
export const CANVAS_W = 800;
export const CANVAS_H = 600;

export const CHOOSE_SECONDS = 15;
export const TURN_END_SECONDS = 5;
/** 断线保留时长,期间同一 playerId 重连可恢复 */
export const RECONNECT_GRACE_MS = 60_000;
export const MIN_PLAYERS = 2;
/** 剩余时间占比低于该值时,揭示词中的一个字 */
export const REVEAL_CHAR_RATIO = 0.4;
/** 每回合画者可刷新候选词列表的次数 */
export const WORD_REFRESH_PER_TURN = 1;

export const FIRST_GUESS_BONUS = 20;
export const DRAWER_POINT_PER_GUESS = 25;

export const PEN_COLORS = [
  '#1e1e1e', // 黑
  '#e5484d', // 红
  '#f76b15', // 橙
  '#ffc53d', // 黄
  '#46a758', // 绿
  '#0090ff', // 蓝
  '#8e4ec6', // 紫
  '#a18072', // 棕
];
export const PEN_WIDTHS = [4, 8, 14];
export const ERASER_WIDTHS = [16, 28, 44];
/** 画板底色,橡皮擦即以该颜色作画 */
export const CANVAS_BG = '#ffffff';

export const MAX_PLAYERS_CHOICES = [2, 3, 4, 5, 6, 7, 8];
/** 接龙模式人数上限选项(单链依次:画→画→…→最后一人猜) */
export const RELAY_MAX_PLAYERS_CHOICES = [2, 4, 6, 8, 12, 16];
export const GAME_MODES = ['classic', 'relay'] as const;
/** 接龙模式开局最少人数(1 人画、1 人猜即可) */
export const RELAY_MIN_PLAYERS = 2;
/** 接龙"猜词"环节时长(秒);"作画"环节沿用 config.drawSeconds */
export const RELAY_GUESS_SECONDS = 45;
export const ROUNDS_CHOICES = [1, 2, 3];
/** 作画/猜词时长按秒设置的范围与步长 */
export const DRAW_SECONDS_MIN = 30;
export const DRAW_SECONDS_MAX = 180;
export const DRAW_SECONDS_STEP = 10;
/** 类型提示延迟秒数的范围与步长(0 = 开局即显示) */
export const CATEGORY_HINT_SECONDS_MIN = 0;
export const CATEGORY_HINT_SECONDS_MAX = 60;
export const CATEGORY_HINT_SECONDS_STEP = 5;
export const WORD_OPTION_COUNT_CHOICES = [3, 4, 5];

export const DEFAULT_CONFIG = {
  mode: 'classic' as 'classic' | 'relay',
  maxPlayers: 8,
  rounds: 2,
  drawSeconds: 90,
  categoryHintSeconds: 20,
  wordOptionCount: 3,
};

export const NAME_MAX_LEN = 12;
export const CHAT_MAX_LEN = 60;
