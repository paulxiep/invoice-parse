/**
 * Gemini API integration.
 * - API-key mode: uses @google/genai SDK (unchanged)
 * - OAuth mode: direct fetch() against the REST API (SDK doesn't support Bearer tokens)
 */

import { GoogleGenAI } from "@google/genai";
import type { AuthCredential } from "./auth";
import type { InvoiceExtraction, RawOcrOutput, TableExtractionOutput } from "./types";
import { invoiceExtractionJsonSchema } from "./types";
import { SYSTEM_PROMPT, buildExtractionPrompt } from "./prompt-builder";

const MODELS = ["gemini-3.1-flash-lite-preview", "gemini-3-flash-preview"];
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// --- API-key path (SDK) ---

async function callGeminiSdk(
  genai: GoogleGenAI,
  model: string,
  prompt: string,
): Promise<InvoiceExtraction> {
  const response = await genai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: invoiceExtractionJsonSchema(),
      temperature: 0.0,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty response");
  return JSON.parse(text) as InvoiceExtraction;
}

// --- OAuth path (direct fetch) ---

async function callGeminiFetch(
  accessToken: string,
  model: string,
  prompt: string,
): Promise<InvoiceExtraction> {
  const url = `${API_BASE}/${model}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: invoiceExtractionJsonSchema(),
      temperature: 0.0,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini API ${res.status}: ${detail}`);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");
  return JSON.parse(text) as InvoiceExtraction;
}

// --- Public API ---

export async function extractWithGemini(
  credential: AuthCredential,
  rawOcr?: RawOcrOutput,
  tableExtraction?: TableExtractionOutput,
  onStatus?: (msg: string) => void,
): Promise<InvoiceExtraction> {
  const prompt = buildExtractionPrompt(rawOcr, tableExtraction);

  const genai =
    credential.mode === "apikey"
      ? new GoogleGenAI({ apiKey: credential.apiKey! })
      : null;

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    try {
      onStatus?.(`Trying ${model}...`);
      if (credential.mode === "apikey" && genai) {
        return await callGeminiSdk(genai, model, prompt);
      } else {
        return await callGeminiFetch(credential.accessToken!, model, prompt);
      }
    } catch (err) {
      const isLast = i === MODELS.length - 1;
      if (isLast) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      onStatus?.(`${model} failed (${msg}), falling back...`);
    }
  }

  throw new Error("All Gemini models failed");
}
