import {NextRequest, NextResponse} from 'next/server';
import {
  VehicleWorkshopError,
  createVehicleDraft,
  vehicleWorkshopCatalog
} from '../../../server/vehicle-workshop/vehicle-workshop-service.ts';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await vehicleWorkshopCatalog(), {
      headers: {'Cache-Control': 'no-store'}
    });
  } catch (error) {
    return workshopErrorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = await request.json() as {id?: unknown; label?: unknown; prompt?: unknown};
    const manifest = await createVehicleDraft({
      id: typeof input.id === 'string' ? input.id : '',
      label: typeof input.label === 'string' ? input.label : '',
      prompt: typeof input.prompt === 'string' ? input.prompt : ''
    });
    return NextResponse.json(manifest, {status: 201});
  } catch (error) {
    return workshopErrorResponse(error);
  }
}

function workshopErrorResponse(error: unknown): NextResponse {
  const status = error instanceof VehicleWorkshopError ? error.status : 500;
  const message = error instanceof Error ? error.message : 'Vehicle Workshop request failed.';
  if (status >= 500) console.error('Vehicle Workshop request failed.', error);
  return NextResponse.json({error: message}, {status});
}
