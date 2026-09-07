// A minimal Glk implementation — just enough of the Glk I/O spec for
// ifvms.js's Z-machine engine (ZVM) to run a game. It supports exactly
// two windows, which is all the Inform 6 library ever opens: the
// scrolling text-buffer transcript, and a one-line text-grid status
// window. Anything else ZVM might call (styles, graphics, sound…) is a
// harmless no-op.
//
// `hooks` is:
//   write(text)                  - append text to the transcript
//   clear()                      - the game asked to clear the transcript
//   status(text)                 - the status line's current contents changed
//   requestLine()                - the VM is waiting for a line of input
//   requestChar()                - the VM is waiting for a single keypress
//   quit()                       - the game ended (glk_exit)
//   fatalError(message)          - the VM hit an unrecoverable error
//   hasSave(name) / loadSave(name) / writeSave(name, bytes) - persistence
//     hooks backing the game's own save/restore commands.

const evtype_None = 0;
const evtype_LineInput = 3;

const gestalt_CharOutput = 2;
const gestalt_LineInput = 3;
const gestalt_Unicode = 15;

const wintype_TextBuffer = 3;
const wintype_TextGrid = 4;

export function createGlk(hooks) {
    let pendingLineBuffer = null;
    let pendingEvent = null;

    class RefStruct {
        constructor() {
            this.fields = [];
        }
        push_field(v) {
            this.fields.push(v);
        }
        get_field(i) {
            return this.fields[i] || 0;
        }
        set_field(i, v) {
            this.fields[i] = v;
        }
    }

    class RefBox {
        constructor() {
            this.value = 0;
        }
        set_value(v) {
            this.value = v;
        }
        get_value() {
            return this.value;
        }
    }

    function makeStream(rock) {
        return { rock: rock || 0, write_count: 0, read_count: 0, data: [], pos: 0 };
    }

    const mainStream = makeStream(0);
    const mainWindow = { type: wintype_TextBuffer, rock: 0, str: mainStream };

    // The status window is a small text grid: a handful of rows the game
    // positions text within via glk_window_move_cursor. We don't need a
    // real 2D buffer beyond that.
    const statusStream = makeStream(0);
    let statusWindow = null; // created lazily, only if the game opens one
    const statusRows = [];
    let statusCursor = { x: 0, y: 0 };
    let statusDirty = false;

    let currentStream = mainStream;

    function statusRowText(y) {
        return (statusRows[y] || []).join('').replace(/\s+$/, '');
    }

    function flushStatusIfDirty() {
        if (!statusDirty) return;
        statusDirty = false;
        const text = statusRows.map((_, y) => statusRowText(y)).join('  ').trim();
        hooks.status && hooks.status(text);
    }

    function writeToStatusGrid(text) {
        const row = statusRows[statusCursor.y] || (statusRows[statusCursor.y] = []);
        for (let i = 0; i < text.length; i++) {
            row[statusCursor.x++] = text[i];
        }
        statusDirty = true;
    }

    function streamWrite(str, text) {
        if (str === statusStream) {
            writeToStatusGrid(text);
            return;
        }
        if (str === mainStream || str === currentStream) {
            hooks.write(text);
        } else if (str && str.buf) {
            for (let i = 0; i < text.length && str.pos < str.buflen; i++) {
                str.buf[str.pos++] = text.charCodeAt(i);
            }
        } else if (str && str.data) {
            for (let i = 0; i < text.length; i++) str.data.push(text.charCodeAt(i));
        }
        if (str) str.write_count += text.length;
    }

    function bufferToString(buf) {
        return Array.from(buf)
            .map((c) => String.fromCharCode(c))
            .join('');
    }

    const Glk = {
        RefStruct,
        RefBox,

        fatal_error(msg) {
            hooks.fatalError && hooks.fatalError(String(msg));
        },
        glk_exit() {
            hooks.quit && hooks.quit();
        },

        glk_gestalt(sel) {
            if (sel === gestalt_LineInput) return 1;
            if (sel === gestalt_CharOutput) return 2;
            if (sel === gestalt_Unicode) return 1;
            return 0;
        },
        glk_gestalt_ext(sel) {
            return Glk.glk_gestalt(sel);
        },

        glk_window_open(split, method, size, wintype) {
            if (wintype === wintype_TextGrid) {
                statusWindow = { type: wintype_TextGrid, str: statusStream };
                statusRows.length = 0;
                statusCursor = { x: 0, y: 0 };
                return statusWindow;
            }
            return mainWindow;
        },
        glk_window_close(win) {
            if (win === statusWindow) statusWindow = null;
        },
        glk_window_get_stream(win) {
            return (win && win.str) || mainStream;
        },
        glk_window_clear(win) {
            if (win === statusWindow) {
                statusRows.length = 0;
                statusCursor = { x: 0, y: 0 };
                statusDirty = true;
            } else {
                hooks.clear && hooks.clear();
            }
        },
        glk_set_window(win) {
            currentStream = win && win.str ? win.str : mainStream;
        },
        glk_window_get_size(win, widthRef, heightRef) {
            if (widthRef) widthRef.set_value(80);
            if (heightRef) heightRef.set_value(win === statusWindow ? 1 : 25);
        },
        glk_window_move_cursor(win, x, y) {
            if (win === statusWindow) statusCursor = { x, y };
        },
        glk_window_get_parent() {
            return mainWindow;
        },
        glk_window_set_arrangement() {},
        glk_window_iterate() {
            return null;
        },

        glk_stream_set_current(str) {
            currentStream = str || mainStream;
        },
        glk_stream_get_current() {
            return currentStream;
        },
        glk_stream_close(str, result) {
            if (result) {
                result.set_field(0, str.read_count);
                result.set_field(1, str.write_count);
            }
            if (str && str.fref && hooks.writeSave) {
                hooks.writeSave(str.fref.filename, Uint8Array.from(str.data));
            }
        },
        glk_stream_iterate() {
            return null;
        },

        // Output — all of these act on the *current* stream, same as the
        // explicit _stream variants below (this is real Glk semantics:
        // glk_put_string() is just shorthand for writing to whatever
        // glk_set_window()/glk_stream_set_current() last selected).
        glk_put_char(ch) {
            streamWrite(currentStream, String.fromCharCode(ch));
        },
        glk_put_string(text) {
            streamWrite(currentStream, text);
        },
        glk_put_buffer(buf) {
            streamWrite(currentStream, bufferToString(buf));
        },
        glk_put_char_uni(ch) {
            streamWrite(currentStream, String.fromCodePoint(ch));
        },
        glk_put_string_uni(text) {
            streamWrite(currentStream, text);
        },
        glk_put_buffer_uni(buf) {
            streamWrite(
                currentStream,
                Array.from(buf)
                    .map((c) => String.fromCodePoint(c))
                    .join('')
            );
        },
        glk_put_jstring(text) {
            if (text) streamWrite(currentStream, text);
        },

        glk_put_char_stream(str, ch) {
            streamWrite(str, String.fromCharCode(ch));
        },
        glk_put_string_stream(str, text) {
            streamWrite(str, text);
        },
        glk_put_buffer_stream(str, buf) {
            streamWrite(str, bufferToString(buf));
        },
        glk_put_jstring_stream(str, text) {
            if (text) streamWrite(str, text);
        },

        // Style / misc — ignored by a plain-text terminal
        glk_set_style() {},
        glk_set_style_stream() {},
        glk_stylehint_set() {},
        glk_stylehint_clear() {},
        garglk_set_reversevideo_stream() {},
        glk_tick() {},

        // Input
        glk_request_line_event(win, buf) {
            pendingLineBuffer = buf;
            hooks.requestLine && hooks.requestLine();
        },
        glk_request_line_event_uni(win, buf) {
            Glk.glk_request_line_event(win, buf);
        },
        glk_cancel_line_event(win, event) {
            pendingLineBuffer = null;
            if (event) event.set_field(0, 0);
        },

        glk_request_char_event() {
            hooks.requestChar && hooks.requestChar();
        },
        glk_request_char_event_uni() {
            Glk.glk_request_char_event();
        },
        glk_cancel_char_event() {},

        glk_select(event) {
            pendingEvent = event;
        },
        glk_select_poll(event) {
            event.set_field(0, evtype_None);
        },

        glk_fileref_create_by_prompt(usage, fmode, rock) {
            return { rock, usage, fmode, filename: 'save' };
        },
        glk_fileref_create_by_name(usage, name, rock) {
            return { rock, usage, filename: name };
        },
        glk_fileref_destroy() {},
        glk_fileref_does_file_exist(fref) {
            return hooks.hasSave && hooks.hasSave(fref.filename) ? 1 : 0;
        },

        glk_stream_open_file(fref, fmode) {
            const str = makeStream(0);
            str.fref = fref;
            str.fmode = fmode;
            if (hooks.loadSave) {
                const saved = hooks.loadSave(fref.filename);
                if (saved) str.data = Array.from(saved);
            }
            return str;
        },
        glk_stream_open_file_uni(fref, fmode) {
            return Glk.glk_stream_open_file(fref, fmode);
        },
        glk_stream_open_memory(buf, buflen, fmode, rock) {
            const str = makeStream(rock);
            str.buf = buf;
            str.buflen = buflen;
            str.fmode = fmode;
            return str;
        },
        glk_stream_open_memory_uni(buf, buflen, fmode, rock) {
            return Glk.glk_stream_open_memory(buf, buflen, fmode, rock);
        },

        update() {
            flushStatusIfDirty();
        },
    };

    // Called by the app once a line of input (already run through the LLM
    // interpreter, or typed raw) is ready to hand to the game.
    Glk._submitLine = function (line) {
        if (!pendingLineBuffer) return 0;
        const buf = pendingLineBuffer;
        const len = Math.min(line.length, buf.length);
        for (let i = 0; i < len; i++) buf[i] = line.charCodeAt(i);
        if (pendingEvent) {
            pendingEvent.set_field(0, evtype_LineInput);
            pendingEvent.set_field(1, mainWindow);
            pendingEvent.set_field(2, len);
            pendingEvent.set_field(3, 0);
        }
        pendingLineBuffer = null;
        return len;
    };

    return Glk;
}
