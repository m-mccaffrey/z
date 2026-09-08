import './style.css';
import { ZMachine } from './interpreter.js';
import { interpretCommand, DEFAULT_MODELS } from './llm.js';

const els = {
    terminal: document.getElementById('terminal'),
    gameStatus: document.getElementById('game-status'),
    output: document.getElementById('output'),
    inputForm: document.getElementById('input-form'),
    commandInput: document.getElementById('command-input'),
    sendBtn: document.getElementById('send-btn'),
    statusText: document.getElementById('status-text'),
    rawToggle: document.getElementById('raw-toggle'),
    debugToggle: document.getElementById('debug-toggle'),

    storyBtn: document.getElementById('story-btn'),
    storyDialog: document.getElementById('story-dialog'),
    loadDemoBtn: document.getElementById('load-demo-btn'),
    storyFileInput: document.getElementById('story-file-input'),

    settingsBtn: document.getElementById('settings-btn'),
    settingsDialog: document.getElementById('settings-dialog'),
    settingsForm: document.getElementById('settings-form'),
    providerSelect: document.getElementById('provider-select'),
    modelInput: document.getElementById('model-input'),
    apikeyInput: document.getElementById('apikey-input'),
    clearSettingsBtn: document.getElementById('clear-settings-btn'),
};

const SETTINGS_KEY = 'fluent-if:settings';
const TRANSCRIPT_TAIL_CHARS = 4000;

let machine = null;
let busy = false;
let transcriptTail = '';
let settings = loadSettings();

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) return { provider: 'anthropic', model: '', apiKey: '', ...JSON.parse(raw) };
    } catch {
        /* ignore malformed storage */
    }
    return { provider: 'anthropic', model: '', apiKey: '' };
}

function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function appendText(text) {
    if (!text) return;
    els.output.appendChild(document.createTextNode(text));
    transcriptTail = (transcriptTail + text).slice(-TRANSCRIPT_TAIL_CHARS);
    scrollToBottom();
}

function appendLine(text, className) {
    const div = document.createElement('div');
    div.className = className;
    div.textContent = text;
    els.output.appendChild(div);
    scrollToBottom();
}

function appendDebugBlock({ provider, model, raw, command, elapsedMs }) {
    const div = document.createElement('div');
    div.className = 'meta-line debug-block';
    const shown = (raw || '').trim() || '(empty response)';
    div.textContent = `» ${provider}/${model} — ${elapsedMs}ms\n  model said: ${JSON.stringify(shown)}\n  sent to game: ${command || '(nothing usable — falling back to what you typed)'}`;
    els.output.appendChild(div);
    scrollToBottom();
}

function clearOutput() {
    els.output.innerHTML = '';
    transcriptTail = '';
}

function scrollToBottom() {
    els.terminal.scrollTop = els.terminal.scrollHeight;
}

function setStatus(text) {
    els.statusText.textContent = text;
}

function setInputEnabled(enabled) {
    els.commandInput.disabled = !enabled;
    els.sendBtn.disabled = !enabled;
    if (enabled) els.commandInput.focus();
}

function updateRawModeAvailability() {
    const wasForcedOn = els.rawToggle.disabled;
    if (!settings.apiKey) {
        els.rawToggle.checked = true;
        els.rawToggle.disabled = true;
    } else {
        // Newly gained a key (was forced into raw mode before): default to
        // LLM-interpreted mode. If the user already had a key and flipped
        // this themselves, leave their choice alone.
        if (wasForcedOn) els.rawToggle.checked = false;
        els.rawToggle.disabled = false;
    }
}

async function bootGame(gameData, label) {
    clearOutput();
    els.gameStatus.textContent = '';
    setStatus(`Loading ${label}…`);
    setInputEnabled(false);

    machine = new ZMachine({
        onOutput: (chunk) => {
            if (chunk && typeof chunk === 'object' && chunk.clear) {
                clearOutput();
                return;
            }
            appendText(chunk);
        },
        onStatus: (text) => {
            els.gameStatus.textContent = text;
        },
        onInputRequested: () => {
            setInputEnabled(true);
            setStatus('Ready.');
        },
        onQuit: () => {
            setInputEnabled(false);
            setStatus('The game has ended — choose “Story…” to play again.');
        },
        onError: (msg) => {
            appendLine(`⚠ ${msg}`, 'meta-line error-line');
            setStatus('An error occurred.');
        },
    });

    try {
        await machine.boot(gameData);
    } catch (err) {
        appendLine(`⚠ Failed to load story: ${err.message || err}`, 'meta-line error-line');
        setStatus('Failed to load story.');
    }
}

async function loadDemo() {
    const url = new URL('stories/cloakroom.z5', document.baseURI);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    await bootGame(buf, 'the bundled demo');
}

els.storyBtn.addEventListener('click', () => {
    els.storyDialog.showModal();
});

els.loadDemoBtn.addEventListener('click', async () => {
    els.storyDialog.close();
    try {
        await loadDemo();
    } catch (err) {
        appendLine(`⚠ Could not load the bundled demo: ${err.message || err}`, 'meta-line error-line');
    }
});

els.storyFileInput.addEventListener('change', async () => {
    const file = els.storyFileInput.files[0];
    els.storyFileInput.value = '';
    if (!file) return;
    els.storyDialog.close();
    const buf = new Uint8Array(await file.arrayBuffer());
    await bootGame(buf, file.name);
});

els.settingsBtn.addEventListener('click', () => {
    els.providerSelect.value = settings.provider;
    els.modelInput.value = settings.model || '';
    els.modelInput.placeholder = `default: ${DEFAULT_MODELS[settings.provider]}`;
    els.apikeyInput.value = settings.apiKey || '';
    els.settingsDialog.showModal();
});

els.providerSelect.addEventListener('change', () => {
    els.modelInput.placeholder = `default: ${DEFAULT_MODELS[els.providerSelect.value] || ''}`;
});

els.settingsForm.addEventListener('submit', () => {
    settings = {
        provider: els.providerSelect.value,
        model: els.modelInput.value.trim(),
        apiKey: els.apikeyInput.value.trim(),
    };
    saveSettings();
    updateRawModeAvailability();
});

els.clearSettingsBtn.addEventListener('click', () => {
    els.apikeyInput.value = '';
    settings.apiKey = '';
    saveSettings();
    updateRawModeAvailability();
});

els.inputForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !machine) return;

    const raw = els.commandInput.value;
    if (!raw.trim()) return;
    els.commandInput.value = '';
    appendLine(`> ${raw}`, 'cmd-echo');
    setInputEnabled(false);

    busy = true;
    try {
        let toSend = raw.trim();
        const useLlm = !els.rawToggle.checked && settings.apiKey;

        if (useLlm) {
            setStatus('Interpreting…');
            try {
                const result = await interpretCommand({
                    provider: settings.provider,
                    apiKey: settings.apiKey,
                    model: settings.model,
                    transcriptTail,
                    input: raw,
                });
                if (result.command) toSend = result.command;

                if (els.debugToggle.checked) {
                    appendDebugBlock(result);
                } else if (result.command && result.command.toLowerCase() !== raw.trim().toLowerCase()) {
                    appendLine(`» interpreted as: ${result.command}`, 'meta-line interpreted-line');
                }
            } catch (err) {
                appendLine(`» interpretation failed (${err.message || err}) — sending exactly what you typed`, 'meta-line error-line');
            }
        }

        setStatus('Ready.');
        machine.submit(toSend);
    } finally {
        busy = false;
    }
});

updateRawModeAvailability();
setStatus('Loading interpreter…');
loadDemo().catch((err) => {
    setStatus('Choose “Story…” to load a game.');
    appendLine(`⚠ Could not auto-load the bundled demo: ${err.message || err}`, 'meta-line error-line');
});
