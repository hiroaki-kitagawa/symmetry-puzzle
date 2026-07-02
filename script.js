(function () {
  'use strict';

  const GRID_SIZE = 7;
  const AXIS = Math.floor(GRID_SIZE / 2);
  const STORAGE_KEY = 'symmetry-puzzle-progress';

  const IMG = {
    title: 'img/symmetry-puzzle-title.png',
    background: 'img/symmetry-puzzle-background.png',
    end: 'img/symmetry-puzzle-end.png',
  };

  const SHAPE_COLORS = {
    red: '#FF8A8A',
    blue: '#8AC4FF',
    green: '#8ADFA0',
    yellow: '#FFE08A',
  };

  const TUTORIAL_MESSAGES = {
    1: '左の図形と同じものを右に置こう',
    2: '複数の図形を対称に並べよう',
    3: '色も形もそろえよう',
  };

  const STAGE_COUNT = 5;

  /** 難易度ごとのヒント側（左半分）に配置する図形数 */
  const SHAPE_COUNT_BY_DIFFICULTY = {
    1: 1,
    2: 2,
    3: 3,
    4: 5,
    5: 7,
  };

  const STAGES = [
    {
      id: 1,
      title: 'はじめの一歩',
      gridSize: 7,
      palette: ['circle-red'],
      difficulty: 1,
    },
    {
      id: 2,
      title: 'ふたつ並べよう',
      gridSize: 7,
      palette: ['circle-red', 'square-blue'],
      difficulty: 2,
    },
    {
      id: 3,
      title: '色をそろえよう',
      gridSize: 7,
      palette: ['circle-red', 'circle-blue', 'triangle-green'],
      difficulty: 3,
    },
    {
      id: 4,
      title: '対称の花',
      gridSize: 7,
      palette: ['circle-red', 'square-blue', 'triangle-green', 'diamond-yellow'],
      difficulty: 4,
    },
    {
      id: 5,
      title: '究極の対称',
      gridSize: 7,
      palette: ['circle-red', 'square-blue', 'triangle-green', 'diamond-yellow', 'star-red'],
      difficulty: 5,
    },
  ];

  let audioContext = null;

  const state = {
    screen: 'title',
    progress: loadProgress(),
    activeStageId: 1,
    game: {
      selectedShape: null,
      playerCells: {},
      wrongCells: [],
      shaking: false,
      hints: [],
    },
  };

  function shapeKey(x, y) {
    return x + ',' + y;
  }

  function parseShapeId(id) {
    const parts = id.split('-');
    return { type: parts[0], color: parts[1] };
  }

  function isHintSide(x, gridSize) {
    gridSize = gridSize || GRID_SIZE;
    return x <= Math.floor(gridSize / 2);
  }

  function isPlaySide(x, gridSize) {
    gridSize = gridSize || GRID_SIZE;
    return x > Math.floor(gridSize / 2);
  }

  function hintsToMap(hints) {
    const map = {};
    hints.forEach(function (h) {
      map[shapeKey(h.x, h.y)] = h.shape;
    });
    return map;
  }

  function getMirrorX(x, gridSize) {
    gridSize = gridSize || GRID_SIZE;
    return gridSize - 1 - x;
  }

  function getExpectedShape(x, y, hints, gridSize) {
    gridSize = gridSize || GRID_SIZE;
    const mirrorX = getMirrorX(x, gridSize);
    const hint = hints.find(function (h) {
      return h.x === mirrorX && h.y === y;
    });
    return hint ? hint.shape : null;
  }

  function getWrongCells(hints, playerCells, gridSize) {
    gridSize = gridSize || GRID_SIZE;
    const wrong = [];
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        if (!isPlaySide(x, gridSize)) continue;
        const expected = getExpectedShape(x, y, hints, gridSize);
        const actual = playerCells[shapeKey(x, y)] || null;
        if (actual !== expected) wrong.push({ x: x, y: y });
      }
    }
    return wrong;
  }

  function checkSymmetry(hints, playerCells, gridSize) {
    return getWrongCells(hints, playerCells, gridSize).length === 0;
  }

  function normalizeProgress(parsed) {
    const cleared = (parsed.clearedStages || []).filter(function (id) {
      return id >= 1 && id <= STAGE_COUNT;
    });
    let current = parsed.currentStage || 1;
    if (current < 1) current = 1;
    if (current > STAGE_COUNT) current = STAGE_COUNT;
    return {
      clearedStages: cleared,
      currentStage: current,
      settings: Object.assign({ bgm: true, se: true }, parsed.settings || {}),
    };
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { clearedStages: [], currentStage: 1, settings: { bgm: true, se: true } };
      }
      return normalizeProgress(JSON.parse(raw));
    } catch (e) {
      return { clearedStages: [], currentStage: 1, settings: { bgm: true, se: true } };
    }
  }

  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
  }

  function hasProgress() {
    return state.progress.clearedStages.length > 0 || state.progress.currentStage > 1;
  }

  function isStageUnlocked(stageId) {
    if (stageId === 1) return true;
    return state.progress.clearedStages.indexOf(stageId - 1) !== -1;
  }

  function getStage(id) {
    return STAGES.find(function (s) { return s.id === id; }) || STAGES[0];
  }

  function getActiveHints() {
    return state.game.hints || [];
  }

  function shuffleArray(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function randomPick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function getHintSideCells(gridSize) {
    gridSize = gridSize || GRID_SIZE;
    const cells = [];
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x <= Math.floor(gridSize / 2); x++) {
        cells.push({ x: x, y: y });
      }
    }
    return cells;
  }

  function generateRandomHints(stage) {
    const gridSize = stage.gridSize || GRID_SIZE;
    const count = SHAPE_COUNT_BY_DIFFICULTY[stage.difficulty] || stage.difficulty;
    const positions = shuffleArray(getHintSideCells(gridSize)).slice(0, count);

    return positions.map(function (pos) {
      return {
        x: pos.x,
        y: pos.y,
        shape: randomPick(stage.palette),
      };
    });
  }

  function getAudioContext() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    return audioContext;
  }

  function playTone(frequency, duration, volume) {
    if (!state.progress.settings.se) return;
    try {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.value = volume || 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.stop(ctx.currentTime + duration);
    } catch (e) { /* ignore */ }
  }

  const sound = {
    place: function () { playTone(520, 0.08); },
    remove: function () { playTone(320, 0.06); },
    success: function () {
      playTone(523, 0.12);
      setTimeout(function () { playTone(659, 0.12); }, 100);
      setTimeout(function () { playTone(784, 0.2); }, 200);
    },
    fail: function () {
      playTone(200, 0.15);
      setTimeout(function () { playTone(160, 0.2); }, 120);
    },
  };

  function createShapeSvg(shapeId, size) {
    size = size || 28;
    const parsed = parseShapeId(shapeId);
    const fill = SHAPE_COLORS[parsed.color];
    const svgStart = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 32 32" aria-hidden="true">';
    const svgEnd = '</svg>';
    let inner = '';

    switch (parsed.type) {
      case 'circle':
        inner = '<circle cx="16" cy="16" r="12" fill="' + fill + '" stroke="none"/>';
        break;
      case 'square':
        inner = '<rect x="6" y="6" width="20" height="20" rx="2" fill="' + fill + '" stroke="none"/>';
        break;
      case 'triangle':
        inner = '<polygon points="16,5 28,27 4,27" fill="' + fill + '" stroke="none"/>';
        break;
      case 'diamond':
        inner = '<polygon points="16,4 28,16 16,28 4,16" fill="' + fill + '" stroke="none"/>';
        break;
      case 'star':
        inner = '<polygon points="16,3 20,12 30,12 22,19 25,29 16,23 7,29 10,19 2,12 12,12" fill="' + fill + '" stroke="none"/>';
        break;
    }
    return svgStart + inner + svgEnd;
  }

  function renderDifficultyStars(difficulty) {
    let html = '<span class="stars" aria-label="難易度 ' + difficulty + '">';
    for (let i = 0; i < 5; i++) {
      html += '<span class="' + (i < difficulty ? 'filled' : 'empty') + '">★</span>';
    }
    return html + '</span>';
  }

  function renderBoard(hints, playerCells, wrongCells, options) {
    options = options || {};
    const hintMap = hintsToMap(hints);
    const wrongSet = {};
    (wrongCells || []).forEach(function (c) {
      wrongSet[shapeKey(c.x, c.y)] = true;
    });

    let html = '<div class="board' + (options.mini ? ' mini' : '') + (options.shaking ? ' shake' : '') + '">';

    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const key = shapeKey(x, y);
        const onPlaySide = isPlaySide(x);
        const hintShape = hintMap[key] || null;
        const playerShape = playerCells[key] || null;
        const shape = onPlaySide ? playerShape : hintShape;
        const isAxis = x === AXIS;

        let classes = 'cell';
        if (!onPlaySide && hintShape) classes += ' hint';
        if (onPlaySide && options.onCellClick) classes += ' playable';
        if (isAxis) classes += ' axis';
        if (wrongSet[key]) classes += ' highlighted';

        html += '<button type="button" class="' + classes + '" data-x="' + x + '" data-y="' + y + '"';
        if (!onPlaySide || !options.onCellClick) html += ' disabled';
        html += '>';

        if (shape) {
          html += createShapeSvg(shape, options.mini ? 16 : 28);
        } else if (options.showPlaceholders && onPlaySide) {
          html += '<span class="placeholder">?</span>';
        }

        html += '</button>';
      }
    }

    return html + '</div>';
  }

  function renderTitleScreen() {
    let extra = '';
    if (hasProgress()) {
      extra = '<button type="button" class="btn-continue" data-action="continue">つづきから</button>';
    }

    return (
      '<div class="title-screen">' +
        '<img src="' + IMG.title + '" alt="シンメトリー図形パズル — 美しい対称性を創り出せ！" class="screen-image">' +
        '<div class="screen-actions title-actions">' +
          '<button type="button" class="btn-start" data-action="stageSelect">ゲームをスタート</button>' +
          extra +
        '</div>' +
      '</div>'
    );
  }

  function renderStageSelectScreen() {
    let grid = '';
    STAGES.forEach(function (stage) {
      const unlocked = isStageUnlocked(stage.id);
      const cleared = state.progress.clearedStages.indexOf(stage.id) !== -1;
      let cls = 'stage-btn';
      if (!unlocked) cls += ' locked';
      if (cleared) cls += ' cleared';

      grid +=
        '<button type="button" class="' + cls + '" data-stage="' + stage.id + '"' +
        (unlocked ? '' : ' disabled') + '>' +
        '<span class="number">' + stage.id + '</span>' +
        renderDifficultyStars(stage.difficulty) +
        (cleared ? '<span class="check">✓</span>' : '') +
        (!unlocked ? '<span class="lock">🔒</span>' : '') +
        '</button>';
    });

    return (
      '<div class="stage-select-screen">' +
        '<div class="stage-select-panel">' +
          '<header class="stage-select-header">' +
            '<button type="button" class="btn-back" data-action="title">← 戻る</button>' +
            '<h1>ステージ選択</h1>' +
          '</header>' +
          '<div class="stage-grid">' + grid + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderGameScreen() {
    const stage = getStage(state.activeStageId);
    const tutorial = TUTORIAL_MESSAGES[stage.id];
    let palette = '';

    stage.palette.forEach(function (shapeId) {
      const selected = state.game.selectedShape === shapeId ? ' selected' : '';
      palette +=
        '<button type="button" class="palette-item' + selected + '" data-shape="' + shapeId + '">' +
        createShapeSvg(shapeId, 36) +
        '</button>';
    });

    return (
      '<div class="game-screen">' +
        '<div class="game-panel">' +
          '<header class="game-header">' +
            '<button type="button" class="btn-back" data-action="stageSelect">← 戻る</button>' +
            '<div class="stage-info">' +
              '<span class="stage-number">ステージ ' + stage.id + '</span>' +
              '<span class="stage-title">' + stage.title + '</span>' +
            '</div>' +
            renderDifficultyStars(stage.difficulty) +
          '</header>' +
          (tutorial ? '<p class="tutorial">' + tutorial + '</p>' : '') +
          renderBoard(getActiveHints(), state.game.playerCells, state.game.wrongCells, {
            shaking: state.game.shaking,
            onCellClick: true,
          }) +
          '<div class="palette">' + palette + '</div>' +
          '<div class="game-actions">' +
            '<button type="button" class="btn-reset" data-action="reset">リセット</button>' +
            '<button type="button" class="btn-submit" data-action="submit">完成！</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderEndScreen() {
    return (
      '<div class="end-screen">' +
        '<img src="' + IMG.end + '" alt="お疲れさまでした！ゲームを完了しました！" class="screen-image">' +
        '<div class="screen-actions end-actions">' +
          '<button type="button" class="btn-end" data-action="title">タイトルに戻る</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderClearScreen() {
    const stage = getStage(state.activeStageId);
    const hasNext = state.activeStageId < STAGES.length;
    let particles = '';
    for (let i = 0; i < 20; i++) {
      particles += '<span class="particle" style="--i:' + i + ';left:calc(' + (i * 5 + 2) + '%)"></span>';
    }

    let buttons = '';
    if (hasNext) {
      buttons += '<button type="button" class="btn-primary" data-action="next">次のステージへ</button>';
    }
    buttons +=
      '<button type="button" class="btn-secondary" data-action="stageSelect">ステージ選択</button>' +
      '<button type="button" class="btn-ghost" data-action="title">タイトルへ</button>';

    return (
      '<div class="clear-screen">' +
        '<div class="confetti" aria-hidden="true">' + particles + '</div>' +
        '<div class="clear-panel">' +
          '<h1>クリア！</h1>' +
          '<p class="subtitle">ステージ ' + stage.id + '「' + stage.title + '」</p>' +
          '<p class="message">左右対称、ばっちりです！</p>' +
          '<div class="button-group">' + buttons + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function resetGameState(stage, hints) {
    state.game = {
      selectedShape: stage.palette[0] || null,
      playerCells: {},
      wrongCells: [],
      shaking: false,
      hints: hints || state.game.hints || [],
    };
  }

  function startStage(stageId) {
    state.activeStageId = stageId;
    const stage = getStage(stageId);
    resetGameState(stage, generateRandomHints(stage));
    state.screen = 'game';
    render();
  }

  function handleClear() {
    const id = state.activeStageId;
    if (state.progress.clearedStages.indexOf(id) === -1) {
      state.progress.clearedStages.push(id);
      state.progress.clearedStages.sort(function (a, b) { return a - b; });
    }
    const nextStageId = Math.min(id + 1, STAGES.length);
    state.progress.currentStage = Math.max(state.progress.currentStage, nextStageId);
    saveProgress();
    if (id === STAGE_COUNT) {
      state.screen = 'end';
    } else {
      state.screen = 'clear';
    }
    render();
  }

  function bindEvents() {
    const app = document.getElementById('app');
    if (!app) return;

    app.addEventListener('click', function (e) {
      const target = e.target.closest('[data-action]');
      if (target) {
        const action = target.getAttribute('data-action');
        switch (action) {
          case 'start':
            startStage(1);
            break;
          case 'continue':
            startStage(state.progress.currentStage);
            break;
          case 'stageSelect':
            state.screen = 'stageSelect';
            render();
            break;
          case 'title':
            state.screen = 'title';
            render();
            break;
          case 'next':
            startStage(state.activeStageId + 1);
            break;
          case 'reset':
            resetGameState(getStage(state.activeStageId));
            render();
            break;
          case 'submit':
            handleSubmit();
            break;
        }
        return;
      }

      const stageBtn = e.target.closest('[data-stage]');
      if (stageBtn && !stageBtn.disabled) {
        startStage(parseInt(stageBtn.getAttribute('data-stage'), 10));
        return;
      }

      const paletteBtn = e.target.closest('[data-shape]');
      if (paletteBtn) {
        state.game.selectedShape = paletteBtn.getAttribute('data-shape');
        render();
        return;
      }

      const cellBtn = e.target.closest('.cell.playable');
      if (cellBtn && !cellBtn.disabled) {
        handleCellClick(
          parseInt(cellBtn.getAttribute('data-x'), 10),
          parseInt(cellBtn.getAttribute('data-y'), 10)
        );
      }
    });
  }

  function handleCellClick(x, y) {
    const stage = getStage(state.activeStageId);
    if (!isPlaySide(x, stage.gridSize)) return;

    const key = shapeKey(x, y);
    state.game.wrongCells = [];

    if (state.game.playerCells[key]) {
      delete state.game.playerCells[key];
      sound.remove();
    } else if (state.game.selectedShape) {
      state.game.playerCells[key] = state.game.selectedShape;
      sound.place();
    }

    render();
  }

  function handleSubmit() {
    const stage = getStage(state.activeStageId);
    const hints = getActiveHints();
    const wrong = getWrongCells(hints, state.game.playerCells, stage.gridSize);

    if (checkSymmetry(hints, state.game.playerCells, stage.gridSize)) {
      sound.success();
      handleClear();
    } else {
      sound.fail();
      state.game.wrongCells = wrong;
      state.game.shaking = true;
      render();
      setTimeout(function () {
        state.game.shaking = false;
        render();
      }, 400);
    }
  }

  function updateBodyClass() {
    document.body.className = '';
    if (
      state.screen === 'stageSelect' ||
      state.screen === 'game' ||
      state.screen === 'clear'
    ) {
      document.body.classList.add('game-bg');
    }
  }

  function render() {
    const app = document.getElementById('app');
    if (!app) return;

    switch (state.screen) {
      case 'title':
        app.innerHTML = renderTitleScreen();
        break;
      case 'stageSelect':
        app.innerHTML = renderStageSelectScreen();
        break;
      case 'game':
        app.innerHTML = renderGameScreen();
        break;
      case 'clear':
        app.innerHTML = renderClearScreen();
        break;
      case 'end':
        app.innerHTML = renderEndScreen();
        break;
    }

    updateBodyClass();
  }

  bindEvents();
  render();
})();
