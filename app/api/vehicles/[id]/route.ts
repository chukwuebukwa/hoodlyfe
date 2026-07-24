import {NextRequest, NextResponse} from 'next/server';
import {
  VehicleWorkshopError,
  updateVehicleManifest
} from '../../../../server/vehicle-workshop/vehicle-workshop-service.ts';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  context: {params: Promise<{id: string}>}
): Promise<NextResponse> {
  try {
    const {id} = await context.params;
    return NextResponse.json(await updateVehicleManifest(id, await request.json()));
  } catch (error) {
    const status = error instanceof VehicleWorkshopError ? error.status : 500;
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Vehicle update failed.'
    }, {status});
  }
}
