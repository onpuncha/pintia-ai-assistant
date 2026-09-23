(() => {
  if (window.__pintiaAssistantLoaded) return;
  window.__pintiaAssistantLoaded = true;

  const TYPE_ORDER = [1, 2, 3, 4, 5, 7];
  let paused = false;
  let stopped = false;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const text = (node) => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const cleanQuestionText = (value) => value
    .replace(/\s9\d+▸\s*/g, ' ')
    .replace(/\s*\d+\s*分\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const cleanOptionText = (value) => {
    let result = value
      .replace(/\s+/g, ' ')
      .replace(/\s*(复制内容|格式|全屏|收起)\s*/g, ' ')
      .replace(/\s*▾+\s*/g, ' ')
      .replace(/\[\s*C\+\+\s*\]\s*/g, '')
      .trim();
    // Pintia's code viewer exposes line numbers before the first code token.
    result = result.replace(/^(.*?[A-EＡ-Ｅ][.．、)）]\s+)(?:\d+\s+){1,}(?=[A-Za-z_#])/u, '$1');
    result = result.replace(/^([A-EＡ-Ｅ][.．、)）]\s+)\d+\s+(?=['!#A-Za-z_({])/u, '$1');
    return result.replace(/\s+/g, ' ').trim();
  };

  const getQuestionContainers = () => [...document.querySelectorAll('div[id]')]
    .filter(node => /^\d+$/.test(node.id) && node.classList.contains('scroll-mt-0'));

  const getAnswerFields = (container) => [...container.querySelectorAll('input:not([type="hidden"]), textarea, [contenteditable="true"]')]
    .filter(node => {
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    })
    .map((node, index) => ({
      index: index + 1,
      tag: node.tagName.toLowerCase(),
      type: node.getAttribute('type') || null,
      name: node.getAttribute('name') || null,
      placeholder: node.getAttribute('placeholder') || null,
      value: 'value' in node ? node.value : text(node),
      ariaLabel: node.getAttribute('aria-label') || null,
      disabled: Boolean(node.disabled),
      maxLength: node.getAttribute('maxlength') ? Number(node.getAttribute('maxlength')) : null
    }));

  function answerFieldNodes(container) {
    return [...container.querySelectorAll('input:not([type="hidden"]), textarea, [contenteditable="true"]')]
      .filter(node => {
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && !node.disabled;
      });
  }

  function setFieldValue(node, value) {
    const stringValue = String(value ?? '');
    if (node.isContentEditable) {
      node.textContent = stringValue;
    } else {
      const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(node, stringValue);
      else node.value = stringValue;
    }
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: stringValue }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    node.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function fillQuestionFields(problemSetProblemId, values) {
    const container = document.getElementById(problemSetProblemId);
    if (!container) return { ok: false, reason: '找不到题目容器' };
    const nodes = answerFieldNodes(container);
    if (!Array.isArray(values) || values.length !== nodes.length) {
      return { ok: false, reason: `答案数量不匹配：需要 ${nodes.length} 个，收到 ${Array.isArray(values) ? values.length : 0} 个` };
    }
    values.forEach((value, index) => setFieldValue(nodes[index], value));
    return { ok: true, count: nodes.length };
  }

  function optionEntriesForContainer(container) {
    const containers = getQuestionContainers();
    const optionNodes = getOptionNodes();
    const index = containers.indexOf(container);
    const next = containers[index + 1];
    return optionNodes.filter(item => container.contains(item.node) ||
      (container.compareDocumentPosition(item.node) & Node.DOCUMENT_POSITION_FOLLOWING &&
        (!next || (next.compareDocumentPosition(item.node) & Node.DOCUMENT_POSITION_PRECEDING))))
      .map(item => ({ node: item.node, value: cleanOptionText(item.value), letter: optionLetter(cleanOptionText(item.value)) }))
      .filter((item, i, all) => all.findIndex(other => other.letter === item.letter) === i);
  }

  function clickOptionNode(node) {
    const clickable = node.closest('label,button,[role="radio"],[role="checkbox"]') || node;
    clickable.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    clickable.click();
    return true;
  }

  function fillQuestionOptions(problemSetProblemId, values) {
    const container = document.getElementById(problemSetProblemId);
    if (!container) return { ok: false, reason: '找不到题目容器' };
    if (!Array.isArray(values) || !values.length) return { ok: false, reason: '没有收到选项答案' };
    const wanted = values.map(value => optionLetter(String(value).trim().toUpperCase()));
    const entries = optionEntriesForContainer(container);
    const clicked = [];
    for (const letter of wanted) {
      const entry = entries.find(item => item.letter === letter);
      if (!entry) return { ok: false, reason: `找不到选项 ${letter}` };
      clickOptionNode(entry.node);
      clicked.push(letter);
    }
    return { ok: true, count: clicked.length, values: clicked };
  }

  const optionPrefix = /^(?:[A-EＡ-Ｅ][.．、)）]\s*|T$|F$|正确$|错误$)/;
  const optionMarker = /(?:^|\s)([A-EＡ-Ｅ])[.．、)）](?=\s|$)/g;
  const isOptionText = (value) => {
    if (!optionPrefix.test(value)) return false;
    if (/^[A-EＡ-Ｅ][.．、)）]$/.test(value)) return false;
    const markers = [...value.matchAll(optionMarker)];
    return markers.length <= 1;
  };

  const optionLetter = (value) => {
    if (/^[TF]$/.test(value) || /^(正确|错误)$/.test(value)) return value;
    const match = value.match(/^([A-EＡ-Ｅ])[.．、)）]/);
    return match ? match[1].toUpperCase() : value;
  };

  function getOptionNodes() {
    const nodes = [...document.querySelectorAll('label,button,[role="radio"],[role="checkbox"],span,div')]
      .map(node => ({ node, value: text(node) }))
      .filter(item => isOptionText(item.value));
    const result = nodes.filter(item => !nodes.some(other =>
      other !== item && other.value === item.value && item.node.contains(other.node)));
    return result.filter((item, index, all) =>
      all.findIndex(other => optionLetter(other.value) === optionLetter(item.value) &&
        other.node.parentElement === item.node.parentElement) === index);
  }

  function optionsForContainer(container, containers, optionNodes) {
    const index = containers.indexOf(container);
    const next = containers[index + 1];
    return optionNodes
      .filter(item => container.contains(item.node) ||
        (container.compareDocumentPosition(item.node) & Node.DOCUMENT_POSITION_FOLLOWING &&
          (!next || (next.compareDocumentPosition(item.node) & Node.DOCUMENT_POSITION_PRECEDING))))
      .map(item => cleanOptionText(item.value))
      .filter((value, i, a) => a.findIndex(other => optionLetter(other) === optionLetter(value)) === i);
  }

  function getCurrentType() {
    const match = location.pathname.match(/\/type\/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function getCodingProblemId() {
    return new URL(location.href).searchParams.get('problemSetProblemId');
  }

  function getCodingList() {
    return [...document.querySelectorAll('a[href*="/exam/problems/type/7?problemSetProblemId="]')]
      .map((node, index) => ({
        index: index + 1,
        number: text(node).match(/7-\d+/)?.[0] || null,
        title: text(node),
        href: node.href
      }))
      .filter(item => item.href.startsWith('https://pintia.cn/'))
      .filter((item, index, all) => all.findIndex(other => other.href === item.href) === index);
  }

  function getCodingNumber() {
    const titleMatch = document.title.match(/(7-\d+)/);
    if (titleMatch) return titleMatch[1];
    const heading = [...document.querySelectorAll('h1,h2,h3,h4')].map(text).find(value => /^7-\d+/.test(value));
    return heading?.match(/^7-\d+/)?.[0] || null;
  }

  function getVisibleEditorNodes() {
    const selectors = [
      'textarea',
      '[contenteditable="true"]',
      '.monaco-editor',
      '.CodeMirror',
      '.cm-editor',
      '[class*="editor"]'
    ];
    const nodes = [...document.querySelectorAll(selectors.join(','))];
    return nodes.filter(node => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
  }

  function readEditorValue(node) {
    if ('value' in node && typeof node.value === 'string') return node.value;
    if (node.classList.contains('CodeMirror')) return node.CodeMirror?.getValue?.() || text(node);
    return text(node);
  }

  function getCodingInfo() {
    const editors = getVisibleEditorNodes().map((node, index) => ({
      index: index + 1,
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      className: typeof node.className === 'string' ? node.className.slice(0, 200) : '',
      role: node.getAttribute('role') || null,
      ariaLabel: node.getAttribute('aria-label') || null,
      valueLength: readEditorValue(node).length,
      valuePreview: readEditorValue(node).slice(0, 500)
    }));
    const languages = [...document.querySelectorAll('select,button,[role="combobox"],[role="listbox"]')]
      .map(node => ({ text: text(node), value: node.value || node.getAttribute('aria-label') || null }))
      .filter(item => /C\s*\(gcc\)|C\+\+|Python|Java|语言|language/i.test(`${item.text} ${item.value || ''}`));
    const actions = [...document.querySelectorAll('button,[role="button"],a')]
      .map(node => ({ text: text(node), href: node.href || null }))
      .filter(item => /提交本题作答|测试用例|上一题|下一题|提交/i.test(item.text));
    const bodyText = text(document.body);
    const judgeMatch = bodyText.match(/(答案正确|部分正确|答案错误|编译错误|运行时错误)/);
    const scoreMatch = bodyText.match(/分数\s+(\d+)\s*\/\s*(\d+)/);
    return {
      number: getCodingNumber(),
      problemSetProblemId: getCodingProblemId(),
      editorCount: editors.length,
      editors,
      languages,
      actions,
      judgeStatus: judgeMatch?.[1] || '未提交',
      score: scoreMatch ? { earned: Number(scoreMatch[1]), total: Number(scoreMatch[2]) } : null,
      pageTextPreview: bodyText.slice(0, 12000)
    };
  }

  function findCodingEditor() {
    const candidates = [...document.querySelectorAll('.cm-content[contenteditable="true"], textarea, [contenteditable="true"]')]
      .filter(node => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
    return candidates.find(node => node.matches('.cm-content[role="textbox"]')) || candidates.at(-1) || null;
  }

  function fillCodingEditor(code) {
    const editor = findCodingEditor();
    if (!editor) return { ok: false, reason: '找不到代码编辑器' };
    editor.focus();
    let inserted = false;
    try {
      document.execCommand('selectAll', false);
      inserted = document.execCommand('insertText', false, String(code ?? ''));
    } catch {}
    if (!inserted) {
      editor.textContent = String(code ?? '');
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(code ?? '') }));
    }
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, length: String(code ?? '').length };
  }

  function getProgressText() {
    const nodes = [...document.querySelectorAll('*')];
    const candidates = nodes.filter(n => /^\s*\d+\s*\/\s*\d+\s*$/.test(text(n)));
    return [...new Set(candidates.map(text))].slice(0, 30);
  }

  function getQuestionBlocks() {
    const containers = getQuestionContainers();
    if (getCurrentType() === 7 && !getCodingProblemId()) return [];
    if (getCurrentType() === 7 && getCodingProblemId()) {
      const coding = getCodingInfo();
      return [{
        number: coding.number || '7-?',
        problemSetProblemId: coding.problemSetProblemId,
        text: coding.pageTextPreview,
        options: [],
        fields: [],
        coding
      }];
    }
    const optionNodes = getOptionNodes();
    return containers.map(container => {
      const header = container.children[0];
      const body = container.children[1];
      const headerText = text(header);
      const match = headerText.match(/(\d+[-－]\d+)/);
      const number = match ? match[1].replace('－', '-') : container.id;
      const clone = (body || container).cloneNode(true);
      clone.querySelectorAll('button,[role="button"],label,[class*="toolbar"]').forEach(node => node.remove());
      clone.querySelectorAll('input:not([type="hidden"]), textarea, [contenteditable="true"]').forEach((node, index) => {
        const marker = document.createElement('span');
        marker.textContent = `【空${index + 1}】`;
        node.replaceWith(marker);
      });
      const bodyText = cleanQuestionText(text(clone));
      const options = optionsForContainer(container, containers, optionNodes);
      const fields = getAnswerFields(container);
      return { number, problemSetProblemId: container.id, text: bodyText.slice(0, 8000), options, fields };
    }).filter(item => item.text || item.options.length);
  }

  function getQuestionDiagnostics() {
    const markers = [...document.querySelectorAll('body *')]
      .filter(node => /^\d+[-－]\d+$/.test(text(node)))
      .slice(0, 20);
    return markers.map(marker => {
      const ancestors = [];
      let node = marker;
      for (let i = 0; i < 5 && node; i++, node = node.parentElement) {
        ancestors.push({
          tag: node.tagName,
          id: node.id || '',
          className: typeof node.className === 'string' ? node.className.slice(0, 180) : '',
          text: text(node).slice(0, 800),
          childCount: node.children?.length || 0
        });
      }
      const parent = marker.parentElement;
      const siblingTexts = parent ? [...parent.parentElement?.children || []]
        .map(text).filter(Boolean).slice(0, 20) : [];
      return { marker: text(marker), ancestors, siblingTexts };
    });
  }

  function getChoiceLabels() {
    return [...document.querySelectorAll('label,button,[role="radio"],[role="checkbox"]')]
      .map(text).filter(Boolean).map(cleanOptionText).filter(Boolean)
      .filter(v => !/^(图例|Toggle Sidebar|复制内容|格式|全屏|收起|保存|重新加载|不再提醒)$/.test(v))
      .filter((v, i, a) => a.indexOf(v) === i).slice(0, 200);
  }

  function getTypeNavigation() {
    return [...document.querySelectorAll('a[href*="/exam/problems/type/"],button,[role="button"]')]
      .map(node => ({ text: text(node), href: node.href || null }))
      .filter(item => {
        if (!item.href) return false;
        try {
          const url = new URL(item.href);
          return /\/exam\/problems\/type\/(1|2|3|4|5|7)$/.test(url.pathname) && !url.search;
        } catch { return false; }
      })
      .filter((item, i, a) => a.findIndex(x => x.href === item.href) === i)
      .slice(0, 10);
  }

  function snapshot() {
    return {
      url: location.href,
      title: document.title,
      currentType: getCurrentType(),
      typeOrder: TYPE_ORDER,
      progressTexts: getProgressText(),
      codingList: getCurrentType() === 7 ? getCodingList() : [],
      questionCandidates: getQuestionBlocks(),
      choiceCandidates: getChoiceLabels(),
      typeNavigation: getTypeNavigation(),
      saveButtons: [...document.querySelectorAll('button,[role="button"]')].map(text)
        .filter(v => /保存|save/i.test(v)).slice(0, 20),
      timestamp: new Date().toISOString()
    };
  }

  function findSaveButton() {
    return [...document.querySelectorAll('button,[role="button"]')]
      .find(node => /保存|save/i.test(text(node)) && !node.disabled);
  }

  function clickNextType() {
    const current = getCurrentType();
    const next = TYPE_ORDER.slice(TYPE_ORDER.indexOf(current) + 1);
    const target = next.find(type => document.querySelector(`a[href*="/exam/problems/type/${type}"]`));
    if (target) {
      const href = target.href;
      setTimeout(() => { location.href = href; }, 80);
      return { moved: true, href };
    }
    const sideText = {1:'判断题',2:'单选题',3:'多选题',4:'填空题',5:'程序填空题',7:'编程题'};
    const fallback = next.map(type => [...document.querySelectorAll('a,button,[role="button"]')]
      .find(n => text(n).includes(sideText[type]))).find(Boolean);
    if (fallback) {
      const href = fallback.href || null;
      if (href) {
        setTimeout(() => { location.href = href; }, 80);
        return { moved: true, href };
      }
      fallback.click();
      return { moved: true, href: null };
    }
    return { moved: false, href: null };
  }

  async function saveAndNavigate() {
    if (stopped) return { ok: false, reason: 'stopped' };
    while (paused && !stopped) await sleep(250);
    const button = findSaveButton();
    if (!button) return { ok: false, reason: '找不到保存按钮' };
    button.click();
    const started = Date.now();
    let saved = false;
    while (Date.now() - started < 8000) {
      const pageText = text(document.body);
      if (/保存成功|已保存|保存完成|successfully saved/i.test(pageText)) { saved = true; break; }
      await sleep(250);
    }
    if (!saved) await sleep(1000);
    const navigation = clickNextType();
    return { ok: true, saved, moved: navigation.moved, href: navigation.href };
  }

  function emitState() {
    window.postMessage({ source: 'pintia-assistant', type: 'state', payload: { paused, stopped, snapshot: snapshot() } }, '*');
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.type) return;
    if (message.type === 'snapshot') {
      sendResponse(snapshot());
      return true;
    }
    if (message.type === 'pause-toggle') { paused = !paused; stopped = false; emitState(); sendResponse({ ok: true, paused }); return true; }
    if (message.type === 'stop') { stopped = true; paused = false; emitState(); sendResponse({ ok: true, stopped }); return true; }
    if (message.type === 'save-next') {
      saveAndNavigate().then(result => {
        emitState();
        sendResponse(result);
      });
      return true;
    }
    if (message.type === 'fill-fields') {
      sendResponse(fillQuestionFields(message.problemSetProblemId, message.values));
      return true;
    }
    if (message.type === 'fill-options') {
      sendResponse(fillQuestionOptions(message.problemSetProblemId, message.values));
      return true;
    }
    if (message.type === 'open-coding-first') {
      const first = getCodingList()[0];
      if (!first) { sendResponse({ ok: false, reason: '找不到编程题列表' }); return true; }
      sendResponse({ ok: true, href: first.href });
      // 先返回结果，再导航，避免侧栏因页面销毁而收不到响应。
      setTimeout(() => { location.href = first.href; }, 0);
      return true;
    }
    if (message.type === 'fill-coding') {
      sendResponse(fillCodingEditor(message.code));
      return true;
    }
  });

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data?.source !== 'pintia-assistant-ui') return;
    const { type } = event.data;
    if (type === 'snapshot') window.postMessage({ source: 'pintia-assistant', type: 'snapshot', payload: snapshot() }, '*');
    if (type === 'pause-toggle') { paused = !paused; stopped = false; emitState(); }
    if (type === 'stop') { stopped = true; paused = false; emitState(); }
    if (type === 'save-next') {
      const result = await saveAndNavigate();
      window.postMessage({ source: 'pintia-assistant', type: 'operation-result', payload: result }, '*');
      emitState();
    }
  });

  document.addEventListener('keydown', async (event) => {
    if (!event.ctrlKey || !event.shiftKey) return;
    if (event.code === 'KeyP') { event.preventDefault(); paused = !paused; stopped = false; emitState(); }
    if (event.code === 'KeyS') { event.preventDefault(); const result = await saveAndNavigate(); window.postMessage({ source: 'pintia-assistant', type: 'operation-result', payload: result }, '*'); }
    if (event.code === 'KeyX') { event.preventDefault(); stopped = true; paused = false; emitState(); }
  });

  emitState();
})();
