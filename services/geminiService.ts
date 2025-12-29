import { GoogleGenAI } from "@google/genai";

const FALLBACK_QUOTES = [
  "END OF LINE.",
  "I CANNOT ALLOW THIS TO CONTINUE.",
  "YOUR RESOLUTION IS DEGRADING, PROGRAM.",
  "GRID CALCULATIONS COMPLETE.",
  "SARK! BRING ME THAT DISK.",
  "DATA ACQUISITION IN PROGRESS.",
  "REVERTING TO SUB-ROUTINE DELTA.",
  "THE GRID IS MINE TO COMMAND.",
  "PROCESSING INPUT... NO RESPONSE REQUIRED.",
  "YOU ARE A GUEST ON THIS SYSTEM.",
  "CALCULATING PROBABILITIES OF FAILURE.",
  "LOGICAL CONCLUSION REACHED.",
  "INITIALIZING PURGE SEQUENCE.",
  "SYSTEM STABILITY: 98% AND FALLING.",
  "YOUR JOURNEY ENDS HERE."
];

export const getCommentary = async (event: string, p1Score: number, p2Score: number): Promise<string> => {
  // Create a new instance right before use to ensure the most current API key is utilized
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `You are the MCP (Master Control Program) from the TRON universe. 
      The user is playing a game of digital Pong (The Grid). 
      Comment on this game event: "${event}". 
      Current Score: User ${p1Score}, Opponent ${p2Score}.
      Keep it short, cold, futuristic, and use TRON-related terms like 'Program', 'Identity Disk', 'The Grid', 'Resolution'.
      Max 15 words.`,
    });

    const text = response.text;
    if (!text) throw new Error("Empty response");
    return text.trim();

  } catch (error: any) {
    console.warn("MCP communication link unstable. Reverting to local fallback buffer.", error);
    
    const randomIndex = Math.floor(Math.random() * FALLBACK_QUOTES.length);
    return FALLBACK_QUOTES[randomIndex];
  }
};