import { renderTitleScreen } from './screens/title-screen';

export type Screen = 'title' | 'setup' | 'game' | 'result';

export interface ScreenContext {
  navigate: (screen: Screen, data?: any) => void;
  screenData?: any;
}

const app = document.getElementById('app')!;

function navigate(screen: Screen, data?: any) {
  const ctx: ScreenContext = { navigate, screenData: data };
  app.innerHTML = '';

  switch (screen) {
    case 'title':
      app.appendChild(renderTitleScreen(ctx));
      break;
    case 'setup':
      import('./screens/setup-screen').then(m => {
        app.innerHTML = '';
        app.appendChild(m.renderSetupScreen(ctx));
      });
      break;
    case 'game':
      import('./screens/game-screen').then(m => {
        app.innerHTML = '';
        app.appendChild(m.renderGameScreen(ctx));
      });
      break;
    case 'result':
      import('./screens/result-screen').then(m => {
        app.innerHTML = '';
        app.appendChild(m.renderResultScreen(ctx));
      });
      break;
  }
}

// Initial render
navigate('title');
