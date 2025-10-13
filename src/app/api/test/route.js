
// File: src/app/api/test/route.js
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Adding a timestamp to ensure a unique commit for deployment
    return NextResponse.json({ message: `Hello World! New deployment trigger at ${new Date().toISOString()}` });
  } catch (error) {
    return NextResponse.json({ message: `API Route Error: ${error.message}` }, { status: 500 });
  }
}
