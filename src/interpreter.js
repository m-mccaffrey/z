import { createGlk } from './glk.js';

// Wraps ifvms.js's Z-machine engine behind a small line-in/text-out API.
// This is the only place that talks to the actual game; nothing here
// ever rewrites the text a game produces.
export class ZMachine {
    constructor({ onOutput, onStatus, onInputRequested, onQuit, onError }) {
        this.onOutput = onOutput;
        this.onStatus = onStatus;
        this.onInputRequested = onInputRequested;
        this.onQuit = onQuit;
        this.onError = onError;
        this.vm = null;
        this.glk = null;
    }

    async boot(gameData) {
        const { ZVM } = await import('ifvms');
        this.glk = createGlk({
            write: (text) => this.onOutput(text),
            clear: () => this.onOutput({ clear: true }),
            status: (text) => this.onStatus && this.onStatus(text),
            requestLine: () => this.onInputRequested(),
            requestChar: () => this.onInputRequested(),
            quit: () => this.onQuit && this.onQuit(),
            fatalError: (msg) => this.onError && this.onError(msg),
            hasSave: (name) => localStorage.getItem(saveKey(name)) !== null,
            loadSave: (name) => {
                const raw = localStorage.getItem(saveKey(name));
                if (!raw) return null;
                return Uint8Array.from(JSON.parse(raw));
            },
            writeSave: (name, bytes) => {
                localStorage.setItem(saveKey(name), JSON.stringify(Array.from(bytes)));
            },
        });

        this.vm = new ZVM();
        this.vm.prepare(gameData, { Glk: this.glk });
        this.vm.start();
    }

    // Hand a line of text to the game exactly as if it had been typed —
    // this is the ONLY place player input reaches the interpreter, so
    // whatever string is passed here is exactly what the parser sees.
    submit(line) {
        if (!this.vm || !this.glk) return;
        const len = this.glk._submitLine(line);
        try {
            this.vm.resume(len);
        } catch (err) {
            this.onError && this.onError(err.message || String(err));
        }
    }
}

function saveKey(filename) {
    return `fluent-if:save:${filename}`;
}
