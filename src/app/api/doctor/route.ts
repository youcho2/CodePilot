import { NextResponse } from 'next/server';
import { runDiagnosis } from '@/lib/provider-doctor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await runDiagnosis();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[doctor] Diagnosis failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
