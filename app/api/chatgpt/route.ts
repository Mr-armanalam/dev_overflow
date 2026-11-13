import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
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

    // const response = await fetch("https://api.llama.com/v1/endpoint", {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     Authorization: `Bearer ${process.env.LLAMA_API_KEY}`,
    //   },
    //   body: JSON.stringify({
    //     model: 'Llama3.2-90B-Vision',
    //     // messages: [{ role: 'system', content: customPrompt}],
    //     messages: [
    //       {
    //         role: "system",
    //         content:
    //           "You are a knowlegeable assistant that provides quality information. Your goal is to provide accurate, thorough, and engaging answer",
    //       },
    //       {
    //         role: "user",
    //         content: `Tell me ${question}`,
    //       },
    //     ],
    //   }),
    // });

    // if (!response.ok) {
    //   throw new Error(`HTTP error! status: ${response.status}`);
    // }
    // const responseData = await response.json();

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = question;
    const result = await model.generateContent(prompt);

    const responseData = result.response.text();
    const reply = await formatAIGeneratedText(responseData)

    return NextResponse.json({reply});
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message });
  }
};
