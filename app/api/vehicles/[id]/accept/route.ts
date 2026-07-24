import {NextRequest, NextResponse} from 'next/server';
import {
  VehicleWorkshopError,
  acceptVehicleCandidate
} from '../../../../../server/vehicle-workshop/vehicle-workshop-service.ts';
import {
  VEHICLE_SOURCE_FRAMES,
  type VehicleSourceFrame
} from '../../../../../shared/content/vehicle-workshop.ts';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: {params: Promise<{id: string}>}
): Promise<NextResponse> {
  try {
    const {id} = await context.params;
    const input = await request.json() as {candidateId?: unknown; frame?: unknown};
    if (
      typeof input.candidateId !== 'string' ||
      typeof input.frame !== 'string' ||
      !VEHICLE_SOURCE_FRAMES.includes(input.frame as VehicleSourceFrame)
    ) {
      return NextResponse.json({error: 'Candidate id and frame are required.'}, {status: 400});
    }
    return NextResponse.json({
      url: await acceptVehicleCandidate(id, input.candidateId, input.frame as VehicleSourceFrame)
    });
  } catch (error) {
    const status = error instanceof VehicleWorkshopError ? error.status : 500;
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Candidate acceptance failed.'
    }, {status});
  }
}
