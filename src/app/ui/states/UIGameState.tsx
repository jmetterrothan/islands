import React from 'react';

import Game from '@templates/Game/game';

import UIState from '@ui/UIState';
import UIManager from '@ui/UIManager';

class UIGameState extends UIState {

  init() {

  }

  process(uiManager: UIManager) {

  }

  render() {
    return Game;
  }

}

export default UIGameState;