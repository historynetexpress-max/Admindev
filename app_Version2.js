// Frontend app.js — communicates with backend /api/chat (streaming) and /api/chat-sync.
// Replaces previous simulateModelResponse with real network calls.

const MODELS = [
  { id: 'chatgpt', name: 'ChatGPT', desc: 'OpenAI GPT-based assistant (streaming)' },
  { id: 'gemini', name: 'Gemini', desc: 'Google Gemini (via Generative API)' , providerId: 'googleai'},
  { id: 'copilot', name: 'Copilot', desc: 'Copilot-like (placeholder)' },
  { id: 'grok', name: 'Grok', desc: 'Grok (placeholder)' },
  { id: 'perplexity', name: 'Perplexity', desc: 'Perplexity (placeholder)' },
  { id: 'deepseek', name: 'DeepSeek', desc: 'DeepSeek (placeholder)' },
  { id: 'kimi', name: 'Kimi', desc: 'Kimi (placeholder)' },
  { id: 'googleai', name: 'Google AI Studio', desc: 'Google Generative API' },
];

let activeTop = 'all';
let selectedModels = new Set(['chatgpt']);
let multiMode = false;

const topBar = document.getElementById('topBar');
const floatingBar = document.getElementById('floatingBar');
const chatEl = document.getElementById('chat');
const modeSelect = document.getElementById('modeSelect');
const composer = document.getElementById('composer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const multiSendToggle = document.getElementById('multiSendToggle');

const topPills = [
  { id: 'all', label: 'All' },
  { id: 'conversational', label: 'Conversational' },
  { id: 'coding', label: 'Coding' },
  { id: 'search', label: 'Search' },
  { id: 'experimental', label: 'Experimental' },
];

function renderTopBar() {
  topBar.innerHTML = '';
  topPills.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'pill' + (p.id === activeTop ? ' active' : '');
    btn.textContent = p.label;
    btn.onclick = () => {
      activeTop = p.id;
      renderTopBar();
    };
    topBar.appendChild(btn);
  });
}

function renderFloatingBar() {
  floatingBar.innerHTML = '';
  MODELS.forEach(m => {
    const card = document.createElement('div');
    card.className = 'card';
    const h = document.createElement('h4'); h.textContent = m.name;
    const p = document.createElement('p'); p.textContent = m.desc;
    const controls = document.createElement('div'); controls.className = 'controls';

    const selectBtn = document.createElement('button');
    selectBtn.className = selectedModels.has(m.id) ? 'selected' : 'select';
    selectBtn.textContent = selectedModels.has(m.id) ? 'Selected' : 'Select';
    selectBtn.onclick = () => {
      if (selectedModels.has(m.id)) selectedModels.delete(m.id);
      else selectedModels.add(m.id);
      syncSelectToUI();
      renderFloatingBar();
    };

    const demoBtn = document.createElement('button');
    demoBtn.className = 'select';
    demoBtn.textContent = 'Preview';
    demoBtn.onclick = () => {
      addSystemMessage(`Preview from ${m.name}`, `यह ${m.name} का preview उत्तर है। (Demo)`);
    };

    controls.appendChild(selectBtn);
    controls.appendChild(demoBtn);

    card.appendChild(h);
    card.appendChild(p);
    card.appendChild(controls);

    floatingBar.appendChild(card);
  });

  // fill single-select dropdown
  modeSelect.innerHTML = '';
  MODELS.forEach(m=>{
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    modeSelect.appendChild(opt);
  });
  const firstSel = [...selectedModels][0] || MODELS[0].id;
  modeSelect.value = firstSel;
}

function syncSelectToUI(){
  multiMode = multiMode && selectedModels.size > 1 ? true : multiMode;
  multiSendToggle.classList.toggle('active', multiMode);
}

function addUserMessage(text){
  const msg = document.createElement('div');
  msg.className = 'msg user';
  msg.textContent = text;
  chatEl.appendChild(msg);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addBotMessageContainer(modelId){
  const modelName = (MODELS.find(m=>m.id===modelId)||{name:modelId}).name;
  const wrapper = document.createElement('div');
  wrapper.className = 'msg bot';
  const meta = document.createElement('div'); meta.className='meta';
  meta.textContent = `${modelName} • ${new Date().toLocaleTimeString()}`;
  const body = document.createElement('div'); body.className='body';
  wrapper.appendChild(meta);
  wrapper.appendChild(body);
  chatEl.appendChild(wrapper);
  chatEl.scrollTop = chatEl.scrollHeight;
  return body;
}

function addSystemMessage(title, text){
  const wrapper = document.createElement('div');
  wrapper.className = 'msg bot';
  const meta = document.createElement('div'); meta.className='meta';
  meta.textContent = `System • ${new Date().toLocaleTimeString()}`;
  const h = document.createElement('div'); h.style.fontWeight='700'; h.textContent = title;
  const body = document.createElement('div'); body.textContent = text;
  wrapper.appendChild(meta);
  wrapper.appendChild(h);
  wrapper.appendChild(body);
  chatEl.appendChild(wrapper);
  chatEl.scrollTop = chatEl.scrollHeight;
}

/**
 * Request streaming response from backend for a model and append to bodyEl as chunks arrive.
 * Backend responds with plain chunked text (no SSE envelope) for easier handling.
 */
async function requestModelStream(modelId, userText, bodyEl) {
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId, prompt: userText })
    });

    if (!resp.ok) {
      const err = await resp.text().catch(()=>`HTTP ${resp.status}`);
      bodyEl.textContent += `\n\n[Error: ${err}]`;
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    while (!done) {
      const { value, done: doneReading } = await reader.read();
      if (value) {
        const chunk = decoder.decode(value);
        bodyEl.textContent += chunk;
        chatEl.scrollTop = chatEl.scrollHeight;
      }
      done = doneReading;
    }
  } catch (err) {
    bodyEl.textContent += `\n\n[Stream error: ${err.message}]`;
  }
}

/**
 * Called on form submit: determines targets (single or multi) and requests streaming.
 */
composer.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  addUserMessage(text);
  messageInput.value = '';

  if (multiMode && selectedModels.size > 0) {
    // For each selected model, create a container then start streaming in parallel
    const tasks = [...selectedModels].map(mid => {
      const b = addBotMessageContainer(mid);
      return requestModelStream(mid, text, b);
    });
    await Promise.all(tasks);
  } else {
    // single model from dropdown
    const mid = modeSelect.value || [...selectedModels][0] || MODELS[0].id;
    const b = addBotMessageContainer(mid);
    await requestModelStream(mid, text, b);
  }
});

// Multi toggle
multiSendToggle.addEventListener('click', () => {
  multiMode = !multiMode;
  multiSendToggle.classList.toggle('active', multiMode);
  multiSendToggle.textContent = multiMode ? 'Multi ✓' : 'Multi';
});

// Enter to send (Shift+Enter newline)
messageInput.addEventListener('keydown', (e)=>{
  if (e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    sendBtn.click();
  }
});

// Scroll buttons
document.querySelectorAll('.scroll-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const targetId = btn.dataset.target;
    const el = document.getElementById(targetId);
    if (!el) return;
    const amount = el.clientWidth * 0.6;
    if (btn.classList.contains('left')) el.scrollBy({left:-amount, behavior:'smooth'});
    else el.scrollBy({left:amount, behavior:'smooth'});
  });
});

// nice drag-to-scroll UX
function makeDragScrollable(container){
  let isDown=false, startX, scrollLeft;
  container.addEventListener('mousedown', (e)=>{
    isDown=true;
    container.classList.add('active');
    startX = e.pageX - container.offsetLeft;
    scrollLeft = container.scrollLeft;
    e.preventDefault();
  });
  window.addEventListener('mouseup', ()=>{isDown=false; container.classList.remove('active')});
  container.addEventListener('mousemove', (e)=>{
    if(!isDown) return;
    const x = e.pageX - container.offsetLeft;
    const walk = (x - startX) * 1;
    container.scrollLeft = scrollLeft - walk;
  });
}

function init(){
  renderTopBar();
  renderFloatingBar();
  syncSelectToUI();
  addSystemMessage('Welcome', 'Backend-enabled demo — संदेश भेजने पर यह सर्वर को कॉल करेगा। OpenAI streaming और Google Generative APIs को configure करें।');
  makeDragScrollable(document.getElementById('floatingBar'));
  makeDragScrollable(document.getElementById('topBar'));
}
init();