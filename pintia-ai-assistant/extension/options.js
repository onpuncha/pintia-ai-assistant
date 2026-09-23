const ids = ['apiBaseUrl','model','autoSaveAndNavigate','overwriteExisting'];
const $ = (id) => document.getElementById(id);
chrome.runtime.sendMessage({type:'get-config'}, (cfg) => ids.forEach(id => { if (cfg && $(id)) $(id).type === 'checkbox' ? $(id).checked = !!cfg[id] : $(id).value = cfg[id] ?? $(id).value; }));
$("save").onclick = () => { const config = {}; ids.forEach(id => config[id] = $(id).type === 'checkbox' ? $(id).checked : $(id).value); chrome.runtime.sendMessage({type:'save-config',config}, () => $("status").textContent = '设置已保存。'); };
$("health").onclick = () => chrome.runtime.sendMessage({type:'server-health',baseUrl:$("apiBaseUrl").value}, r => $("status").textContent = r?.ok ? '本地服务正常。' : `连接失败：${r?.error || '未知错误'}`);
