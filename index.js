// QR Send Convert
// While ON, Quick Replies are converted at run time:
//   /gen <prompt> | /sendas name="<any name>"
//     ->
//   /send <prompt> | /trigger await=true | /sub {{lastMessageId}} 1 | /cut {{pipe}}
// The saved Quick Reply text is never modified.

const MODULE = 'qr_send_convert';
const BTN_ID = 'qrc_toggle';

const ctx = () => SillyTavern.getContext();

/* ---------------- settings ---------------- */

function getSettings() {
    const { extensionSettings } = ctx();
    if (!extensionSettings[MODULE]) extensionSettings[MODULE] = {};
    const s = extensionSettings[MODULE];
    if (typeof s.enabled !== 'boolean') s.enabled = true;
    return s;
}

/* ---------------- conversion ---------------- */

// "/gen" + prompt (no unescaped pipe) + "| /sendas name=<anything>" and nothing else on that command.
const RE = /\/gen(?![\w-])((?:\\\||[^|])*)\|\s*\/sendas\s+name=(?:"[^"]*"|'[^']*'|[^\s|]+)(?=[ \t]*(?:\||\r?\n|$))/g;

function convert(text) {
    return text.replace(RE, (full, rawPrompt) => {
        const prompt = rawPrompt.trim();
        // Empty prompt, or /gen options (lock=, length=, ...): leave untouched.
        if (!prompt || /^[A-Za-z_]+=/.test(prompt)) return full;
        return `/send ${prompt} | /trigger await=true | /sub {{lastMessageId}} 1 | /cut {{pipe}}`;
    });
}

/* ---------------- Quick Reply patch ---------------- */

async function patchQuickReply() {
    const mod = await import('/scripts/extensions/quick-reply/src/QuickReply.js');
    const QR = mod.QuickReply ?? mod.default;
    if (!QR?.prototype?.execute) throw new Error('QuickReply.execute not found');
    if (QR.prototype.execute.__qrc) return;

    const original = QR.prototype.execute;
    const wrapped = async function (...args) {
        if (!getSettings().enabled || typeof this.message !== 'string') {
            return original.apply(this, args);
        }
        const before = this.message;
        const after = convert(before);
        if (after === before) return original.apply(this, args);

        this.message = after;
        try {
            return await original.apply(this, args);
        } finally {
            this.message = before;
        }
    };
    wrapped.__qrc = true;
    QR.prototype.execute = wrapped;
}

/* ---------------- toggle button ---------------- */

let lastTap = 0;
let eventsBound = false;

function refreshButton() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    const on = getSettings().enabled;
    btn.classList.toggle('qrc-on', on);
    btn.title = on ? 'QR 치환 ON (/gen → /send)' : 'QR 치환 OFF';
}

function toggle() {
    const s = getSettings();
    s.enabled = !s.enabled;
    ctx().saveSettingsDebounced();
    refreshButton();
    toastr.info(s.enabled ? 'QR 치환 ON' : 'QR 치환 OFF');
}

function onTap(e) {
    const t = e.target;
    if (!t || !t.closest || !t.closest(`#${BTN_ID}`)) return;
    if (e.type === 'pointerup' && e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    const now = Date.now();
    if (now - lastTap < 450) return;
    lastTap = now;
    toggle();
}

function mountButton() {
    if (document.getElementById(BTN_ID)) return true;
    const host = document.getElementById('leftSendForm') || document.getElementById('send_form');
    if (!host) return false;
    const btn = document.createElement('div');
    btn.id = BTN_ID;
    btn.className = 'fa-solid fa-fw fa-right-left interactable';
    btn.tabIndex = 0;
    btn.setAttribute('role', 'button');
    host.append(btn);
    if (!eventsBound) {
        eventsBound = true;
        for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
            document.addEventListener(type, onTap, true);
        }
    }
    refreshButton();
    return true;
}

/* ---------------- init ---------------- */

let started = false;
function start() {
    if (started) return;
    if (!mountButton()) return;
    started = true;
}

(async function init() {
    try {
        await patchQuickReply();
    } catch (e) {
        console.error(`[${MODULE}] patch failed`, e);
        toastr.error('QR 치환 확장: Quick Reply 연결 실패 (F12 콘솔 확인)');
    }
    const { eventSource, event_types } = ctx();
    eventSource.on(event_types.APP_READY, start);
    let tries = 0;
    const timer = setInterval(() => {
        start();
        if (started || ++tries > 40) clearInterval(timer);
    }, 500);
})();
