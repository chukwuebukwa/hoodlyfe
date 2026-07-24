import {NextResponse} from 'next/server';
import {
  VehicleWorkshopError,
  duplicateClosedVehicleDoors
} from '../../../../../server/vehicle-workshop/vehicle-workshop-service.ts';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  context: {params: Promise<{id: string}>}
): Promise<NextResponse> {
  try {
    const {id} = await context.params;
    await duplicateClosedVehicleDoors(id);
    return NextResponse.json({ok: true});
  } catch (error) {
    const status = error instanceof VehicleWorkshopError ? error.status : 500;
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Door duplication failed.'
    }, {status});
  }
}
