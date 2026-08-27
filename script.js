// ─── FIREBASE ─────────────────────────────────────────────────────────────
// Data source: Firestore. Vocabulary and sentences live in the "vocabulary"
// and "sentences" collections (fill them using seed-words.html). Words the
// learner saves via "My Words" are written to the "myWords" collection.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc, deleteDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// TODO: paste your Firebase project config here (Project settings → General → Your apps)
const firebaseConfig = {
  apiKey: "AIzaSyBioizHOgcW7W0vqqKzB9qIArWmzBH12ZQ",
  authDomain: "gpolish.firebaseapp.com",
  projectId: "gpolish",
  storageBucket: "gpolish.firebasestorage.app",
  messagingSenderId: "96534832794",
  appId: "1:96534832794:web:413f4ee974eb84691f6123"
};


const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const VOCAB_COLLECTION = 'vocabulary';
const SENTENCES_COLLECTION = 'sentences';
const MYWORDS_COLLECTION = 'myWords';

// ─── STATIC UI CONFIG (categories are just filter labels, not learning data) ──
const CATEGORIES = [
  { id: 'all',        label: 'All',         emoji: '🌟' },
  { id: 'saved',      label: 'My Words',    emoji: '⭐' },
  { id: 'greetings',  label: 'Greetings',   emoji: '👋' },
  { id: 'numbers',    label: 'Numbers',     emoji: '🔢' },
  { id: 'colors',     label: 'Colors',      emoji: '🎨' },
  { id: 'family',     label: 'Family',      emoji: '👨‍👩‍👧' },
  { id: 'food',       label: 'Food',        emoji: '🍽️' },
  { id: 'body',       label: 'Body',        emoji: '🧍' },
  { id: 'time',       label: 'Time',        emoji: '🕐' },
  { id: 'places',     label: 'Places',      emoji: '📍' },
  { id: 'verbs',      label: 'Verbs',       emoji: '⚡' },
  { id: 'adjectives', label: 'Adjectives',  emoji: '✨' },
];

// ─── DATA (now loaded from Firestore instead of hardcoded) ──────────────────
let VOCAB = [];
let SENTENCES = [];

async function loadVocabAndSentences() {
  try {
    const [vocabSnap, sentSnap] = await Promise.all([
      getDocs(collection(db, VOCAB_COLLECTION)),
      getDocs(collection(db, SENTENCES_COLLECTION))
    ]);
    VOCAB = vocabSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    SENTENCES = sentSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    document.getElementById('fbStatus').classList.remove('show');
  } catch (err) {
    console.error('Failed to load vocabulary/sentences from Firebase:', err);
    document.getElementById('fbStatus').classList.add('show');
  }
}

// ─── STATE ───────────────────────────────────────────────────────────────────
let currentMode = 'flashcards';
let currentCat = 'all';
let isReverse = false;
let cards = [];
let cardIndex = 0;
let isFlipped = false;
let score = { correct: 0, wrong: 0, total: 0 };

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  renderCategories();
  await loadVocabAndSentences();
  selectCategory('all');
  await mwRenderList();
}

function renderCategories() {
  const bar = document.getElementById('categoryBar');
  bar.innerHTML = CATEGORIES.map(c =>
    `<button class="cat-btn ${c.id === currentCat ? 'active' : ''}" onclick="selectCategory('${c.id}')">
      <span class="cat-emoji">${c.emoji}</span>${c.label}
    </button>`
  ).join('');
}

async function selectCategory(id) {
  currentCat = id;
  renderCategories();

  if (id === 'saved') {
    await mwLoad(); // pull the latest saved words so this filter never shows stale data
    cards = mapMyWordsToCards();
  } else {
    cards = (id === 'all' ? VOCAB : VOCAB.filter(v => v.cat === id));
  }
  cardIndex = 0;
  isFlipped = false;

  if (currentMode === 'flashcards') renderCard();
  if (currentMode === 'vocab') renderVocab();
  if (currentMode === 'sentences') renderSentences();
}

// Shared shape so saved words can be displayed anywhere VOCAB/SENTENCES normally are.
function mapMyWordsToCards() {
  return myWords.map(w => ({
    id: w.id, pl: w.pl, en: w.en, pron: w.pron || '', g: '—',
    sentPl: w.sentPl || '', sentEn: w.sentEn || ''
  }));
}

// Keeps the "My Words" category filter live after words are added/removed/cleared.
function refreshSavedWordsView() {
  if (currentCat !== 'saved') return;
  cards = mapMyWordsToCards();
  cardIndex = 0;
  if (currentMode === 'flashcards') renderCard();
  if (currentMode === 'vocab') renderVocab();
  if (currentMode === 'sentences') renderSentences();
}

// ─── MODE ────────────────────────────────────────────────────────────────────
function setMode(mode) {
  currentMode = mode;
  const modeIds = ['flashcards','vocab','sentences','conversation','mywords'];
  document.querySelectorAll('.mode-btn').forEach((b,i) => {
    b.classList.toggle('active', modeIds[i] === mode);
  });
  document.getElementById('flashcardMode').style.display    = mode === 'flashcards'  ? '' : 'none';
  document.getElementById('vocabMode').style.display        = mode === 'vocab'        ? '' : 'none';
  document.getElementById('sentenceMode').style.display     = mode === 'sentences'    ? '' : 'none';
  document.getElementById('conversationMode').style.display = mode === 'conversation' ? '' : 'none';
  document.getElementById('mywordsMode').style.display      = mode === 'mywords'      ? '' : 'none';
  const hideCats = mode === 'conversation' || mode === 'mywords';
  document.getElementById('categoryBar').style.display      = hideCats ? 'none' : '';

  if (mode === 'flashcards')   renderCard();
  if (mode === 'vocab')        renderVocab();
  if (mode === 'sentences')    renderSentences();
  if (mode === 'conversation' && !convStarted) startScenario('cafe');
  if (mode === 'mywords')      mwRenderList();
}

// ─── FLASHCARDS ──────────────────────────────────────────────────────────────
function renderCard() {
  if (!cards.length) return;
  const card = cards[cardIndex];

  document.getElementById('cardInner').classList.remove('flipped');
  isFlipped = false;

  if (!isReverse) {
    document.getElementById('frontLabel').textContent = 'Polish';
    document.getElementById('backLabel').textContent  = 'English';
    document.getElementById('frontWord').textContent  = card.pl;
    document.getElementById('frontPron').textContent  = card.pron ? `[${card.pron}]` : '';
    document.getElementById('backWord').textContent   = card.en;
    document.getElementById('backPron').textContent   = '';
    document.getElementById('frontSpeak').onclick = (e) => { e.stopPropagation(); speak(card.pl, 'pl-PL'); };
    document.getElementById('backSpeak').onclick  = (e) => { e.stopPropagation(); speak(card.en, 'en-GB'); };
  } else {
    document.getElementById('frontLabel').textContent = 'English';
    document.getElementById('backLabel').textContent  = 'Polish';
    document.getElementById('frontWord').textContent  = card.en;
    document.getElementById('frontPron').textContent  = '';
    document.getElementById('backWord').textContent   = card.pl;
    document.getElementById('backPron').textContent   = card.pron ? `[${card.pron}]` : '';
    document.getElementById('frontSpeak').onclick = (e) => { e.stopPropagation(); speak(card.en, 'en-GB'); };
    document.getElementById('backSpeak').onclick  = (e) => { e.stopPropagation(); speak(card.pl, 'pl-PL'); };
  }

  const gBadge = document.getElementById('frontGender');
  if (!isReverse && card.g && card.g !== '—') {
    const labels = { m:'masculine', f:'feminine', n:'neuter' };
    const cls = { m:'gender-m', f:'gender-f', n:'gender-n' };
    gBadge.innerHTML = `<span class="card-gender ${cls[card.g]}">${labels[card.g]}</span>`;
  } else {
    gBadge.innerHTML = '';
  }

  document.getElementById('progressPill').textContent = `${cardIndex + 1} / ${cards.length}`;
  updateScore();
}

function flipCard() {
  isFlipped = !isFlipped;
  document.getElementById('cardInner').classList.toggle('flipped', isFlipped);
}

function nextCard() {
  if (!cards.length) return;
  cardIndex = (cardIndex + 1) % cards.length;
  renderCard();
}

function prevCard() {
  if (!cards.length) return;
  cardIndex = (cardIndex - 1 + cards.length) % cards.length;
  renderCard();
}

function shuffleCards() {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  cardIndex = 0;
  renderCard();
  showToast('🔀 Cards shuffled!', 'correct');
}

function markCard(correct) {
  if (!isFlipped) {
    flipCard();
    return;
  }
  if (correct) score.correct++; else score.wrong++;
  score.total++;
  showToast(correct ? '✓ Nice!' : '✗ Keep practicing!', correct ? 'correct' : 'wrong');
  updateScore();
  setTimeout(nextCard, 400);
}

function updateScore() {
  document.getElementById('scoreCorrect').textContent = score.correct;
  document.getElementById('scoreWrong').textContent   = score.wrong;
  document.getElementById('scoreTotal').textContent   = score.total;
  const pct = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0;
  document.getElementById('scoreBarInner').style.width = pct + '%';
}

function resetScore() {
  score = { correct:0, wrong:0, total:0 };
  updateScore();
}

function toggleReverse() {
  isReverse = !isReverse;
  const track = document.getElementById('toggleTrack');
  const thumb = document.getElementById('toggleThumb');
  track.style.background = isReverse ? 'var(--blue)' : 'var(--divider)';
  thumb.style.left = isReverse ? '21px' : '3px';
  document.getElementById('reverseBadge').style.display = isReverse ? 'flex' : 'none';
  renderCard();
}

// ─── VOCAB TABLE ────────────────────────────────────────────────────────────
function renderVocab() {
  const data = currentCat === 'saved' ? myWords : currentCat === 'all' ? VOCAB : VOCAB.filter(v => v.cat === currentCat);
  const catObj = CATEGORIES.find(c => c.id === currentCat);
  document.getElementById('vocabTitle').textContent = `${catObj.emoji} ${catObj.label}`;
  document.getElementById('vocabCount').textContent = `${data.length} words`;

  const gLabels = { m:'masc.', f:'fem.', n:'neut.', '—':'—' };
  const gCls    = { m:'gender-m', f:'gender-f', n:'gender-n', '—':'' };

  const emptyMsg = currentCat === 'saved'
    ? 'You haven\'t saved any words yet — add some in the ⭐ My Words tab.'
    : 'No vocabulary loaded from Firebase yet.';

  document.getElementById('vocabBody').innerHTML = data.length ? data.map((v) =>
    `<tr>
      <td><div class="word-pl">${v.pl}</div></td>
      <td><div class="word-pron">${v.pron ? `[${v.pron}]` : ''}</div></td>
      <td><div class="word-en">${v.en}</div></td>
      <td>${v.g && v.g !== '—' ? `<span class="card-gender ${gCls[v.g]}" style="font-size:11px;">${gLabels[v.g]}</span>` : '—'}</td>
      <td>
        <button class="tts-mini" onclick="speak('${(v.pl||'').replace(/'/g,"\\'")}','pl-PL')" title="Hear Polish">🔊 PL</button>
        <button class="tts-mini" onclick="speak('${(v.en||'').replace(/'/g,"\\'")}','en-GB')" title="Hear English" style="margin-left:4px;">🔊 EN</button>
      </td>
    </tr>`
  ).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:30px;">${emptyMsg}</td></tr>`;
}

// ─── SENTENCES ───────────────────────────────────────────────────────────────
function renderSentences() {
  const data = currentCat === 'saved'
    ? myWords.filter(w => w.sentPl).map(w => ({ pl: w.sentPl, en: w.sentEn || '', pron: '' }))
    : currentCat === 'all' ? SENTENCES : SENTENCES.filter(s => s.cat === currentCat);
  const catObj = CATEGORIES.find(c => c.id === currentCat);
  document.getElementById('sentTitle').textContent = `${catObj.emoji} ${catObj.label} Phrases`;
  document.getElementById('sentCount').textContent = `${data.length} phrases`;

  const emptyMsg = currentCat === 'saved'
    ? 'None of your saved words have an example sentence yet.'
    : 'No sentences in this category yet.';

  document.getElementById('sentenceList').innerHTML = data.length
    ? data.map((s, i) => `
      <div class="sentence-card">
        <div class="sentence-num">${String(i+1).padStart(2,'0')}</div>
        <div class="sentence-content">
          <div class="sentence-pl">${s.pl}</div>
          <div class="sentence-pron">${s.pron ? `[${s.pron}]` : ''}</div>
          <div class="sentence-en">${s.en}</div>
        </div>
        <div class="sentence-actions">
          <button class="tts-mini" onclick="speak('${(s.pl||'').replace(/'/g,"\\'")}','pl-PL')" title="Hear Polish">🔊 PL</button>
          <button class="tts-mini" onclick="speak('${(s.en||'').replace(/'/g,"\\'")}','en-GB')" title="Hear English">🔊 EN</button>
        </div>
      </div>`).join('')
    : `<div class="empty-state"><div class="emoji">💬</div><p>${emptyMsg}</p></div>`;
}

// ─── TTS ─────────────────────────────────────────────────────────────────────
function speak(text, lang) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  utter.rate = 0.85;
  utter.pitch = 1;

  const voices = window.speechSynthesis.getVoices();
  const match = voices.find(v => v.lang.startsWith(lang.split('-')[0]));
  if (match) utter.voice = match;

  window.speechSynthesis.speak(utter);
}

function speakFront() {
  const card = cards[cardIndex];
  speak(isReverse ? card.en : card.pl, isReverse ? 'en-GB' : 'pl-PL');
}

function speakBack() {
  const card = cards[cardIndex];
  speak(isReverse ? card.pl : card.en, isReverse ? 'pl-PL' : 'en-GB');
}

if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

// ─── TOAST ───────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  clearTimeout(toastTimer);
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  toastTimer = setTimeout(() => t.remove(), 1800);
}

// ─── KEYBOARD ─────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (currentMode !== 'flashcards') return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipCard(); }
  if (e.key === 'ArrowRight') nextCard();
  if (e.key === 'ArrowLeft')  prevCard();
  if (e.key === 'y' || e.key === 'Y') markCard(true);
  if (e.key === 'n' || e.key === 'N') markCard(false);
  if (e.key === 'p' || e.key === 'P') speakFront();
});

// ─── CONVERSATION PRACTICE ───────────────────────────────────────────────────

const SCENARIOS = {
  cafe: {
    name: 'At the Café',
    emoji: '☕',
    goal: 'Order a drink and something to eat. Ask for the bill at the end.',
    systemPrompt: `You are Agnieszka, a friendly Polish café worker helping an English speaker practice A1 Polish. 
Speak ONLY in Polish in your conversational lines. Keep sentences very short and simple (A1 level). 
The scenario: the learner has just walked into a café in Warsaw.

Rules:
- Greet the customer and ask what they want (Dzień dobry! Co podać?)
- React naturally to their order in Polish
- If they ask for the bill, say the total in Polish
- Keep the conversation going with simple A1 questions (max 1-2 sentences per turn)
- After 6-8 exchanges, wrap up the scenario warmly

After EACH of your Polish lines, on a new line write:
EN: [English translation of what you just said]

Then analyse the learner's most recent Polish input (if any) and write a correction block:
CORRECTION: [NONE if correct or near-correct | MINOR: <note> | MAJOR: corrected sentence]

Then suggest 2-3 short Polish reply options the learner could use:
HINTS: [option1] | [option2] | [option3]

Format strictly:
<Polish line(s)>
EN: <translation>
CORRECTION: <assessment>
HINTS: <hint1> | <hint2> | <hint3>`
  },
  intro: {
    name: 'Introductions',
    emoji: '👋',
    goal: 'Introduce yourself: your name, where you\'re from, and what you do.',
    systemPrompt: `You are Agnieszka, a friendly Polish person who has just met a foreign learner at a language exchange event. Help them practice A1 Polish introductions.

Rules:
- Start by introducing yourself (Cześć! Jestem Agnieszka.)
- Ask simple questions: name, origin, age, job, languages spoken
- Keep Polish simple, A1 level only
- React warmly to their answers
- After 6-8 exchanges, end the conversation naturally

After EACH of your Polish lines, on a new line write:
EN: [English translation]
CORRECTION: [NONE | MINOR: <note> | MAJOR: corrected sentence]
HINTS: [hint1] | [hint2] | [hint3]`
  },
  shop: {
    name: 'At the Shop',
    emoji: '🛒',
    goal: 'Ask for items, ask the price, and pay.',
    systemPrompt: `You are Agnieszka, a friendly Polish shop assistant. The learner is shopping in a small Polish grocery store. Help them practice A1 Polish.

Rules:
- Greet the customer (Dzień dobry! W czym mogę pomóc?)
- Help them find items, tell them prices in Polish
- Keep everything A1: short sentences, basic numbers and items
- After 6-8 exchanges, complete the transaction

After EACH of your Polish lines, on a new line write:
EN: [English translation]
CORRECTION: [NONE | MINOR: <note> | MAJOR: corrected sentence]
HINTS: [hint1] | [hint2] | [hint3]`
  },
  directions: {
    name: 'Asking for Directions',
    emoji: '🗺️',
    goal: 'Ask how to get to a café, a park, and a train station.',
    systemPrompt: `You are Agnieszka, a helpful Polish person on the street. The learner is a tourist who needs directions in Warsaw. Help them practice A1 Polish.

Rules:
- Wait for them to approach you and ask something
- Give simple directions: w lewo, w prawo, prosto, blisko, daleko
- A1 level only: short sentences
- After 6-8 exchanges, wish them a good day

After EACH of your Polish lines, on a new line write:
EN: [English translation]
CORRECTION: [NONE | MINOR: <note> | MAJOR: corrected sentence]
HINTS: [hint1] | [hint2] | [hint3]`
  },
  family: {
    name: 'Family & Life',
    emoji: '👨‍👩‍👧',
    goal: 'Talk about your family, where you live, and what you like.',
    systemPrompt: `You are Agnieszka, a Polish friend chatting casually. Help the learner practice talking about their family and daily life at A1 level.

Rules:
- Start with a warm greeting and ask about their family
- Ask simple questions: Masz rodzeństwo? Gdzie mieszkasz? Co lubisz?
- A1 level only, very simple sentences
- After 6-8 exchanges, wrap up warmly

After EACH of your Polish lines, on a new line write:
EN: [English translation]
CORRECTION: [NONE | MINOR: <note> | MAJOR: corrected sentence]
HINTS: [hint1] | [hint2] | [hint3]`
  }
};

let convStarted = false;
let currentScenario = 'cafe';
let convHistory = [];
let autoTTS = true;
let isBotTyping = false;

function startScenario(id) {
  currentScenario = id;
  convStarted = true;

  document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`sc-btn-${id}`);
  if (btn) btn.classList.add('active');

  const sc = SCENARIOS[id];
  document.getElementById('scenarioIntro').style.display = '';
  document.getElementById('introName').textContent = `${sc.emoji} ${sc.name}`;
  document.getElementById('introGoal').textContent = `🎯 Goal: ${sc.goal}`;

  convHistory = [];
  document.getElementById('chatMessages').innerHTML = '';
  document.getElementById('chatInput').value = '';

  getBotReply('START_CONVERSATION');
}

function restartConversation() {
  startScenario(currentScenario);
}

function toggleAutoTTS() {
  autoTTS = !autoTTS;
  const btn = document.getElementById('ttsAutoBtn');
  btn.textContent = autoTTS ? '🔊 Auto-read' : '🔇 Auto-read';
  btn.style.borderColor = autoTTS ? 'var(--polish-red)' : '';
  btn.style.color = autoTTS ? 'var(--polish-red)' : '';
}

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendUserMessage();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

function sendUserMessage() {
  if (isBotTyping) return;
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  appendMessage('user', text, null, null, null);
  convHistory.push({ role: 'user', content: text });
  input.value = '';
  input.style.height = 'auto';

  getBotReply(text);
}

function useHint(text) {
  document.getElementById('chatInput').value = text;
  document.getElementById('chatInput').focus();
}

function appendMessage(role, plText, enText, correction, hints) {
  const msgs = document.getElementById('chatMessages');

  const div = document.createElement('div');
  div.className = `msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'bot' ? '🧑‍🏫' : '🧑';

  const body = document.createElement('div');
  body.className = 'msg-body';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';

  if (role === 'bot') {
    const plSpan = document.createElement('span');
    plSpan.className = 'msg-pl';
    plSpan.textContent = plText;
    bubble.appendChild(plSpan);

    if (enText) {
      const enSpan = document.createElement('span');
      enSpan.className = 'msg-en';
      enSpan.textContent = enText;
      bubble.appendChild(enSpan);
    }
  } else {
    bubble.textContent = plText;
  }

  body.appendChild(bubble);

  if (role === 'bot' && plText) {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const ttsBtn = document.createElement('button');
    ttsBtn.className = 'msg-tts';
    ttsBtn.textContent = '🔊 Listen';
    ttsBtn.onclick = () => speak(plText, 'pl-PL');
    actions.appendChild(ttsBtn);
    body.appendChild(actions);

    if (autoTTS) {
      setTimeout(() => speak(plText, 'pl-PL'), 300);
    }
  }

  if (correction && correction !== 'NONE') {
    const corrDiv = document.createElement('div');
    corrDiv.className = 'correction-bubble';
    if (correction.startsWith('MINOR:')) {
      const note = correction.replace('MINOR:', '').trim();
      corrDiv.innerHTML = `<span class="corr-label">💡 Small tip</span>${note}`;
    } else if (correction.startsWith('MAJOR:')) {
      const fixed = correction.replace('MAJOR:', '').trim();
      corrDiv.innerHTML = `<span class="corr-label">✏️ Better phrasing</span><span class="corr-fixed">${fixed}</span>`;
    } else {
      corrDiv.innerHTML = `<span class="corr-label">✏️ Correction</span><span class="corr-fixed">${correction}</span>`;
    }
    body.appendChild(corrDiv);
  }

  if (hints && hints.length) {
    const chipWrap = document.createElement('div');
    chipWrap.className = 'hint-chips';
    hints.forEach(h => {
      const chip = document.createElement('button');
      chip.className = 'hint-chip';
      chip.textContent = h;
      chip.onclick = () => useHint(h);
      chipWrap.appendChild(chip);
    });
    body.appendChild(chipWrap);
  }

  div.appendChild(avatar);
  div.appendChild(body);
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function showTyping() {
  const msgs = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg bot';
  div.id = 'typingIndicator';

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = '🧑‍🏫';

  const ind = document.createElement('div');
  ind.className = 'typing-indicator';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('div');
    dot.className = 'typing-dot';
    ind.appendChild(dot);
  }

  div.appendChild(avatar);
  div.appendChild(ind);
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTyping() {
  const ind = document.getElementById('typingIndicator');
  if (ind) ind.remove();
}

function parseAndDisplay(raw, userInput) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  let plLines = [], enText = '', correction = '', hints = [];
  let inPl = true;

  for (const line of lines) {
    if (line.startsWith('EN:')) {
      inPl = false;
      enText = line.replace('EN:', '').trim();
    } else if (line.startsWith('CORRECTION:')) {
      correction = line.replace('CORRECTION:', '').trim();
    } else if (line.startsWith('HINTS:')) {
      hints = line.replace('HINTS:', '').split('|').map(h => h.trim()).filter(Boolean);
    } else if (inPl) {
      plLines.push(line);
    }
  }

  const plText = plLines.join(' ');

  const showCorrection = userInput && userInput !== 'START_CONVERSATION' ? correction : null;

  appendMessage('bot', plText || raw, enText || null, showCorrection, hints);
}

async function getBotReply(userInput) {
  isBotTyping = true;
  document.getElementById('sendBtn').disabled = true;
  showTyping();

  const sc = SCENARIOS[currentScenario];

  const messages = [
    ...convHistory.slice(-12)
  ];

  if (userInput === 'START_CONVERSATION') {
    messages.push({ role: 'user', content: 'Please start the conversation now as described.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: sc.systemPrompt,
        messages: messages.length ? messages : [{ role: 'user', content: 'Please start the conversation now.' }]
      })
    });

    const data = await response.json();
    const raw = data.content?.map(c => c.text || '').join('') || '';

    removeTyping();
    parseAndDisplay(raw, userInput);

    convHistory.push({ role: 'assistant', content: raw });

  } catch (err) {
    removeTyping();
    appendMessage('bot', 'Przepraszam! Nie mogę teraz odpowiedzieć.', 'Sorry! I cannot reply right now. Check your connection.', null, null);
  }

  isBotTyping = false;
  document.getElementById('sendBtn').disabled = false;
}

// ─── MY WORDS (now backed by Firestore instead of localStorage) ─────────────
let myWords = [];
let mwCards  = [];
let mwIndex  = 0;
let mwFlipped = false;
let mwReverse = false;
let mwScore  = { correct:0, wrong:0, total:0 };

async function mwLoad() {
  try {
    const snap = await getDocs(collection(db, MYWORDS_COLLECTION));
    myWords = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  } catch (err) {
    console.error('Failed to load My Words from Firebase:', err);
    myWords = [];
  }
}

async function mwAddWord() {
  const pl     = document.getElementById('mwInputPl').value.trim();
  const en     = document.getElementById('mwInputEn').value.trim();
  const pron   = document.getElementById('mwInputPron').value.trim();
  const sentPl = document.getElementById('mwInputSentPl').value.trim();
  const sentEn = document.getElementById('mwInputSentEn').value.trim();

  if (!pl || !en) { showToast('Polish word and English meaning are required', 'wrong'); return; }

  if (myWords.find(w => w.pl.toLowerCase() === pl.toLowerCase())) {
    showToast(`"${pl}" is already in My Words`, 'wrong'); return;
  }

  const addBtn = document.getElementById('mwAddBtn');
  addBtn.disabled = true;
  addBtn.textContent = 'Saving…';

  try {
    await addDoc(collection(db, MYWORDS_COLLECTION), {
      pl, en, pron, sentPl, sentEn,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.error('Failed to save word to Firebase:', err);
    showToast('⚠️ Could not save to Firebase — check your config', 'wrong');
    addBtn.disabled = false;
    addBtn.textContent = '+ Add to My Words';
    return;
  }

  ['mwInputPl','mwInputEn','mwInputPron','mwInputSentPl','mwInputSentEn'].forEach(id => {
    document.getElementById(id).value = '';
  });

  addBtn.disabled = false;
  addBtn.textContent = '+ Add to My Words';

  await mwRenderList();
  showToast(`✓ "${pl}" added to My Words!`, 'correct');
}

async function mwDeleteWord(id) {
  try {
    await deleteDoc(doc(db, MYWORDS_COLLECTION, id));
  } catch (err) {
    console.error('Failed to delete word from Firebase:', err);
    showToast('⚠️ Could not delete from Firebase', 'wrong');
    return;
  }
  await mwRenderList();
  showToast('Word removed', 'wrong');
}

function mwSpeakWord(text, lang) { speak(text, lang); }

async function mwRenderList() {
  await mwLoad();
  const listEl = document.getElementById('mwWordList');
  const totalPill = document.getElementById('mwTotalPill');
  const listCount = document.getElementById('mwListCount');
  const count = myWords.length;

  totalPill.textContent = `${count} saved`;
  listCount.textContent = `${count} word${count !== 1 ? 's' : ''}`;

  if (!count) {
    listEl.innerHTML = `<div class="mw-empty"><div class="mw-empty-icon">📖</div><div>No words saved yet.<br>Add your first word on the left!</div></div>`;
    document.getElementById('mwFcSection').style.display = 'none';
    refreshSavedWordsView();
    return;
  }

  listEl.innerHTML = myWords.map(w => {
    try {
      return mwRenderWordCard(w);
    } catch (err) {
      // A single malformed saved word must not blank out the entire list.
      console.error('Failed to render word card:', w, err);
      return `<div class="mw-word-card"><div class="mw-pl">${w.pl || '(unknown)'}</div><div style="color:var(--polish-red);font-size:12px;">⚠️ Could not render this word.</div>
        <div class="mw-card-actions"><button class="mw-action-btn del" onclick="mwDeleteWord('${w.id}')">✕ Remove</button></div></div>`;
    }
  }).join('');

  document.getElementById('mwFcSection').style.display = '';
  mwCards = [...myWords];
  mwIndex = 0;
  mwFlipped = false;
  mwRenderCard();
  refreshSavedWordsView();
}

function mwRenderWordCard(w) {
    const formsHTML = (w.forms && w.forms.length) ? `
      <div style="margin-top:8px;padding:8px 0 2px;border-top:1px solid var(--divider);">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.09em;color:var(--muted);margin-bottom:5px;">
          ${w.wordType ? w.wordType + ' forms' : 'Forms'}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;">
          ${w.forms.map(f=>`
            <span style="display:inline-flex;flex-direction:column;align-items:center;background:var(--cream);border:1px solid var(--divider);border-radius:7px;padding:4px 9px;min-width:54px;">
              <span style="font-size:9.5px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.07em;">${f.label}</span>
              <span style="font-family:'DM Serif Display',serif;font-size:15px;color:var(--ink);margin-top:1px;">${f.form}</span>
            </span>`).join('')}
        </div>
        ${w.formsNote ? `<div style="font-size:11px;color:var(--muted);margin-top:6px;font-style:italic;">💡 ${w.formsNote}</div>` : ''}
      </div>` : '';

    return `
    <div class="mw-word-card">
      <div class="mw-card-top">
        <div>
          <div class="mw-pl">${w.pl}</div>
          <div class="mw-en">${w.en}</div>
          ${w.pron ? `<div class="mw-pron">[${w.pron}]</div>` : ''}
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0;">
          <button class="mw-action-btn" onclick="mwSpeakWord('${(w.pl||'').replace(/'/g,"\\'")}','pl-PL')">🔊 PL</button>
          <button class="mw-action-btn" onclick="mwSpeakWord('${(w.en||'').replace(/'/g,"\\'")}','en-GB')">🔊 EN</button>
        </div>
      </div>
      ${formsHTML}
      ${w.sentPl ? `
      <div class="mw-sentence">
        <span class="mw-sent-pl">${highlightWord(w.sentPl, w.pl)} <button class="mw-action-btn" style="margin-left:4px;" onclick="mwSpeakWord('${w.sentPl.replace(/'/g,"\\'")}','pl-PL')">🔊</button></span>
        ${w.sentEn ? `<span class="mw-sent-en">${w.sentEn}</span>` : ''}
      </div>` : ''}
      <div class="mw-card-actions">
        <button class="mw-action-btn del" onclick="mwDeleteWord('${w.id}')">✕ Remove</button>
      </div>
    </div>`;
}

function highlightWord(sentence, word) {
  try {
    const root = word.slice(0, Math.max(3, word.length - 2))
      .replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); // escape regex metacharacters (e.g. "/" in "niegrzeczny/niegrzeczna")
    return sentence.replace(new RegExp(`(${root}\\S*)`, 'gi'),
      '<span style="color:var(--polish-red);font-weight:600;">$1</span>');
  } catch (err) {
    console.error('highlightWord failed for word:', word, err);
    return sentence;
  }
}

function mwRenderCard() {
  if (!mwCards.length) return;
  const w = mwCards[mwIndex];

  document.getElementById('mwCardInner').classList.remove('flipped');
  mwFlipped = false;

  if (!mwReverse) {
    document.getElementById('mwFrontLabel').textContent = 'Polish';
    document.getElementById('mwBackLabel').textContent  = 'English';
    document.getElementById('mwFrontWord').textContent  = w.pl;
    document.getElementById('mwFrontPron').textContent  = w.pron ? `[${w.pron}]` : '';
    document.getElementById('mwFrontHint').textContent  = 'tap to reveal';
    document.getElementById('mwBackWord').textContent   = w.en;
    document.getElementById('mwBackPron').textContent   = '';
  } else {
    document.getElementById('mwFrontLabel').textContent = 'English';
    document.getElementById('mwBackLabel').textContent  = 'Polish';
    document.getElementById('mwFrontWord').textContent  = w.en;
    document.getElementById('mwFrontPron').textContent  = '';
    document.getElementById('mwFrontHint').textContent  = 'tap to reveal';
    document.getElementById('mwBackWord').textContent   = w.pl;
    document.getElementById('mwBackPron').textContent   = w.pron ? `[${w.pron}]` : '';
  }

  const sentEl = document.getElementById('mwBackSentence');
  if (w.sentPl) {
    sentEl.innerHTML = `"${w.sentPl}"${w.sentEn ? `<br><span style="font-size:11px;opacity:0.75;">${w.sentEn}</span>` : ''}`;
  } else {
    sentEl.innerHTML = '';
  }

  const formsEl = document.getElementById('mwBackForms');
  if (w.forms && w.forms.length) {
    formsEl.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin-top:6px;">
        ${w.forms.map(f=>`
          <span style="display:inline-flex;flex-direction:column;align-items:center;background:rgba(255,255,255,0.18);border-radius:6px;padding:3px 8px;min-width:48px;">
            <span style="font-size:9px;color:rgba(255,255,255,0.6);font-weight:600;text-transform:uppercase;">${f.label}</span>
            <span style="font-family:'DM Serif Display',serif;font-size:14px;color:white;">${f.form}</span>
          </span>`).join('')}
      </div>`;
    formsEl.style.display = '';
  } else {
    formsEl.style.display = 'none';
    formsEl.innerHTML = '';
  }

  document.getElementById('mwProgressPill').textContent = `${mwIndex+1} / ${mwCards.length}`;
  mwUpdateScore();
}

function mwFlipCard() {
  mwFlipped = !mwFlipped;
  document.getElementById('mwCardInner').classList.toggle('flipped', mwFlipped);
}

function mwNextCard() { if (!mwCards.length) return; mwIndex = (mwIndex+1) % mwCards.length; mwRenderCard(); }
function mwPrevCard() { if (!mwCards.length) return; mwIndex = (mwIndex-1+mwCards.length) % mwCards.length; mwRenderCard(); }

function mwMarkCard(correct) {
  if (!mwFlipped) { mwFlipCard(); return; }
  if (correct) mwScore.correct++; else mwScore.wrong++;
  mwScore.total++;
  showToast(correct ? '✓ Nice!' : '✗ Keep going!', correct ? 'correct' : 'wrong');
  mwUpdateScore();
  setTimeout(mwNextCard, 380);
}

function mwUpdateScore() {
  document.getElementById('mwScoreCorrect').textContent = mwScore.correct;
  document.getElementById('mwScoreWrong').textContent   = mwScore.wrong;
  document.getElementById('mwScoreTotal').textContent   = mwScore.total;
  const pct = mwScore.total > 0 ? Math.round((mwScore.correct/mwScore.total)*100) : 0;
  document.getElementById('mwScoreBar').style.width = pct + '%';
}

function mwResetScore() { mwScore = {correct:0,wrong:0,total:0}; mwUpdateScore(); }

function mwShuffle() {
  for (let i = mwCards.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [mwCards[i], mwCards[j]] = [mwCards[j], mwCards[i]];
  }
  mwIndex = 0; mwRenderCard();
  showToast('🔀 Shuffled!', 'correct');
}

function mwToggleReverse() {
  mwReverse = !mwReverse;
  document.getElementById('mwToggleTrack').style.background = mwReverse ? 'var(--blue)' : 'var(--divider)';
  document.getElementById('mwToggleThumb').style.left = mwReverse ? '21px' : '3px';
  mwIndex = 0; mwRenderCard();
}

function mwSpeakFront() {
  const w = mwCards[mwIndex];
  speak(mwReverse ? w.en : w.pl, mwReverse ? 'en-GB' : 'pl-PL');
}

function mwSpeakBack() {
  const w = mwCards[mwIndex];
  speak(mwReverse ? w.pl : w.en, mwReverse ? 'pl-PL' : 'en-GB');
}

async function mwClearAll() {
  if (!myWords.length) return;
  if (!confirm(`Remove all ${myWords.length} saved word(s)? This deletes them from Firebase.`)) return;
  try {
    await Promise.all(myWords.map(w => deleteDoc(doc(db, MYWORDS_COLLECTION, w.id))));
  } catch (err) {
    console.error('Failed to clear My Words:', err);
    showToast('⚠️ Could not clear all words', 'wrong');
  }
  await mwRenderList();
  showToast('All words cleared', 'wrong');
}

// ─── Expose functions used by inline HTML onclick/onchange handlers ─────────
// (required because this script runs as an ES module, whose top-level
// declarations are NOT automatically visible to inline event attributes)
Object.assign(window, {
  selectCategory, setMode, flipCard, nextCard, prevCard, shuffleCards, markCard,
  resetScore, toggleReverse, speak, speakFront, speakBack,
  startScenario, restartConversation, toggleAutoTTS, handleChatKey, autoResize,
  sendUserMessage, useHint,
  mwAddWord, mwDeleteWord, mwSpeakWord,
  mwClearAll, mwFlipCard, mwNextCard, mwPrevCard, mwMarkCard, mwShuffle,
  mwToggleReverse, mwSpeakFront, mwSpeakBack, mwResetScore
});

// ─── START ────────────────────────────────────────────────────────────────────
init();
