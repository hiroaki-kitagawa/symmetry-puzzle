/**
 * シンメトリー図形パズル — メインスクリプト
 *
 * 左半分のヒント図形をもとに、右半分に左右対称な図形を並べるパズルゲーム。
 * 画面遷移・ランダムヒント生成・正誤判定・進行保存をすべてこのファイルで管理する。
 */
(function () {
  'use strict';

  // ===== 定数 =====

  /** グリッドの一辺のセル数（7×7 固定） */
  const GRID_SIZE = 7;
  /** 対称軸の列番号（0始まり）。7×7 では中央列 x = 3 */
  const AXIS = Math.floor(GRID_SIZE / 2);
  /** localStorage に保存する進行データのキー名 */
  const STORAGE_KEY = 'symmetry-puzzle-progress';

  /** 各画面で使用する画像ファイルのパス */
  const IMG = {
    title: 'img/symmetry-puzzle-title.png',
    background: 'img/symmetry-puzzle-background.png',
    end: 'img/symmetry-puzzle-end.png',
  };

  /** 図形の色名と SVG 描画用カラーコードの対応表 */
  const SHAPE_COLORS = {
    red: '#FF8A8A',
    blue: '#8AC4FF',
    green: '#8ADFA0',
    yellow: '#FFE08A',
  };

  /** ステージ1〜3で表示するチュートリアルメッセージ */
  const TUTORIAL_MESSAGES = {
    1: '左の図形と同じものを右に置こう',
    2: '複数の図形を対称に並べよう',
    3: '色も形もそろえよう',
  };

  /** ゲーム内のステージ総数 */
  const STAGE_COUNT = 5;

  /** 難易度ごとのヒント側（左半分）に配置する図形数 */
  const SHAPE_COUNT_BY_DIFFICULTY = {
    1: 1,
    2: 2,
    3: 3,
    4: 5,
    5: 7,
  };

  /** ステージ定義（パレット・難易度など。ヒント配置は開始時にランダム生成） */
  const STAGES = [    {
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

  /** Web Audio API の AudioContext（効果音再生用。初回のみ生成） */
  let audioContext = null;

  /** アプリケーション全体の状態 */
  const state = {
    screen: 'title',           // 現在表示中の画面
    progress: loadProgress(),  // クリア済みステージ・続きから情報
    activeStageId: 1,          // プレイ中のステージ番号
    game: {
      selectedShape: null,     // パレットで選択中の図形
      playerCells: {},         // プレイヤーが右側に配置した図形 { "x,y": shapeId }
      wrongCells: [],          // 不正解時にハイライトするセル座標
      shaking: false,          // ボードのシェイク演出フラグ
      hints: [],               // 現在ステージのヒント配置（ランダム生成）
    },
  };

  // ===== 座標・図形ユーティリティ =====

  /** セル座標をオブジェクトのキー文字列に変換（例: "2,3"） */
  function shapeKey(x, y) {
    return x + ',' + y;
  }

  /** 図形ID（例: "circle-red"）を種類と色に分解 */
  function parseShapeId(id) {
    const parts = id.split('-');
    return { type: parts[0], color: parts[1] };
  }

  /** 指定列がヒント側（左半分＋中央列）かどうか */
  function isHintSide(x, gridSize) {
    gridSize = gridSize || GRID_SIZE;
    return x <= Math.floor(gridSize / 2);
  }

  /** 指定列がプレイ側（右半分）かどうか */
  function isPlaySide(x, gridSize) {    gridSize = gridSize || GRID_SIZE;
    return x > Math.floor(gridSize / 2);
  }

  /** ヒント配列を座標キー → 図形ID のマップに変換（描画・判定を高速化） */
  function hintsToMap(hints) {
    const map = {};
    hints.forEach(function (h) {
      map[shapeKey(h.x, h.y)] = h.shape;
    });
    return map;
  }

  /** 左右対称の鏡像となる列番号を返す（例: x=0 → x=6） */
  function getMirrorX(x, gridSize) {
    gridSize = gridSize || GRID_SIZE;
    return gridSize - 1 - x;
  }

  /**
   * プレイ側セルに置くべき正解の図形を取得
   * 左側の鏡像位置にあるヒント図形と同じものが正解
   */
  function getExpectedShape(x, y, hints, gridSize) {
    gridSize = gridSize || GRID_SIZE;
    const mirrorX = getMirrorX(x, gridSize);
    const hint = hints.find(function (h) {
      return h.x === mirrorX && h.y === y;
    });
    return hint ? hint.shape : null;
  }

  /**
   * プレイヤーの配置が正解と異なるセルを列挙
   * 空セルなのに図形が必要な場合、または図形・色が異なる場合も対象
   */
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

  /** 右半分の配置が左半分の鏡像と完全に一致するか判定 */
  function checkSymmetry(hints, playerCells, gridSize) {
    return getWrongCells(hints, playerCells, gridSize).length === 0;
  }

  // ===== 進行データの保存・読み込み =====

  /**
   * 保存データを現在の仕様（5ステージ）に合わせて正規化
   * 旧バージョンの23ステージ分データなどをクリップする
   */
  function normalizeProgress(parsed) {    const cleared = (parsed.clearedStages || []).filter(function (id) {
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

  /** localStorage から進行データを読み込む（失敗時は初期状態を返す） */
  function loadProgress() {    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { clearedStages: [], currentStage: 1, settings: { bgm: true, se: true } };
      }
      return normalizeProgress(JSON.parse(raw));
    } catch (e) {
      return { clearedStages: [], currentStage: 1, settings: { bgm: true, se: true } };
    }
  }

  /** 現在の進行データを localStorage に保存 */
  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
  }

  /** 「つづきから」ボタンを表示すべきか（一度でも進行があるか） */
  function hasProgress() {
    return state.progress.clearedStages.length > 0 || state.progress.currentStage > 1;
  }

  /** 指定ステージが解放済みか（前ステージをクリアしているか） */
  function isStageUnlocked(stageId) {
    if (stageId === 1) return true;
    return state.progress.clearedStages.indexOf(stageId - 1) !== -1;
  }

  /** ステージIDからステージ定義オブジェクトを取得 */
  function getStage(id) {
    return STAGES.find(function (s) { return s.id === id; }) || STAGES[0];
  }

  /** 現在プレイ中ステージのヒント配置を返す */
  function getActiveHints() {
    return state.game.hints || [];
  }

  // ===== ランダムヒント生成 =====

  /** Fisher-Yates シャッフルで配列をランダムに並べ替え */
  function shuffleArray(arr) {    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  /** 配列からランダムに1要素を選ぶ */
  function randomPick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /** ヒント側（左半分＋中央列）の全セル座標リストを生成 */
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

  /**
   * ステージ開始時にヒント側へランダム配置を生成
   * 難易度に応じた数のセルを選び、パレットからランダムに図形を割り当てる
   */
  function generateRandomHints(stage) {
    const gridSize = stage.gridSize || GRID_SIZE;
    const count = SHAPE_COUNT_BY_DIFFICULTY[stage.difficulty] || stage.difficulty;
    // 左半分のセルをシャッフルし、先頭 count 個を配置位置として使用
    const positions = shuffleArray(getHintSideCells(gridSize)).slice(0, count);

    return positions.map(function (pos) {
      return {
        x: pos.x,
        y: pos.y,
        shape: randomPick(stage.palette),
      };
    });
  }

  // ===== 効果音 =====

  /** AudioContext を取得（未生成なら新規作成） */
  function getAudioContext() {    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    return audioContext;
  }

  /** 指定周波数・長さのサイン波を再生（SE 設定がオフなら何もしない） */
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
      // 音量を指数関数的に減衰させて自然な余韻にする
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.stop(ctx.currentTime + duration);
    } catch (e) { /* ignore */ }
  }

  /** ゲーム内効果音の定義 */
  const sound = {
    place: function () { playTone(520, 0.08); },
    remove: function () { playTone(320, 0.06); },
    success: function () {
      // 3音の上昇アルペジオで正解を演出
      playTone(523, 0.12);
      setTimeout(function () { playTone(659, 0.12); }, 100);
      setTimeout(function () { playTone(784, 0.2); }, 200);
    },
    fail: function () {
      // 低い2音で不正解を演出
      playTone(200, 0.15);
      setTimeout(function () { playTone(160, 0.2); }, 120);
    },
  };

  // ===== SVG 描画 =====

  /** 図形IDに対応する SVG 文字列を生成 */
  function createShapeSvg(shapeId, size) {    size = size || 28;
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

  // ===== 画面描画（HTML生成） =====

  /** 難易度を★5段階の HTML として生成 */
  function renderDifficultyStars(difficulty) {    let html = '<span class="stars" aria-label="難易度 ' + difficulty + '">';
    for (let i = 0; i < 5; i++) {
      html += '<span class="' + (i < difficulty ? 'filled' : 'empty') + '">★</span>';
    }
    return html + '</span>';
  }

  /**
   * 7×7 ゲームボードの HTML を生成
   * 左側はヒント表示、右側はプレイヤー配置。不正解セルはハイライト
   */
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
        // 左側はヒント、右側はプレイヤー配置を表示
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

  /** タイトル画面の HTML を生成 */
  function renderTitleScreen() {
    return (
      '<div class="title-screen">' +
        '<img src="' + IMG.title + '" alt="" class="screen-image title-bg" aria-hidden="true">' +
        '<div class="title-overlay">' +
          '<h1 class="game-title">シンメトリー図形パズル</h1>' +
          '<div class="title-actions">' +
            '<button type="button" class="btn-start" data-action="stageSelect">ゲームをスタート</button>' +
            '<button type="button" class="btn-continue" data-action="continue">つづきから</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /** ステージ選択画面の HTML を生成（ロック・クリア状態を反映） */
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

  /** ゲームプレイ画面の HTML を生成（ボード・パレット・アクションボタン） */
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

  /** 全ステージクリア後のゲーム終了画面の HTML を生成 */
  function renderEndScreen() {
    return (
      '<div class="end-screen">' +
        '<img src="' + IMG.end + '" alt="" class="screen-image" aria-hidden="true">' +
        '<h1 class="end-congrats">クリアおめでとう！</h1>' +
        '<div class="screen-actions end-actions">' +
          '<button type="button" class="btn-end" data-action="title">タイトルに戻る</button>' +
        '</div>' +
      '</div>'
    );
  }

  /** ステージクリア画面の HTML を生成（花吹雪演出付き） */
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

    return (      '<div class="clear-screen">' +
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

  // ===== ゲーム進行 =====

  /**
   * ゲーム状態をリセット
   * hints を省略した場合は現在のヒント配置を維持（リセットボタン用）
   */
  function resetGameState(stage, hints) {
    state.game = {
      selectedShape: stage.palette[0] || null,
      playerCells: {},
      wrongCells: [],
      shaking: false,
      hints: hints || state.game.hints || [],
    };
  }

  /** 指定ステージを開始（ランダムヒント生成 → ゲーム画面へ遷移） */
  function startStage(stageId) {
    state.activeStageId = stageId;
    const stage = getStage(stageId);
    resetGameState(stage, generateRandomHints(stage));
    state.screen = 'game';
    render();
  }

  /** ステージクリア時の処理（進行保存・次画面への遷移） */
  function handleClear() {
    const id = state.activeStageId;
    if (state.progress.clearedStages.indexOf(id) === -1) {
      state.progress.clearedStages.push(id);
      state.progress.clearedStages.sort(function (a, b) { return a - b; });
    }
    const nextStageId = Math.min(id + 1, STAGES.length);
    state.progress.currentStage = Math.max(state.progress.currentStage, nextStageId);
    saveProgress();
    // 最終ステージクリア時はゲーム終了画面、それ以外はクリア画面
    if (id === STAGE_COUNT) {
      state.screen = 'end';
    } else {
      state.screen = 'clear';
    }
    render();
  }

  // ===== イベント処理 =====

  /** クリックイベントを一括で登録（イベント委譲方式） */
  function bindEvents() {
    const app = document.getElementById('app');
    if (!app) return;

    app.addEventListener('click', function (e) {
      // data-action 属性を持つボタン（画面遷移・アクション）
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

      // ステージ選択ボタン
      const stageBtn = e.target.closest('[data-stage]');
      if (stageBtn && !stageBtn.disabled) {
        startStage(parseInt(stageBtn.getAttribute('data-stage'), 10));
        return;
      }

      // 図形パレットの選択
      const paletteBtn = e.target.closest('[data-shape]');
      if (paletteBtn) {
        state.game.selectedShape = paletteBtn.getAttribute('data-shape');
        render();
        return;
      }

      // ボード上のセルクリック（右半分のみ）
      const cellBtn = e.target.closest('.cell.playable');
      if (cellBtn && !cellBtn.disabled) {
        handleCellClick(
          parseInt(cellBtn.getAttribute('data-x'), 10),
          parseInt(cellBtn.getAttribute('data-y'), 10)
        );
      }
    });
  }

  /** セルクリック時：図形の配置または削除（トグル動作） */
  function handleCellClick(x, y) {
    const stage = getStage(state.activeStageId);
    if (!isPlaySide(x, stage.gridSize)) return;

    const key = shapeKey(x, y);
    state.game.wrongCells = [];

    if (state.game.playerCells[key]) {
      // 既に図形がある場合は削除
      delete state.game.playerCells[key];
      sound.remove();
    } else if (state.game.selectedShape) {
      // 選択中の図形を配置
      state.game.playerCells[key] = state.game.selectedShape;
      sound.place();
    }

    render();
  }

  /** 「完成！」ボタン押下時：正誤判定とフィードバック */
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
      // シェイク演出後にフラグを解除
      setTimeout(function () {
        state.game.shaking = false;
        render();
      }, 400);
    }
  }

  /** 画面に応じて body の背景クラスを切り替え */
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

  /** 現在の screen 状態に応じて #app の内容を再描画 */
  function render() {    const app = document.getElementById('app');
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

  // ===== 初期化 =====
  bindEvents();
  render();
})();