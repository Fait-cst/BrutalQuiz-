const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI("AIzaSyC1qNalIdf4najpYRtW3OIxocDH6qsRP1Y");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};
const DB_FILE = path.join(__dirname, 'quizzes.json');
let savedQuizzes = [];

try {
    if (fs.existsSync(DB_FILE)) { savedQuizzes = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
} catch (e) { console.error("Помилка читання quizzes.json", e); }

function saveQuizzesToDisk() { fs.writeFileSync(DB_FILE, JSON.stringify(savedQuizzes, null, 2)); }

io.on('connection', (socket) => {
    socket.emit('load_saved_quizzes', savedQuizzes);

    socket.on('generate_ai_quiz', async ({ topic, difficulty, count, timeLimit }) => {
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
            const prompt = `Створи вікторину на тему "${topic}". Складність: ${difficulty}. Кількість питань: ${count}. Ти ПОВИНЕН повернути ТІЛЬКИ валідний JSON без додаткового тексту і без маркдауну. Формат строго: {"title": "Назва", "questions": [{"title": "Питання?", "options": ["Вар1", "Вар2", "Вар3", "Вар4"], "correct": 0}]}`;
            
            const result = await model.generateContent(prompt);
            let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            const quizData = JSON.parse(text);
            quizData.id = Date.now().toString();
            quizData.timeLimit = timeLimit; // Зберігаємо індивідуальний час для цієї гри

            savedQuizzes.push(quizData); saveQuizzesToDisk();
            io.emit('load_saved_quizzes', savedQuizzes);
            socket.emit('ai_quiz_success', quizData.id);
        } catch (error) {
            console.error("Помилка ШІ:", error);
            socket.emit('ai_error', "Нейронка заплуталась. Спробуй ще раз!");
        }
    });

    function createRoomContext(quizData, hostId) {
        const roomCode = crypto.randomBytes(2).toString('hex').toUpperCase();
        rooms[roomCode] = {
            quiz: quizData, hostId: hostId, players: [], status: 'waiting',
            currentQuestionIndex: -1, timer: null, questionStartTime: 0, answersCount: 0
        };
        return roomCode;
    }

    socket.on('create_room', (quizData) => {
        quizData.id = Date.now().toString();
        savedQuizzes.push(quizData); saveQuizzesToDisk();
        io.emit('load_saved_quizzes', savedQuizzes);
        const roomCode = createRoomContext(quizData, socket.id);
        socket.emit('room_created', roomCode);
    });

    socket.on('start_saved_game', (quizId) => {
        const quiz = savedQuizzes.find(q => q.id === quizId);
        if (quiz) {
            const roomCode = createRoomContext(quiz, socket.id);
            socket.emit('room_created', roomCode);
        }
    });

    socket.on('join_room', ({ roomCode, playerName }) => {
        if (!rooms[roomCode]) return socket.emit('error', 'Кімнату не знайдено');
        socket.join(roomCode);
        const isHost = rooms[roomCode].hostId === socket.id;
        const role = isHost ? 'admin' : 'player'; 
        rooms[roomCode].players.push({ id: socket.id, name: playerName, score: 0, role: role, hasAnswered: false });
        socket.data.roomCode = roomCode;
        socket.emit('joined_successfully', { role: role });
        io.to(roomCode).emit('update_players', rooms[roomCode].players);
    });

    socket.on('assign_screen', (targetSocketId) => {
        const roomCode = socket.data.roomCode;
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;
        const targetPlayer = room.players.find(p => p.id === targetSocketId);
        if (targetPlayer && targetPlayer.role !== 'admin') {
            targetPlayer.role = 'screen';
            io.to(targetSocketId).emit('role_changed', 'screen');
            io.to(roomCode).emit('update_players', room.players);
        }
    });

    const sendQuestion = (roomCode) => {
        const room = rooms[roomCode];
        const question = room.quiz.questions[room.currentQuestionIndex];
        const duration = room.quiz.timeLimit || 15000; // Беремо час з налаштувань (або 15с за замовчуванням)
        
        room.players.forEach(p => p.hasAnswered = false);
        room.answersCount = 0; room.status = 'active';

        const qData = { title: question.title, options: question.options, index: room.currentQuestionIndex, total: room.quiz.questions.length, duration: duration };
        io.to(roomCode).emit('new_question', qData);
        room.questionStartTime = Date.now();
        
        clearTimeout(room.timer);
        room.timer = setTimeout(() => {
            room.status = 'timeout';
            io.to(roomCode).emit('question_timeout', question.correct);
            io.to(roomCode).emit('update_players', room.players);
        }, duration);
    };

    socket.on('start_game', () => {
        const roomCode = socket.data.roomCode;
        const room = rooms[roomCode];
        if (room && room.hostId === socket.id) {
            room.currentQuestionIndex = 0;
            io.to(roomCode).emit('game_started');
            sendQuestion(roomCode);
        }
    });

    // НОВА ПОДІЯ: Дострокова зупинка гри
    socket.on('stop_game_early', () => {
        const roomCode = socket.data.roomCode;
        const room = rooms[roomCode];
        if (room && room.hostId === socket.id) {
            clearTimeout(room.timer);
            room.status = 'finished';
            io.to(roomCode).emit('game_over', room.players);
        }
    });

    socket.on('submit_answer', (answerIndex) => {
        const roomCode = socket.data.roomCode;
        const room = rooms[roomCode];
        if (!room || room.status !== 'active') return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.role !== 'player' || player.hasAnswered) return;

        const duration = room.quiz.timeLimit || 15000;
        player.hasAnswered = true; room.answersCount++;
        const currentQ = room.quiz.questions[room.currentQuestionIndex];

        if (answerIndex === currentQ.correct) {
            const timeTaken = Date.now() - room.questionStartTime;
            const timeRatio = Math.max(0, 1 - (timeTaken / duration));
            player.score += Math.floor(100 + (900 * timeRatio));
        }

        socket.emit('score_updated', player.score);

        const activePlayersCount = room.players.filter(p => p.role === 'player').length;
        if (room.answersCount >= activePlayersCount) {
            clearTimeout(room.timer); room.status = 'timeout';
            io.to(roomCode).emit('question_timeout', currentQ.correct);
            io.to(roomCode).emit('update_players', room.players);
        }
    });

    socket.on('next_question', () => {
        const roomCode = socket.data.roomCode;
        const room = rooms[roomCode];
        if (room && room.hostId === socket.id) {
            room.currentQuestionIndex++;
            if (room.currentQuestionIndex < room.quiz.questions.length) sendQuestion(roomCode);
            else { io.to(roomCode).emit('game_over', room.players); room.status = 'finished'; }
        }
    });

    socket.on('return_to_lobby', () => {
        const roomCode = socket.data.roomCode;
        const room = rooms[roomCode];
        if (room && room.hostId === socket.id) {
            room.status = 'waiting';
            room.currentQuestionIndex = -1;
            io.to(roomCode).emit('go_to_lobby');
        }
    });

    socket.on('disconnect', () => {
        const roomCode = socket.data.roomCode;
        if (roomCode && rooms[roomCode]) {
            rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
            io.to(roomCode).emit('update_players', rooms[roomCode].players);
            if (rooms[roomCode].players.length === 0) delete rooms[roomCode];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущено на http://localhost:${PORT}`));
