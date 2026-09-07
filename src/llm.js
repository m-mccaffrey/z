// Turns loose, conversational player input into the exact terse command
// a classic text-adventure parser expects, by asking an LLM. This is the
// only place user input gets rewritten — the translated command is what
// actually reaches the game; the game's own output is never touched.

export const DEFAULT_MODELS = {
    anthropic: 'claude-sonnet-5',
    openai: 'gpt-4o-mini',
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
    cmd = cmd.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '');
    cmd = cmd.trim().replace(/^["'`]+|["'`]+$/g, '');
    const firstLine = cmd
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)[0];
    return (firstLine || '').slice(0, 200);
}

async function safeText(res) {
    try {
        return await res.text();
    } catch {
        return '';
    }
}

async function callAnthropic({ apiKey, model, userMessage }) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
            model: model || DEFAULT_MODELS.anthropic,
            max_tokens: 60,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessage }],
        }),
    });
    if (!res.ok) {
        throw new Error(`Anthropic API error ${res.status}: ${await safeText(res)}`);
    }
    const data = await res.json();
    const text = (data.content || []).map((block) => block.text || '').join('');
    return cleanCommand(text);
}

async function callOpenAI({ apiKey, model, userMessage }) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: model || DEFAULT_MODELS.openai,
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
    const text = data.choices?.[0]?.message?.content || '';
    return cleanCommand(text);
}

export async function interpretCommand({ provider, apiKey, model, transcriptTail, input }) {
    if (!apiKey) {
        throw new Error('No API key configured');
    }
    const userMessage = buildUserMessage(transcriptTail, input);
    if (provider === 'openai') {
        return callOpenAI({ apiKey, model, userMessage });
    }
    return callAnthropic({ apiKey, model, userMessage });
}
