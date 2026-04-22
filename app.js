import {
  auth,
  db,
  firebaseReady,
  ensureUserProfile,
  LOGIN_PAGE
} from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const PART_OF_SPEECH_LABELS = {
  noun: "Danh từ",
  verb: "Động từ",
  adjective: "Tính từ",
  adverb: "Trạng từ",
  pronoun: "Đại từ",
  preposition: "Giới từ",
  conjunction: "Liên từ",
  interjection: "Thán từ",
  "phrasal verb": "Cụm động từ",
  exclamation: "Thán từ",
  article: "Mạo từ",
  determiner: "Từ hạn định",
  abbreviation: "Viết tắt",
  idiom: "Thành ngữ",
  other: "Khác"
};

const state = {
  user: null,
  sessions: [],
  vocabulary: [],
  attempts: [],
  unsubscribers: [],
  activePracticeMode: "quiz",
  practiceFilter: "all",
  currentPracticeWordId: null,
  practiceFeedback: null,
  currentQuiz: null,
  lastQuizSummary: null,
  listeningQueue: [],
  listeningQueueIndex: 0,
  listeningRound: 0,
  listeningQueueFilter: null,
  lookupTimer: null,
  suggestionPayload: null,
  translationCache: new Map(),
  dictionaryCache: new Map()
};

const refs = {
  authStateText: document.getElementById("authStateText"),
  logoutBtn: document.getElementById("logoutBtn"),
  userBadge: document.getElementById("userBadge"),

  sessionForm: document.getElementById("sessionForm"),
  sessionNameInput: document.getElementById("sessionNameInput"),
  sessionList: document.getElementById("sessionList"),
  sessionMessage: document.getElementById("sessionMessage"),

  wordForm: document.getElementById("wordForm"),
  wordSessionSelect: document.getElementById("wordSessionSelect"),
  englishWordInput: document.getElementById("englishWordInput"),
  lookupBtn: document.getElementById("lookupBtn"),
  clearSuggestionBtn: document.getElementById("clearSuggestionBtn"),
  suggestionStatus: document.getElementById("suggestionStatus"),
  suggestionContainer: document.getElementById("suggestionContainer"),
  phoneticInput: document.getElementById("phoneticInput"),
  partOfSpeechSelect: document.getElementById("partOfSpeechSelect"),
  meaningInput: document.getElementById("meaningInput"),
  audioUrlInput: document.getElementById("audioUrlInput"),
  wordMessage: document.getElementById("wordMessage"),

  statsGrid: document.getElementById("statsGrid"),
  wordCountBadge: document.getElementById("wordCountBadge"),
  wordFilterSession: document.getElementById("wordFilterSession"),
  wordSearchInput: document.getElementById("wordSearchInput"),
  wordTableContainer: document.getElementById("wordTableContainer"),
  rankingTableContainer: document.getElementById("rankingTableContainer"),

  modeTabs: document.querySelectorAll(".mode-tab"),
  practiceSessionFilter: document.getElementById("practiceSessionFilter"),
  openQuizConfigBtn: document.getElementById("openQuizConfigBtn"),
  nextPracticeBtn: document.getElementById("nextPracticeBtn"),
  practiceContainer: document.getElementById("practiceContainer"),

  historyContainer: document.getElementById("historyContainer"),

  quizModal: document.getElementById("quizModal"),
  closeQuizModalBtn: document.getElementById("closeQuizModalBtn"),
  cancelQuizConfigBtn: document.getElementById("cancelQuizConfigBtn"),
  quizConfigForm: document.getElementById("quizConfigForm"),
  quizSourceSelect: document.getElementById("quizSourceSelect"),
  quizSessionField: document.getElementById("quizSessionField"),
  quizSessionSelect: document.getElementById("quizSessionSelect"),
  quizWordCountInput: document.getElementById("quizWordCountInput"),
  quizDirectionSelect: document.getElementById("quizDirectionSelect")
};

function normalizeText(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function slugify(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

function formatDate(value) {
  if (!value) return "--";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("vi-VN");
}

function getPosLabel(pos = "") {
  return PART_OF_SPEECH_LABELS[pos] || pos || "Khác";
}

function shuffleArray(list) {
  const cloned = [...list];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

function pickRandomDifferent(list, currentId = null) {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const filtered = currentId ? list.filter((item) => item.id !== currentId) : list;
  const pool = filtered.length ? filtered : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

function calcStats(stats = {}, deltaCorrect = 0, deltaWrong = 0) {
  const correctCount = (stats.correctCount || 0) + deltaCorrect;
  const wrongCount = (stats.wrongCount || 0) + deltaWrong;
  const totalAnswered = correctCount + wrongCount;
  const accuracy = totalAnswered ? Math.round((correctCount / totalAnswered) * 100) : 0;
  const mastery = correctCount >= 30 ? 100 : Math.min(100, Math.round((correctCount / 30) * 100));
  return {
    correctCount,
    wrongCount,
    totalAnswered,
    accuracy,
    mastery,
    mastered: correctCount >= 30
  };
}

function showStatus(element, type, message) {
  if (!element) return;
  if (!message) {
    element.className = "status";
    element.textContent = "";
    return;
  }
  element.className = `status show ${type}`;
  element.textContent = message;
}

function canUseSpeech() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function speakWord(word) {
  if (!canUseSpeech()) {
    alert("Trình duyệt này không hỗ trợ SpeechSynthesis API.");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "en-US";
  utterance.rate = 0.95;
  utterance.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find((voice) => String(voice.lang || "").toLowerCase().startsWith("en"));
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.speak(utterance);
}

function getUserCollection(name) {
  return collection(db, "users", state.user.uid, name);
}

function getUserDoc(collectionName, id) {
  return doc(db, "users", state.user.uid, collectionName, id);
}

function getSessionNameById(id) {
  return state.sessions.find((session) => session.id === id)?.name || "";
}

function getWordPool(sessionId = "all") {
  if (sessionId === "all") return state.vocabulary;
  return state.vocabulary.filter((item) => item.sessionId === sessionId);
}

function getFilteredWords() {
  const sessionId = refs.wordFilterSession.value || "all";
  const keyword = normalizeText(refs.wordSearchInput.value || "");

  return state.vocabulary.filter((word) => {
    const matchSession = sessionId === "all" || word.sessionId === sessionId;
    if (!matchSession) return false;
    if (!keyword) return true;

    const bag = [
      word.english,
      word.meaning,
      word.sessionName,
      getPosLabel(word.partOfSpeech),
      word.phonetic
    ].join(" ").toLowerCase();

    return bag.includes(keyword);
  });
}

function getPracticePool() {
  return getWordPool(state.practiceFilter);
}

function splitMeaningAnswers(text = "") {
  return String(text)
    .split(/[;,/|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function clearUserSubscriptions() {
  state.unsubscribers.forEach((unsub) => {
    try {
      unsub();
    } catch (_) {}
  });
  state.unsubscribers = [];
}

function redirectToLogin() {
  window.location.replace(LOGIN_PAGE);
}

function updateUserHeader(user) {
  const label = user.displayName || user.email || user.uid;
  refs.authStateText.textContent = label;
  refs.userBadge.textContent = label;
}

function subscribeUserData() {
  clearUserSubscriptions();

  const sessionsQuery = query(getUserCollection("sessions"), orderBy("nameLower"));
  const vocabQuery = query(getUserCollection("vocabulary"), orderBy("englishNormalized"));
  const attemptQuery = query(getUserCollection("quizAttempts"), orderBy("createdAt", "desc"), limit(20));

  // 1. Lắng nghe thay đổi của Buổi học
  state.unsubscribers.push(
    onSnapshot(
      sessionsQuery,
      (snapshot) => {
        state.sessions = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        hydrateSessionOptions();
        renderSessions();
        renderStats();
        renderWordTable();
        renderRankingTable();
        renderPracticePanel();
      },
      (error) => {
        console.error(error);
        showStatus(refs.sessionMessage, "error", `Không đọc được danh sách buổi học: ${error.message}`);
      }
    )
  );

  // 2. Lắng nghe thay đổi của Từ vựng
  state.unsubscribers.push(
    onSnapshot(
      vocabQuery,
      (snapshot) => {
        state.vocabulary = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        
        // Cập nhật lại giao diện khi có từ mới
        renderStats();
        renderWordTable();
        renderRankingTable();
        renderPracticePanel();

        // ĐÂY LÀ DÒNG FIX LỖI: Vẽ lại danh sách buổi học để cập nhật số lượng từ
        renderSessions(); 
      },
      (error) => {
        console.error(error);
        showStatus(refs.wordMessage, "error", `Không đọc được danh sách từ: ${error.message}`);
      }
    )
  );

  // 3. Lắng nghe thay đổi của Lịch sử Quiz
  state.unsubscribers.push(
    onSnapshot(
      attemptQuery,
      (snapshot) => {
        state.attempts = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        renderHistory();
        renderStats();
      },
      (error) => {
        console.error(error);
      }
    )
  );
}

function bindSessionEvents() {
  refs.sessionForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.user) return;

    const name = refs.sessionNameInput.value.trim();
    if (!name) {
      showStatus(refs.sessionMessage, "error", "Vui lòng nhập tên buổi học.");
      return;
    }

    const exists = state.sessions.some((item) => normalizeText(item.name) === normalizeText(name));
    if (exists) {
      showStatus(refs.sessionMessage, "warning", "Buổi học này đã tồn tại.");
      return;
    }

    try {
      await addDoc(getUserCollection("sessions"), {
        name,
        nameLower: normalizeText(name),
        slug: slugify(name),
        createdAt: serverTimestamp()
      });
      refs.sessionForm.reset();
      showStatus(refs.sessionMessage, "success", "Đã tạo buổi học.");
    } catch (error) {
      console.error(error);
      showStatus(refs.sessionMessage, "error", `Không thể tạo buổi học: ${error.message}`);
    }
  });

  refs.sessionList?.addEventListener("click", async (event) => {
    const deleteBtn = event.target.closest("[data-delete-session]");
    if (!deleteBtn) return;

    const sessionId = deleteBtn.dataset.deleteSession;
    const sessionName = getSessionNameById(sessionId);
    const count = state.vocabulary.filter((item) => item.sessionId === sessionId).length;

    if (count > 0) {
      alert(`Buổi "${sessionName}" đang có ${count} từ vựng. Hãy xóa hoặc chuyển các từ trước.`);
      return;
    }
    if (!confirm(`Xóa buổi học "${sessionName}"?`)) return;

    try {
      await deleteDoc(getUserDoc("sessions", sessionId));
      showStatus(refs.sessionMessage, "success", "Đã xóa buổi học.");
    } catch (error) {
      console.error(error);
      showStatus(refs.sessionMessage, "error", `Không thể xóa buổi học: ${error.message}`);
    }
  });
}

function renderSessions() {
  if (!state.sessions.length) {
    refs.sessionList.innerHTML = `<div class="empty">Chưa có buổi học nào. Hãy tạo buổi học đầu tiên.</div>`;
    return;
  }

  refs.sessionList.innerHTML = state.sessions.map((session) => {
    const count = state.vocabulary.filter((item) => item.sessionId === session.id).length;
    return `
      <div class="chip">
        <strong>${escapeHtml(session.name)}</strong>
        <span class="muted small">${count} từ</span>
        <button class="btn btn-ghost" type="button" data-delete-session="${session.id}" style="padding:6px 10px;">Xóa</button>
      </div>
    `;
  }).join("");
}

function hydrateSessionOptions() {
  const options = state.sessions.map((session) => `<option value="${session.id}">${escapeHtml(session.name)}</option>`).join("");

  refs.wordSessionSelect.innerHTML = state.sessions.length
    ? `<option value="">-- Chọn buổi học --</option>${options}`
    : `<option value="">-- Tạo buổi học trước --</option>`;

  refs.wordFilterSession.innerHTML = `<option value="all">Tất cả buổi học</option>${options}`;
  refs.practiceSessionFilter.innerHTML = `<option value="all">Thực hành với tất cả buổi học</option>${options}`;
  refs.quizSessionSelect.innerHTML = state.sessions.length
    ? `<option value="">-- Chọn buổi học --</option>${options}`
    : `<option value="">-- Chưa có buổi học --</option>`;

  if (!state.sessions.find((item) => item.id === refs.wordSessionSelect.value)) refs.wordSessionSelect.value = "";
  if (!state.sessions.find((item) => item.id === refs.wordFilterSession.value)) refs.wordFilterSession.value = "all";
  if (!state.sessions.find((item) => item.id === refs.practiceSessionFilter.value)) refs.practiceSessionFilter.value = "all";
  if (!state.sessions.find((item) => item.id === refs.quizSessionSelect.value)) refs.quizSessionSelect.value = "";

  state.practiceFilter = refs.practiceSessionFilter.value || "all";
}

function bindWordEvents() {
  refs.lookupBtn?.addEventListener("click", () => triggerLookup());
  refs.clearSuggestionBtn?.addEventListener("click", clearSuggestionUI);

  refs.englishWordInput?.addEventListener("input", () => {
    clearTimeout(state.lookupTimer);
    const word = refs.englishWordInput.value.trim();
    if (!word) {
      clearSuggestionUI();
      return;
    }
    state.lookupTimer = setTimeout(() => triggerLookup(word), 700);
  });

  refs.suggestionContainer?.addEventListener("change", (event) => {
    const radio = event.target.closest("input[name='meaningChoice']");
    if (!radio) return;

    refs.meaningInput.value = radio.dataset.meaning || "";
    refs.partOfSpeechSelect.value = radio.dataset.pos || "";

    if (radio.dataset.phonetic && !refs.phoneticInput.value.trim()) {
      refs.phoneticInput.value = radio.dataset.phonetic;
    }
    if (radio.dataset.audio && !refs.audioUrlInput.value.trim()) {
      refs.audioUrlInput.value = radio.dataset.audio;
    }
  });

  refs.suggestionContainer?.addEventListener("click", (event) => {
    const playBtn = event.target.closest("[data-play-audio]");
    if (!playBtn) return;
    const url = playBtn.dataset.playAudio;
    if (!url) return;

    const audio = new Audio(url);
    audio.play().catch(() => alert("Không phát được audio gốc."));
  });
    // --- SỰ KIỆN LIÊN QUAN ĐẾN XỬ LÝ TỪ VỰNG KHÔNG THỂ LƯU TRÙNG ---
  //  refs.wordForm?.addEventListener("submit", async (event) => {
  //   event.preventDefault();
  //   if (!state.user) return;

  //   const selectedSession = refs.wordSessionSelect.value;
  //   const sessionId = selectedSession;
  //   const english = refs.englishWordInput.value.trim();
  //   const meaning = refs.meaningInput.value.trim();
  //   const partOfSpeech = refs.partOfSpeechSelect.value.trim();
  //   const phonetic = refs.phoneticInput.value.trim();
  //   const audioUrl = refs.audioUrlInput.value.trim();

  //   // Validate trước
  //   if (!state.sessions.length) {
  //     showStatus(refs.wordMessage, "error", "Bạn cần tạo buổi học trước.");
  //     return;
  //   }
  //   if (!sessionId) {
  //     showStatus(refs.wordMessage, "error", "Vui lòng chọn buổi học.");
  //     return;
  //   }
  //   if (!english || !meaning) {
  //     showStatus(refs.wordMessage, "error", "Vui lòng nhập từ tiếng Anh và nghĩa tiếng Việt.");
  //     return;
  //   }

  //   // --- SỬA LOGIC Ở ĐÂY ---
  //   // Kiểm tra xem từ tiếng Anh này đã tồn tại ở BẤT KỲ buổi học nào chưa
  //   const existingWord = state.vocabulary.find(
  //     (item) => normalizeText(item.english) === normalizeText(english)
  //   );

  //   // Nếu đã tồn tại -> Chặn lại và thông báo buổi học chứa nó
  //   if (existingWord) {
  //     showStatus(
  //       refs.wordMessage, 
  //       "warning", 
  //       `Từ "${english}" đã tồn tại ở buổi học: "${existingWord.sessionName}". Không thể thêm trùng.`
  //     );
  //     return; // Dừng lại, không cho lưu
  //   }
  //   // -----------------------

  //   const sessionName = getSessionNameById(sessionId);

  //   const baseData = {
  //     english,
  //     englishNormalized: normalizeText(english),
  //     phonetic,
  //     partOfSpeech: partOfSpeech || "other",
  //     meaning,
  //     meaningsByPos: state.suggestionPayload?.meaningsByPos || {},
  //     sessionId,
  //     sessionName,
  //     audioUrl,
  //     updatedAt: serverTimestamp()
  //   };

  //   try {
  //     // Chỉ thực hiện thêm mới (vì đã chặn trùng ở trên)
  //     await addDoc(getUserCollection("vocabulary"), {
  //       ...baseData,
  //       createdAt: serverTimestamp(),
  //       stats: calcStats()
  //     });
      
  //     showStatus(refs.wordMessage, "success", `Đã lưu từ "${english}".`);
      
  //     refs.wordForm.reset();
  //     refs.englishWordInput.focus();
  //     refs.wordSessionSelect.value = selectedSession;
  //     clearSuggestionUI();

  //   } catch (error) {
  //     console.error(error);
  //     showStatus(refs.wordMessage, "error", `Không thể lưu từ vựng: ${error.message}`);
  //   }
  // });

refs.wordForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user) return;

  const selectedSession = refs.wordSessionSelect.value;

  const sessionId = selectedSession;
  const english = refs.englishWordInput.value.trim();
  const meaning = refs.meaningInput.value.trim();
  const partOfSpeech = refs.partOfSpeechSelect.value.trim() || "other";
  const phonetic = refs.phoneticInput.value.trim();
  const audioUrl = refs.audioUrlInput.value.trim();

  // validate
  if (!state.sessions.length) {
    showStatus(refs.wordMessage, "error", "Bạn cần tạo buổi học trước.");
    return;
  }
  if (!sessionId) {
    showStatus(refs.wordMessage, "error", "Vui lòng chọn buổi học.");
    return;
  }
  if (!english || !meaning) {
    showStatus(refs.wordMessage, "error", "Vui lòng nhập từ tiếng Anh và nghĩa tiếng Việt.");
    return;
  }

  const sessionName = getSessionNameById(sessionId);

  //  FIX LOGIC Ở ĐÂY
const existingWord = state.vocabulary.find(
    (item) =>
      normalizeText(item.english) === normalizeText(english) &&
      item.partOfSpeech === partOfSpeech
  );

  const baseData = {
    english,
    englishNormalized: normalizeText(english),
    phonetic,
    partOfSpeech,
    meaning,
    meaningsByPos: state.suggestionPayload?.meaningsByPos || {},
    sessionId,
    sessionName,
    audioUrl,
    updatedAt: serverTimestamp()
  };

  try {
    if (existingWord) {
      // KIỂM TRA XEM NÓ NẰM Ở BUỔI NÀO
      if (existingWord.sessionId === sessionId) {
        // Nằm cùng buổi hiện tại -> Tiến hành CẬP NHẬT (Logic của bạn)
        await updateDoc(getUserDoc("vocabulary", existingWord.id), baseData);
        showStatus(refs.wordMessage, "success", `Đã cập nhật từ "${english}" (${partOfSpeech}).`);
      } else {
        // Nằm ở buổi KHÁC -> CẢNH BÁO VÀ CHẶN LẠI
        showStatus(
          refs.wordMessage, 
          "warning", 
          `Từ "${english}" (${partOfSpeech}) đã tồn tại ở buổi học: "${existingWord.sessionName}".`
        );
        return; // Dừng lại, không cho lưu
      }
    } else {
      // CHƯA CÓ Ở ĐÂU CẢ -> THÊM MỚI (Logic của bạn)
      await addDoc(getUserCollection("vocabulary"), {
        ...baseData,
        createdAt: serverTimestamp(),
        stats: calcStats()
      });
      showStatus(refs.wordMessage, "success", `Đã lưu từ "${english}" (${partOfSpeech}).`);
    }

    refs.wordForm.reset();
    refs.englishWordInput.focus();
    refs.wordSessionSelect.value = selectedSession;
    clearSuggestionUI();

  } catch (error) {
    console.error(error);
    showStatus(refs.wordMessage, "error", `Không thể lưu từ vựng: ${error.message}`);
  }  
});

  refs.wordFilterSession?.addEventListener("change", renderWordTable);
  refs.wordSearchInput?.addEventListener("input", renderWordTable);
}

async function triggerLookup(forcedWord = null) {
  const word = (forcedWord || refs.englishWordInput.value || "").trim();
  if (!word) {
    showStatus(refs.suggestionStatus, "warning", "Hãy nhập từ tiếng Anh để tra.");
    return;
  }

  showStatus(refs.suggestionStatus, "info", `Đang tra gợi ý cho "${word}"...`);

  try {
    const data = await lookupWordMeaning(word);
    state.suggestionPayload = data;
    renderSuggestions(data);
    showStatus(refs.suggestionStatus, "success", `Đã tìm thấy gợi ý cho "${word}".`);
  } catch (error) {
    console.error(error);
    state.suggestionPayload = null;
    refs.suggestionContainer.innerHTML = "";
    showStatus(refs.suggestionStatus, "error", `Không tra được gợi ý cho "${word}". Bạn vẫn có thể nhập tay.`);
  }
}

function clearSuggestionUI() {
  refs.suggestionContainer.innerHTML = "";
  refs.phoneticInput.value = "";
  refs.audioUrlInput.value = "";
  refs.partOfSpeechSelect.value = "";
  refs.meaningInput.value = "";
  state.suggestionPayload = null;
  showStatus(refs.suggestionStatus, "", "");
}

async function lookupWordMeaning(word) {
  const key = normalizeText(word);
  if (state.dictionaryCache.has(key)) return state.dictionaryCache.get(key);

  const endpoint = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error("Không tìm thấy từ này trong từ điển.");

  const entries = await response.json();
  if (!entries.length) throw new Error("Dữ liệu từ điển trống.");

  // Lấy phiên âm và audio
  const phonetic = entries.find((item) => item.phonetic)?.phonetic || 
                   entries.flatMap((item) => item.phonetics || []).find((item) => item?.text)?.text || "";
  const audioUrl = entries.flatMap((item) => item.phonetics || []).find((item) => item?.audio)?.audio || "";

  const grouped = {};
  entries.forEach((entry) => {
    (entry.meanings || []).forEach((meaningObj) => {
      const pos = meaningObj.partOfSpeech || "other";
      if (!grouped[pos]) grouped[pos] = [];
      (meaningObj.definitions || []).forEach((defObj) => {
        const definition = String(defObj.definition || "").trim();
        if (definition && !grouped[pos].includes(definition)) {
          grouped[pos].push(definition);
        }
      });
    });
  });

  const limitedGroups = Object.fromEntries(
    Object.entries(grouped).map(([pos, defs]) => [pos, defs.slice(0, 3)])
  );

  // --- PHẦN CẢI TIẾN QUAN TRỌNG: DỊCH SONG SONG ---
  const translatedGroups = {};
  const translationPromises = [];

  for (const [pos, defs] of Object.entries(limitedGroups)) {
    translatedGroups[pos] = [];
    for (const def of defs) {
      // Tạo một "lời hứa" dịch thuật và đẩy vào danh sách chờ
      const promise = translateToVietnamese(def).then(vi => {
        translatedGroups[pos].push({ en: def, vi: vi || "Đang lỗi dịch..." });
      });
      translationPromises.push(promise);
    }
  }

  // Đợi tất cả các câu dịch xong cùng một lúc (nhanh hơn rất nhiều)
  await Promise.all(translationPromises);

  const result = {
    word,
    phonetic,
    audioUrl,
    meaningsByPos: translatedGroups
  };

  state.dictionaryCache.set(key, result);
  return result;
}
// async function translateToVietnamese(text) {
//   const key = normalizeText(text);
//   if (state.translationCache.has(key)) return state.translationCache.get(key);

//   const endpoint = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|vi`;
//   const response = await fetch(endpoint);
//   if (!response.ok) throw new Error("Translation failed");

//   const data = await response.json();
//   const translated = data?.responseData?.translatedText?.trim() || "";
//   if (!translated) throw new Error("No translation");

//   state.translationCache.set(key, translated);
//   return translated;
// }

//----------------------------------------------------------------------
//--API GOOGLE TRANSLATE MIỄN PHÍ
async function translateToVietnamese(text) {
  const key = normalizeText(text);
  if (state.translationCache.has(key)) return state.translationCache.get(key);

  try {
    //  API của Google Translate 
    const endpoint = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(endpoint);
    
    if (!response.ok) throw new Error("Google Translation failed");

    const data = await response.json();
    
    // Google trả về mảng lồng nhau, cần duyệt để ghép lại thành câu hoàn chỉnh
    let translated = "";
    if (data && data[0]) {
      translated = data[0].map(item => item[0]).join("").trim();
    }

    if (!translated) throw new Error("No translation returned");

    state.translationCache.set(key, translated);
    return translated;
  } catch (error) {
    console.error("Lỗi dịch thuật:", error);
    return ""; 
  }
}

//----------------------------------------------------------------------

// const GEMINI_API_KEY = "";

// async function translateToVietnamese(text) {
//   const key = normalizeText(text);
  
//   // Kiểm tra bộ nhớ đệm xem đã dịch câu này chưa (tránh gọi API lại tốn dung lượng)
//   if (state.translationCache.has(key)) return state.translationCache.get(key);

//   try {
//     // Gọi API của Gemini 1.5 Flash
//     const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
//     // Ép Gemini đóng vai trò từ điển, chỉ trả về nghĩa tiếng Việt
//     const promptText = `Bạn là một từ điển Anh - Việt chuyên nghiệp. Hãy dịch câu định nghĩa tiếng Anh sau sang tiếng Việt một cách tự nhiên, ngắn gọn và chính xác nhất. CHỈ TRẢ VỀ CÂU DỊCH, KHÔNG GIẢI THÍCH, KHÔNG BỌC TRONG DẤU NGOẶC KÉP. Câu cần dịch: "${text}"`;

//     const response = await fetch(endpoint, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         contents: [{ parts: [{ text: promptText }] }],
//         generationConfig: {
//           temperature: 0.1 // Hạ nhiệt độ để Gemini dịch chuẩn xác, không bịa chữ
//         }
//       })
//     });

//     if (!response.ok) {
//       throw new Error(`Lỗi kết nối Gemini API: ${response.status}`);
//     }

//     const data = await response.json();
//     let translated = "";

//     // Bóc tách kết quả trả về từ Gemini
//     if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
//       translated = data.candidates[0].content.parts[0].text.trim();
//     }

//     if (!translated) throw new Error("Gemini không trả về văn bản");

//     // Lưu vào cache
//     state.translationCache.set(key, translated);
//     return translated;

//   } catch (error) {
//     console.error("Lỗi dịch bằng Gemini:", error);
//     // Nếu API lỗi (rớt mạng, hết hạn ngạch...), trả về nguyên tiếng Anh để không bị lỗi trắng trang
//     return text; 
//   }
// }

//----------------------------------------------------------------------

function renderSuggestions(payload) {
  const { word, phonetic, audioUrl, meaningsByPos } = payload;
  const groups = Object.entries(meaningsByPos || {});
  if (!groups.length) {
    refs.suggestionContainer.innerHTML = `<div class="empty">Không có gợi ý nghĩa tự động. Bạn có thể nhập tay.</div>`;
    return;
  }

  refs.phoneticInput.value = phonetic || refs.phoneticInput.value;
  refs.audioUrlInput.value = audioUrl || refs.audioUrlInput.value;

  let firstSelected = false;
  refs.suggestionContainer.innerHTML = `
    <div class="suggestion-card">
      <div class="suggestion-head">
        <div>
          <div class="badge">Từ đang tra: ${escapeHtml(word)}</div>
          <div class="sub" style="margin-top:8px;">Phiên âm: <strong>${escapeHtml(phonetic || "--")}</strong></div>
        </div>
        <div class="inline-actions">
          ${audioUrl ? `<button type="button" class="btn btn-secondary" data-play-audio="${escapeHtml(audioUrl)}">Phát audio gốc</button>` : ""}
        </div>
      </div>
      <div class="pos-grid">
        ${groups.map(([pos, defs]) => `
          <div class="pos-item">
            <h4>
              <span>${escapeHtml(getPosLabel(pos))} <span class="muted">(${escapeHtml(pos)})</span></span>
            </h4>
            <div class="radio-list">
              ${defs.map((item) => {
                const checked = !firstSelected ? "checked" : "";
                if (!firstSelected) {
                  firstSelected = true;
                  refs.meaningInput.value = item.vi;
                  refs.partOfSpeechSelect.value = pos;
                }
                return `
                  <label class="radio-card">
                    <input
                      type="radio"
                      name="meaningChoice"
                      ${checked}
                      data-pos="${escapeHtml(pos)}"
                      data-meaning="${escapeHtml(item.vi)}"
                      data-phonetic="${escapeHtml(phonetic || "")}"
                      data-audio="${escapeHtml(audioUrl || "")}" />
                    <div>
                      <strong>${escapeHtml(item.vi)}</strong>
                      <small>${escapeHtml(item.en)}</small>
                    </div>
                  </label>
                `;
              }).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderStats() {
  const totalWords = state.vocabulary.length;
  const learnedWords = state.vocabulary.filter((item) => item.stats?.mastered).length;
  const totalSessions = state.sessions.length;
  const averageAccuracy = totalWords
    ? Math.round(state.vocabulary.reduce((sum, item) => sum + (item.stats?.accuracy || 0), 0) / totalWords)
    : 0;
  const averageMastery = totalWords
    ? Math.round(state.vocabulary.reduce((sum, item) => sum + (item.stats?.mastery || 0), 0) / totalWords)
    : 0;

  refs.statsGrid.innerHTML = `
    <div class="stat-card">
      <div class="label">Tổng từ vựng</div>
      <div class="value">${totalWords}</div>
    </div>
    <div class="stat-card">
      <div class="label">Buổi học</div>
      <div class="value">${totalSessions}</div>
    </div>
    <div class="stat-card">
      <div class="label">Đã thuộc</div>
      <div class="value">${learnedWords}</div>
    </div>
    <div class="stat-card">
      <div class="label">Accuracy trung bình</div>
      <div class="value">${averageAccuracy}%</div>
      <div class="sub">Mastery TB: ${averageMastery}%</div>
    </div>
  `;
}

function renderWordTable() {
  const rows = getFilteredWords();
  refs.wordCountBadge.textContent = `${rows.length} từ`;

  if (!rows.length) {
    refs.wordTableContainer.innerHTML = `<div class="empty">Chưa có từ vựng phù hợp bộ lọc hiện tại.</div>`;
    return;
  }

  refs.wordTableContainer.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Từ</th>
            <th>Phiên âm</th>
            <th>Từ loại</th>
            <th>Nghĩa</th>
            <th>Buổi học</th>
            <th>Accuracy</th>
            <th>Mastery</th>
            <th>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((word) => {
            const stats = word.stats || calcStats();
            return `
              <tr>
                <td><strong>${escapeHtml(word.english)}</strong></td>
                <td>${escapeHtml(word.phonetic || "--")}</td>
                <td>${escapeHtml(getPosLabel(word.partOfSpeech))}</td>
                <td>${escapeHtml(word.meaning)}</td>
                <td>${escapeHtml(word.sessionName || "--")}</td>
                <td>${stats.accuracy || 0}%</td>
                <td>
                  <div class="mastery-bar"><div class="mastery-fill" style="width:${stats.mastery || 0}%"></div></div>
                  <div class="small muted" style="margin-top:6px;">${stats.mastery || 0}%</div>
                </td>
                <td>
                  <button class="btn btn-danger" type="button" data-delete-word="${word.id}" style="padding:8px 12px;">Xóa</button>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function bindWordTableActions() {
  refs.wordTableContainer?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-word]");
    if (!button) return;

    const wordId = button.dataset.deleteWord;
    const word = state.vocabulary.find((item) => item.id === wordId);
    if (!word) return;
    if (!confirm(`Xóa từ "${word.english}"?`)) return;

    try {
      await deleteDoc(getUserDoc("vocabulary", wordId));
    } catch (error) {
      console.error(error);
      alert("Không thể xóa từ.");
    }
  });
}

function renderRankingTable() {
  if (!state.vocabulary.length) {
    refs.rankingTableContainer.innerHTML = `<div class="empty">Chưa có từ vựng để xếp hạng.</div>`;
    return;
  }

  const ranking = [...state.vocabulary].sort((a, b) => {
    const aStats = a.stats || calcStats();
    const bStats = b.stats || calcStats();
    return (bStats.mastery || 0) - (aStats.mastery || 0)
      || (bStats.accuracy || 0) - (aStats.accuracy || 0)
      || (bStats.correctCount || 0) - (aStats.correctCount || 0)
      || a.english.localeCompare(b.english);
  });

  refs.rankingTableContainer.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Từ</th>
            <th>Buổi học</th>
            <th>Đúng</th>
            <th>Sai</th>
            <th>Accuracy</th>
            <th>Mastery</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          ${ranking.map((word, index) => {
            const stats = word.stats || calcStats();
            const statusClass = stats.mastered ? "learned" : (stats.totalAnswered ? "in-progress" : "");
            const statusLabel = stats.mastered
              ? "Đã thuộc"
              : (stats.totalAnswered ? "Đang học" : "Chưa quiz");
            return `
              <tr>
                <td>${index + 1}</td>
                <td><strong>${escapeHtml(word.english)}</strong><div class="small muted">${escapeHtml(word.meaning)}</div></td>
                <td>${escapeHtml(word.sessionName || "--")}</td>
                <td>${stats.correctCount || 0}</td>
                <td>${stats.wrongCount || 0}</td>
                <td>${stats.accuracy || 0}%</td>
                <td>${stats.mastery || 0}%</td>
                <td><span class="rank-pill ${statusClass}">${statusLabel}</span></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderHistory() {
  if (!state.attempts.length) {
    refs.historyContainer.innerHTML = `<div class="empty">Chưa có lịch sử quiz.</div>`;
    return;
  }

  refs.historyContainer.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Thời gian</th>
            <th>Phạm vi</th>
            <th>Số câu</th>
            <th>Đúng</th>
            <th>Sai</th>
            <th>Điểm</th>
            <th>Kiểu</th>
          </tr>
        </thead>
        <tbody>
          ${state.attempts.map((item) => `
            <tr>
              <td>${formatDate(item.createdAt)}</td>
              <td>${escapeHtml(item.sessionLabel || "Tất cả từ vựng")}</td>
              <td>${item.totalQuestions || 0}</td>
              <td>${item.correctAnswers || 0}</td>
              <td>${item.wrongAnswers || 0}</td>
              <td><strong>${item.scorePercent || 0}%</strong></td>
              <td>${escapeHtml(item.directionLabel || "--")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function bindPracticeEvents() {
  refs.modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activePracticeMode = tab.dataset.mode;
      refs.modeTabs.forEach((item) => item.classList.toggle("active", item === tab));
      if (state.activePracticeMode !== "quiz") {
        ensurePracticeWord(true);
      }
      renderPracticePanel();
    });
  });

  refs.practiceSessionFilter?.addEventListener("change", () => {
    state.practiceFilter = refs.practiceSessionFilter.value || "all";
    ensurePracticeWord(true);
    renderPracticePanel();
  });

  refs.nextPracticeBtn?.addEventListener("click", () => {
    ensurePracticeWord(true);
    renderPracticePanel();
  });

  refs.practiceContainer?.addEventListener("submit", (event) => {
    const form = event.target.closest("form[data-practice-form]");
    if (!form) return;
    event.preventDefault();
    if (state.activePracticeMode === "quiz") return;

    const input = form.querySelector("[name='practiceAnswer']");
    const answer = input?.value || "";
    const word = state.vocabulary.find((item) => item.id === state.currentPracticeWordId);
    if (!word) return;

    const normalized = normalizeText(answer);
    if (!normalized) {
      state.practiceFeedback = {
        type: "warning",
        title: "Bạn chưa nhập câu trả lời",
        message: "Hãy nhập đáp án trước khi kiểm tra."
      };
      renderPracticePanel();
      return;
    }

    if (state.activePracticeMode === "spelling") {
      const correct = normalized === normalizeText(word.english);
      state.practiceFeedback = correct
        ? {
            type: "success",
            title: "Chính xác",
            message: `Bạn đã gõ đúng từ "${word.english}".`
          }
        : {
            type: "error",
            title: "Chưa đúng",
            message: `Đáp án đúng là "${word.english}".`
          };
    }

    if (state.activePracticeMode === "listening") {
      const correct = normalized === normalizeText(word.english);
      state.practiceFeedback = correct
        ? {
            type: "success",
            title: "Nghe đúng rồi",
            message: `Bạn nghe ra "${word.english}" — ${word.meaning} — ${word.phonetic || ""}`.trim()
          }
        : {
            type: "error",
            title: "Chưa đúng",
            message: `Từ đúng là "${word.english}" — ${word.meaning} — ${word.phonetic || ""}`.trim()
          };
    }

    if (state.activePracticeMode === "sentence") {
      const hasWord = normalizeText(answer).includes(normalizeText(word.english));
      state.practiceFeedback = hasWord
        ? {
            type: "success",
            title: "Ổn rồi",
            message: `Câu của bạn có chứa từ "${word.english}".`
          }
        : {
            type: "error",
            title: "Thiếu từ cần dùng",
            message: `Câu cần chứa từ "${word.english}".`
          };
    }

    renderPracticePanel();
  });

  refs.practiceContainer?.addEventListener("click", (event) => {
    const playBtn = event.target.closest("[data-play-word]");
    if (playBtn) {
      speakWord(playBtn.dataset.playWord);
      return;
    }

    const openAudioBtn = event.target.closest("[data-open-audio]");
    if (openAudioBtn) {
      const url = openAudioBtn.dataset.openAudio;
      if (url) window.open(url, "_blank");
      return;
    }

    const nextBtn = event.target.closest("[data-next-after-feedback]");
    if (nextBtn) {
      state.practiceFeedback = null;
      ensurePracticeWord(true);
      renderPracticePanel();
      return;
    }

    const quizOpenBtn = event.target.closest("[data-open-quiz]");
    if (quizOpenBtn) {
      openQuizConfigModal();
      return;
    }

    const quizSubmitBtn = event.target.closest("[data-quiz-submit]");
    if (quizSubmitBtn) {
      handleQuizSubmit();
      return;
    }

    const quizNextBtn = event.target.closest("[data-quiz-next]");
    if (quizNextBtn) {
      goToNextQuizQuestion();
      return;
    }

    const quizRestartBtn = event.target.closest("[data-quiz-restart]");
    if (quizRestartBtn) {
      openQuizConfigModal();
    }
  });

  refs.practiceContainer?.addEventListener("keydown", (event) => {
    const input = event.target.closest("[data-quiz-answer]");
    if (!input) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (state.currentQuiz?.awaitingNext) {
        goToNextQuizQuestion();
      } else {
        handleQuizSubmit();
      }
    }
  });
}

function ensureListeningWord(forceNew = false) {
  const pool = getPracticePool();
  if (!pool.length) {
    state.currentPracticeWordId = null;
    state.practiceFeedback = null;
    state.listeningQueue = [];
    state.listeningRound = 0;
    state.listeningQueueIndex = 0;
    return;
  }

  const filterChanged = state.listeningQueueFilter !== state.practiceFilter;
  const queueEmpty = !state.listeningQueue.length;

  if (filterChanged || queueEmpty) {
    state.listeningQueue = shuffleArray(pool).map((w) => w.id);
    state.listeningQueueIndex = 0;
    state.listeningRound = 1;
    state.listeningQueueFilter = state.practiceFilter;
    state.currentPracticeWordId = state.listeningQueue[0];
    state.practiceFeedback = null;
    return;
  }

  if (!forceNew) {
    if (state.currentPracticeWordId && state.listeningQueue.includes(state.currentPracticeWordId)) return;
  }

  state.listeningQueueIndex += 1;

  if (state.listeningQueueIndex >= state.listeningQueue.length) {
    state.listeningRound += 1;
    state.listeningQueue = shuffleArray(pool).map((w) => w.id);
    state.listeningQueueIndex = 0;
  }

  state.currentPracticeWordId = state.listeningQueue[state.listeningQueueIndex];
  state.practiceFeedback = null;
}

function ensurePracticeWord(forceNew = false) {
  if (state.activePracticeMode === "listening") {
    ensureListeningWord(forceNew);
    return;
  }

  const pool = getPracticePool();
  if (!pool.length) {
    state.currentPracticeWordId = null;
    state.practiceFeedback = null;
    return;
  }
  const current = pool.find((item) => item.id === state.currentPracticeWordId);
  if (!forceNew && current) return;

  const nextWord = pickRandomDifferent(pool, state.currentPracticeWordId);
  state.currentPracticeWordId = nextWord?.id || null;
  state.practiceFeedback = null;
}

function renderPracticePanel() {
  if (state.activePracticeMode === "quiz") {
    renderQuizPanel();
    return;
  }

  ensurePracticeWord(false);
  const pool = getPracticePool();
  if (!pool.length) {
    refs.practiceContainer.innerHTML = `<div class="empty">Chưa có từ trong phạm vi thực hành hiện tại.</div>`;
    return;
  }

  const word = state.vocabulary.find((item) => item.id === state.currentPracticeWordId) || pool[0];
  state.currentPracticeWordId = word.id;

  let bodyHtml = "";
  if (state.activePracticeMode === "spelling") {
    bodyHtml = `
      <div class="practice-card">
        <div class="prompt-title">Spelling practice</div>
        <div class="prompt-main">${escapeHtml(word.meaning)}</div>
        <div class="prompt-note">Gõ đúng từ tiếng Anh tương ứng với nghĩa trên.</div>
      </div>
      <form data-practice-form class="practice-panel">
        <input class="input" name="practiceAnswer" type="text" placeholder="Nhập từ tiếng Anh" autocomplete="off" />
        <div class="actions">
          <button class="btn btn-primary" type="submit">Kiểm tra</button>
          <button class="btn btn-ghost" type="button" data-next-after-feedback>Đổi từ</button>
        </div>
      </form>
    `;
  }

  if (state.activePracticeMode === "listening") {
    const totalInQueue = state.listeningQueue.length;
    const currentPos = state.listeningQueueIndex + 1;
    const progress = totalInQueue ? Math.round((currentPos / totalInQueue) * 100) : 0;
    bodyHtml = `
      <div class="practice-card">
        <div class="prompt-title">Listening practice</div>
        <div style="margin-bottom:10px;">
          <div class="progress"><div class="bar" style="width:${progress}%"></div></div>
          <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">
            <span class="badge">Vòng ${state.listeningRound}</span>
            <span class="badge">Từ ${currentPos}/${totalInQueue}</span>
          </div>
        </div>
        <div class="prompt-main">Nghe và gõ lại</div>
        <div class="prompt-note">Phiên âm: <strong>${escapeHtml(word.phonetic || "--")}</strong></div>
        <div class="actions" style="margin-top:12px;">
          <button class="btn btn-secondary" type="button" data-play-word="${escapeHtml(word.english)}">Play</button>
          ${word.audioUrl ? `<button class="btn btn-ghost" type="button" data-open-audio="${escapeHtml(word.audioUrl)}">Mở audio gốc</button>` : ""}
        </div>
      </div>
      <form data-practice-form class="practice-panel">
        <input class="input" name="practiceAnswer" type="text" placeholder="Nhập từ bạn nghe được" autocomplete="off" />
        <div class="actions">
          <button class="btn btn-primary" type="submit">Kiểm tra</button>
          <button class="btn btn-ghost" type="button" data-next-after-feedback>Từ tiếp theo</button>
        </div>
      </form>
    `;
  }

  if (state.activePracticeMode === "sentence") {
    bodyHtml = `
      <div class="practice-card">
        <div class="prompt-title">Sentence practice</div>
        <div class="prompt-main">${escapeHtml(word.english)}</div>
        <div class="prompt-note">Nghĩa: ${escapeHtml(word.meaning)}${word.phonetic ? ` · Phiên âm: <strong>${escapeHtml(word.phonetic)}</strong>` : ""}</div>
      </div>
      <form data-practice-form class="practice-panel">
        <textarea class="textarea" name="practiceAnswer" placeholder="Viết một câu có chứa từ này..."></textarea>
        <div class="actions">
          <button class="btn btn-primary" type="submit">Kiểm tra câu</button>
          <button class="btn btn-ghost" type="button" data-next-after-feedback>Đổi từ</button>
        </div>
      </form>
    `;
  }

  refs.practiceContainer.innerHTML = `
    ${bodyHtml}
    ${state.practiceFeedback ? `
      <div class="feedback show ${state.practiceFeedback.type}">
        <strong>${escapeHtml(state.practiceFeedback.title)}</strong>
        <div style="margin-top:6px;">${escapeHtml(state.practiceFeedback.message)}</div>
      </div>
    ` : ""}
  `;
}

function bindQuizEvents() {
  refs.openQuizConfigBtn?.addEventListener("click", openQuizConfigModal);
  refs.closeQuizModalBtn?.addEventListener("click", closeQuizConfigModal);
  refs.cancelQuizConfigBtn?.addEventListener("click", closeQuizConfigModal);

  refs.quizModal?.addEventListener("click", (event) => {
    if (event.target === refs.quizModal) closeQuizConfigModal();
  });

  refs.quizSourceSelect?.addEventListener("change", () => {
    refs.quizSessionField.classList.toggle("hidden", refs.quizSourceSelect.value !== "single");
  });

  refs.quizConfigForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    startQuizFromConfig();
  });
}

function openQuizConfigModal() {
  refs.quizModal.classList.add("show");
  refs.quizModal.setAttribute("aria-hidden", "false");
}

function closeQuizConfigModal() {
  refs.quizModal.classList.remove("show");
  refs.quizModal.setAttribute("aria-hidden", "true");
}

function startQuizFromConfig() {
  if (!state.vocabulary.length) {
    alert("Chưa có từ vựng để làm quiz.");
    return;
  }

  const sourceMode = refs.quizSourceSelect.value;
  const sessionId = sourceMode === "single" ? refs.quizSessionSelect.value : "all";

  if (sourceMode === "single" && !sessionId) {
    alert("Hãy chọn buổi học.");
    return;
  }

  const pool = getWordPool(sessionId);
  if (!pool.length) {
    alert("Không có từ trong phạm vi đã chọn.");
    return;
  }

  const requestedCount = Math.max(1, Number(refs.quizWordCountInput.value || 1));
  const totalQuestions = Math.min(requestedCount, pool.length);
  const directionMode = refs.quizDirectionSelect.value;
  const pickedWords = shuffleArray(pool).slice(0, totalQuestions);

  state.currentQuiz = {
    sourceMode,
    sessionId,
    sessionLabel: sessionId === "all" ? "Tất cả từ vựng" : getSessionNameById(sessionId),
    directionMode,
    directionLabel:
      directionMode === "mixed"
        ? "Trộn ngẫu nhiên"
        : directionMode === "en-vi"
          ? "English → Vietnamese"
          : "Vietnamese → English",
    questions: pickedWords.map((word) => ({
      wordId: word.id,
      direction: directionMode === "mixed" ? (Math.random() < 0.5 ? "en-vi" : "vi-en") : directionMode
    })),
    totalQuestions,
    index: 0,
    correct: 0,
    wrong: 0,
    answers: [],
    awaitingNext: false,
    feedback: null,
    finished: false,
    saving: false
  };

  closeQuizConfigModal();
  state.activePracticeMode = "quiz";
  refs.modeTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === "quiz"));
  renderPracticePanel();
}

function getCurrentQuizWord() {
  if (!state.currentQuiz) return null;
  const currentQuestion = state.currentQuiz.questions[state.currentQuiz.index];
  if (!currentQuestion) return null;
  return state.vocabulary.find((item) => item.id === currentQuestion.wordId) || null;
}

function renderQuizPanel() {
  if (!state.vocabulary.length) {
    refs.practiceContainer.innerHTML = `<div class="empty">Chưa có từ vựng để làm quiz.</div>`;
    return;
  }

  if (!state.currentQuiz) {
    refs.practiceContainer.innerHTML = `
      <div class="quiz-hero">
        <div class="prompt-title">Quiz mode</div>
        <div class="prompt-main">Sẵn sàng kiểm tra?</div>
        <div class="prompt-note">
          Bấm nút <strong>Mở form kiểm tra</strong> để chọn buổi học, số lượng từ và kiểu dịch.
        </div>
        ${state.lastQuizSummary ? `
          <div class="summary-grid" style="margin-top:16px;">
            <div class="summary-card"><div class="k">Bài gần nhất</div><div class="v">${state.lastQuizSummary.sessionLabel}</div></div>
            <div class="summary-card"><div class="k">Số câu</div><div class="v">${state.lastQuizSummary.totalQuestions}</div></div>
            <div class="summary-card"><div class="k">Đúng</div><div class="v">${state.lastQuizSummary.correctAnswers}</div></div>
            <div class="summary-card"><div class="k">Điểm</div><div class="v">${state.lastQuizSummary.scorePercent}%</div></div>
          </div>
        ` : ""}
        <div class="actions" style="margin-top:18px;">
          <button class="btn btn-primary" type="button" data-open-quiz>Mở form kiểm tra</button>
        </div>
      </div>
    `;
    return;
  }

  if (state.currentQuiz.finished) {
    const summary = state.currentQuiz.summary;
    refs.practiceContainer.innerHTML = `
      <div class="quiz-hero">
        <div class="prompt-title">Kết quả bài quiz</div>
        <div class="prompt-main">${summary.scorePercent}%</div>
        <div class="prompt-note">
          ${escapeHtml(summary.sessionLabel)} · ${escapeHtml(summary.directionLabel)}
        </div>
        <div class="summary-grid" style="margin-top:18px;">
          <div class="summary-card"><div class="k">Tổng số câu</div><div class="v">${summary.totalQuestions}</div></div>
          <div class="summary-card"><div class="k">Đúng</div><div class="v">${summary.correctAnswers}</div></div>
          <div class="summary-card"><div class="k">Sai</div><div class="v">${summary.wrongAnswers}</div></div>
          <div class="summary-card"><div class="k">Điểm</div><div class="v">${summary.scorePercent}%</div></div>
        </div>
        <div class="actions" style="margin-top:18px;">
          <button class="btn btn-primary" type="button" data-quiz-restart>Làm quiz mới</button>
        </div>
      </div>

      <div class="table-wrap" style="margin-top:16px;">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Câu hỏi</th>
              <th>Bạn trả lời</th>
              <th>Đáp án</th>
              <th>Kết quả</th>
            </tr>
          </thead>
          <tbody>
            ${state.currentQuiz.answers.map((item, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(item.promptText)}</td>
                <td>${escapeHtml(item.userAnswer || "--")}</td>
                <td>${escapeHtml(item.correctAnswer)}</td>
                <td>${item.correct ? "✅ Đúng" : "❌ Sai"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  const word = getCurrentQuizWord();
  if (!word) {
    refs.practiceContainer.innerHTML = `<div class="empty">Không tải được câu hỏi quiz hiện tại.</div>`;
    return;
  }

  const question = state.currentQuiz.questions[state.currentQuiz.index];
  const isEnToVi = question.direction === "en-vi";
  const promptText = isEnToVi ? word.english : word.meaning;
  const promptLabel = isEnToVi ? "Dịch sang tiếng Việt" : "Dịch sang tiếng Anh";
  const progress = Math.round((state.currentQuiz.index / state.currentQuiz.totalQuestions) * 100);
  const feedback = state.currentQuiz.feedback;

  refs.practiceContainer.innerHTML = `
    <div class="quiz-hero">
      <div class="prompt-title">Quiz đang chạy</div>
      <div class="progress"><div class="bar" style="width:${progress}%"></div></div>
      <div class="quiz-meta">
        <span class="badge">Câu ${state.currentQuiz.index + 1}/${state.currentQuiz.totalQuestions}</span>
        <span class="badge">Đúng: ${state.currentQuiz.correct}</span>
        <span class="badge">Sai: ${state.currentQuiz.wrong}</span>
        <span class="badge">${escapeHtml(state.currentQuiz.sessionLabel)}</span>
      </div>
    </div>

    <div class="practice-card">
      <div class="prompt-title">${escapeHtml(promptLabel)}</div>
      <div class="prompt-main" >${escapeHtml(promptText)}</div>
      <div class="prompt-note">
        ${isEnToVi
          ? `Từ loại: <strong>${escapeHtml(getPosLabel(word.partOfSpeech))}</strong>${word.phonetic ? ` · Phiên âm: <strong>${escapeHtml(word.phonetic)}</strong>` : ""}`
          : `Gõ từ tiếng Anh tương ứng với nghĩa trên`}
      </div>
    </div>

    <div class="practice-panel">
      <textarea class="textarea" data-quiz-answer placeholder="${isEnToVi ? "Nhập nghĩa tiếng Việt" : "Nhập từ tiếng Anh"}" ${state.currentQuiz.awaitingNext ? "disabled" : ""}></textarea>
      <div class="actions">
        <button class="btn btn-primary" type="button" data-quiz-submit ${state.currentQuiz.awaitingNext ? "disabled" : ""}>Kiểm tra</button>
        <button class="btn btn-secondary" type="button" data-quiz-next ${state.currentQuiz.awaitingNext ? "" : "disabled"}>${state.currentQuiz.index === state.currentQuiz.totalQuestions - 1 ? "Xem kết quả" : "Câu tiếp theo"}</button>
      </div>
    </div>

    ${feedback ? `
      <div class="feedback show ${feedback.type}">
        <strong>${escapeHtml(feedback.title)}</strong>
        <div style="margin-top:6px;">${escapeHtml(feedback.message)}</div>
      </div>
    ` : ""}
  `;
}

function handleQuizSubmit() {
  if (!state.currentQuiz || state.currentQuiz.finished || state.currentQuiz.awaitingNext) return;

  const textarea = refs.practiceContainer.querySelector("[data-quiz-answer]");
  const userAnswerRaw = textarea?.value ?? "";
  const userAnswer = normalizeText(userAnswerRaw);

  if (!userAnswer) {
    state.currentQuiz.feedback = {
      type: "warning",
      title: "Bạn chưa nhập đáp án",
      message: "Hãy nhập câu trả lời trước khi kiểm tra."
    };
    renderPracticePanel();
    return;
  }

  const word = getCurrentQuizWord();
  const question = state.currentQuiz.questions[state.currentQuiz.index];
  const isEnToVi = question.direction === "en-vi";

  const acceptedAnswers = isEnToVi ? splitMeaningAnswers(word.meaning) : [word.english];
  const correctAnswer = isEnToVi ? acceptedAnswers.join(" / ") : word.english;
  const correct = acceptedAnswers.some((item) => normalizeText(item) === userAnswer);

  if (correct) state.currentQuiz.correct += 1;
  else state.currentQuiz.wrong += 1;

  state.currentQuiz.answers.push({
    wordId: word.id,
    english: word.english,
    meaning: word.meaning,
    direction: question.direction,
    promptText: isEnToVi ? `${word.english} → ?` : `${word.meaning} → ?`,
    userAnswer: userAnswerRaw.trim(),
    correctAnswer,
    correct
  });

  state.currentQuiz.awaitingNext = true;
  state.currentQuiz.feedback = correct
    ? {
        type: "success",
        title: "Chính xác",
        message: isEnToVi
          ? `"${word.english}" nghĩa là "${word.meaning}".`
          : `"${word.meaning}" là "${word.english}".`
      }
    : {
        type: "error",
        title: "Chưa đúng",
        message: `Đáp án đúng: "${correctAnswer}".`
      };

  renderPracticePanel();
}

async function goToNextQuizQuestion() {
  if (!state.currentQuiz || !state.currentQuiz.awaitingNext) return;

  if (state.currentQuiz.index >= state.currentQuiz.totalQuestions - 1) {
    await finishQuiz();
    return;
  }

  state.currentQuiz.index += 1;
  state.currentQuiz.awaitingNext = false;
  state.currentQuiz.feedback = null;
  renderPracticePanel();
}

async function finishQuiz() {
  if (!state.currentQuiz || state.currentQuiz.finished) return;

  const summary = {
    sessionMode: state.currentQuiz.sourceMode,
    sessionId: state.currentQuiz.sessionId,
    sessionLabel: state.currentQuiz.sessionLabel,
    totalQuestions: state.currentQuiz.totalQuestions,
    correctAnswers: state.currentQuiz.correct,
    wrongAnswers: state.currentQuiz.wrong,
    scorePercent: Math.round((state.currentQuiz.correct / state.currentQuiz.totalQuestions) * 100),
    directionMode: state.currentQuiz.directionMode,
    directionLabel: state.currentQuiz.directionLabel,
    createdAt: serverTimestamp(),
    answers: state.currentQuiz.answers
  };

  try {
    const batch = writeBatch(db);
    const attemptRef = doc(getUserCollection("quizAttempts"));
    batch.set(attemptRef, summary);

    const deltaMap = new Map();
    state.currentQuiz.answers.forEach((answer) => {
      const existing = deltaMap.get(answer.wordId) || { correct: 0, wrong: 0 };
      if (answer.correct) existing.correct += 1;
      else existing.wrong += 1;
      deltaMap.set(answer.wordId, existing);
    });

    for (const [wordId, delta] of deltaMap.entries()) {
      const currentWord = state.vocabulary.find((item) => item.id === wordId);
      if (!currentWord) continue;
      const newStats = calcStats(currentWord.stats || {}, delta.correct, delta.wrong);
      batch.update(getUserDoc("vocabulary", wordId), {
        stats: newStats,
        updatedAt: serverTimestamp()
      });
    }

    await batch.commit();

    const finalizedSummary = {
      ...summary,
      createdAt: Date.now()
    };

    state.currentQuiz.summary = finalizedSummary;
    state.currentQuiz.finished = true;
    state.currentQuiz.awaitingNext = false;
    state.currentQuiz.feedback = null;
    state.lastQuizSummary = finalizedSummary;
    renderPracticePanel();
  } catch (error) {
    console.error(error);
    alert("Không thể lưu kết quả quiz lên Firestore.");
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    redirectToLogin();
  } catch (error) {
    console.error(error);
    alert("Không thể đăng xuất lúc này.");
  }
}

function bindGlobalEvents() {
  bindSessionEvents();
  bindWordEvents();
  bindWordTableActions();
  bindPracticeEvents();
  bindQuizEvents();
  refs.logoutBtn?.addEventListener("click", handleLogout);
}

function renderAll() {
  renderStats();
  renderSessions();
  hydrateSessionOptions();
  renderWordTable();
  renderRankingTable();
  renderPracticePanel();
  renderHistory();
}

function init() {
    
  if (!firebaseReady || !auth || !db) {
    refs.authStateText.textContent = "Thiếu Firebase config";
    refs.userBadge.textContent = "Thiếu cấu hình";
    return;
  }

  bindGlobalEvents();
  renderAll();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      clearUserSubscriptions();
      redirectToLogin();
      return;
    }

    state.user = user;
    updateUserHeader(user);

    try {
      await ensureUserProfile(user);
    } catch (error) {
      console.error(error);
    }

    subscribeUserData();
  });
}

init();