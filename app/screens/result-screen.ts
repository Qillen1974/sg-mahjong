import type { ScreenContext } from '../main';
import type { RoundRecord, SessionState } from '@lib/game-types';
import type { GameBridge } from '../state/game-bridge';
import { taiToAmount } from '@lib/payments';

interface ResultScreenData {
  sessionConfig: any;
  record: RoundRecord;
  session: SessionState;
  bridge: GameBridge;
}

const SEAT_NAMES = ['You', 'Right (AI)', 'Across (AI)', 'Left (AI)'];

export function renderResultScreen(ctx: ScreenContext): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'screen result-screen';
  const data = ctx.screenData as ResultScreenData;
  const { record, session, bridge } = data;
  const result = record.result;

  let heading = '';
  let details = '';

  if (result.type === 'draw') {
    heading = 'Draw Game';
    details = 'The wall was exhausted with no winner.';
  } else if (result.winnerIndex !== undefined) {
    const winnerName = SEAT_NAMES[result.winnerIndex];
    heading = result.winnerIndex === 0 ? 'You Win!' : `${winnerName} Wins`;

    if (result.scoring) {
      const scoringLines = result.scoring.details
        .map(d => `<li>${d.name}: ${d.tai} tai</li>`)
        .join('');
      details = `
        <div class="scoring-breakdown">
          <p class="total-tai">${result.scoring.tai} Tai Total</p>
          <ul class="scoring-list">${scoringLines}</ul>
        </div>
      `;
    }
  }

  // Payment deltas
  const paymentRows = record.payments.deltas
    .map((d, i) => {
      const sign = d > 0 ? '+' : '';
      const cls = d > 0 ? 'positive' : d < 0 ? 'negative' : '';
      return `<tr class="${cls}"><td>${SEAT_NAMES[i]}</td><td>${sign}$${d.toFixed(2)}</td></tr>`;
    })
    .join('');

  // Cumulative scores
  const scoreRows = session.scores
    .map((s, i) => {
      const sign = s > 0 ? '+' : '';
      return `<tr><td>${SEAT_NAMES[i]}</td><td>${sign}$${s.toFixed(2)}</td></tr>`;
    })
    .join('');

  screen.innerHTML = `
    <div class="result-content">
      <h2>${heading}</h2>
      ${details}

      <div class="result-tables">
        <div class="result-table">
          <h3>This Round</h3>
          <table>${paymentRows}</table>
        </div>
        <div class="result-table">
          <h3>Session Total</h3>
          <table>${scoreRows}</table>
        </div>
      </div>

      <div class="result-actions">
        ${session.finished
          ? '<button class="btn btn-accent btn-large" id="btn-finish">Finish</button>'
          : '<button class="btn btn-primary btn-large" id="btn-next">Next Round</button>'
        }
      </div>
    </div>
  `;

  if (session.finished) {
    screen.querySelector('#btn-finish')!.addEventListener('click', () => {
      ctx.navigate('title');
    });
  } else {
    screen.querySelector('#btn-next')!.addEventListener('click', () => {
      ctx.navigate('game', { sessionConfig: data.sessionConfig, resumeBridge: bridge });
    });
  }

  return screen;
}
