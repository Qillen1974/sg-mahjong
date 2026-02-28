import type { ScreenContext } from '../main';

export function renderTitleScreen(ctx: ScreenContext): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'screen title-screen';
  screen.innerHTML = `
    <div class="title-content">
      <h1 class="title-logo">SG Mahjong</h1>
      <p class="title-sub">Singapore-style Mahjong</p>
      <button class="btn btn-primary btn-large" id="btn-new-game">New Game</button>
    </div>
  `;

  screen.querySelector('#btn-new-game')!.addEventListener('click', () => {
    ctx.navigate('setup');
  });

  return screen;
}
