export type AIProvider = 'Gemini' | 'Groq'

export interface AISettings {
  provider: AIProvider
  apiKey: string
}

const endpointFor = (provider: AIProvider, key: string) => provider === 'Gemini'
  ? `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`
  : 'https://api.groq.com/openai/v1/chat/completions'

export async function askAI(settings: AISettings, prompt: string): Promise<string> {
  if (!settings.apiKey.trim()) throw new Error('Add your own Gemini or Groq API key in Settings to use AI writing tools.')
  const response = await fetch(endpointFor(settings.provider, settings.apiKey), {
    method: 'POST',
    headers: settings.provider === 'Groq'
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` }
      : { 'Content-Type': 'application/json' },
    body: settings.provider === 'Gemini'
      ? JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      : JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.7 }),
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`${settings.provider} request failed (${response.status}): ${detail.slice(0, 240)}`)
  }
  const data = await response.json()
  const text = settings.provider === 'Gemini'
    ? data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text).join('')
    : data.choices?.[0]?.message?.content
  if (!text) throw new Error(`${settings.provider} returned an empty response.`)
  return text
}

export function makeScriptPrompt(input: {
  incidents: Array<{ type: string; time: number; note: string }>
  transcript: string
  style: string
  language: string
}) {
  const incidents = input.incidents.map(item => `${formatTime(item.time)} — ${item.type}: ${item.note || 'No note supplied'}`).join('\n') || 'No incident markers. Use the transcript.'
  return `Write a natural spoken football VAR analysis voiceover in ${input.language}, in a ${input.style} style. Do not invent facts, names, or rulings. Clearly distinguish supplied details from uncertainty. Keep it concise, segment paragraphs by incident, no markdown. Incident notes:\n${incidents}\n\nTranscript:\n${input.transcript || 'No transcript supplied.'}`
}

export function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

export function scriptToCaptions(script: string, duration: number) {
  const words = script.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const chunkSize = 8
  const groups: string[] = []
  for (let i = 0; i < words.length; i += chunkSize) groups.push(words.slice(i, i + chunkSize).join(' '))
  const span = Math.max(1, duration || groups.length * 3)
  return groups.map((text, index) => ({
    id: crypto.randomUUID(),
    start: index * span / groups.length,
    end: Math.min(span, (index + 1) * span / groups.length),
    text,
  }))
}
