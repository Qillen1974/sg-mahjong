import type { ScreenContext } from '../main';
import type { PaymentConfig, SessionConfig } from '@lib/game-types';
import { DEFAULT_PAYMENT_CONFIG } from '@lib/payments';

export function renderSetupScreen(ctx: ScreenContext): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'screen setup-screen';

  const config: PaymentConfig = { ...DEFAULT_PAYMENT_CONFIG };
  let windRounds = 1;

  screen.innerHTML = `
    <div class="setup-content">
      <h2>Game Setup</h2>
      <div class="setup-form">
        <label class="setup-field">
          <span>Base amount ($)</span>
          <input type="number" id="base-amount" value="${config.base}" min="0.10" max="5.00" step="0.10">
        </label>
        <label class="setup-field">
          <span>Tai cap</span>
          <input type="number" id="tai-cap" value="${config.taiCap}" min="3" max="10" step="1">
        </label>
        <label class="setup-field">
          <span>Shooter pays</span>
          <input type="checkbox" id="shooter-pays" ${config.shooterPays ? 'checked' : ''}>
        </label>
        <label class="setup-field">
          <span>Wind rounds</span>
          <select id="wind-rounds">
            <option value="1" selected>East only (short)</option>
            <option value="2">East + South</option>
            <option value="4">Full game (4 winds)</option>
          </select>
        </label>
      </div>
      <div class="setup-actions">
        <button class="btn btn-secondary" id="btn-back">Back</button>
        <button class="btn btn-primary btn-large" id="btn-start">Start Game</button>
      </div>
    </div>
  `;

  screen.querySelector('#btn-back')!.addEventListener('click', () => {
    ctx.navigate('title');
  });

  screen.querySelector('#btn-start')!.addEventListener('click', () => {
    const base = parseFloat((screen.querySelector('#base-amount') as HTMLInputElement).value) || 0.20;
    const taiCap = parseInt((screen.querySelector('#tai-cap') as HTMLInputElement).value) || 5;
    const shooterPays = (screen.querySelector('#shooter-pays') as HTMLInputElement).checked;
    const windRounds = parseInt((screen.querySelector('#wind-rounds') as HTMLSelectElement).value) || 1;

    const sessionConfig: Partial<SessionConfig> = {
      playerTypes: ['human', 'ai', 'ai', 'ai'],
      payment: { base, taiCap, shooterPays },
      windRounds,
    };

    ctx.navigate('game', { sessionConfig });
  });

  return screen;
}
