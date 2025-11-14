
'use server';

import {NextResponse} from 'next/server';
import {getFirestore, verifyAndGetUid} from '@/lib/firebase-admin';
import {ai} from '@/ai/genkit';
import {z} from 'zod';

// Define the structure for a single menu item that the AI should return
const MenuItemSchema = z.object({
  name: z.string().describe('The name of the food item.'),
  description: z
    .string()
    .optional()
    .describe('A brief description if available (e.g., number of pieces).'),
  categoryId: z.string().describe("The category of the item (e.g., 'snacks', 'main-course'). Default to 'general' if unsure."),
  isVeg: z
    .boolean()
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
  3.  **Vegetarian Status:** Identify non-veg items (containing chicken, mutton, egg, etc.) and set 'isVeg' to 'false'. For all other items, default 'isVeg' to 'true'.
  4.  **Categorization:** Group items into logical categories (e.g., 'chaat', 'rolls', 'beverages'). If a category is not clear, use 'general'.
  5.  **IGNORE IMAGES:** The 'imageUrl' field MUST NOT be part of your response. Leave it out completely.
  6.  **IGNORE ADD-ONS:** Do not extract any "add-on" or "extra" items that are not main dishes.

  Analyze this menu image:
  {{media url=photoDataUri}}
  `,
});

async function getVendorId(uid) {
  const firestore = await getFirestore();
  const q = firestore
    .collection('street_vendors')
    .where('ownerId', '==', uid)
    .limit(1);
  const snapshot = await q.get();
  if (snapshot.empty) {
    throw new Error('No street vendor profile found for this user.');
  }
  return snapshot.docs[0].id;
}

export async function POST(req) {
  try {
    const uid = await verifyAndGetUid(req);
    const vendorId = await getVendorId(uid);
    const {imageDataUri} = await req.json();

    if (!imageDataUri) {
      return NextResponse.json(
        {message: 'Image data is required.'},
        {status: 400}
      );
    }

    // Call the Genkit flow to process the image
    const llmResponse = await menuScanPrompt({photoDataUri: imageDataUri});
    const scannedData = llmResponse.output();

    if (!scannedData || !scannedData.items || scannedData.items.length === 0) {
      return NextResponse.json(
        {message: 'AI could not detect any menu items. Please try a clearer image.'},
        {status: 400}
      );
    }

    // Save the extracted items to Firestore
    const firestore = await getFirestore();
    const batch = firestore.batch();
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
            imageUrl: '', // Explicitly set to empty string as requested
            available: true,
            ownerId: uid,
        };
        batch.set(newItemRef, itemData);
    });

    await batch.commit();

    return NextResponse.json({
      message: `Successfully scanned and added ${scannedData.items.length} items to your menu!`,
      itemsAdded: scannedData.items.length
    });

  } catch (error) {
    console.error('[/api/ai/scan-menu] Error:', error);
    return NextResponse.json(
      {message: `An error occurred: ${error.message}`},
      {status: 500}
    );
  }
}
