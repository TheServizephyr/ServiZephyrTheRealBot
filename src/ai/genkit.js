
'use client'; // This is a client-only file
import {genkit, type Genkit} from 'genkit';
import {googleAI, type GoogleAI} from '@genkit-ai/google-genai';

// Initialize the AI plugin.
// This is a client-side only file so we can lazy load the Genkit dependency.
// It also needs to be a .js file and not a .ts file.
genkit({
  plugins: [
    googleAI({
      apiVersion: 'v1beta',
    }),
  ],
});

/**
 * A type-safe and documented wrapper around the Genkit instance.
 *
 * This provides a clear, typed interface for AI-related functionalities throughout the application.
 *
 * @example
 * import { ai } from '@/ai/genkit';
 *
 * // Define a prompt
 * const myPrompt = ai.definePrompt(...)
 *
 * // Define a flow
 * const myFlow = ai.defineFlow(...)
 */
export const ai: Genkit & {
  googleAI: GoogleAI;
} = genkit as any;
