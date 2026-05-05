const socket = io();

const urlParams = new URLSearchParams(window.location.search);
const currentRoomCode = urlParams.get('room');
let playerName = localStorage.getItem('playerName');
let myRole = 'player'; // admin, player, screen
let timerInterval;

// --- ТЕМА ---
const themeToggleBtn = document.getElementById('theme-toggle');
let currentTheme = localStorage.getItem('theme') || 'light'; 
document.documentElement.setAttribute('data-theme', currentTheme);

function updateThemeBtn() { themeToggleBtn.innerHTML = currentTheme === 'dark' ? '🌞 УВІМКНУТИ СВІТЛУ' : '🌙 УВІМКНУТИ ТЕМНУ'; }
updateThemeBtn();
themeToggleBtn.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('theme', currentTheme);
    updateThemeBtn();
});

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function init() {
    if (!playerName) showScreen('login-screen');
    else if (currentRoomCode) joinRoom(currentRoomCode);
    else { document.getElementById('display-name').innerText = playerName; showScreen('dashboard-screen'); }
}

document.getElementById('save-name-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('player-name').value.trim();
    if (nameInput) {
        playerName = nameInput; localStorage.setItem('playerName', playerName);
        if (currentRoomCode) joinRoom(currentRoomCode);
        else { document.getElementById('display-name').innerText = playerName; showScreen('dashboard-screen'); }
    }
});
document.getElementById('logout-btn').addEventListener('click', () => { localStorage.removeItem('playerName'); window.location.href = '/'; });

document.getElementById('join-by-code-btn').addEventListener('click', () => {
    const code = document.getElementById('join-code-input').value.trim().toUpperCase();
    if(code.length === 4) { window.history.pushState({}, '', `/?room=${code}`); joinRoom(code); } 
    else { alert("Код має бути з 4 символів!"); }
});

// --- БІБЛІОТЕКА ---
document.getElementById('open-library-btn').addEventListener('click', () => showScreen('library-screen'));
document.getElementById('close-library-btn').addEventListener('click', () => showScreen('dashboard-screen'));

socket.on('load_saved_quizzes', (quizzes) => {
    const list = document.getElementById('saved-quizzes-list');
    list.innerHTML = '';
    if (quizzes.length === 0) { list.innerHTML = '<h3 class="black-text" style="text-align:center; padding: 2rem;">Поки пусто... Створи першу гру!</h3>'; return; }
    quizzes.forEach(q => {
        const btn = document.createElement('button');
        btn.className = 'interactive-card color-yellow';
        btn.innerHTML = `<div class="window-bar"><span class="bar-title">quiz_${q.id.slice(-4)}.exe</span></div><div class="card-content" style="padding: 2rem;"><span class="card-title">${q.title}</span><span class="card-desc">Питань: ${q.questions.length}</span></div>`;
        btn.onclick = () => socket.emit('start_saved_game', q.id);
        list.appendChild(btn);
    });
});

// --- РЕДАКТОР & ШІ ---
document.getElementById('create-game-btn').addEventListener('click', () => { showScreen('editor-screen'); document.getElementById('questions-container').innerHTML = ''; document.getElementById('quiz-title').value = ''; addQuestionBlock(); });
document.getElementById('cancel-editor-btn').addEventListener('click', () => showScreen('dashboard-screen'));

document.getElementById('open-ai-btn').addEventListener('click', () => {
    showScreen('ai-gen-screen');
    document.getElementById('ai-topic').value = document.getElementById('quiz-title').value.trim();
    document.getElementById('start-ai-btn').style.display = 'block'; document.getElementById('ai-loading').style.display = 'none';
});
document.getElementById('cancel-ai-btn').addEventListener('click', () => showScreen('editor-screen'));
document.getElementById('start-ai-btn').addEventListener('click', () => {
    const topic = document.getElementById('ai-topic').value.trim(); const difficulty = document.getElementById('ai-difficulty').value; const count = parseInt(document.getElementById('ai-count').value);
    if (!topic) return alert("Введи тему!");
    document.getElementById('start-ai-btn').style.display = 'none'; document.getElementById('ai-loading').style.display = 'block';
    socket.emit('generate_ai_quiz', { topic, difficulty, count });
});
socket.on('ai_quiz_success', (quizId) => socket.emit('start_saved_game', quizId));
socket.on('ai_error', (msg) => { alert(msg); document.getElementById('start-ai-btn').style.display = 'block'; document.getElementById('ai-loading').style.display = 'none'; });

const questionsContainer = document.getElementById('questions-container');
function addQuestionBlock() {
    const questionCount = questionsContainer.children.length + 1;
    const qDiv = document.createElement('div'); qDiv.className = 'question-block';
    qDiv.innerHTML = `<div class="q-header"><h3 class="black-text">ПИТАННЯ ${questionCount}</h3><button class="neo-btn color-red small-btn delete-q-btn">✖ ВИДАЛИТИ</button></div><input type="text" class="neo-input q-title" placeholder="ТЕКСТ ПИТАННЯ..." style="margin-bottom: 1.5rem;"><div class="options-editor"><div class="option-row"><input type="radio" name="correct-${questionCount}" value="0" checked><input type="text" class="q-option" placeholder="Варіант 1"></div><div class="option-row"><input type="radio" name="correct-${questionCount}" value="1"><input type="text" class="q-option" placeholder="Варіант 2"></div><div class="option-row"><input type="radio" name="correct-${questionCount}" value="2"><input type="text" class="q-option" placeholder="Варіант 3"></div><div class="option-row"><input type="radio" name="correct-${questionCount}" value="3"><input type="text" class="q-option" placeholder="Варіант 4"></div></div>`;
    qDiv.querySelector('.delete-q-btn').addEventListener('click', () => { qDiv.remove(); Array.from(questionsContainer.children).forEach((block, index) => { block.querySelector('h3').innerText = `ПИТАННЯ ${index + 1}`; block.querySelectorAll('input[type="radio"]').forEach(radio => radio.name = `correct-${index + 1}`); }); });
    questionsContainer.appendChild(qDiv);
}
document.getElementById('add-question-btn').addEventListener('click', addQuestionBlock);

document.getElementById('save-start-btn').addEventListener('click', () => {
    const title = document.getElementById('quiz-title').value.trim() || 'Без назви';
    const questionBlocks = document.querySelectorAll('.question-block');
    const quizData = { title: title, questions: [] }; let isValid = true;
    questionBlocks.forEach(block => {
        const qTitle = block.querySelector('.q-title').value.trim(); const options = Array.from(block.querySelectorAll('.q-option')).map(opt => opt.value.trim()); const correctRadio = block.querySelector('input[type="radio"]:checked');
        if (!qTitle || options.some(opt => opt === '')) isValid = false;
        quizData.questions.push({ title: qTitle, options: options, correct: parseInt(correctRadio.value) });
    });
    if (!isValid) return alert("Заповніть усі поля!"); if (quizData.questions.length === 0) return alert("Додайте питання!");
    socket.emit('create_room', quizData);
});

// --- ЛОБІ ТА РОЛІ ---
socket.on('room_created', (roomCode) => { window.history.pushState({}, '', `/?room=${roomCode}`); joinRoom(roomCode); });
function joinRoom(code) { document.getElementById('room-code-display').innerText = code; showScreen('room-screen'); socket.emit('join_room', { roomCode: code, playerName: playerName }); }

function updateUIForRole() {
    if (myRole === 'screen') document.body.classList.add('tv-mode');
    else document.body.classList.remove('tv-mode');

    if (myRole === 'admin' || myRole === 'screen') {
        document.getElementById('player-score-display').style.display = 'none';
        document.getElementById('mini-leaderboard').style.display = 'flex';
    } else {
        document.getElementById('player-score-display').style.display = 'inline-block';
        document.getElementById('mini-leaderboard').style.display = 'none';
    }
}

socket.on('joined_successfully', (data) => {
    myRole = data.role; 
    updateUIForRole();

    const startBtn = document.getElementById('start-game-btn');
    const statusText = document.getElementById('room-status-text');
    if (myRole === 'admin') {
        startBtn.style.display = 'inline-block';
        statusText.innerText = "ВИ АДМІН. РОЗДАЙТЕ РОЛІ ТА ЗАПУСКАЙТЕ!";
    } else if (myRole === 'screen') {
        startBtn.style.display = 'none';
        statusText.innerText = "ВИ - ГОЛОВНИЙ ЕКРАН 🖥️";
    } else {
        startBtn.style.display = 'none';
        statusText.innerText = "Очікуємо запуску від Адміна...";
    }
});

socket.on('role_changed', (newRole) => {
    myRole = newRole;
    updateUIForRole();
    if (myRole === 'screen') { document.getElementById('room-status-text').innerText = "ТЕПЕР ВИ - ГОЛОВНИЙ ЕКРАН 🖥️"; }
});

document.getElementById('leave-room-btn').addEventListener('click', () => { document.body.classList.remove('tv-mode'); window.location.href = '/'; });

socket.on('update_players', (players) => {
    const list = document.getElementById('players-list');
    const realPlayers = players.filter(p => p.role === 'player'); 
    document.getElementById('players-count').innerText = realPlayers.length;
    list.innerHTML = '';
    
    const hasScreen = players.some(p => p.role === 'screen');

    // ОНОВЛЕННЯ 1: Якщо є екран, гравці отримують режим джойстика
    if (hasScreen && myRole === 'player') {
        document.body.classList.add('controller-mode');
    } else {
        document.body.classList.remove('controller-mode');
    }

    const miniBoard = document.getElementById('mini-leaderboard');
    if (myRole === 'admin' || myRole === 'screen') {
        miniBoard.innerHTML = '';
        const top3 = [...realPlayers].sort((a, b) => b.score - a.score).slice(0, 3);
        const colors = ['gold', 'silver', 'bronze'];
        top3.forEach((p, idx) => {
            if (p.score > 0) { 
                miniBoard.innerHTML += `<div class="mini-player ${colors[idx]}">${idx+1}. ${p.name}: ${p.score}</div>`;
            }
        });
    }

    players.sort((a, b) => {
        if(a.role !== 'player' && b.role === 'player') return -1;
        if(a.role === 'player' && b.role !== 'player') return 1;
        return b.score - a.score;
    });

    players.forEach(player => {
        const li = document.createElement('li');
        li.className = 'player-item black-text';
        
        let roleBadge = '';
        if(player.role === 'admin') roleBadge = '<span class="role-badge">АДМІН</span>';
        if(player.role === 'screen') roleBadge = '<span class="role-badge">ЕКРАН 🖥️</span>';

        let adminAction = '';
        if(myRole === 'admin' && player.role === 'player' && !hasScreen) {
            adminAction = `<button class="neo-btn small-btn" style="padding: 0.3rem 0.6rem; font-size: 1.5rem;" title="Зробити екраном" onclick="socket.emit('assign_screen', '${player.id}')">📺</button>`;
        }

        li.innerHTML = `<div style="display:flex; align-items:center;">👤 <span class="player-name" style="margin-left:10px;">${player.name}</span> ${roleBadge}</div><div style="display:flex; align-items:center; gap: 15px;">${adminAction}${player.role === 'player' ? `<strong>${player.score} pts</strong>` : ''}</div>`;
        list.appendChild(li);
    });
});

// --- ГРА & ТАЙМЕР ---
document.getElementById('start-game-btn').addEventListener('click', () => socket.emit('start_game'));

document.getElementById('host-lobby-btn').addEventListener('click', () => {
    socket.emit('return_to_lobby');
});

socket.on('go_to_lobby', () => {
    document.getElementById('host-lobby-btn').style.display = 'none';
    showScreen('room-screen');
    if (myRole === 'admin') {
        document.getElementById('start-game-btn').style.display = 'inline-block';
        document.getElementById('room-status-text').innerText = "ВИ АДМІН. МОЖЕТЕ ЗАПУСТИТИ ЗНОВУ!";
    } else if (myRole === 'screen') {
        document.getElementById('room-status-text').innerText = "ВИ - ГОЛОВНИЙ ЕКРАН 🖥️. ГРУ ЗАВЕРШЕНО.";
    } else {
        document.getElementById('room-status-text').innerText = "Гру завершено. Очікуємо нового старту...";
    }
});

socket.on('game_started', () => {
    document.getElementById('game-options').style.display = '';
    document.getElementById('final-leaderboard-area').style.display = 'none';
    document.getElementById('host-lobby-btn').style.display = 'none';
    showScreen('game-screen');
});

socket.on('new_question', (qData) => {
    document.getElementById('question-counter').innerText = `ПИТАННЯ ${qData.index + 1} / ${qData.total}`;
    document.getElementById('question-title').innerText = qData.title;
    
    const optionsGrid = document.getElementById('game-options');
    optionsGrid.innerHTML = '';
    optionsGrid.style.display = ''; 
    document.getElementById('final-leaderboard-area').style.display = 'none'; 
    
    if(myRole !== 'player') { optionsGrid.classList.add('screen-mode'); }
    else { optionsGrid.classList.remove('screen-mode'); }

    qData.options.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.className = `neo-btn option-btn color-${idx}`;
        btn.innerText = opt;
        btn.onclick = () => {
            if(myRole !== 'player') return; 
            socket.emit('submit_answer', idx);
            btn.classList.add('selected'); 
            Array.from(optionsGrid.children).forEach(b => {
                b.disabled = true;
                if(b !== btn) b.classList.add('dimmed'); 
            });
        };
        optionsGrid.appendChild(btn);
    });

    const nextBtn = document.getElementById('host-next-btn');
    if (myRole === 'admin') {
        nextBtn.style.display = 'block'; nextBtn.disabled = true; nextBtn.innerText = "⏳ ЧЕКАЄМО ВІДПОВІДЕЙ...";
    } else {
        nextBtn.style.display = 'none';
    }

    startVisualTimer(qData.duration);
});

socket.on('question_timeout', (correctIndex) => {
    clearInterval(timerInterval);
    document.getElementById('timer-bar').style.width = '0%'; 

    const optionsGrid = document.getElementById('game-options');
    Array.from(optionsGrid.children).forEach((btn, idx) => {
        btn.disabled = true; 
        if(idx === correctIndex) { btn.classList.remove('dimmed'); btn.classList.add('correct-ans'); } 
        else { btn.classList.add('dimmed'); }
    });

    if (myRole === 'admin') {
        const nextBtn = document.getElementById('host-next-btn');
        nextBtn.disabled = false; nextBtn.innerText = "НАСТУПНЕ ПИТАННЯ ➔";
    }
});

function startVisualTimer(duration) {
    const timerBar = document.getElementById('timer-bar');
    let timeLeft = duration; clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        timeLeft -= 50; 
        const percentage = Math.max(0, (timeLeft / duration) * 100);
        timerBar.style.width = `${percentage}%`;
        if (timeLeft <= 0) clearInterval(timerInterval);
    }, 50);
}

document.getElementById('host-next-btn').addEventListener('click', () => socket.emit('next_question'));
socket.on('score_updated', (newScore) => document.getElementById('player-score').innerText = newScore);

socket.on('game_over', (players) => {
    clearInterval(timerInterval);
    document.getElementById('timer-bar').style.width = '0%';
    document.getElementById('host-next-btn').style.display = 'none';
    
    document.getElementById('game-options').style.display = 'none';
    
    // В режимі контролера ми не ховаємо текст "ФІНАЛЬНА ТАБЛИЦЯ", щоб гравець знав, що відбувається
    const qTitle = document.getElementById('question-title');
    qTitle.innerText = "🏆 ФІНАЛЬНА ТАБЛИЦЯ ЛІДЕРІВ 🏆";
    // Якщо телефон в режимі контролера, повертаємо йому блок питання тільки для фіналу
    if (document.body.classList.contains('controller-mode')) {
        document.querySelector('.question-container').style.display = 'block';
    }
    
    const realPlayers = players.filter(p => p.role === 'player').sort((a, b) => b.score - a.score);
    const boardArea = document.getElementById('final-leaderboard-area');
    boardArea.style.display = 'flex';
    
    let boardHTML = '';
    const colors = ['gold', 'silver', 'bronze'];
    
    realPlayers.forEach((p, idx) => {
        const colorClass = idx < 3 ? colors[idx] : '';
        boardHTML += `
            <div class="leaderboard-row ${colorClass}">
                <span>${idx + 1}. ${p.name}</span>
                <span>${p.score} pts</span>
            </div>`;
    });
    
    boardArea.innerHTML = boardHTML;

    if (myRole === 'admin') {
        document.getElementById('host-lobby-btn').style.display = 'block';
    }
});

socket.on('error', (msg) => { alert(msg); window.location.href = '/'; });

// ==========================================
// --- ПАСХАЛКИ ТА ІВЕНТИ (Факти та Опитування) ---
// ==========================================
const eventsContainer = document.getElementById('dynamic-events-container');

// Перевіряємо, чи ми зараз в меню (щоб не спамити під час гри)
function isDashboardActive() { 
    return document.getElementById('dashboard-screen').classList.contains('active'); 
}

// 1. ОПИТУВАННЯ З РЕАКЦІЯМИ
const absurdPolls = [
    { q: "Трава зелена?", a1: {t: "Так", r: "Нудні норміси... 😒"}, a2: {t: "Ні, матриця", r: "Нео, це ти? 🕶️"} },
    { q: "Хто ти?", a1: {t: "Людина", r: "Доведи. 🤖"}, a2: {t: "Кіт за ПК", r: "Мяу! 🐾"} },
    { q: "Що краще?", a1: {t: "Піца 🍕", r: "+100 до щастя!"}, a2: {t: "Сон 🛏️", r: "Мудрий вибір."} },
    { q: "Ця кнопка справжня?", a1: {t: "Звісно", r: "Наївний..."}, a2: {t: "Ілюзія", r: "Ти пізнав дзен 🧘"} }
];

function triggerMiniPoll() {
    if (!isDashboardActive() || document.querySelector('.mini-poll-popup')) return;

    const poll = absurdPolls[Math.floor(Math.random() * absurdPolls.length)];
    const pollDiv = document.createElement('div');
    pollDiv.className = 'mini-poll-popup';
    
    // Спавн зліва або справа, щоб не закривати кнопки по центру
    const isLeft = Math.random() > 0.5;
    pollDiv.style.top = `${Math.floor(Math.random() * 40) + 20}vh`; 
    if (isLeft) pollDiv.style.left = `${Math.floor(Math.random() * 15) + 5}vw`; 
    else pollDiv.style.right = `${Math.floor(Math.random() * 15) + 5}vw`; 

    pollDiv.innerHTML = `<div class="mini-poll-q">${poll.q}</div><div class="mini-poll-options"><button class="poll-btn neo-btn color-white small-btn" data-react="${poll.a1.r}">${poll.a1.t}</button><button class="poll-btn neo-btn color-white small-btn" data-react="${poll.a2.r}">${poll.a2.t}</button></div>`;

    pollDiv.querySelectorAll('button').forEach(btn => {
        btn.onclick = () => {
            const reaction = btn.getAttribute('data-react');
            pollDiv.innerHTML = `<div class="poll-reaction">${reaction}</div>`;
            pollDiv.style.transform = "scale(1.05)";
            setTimeout(() => { pollDiv.style.animation = 'fadeOut 0.3s forwards'; setTimeout(() => pollDiv.remove(), 300); }, 2000);
        };
    });

    document.body.appendChild(pollDiv);
    // Якщо ігнорувати — зникає само через 12 сек
    setTimeout(() => { if(pollDiv.parentElement && !pollDiv.querySelector('.poll-reaction')) { pollDiv.style.animation = 'fadeOut 0.3s forwards'; setTimeout(() => pollDiv.remove(), 300); } }, 12000);
}

// 2. ФАКТИ ВІД МАСКОТА (Робота в кутку)
const mascotPopup = document.getElementById('mascot-popup');
const mascotText = document.getElementById('mascot-text');
const randomFacts = [
    "Пінгвіни мають коліна. Живи з цим.", 
    "Якщо тиснути на всі кнопки дуже швидко, можна зламати гру (не треба).", 
    "Я просто шматок коду, але я вірю в тебе!", 
    "Не забувай кліпати очима. Оп, ти щойно моргнув.",
    "В Інни Василівни є тиця євриків, чесно..."
];

function triggerFact() {
    if (!isDashboardActive()) return; // Вистрибує тільки в меню
    mascotText.innerText = randomFacts[Math.floor(Math.random() * randomFacts.length)]; 
    mascotPopup.classList.add('show'); 
    setTimeout(() => mascotPopup.classList.remove('show'), 6000);
}

// --- ТАЙМЕРИ ---
// Перевіряємо кожні 10-20 сек, чи треба вивести опитування
function schedulePoll() { 
    setTimeout(() => { 
        if (Math.random() < 0.5) triggerMiniPoll(); // 50% шанс
        schedulePoll(); 
    }, Math.random() * 10000 + 10000); 
}

// Перевіряємо кожні 20-30 сек, чи треба показати факт
function scheduleFact() { 
    setTimeout(() => { 
        if (Math.random() < 0.6) triggerFact(); // 60% шанс
        scheduleFact(); 
    }, Math.random() * 10000 + 20000); 
}

// Запускаємо генератори івентів
schedulePoll();
scheduleFact();

init();
