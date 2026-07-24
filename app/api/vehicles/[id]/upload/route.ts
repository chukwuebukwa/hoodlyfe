import {NextRequest, NextResponse} from 'next/server';
import {
  VehicleWorkshopError,
  installUploadedVehicleFrame
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
    const form = await request.formData();
    const frame = form.get('frame');
    const file = form.get('file');
    if (
      typeof frame !== 'string' ||
      !VEHICLE_SOURCE_FRAMES.includes(frame as VehicleSourceFrame) ||
      !(file instanceof File)
    ) {
      return NextResponse.json({error: 'PNG file and frame are required.'}, {status: 400});
    }
    if (file.size > 12 * 1024 * 1024) {
      return NextResponse.json({error: 'Vehicle source image must be under 12 MB.'}, {status: 413});
    }
    return NextResponse.json({
      candidate: {
        frame,
        url: await installUploadedVehicleFrame(id, frame as VehicleSourceFrame, Buffer.from(await file.arrayBuffer()))
      }
    });
  } catch (error) {
    const status = error instanceof VehicleWorkshopError ? error.status : 500;
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Vehicle upload failed.'
    }, {status});
  }
}
