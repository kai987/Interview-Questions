(() => {
  const outlines = {
    1: '5年以上Web経験 → GETTR → 大学院AI・Python → Web×AIで社内課題解決',
    2: '企業サイト・CMS → React / Vue / TypeScript → GETTR → API・運用 → AI分野へ拡張',
    3: 'Web実務経験 → AI・データ習得 → 日本語・日本企業理解 → 日本で長期就業',
    4: 'Frontend経験 → データ・自動化への関心 → 生成AIの実用化 → Web×AI',
    5: '社内ユーザー直結 → 企画〜運用 → Python・生成AI・RPA → 生産性向上',
    6: '受託・大規模開発経験 → 利用者の反応 → 継続改善 → UI改善経験を活用',
    7: 'Frontendを土台 → Python・AI追加 → 企画〜運用へ範囲拡張 → AI社内SE',
    8: '業務ヒアリング → 小さなAI・RAG自動化 → PoC・KPI → 全社展開',
    9: '課題発見 → 自走調査 → 箱詰め支援 → React・TypeScript・Three.js → 改善力',
    10: '一つに集中しすぎる → 全体進捗に影響 → 必須・改善を分離 → 時間制限・共有',
    11: '日本語学校 → 大学院で発表・グループワーク → 相手に合わせて説明 → 不明点は確認',
    12: '会社都合退職 → キャリア再設計 → AI・日本語学習 → 日本で長期就業',
    13: 'GETTR → 約70名・FE6〜10名 → React・TypeScript → 投稿・DM・ライブ → 運用改善',
    14: '要件確認 → Figma・プロトタイプ → 実装・テスト → リリース・運用 → 上流へ拡張',
    15: '現状業務確認 → 真の課題特定 → 必須・将来要件 → 小さく試作 → フィードバック',
    16: '現場観察 → UIの不便発見 → Viewer共通化 → 改善提案 → 利用者視点',
    17: '影響度 → 緊急度 → 利用人数・工数・リスク → Quick Win → 合意形成',
    18: '目標定義 → MVP → 小分け実装 → 早期プロトタイプ → 効果測定 → 展開',
    19: '目的・判断基準を揃える → データ・試作で比較 → 決定理由を理解 → チームで実行',
    20: '3D精度に集中 → 全体遅延 → 必須・重要・将来で整理 → 完了条件 → 全体優先',
    21: 'JavaScript・TypeScript 5年以上 → React・Vue・API → Pythonは大学院・個人開発 → 実務へ早期適応',
    22: 'UI・ブラウザ＝TypeScript / React → AI・データ＝Python → FastAPI連携 → 保守性で選択',
    23: '仕様整理・コード・テスト → AI Skill自動化 → 人間が検証 → 反復作業を高速化',
    24: '関連情報を検索 → 社内文書取得 → LLMへ根拠提供 → 出典表示 → 権限・更新・評価',
    25: '情報漏えい・幻覚・権限 → データ分類・マスキング → ログ・制限 → 人間確認',
    26: '実業務テストセット → 正答・見落とし・修正率 → 業務KPI → 失敗分析 → 現場負担',
    27: '固定手順＝RPA → 柔軟な文章判断＝生成AI → 高精度・安定処理＝通常システム → 組み合わせ',
    28: '認証・権限 → 入力検証・エラー・再試行 → コスト・仕様変更 → セキュリティ → ログ',
    29: 'React＝自由度 → Vue＝統一しやすい → 両方経験 → 規模・資産・チームで選択',
    30: '仕様・影響確認 → 可読性・責務 → 例外・セキュリティ・性能 → 代替案 → 知識共有',
    31: 'Web即戦力 → AI・Python学習 → AIを業務画面へ統合 → 課題発見・改善 → 技術と現場を接続',
    32: '1か月：理解・ヒアリング → 2か月：PoC → 3か月：評価・改善提案',
    33: 'Web×AIで成果 → 課題整理・技術選定 → 共通AI / DX基盤 → Tech Lead → 事業と技術を接続',
    34: '2027年3月卒業 → 4月入社可能 → 留学から就労資格へ変更 → 早めに書類準備',
    35: '求人条件を前提 → 33〜35万円目安 → 経験・役割で相談 → 柔軟に調整',
    36: '社内対話・業務改善への理解 → Web即戦力 → AIを実務で深化 → 長期貢献 → 感謝',
    37: '期待成果を確認 → 入社後の優先事項 → 自分の経験と接続',
    38: 'チーム人数・役割 → レビュー体制 → 技術相談先 → 自走範囲を確認',
    39: '優先課題 → 実際の仕事像 → 自分の経験と接続 → 会話を深める',
    40: 'Python / JavaScript Framework → Cloud・DB → キャッチアップ範囲 → 入社前準備',
    41: 'AIガバナンス → 社内データ・個人情報 → セキュリティ運用 → 整備余地',
    42: '複数依頼 → 優先順位プロセス → 社内SEの裁量 → 合意形成',
    43: 'Tech Lead要件 → 技術成果 → 評価制度 → マネジメントとの違い → 長期成長'
  };

  const dataById = new Map((window.INTERVIEW_DATA || []).map(item => [Number(item.id), item]));
  const studyTools = document.querySelector('.study-tools');
  const questionSections = document.getElementById('questionSections');
  if (!studyTools || !questionSections) return;

  let chineseHintsEnabled = localStorage.getItem('interview-chinese-hints') === 'true';
  let answerView = localStorage.getItem('interview-answer-view') === 'outline' ? 'outline' : 'full';

  function createButton(label, value, group) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'memory-toggle-button';
    button.dataset.toggleValue = value;
    button.dataset.toggleGroup = group;
    button.textContent = label;
    return button;
  }

  function injectControls() {
    if (document.querySelector('.study-memory-controls')) return;

    const controls = document.createElement('div');
    controls.className = 'study-memory-controls';

    const chineseGroup = document.createElement('div');
    chineseGroup.className = 'memory-toggle-group chinese-hint-control';
    chineseGroup.innerHTML = '<span class="memory-toggle-label">練習時 中文提示</span>';
    chineseGroup.append(createButton('OFF', 'off', 'chinese'));
    chineseGroup.append(createButton('ON', 'on', 'chinese'));

    const answerGroup = document.createElement('div');
    answerGroup.className = 'memory-toggle-group answer-view-control';
    answerGroup.innerHTML = '<span class="memory-toggle-label">回答表示</span>';
    answerGroup.append(createButton('全文', 'full', 'answer'));
    answerGroup.append(createButton('キーワード', 'outline', 'answer'));

    controls.append(chineseGroup, answerGroup);
    studyTools.appendChild(controls);

    controls.addEventListener('click', event => {
      const button = event.target.closest('.memory-toggle-button');
      if (!button) return;
      if (button.dataset.toggleGroup === 'chinese') {
        chineseHintsEnabled = button.dataset.toggleValue === 'on';
        localStorage.setItem('interview-chinese-hints', String(chineseHintsEnabled));
      } else if (button.dataset.toggleGroup === 'answer') {
        answerView = button.dataset.toggleValue === 'outline' ? 'outline' : 'full';
        localStorage.setItem('interview-answer-view', answerView);
      }
      applyState();
    });
  }

  function getOutlineFor(id) {
    if (outlines[id]) return outlines[id];
    const item = dataById.get(id);
    return (item?.tags || []).slice(0, 4).join(' → ');
  }

  function buildOutline(id) {
    const text = getOutlineFor(id);
    if (!text) return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'answer-outline';

    const title = document.createElement('div');
    title.className = 'answer-outline__title';
    title.textContent = 'キーワード提綱';
    wrapper.appendChild(title);

    const flow = document.createElement('div');
    flow.className = 'answer-outline__flow';
    const parts = text.split('→').map(part => part.trim()).filter(Boolean);
    parts.forEach((part, index) => {
      const chip = document.createElement('span');
      chip.className = 'answer-outline__chip';
      chip.textContent = part;
      flow.appendChild(chip);
      if (index < parts.length - 1) {
        const arrow = document.createElement('span');
        arrow.className = 'answer-outline__arrow';
        arrow.textContent = '→';
        flow.appendChild(arrow);
      }
    });
    wrapper.appendChild(flow);
    return wrapper;
  }

  function enhanceCards() {
    document.querySelectorAll('.qa-card').forEach(card => {
      const id = Number(card.id.replace(/^q-/, ''));
      if (!Number.isFinite(id)) return;
      const answerText = card.querySelector('.answer-text');
      if (!answerText || card.querySelector('.answer-outline')) return;
      const outline = buildOutline(id);
      if (outline) answerText.before(outline);
    });
  }

  function applyState() {
    document.body.classList.toggle('chinese-hints-on', chineseHintsEnabled);
    document.body.classList.toggle('chinese-hints-off', !chineseHintsEnabled);
    document.body.classList.toggle('answer-view-outline', answerView === 'outline');
    document.body.classList.toggle('answer-view-full', answerView === 'full');

    document.querySelectorAll('[data-toggle-group="chinese"]').forEach(button => {
      const active = (button.dataset.toggleValue === 'on') === chineseHintsEnabled;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-toggle-group="answer"]').forEach(button => {
      const active = button.dataset.toggleValue === answerView;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  injectControls();
  enhanceCards();
  applyState();

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhanceCards();
      applyState();
    });
  });
  observer.observe(questionSections, { childList: true, subtree: true });
})();
