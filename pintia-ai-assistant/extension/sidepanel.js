let activeTabId = null;
let currentSnapshot = null;
let currentCoding = null;
let assistRunning = false;

const $ = (id) => document.getElementById(id);

async function currentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function setStatus(message, kind = '') {
  const node = $('pageStatus');
  node.textContent = message;
  node.className = `status ${kind}`.trim();
}

function setCodingStatus(message, kind = '') {
  const node = $('codingStatus');
  node.textContent = message;
  node.className = `status ${kind}`.trim();
}

function setAnswerStatus(message, kind = '') {
  const node = $('answerStatus');
  node.textContent = message;
  node.className = `status ${kind}`.trim();
}

function getTypeName(type) {
  return ({ 1: '判断题', 2: '单选题', 3: '多选题', 4: '填空题', 5: '程序填空题', 7: '编程题' })[type] || `题型 ${type}`;
}

function setBusy(buttonId, busy, busyText, idleText) {
  const button = $(buttonId);
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? busyText : idleText;
}

function updateAssistControls() {
  const inAssistMode = $('mode').value === 'assist';
  $('startAssist').disabled = !inAssistMode || assistRunning;
  $('saveNext').disabled = !inAssistMode || !assistRunning || !$('generatedAnswers').value.trim();
}

async function getActivePintiaTab() {
  const tab = await currentTab();
  activeTabId = tab?.id || null;
  if (!activeTabId || !tab.url?.startsWith('https://pintia.cn/')) {
    throw new Error('请先在当前标签页打开 Pintia 题目页面。');
  }
  return tab;
}

function sendToPage(message) {
  if (!activeTabId) return Promise.reject(new Error('没有可用的 Pintia 标签页。'));
  return chrome.tabs.sendMessage(activeTabId, message);
}

async function readSnapshot({ quiet = false } = {}) {
  try {
    await getActivePintiaTab();
    if (!quiet) setStatus('正在读取页面…');
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('页面脚本响应超时')), 8000));
    const payload = await Promise.race([sendToPage({ type: 'snapshot' }), timeout]);
    if (!payload) throw new Error('页面没有返回信息');
    currentSnapshot = payload;
    renderSnapshot(payload, { autoGenerate: !quiet });
    return payload;
  } catch (error) {
    currentSnapshot = null;
    currentCoding = null;
    clearProblem();
    $('fillCoding').disabled = true;
    setStatus(error.message || '无法读取页面。', 'error');
    if (!quiet) $('navigationHint').textContent = '如果刚加载或刚切换页面，请先刷新 Pintia，再点击“读取当前题目”。';
    throw error;
  }
}

function getCodingFromSnapshot(payload) {
  return payload?.questionCandidates?.find(item => item?.coding)?.coding || null;
}

function renderSnapshot(payload, { autoGenerate = false } = {}) {
  const type = payload.currentType;
  const list = Array.isArray(payload.codingList) ? payload.codingList : [];
  currentCoding = getCodingFromSnapshot(payload);
  $('data').textContent = JSON.stringify(payload, null, 2);
  $('navigationHint').textContent = '';
  renderTypeNavigation(payload);

  if (type !== 7) {
    clearProblem();
    $('codingCard').classList.add('hidden');
    $('answerCard').classList.remove('hidden');
    const count = payload.questionCandidates?.length || 0;
    setStatus(`已读取${getTypeName(type)}，共 ${count} 题。`, 'success');
    $('navigationHint').textContent = '当前题型的题面、选项和输入框已恢复到诊断区；代码功能只在编程题页面显示。';
    renderNonCoding(payload);
    updateAssistControls();
    if (autoGenerate && count > 0) generateAnswers({ automatic: true }).catch(() => {});
    return;
  }
  if (!currentCoding && list.length) {
    clearProblem();
    $('codingCard').classList.add('hidden');
    $('answerCard').classList.add('hidden');
    setStatus(`已读取编程题列表，共 ${list.length} 题。`, 'success');
    $('navigationHint').textContent = 'B 模式已到编程题阶段；自动流程在此停止。';
    if (assistRunning) {
      assistRunning = false;
      updateAssistControls();
      setStatus('已到达编程题，B 模式已停止。', 'success');
    }
    return;
  }
  if (!currentCoding) {
    clearProblem();
    $('codingCard').classList.add('hidden');
    $('answerCard').classList.add('hidden');
    setStatus('已进入编程题题型，但暂时没有识别到具体题目。', 'warning');
    return;
  }
  if (assistRunning) {
    assistRunning = false;
    updateAssistControls();
    setStatus('已到达编程题，B 模式已停止。', 'success');
  }
  const status = currentCoding.judgeStatus || '未提交';
  const score = currentCoding.score ? ` | 得分 ${currentCoding.score.earned}/${currentCoding.score.total}` : '';
  setStatus(`已读取 ${currentCoding.number || '当前题'} | 判题状态：${status}${score}`, 'success');
  $('answerCard').classList.add('hidden');
  updateAssistControls();
  renderCoding(currentCoding);
}

function renderTypeNavigation(payload) {
  const host = $('typeNavigation');
  host.textContent = '';
  (payload.typeNavigation || []).forEach(item => {
    const link = document.createElement('a');
    link.href = item.href;
    link.textContent = item.text || item.href;
    link.target = '_self';
    host.appendChild(link);
  });
}

async function pageCommand(type) {
  try {
    await getActivePintiaTab();
    const result = await sendToPage({ type });
    if (type === 'pause-toggle') {
      setStatus(result?.paused ? '已暂停。' : '已继续运行。', 'success');
    } else if (type === 'stop') {
      setStatus('已停止当前辅助操作。', 'warning');
    }
    return result;
  } catch (error) {
    setStatus(error.message || '无法操作当前页面。', 'error');
    return null;
  }
}

async function saveNext() {
  if (!assistRunning) {
    setStatus('请先点击“开始 B 模式”。', 'warning');
    return;
  }
  try {
    await getActivePintiaTab();
    setBusy('saveNext', true, '处理中…', '填入、保存并切换');
    setStatus(`正在填入并保存${getTypeName(currentSnapshot?.currentType)}，随后切换…`);
    const answerResult = await fillAnswers({ silent: true });
    if (!answerResult?.ok) throw new Error(answerResult?.reason || '填入答案失败');
    const result = await sendToPage({ type: 'save-next' });
    if (!result?.ok) throw new Error(result?.reason || '保存失败');
    if (!result.moved) {
      setStatus(result.saved ? '已保存，但没有找到下一题型。' : '未确认保存，也没有找到下一题型。', 'warning');
      return;
    }
    const nextType = result.href?.match(/\/exam\/problems\/type\/(\d+)/)?.[1];
    setStatus(`${result.saved ? '已保存' : '已执行保存'}，正在等待切换到${nextType ? getTypeName(Number(nextType)) : '下一题型'}…`, result.saved ? 'success' : 'warning');
    await waitForNextPage(result.href, 15000);
  } catch (error) {
    setStatus(error.message || '保存或切换失败。', 'error');
  } finally {
    updateAssistControls();
  }
}

async function waitForNextPage(expectedHref, timeoutMs = 15000) {
  const expectedType = expectedHref?.match(/\/exam\/problems\/type\/(\d+)/)?.[1] || null;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const tab = await currentTab();
      const url = tab?.url || '';
      if (expectedHref && !url.startsWith(expectedHref.split('?')[0])) continue;
      if (expectedType && !new RegExp(`/exam/problems/type/${expectedType}(?:$|[?])`).test(url)) continue;
      activeTabId = tab?.id || activeTabId;
      const payload = await Promise.race([
        sendToPage({ type: 'snapshot' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('页面脚本尚未就绪')), 1200))
      ]);
      if (!payload) continue;
      currentSnapshot = payload;
      renderSnapshot(payload, { autoGenerate: true });
      return payload;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`页面未能切换到下一题型${lastError ? `：${lastError.message}` : ''}。请检查 Pintia 页面后重试。`);
}

async function startAssist() {
  if (assistRunning) return;
  try {
    await getActivePintiaTab();
    assistRunning = true;
    $('mode').value = 'assist';
    updateAssistControls();
    setStatus('B 模式已开始，正在读取当前题型并生成答案…');
    await readSnapshot();
  } catch (error) {
    assistRunning = false;
    $('startAssist').disabled = false;
    $('saveNext').disabled = true;
    setStatus(error.message || 'B 模式启动失败。', 'error');
  }
}

function renderNonCoding(payload) {
  $('problemCard').classList.remove('hidden');
  const items = payload.questionCandidates || [];
  $('problemSummary').textContent = `${getTypeName(payload.currentType)} | 已读取 ${items.length} 道题（点击展开）`;
  $('problemMeta').textContent = `${getTypeName(payload.currentType)} | 读取到 ${items.length} 道题`;
  if (!items.length) {
    $('problemText').textContent = '没有识别到题目容器。可以点击“导出脱敏诊断 JSON”后发给我继续适配。';
    return;
  }
  $('problemText').textContent = items.map(item => {
    const fields = item.fields?.length ? `\n输入框：${item.fields.length} 个` : '';
    const options = item.options?.length ? `\n选项：${item.options.join(' | ')}` : '';
    return `${item.number || item.problemSetProblemId}\n${item.text || ''}${options}${fields}`;
  }).join('\n\n--------------------\n\n');
}

function clearProblem() {
  $('problemCard').classList.add('hidden');
  $('problemMeta').textContent = '';
  $('problemText').textContent = '';
}

function normalizeAnswerObject(value) {
  if (Array.isArray(value)) return { answers: value };
  if (value && Array.isArray(value.answers)) return value;
  if (value && Array.isArray(value.questions)) return { answers: value.questions };
  return null;
}

function parseAnswerText(raw) {
  let text = String(raw || '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  const normalized = normalizeAnswerObject(parsed);
  if (!normalized) throw new Error('模型返回的答案不是有效 JSON。');
  const answers = normalized.answers.map((item, index) => {
    const id = item.problemSetProblemId || item.id;
    const values = item.values ?? item.answers ?? item.value;
    if (!id || !Array.isArray(values)) throw new Error(`第 ${index + 1} 项缺少 problemSetProblemId 或 values 数组。`);
    return { problemSetProblemId: String(id), values: values.map(value => String(value ?? '')) };
  });
  return { answers };
}

function answerPromptForPayload(payload) {
  const type = payload.currentType;
  const questions = (payload.questionCandidates || []).filter(item => item.problemSetProblemId);
  const typeName = getTypeName(type);
  const format = type === 3
    ? '多选题每题 values 放选中的大写选项字母，例如 ["A","C"]；如果页面每题只有一个选择控件，也仍按该题的实际输入字段数量返回。'
    : type === 1
      ? '判断题 values 只能使用 ["T"] 或 ["F"]。'
      : type === 5
        ? '程序填空题 values 按题目中的空从前到后填写，顺序必须与 fields 顺序一致。'
        : type === 4
          ? '填空题 values 按题目中的空从前到后填写，严格保留要求的字符，不要添加解释。'
          : '单选题 values 使用一个大写选项字母，例如 ["B"]。';
  return [
    `请解答以下 Pintia ${typeName}。`,
    '只返回严格 JSON，不要 Markdown，不要解释，不要多余文字。',
    'JSON 格式必须是：{"answers":[{"problemSetProblemId":"题目ID","values":["答案1","答案2"]}]}。',
    format,
    '必须覆盖下面列出的每一道题，problemSetProblemId 必须原样保留。',
    JSON.stringify(questions)
  ].join('\n');
}

function answerUsesOptions(type) {
  return type === 1 || type === 2 || type === 3;
}

async function generateAnswers({ automatic = false } = {}) {
  if (!currentSnapshot || currentSnapshot.currentType === 7) {
    setAnswerStatus('请先读取判断、单选、多选、填空或程序填空题页面。', 'warning');
    return;
  }
  const config = await getConfig();
  const baseUrl = String(config.apiBaseUrl || 'http://127.0.0.1:8787').replace(/\/$/, '');
  const model = config.model || 'deepseek-chat';
  try {
    setBusy('generateAnswers', true, '生成中…', '生成答案');
    $('generatedAnswers').value = '';
    $('fillAnswers').disabled = true;
    setAnswerStatus(`${automatic ? '读取完成，正在自动生成答案' : '正在重新生成答案'}（调用 ${model}）…`);
    const response = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [
        { role: 'system', content: '你是严谨的 C 语言基础题答题助手。' },
        { role: 'user', content: answerPromptForPayload(currentSnapshot) }
      ] })
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
    if (!response.ok) throw new Error(data.error || data.message || `本地服务返回 HTTP ${response.status}`);
    const modelText = extractGeneratedText(data);
    const normalized = parseAnswerText(modelText);
    $('generatedAnswers').value = JSON.stringify(normalized, null, 2);
    $('fillAnswers').disabled = false;
    updateAssistControls();
    setAnswerStatus(`已生成 ${normalized.answers.length} 道题的答案。请检查后点击“填入答案”。`, 'success');
  } catch (error) {
    setAnswerStatus(`生成失败：${error.message || error}`, 'error');
  } finally {
    setBusy('generateAnswers', false, '生成中…', '生成答案');
  }
}

async function fillAnswers({ silent = false } = {}) {
  let answerObject;
  try {
    answerObject = parseAnswerText($('generatedAnswers').value);
  } catch (error) {
    if (!silent) setAnswerStatus(`答案格式错误：${error.message || error}`, 'error');
    return { ok: false, reason: error.message || '答案格式错误' };
  }
  try {
    await getActivePintiaTab();
    setBusy('fillAnswers', true, '填入中…', '填入答案');
    let total = 0;
    for (const item of answerObject.answers) {
      const result = await sendToPage({
        type: answerUsesOptions(currentSnapshot.currentType) ? 'fill-options' : 'fill-fields',
        problemSetProblemId: item.problemSetProblemId,
        values: item.values
      });
      if (!result?.ok) throw new Error(`${item.problemSetProblemId}：${result?.reason || '填入失败'}`);
      total += result.count || item.values.length;
    }
    if (!silent) setAnswerStatus(`已填入 ${answerObject.answers.length} 道题、${total} 个答案字段。请检查页面后自行保存或提交。`, 'success');
    return { ok: true, count: total };
  } catch (error) {
    if (!silent) setAnswerStatus(`填入失败：${error.message || error}`, 'error');
    return { ok: false, reason: error.message || '填入失败' };
  } finally {
    setBusy('fillAnswers', false, '填入中…', '填入答案');
    $('fillAnswers').disabled = !$('generatedAnswers').value.trim();
    updateAssistControls();
  }
}

function renderCoding(coding) {
  $('codingCard').classList.remove('hidden');
  $('problemCard').classList.remove('hidden');
  $('problemSummary').textContent = `${coding.number || '编程题'} | 题面（点击展开）`;
  const editor = coding.editors?.find(item => item.role === 'textbox') || coding.editors?.[0];
  const editorInfo = editor ? ` | 编辑器${editor.valueLength ? `已有 ${editor.valueLength} 字符` : '为空'}` : ' | 未识别编辑器';
  $('problemMeta').textContent = `${coding.number || '编程题'}${editorInfo}`;
  $('problemText').textContent = coding.pageTextPreview || '未读取到题面文本。';
}

function extractGeneratedText(data) {
  if (typeof data === 'string') return data;
  return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || data?.content || '';
}

function cleanCode(value) {
  let code = String(value || '').trim();
  code = code.replace(/^```(?:c|cpp|c\+\+|python|py)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return code;
}

async function getConfig() {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ apiBaseUrl: 'http://127.0.0.1:8787', model: 'deepseek-chat' }), 1500);
    chrome.runtime.sendMessage({ type: 'get-config' }, config => {
      clearTimeout(timer);
      resolve(config || {});
    });
  });
}

async function generateCode() {
  if (!currentCoding) {
    setCodingStatus('请先打开并读取一套具体编程题。', 'warning');
    return;
  }
  const statement = currentCoding.pageTextPreview?.trim();
  if (!statement) {
    setCodingStatus('没有读取到题面，无法生成代码。', 'error');
    return;
  }
  const language = $('codingLanguage').value;
  const languageName = { c: 'C（使用标准 C，提交完整源代码）', cpp: 'C++（使用标准 C++，提交完整源代码）', python: 'Python 3' }[language];
  const config = await getConfig();
  const baseUrl = String(config.apiBaseUrl || 'http://127.0.0.1:8787').replace(/\/$/, '');
  const model = config.model || 'deepseek-chat';
  const prompt = [
    `请解决下面的 Pintia 编程题，目标语言是${languageName}。`,
    '只返回可以直接提交的完整源代码，不要 Markdown 代码围栏，不要解释，不要在代码前后添加任何文字。',
    '遵守题目输入输出格式；如果题目要求主函数，请包含完整 main；不要读取题目中不存在的额外输入。',
    '', '题面如下：', statement
  ].join('\n');
  try {
    setBusy('generateCode', true, '生成中…', '生成代码');
    $('generatedCode').value = '';
    $('fillCoding').disabled = true;
    setCodingStatus(`正在调用 ${model}…`);
    const response = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [
        { role: 'system', content: '你是严谨的在线评测编程题解题助手。' },
        { role: 'user', content: prompt }
      ] })
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
    if (!response.ok) throw new Error(data.error || data.message || `本地服务返回 HTTP ${response.status}`);
    const code = cleanCode(extractGeneratedText(data));
    if (!code) throw new Error('模型没有返回代码。');
    $('generatedCode').value = code;
    $('fillCoding').disabled = false;
    setCodingStatus('代码已生成并显示在扩展中；确认无误后可填入 Pintia。', 'success');
  } catch (error) {
    setCodingStatus(`生成失败：${error.message || error}`, 'error');
  } finally {
    setBusy('generateCode', false, '生成中…', '生成代码');
  }
}

async function fillCoding() {
  const code = $('generatedCode').value;
  if (!code.trim()) {
    setCodingStatus('代码框为空，请先生成或粘贴代码。', 'warning');
    return;
  }
  try {
    await getActivePintiaTab();
    setBusy('fillCoding', true, '正在填入…', '填入编辑器');
    const result = await sendToPage({ type: 'fill-coding', code });
    if (!result?.ok) throw new Error(result?.reason || '找不到 Pintia 代码编辑器。');
    setCodingStatus(`已将 ${result.length} 个字符填入 Pintia 编辑器。请在页面中检查后手动提交。`, 'success');
    setTimeout(() => readSnapshot({ quiet: true }).catch(() => {}), 500);
  } catch (error) {
    setCodingStatus(`填入失败：${error.message || error}`, 'error');
  } finally {
    setBusy('fillCoding', false, '正在填入…', '填入编辑器');
    $('fillCoding').disabled = !$('generatedCode').value.trim();
  }
}

async function exportSnapshot() {
  try {
    const payload = await readSnapshot({ quiet: true });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'pintia-diagnostic.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {}
}

function init() {
  $('refresh').addEventListener('click', () => readSnapshot());
  $('startAssist').addEventListener('click', startAssist);
  $('pause').addEventListener('click', () => pageCommand('pause-toggle'));
  $('stop').addEventListener('click', () => pageCommand('stop'));
  $('saveNext').addEventListener('click', saveNext);
  $('mode').addEventListener('change', event => {
    const assist = event.target.value === 'assist';
    updateAssistControls();
    $('navigationHint').textContent = assist
      ? '模式 B：点击“保存当前题型并切换”后才会执行保存和导航。'
      : '模式 A：只读取和显示页面信息，不执行保存或导航。';
  });
  $('generateCode').addEventListener('click', generateCode);
  $('fillCoding').addEventListener('click', fillCoding);
  $('generateAnswers').addEventListener('click', generateAnswers);
  $('fillAnswers').addEventListener('click', fillAnswers);
  $('generatedCode').addEventListener('input', () => {
    $('fillCoding').disabled = !$('generatedCode').value.trim();
  });
  $('generatedAnswers').addEventListener('input', () => {
    $('fillAnswers').disabled = !$('generatedAnswers').value.trim();
    updateAssistControls();
  });
  $('export').addEventListener('click', exportSnapshot);
  updateAssistControls();
  // 打开侧栏时只读取页面，不自动消耗 API；点击“读取当前题目”时才自动生成答案。
  readSnapshot({ quiet: true }).catch(() => {});
}

init();
