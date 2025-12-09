
'use server';

import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { z } from 'zod';

console.log('[API LOG] /api/ai/scan-menu/route.js file loaded.');

// Initialize Genkit and AI plugins right here in the server-side route.
const ai = genkit({
  plugins: [
    googleAI(),
  ],
});


// Define the structure for a single menu item that the AI should return
const MenuItemSchema = z.object({
  name: z.string().describe('The name of the food item.'),
  description: z
    .string()
    .optional()
    .describe('A brief description if available (e.g., number of pieces).'),
  categoryId: z
    .string()
    .default('general')
    .describe(
      "The category of the item (e.g., 'snacks', 'main-course'). Default to 'general' if unsure."
    ),
  isVeg: z
    .boolean()
    .default(true)
    .describe(
      'Set to true if the item is vegetarian, false if non-vegetarian. Default to true if not specified.'
    ),
  portions: z
    .array(
      z.object({
        name: z
          .string()
          .describe("The portion size name (e.g., 'Half', 'Full', '6 Pcs')."),
        price: z.number().describe('The price for this portion.'),
      })
    )
    .describe(
      'An array of pricing options. If only one price, use "Full" as the name.'
    ),
  tags: z
    .array(z.string())
    .optional()
    .describe("Optional tags like 'Bestseller' or 'Spicy'."),
});

// Define the overall output structure: an array of menu items
const MenuScanOutputSchema = z.object({
  items: z.array(MenuItemSchema),
});

// Define the Genkit prompt for the AI
const menuScanPrompt = ai.definePrompt({
  name: 'menuScanPrompt',
  model: 'googleai/gemini-2.5-flash-preview-09-2025',
  input: {
    schema: z.object({
      photoDataUri: z.string(),
    }),
  },
  output: {
    schema: MenuScanOutputSchema,
  },
  prompt: `You are an expert menu digitizer for Indian street food vendors. Analyze the provided menu image and extract all food items into a structured JSON format.

  **CRITICAL INSTRUCTIONS:**
  1.  **Extract All Details:** For each item, identify its 'name', 'description' (if any), 'categoryId', 'isVeg' status, and pricing 'portions'.
  2.  **Handle Pricing:**
      *   If an item has multiple prices (e.g., Half/Full, 6 Pcs/12 Pcs), create a separate object for each in the 'portions' array.
      *   If an item has only one price, create a single portion object with the name "Full".
  3.  **Vegetarian Status:** Identify non-veg items (containing chicken, mutton, egg, fish, etc.) and set 'isVeg' to 'false'. For all other items, default 'isVeg' to 'true'.
  4.  **Categorization - PRESERVE EXACT NAMES:** 
      *   Look for category headings or sections on the menu (e.g., "Drinks", "Main Course", "Chaat", etc.)
      *   Use the EXACT category name as shown on the menu, converted to lowercase with dashes instead of spaces
      *   Examples: "Drinks" → "drinks", "Main Course" → "main-course", "Chaat Items" → "chaat-items"
      *   DO NOT translate or infer categories - use what you see on the menu!
      *   If no category is visible for an item, use 'general'
  5.  **IGNORE IMAGES:** The 'imageUrl' field MUST NOT be part of your response. Leave it out completely.
  6.  **IGNORE ADD-ONS:** Do not extract any "add-on" or "extra" items that are not main dishes.

  Analyze this menu image:
  {{media url=photoDataUri}}
  `,
});


export async function POST(req) {
  console.log('[API LOG] POST /api/ai/scan-menu: Request received.');

  async function getVendorId(uid) {
    console.log(`[API LOG] getVendorId: Searching for vendor with ownerId: ${uid}`);
    const firestore = await getFirestore();
    const q = firestore
      .collection('street_vendors')
      .where('ownerId', '==', uid)
      .limit(1);
    const snapshot = await q.get();
    if (snapshot.empty) {
      console.error(`[API ERROR] getVendorId: No street vendor profile found for UID: ${uid}`);
      throw new Error('No street vendor profile found for this user.');
    }
    const vendorId = snapshot.docs[0].id;
    console.log(`[API LOG] getVendorId: Found vendor ID: ${vendorId}`);
    return vendorId;
  }

  try {
    console.log('[API LOG] Verifying user token...');
    const uid = await verifyAndGetUid(req);
    console.log(`[API LOG] User verified. UID: ${uid}`);

    const vendorId = await getVendorId(uid);
    console.log(`[API LOG] Vendor ID retrieved: ${vendorId}`);

    const { imageDataUri } = await req.json();

    if (!imageDataUri) {
      console.error("[API ERROR] POST /api/ai/scan-menu: Image data is required.");
      return NextResponse.json(
        { message: 'Image data is required.' },
        { status: 400 }
      );
    }
    console.log('[API LOG] Image data URI received: Present');

    console.log('[API LOG] Calling Genkit menuScanPrompt...');
    const llmResponse = await menuScanPrompt({ photoDataUri: imageDataUri });
    console.log('[API LOG] Genkit response received.');
    const scannedData = llmResponse.output;

    if (!scannedData || !scannedData.items || scannedData.items.length === 0) {
      console.warn('[API WARN] AI could not detect any menu items.');
      return NextResponse.json(
        { message: 'AI could not detect any menu items. Please try a clearer image.' },
        { status: 400 }
      );
    }
    console.log(`[API LOG] AI detected ${scannedData.items.length} items. Starting database write.`);

    const firestore = await getFirestore();

    // Get vendor document to check existing categories
    const vendorDocRef = firestore.collection('street_vendors').doc(vendorId);
    const vendorDocSnap = await vendorDocRef.get();
    const vendorData = vendorDocSnap.data();
    const currentCustomCategories = vendorData.customCategories || [];

    // Extract unique categories from scanned items
    const uniqueCategories = new Set();
    scannedData.items.forEach(item => {
      if (item.categoryId) {
        uniqueCategories.add(item.categoryId);
      }
    });

    console.log(`[AI Scan] Unique categories in scan:`, Array.from(uniqueCategories).join(', '));

    // Find new categories that need to be saved
    const newCategories = [];
    uniqueCategories.forEach(catId => {
      // Check if already exists in custom categories
      if (currentCustomCategories.some(cat => cat.id === catId)) {
        console.log(`[AI Scan] Category '${catId}' already exists, skipping`);
        return;
      }

      // New category found - create title from ID
      const title = catId.split('-').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');

      newCategories.push({ id: catId, title });
      console.log(`[AI Scan] New category detected: '${catId}' -> '${title}'`);
    });

    const batch = firestore.batch();

    // If there are new categories, update vendor document
    if (newCategories.length > 0) {
      const updatedCategories = [...currentCustomCategories, ...newCategories];
      batch.set(vendorDocRef, { customCategories: updatedCategories }, { merge: true });
      console.log(`[AI Scan] Adding ${newCategories.length} new categories:`,
        newCategories.map(c => `${c.id} (${c.title})`).join(', '));
    } else {
      console.log(`[AI Scan] No new categories to add`);
    }

    const menuCollectionRef = firestore.collection('street_vendors').doc(vendorId).collection('menu');


    scannedData.items.forEach(item => {
      const newItemRef = menuCollectionRef.doc();
      const itemData = {
        id: newItemRef.id,
        name: item.name,
        description: item.description || '',
        categoryId: item.categoryId,
        isVeg: item.isVeg,
        portions: item.portions,
        tags: item.tags || [],
        isAvailable: true,
        order: 999, // Add default order for sorting
      };
      console.log('[API LOG] Preparing to batch write item:', JSON.stringify(itemData, null, 2));
      batch.set(newItemRef, itemData);
    });

    console.log('[API LOG] Batch commit started.');
    await batch.commit();
    console.log('[API LOG] Batch commit successful.');


    return NextResponse.json({
      message: `Successfully scanned and added ${scannedData.items.length} items to your menu!`,
      itemsAdded: scannedData.items.length
    });

  } catch (error) {
    console.error('[/api/ai/scan-menu] CRITICAL ERROR:', error);
    return NextResponse.json(
      { message: `An error occurred: ${error.message}` },
      { status: 500 }
    );
  }
}
