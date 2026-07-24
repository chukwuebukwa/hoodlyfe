import type {Metadata} from 'next';
import {VehicleWorkshopApp} from '../../components/vehicle-workshop/VehicleWorkshopApp';

export const metadata: Metadata = {
  title: 'Vehicle Workshop | NOCK0',
  description: 'Generate, author, validate, and compile NOCK0 vehicles'
};

export default function VehicleWorkshopPage() {
  return <VehicleWorkshopApp />;
}
