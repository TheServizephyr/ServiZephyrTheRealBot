// File: src/app/api/test/route.js
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    return NextResponse.json({ message: "Hello World! This is a fresh deployment trigger." });
  } catch (error) {
    return NextResponse.json({ message: `API Route Error: ${error.message}` }, { status: 500 });
  }
}
