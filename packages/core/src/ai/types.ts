/** Einfaches JSON-Schema (Teilmenge, die Gemini und Groq verstehen). */
export type JsonSchema = { [key: string]: unknown };

export interface GenerateRequest {
  /** Kurzname der Aufgabe, z. B. "technical" oder "news" (für Logs und den Demo-Anbieter). */
  task: string;
  system: string;
  prompt: string;
  /** Erwartete Struktur der Antwort. */
  schema: JsonSchema;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GenerateResult {
  /** Geparste JSON-Antwort (noch nicht gegen das Schema geprüft). */
  data: unknown;
  raw: string;
  provider: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * Austauschbarer KI-Anbieter. Neue Anbieter (z. B. Claude) implementieren nur dieses Interface,
 * die Auswertung darüber bleibt unverändert.
 */
export interface LLMProvider {
  readonly id: string;
  readonly model: string;
  generateJSON(request: GenerateRequest): Promise<GenerateResult>;
}

/** Entfernt Markdown-Codezäune und liest JSON. Wirft bei ungültigem JSON. */
export function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced ? fenced[1]! : trimmed);
}
