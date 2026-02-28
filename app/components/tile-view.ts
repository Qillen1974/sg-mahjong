import type { Tile } from '@lib/tiles';

// ── Chinese characters for tile faces ──────────────────────────────────
const CHAR_NUMBERS: Record<number, string> = {
  1: '一', 2: '二', 3: '三', 4: '四', 5: '五',
  6: '六', 7: '七', 8: '八', 9: '九',
};

const WIND_CHARS: Record<string, string> = {
  east: '東', south: '南', west: '西', north: '北',
};

const DRAGON_CHARS: Record<string, string> = {
  red: '中', green: '發', white: '',
};

const FLOWER_CHARS: Record<string, string> = {
  plum: '梅', orchid: '蘭', bamboo: '竹', chrysanthemum: '菊',
};

const SEASON_CHARS: Record<string, string> = {
  spring: '春', summer: '夏', autumn: '秋', winter: '冬',
};

const ANIMAL_CHARS: Record<string, string> = {
  cat: '貓', mouse: '鼠', rooster: '雞', centipede: '蜈',
};

// ── SVG renderers ──────────────────────────────────────────────────────

/** Dots (筒子): Red circles arranged in standard patterns */
function renderDotsSVG(n: number): string {
  // Circle positions for each number (in a 3×3 grid, coords 0-100)
  const layouts: Record<number, [number, number][]> = {
    1: [[50, 50]],
    2: [[50, 28], [50, 72]],
    3: [[50, 22], [50, 50], [50, 78]],
    4: [[32, 32], [68, 32], [32, 68], [68, 68]],
    5: [[32, 28], [68, 28], [50, 50], [32, 72], [68, 72]],
    6: [[32, 24], [68, 24], [32, 50], [68, 50], [32, 76], [68, 76]],
    7: [[32, 20], [68, 20], [32, 44], [68, 44], [32, 68], [68, 68], [50, 86]],
    8: [[30, 20], [50, 20], [70, 20], [30, 44], [70, 44], [30, 68], [50, 68], [70, 68]],
    9: [[28, 22], [50, 22], [72, 22], [28, 50], [50, 50], [72, 50], [28, 78], [50, 78], [72, 78]],
  };
  const r = n <= 3 ? 13 : n <= 6 ? 11 : 9;
  const circles = layouts[n]
    .map(([cx, cy]) =>
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#c0392b" stroke="#922b21" stroke-width="1.5"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r * 0.45}" fill="none" stroke="#e8d5b5" stroke-width="1.5"/>`
    )
    .join('');
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${circles}</svg>`;
}

/** Bamboo (索子): Green sticks */
function renderBambooSVG(n: number): string {
  if (n === 1) {
    // Bamboo 1 is traditionally a bird/peacock — draw a stylised bamboo knot
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="50" rx="18" ry="36" fill="#27ae60" stroke="#1a7a42" stroke-width="2"/>
      <line x1="50" y1="14" x2="50" y2="86" stroke="#1a7a42" stroke-width="2"/>
      <line x1="36" y1="38" x2="64" y2="38" stroke="#1a7a42" stroke-width="1.5"/>
      <line x1="36" y1="50" x2="64" y2="50" stroke="#1a7a42" stroke-width="1.5"/>
      <line x1="36" y1="62" x2="64" y2="62" stroke="#1a7a42" stroke-width="1.5"/>
      <circle cx="50" cy="24" r="5" fill="#c0392b"/>
    </svg>`;
  }

  // Sticks arranged in columns
  const stickW = 8;
  const stickH = 28;
  const layouts: Record<number, [number, number, string][]> = {
    2: [[38, 36, '#27ae60'], [62, 36, '#27ae60']],
    3: [[28, 36, '#27ae60'], [50, 36, '#27ae60'], [72, 36, '#27ae60']],
    4: [[32, 20, '#27ae60'], [62, 20, '#27ae60'], [32, 56, '#2980b9'], [62, 56, '#2980b9']],
    5: [[24, 20, '#27ae60'], [50, 20, '#27ae60'], [76, 20, '#27ae60'], [37, 56, '#2980b9'], [63, 56, '#2980b9']],
    6: [[28, 20, '#27ae60'], [50, 20, '#27ae60'], [72, 20, '#27ae60'], [28, 56, '#2980b9'], [50, 56, '#2980b9'], [72, 56, '#2980b9']],
    7: [[24, 16, '#27ae60'], [44, 16, '#27ae60'], [64, 16, '#27ae60'], [84, 16, '#27ae60'], [30, 56, '#2980b9'], [50, 56, '#2980b9'], [70, 56, '#2980b9']],
    8: [[24, 16, '#27ae60'], [44, 16, '#27ae60'], [64, 16, '#27ae60'], [84, 16, '#27ae60'], [24, 56, '#2980b9'], [44, 56, '#2980b9'], [64, 56, '#2980b9'], [84, 56, '#2980b9']],
    9: [[20, 8, '#27ae60'], [40, 8, '#27ae60'], [60, 8, '#27ae60'], [20, 40, '#2980b9'], [40, 40, '#2980b9'], [60, 40, '#2980b9'], [20, 72, '#c0392b'], [40, 72, '#c0392b'], [60, 72, '#c0392b']],
  };
  const sticks = (layouts[n] || [])
    .map(([x, y, color]) => {
      const dark = color === '#27ae60' ? '#1a7a42' : color === '#2980b9' ? '#1c5d8a' : '#922b21';
      return `<rect x="${x - stickW / 2}" y="${y}" width="${stickW}" height="${stickH}" rx="3" fill="${color}" stroke="${dark}" stroke-width="1"/>` +
        `<line x1="${x}" y1="${y + 8}" x2="${x}" y2="${y + stickH - 8}" stroke="${dark}" stroke-width="0.8" opacity="0.4"/>` +
        `<line x1="${x - stickW / 2 + 1}" y1="${y + stickH / 2}" x2="${x + stickW / 2 - 1}" y2="${y + stickH / 2}" stroke="${dark}" stroke-width="1"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${sticks}</svg>`;
}

/** Characters (萬子): Chinese numeral + 萬 */
function renderCharactersSVG(n: number): string {
  const num = CHAR_NUMBERS[n];
  return `<svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg">
    <text x="50" y="40" text-anchor="middle" dominant-baseline="central"
          font-family="serif" font-size="42" font-weight="bold" fill="#1a1a1a">${num}</text>
    <text x="50" y="90" text-anchor="middle" dominant-baseline="central"
          font-family="serif" font-size="36" fill="#c0392b">萬</text>
  </svg>`;
}

/** Wind tiles */
function renderWindSVG(wind: string): string {
  const ch = WIND_CHARS[wind] || '?';
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <text x="50" y="54" text-anchor="middle" dominant-baseline="central"
          font-family="serif" font-size="52" font-weight="bold" fill="#1a1a1a">${ch}</text>
  </svg>`;
}

/** Dragon tiles */
function renderDragonSVG(dragon: string): string {
  if (dragon === 'red') {
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <text x="50" y="54" text-anchor="middle" dominant-baseline="central"
            font-family="serif" font-size="58" font-weight="bold" fill="#c0392b"
            stroke="#922b21" stroke-width="1">中</text>
    </svg>`;
  }
  if (dragon === 'green') {
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <text x="50" y="54" text-anchor="middle" dominant-baseline="central"
            font-family="serif" font-size="52" font-weight="bold" fill="#27ae60"
            stroke="#1a7a42" stroke-width="1">發</text>
    </svg>`;
  }
  // White dragon — empty bordered rectangle
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <rect x="18" y="14" width="64" height="72" rx="6" fill="none"
          stroke="#4a90d9" stroke-width="3"/>
    <rect x="28" y="24" width="44" height="52" rx="4" fill="none"
          stroke="#4a90d9" stroke-width="2" opacity="0.5"/>
  </svg>`;
}

/** Bonus tiles (flowers, seasons, animals) */
function renderBonusSVG(suit: string, value: string): string {
  let ch = '';
  let color = '#d97706';
  let numLabel = '';

  if (suit === 'flowers') {
    ch = FLOWER_CHARS[value] || '花';
    color = '#c0392b';
    numLabel = { plum: '①', orchid: '②', bamboo: '③', chrysanthemum: '④' }[value] || '';
  } else if (suit === 'seasons') {
    ch = SEASON_CHARS[value] || '季';
    color = '#2980b9';
    numLabel = { spring: '①', summer: '②', autumn: '③', winter: '④' }[value] || '';
  } else if (suit === 'animals') {
    ch = ANIMAL_CHARS[value] || '獸';
    color = '#27ae60';
    numLabel = { cat: '①', mouse: '②', rooster: '③', centipede: '④' }[value] || '';
  }

  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    ${numLabel ? `<text x="14" y="18" font-family="sans-serif" font-size="14" fill="${color}" opacity="0.6">${numLabel}</text>` : ''}
    <text x="50" y="56" text-anchor="middle" dominant-baseline="central"
          font-family="serif" font-size="48" font-weight="bold" fill="${color}">${ch}</text>
  </svg>`;
}

/** Get the inner SVG for a tile */
function tileSVG(tile: Tile): string {
  const v = tile.value;
  switch (tile.suit) {
    case 'dots': return renderDotsSVG(v as number);
    case 'bamboo': return renderBambooSVG(v as number);
    case 'characters': return renderCharactersSVG(v as number);
    case 'winds': return renderWindSVG(v as string);
    case 'dragons': return renderDragonSVG(v as string);
    case 'flowers':
    case 'seasons':
    case 'animals':
      return renderBonusSVG(tile.suit, v as string);
    default: return '';
  }
}

// ── Public API ─────────────────────────────────────────────────────────

export interface TileViewOptions {
  selectable?: boolean;
  selected?: boolean;
  faceDown?: boolean;
  onClick?: (tile: Tile) => void;
  small?: boolean;
}

export function createTileView(tile: Tile, opts: TileViewOptions = {}): HTMLElement {
  const el = document.createElement('div');

  if (opts.faceDown) {
    el.className = 'tile tile-back';
    if (opts.small) el.classList.add('tile-small');
    return el;
  }

  el.className = 'tile';
  if (opts.selectable) el.classList.add('selectable');
  if (opts.selected) el.classList.add('selected');
  if (opts.small) el.classList.add('tile-small');

  el.innerHTML = tileSVG(tile);
  el.title = tile.name;

  if (opts.onClick) {
    el.addEventListener('click', () => opts.onClick!(tile));
  }

  return el;
}

export function createTileBack(small = false): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tile tile-back';
  if (small) el.classList.add('tile-small');
  return el;
}
