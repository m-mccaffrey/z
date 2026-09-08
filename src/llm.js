// Turns loose, conversational player input into the exact terse command
// a classic text-adventure parser expects, by asking an LLM. This is the
// only place user input gets rewritten — the translated command is what
// actually reaches the game; the game's own output is never touched.

export const DEFAULT_MODELS = {
    anthropic: 'claude-sonnet-5',
    openai: 'gpt-4o-mini',
    gemini: 'gemini-2.5-flash',
};

const SYSTEM_PROMPT = `You are the input layer for a classic text-adventure (interactive fiction) parser, in the style of Zork. The parser only understands short, literal commands: a verb, sometimes followed by one or two nouns — for example "look", "north", "take lamp", "open mailbox", "put cloak on hook", "inventory", "unlock door with key".

The player will type things more naturally or imperfectly than that. Your job is to rewrite what they typed into the closest valid parser command(s), and output NOTHING ELSE — no explanation, no quotation marks, no commentary.

Rules:
- Output only the command itself, in lowercase, 1-6 words per action.
- If the player already typed something that looks like a valid terse command, pass it through with minimal changes (just normalize case/whitespace).
- If they describe several actions in sequence ("pick up the lamp then go north"), chain them as separate sentences separated by ". " (a period and a space) — the parser accepts multiple commands on one line that way.
- Use the recent transcript only to resolve references like "it", "the door", or "go back" — never invent objects, exits, or actions the player didn't imply.
- Map meta-questions to the closest real command: "what am I carrying" -> "inventory", "where am I" -> "look", "what can I do here" -> "look".
- If you truly cannot tell what the player means, output your best single-word or two-word guess anyway — never ask a question, never output an empty string.`;

function buildUserMessage(transcriptTail, input) {
    return `Recent game transcript (most recent last):\n"""\n${transcriptTail || '(the game has not printed anything yet)'}\n"""\n\nThe player just typed: "${input}"\n\nRespond with only the translated parser command.`;
}

function cleanCommand(text) {
    let cmd = (text || '').trim();
    cmd = cmd.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '');
    const firstLine =
        cmd
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)[0] || '';
    // Strip surrounding quotes from just that line, not the whole blob —
    // otherwise a quote that only wraps line 1 survives when the model
    // tacks on a second line of chatter after it.
    return firstLine.replace(/^["'`]+|["'`]+$/g, '').slice(0, 200);
}

async function safeText(res) {
    try {
        return await res.text();
    } catch {
        return '';
    }
}

async function callAnthropic({ apiKey, model, userMessage }) {
    const usedModel = model || DEFAULT_MODELS.anthropic;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
            model: usedModel,
            max_tokens: 60,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessage }],
        }),
    });
    if (!res.ok) {
        throw new Error(`Anthropic API error ${res.status}: ${await safeText(res)}`);
    }
    const data = await res.json();
    const raw = (data.content || []).map((block) => block.text || '').join('');
    return { raw, model: usedModel };
}

async function callGemini({ apiKey, model, userMessage }) {
    const usedModel = model || DEFAULT_MODELS.gemini;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(usedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: userMessage }] }],
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            generationConfig: { maxOutputTokens: 60 },
        }),
    });
    if (!res.ok) {
        throw new Error(`Gemini API error ${res.status}: ${await safeText(res)}`);
    }
    const data = await res.json();
    const raw = (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('');
    return { raw, model: usedModel };
}

async function callOpenAI({ apiKey, model, userMessage }) {
    const usedModel = model || DEFAULT_MODELS.openai;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: usedModel,
            max_tokens: 60,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userMessage },
            ],
        }),
    });
    if (!res.ok) {
        throw new Error(`OpenAI API error ${res.status}: ${await safeText(res)}`);
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '';
    return { raw, model: usedModel };
}

// Returns { provider, model, raw, command, elapsedMs }: `raw` is exactly what
// the model said, `command` is that text cleaned up into something the
// parser can take. Both are handed back (not just `command`) so the caller
// can optionally show the player what the model actually produced.
export async function interpretCommand({ provider, apiKey, model, transcriptTail, input }) {
    if (!apiKey) {
        throw new Error('No API key configured');
    }
    const userMessage = buildUserMessage(transcriptTail, input);
    const caller = provider === 'openai' ? callOpenAI : provider === 'gemini' ? callGemini : callAnthropic;
    const startedAt = Date.now();
    const { raw, model: usedModel } = await caller({ apiKey, model, userMessage });
    const elapsedMs = Date.now() - startedAt;
    return { provider, model: usedModel, raw, command: cleanCommand(raw), elapsedMs };
}
