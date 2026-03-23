/**
 * Gemini API integration via @google/genai SDK.
 * Port of GeminiExtractor from extraction.py.
 */

import { GoogleGenAI } from "@google/genai";
import type { InvoiceExtraction, RawOcrOutput, TableExtractionOutput } from "./types";
import { invoiceExtractionJsonSchema } from "./types";
import { SYSTEM_PROMPT, buildExtractionPrompt } from "./prompt-builder";

const MODELS = ["gemini-3.1-flash-lite-preview", "gemini-3-flash-preview"];

async function callGemini(
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

export async function extractWithGemini(
  apiKey: string,
  rawOcr?: RawOcrOutput,
  tableExtraction?: TableExtractionOutput,
  onStatus?: (msg: string) => void,
): Promise<InvoiceExtraction> {
  const genai = new GoogleGenAI({ apiKey });
  const prompt = buildExtractionPrompt(rawOcr, tableExtraction);

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    try {
      onStatus?.(`Trying ${model}...`);
      return await callGemini(genai, model, prompt);
    } catch (err) {
      const isLast = i === MODELS.length - 1;
      if (isLast) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      onStatus?.(`${model} failed (${msg}), falling back...`);
    }
  }

  throw new Error("All Gemini models failed");
}
