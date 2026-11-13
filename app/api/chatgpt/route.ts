import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { formatAIGeneratedText } from "@/lib/utils";

export const POST = async (request: Request) => {
  const { question } = await request.json();

  try {
    // Server-only variable: never expose the Gemini key to the browser
    // via a NEXT_PUBLIC_* variable, and never log it.
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured" },
        { status: 500 },
      );
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: question,
    });

    const reply = await formatAIGeneratedText(response.text ?? "");

    return NextResponse.json({ reply });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message });
  }
};
