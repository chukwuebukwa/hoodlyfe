import {NextRequest, NextResponse} from 'next/server';
import {
  VehicleWorkshopError,
  generateVehicleFrames
} from '../../../../../server/vehicle-workshop/vehicle-workshop-service.ts';
import {
  VEHICLE_SOURCE_FRAMES,
  type VehicleSourceFrame
} from '../../../../../shared/content/vehicle-workshop.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  context: {params: Promise<{id: string}>}
): Promise<NextResponse> {
  try {
    const {id} = await context.params;
    const input = await request.json() as {frames?: unknown; prompt?: unknown};
    const frames = Array.isArray(input.frames)
      ? input.frames.filter((frame): frame is VehicleSourceFrame => (
        typeof frame === 'string' && VEHICLE_SOURCE_FRAMES.includes(frame as VehicleSourceFrame)
      ))
      : [];
    return NextResponse.json({
      candidates: await generateVehicleFrames(
        id,
        frames,
        typeof input.prompt === 'string' ? input.prompt : undefined
      )
    });
  } catch (error) {
    const status = error instanceof VehicleWorkshopError ? error.status : 500;
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Vehicle generation failed.'
    }, {status});
  }
}
