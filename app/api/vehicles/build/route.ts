import {NextResponse} from 'next/server';
import {
  VehicleWorkshopError,
  buildVehicles
} from '../../../../server/vehicle-workshop/vehicle-workshop-service.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(): Promise<NextResponse> {
  try {
    return NextResponse.json(await buildVehicles(), {
      headers: {'Cache-Control': 'no-store'}
    });
  } catch (error) {
    const status = error instanceof VehicleWorkshopError ? error.status : 500;
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Vehicle build failed.'
    }, {status});
  }
}
