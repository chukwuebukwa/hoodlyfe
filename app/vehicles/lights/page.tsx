import type {Metadata} from 'next';
import {VehicleLightingLab} from '../../../components/vehicle-workshop/VehicleLightingLab';

export const metadata: Metadata = {
  title: 'Vehicle Lighting Lab | NOCK0',
  description: 'Isolated production vehicle-light shader preview'
};

export default function VehicleLightingLabPage() {
  return <VehicleLightingLab />;
}
