/* ===== ALPHA TASK MANAGER — CORE ENGINE ===== */

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%237c3aed'/%3E%3Ccircle cx='50' cy='36' r='17' fill='%23e2e8f0'/%3E%3Cpath d='M14 88 Q14 60 50 60 Q86 60 86 88' fill='%23e2e8f0'/%3E%3C/svg%3E";
const USERS_KEY = 'alpha_tasks_users';
const SESSION_KEY = 'alpha_tasks_session';

/* ---------- DOM REFS ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const hamburgerBtn = $('#hamburgerBtn');
const sidebar = $('#sidebar');
const sidebarOverlay = $('#sidebarOverlay');
const navbarAvatar = $('#navbarAvatar');
const profileTrigger = $('#profileTrigger');
const profileDropdown = $('#profileDropdown');
const sidebarAvatar = $('#sidebarAvatar');
const sidebarUsername = $('#sidebarUsername');
const sidebarStatus = $('#sidebarStatus');
const taskBadge = $('#taskBadge');

const taskInput = $('#taskInput');
const addBtn = $('#addBtn');
const taskList = $('#taskList');
const taskEmpty = $('#taskEmpty');
const taskFooter = $('#taskFooter');
const taskCount = $('#taskCount');
const clearCompletedBtn = $('#clearCompletedBtn');
const currentDate = $('#currentDate');

const historyList = $('#historyList');
const historyEmpty = $('#historyEmpty');
const clearHistoryBtn = $('#clearHistoryBtn');

const profileCard = $('#profileCard');
const profileGuestPrompt = $('#profileGuestPrompt');
const profilePicLarge = $('#profilePicLarge');
const profileDisplayName = $('#profileDisplayName');
const profileHandle = $('#profileHandle');
const changePicBtn = $('#changePicBtn');
const profilePicInput = $('#profilePicInput');
const profileLoginBtn = $('#profileLoginBtn');

const authModal = $('#authModal');
const authModalClose = $('#authModalClose');
const loginForm = $('#loginForm');
const signupForm = $('#signupForm');
const toastContainer = $('#toastContainer');

/* ---------- STATE ---------- */
let currentUser = null;   // username string or null
let currentFilter = 'all';

/* ---------- HELPERS ---------- */
function getUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; } catch { return {}; }
}
function saveUsers(users) { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }

/* --- Secure Token-Based Session --- */
function generateToken() {
    // Use native crypto for a secure random token
    if (crypto.randomUUID) return crypto.randomUUID();
    // Fallback for older browsers
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

function getSession() {
    // Check both storages — sessionStorage for non-persistent, localStorage for 'Remember Me'
    let raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function saveSession(username, rememberMe = false) {
    const token = generateToken();

    // Store the token in the user's profile for server-side validation
    const users = getUsers();
    if (users[username]) {
        users[username].sessionToken = token;
        saveUsers(users);
    }

    const payload = JSON.stringify({ username, token });
    if (rememberMe) {
        localStorage.setItem(SESSION_KEY, payload);
        sessionStorage.removeItem(SESSION_KEY);
    } else {
        sessionStorage.setItem(SESSION_KEY, payload);
        localStorage.removeItem(SESSION_KEY);
    }
}

function clearSession() {
    // Invalidate the token in the user's profile
    if (currentUser) {
        const users = getUsers();
        if (users[currentUser]) {
            delete users[currentUser].sessionToken;
            saveUsers(users);
        }
    }
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
}

function validateSession() {
    const session = getSession();
    if (!session || !session.username || !session.token) return null;

    const users = getUsers();
    const user = users[session.username];

    // Token must match what's stored in the user's profile
    if (!user || user.sessionToken !== session.token) return null;

    return session.username;
}

function getUserData() {
    if (!currentUser) return { tasks: [], history: [] };
    const users = getUsers();
    return users[currentUser] || { tasks: [], history: [] };
}
function setUserData(data) {
    if (!currentUser) return;
    const users = getUsers();
    users[currentUser] = { ...users[currentUser], ...data };
    saveUsers(users);
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function formatDate(iso) {
    const d = new Date(iso);
    const opts = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return d.toLocaleDateString('en-US', opts);
}

/* ---------- SECURE HASHING (Web Crypto API) ---------- */
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- ZERO-DATA-LOSS MIGRATION ---------- */
const MIGRATION_KEY = 'alpha_tasks_pw_migrated';

async function migrateOldPasswords() {
    // Run exactly once — skip if already migrated
    if (localStorage.getItem(MIGRATION_KEY)) return;

    const users = getUsers();
    let migrated = 0;

    for (const username of Object.keys(users)) {
        const user = users[username];
        if (!user.password) continue;

        // Detect old Base64 passwords:
        // SHA-256 hex is always exactly 64 hex chars. Base64 strings are not.
        const pw = user.password;
        const isSHA256Hex = /^[0-9a-f]{64}$/.test(pw);
        if (isSHA256Hex) continue; // already hashed

        try {
            const decoded = atob(pw);
            user.password = await hashPassword(decoded);
            migrated++;
        } catch {
            // Not valid Base64 — skip silently
        }
    }

    if (migrated > 0) saveUsers(users);
    localStorage.setItem(MIGRATION_KEY, '1');
}

/* ---------- TOAST ---------- */
function showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    const icons = { success: 'bi-check-circle-fill', error: 'bi-x-circle-fill', info: 'bi-info-circle-fill' };
    t.innerHTML = `<i class="bi ${icons[type] || icons.info}"></i> ${msg}`;
    toastContainer.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 350);
    }, 2800);
}

/* ---------- SIDEBAR ---------- */
function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('show');
    hamburgerBtn.classList.add('active');
}
function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('show');
    hamburgerBtn.classList.remove('active');
}
hamburgerBtn.addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
});
sidebarOverlay.addEventListener('click', closeSidebar);

/* Sidebar nav */
$$('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
        const view = item.dataset.view;
        switchView(view);
        closeSidebar();
    });
});

function switchView(viewName) {
    $$('.view').forEach(v => v.classList.remove('active'));
    $(`#${viewName}View`).classList.add('active');
    $$('.sidebar-item').forEach(si => si.classList.toggle('active', si.dataset.view === viewName));
    if (viewName === 'history') renderHistory();
    if (viewName === 'profile') renderProfile();
}

/* ---------- PROFILE DROPDOWN ---------- */
navbarAvatar.addEventListener('click', (e) => {
    e.stopPropagation();
    profileDropdown.classList.toggle('show');
});
document.addEventListener('click', (e) => {
    if (!profileTrigger.contains(e.target)) profileDropdown.classList.remove('show');
});

function renderDropdown() {
    const users = getUsers();
    const user = currentUser ? users[currentUser] : null;
    let html = '';
    if (user) {
        const av = user.avatar || DEFAULT_AVATAR;
        html = `
            <div class="dropdown-header">
                <img src="${av}" alt="">
                <div><div class="dd-name">${user.name}</div><div class="dd-handle">@${currentUser}</div></div>
            </div>
            <a class="dropdown-item" id="ddProfile"><i class="bi bi-person-gear"></i> Profile Settings</a>
            <a class="dropdown-item danger" id="ddLogout"><i class="bi bi-box-arrow-right"></i> Logout</a>`;
    } else {
        html = `
            <a class="dropdown-item" id="ddLogin"><i class="bi bi-box-arrow-in-right"></i> Login</a>
            <a class="dropdown-item" id="ddSignup"><i class="bi bi-person-plus"></i> Sign Up</a>`;
    }
    profileDropdown.innerHTML = html;

    // Bind dynamic buttons
    const ddLogin = $('#ddLogin');
    const ddSignup = $('#ddSignup');
    const ddLogout = $('#ddLogout');
    const ddProfile = $('#ddProfile');
    if (ddLogin) ddLogin.addEventListener('click', () => { profileDropdown.classList.remove('show'); openAuthModal('login'); });
    if (ddSignup) ddSignup.addEventListener('click', () => { profileDropdown.classList.remove('show'); openAuthModal('signup'); });
    if (ddLogout) ddLogout.addEventListener('click', () => { profileDropdown.classList.remove('show'); logout(); });
    if (ddProfile) ddProfile.addEventListener('click', () => { profileDropdown.classList.remove('show'); switchView('profile'); });
}

/* ---------- AUTH MODAL ---------- */
function openAuthModal(tab = 'login') {
    authModal.classList.add('show');
    switchAuthTab(tab);
}
function closeAuthModal() { authModal.classList.remove('show'); }

authModalClose.addEventListener('click', closeAuthModal);
authModal.addEventListener('click', (e) => { if (e.target === authModal) closeAuthModal(); });

$$('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
});

function switchAuthTab(tab) {
    $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    loginForm.classList.toggle('hidden', tab !== 'login');
    signupForm.classList.toggle('hidden', tab !== 'signup');
}

/* Toggle password visibility */
$$('.toggle-pw').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = $(`#${btn.dataset.target}`);
        const isPassword = target.type === 'password';
        target.type = isPassword ? 'text' : 'password';
        btn.querySelector('i').className = isPassword ? 'bi bi-eye-slash' : 'bi bi-eye';
    });
});

/* ---------- AUTH: SIGNUP ---------- */
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#signupName').value.trim();
    const username = $('#signupUsername').value.trim().toLowerCase();
    const password = $('#signupPassword').value;
    const confirm = $('#signupConfirm').value;

    if (!name || !username || !password) return showToast('All fields are required', 'error');
    if (username.length < 3) return showToast('Username must be 3+ characters', 'error');
    if (password.length < 8) return showToast('Password must be at least 8 characters', 'error');
    if (password !== confirm) return showToast('Passwords do not match', 'error');

    const users = getUsers();
    if (users[username]) return showToast('Username already exists', 'error');

    const hashed = await hashPassword(password);
    users[username] = {
        name, password: hashed,
        avatar: null, tasks: [], history: []
    };
    saveUsers(users);
    showToast('Account created! Logging in...', 'success');
    signupForm.reset();
    resetStrengthMeter();
    setTimeout(() => loginAs(username, true), 600);  // Auto-remember on signup
});

/* ---------- AUTH: LOGIN ---------- */
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#loginUsername').value.trim().toLowerCase();
    const password = $('#loginPassword').value;
    const rememberMe = $('#rememberMe').checked;
    if (!username || !password) return showToast('Enter username and password', 'error');

    const users = getUsers();
    const user = users[username];
    if (!user) return showToast('User not found', 'error');

    const hashed = await hashPassword(password);
    if (user.password !== hashed) return showToast('Incorrect password', 'error');

    loginForm.reset();
    loginAs(username, rememberMe);
});

function loginAs(username, rememberMe = false) {
    currentUser = username;
    saveSession(username, rememberMe);
    closeAuthModal();
    refreshUI();
    showToast(`Welcome back, ${getUsers()[username].name}!`, 'success');
}

function logout() {
    clearSession();  // must run before nullifying currentUser (needs it for token cleanup)
    currentUser = null;
    refreshUI();
    showToast('Logged out successfully', 'info');
}

profileLoginBtn.addEventListener('click', () => openAuthModal('login'));

/* ---------- PASSWORD STRENGTH METER ---------- */
const strengthMeter = $('#passwordStrength');
const strengthFill  = $('#strengthBarFill');
const strengthLabel = $('#strengthLabel');

function calcStrength(pw) {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;

    if (score <= 1) return 'weak';
    if (score <= 3) return 'medium';
    return 'strong';
}

function resetStrengthMeter() {
    strengthMeter.classList.remove('visible');
    strengthFill.removeAttribute('data-level');
    strengthLabel.removeAttribute('data-level');
    strengthLabel.textContent = '';
}

$('#signupPassword').addEventListener('input', (e) => {
    const pw = e.target.value;
    if (!pw.length) {
        resetStrengthMeter();
        return;
    }
    strengthMeter.classList.add('visible');
    const level = calcStrength(pw);
    strengthFill.setAttribute('data-level', level);
    strengthLabel.setAttribute('data-level', level);
    const labels = { weak: 'Weak', medium: 'Medium', strong: 'Strong' };
    strengthLabel.textContent = labels[level];
});

/* ---------- TASKS ---------- */
function getTasks() { return getUserData().tasks || []; }
function saveTasks(tasks) { setUserData({ tasks }); }

function addTask() {
    const text = taskInput.value.trim();
    if (!text) return showToast('Please enter a task', 'error');
    if (!currentUser) return showToast('Login to save tasks', 'error');

    const tasks = getTasks();
    tasks.push({ id: genId(), text, completed: false, createdAt: new Date().toISOString() });
    saveTasks(tasks);
    taskInput.value = '';
    renderTasks();
    showToast('Task added!', 'success');
}

addBtn.addEventListener('click', addTask);
taskInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTask(); });

function toggleTask(id) {
    const tasks = getTasks();
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    task.completed = !task.completed;
    if (task.completed) addHistory(task.text, 'completed');
    saveTasks(tasks);
    renderTasks();
}

function deleteTask(id) {
    let tasks = getTasks();
    const task = tasks.find(t => t.id === id);
    if (task) addHistory(task.text, 'deleted');
    tasks = tasks.filter(t => t.id !== id);
    saveTasks(tasks);
    renderTasks();
    showToast('Task removed', 'info');
}

function clearCompleted() {
    let tasks = getTasks();
    const done = tasks.filter(t => t.completed);
    done.forEach(t => addHistory(t.text, 'completed'));
    tasks = tasks.filter(t => !t.completed);
    saveTasks(tasks);
    renderTasks();
    if (done.length) showToast(`Cleared ${done.length} task(s)`, 'info');
}
clearCompletedBtn.addEventListener('click', clearCompleted);

function renderTasks() {
    const tasks = getTasks();
    let filtered = tasks;
    if (currentFilter === 'active') filtered = tasks.filter(t => !t.completed);
    else if (currentFilter === 'completed') filtered = tasks.filter(t => t.completed);

    taskList.innerHTML = '';
    filtered.forEach(task => {
        const li = document.createElement('li');
        li.className = `task-item${task.completed ? ' completed' : ''}`;
        li.innerHTML = `
            <div class="task-check" data-id="${task.id}"><i class="bi bi-check-lg"></i></div>
            <span class="task-text">${escapeHtml(task.text)}</span>
            <button class="task-delete" data-id="${task.id}" aria-label="Delete"><i class="bi bi-trash3"></i></button>`;
        taskList.appendChild(li);
    });

    // Event delegation
    taskList.onclick = (e) => {
        const check = e.target.closest('.task-check');
        const del = e.target.closest('.task-delete');
        if (check) toggleTask(check.dataset.id);
        if (del) deleteTask(del.dataset.id);
    };

    const pending = tasks.filter(t => !t.completed).length;
    taskCount.textContent = `${pending} task${pending !== 1 ? 's' : ''} remaining`;
    taskBadge.textContent = pending;

    taskEmpty.classList.toggle('show', filtered.length === 0);
    taskFooter.style.display = tasks.length ? 'flex' : 'none';

    updateProfileStats();
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

/* Filters */
$$('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderTasks();
    });
});

/* ---------- HISTORY ---------- */
function getHistory() { return getUserData().history || []; }
function saveHistory(history) { setUserData({ history }); }

function addHistory(text, action) {
    if (!currentUser) return;
    const history = getHistory();
    history.unshift({ text, action, timestamp: new Date().toISOString() });
    if (history.length > 100) history.length = 100; // cap
    saveHistory(history);
}

function renderHistory() {
    const history = getHistory();
    historyList.innerHTML = '';
    history.forEach(item => {
        const li = document.createElement('li');
        li.className = 'history-item';
        const iconClass = item.action === 'completed' ? 'completed' : 'deleted';
        const icon = item.action === 'completed' ? 'bi-check-circle' : 'bi-x-circle';
        const label = item.action === 'completed' ? 'Completed' : 'Deleted';
        li.innerHTML = `
            <div class="history-icon ${iconClass}"><i class="bi ${icon}"></i></div>
            <div class="history-info">
                <div class="history-text">${escapeHtml(item.text)}</div>
                <div class="history-meta">${label} · ${formatDate(item.timestamp)}</div>
            </div>`;
        historyList.appendChild(li);
    });
    historyEmpty.classList.toggle('show', history.length === 0);
}

clearHistoryBtn.addEventListener('click', () => {
    if (!currentUser) return;
    saveHistory([]);
    renderHistory();
    showToast('History cleared', 'info');
});

/* ---------- PROFILE ---------- */
function renderProfile() {
    if (currentUser) {
        const users = getUsers();
        const user = users[currentUser];
        profileCard.classList.add('show');
        profileGuestPrompt.classList.remove('show');
        profilePicLarge.src = user.avatar || DEFAULT_AVATAR;
        profileDisplayName.textContent = user.name;
        profileHandle.textContent = `@${currentUser}`;
        updateProfileStats();
    } else {
        profileCard.classList.remove('show');
        profileGuestPrompt.classList.add('show');
    }
}

function updateProfileStats() {
    const tasks = getTasks();
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    $('#statTotal').textContent = total;
    $('#statCompleted').textContent = completed;
    $('#statPending').textContent = total - completed;
}

/* Avatar change — auto-compress to ~1.99KB */
const TARGET_SIZE_BYTES = 1.99 * 1024; // 1.99 KB = 2037 bytes

/**
 * Compresses an image file to ≤ TARGET_SIZE_BYTES (~1.99KB).
 * Uses canvas resizing + iterative JPEG quality reduction.
 * Returns a Promise that resolves with the compressed base64 data URL.
 */
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            // Calculate base64 byte size from a data URL
            const getBase64Bytes = (dataUrl) => {
                const base64 = dataUrl.split(',')[1];
                // base64 chars × 3/4 gives raw byte count
                return Math.round(base64.length * 3 / 4);
            };

            // Try a specific dimension + quality combo
            const tryCompress = (maxDim, quality) => {
                const canvas = document.createElement('canvas');
                let w = img.width, h = img.height;

                // Scale down proportionally to fit within maxDim
                if (w > h) { if (w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; } }
                else       { if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; } }

                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');

                // Smooth downscaling
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, w, h);

                return canvas.toDataURL('image/jpeg', quality);
            };

            // Iterative search: try decreasing sizes, then decreasing quality
            const sizes = [128, 96, 80, 64, 48, 36];
            const qualities = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1];

            let bestResult = null;

            for (const size of sizes) {
                for (const q of qualities) {
                    const dataUrl = tryCompress(size, q);
                    const bytes = getBase64Bytes(dataUrl);

                    if (bytes <= TARGET_SIZE_BYTES) {
                        // Found a fit — pick the best quality at this size
                        bestResult = dataUrl;
                        // Try slightly higher quality at same size to maximize quality
                        const qIdx = qualities.indexOf(q);
                        if (qIdx > 0) {
                            const better = tryCompress(size, qualities[qIdx - 1]);
                            if (getBase64Bytes(better) <= TARGET_SIZE_BYTES) {
                                bestResult = better;
                            }
                        }
                        resolve(bestResult);
                        return;
                    }
                }
            }

            // Fallback — smallest possible (36px, quality 0.1)
            resolve(tryCompress(36, 0.1));
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(file);
    });
}

changePicBtn.addEventListener('click', () => profilePicInput.click());
profilePicInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !currentUser) return;

    // Accept any image size — we'll auto-compress it
    if (!file.type.startsWith('image/')) {
        return showToast('Please select an image file', 'error');
    }

    showToast('Compressing image...', 'info');

    try {
        const compressed = await compressImage(file);

        // Show final size to user
        const finalBytes = Math.round(compressed.split(',')[1].length * 3 / 4);
        const finalKB = (finalBytes / 1024).toFixed(2);

        const users = getUsers();
        users[currentUser].avatar = compressed;
        saveUsers(users);
        refreshAvatars();
        renderProfile();
        showToast(`Picture updated! Compressed to ${finalKB} KB`, 'success');
    } catch (err) {
        showToast('Failed to process image', 'error');
    }

    profilePicInput.value = '';
});

/* ---------- UI REFRESH ---------- */
function refreshAvatars() {
    const av = currentUser ? (getUsers()[currentUser]?.avatar || DEFAULT_AVATAR) : DEFAULT_AVATAR;
    navbarAvatar.src = av;
    sidebarAvatar.src = av;
    profilePicLarge.src = av;
}

function refreshUI() {
    const users = getUsers();
    const user = currentUser ? users[currentUser] : null;

    // Avatars
    refreshAvatars();

    // Sidebar info
    sidebarUsername.textContent = user ? user.name : 'Guest';
    sidebarStatus.textContent = user ? `@${currentUser}` : 'Not logged in';

    // Dropdown
    renderDropdown();

    // Tasks
    renderTasks();

    // Profile
    renderProfile();

    // Date
    const now = new Date();
    currentDate.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/* ---------- INIT ---------- */
(async function init() {
    // Migrate old Base64 passwords to SHA-256 (runs once silently)
    await migrateOldPasswords();

    // Retrieve the raw session payload BEFORE validation
    const session = getSession();
    const validUser = validateSession();

    if (validUser) {
        currentUser = validUser;
    } else if (session && session.username) {
        // Token exists but failed validation — invalidate it in the DB too
        const users = getUsers();
        if (users[session.username] && users[session.username].sessionToken) {
            delete users[session.username].sessionToken;
            saveUsers(users);
        }
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
    } else {
        // No session at all — just ensure storage is clean
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
    }

    refreshUI();
})();